-- A later QUEUED order may be dispatched while the KTV is still serving.
-- Only simultaneously ACTIVE plans reserve a staff member's clock.
ALTER TABLE "KtvAssignments" DROP CONSTRAINT ktv_assignments_no_live_overlap;
ALTER TABLE "KtvAssignments" ADD CONSTRAINT ktv_assignments_no_live_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(planned_start_time,GREATEST(planned_start_time,planned_end_time),'[)') WITH &&
  ) WHERE (status='ACTIVE' AND planned_start_time IS NOT NULL AND planned_end_time IS NOT NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_a(
  p_booking_id text,p_item_id text,p_expected_revision bigint,p_minutes integer,p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE; opts jsonb; segs jsonb; a jsonb;
  service_minutes integer; service_day date; starts_at timestamptz; ends_at timestamptz;
  previous_rpc text; previous_action text; previous_actor text;
BEGIN
  IF p_minutes IS NULL OR p_minutes NOT BETWEEN 1 AND 600 OR p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Thời lượng phải từ 1 đến 600 phút';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF item.status::text NOT IN ('IN_PROGRESS','PAUSED')
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi sửa thời lượng';
  END IF;
  SELECT value INTO a FROM jsonb_array_elements(segs)
    WHERE (opts->>'sequentialSlots' IS DISTINCT FROM '2' OR value->>'sequenceSlot'='1')
      AND COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'actualStartTime','')<>''
      AND COALESCE(value->>'actualEndTime','')='';
  IF a IS NULL OR COALESCE(a->>'actualStartTime','')='' OR COALESCE(a->>'actualEndTime','')<>''
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(segs) s WHERE s->>'id' IS DISTINCT FROM a->>'id'
      AND (COALESCE(s->>'voided','false')<>'true' OR COALESCE(s->>'actualStartTime','')<>'')) THEN
    RAISE EXCEPTION 'Chỉ được sửa thời lượng ca đang làm khi không có ca khác cùng dịch vụ';
  END IF;
  SELECT duration INTO service_minutes FROM "Services" WHERE id=item."serviceId";
  service_minutes:=COALESCE(NULLIF((opts->>'vipDuration')::integer,0),NULLIF((opts->>'duration')::integer,0),service_minutes);
  IF service_minutes IS NULL OR service_minutes<1 THEN RAISE EXCEPTION 'Không xác định được thời lượng dịch vụ'; END IF;
  IF opts->>'sequentialSlots'='2' AND COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb AND p_minutes<service_minutes THEN
    RAISE EXCEPTION 'Lượt B đã đóng; không thể giảm A xuống dưới thời lượng dịch vụ';
  END IF;
  starts_at:=(a->>'actualStartTime')::timestamptz;
  ends_at:=starts_at+make_interval(mins=>p_minutes);
  IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status='ACTIVE'
    AND (ka.employee_id=a->>'ktvId' OR (ka.room_id=a->>'roomId' AND ka.bed_id=a->>'bedId'))
    AND ka.planned_start_time<ends_at AND ka.planned_end_time>starts_at) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng với giờ mới';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
    AND ka.employee_id=a->>'ktvId' AND (ka.segment_id=a->>'id' OR ka.segment_id IS NULL)
    AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Không tìm thấy phân công đang làm của A';
  END IF;
  segs:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  IF opts->>'sequentialSlots'='2' AND p_minutes>=service_minutes
    AND NOT COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb THEN
    opts:=jsonb_set(opts,'{closedSequentialSlots}',COALESCE(opts->'closedSequentialSlots','[]')||'[2]'::jsonb,true);
  END IF;
  previous_rpc:=current_setting('app.sequential_rpc',true);
  previous_action:=current_setting('app.dispatch_action',true);
  previous_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_A_DURATION',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(previous_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(previous_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(previous_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=starts_at,planned_end_time=ends_at,updated_at=clock_timestamp()
    WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=a->>'ktvId'
      AND (segment_id=a->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id=a->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('employeeId',a->>'ktvId','minutes',p_minutes,
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'closedB',COALESCE(jsonb_unwrap_string(saved.options)->'closedSequentialSlots','[]') @> '[2]'::jsonb,
    'segments',jsonb_unwrap_string(saved.segments),'options',jsonb_unwrap_string(saved.options));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_a(text,text,bigint,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_pair(
  p_booking_id text, p_item_id text, p_expected_revision bigint,
  p_a_minutes integer, p_b_start text, p_b_minutes integer, p_metadata jsonb, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE;
  opts jsonb; segs jsonb; a jsonb; b jsonb;
  service_day date; a_start timestamptz; a_end timestamptz;
  b_start timestamptz; b_end timestamptz; old_action text; old_actor text; old_rpc text;
BEGIN
  IF p_expected_revision IS NULL OR p_a_minutes NOT BETWEEN 1 AND 600
    OR p_b_minutes NOT BETWEEN 1 AND 600
    OR p_b_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  segs:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  SELECT value INTO a FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
  SELECT value INTO b FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
  IF item.status::text NOT IN ('IN_PROGRESS','PAUSED') OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision
    OR a IS NULL OR b IS NULL OR COALESCE(a->>'actualStartTime','')=''
    OR COALESCE(a->>'actualEndTime','')<>'' OR COALESCE(b->>'actualStartTime','')<>''
    OR a->>'roomId' IS DISTINCT FROM b->>'roomId' OR a->>'bedId' IS DISTINCT FROM b->>'bedId' THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại trước khi sửa A/B';
  END IF;
  a_start:=(a->>'actualStartTime')::timestamptz;
  a_end:=a_start+make_interval(mins=>p_a_minutes);
  b_start:=(service_day+p_b_start::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  IF b_start<a_start THEN b_start:=b_start+interval '1 day'; END IF;
  b_end:=b_start+make_interval(mins=>p_b_minutes);
  -- B may start after A starts, even while A is still serving.
  IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status='ACTIVE'
    AND ((ka.employee_id=a->>'ktvId' AND ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
      OR (ka.employee_id=b->>'ktvId' AND ka.planned_start_time<b_end AND ka.planned_end_time>b_start)
      OR (ka.bed_id=b->>'bedId' AND ka.room_id=b->>'roomId'
        AND ((ka.planned_start_time<a_end AND ka.planned_end_time>a_start)
          OR (ka.planned_start_time<b_end AND ka.planned_end_time>b_start))))) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng giờ';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=a->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY'))
    OR NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id=p_item_id
      AND ka.employee_id=b->>'ktvId' AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Thiếu phân công A/B';
  END IF;
  segs:=(SELECT jsonb_agg(CASE
    WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(a_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(a_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_a_minutes,'plannedStartAt',a_start,'plannedEndAt',a_end)
    WHEN value->>'id'=b->>'id' THEN value||jsonb_build_object(
      'startTime',to_char(b_start AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'endTime',to_char(b_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
      'duration',p_b_minutes,'plannedStartAt',b_start,'plannedEndAt',b_end)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  old_rpc:=current_setting('app.sequential_rpc',true);
  old_action:=current_setting('app.dispatch_action',true);
  old_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_SEQUENTIAL_PAIR',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=segs,options=opts||COALESCE(p_metadata,'{}') WHERE id=p_item_id RETURNING * INTO saved;
  PERFORM set_config('app.sequential_rpc',COALESCE(old_rpc,''),true);
  PERFORM set_config('app.dispatch_action',COALESCE(old_action,''),true);
  PERFORM set_config('app.dispatch_actor',COALESCE(old_actor,''),true);
  UPDATE "KtvAssignments" SET planned_start_time=a_start,planned_end_time=a_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=a->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "KtvAssignments" SET planned_start_time=b_start,planned_end_time=b_end,updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND employee_id=b->>'ktvId' AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id IN (a->>'ktvId',b->>'ktvId') AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('success',true,'revision',jsonb_unwrap_string(saved.options)->'dispatchRevision',
    'savedItem',jsonb_build_object('id',saved.id,'status',saved.status,'segments',jsonb_unwrap_string(saved.segments),
      'options',jsonb_unwrap_string(saved.options),'roomName',saved."roomName",'bedId',saved."bedId"));
END $$;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb) TO service_role;

-- Permit the paused item through the same locked dispatch path as a running item.
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
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS', 'PAUSED') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND (COALESCE(value->>'voided', 'false') <> 'true'
      OR (COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb AND value->>'note'='CANCELLED_NO_CREDIT'))
    ORDER BY COALESCE(value->>'voided','false')='true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR (COALESCE(v_options->>'finishedAfterA', 'false') = 'true' OR COALESCE(v_options->'closedSequentialSlots','[]') @> '[2]'::jsonb)
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND (status IN ('ACTIVE', 'COMPLETED')
        OR (status='CANCELLED' AND COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb))
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

-- Permit the paused item through the same locked dispatch path as a running item.
CREATE OR REPLACE FUNCTION dispatch_save_sequential_update(p_booking_id text, p_edit jsonb, p_confirm_overlap boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item_row "BookingItems"%ROWTYPE;
  opts jsonb;
  old_segments jsonb;
  incoming_segments jsonb := jsonb_unwrap_string(p_edit->'segments');
  old_segment jsonb;
  incoming jsonb;
  a jsonb;
  next_a jsonb;
  a_changed boolean := false;
  b jsonb;
  next_b jsonb;
  field_name text;
  plan_start timestamptz;
  plan_day date;
  result jsonb;
BEGIN
  SELECT * INTO item_row FROM "BookingItems" WHERE id = p_edit->>'id' AND "bookingId" = p_booking_id FOR UPDATE;
  opts := COALESCE(jsonb_unwrap_string(item_row.options), '{}');
  old_segments := COALESCE(jsonb_unwrap_string(item_row.segments), '[]');
  IF NOT FOUND OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
     OR item_row.status NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED')
     OR jsonb_unwrap_string(p_edit->'options')->>'sequentialSlots' IS DISTINCT FROM '2'
     OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> COALESCE((jsonb_unwrap_string(p_edit->'options')->>'dispatchRevision')::bigint,0)
     OR jsonb_typeof(incoming_segments) <> 'array' OR jsonb_array_length(old_segments) <> jsonb_array_length(incoming_segments) THEN
    RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn trước khi cập nhật B';
  END IF;
  FOR old_segment IN SELECT value FROM jsonb_array_elements(old_segments) LOOP
    SELECT value INTO incoming FROM jsonb_array_elements(incoming_segments) WHERE value->>'id' = old_segment->>'id';
    IF incoming IS NULL THEN RAISE EXCEPTION 'Không được xóa chặng đã điều phối'; END IF;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) LOOP
      IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
        RAISE EXCEPTION 'Chặng đã thay đổi; dùng thao tác đổi B riêng';
      END IF;
    END LOOP;
    IF old_segment->>'sequenceSlot' = '1' AND COALESCE(old_segment->>'voided','false') <> 'true'
       AND COALESCE(old_segment->>'actualStartTime','') = '' AND COALESCE(old_segment->>'actualEndTime','') = '' THEN
      a := old_segment; next_a := incoming;
    ELSIF old_segment->>'sequenceSlot' = '2' AND COALESCE(old_segment->>'voided','false') <> 'true' THEN
      b := old_segment; next_b := incoming;
    ELSE
      FOR field_name IN SELECT unnest(ARRAY['startTime','endTime','duration','plannedStartAt','plannedEndAt']) LOOP
        IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
          RAISE EXCEPTION 'Không đổi kế hoạch A hoặc chặng cũ khi cập nhật B';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  a_changed := a IS NOT NULL AND (a->'startTime' IS DISTINCT FROM next_a->'startTime'
    OR a->'endTime' IS DISTINCT FROM next_a->'endTime' OR a->'duration' IS DISTINCT FROM next_a->'duration');
  IF a_changed THEN
    IF COALESCE(b->>'actualStartTime','') <> '' THEN RAISE EXCEPTION 'B đã bắt đầu; không sửa kế hoạch A'; END IF;
    IF COALESCE((next_a->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Phút A không hợp lệ'; END IF;
    SELECT "bookingDate"::date INTO plan_day FROM "Bookings" WHERE id=p_booking_id;
    plan_start := (plan_day + (next_a->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF next_a->>'endTime' IS DISTINCT FROM to_char((plan_start + make_interval(mins => (next_a->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN
      RAISE EXCEPTION 'Giờ kết thúc A không khớp thời lượng';
    END IF;
    IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=a->>'ktvId' AND ka.status='ACTIVE'
      AND ka.booking_item_id<>item_row.id AND ka.planned_start_time<plan_start+make_interval(mins=>(next_a->>'duration')::integer)
      AND ka.planned_end_time>plan_start) THEN RAISE EXCEPTION 'A đang có phân công chồng giờ'; END IF;
    next_a := next_a || jsonb_build_object('plannedStartAt',plan_start,'plannedEndAt',plan_start+make_interval(mins=>(next_a->>'duration')::integer));
    PERFORM set_config('app.sequential_rpc','1',true);
    UPDATE "BookingItems" SET segments=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN next_a ELSE value END ORDER BY ord)
      FROM jsonb_array_elements(jsonb_unwrap_string(segments)) WITH ORDINALITY r(value,ord)) WHERE id=item_row.id;
    PERFORM set_config('app.sequential_rpc','',true);
    UPDATE "KtvAssignments" SET planned_start_time=plan_start,planned_end_time=plan_start+make_interval(mins=>(next_a->>'duration')::integer),updated_at=clock_timestamp()
      WHERE booking_id=p_booking_id AND booking_item_id=item_row.id AND segment_id=a->>'id' AND status IN ('ACTIVE','QUEUED','READY');
    IF NOT FOUND THEN RAISE EXCEPTION 'Phân công A đã thay đổi'; END IF;
    UPDATE "TurnQueue" SET start_time=(plan_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
      estimated_end_time=((plan_start+make_interval(mins=>(next_a->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
      WHERE employee_id=a->>'ktvId' AND date=plan_day AND current_order_id=p_booking_id AND booking_item_id=item_row.id;
  END IF;
  IF b IS NOT NULL AND (b->'startTime' IS DISTINCT FROM next_b->'startTime'
      OR b->'endTime' IS DISTINCT FROM next_b->'endTime' OR b->'duration' IS DISTINCT FROM next_b->'duration' OR a_changed) THEN
    IF COALESCE(b->>'actualStartTime','') <> '' THEN RAISE EXCEPTION 'B đã bắt đầu; không sửa giờ dự kiến'; END IF;
    IF COALESCE(next_b->>'startTime','') = '' OR COALESCE((next_b->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'Giờ/phút B không hợp lệ';
    END IF;
    IF abs(extract(epoch FROM ((next_b->>'startTime')::time - (b->>'startTime')::time))) >= 43200 THEN
      RAISE EXCEPTION 'Giờ B có thể chuyển ngày; dùng Sửa B để chọn ngày/giờ đầy đủ';
    END IF;
    SELECT COALESCE((NULLIF(b->>'plannedStartAt','')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
      (SELECT business_date FROM "KtvAssignments" WHERE booking_item_id = item_row.id AND segment_id = b->>'id' LIMIT 1)) INTO plan_day;
    IF plan_day IS NULL THEN RAISE EXCEPTION 'Thiếu ngày phân công B; tải lại đơn'; END IF;
    plan_start := (plan_day + (next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF next_b->>'endTime' IS DISTINCT FROM to_char((plan_start + make_interval(mins => (next_b->>'duration')::integer)) AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN
      RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
    END IF;
    result := dispatch_assign_sequential_slot_b(p_booking_id,item_row.id,b->>'ktvId',plan_start,
      (next_b->>'duration')::integer,p_confirm_overlap);
    IF result->>'code' = 'OVERLAP_CONFIRM_REQUIRED' THEN
      RAISE EXCEPTION USING MESSAGE = 'OVERLAP_CONFIRM_REQUIRED', DETAIL = (result || jsonb_build_object('itemId', item_row.id))::text;
    END IF;
    IF COALESCE((result->>'success')::boolean,false) = false THEN RAISE EXCEPTION 'Chưa cập nhật được kế hoạch B'; END IF;
  END IF;
  -- Read options again: the planned-time RPC may already have appended an audit entry.
  UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}') || COALESCE(jsonb_unwrap_string(p_edit->'options'),'{}')
  WHERE id = item_row.id;
  RETURN '{"success":true}';
END;
$$;

-- Permit the paused item through the same locked dispatch path as a running item.
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
         AND item_row.status IN ('PREPARING','READY','IN_PROGRESS','PAUSED') THEN
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
    -- A/B minutes come from the persisted slot, even if a caller submitted the catalogue end clock.
    FOR edit IN SELECT value FROM jsonb_array_elements(normal_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' IS DISTINCT FROM '2' THEN CONTINUE; END IF;
      FOR segment IN SELECT value FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments)) LOOP
        IF COALESCE(segment->>'voided','false')='true' OR COALESCE(segment->>'ktvId','')='' THEN CONTINUE; END IF;
        plan_start := COALESCE(NULLIF(segment->>'plannedStartAt','')::timestamptz,
          (service_day + (segment->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
        IF COALESCE(segment->>'plannedStartAt','')='' AND segment->>'sequenceSlot'='2'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(jsonb_unwrap_string(item_row.segments)) first_slot
            WHERE first_slot->>'sequenceSlot'='1' AND COALESCE(first_slot->>'voided','false') <> 'true'
              AND (segment->>'startTime')::time < (first_slot->>'startTime')::time) THEN
          plan_start := plan_start + interval '1 day';
        END IF;
        UPDATE "KtvAssignments" SET planned_start_time=plan_start,
          planned_end_time=plan_start + make_interval(mins => (segment->>'duration')::integer),
          segment_id=segment->>'id',updated_at=clock_timestamp()
          WHERE booking_id=p_booking_id AND booking_item_id=item_row.id AND employee_id=segment->>'ktvId'
            AND status IN ('ACTIVE','QUEUED','READY');
        UPDATE "TurnQueue" t SET (start_time,estimated_end_time) = (
          SELECT (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
            (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
          FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=service_day
            AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY')
            AND ka.booking_item_id=ANY(COALESCE(t.booking_item_ids,ARRAY[]::text[]) || ARRAY[t.booking_item_id]))
          WHERE t.employee_id=segment->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id
            AND t.status='assigned';
      END LOOP;
    END LOOP;
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

-- Permit the paused item through the same locked dispatch path as a running item.
CREATE OR REPLACE FUNCTION dispatch_commit_form_base(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb; desired jsonb; old jsonb;
  seg jsonb; incoming jsonb; plans jsonb; next_b jsonb; old_b jsonb;
  revision bigint; result jsonb; updates jsonb := '[]'; removed text;
  confirm_overlap boolean; service_day date; start_at timestamptz;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH') OR jsonb_typeof(COALESCE(p_payload->'itemUpdates','[]')) <> 'array' THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')))
    <> jsonb_array_length(COALESCE(p_payload->'itemUpdates','[]')) THEN RAISE EXCEPTION 'Trùng dịch vụ trong bản lưu'; END IF;
  -- Lock and check every revision before the first removal, enable, or assignment.
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) ORDER BY value->>'id' LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id FOR UPDATE;
    IF NOT FOUND OR COALESCE((jsonb_unwrap_string(item.options)->>'dispatchRevision')::bigint,0)
      <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Bản đang sửa chưa được lưu; tải lại và kiểm tra.';
    END IF;
  END LOOP;
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id';
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    desired:=COALESCE(jsonb_unwrap_string(edit->'segments'),old);
    IF jsonb_typeof(desired)<>'array' OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(desired))<>jsonb_array_length(desired) THEN
      RAISE EXCEPTION 'Danh sách chặng không hợp lệ';
    END IF;
    FOR incoming IN SELECT value FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' LOOP
      IF COALESCE(incoming->>'id','')='' OR COALESCE(incoming->>'ktvId','')=''
        OR COALESCE(incoming->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR COALESCE((incoming->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ'; END IF;
    END LOOP;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND
      ((SELECT count(DISTINCT value->>'sequenceSlot') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
      OR (EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true'))
      OR (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'sequenceSlot','') NOT IN ('1','2'))
      OR (SELECT count(DISTINCT value->>'ktvId') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')) THEN
      RAISE EXCEPTION 'Nối tiếp cần A và tối đa một B khác nhân viên';
    END IF;
    -- Actual work is immutable even if a client omits it from the form.
    FOR seg IN SELECT value FROM jsonb_array_elements(old) WHERE COALESCE(value->>'voided','false')<>'true'
      AND (COALESCE(value->>'actualStartTime','')<>'' OR COALESCE(value->>'actualEndTime','')<>'') LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['ktvId','roomId','bedId','startTime','endTime','duration','actualStartTime','actualEndTime']) k
        WHERE COALESCE(incoming->>k,'') IS DISTINCT FROM COALESCE(seg->>k,'')) THEN
        RAISE EXCEPTION 'Nhân viên đã bắt đầu; dùng Dừng/Đổi để giữ giờ thực tế';
      END IF;
    END LOOP;
    IF item.status NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED') THEN
      IF p_action='DISPATCH' AND item.status IN ('NEW','WAITING') AND EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') THEN
        edit:=edit||jsonb_build_object('status','PREPARING');
      END IF;
      updates:=updates||jsonb_build_array(edit); CONTINUE;
    END IF;
    confirm_overlap:=COALESCE(p_payload->'confirmedOverlapItemIds','[]') ? item.id
      OR (jsonb_array_length(p_payload->'itemUpdates')=1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false));
    revision:=COALESCE((opts->>'dispatchRevision')::bigint,0);
    FOR removed IN SELECT DISTINCT value->>'ktvId' FROM jsonb_array_elements(old) oldseg
      WHERE COALESCE(value->>'voided','false')<>'true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n
        WHERE n->>'ktvId'=oldseg.value->>'ktvId' AND COALESCE(n->>'voided','false')<>'true') LOOP
      result:=dispatch_unassign_unstarted_staff(p_booking_id,item.id,removed,revision,p_actor);
      revision:=(result->>'revision')::bigint;
    END LOOP;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}'); old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    next_b:=NULL;
    SELECT value INTO next_b FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    SELECT value INTO old_b FROM jsonb_array_elements(old) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    -- New employees can only enter a live form as an unstarted sequential B.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n WHERE COALESCE(n->>'voided','false')<>'true'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old) s WHERE s->>'id'=n->>'id' AND s->>'ktvId'=n->>'ktvId' AND COALESCE(s->>'voided','false')<>'true')
      AND NOT (jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND n->>'sequenceSlot'='2' AND old_b IS NULL)) THEN
      RAISE EXCEPTION 'Ca đã điều phối; nhân viên mới chỉ được gán vào lượt B chưa bắt đầu';
    END IF;
    -- Build the old shape for the shared DRAFT updater; historical work is copied from DB.
    plans:='[]';
    FOR seg IN SELECT value FROM jsonb_array_elements(old) LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND value->>'ktvId'=seg->>'ktvId' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NOT NULL AND COALESCE(seg->>'voided','false')<>'true' AND COALESCE(seg->>'actualStartTime','')='' AND COALESCE(seg->>'actualEndTime','')='' THEN
        seg:=seg||jsonb_build_object('startTime',incoming->'startTime','endTime',incoming->'endTime','duration',incoming->'duration');
      END IF;
      plans:=plans||jsonb_build_array(seg);
    END LOOP;
    incoming:=edit||jsonb_build_object('segments',plans,'options',COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||
      jsonb_build_object('dispatchRevision',revision,'sequentialSlots',opts->'sequentialSlots'));
    result:=dispatch_apply_edit(p_booking_id,'DRAFT',p_payload||jsonb_build_object('newGuests','[]'::jsonb,'guestUpdates','[]'::jsonb,
      'itemUpdates',jsonb_build_array(incoming - 'guest_id'),'confirmOverlap',confirm_overlap),p_actor);
    revision:=(result->'revisions'->>item.id)::bigint;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
      result:=dispatch_apply_edit(p_booking_id,'ENABLE_SEQUENTIAL',jsonb_build_object('itemId',item.id,'expectedRevision',revision),p_actor);
      revision:=(result->'revisions'->>item.id)::bigint;
    END IF;
    IF next_b IS NOT NULL AND old_b IS NULL THEN
      SELECT value INTO seg FROM "BookingItems" bi,jsonb_array_elements(jsonb_unwrap_string(bi.segments)) WHERE bi.id=item.id AND value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
      IF seg IS NULL OR COALESCE(next_b->>'roomId','') IS DISTINCT FROM COALESCE(seg->>'roomId','') OR COALESCE(next_b->>'bedId','') IS DISTINCT FROM COALESCE(seg->>'bedId','') THEN
        RAISE EXCEPTION 'Lượt B cần cùng phòng và giường với A';
      END IF;
      start_at:=COALESCE(NULLIF(next_b->>'plannedStartAt','')::timestamptz,(service_day+(next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF COALESCE(next_b->>'plannedStartAt','')='' AND next_b->>'startTime'<seg->>'startTime' THEN start_at:=start_at+interval '1 day'; END IF;
      result:=dispatch_apply_edit(p_booking_id,'ASSIGN_B',jsonb_build_object('itemId',item.id,'expectedRevision',revision,'toKtvId',next_b->>'ktvId',
        'plannedStartAt',start_at,'durationMinutes',(next_b->>'duration')::integer,'confirmOverlap',confirm_overlap),p_actor);
      IF result->>'code'='OVERLAP_CONFIRM_REQUIRED' THEN RAISE EXCEPTION USING MESSAGE='OVERLAP_CONFIRM_REQUIRED',DETAIL=(result||jsonb_build_object('itemId',item.id))::text; END IF;
      IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Không gán được B'; END IF;
    END IF;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    -- The final common call applies guest changes and metadata with the acknowledged revision.
    updates:=updates||jsonb_build_array(edit||jsonb_build_object('segments',jsonb_unwrap_string(item.segments),
      'technicianCodes',to_jsonb(item."technicianCodes"),'status',item.status,'options',jsonb_unwrap_string(item.options)||
      (COALESCE(jsonb_unwrap_string(edit->'options'),'{}')-'dispatchRevision')||jsonb_build_object('dispatchRevision',jsonb_unwrap_string(item.options)->'dispatchRevision')));
  END LOOP;
  result:=dispatch_apply_edit(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',updates),p_actor);
  IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Chưa lưu được phân công'; END IF;
  RETURN result||jsonb_build_object('savedItems',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',bi.id,'status',bi.status,
    'segments',jsonb_unwrap_string(bi.segments),'options',jsonb_unwrap_string(bi.options),'roomName',bi."roomName",'bedId',bi."bedId") ORDER BY bi.id)
    FROM "BookingItems" bi WHERE bi."bookingId"=p_booking_id AND bi.id IN(SELECT value->>'id' FROM jsonb_array_elements(updates))),'[]'));
END $$;
