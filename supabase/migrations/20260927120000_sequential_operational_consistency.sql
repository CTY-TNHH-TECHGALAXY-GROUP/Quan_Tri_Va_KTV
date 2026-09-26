-- Forward fixes proposed against bc06814f. Apply to an isolated DB before rollout.
CREATE OR REPLACE FUNCTION jsonb_unwrap_string(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE i integer;
BEGIN
  FOR i IN 1..2 LOOP
    EXIT WHEN jsonb_typeof(p) IS DISTINCT FROM 'string';
    p := (p #>> '{}')::jsonb;
  END LOOP;
  RETURN p;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;

-- The same ordering as lib/dispatch-status.ts; utility filtering matches isUtilityService.
CREATE OR REPLACE FUNCTION dispatch_recompute_booking_status(p_booking_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE statuses text[]; computed text; b "Bookings"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF b.status::text IN ('CANCELLED','SPLIT') THEN RETURN; END IF;
  SELECT array_agg(bi.status::text) INTO statuses FROM "BookingItems" bi
    LEFT JOIN "Services" svc ON svc.id = bi."serviceId"
    WHERE bi."bookingId" = p_booking_id
      AND NOT (COALESCE(svc.is_utility,false) OR COALESCE(bi."serviceId" = 'NHS0900',false)
        OR (lower(COALESCE(svc."nameVN",'')) ~ '(phòng riêng|phong rieng)' AND COALESCE(svc."nameVN",'') NOT LIKE '%+%'));
  IF statuses IS NULL THEN
    SELECT array_agg(status::text) INTO statuses FROM "BookingItems" WHERE "bookingId" = p_booking_id;
  END IF;
  computed := CASE
    WHEN statuses IS NULL THEN 'NEW'
    WHEN statuses && ARRAY['IN_PROGRESS','PAUSED'] THEN 'IN_PROGRESS'
    WHEN statuses && ARRAY['PREPARING','WAITING','NEW'] AND statuses && ARRAY['IN_PROGRESS','PAUSED','COMPLETED','DONE','CANCELLED','FEEDBACK','CLEANING'] THEN 'IN_PROGRESS'
    WHEN statuses && ARRAY['CLEANING','COMPLETED'] THEN 'CLEANING'
    WHEN 'FEEDBACK' = ANY(statuses) THEN 'FEEDBACK'
    WHEN statuses <@ ARRAY['DONE','CANCELLED'] THEN 'DONE'
    WHEN 'PREPARING' = ANY(statuses) THEN 'PREPARING'
    ELSE 'NEW' END;
  SELECT * INTO b FROM jsonb_populate_record(b,jsonb_build_object('status',computed));
  UPDATE "Bookings" SET status = b.status, "updatedAt" = clock_timestamp() WHERE id = p_booking_id;
END $$;

CREATE OR REPLACE FUNCTION ktv_start_service_atomic(
  p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb, p_guest_ratings jsonb,
  p_updates jsonb, p_employee_id text, p_target_segment_id text, p_started_at timestamptz, p_turn_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b "Bookings"%ROWTYPE; t "TurnQueue"%ROWTYPE; result jsonb; service_day date;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b."timeStart" IS DISTINCT FROM NULLIF(p_booking_snapshot->>'timeStart','')::timestamptz
     OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'START snapshot changed; reload'; END IF;
  service_day := b."bookingDate"::date;
  IF service_day IS NULL OR p_started_at IS NULL OR COALESCE(p_employee_id,'') = '' THEN RAISE EXCEPTION 'Invalid START'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_updates) patch,
    jsonb_array_elements(jsonb_unwrap_string(patch->'segments')) seg
    WHERE seg->>'id' = p_target_segment_id AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(seg->>'ktvId'),'\s+-\s+'))
      AND COALESCE(seg->>'voided','false') <> 'true' AND NULLIF(seg->>'actualStartTime','')::timestamptz = p_started_at) THEN
    RAISE EXCEPTION 'Invalid START target';
  END IF;
  -- Reuse the proven snapshot lock and item commit. Nested calls remain in this transaction.
  result := ktv_finish_service_atomic(p_booking_id,p_booking_snapshot,p_item_snapshots,p_guest_ratings,p_updates,'IN_PROGRESS');
  UPDATE "Bookings" SET "timeStart" = COALESCE("timeStart",p_started_at) WHERE id = p_booking_id;
  SELECT * INTO t FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = service_day FOR UPDATE;
  IF NOT FOUND OR (t.current_order_id IS NOT NULL AND t.current_order_id <> p_booking_id)
     OR (p_turn_patch - ARRAY['status','current_order_id','start_time','estimated_end_time','room_id','bed_id','booking_item_id','booking_item_ids']) <> '{}' THEN
    RAISE EXCEPTION 'TurnQueue changed; reload';
  END IF;
  SELECT * INTO t FROM jsonb_populate_record(t,p_turn_patch);
  UPDATE "TurnQueue" SET status = t.status, current_order_id = t.current_order_id,
    start_time = t.start_time, estimated_end_time = t.estimated_end_time,
    room_id = t.room_id, bed_id = t.bed_id, booking_item_id = t.booking_item_id, booking_item_ids = t.booking_item_ids
    WHERE employee_id = p_employee_id AND date = service_day;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;

CREATE OR REPLACE FUNCTION ktv_release_work_atomic(
  p_booking_id text, p_employee_id text, p_photo_urls jsonb, p_item_ids jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item "BookingItems"%ROWTYPE; a "KtvAssignments"%ROWTYPE; v_segments jsonb; live_done jsonb;
  seg jsonb; images jsonb; changed_dates date[] := '{}'; day date; count_done integer := 0;
  now_at timestamptz := clock_timestamp(); b "Bookings"%ROWTYPE; promotion jsonb;
  opts jsonb; all_done boolean; all_handed boolean; rated boolean; next_status text;
BEGIN
  IF COALESCE(p_employee_id,'') = '' OR jsonb_typeof(p_photo_urls) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_photo_urls) > 20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_photo_urls) v WHERE jsonb_typeof(v) <> 'string')
    OR (p_item_ids IS NOT NULL AND jsonb_typeof(p_item_ids) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid RELEASE payload';
  END IF;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
  PERFORM id FROM "BookingGuests" WHERE booking_id = p_booking_id ORDER BY id FOR UPDATE;
  FOR item IN SELECT * FROM "BookingItems" WHERE "bookingId" = p_booking_id
    AND (p_item_ids IS NULL OR p_item_ids ? id) ORDER BY id LOOP
    v_segments := jsonb_unwrap_string(item.segments);
    IF jsonb_typeof(v_segments) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid RELEASE v_segments'; END IF;
    SELECT COALESCE(jsonb_agg(s),'[]') INTO live_done FROM jsonb_array_elements(v_segments) s
      WHERE COALESCE(s->>'voided','false') <> 'true'
        AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> '';
    IF jsonb_array_length(live_done) = 0 THEN CONTINUE; END IF;
    IF jsonb_array_length(p_photo_urls) = 0 AND item.handover_status IS DISTINCT FROM 'SKIPPED'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) s WHERE COALESCE(s->>'handoverTime','') <> '') THEN
      RAISE EXCEPTION 'Submit photos or use existing skip quota before release';
    END IF;
    count_done := count_done + 1;
    SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = s->>'id')
      THEN s || jsonb_build_object('feedbackTime',COALESCE(NULLIF(s->>'feedbackTime',''),now_at::text)) ELSE s END ORDER BY ord)
      INTO v_segments FROM jsonb_array_elements(v_segments) WITH ORDINALITY v(s,ord);
    IF jsonb_array_length(p_photo_urls) > 0 THEN
      SELECT COALESCE(jsonb_object_agg(p_employee_id || ' · Ảnh ' || ord::text,value),'{}') INTO images
        FROM jsonb_array_elements(p_photo_urls) WITH ORDINALITY v(value,ord);
      SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = s->>'id')
        THEN s || jsonb_build_object('handoverTime',now_at,'handoverPhotoUrls',p_photo_urls) ELSE s END ORDER BY ord)
        INTO v_segments FROM jsonb_array_elements(v_segments) WITH ORDINALITY v(s,ord);
      UPDATE "BookingItems" SET segments = v_segments, handover_images = (CASE WHEN jsonb_typeof(item.handover_images) = 'object' THEN item.handover_images
        WHEN jsonb_typeof(item.handover_images) = 'array' THEN (SELECT COALESCE(jsonb_object_agg('Ảnh cũ ' || ord::text,value),'{}')
          FROM jsonb_array_elements(item.handover_images) WITH ORDINALITY v(value,ord)) ELSE '{}' END) || images,
        handover_status = 'PENDING', handover_skipped = false, handover_submitted_at = now_at WHERE id = item.id;
    END IF;
    opts := COALESCE(jsonb_unwrap_string(item.options),'{}');
    SELECT bool_and(COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''),
      bool_and(COALESCE(s->>'handoverTime','') <> '') INTO all_done,all_handed FROM jsonb_array_elements(v_segments) s
      WHERE COALESCE(s->>'ktvId','') <> '' AND COALESCE(s->>'voided','false') <> 'true';
    IF opts->>'sequentialSlots' = '2' AND opts->>'finishedAfterA' IS DISTINCT FROM 'true'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_segments) s
        WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'voided','false') <> 'true'
          AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> '') THEN all_done := false; END IF;
    rated := item."itemRating" IS NOT NULL OR b.rating IS NOT NULL OR EXISTS (
      SELECT 1 FROM "BookingGuests" WHERE id = item.guest_id AND rating IS NOT NULL);
    next_status := CASE WHEN item.status IN ('DONE','CANCELLED') THEN item.status::text
      WHEN NOT COALESCE(all_done,false) THEN 'IN_PROGRESS'
      WHEN rated AND all_handed THEN 'DONE' ELSE 'FEEDBACK' END;
    SELECT * INTO item FROM jsonb_populate_record(item,jsonb_build_object('status',next_status));
    UPDATE "BookingItems" SET segments = v_segments, status = item.status WHERE id = item.id;
    -- Skip preserves SKIPPED/debt and does not fabricate physical handoverTime.
    FOR a IN SELECT * FROM "KtvAssignments" WHERE booking_id = p_booking_id
      AND booking_item_id = item.id AND employee_id = p_employee_id AND status IN ('ACTIVE','QUEUED','READY')
      ORDER BY business_date, segment_id FOR UPDATE LOOP
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(live_done) d WHERE d->>'id' = a.segment_id)
        OR (a.segment_id IS NULL AND jsonb_array_length(live_done) = 1 AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE COALESCE(s->>'voided','false') <> 'true'
          AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
          AND COALESCE(s->>'actualEndTime','') = '')) THEN
        UPDATE "KtvAssignments" SET status = 'COMPLETED', updated_at = now_at
          WHERE employee_id = a.employee_id AND booking_item_id = a.booking_item_id AND segment_id IS NOT DISTINCT FROM a.segment_id;
        changed_dates := array_append(changed_dates,a.business_date);
      END IF;
    END LOOP;
  END LOOP;
  IF count_done = 0 THEN RAISE EXCEPTION 'No completed live work to release'; END IF;
  FOR day IN SELECT DISTINCT unnest(changed_dates) LOOP
    -- Repaying an old debt must never promote/clear another booking currently being served.
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id = p_employee_id AND business_date = day AND status = 'ACTIVE')
      AND NOT EXISTS (SELECT 1 FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = day
        AND current_order_id IS NOT NULL AND current_order_id <> p_booking_id) THEN
      promotion := promote_next_assignment(p_employee_id,day);
      IF promotion ? 'success' AND NOT COALESCE((promotion->>'success')::boolean,false) THEN RAISE EXCEPTION 'Promotion failed'; END IF;
    END IF;
  END LOOP;
  PERFORM dispatch_recompute_booking_status(p_booking_id);
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;

CREATE OR REPLACE FUNCTION dispatch_assign_sequential_slot_b(
    p_booking_id text, p_item_id text, p_to_ktv text,
    p_planned_start_at timestamptz, p_duration_minutes integer, p_confirm_overlap boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_a_assignment "KtvAssignments"%ROWTYPE;
    v_turn "TurnQueue"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_new_b jsonb;
    v_reference timestamptz;
    v_old_ktv text;
    v_b_id text;
    v_end_at timestamptz;
    v_service_day date;
    v_expected_at timestamptz;
BEGIN
    IF COALESCE(p_to_ktv, '') = '' OR p_planned_start_at IS NULL
       OR p_duration_minutes NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'Thông tin lượt B không hợp lệ';
    END IF;
    SELECT "bookingDate"::date INTO v_service_day FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF v_service_day IS NULL THEN RAISE EXCEPTION 'Missing service day'; END IF;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR COALESCE(v_options->>'finishedAfterA', 'false') = 'true'
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND status IN ('ACTIVE', 'COMPLETED')
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phân công của A'; END IF;
    v_reference := COALESCE(NULLIF(v_a->>'actualEndTime', '')::timestamptz,
                            v_a_assignment.planned_end_time);
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND v_reference IS NOT NULL THEN
        IF v_a_assignment.planned_start_time IS NOT NULL
           AND v_reference <= v_a_assignment.planned_start_time THEN
            v_reference := v_reference + interval '1 day';
        END IF;
    END IF;
    v_expected_at := (v_service_day + (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < (v_a->>'startTime')::time THEN
        v_expected_at := v_expected_at + interval '1 day';
    END IF;
    IF p_planned_start_at IS DISTINCT FROM v_expected_at OR v_a_assignment.business_date <> v_service_day THEN
        RAISE EXCEPTION 'B must follow the booking service day; reload plan';
    END IF;
    IF v_reference IS NULL THEN RAISE EXCEPTION 'Giờ kết thúc của A chưa hợp lệ; hãy sửa mốc A'; END IF;
    IF p_planned_start_at < v_reference AND COALESCE(p_confirm_overlap, false) = false THEN
        RETURN jsonb_build_object('success', false, 'code', 'OVERLAP_CONFIRM_REQUIRED',
            'referenceAt', v_reference, 'referenceKind',
            CASE WHEN COALESCE(v_a->>'actualEndTime', '') <> '' THEN 'actual' ELSE 'planned' END);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Staff" WHERE id = p_to_ktv AND status = 'ĐANG LÀM') THEN
        RAISE EXCEPTION 'KTV B không khả dụng';
    END IF;
    v_old_ktv := v_b->>'ktvId';
    SELECT * INTO v_turn FROM "TurnQueue"
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date FOR UPDATE;
    IF NOT FOUND OR (p_to_ktv IS DISTINCT FROM v_old_ktv
       AND (v_turn.status <> 'waiting' OR v_turn.current_order_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'KTV B không còn rảnh; tải lại sổ tua';
    END IF;
    IF EXISTS (SELECT 1 FROM "KtvAssignments"
               WHERE employee_id = p_to_ktv AND business_date = v_a_assignment.business_date
                 AND status = 'ACTIVE' AND (booking_item_id <> p_item_id OR segment_id IS DISTINCT FROM v_b->>'id')) THEN
        RAISE EXCEPTION 'KTV B đang có phân công khác';
    END IF;
    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);
    IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id = p_to_ktv
      AND ka.status = 'ACTIVE' AND (ka.booking_item_id <> p_item_id OR ka.segment_id IS DISTINCT FROM v_b->>'id')
      AND ka.planned_start_time < v_end_at AND ka.planned_end_time > p_planned_start_at) THEN
        RAISE EXCEPTION 'KTV B has another overlapping assignment';
    END IF;
    v_b_id := CASE WHEN p_to_ktv = v_old_ktv THEN v_b->>'id' ELSE gen_random_uuid()::text END;
    v_new_b := jsonb_build_object(
        'id', v_b_id, 'ktvId', p_to_ktv, 'sequenceSlot', 2,
        'roomId', v_a->'roomId', 'bedId', v_a->'bedId',
        'plannedStartAt', p_planned_start_at, 'plannedEndAt', v_end_at,
        'startTime', to_char(p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'endTime', to_char(v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'duration', p_duration_minutes);
    IF v_b IS NOT NULL THEN
        IF p_to_ktv = v_old_ktv THEN
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b_id THEN v_new_b ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        ELSE
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                                  THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
            v_segments := v_segments || jsonb_build_array(v_new_b);
            UPDATE "KtvAssignments" SET status = 'CANCELLED'
            WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
            DELETE FROM "TurnLedger" tl USING "Bookings" booking
            WHERE booking.id = p_booking_id AND tl.date = v_a_assignment.business_date
              AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
              AND tl.employee_id = v_old_ktv
              AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                              JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                              WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                                AND ka.business_date = tl.date AND ka.employee_id = v_old_ktv
                                AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
            PERFORM promote_next_assignment(v_old_ktv, v_a_assignment.business_date);
        END IF;
    ELSE
        v_segments := v_segments || jsonb_build_array(v_new_b);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET segments = v_segments,
        "technicianCodes" = array_append(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    INSERT INTO "KtvAssignments" (employee_id, business_date, booking_id, booking_item_id,
        segment_id, planned_start_time, planned_end_time, room_id, bed_id, status, dispatch_source)
    VALUES (p_to_ktv, v_a_assignment.business_date, p_booking_id, p_item_id, v_b_id,
        p_planned_start_at, v_end_at, v_a->>'roomId', v_a->>'bedId', 'ACTIVE', 'SEQUENTIAL_SLOT_B')
    ON CONFLICT (employee_id, booking_item_id) DO UPDATE SET
        segment_id = EXCLUDED.segment_id, planned_start_time = EXCLUDED.planned_start_time,
        planned_end_time = EXCLUDED.planned_end_time, status = 'ACTIVE',
        dispatch_source = EXCLUDED.dispatch_source;
    UPDATE "TurnQueue" SET status = 'assigned', current_order_id = p_booking_id,
        booking_item_id = p_item_id, booking_item_ids = ARRAY[p_item_id]::text[],
        room_id = v_a->>'roomId', bed_id = v_a->>'bedId',
        start_time = (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time = (v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date;
    INSERT INTO "TurnLedger" (date, booking_id, employee_id, source)
    SELECT v_a_assignment.business_date, COALESCE(parent_booking_id, id), p_to_ktv, 'DISPATCH_CONFIRM'
    FROM "Bookings" WHERE id = p_booking_id
    ON CONFLICT (date, booking_id, employee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'segmentId', v_b_id);
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_finish_sequential_after_a(p_booking_id text, p_item_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_date date;
BEGIN
    PERFORM 1 FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Dịch vụ đã thay đổi'; END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Không phải dịch vụ nối tiếp'; END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF COALESCE(v_a->>'actualStartTime', '') = '' OR COALESCE(v_a->>'actualEndTime', '') = ''
       OR COALESCE(v_b->>'actualStartTime', '') <> '' THEN
        RAISE EXCEPTION 'Chỉ kết thúc sau A khi A đã xong và B chưa bắt đầu';
    END IF;
    IF v_b IS NOT NULL THEN
        v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                              THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                       FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        SELECT business_date INTO v_date FROM "KtvAssignments"
        WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE'
        LIMIT 1 FOR UPDATE;
        UPDATE "KtvAssignments" SET status = 'CANCELLED'
        WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
        DELETE FROM "TurnLedger" tl USING "Bookings" booking
        WHERE booking.id = p_booking_id AND tl.date = v_date
          AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
          AND tl.employee_id = v_b->>'ktvId'
          AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                          JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                          WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                            AND ka.business_date = tl.date AND ka.employee_id = v_b->>'ktvId'
                            AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
        IF v_date IS NOT NULL THEN PERFORM promote_next_assignment(v_b->>'ktvId', v_date); END IF;
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET options = v_options || '{"finishedAfterA":true}'::jsonb,
        segments = v_segments, status = 'CLEANING', "timeEnd" = clock_timestamp(),
        "technicianCodes" = array_remove("technicianCodes", v_b->>'ktvId')
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    PERFORM dispatch_recompute_booking_status(p_booking_id);
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_apply_edit(p_booking_id text, p_action text, p_payload jsonb, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  edit jsonb;
  item_row "BookingItems"%ROWTYPE;
  result jsonb;
  item_updates jsonb := COALESCE(p_payload->'itemUpdates', '[]');
  opts jsonb;
  segment jsonb;
  old_segment jsonb;
  segment_list jsonb;
  plan_day date;
  plan_start timestamptz;
  normal_updates jsonb := '[]';
  live_ids text[] := ARRAY[]::text[];
  service_day date;
  guest_patch jsonb;
  guest_row "BookingGuests"%ROWTYPE;
  staff_id text;
  next_position integer;
  next_checkin integer;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH','ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A','EDIT_ACTUAL_TIME') THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  PERFORM 1 FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn; tải lại bảng'; END IF;
  IF p_action IN ('ENABLE_SEQUENTIAL','ASSIGN_B','FINISH_AFTER_A') THEN
    item_updates := jsonb_build_array(jsonb_build_object('id', p_payload->>'itemId',
      'options', jsonb_build_object('dispatchRevision', p_payload->'expectedRevision')));
  END IF;
  FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) ORDER BY value->>'id' LOOP
    SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dịch vụ không thuộc đơn; tải lại bảng'; END IF;
    IF COALESCE((jsonb_unwrap_string(item_row.options)->>'dispatchRevision')::bigint, 0)
       <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint, 0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Tải lại đơn trước khi chỉnh tiếp; bản cũ chưa được lưu.';
    END IF;
  END LOOP;
  -- All revision checks above must pass before guest/count/queue business writes.
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id = p_booking_id;
  IF service_day IS NULL THEN RAISE EXCEPTION 'Missing booking service day'; END IF;
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'date' AND NULLIF(p_payload->>'date','')::date IS DISTINCT FROM service_day THEN
      RAISE EXCEPTION 'Dispatch date differs from booking service day';
    END IF;
    p_payload := p_payload || jsonb_build_object('date',service_day);
    IF p_payload ? 'guestCount' THEN
      IF (p_payload->>'guestCount')::integer NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid guest count'; END IF;
      UPDATE "Bookings" SET "guestCount" = (p_payload->>'guestCount')::integer WHERE id = p_booking_id;
    END IF;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'newGuests','[]')) LOOP
      IF guest_patch->>'booking_id' IS DISTINCT FROM p_booking_id OR COALESCE(guest_patch->>'id','') = '' THEN
        RAISE EXCEPTION 'Invalid new guest';
      END IF;
      INSERT INTO "BookingGuests" (id,booking_id,guest_index,guest_label,status)
        VALUES (guest_patch->>'id',p_booking_id,(guest_patch->>'guest_index')::integer,guest_patch->>'guest_label','PENDING');
    END LOOP;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      IF edit ? 'guest_id' THEN
        IF NOT EXISTS (SELECT 1 FROM "BookingGuests" WHERE id = edit->>'guest_id' AND booking_id = p_booking_id) THEN
          RAISE EXCEPTION 'Guest does not belong to booking';
        END IF;
        UPDATE "BookingItems" SET guest_id = edit->>'guest_id' WHERE id = edit->>'id' AND "bookingId" = p_booking_id;
      END IF;
    END LOOP;
    FOR guest_patch IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'guestUpdates','[]')) LOOP
      SELECT * INTO guest_row FROM "BookingGuests" WHERE id = guest_patch->>'id' AND booking_id = p_booking_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Guest update target changed'; END IF;
      guest_patch := (guest_patch - 'id') ||
        CASE WHEN guest_patch ? 'bedId' THEN jsonb_build_object('bed_id',guest_patch->'bedId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'roomId' THEN jsonb_build_object('room_id',guest_patch->'roomId') ELSE '{}' END ||
        CASE WHEN guest_patch ? 'focusArea' THEN jsonb_build_object('focus_area',guest_patch->'focusArea') ELSE '{}' END;
      SELECT * INTO guest_row FROM jsonb_populate_record(guest_row,guest_patch - ARRAY['bedId','roomId','focusArea']);
      UPDATE "BookingGuests" SET bed_id = guest_row.bed_id, room_id = guest_row.room_id,
        status = guest_row.status, notes = guest_row.notes, focus_area = guest_row.focus_area WHERE id = guest_row.id;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND jsonb_array_length(COALESCE(p_payload->'turnStaffIds','[]')) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('TurnQueue-tail:' || service_day::text));
    SELECT COALESCE(max(queue_position),0),COALESCE(max(check_in_order),0) INTO next_position,next_checkin FROM "TurnQueue" WHERE date = service_day;
    FOR staff_id IN SELECT DISTINCT value FROM jsonb_array_elements_text(p_payload->'turnStaffIds') ORDER BY value LOOP
      next_position := next_position + 1; next_checkin := next_checkin + 1;
      INSERT INTO "TurnQueue" (employee_id,date,status,queue_position,check_in_order,turns_completed)
        VALUES (staff_id,service_day,'waiting',next_position,next_checkin,0) ON CONFLICT (employee_id,date) DO NOTHING;
    END LOOP;
  END IF;
  PERFORM set_config('app.dispatch_action', p_action, true);
  PERFORM set_config('app.dispatch_actor', COALESCE(p_actor, 'null')::text, true);
  IF p_action IN ('DRAFT','DISPATCH') THEN
    IF p_payload ? 'confirmedOverlapItemIds' AND jsonb_typeof(p_payload->'confirmedOverlapItemIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Danh sách xác nhận chồng giờ không hợp lệ';
    END IF;
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' = '2'
         AND item_row.status IN ('PREPARING','READY','IN_PROGRESS') THEN
        PERFORM dispatch_save_sequential_update(p_booking_id,edit,
          COALESCE(p_payload->'confirmedOverlapItemIds', '[]'::jsonb) ? item_row.id
          OR (jsonb_array_length(item_updates) = 1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false)));
        live_ids := array_append(live_ids,item_row.id);
      ELSE
        normal_updates := normal_updates || jsonb_build_array(edit);
      END IF;
    END LOOP;
  END IF;
  IF p_action = 'DISPATCH' AND cardinality(live_ids) > 0 AND jsonb_array_length(normal_updates) = 0 THEN
    result := '{"success":true}';
  ELSIF p_action = 'DISPATCH' THEN
    result := dispatch_confirm_booking(p_booking_id, (p_payload->>'date')::date,
      COALESCE(p_payload->>'status', 'PREPARING'), p_payload->>'technicianCode', p_payload->>'bedId',
      p_payload->>'roomName', p_payload->>'notes', COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(p_payload->'staffAssignments','[]'))
        WHERE NOT (value->>'bookingItemId' = ANY(live_ids))), '[]'), normal_updates);
    IF COALESCE((result->>'success')::boolean, false) = false THEN RAISE EXCEPTION '%', COALESCE(result->>'error', 'Điều phối chưa được lưu'); END IF;
  ELSIF p_action = 'EDIT_ACTUAL_TIME' THEN
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_array_length(edit->'segments') <> jsonb_array_length(jsonb_unwrap_string(item_row.segments))
         OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(edit->'segments')) <> jsonb_array_length(edit->'segments') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; tải lại đơn';
      END IF;
      FOR segment IN SELECT value FROM jsonb_array_elements(edit->'segments') LOOP
        SELECT value INTO old_segment FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments))
        WHERE value->>'id' = segment->>'id';
        IF old_segment IS NULL OR (old_segment - 'actualStartTime' - 'actualEndTime')
           IS DISTINCT FROM (segment - 'actualStartTime' - 'actualEndTime')
           OR (old_segment->>'voided' = 'true' AND old_segment IS DISTINCT FROM segment)
           OR (COALESCE(old_segment->>'actualStartTime', '') <> '' AND COALESCE(segment->>'actualStartTime', '') = '')
           OR (COALESCE(old_segment->>'actualEndTime', '') <> '' AND COALESCE(segment->>'actualEndTime', '') = '') THEN
          RAISE EXCEPTION 'Chỉ chỉnh giờ thực tế, không xóa mốc hoặc đổi chặng đã lưu';
        END IF;
        IF COALESCE(segment->>'actualEndTime', '') <> '' AND
           (COALESCE(segment->>'actualStartTime', '') = '' OR
            (segment->>'actualEndTime')::timestamptz < (segment->>'actualStartTime')::timestamptz) THEN
          RAISE EXCEPTION 'Giờ kết thúc phải sau giờ bắt đầu';
        END IF;
      END LOOP;
      -- The payload now matches the locked row apart from validated actual stamps.
      PERFORM set_config('app.sequential_rpc', '1', true);
      UPDATE "BookingItems" SET segments = edit->'segments' WHERE id = edit->>'id';
      PERFORM set_config('app.sequential_rpc', '', true);
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'DRAFT' THEN
    UPDATE "Bookings" SET "technicianCode" = CASE WHEN p_payload ? 'technicianCode' THEN p_payload->>'technicianCode' ELSE "technicianCode" END,
      "bedId" = p_payload->>'bedId', "roomName" = p_payload->>'roomName',
      notes = p_payload->>'notes', "updatedAt" = clock_timestamp() WHERE id = p_booking_id;
    FOR edit IN SELECT value FROM jsonb_array_elements(normal_updates) LOOP
      SELECT COALESCE(jsonb_unwrap_string(options), '{}') INTO opts FROM "BookingItems" WHERE id = edit->>'id';
      segment_list := COALESCE(edit->'segments', (SELECT segments FROM "BookingItems" WHERE id = edit->>'id'));
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          SELECT value INTO old_segment FROM "BookingItems" bi, jsonb_array_elements(COALESCE(bi.segments, '[]'))
          WHERE bi.id = edit->>'id' AND value->>'id' = segment->>'id' LIMIT 1;
          IF COALESCE(segment->>'startTime', '') <> '' AND COALESCE(segment->>'duration', '') <> ''
             AND COALESCE(segment->>'actualStartTime', '') = ''
             AND (old_segment->'startTime' IS DISTINCT FROM segment->'startTime'
                  OR old_segment->'duration' IS DISTINCT FROM segment->'duration'
                  OR old_segment->'endTime' IS DISTINCT FROM segment->'endTime') THEN
            SELECT COALESCE(NULLIF(p_payload->>'date', '')::date,
              (NULLIF(old_segment->>'plannedStartAt', '')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
              (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = edit->>'id'
               AND segment_id = segment->>'id' LIMIT 1)) INTO plan_day;
            IF plan_day IS NOT NULL THEN
              plan_start := (plan_day + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
              segment_list := (SELECT jsonb_agg(CASE WHEN value->>'id' = segment->>'id' THEN value ||
                jsonb_build_object('plannedStartAt', plan_start, 'plannedEndAt',
                  plan_start + make_interval(mins => (segment->>'duration')::integer)) ELSE value END ORDER BY ord)
                FROM jsonb_array_elements(segment_list) WITH ORDINALITY a(value, ord));
            END IF;
          END IF;
        END LOOP;
      END IF;
      UPDATE "BookingItems" SET "roomName" = edit->>'roomName', "bedId" = edit->>'bedId',
        "technicianCodes" = ARRAY(SELECT jsonb_array_elements_text(COALESCE(edit->'technicianCodes', '[]'))),
        segments = segment_list, options = opts || COALESCE(jsonb_unwrap_string(edit->'options'), '{}'),
        guest_id = CASE WHEN edit ? 'guest_id' THEN edit->>'guest_id' ELSE guest_id END
      WHERE id = edit->>'id';
      IF opts->>'sequentialSlots' IS DISTINCT FROM '2' AND jsonb_unwrap_string(edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
         AND COALESCE(jsonb_unwrap_string(edit->'options')->>'mergedIntoId', '') = '' THEN
        FOR segment IN SELECT value FROM jsonb_array_elements(segment_list) LOOP
          IF COALESCE(segment->>'ktvId', '') <> '' AND COALESCE(segment->>'startTime', '') <> '' THEN
            UPDATE "KtvAssignments" SET
              planned_start_time = (business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh',
              planned_end_time = ((business_date + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                + make_interval(mins => (segment->>'duration')::integer)
            WHERE booking_id = p_booking_id AND booking_item_id = edit->>'id'
              AND segment_id = segment->>'id' AND status IN ('ACTIVE','QUEUED','READY')
              AND COALESCE(segment->>'actualStartTime', '') = '';
            UPDATE "TurnQueue" SET start_time = (segment->>'startTime')::time,
              estimated_end_time = COALESCE(NULLIF(segment->>'endTime', '')::time, estimated_end_time)
            WHERE employee_id = segment->>'ktvId' AND current_order_id = p_booking_id AND status = 'assigned';
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    result := '{"success":true}';
  ELSIF p_action = 'ENABLE_SEQUENTIAL' THEN
    result := dispatch_enable_sequential_item(p_booking_id, p_payload->>'itemId');
  ELSIF p_action = 'ASSIGN_B' THEN
    IF p_payload ? 'metadata' AND (jsonb_typeof(p_payload->'metadata') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'serviceNamesForKtvs') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_payload->'metadata'->'notesForKtvs') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM (
                    SELECT value FROM jsonb_each(p_payload->'metadata'->'serviceNamesForKtvs')
                    UNION ALL SELECT value FROM jsonb_each(p_payload->'metadata'->'notesForKtvs')) entries
                  WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')) THEN
      RAISE EXCEPTION 'Tên/ghi chú B không hợp lệ';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id, p_payload->>'itemId', p_payload->>'toKtvId',
      (p_payload->>'plannedStartAt')::timestamptz, (p_payload->>'durationMinutes')::integer,
      COALESCE((p_payload->>'confirmOverlap')::boolean, false));
    IF COALESCE((result->>'success')::boolean, false) AND p_payload ? 'metadata' THEN
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options), '{}') ||
        jsonb_build_object('serviceNamesForKtvs', p_payload->'metadata'->'serviceNamesForKtvs',
                          'notesForKtvs', p_payload->'metadata'->'notesForKtvs')
      WHERE id = p_payload->>'itemId' AND "bookingId" = p_booking_id;
    END IF;
  ELSE
    result := dispatch_finish_sequential_after_a(p_booking_id, p_payload->>'itemId');
  END IF;
  PERFORM set_config('app.dispatch_action', '', true);
  PERFORM set_config('app.dispatch_actor', '', true);
  RETURN result || jsonb_build_object('revisions', (SELECT jsonb_object_agg(id,
    COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint, 0)) FROM "BookingItems"
    WHERE "bookingId" = p_booking_id AND id IN (SELECT value->>'id' FROM jsonb_array_elements(item_updates))));
END;
$$;
REVOKE ALL ON FUNCTION dispatch_recompute_booking_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_recompute_booking_status(text) TO service_role;
REVOKE ALL ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb) TO service_role;
REVOKE ALL ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) TO service_role;
