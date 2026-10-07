-- Scope lifecycle changes to selected A/B slots; audit/queue/status commit together.
CREATE OR REPLACE FUNCTION dispatch_sequential_lifecycle_atomic(
  p_booking_id text, p_item_id text, p_expected jsonb, p_patch jsonb,
  p_action text, p_actor jsonb, p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b "Bookings"%ROWTYPE; item "BookingItems"%ROWTYPE; patched "BookingItems"%ROWTYPE;
  old_segments jsonb; new_segments jsonb; old_seg jsonb; seg jsonb; field text;
  service_day date; family_id text; employee text; assigned timestamptz;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('PAUSE','RESUME','FINISH','CANCEL','SWAP') OR p_expected_revision IS NULL
     OR NOT p_patch ?& ARRAY['segments','options','status','pauseStart','timeEnd','technicianCodes']
     OR jsonb_typeof(p_patch->'segments') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_patch->'options') IS DISTINCT FROM 'object'
     OR (p_patch - ARRAY['segments','options','status','pauseStart','timeEnd','technicianCodes']) <> '{}' THEN
    RAISE EXCEPTION 'Invalid scoped lifecycle request';
  END IF;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'Booking changed; reload'; END IF;
  PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
  SELECT * INTO item FROM "BookingItems" WHERE id = p_item_id AND "bookingId" = p_booking_id;
  IF NOT FOUND OR jsonb_unwrap_string(item.options)->>'sequentialSlots' IS DISTINCT FROM '2'
     OR (item.status::text NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED') AND NOT (p_action='CANCEL' AND item.status::text IN ('CLEANING','FEEDBACK')))
     OR COALESCE((jsonb_unwrap_string(item.options)->>'dispatchRevision')::bigint,0) <> p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã có bản lưu mới hoặc đã đóng; tải lại đơn';
  END IF;
  IF NOT p_expected ?& ARRAY['id','bookingId','status','segments','options','pauseStart','timeEnd','technicianCodes'] THEN
    RAISE EXCEPTION 'Incomplete lifecycle snapshot';
  END IF;
  FOR field IN SELECT jsonb_object_keys(p_expected) LOOP
    IF (CASE WHEN field IN ('pauseStart','timeEnd')
      THEN (to_jsonb(item)->>field)::timestamptz IS DISTINCT FROM (p_expected->>field)::timestamptz
      ELSE to_jsonb(item)->field IS DISTINCT FROM p_expected->field END) THEN
      RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi thao tác';
    END IF;
  END LOOP;
  service_day := b."bookingDate"::date;
  family_id := COALESCE(b.parent_booking_id,b.id);
  IF service_day IS NULL THEN RAISE EXCEPTION 'Missing booking service day'; END IF;
  old_segments := jsonb_unwrap_string(item.segments);
  new_segments := p_patch->'segments';
  -- No stale operation may rewrite another employee's recorded start/end.
  FOR old_seg IN SELECT value FROM jsonb_array_elements(old_segments) LOOP
    SELECT value INTO seg FROM jsonb_array_elements(new_segments) WHERE value->>'id' = old_seg->>'id';
    IF seg IS NULL OR (COALESCE(old_seg->>'actualStartTime','') <> '' AND seg->'actualStartTime' IS DISTINCT FROM old_seg->'actualStartTime')
       OR (COALESCE(old_seg->>'actualEndTime','') <> '' AND seg->'actualEndTime' IS DISTINCT FROM old_seg->'actualEndTime') THEN
      RAISE EXCEPTION 'Recorded times cannot be rewritten by lifecycle actions';
    END IF;
  END LOOP;
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action',p_action,true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  SELECT * INTO patched FROM jsonb_populate_record(item,p_patch);
  UPDATE "BookingItems" SET segments=patched.segments, options=patched.options, status=patched.status,
    "pauseStart"=patched."pauseStart", "timeEnd"=patched."timeEnd", "technicianCodes"=patched."technicianCodes" WHERE id=p_item_id;

  FOR seg IN SELECT value FROM jsonb_array_elements(new_segments) LOOP
    SELECT value INTO old_seg FROM jsonb_array_elements(old_segments) WHERE value->>'id'=seg->>'id';
    employee := seg->>'ktvId';
    IF old_seg IS NOT NULL AND old_seg IS DISTINCT FROM seg
       AND seg->>'note' IN ('CHANGED','CANCELLED_NO_CREDIT','CANCELLED_WITH_CREDIT','EARLY_LEAVE_NOT_STARTED') THEN
      -- Started cancellation still owes physical cleaning/handover; credit is handled separately below.
      IF NOT (seg->>'note' IN ('CANCELLED_NO_CREDIT','CANCELLED_WITH_CREDIT')
        AND COALESCE(seg->>'actualStartTime','') <> '' AND COALESCE(seg->>'handoverTime','') = '') THEN
        UPDATE "KtvAssignments" SET status='CANCELLED',updated_at=clock_timestamp()
          WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=employee AND segment_id=seg->>'id'
            AND status IN ('ACTIVE','QUEUED','READY','COMPLETED');
        IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id=employee AND booking_item_id=p_item_id AND status IN ('ACTIVE','QUEUED','READY')) THEN
          UPDATE "TurnQueue" SET booking_item_ids=array_remove(COALESCE(booking_item_ids,ARRAY[]::text[]),p_item_id),
            booking_item_id=CASE WHEN booking_item_id=p_item_id THEN NULL ELSE booking_item_id END
            WHERE employee_id=employee AND date=service_day AND current_order_id=p_booking_id;
          UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL
            WHERE employee_id=employee AND date=service_day AND current_order_id=p_booking_id
              AND cardinality(COALESCE(booking_item_ids,ARRAY[]::text[]))=0 AND booking_item_id IS NULL;
          IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id=employee AND business_date=service_day AND status='ACTIVE') THEN
            PERFORM promote_next_assignment(employee,service_day);
          END IF;
        END IF;
      END IF;
      IF COALESCE(seg->>'voided','false')='true' AND NOT EXISTS (
        SELECT 1 FROM "BookingItems" bi JOIN "Bookings" family ON family.id=bi."bookingId",
          jsonb_array_elements(jsonb_unwrap_string(bi.segments)) work
        WHERE COALESCE(family.parent_booking_id,family.id)=family_id AND bi.status::text <> 'CANCELLED'
          AND work->>'ktvId'=employee AND COALESCE(work->>'voided','false') <> 'true') THEN
        UPDATE "TurnLedger" SET is_punished=true WHERE date=service_day AND booking_id=family_id AND employee_id=employee;
      END IF;
    ELSIF old_seg IS NULL THEN
      IF p_action <> 'SWAP' OR NOT EXISTS (SELECT 1 FROM "Staff" WHERE id=employee) THEN RAISE EXCEPTION 'Invalid replacement employee'; END IF;
      IF EXISTS (SELECT 1 FROM "TurnQueue" WHERE employee_id=employee AND date=service_day
        AND current_order_id IS NOT NULL AND current_order_id <> p_booking_id AND status='working') THEN
        RAISE EXCEPTION 'Nhân viên thay thế đang làm đơn khác';
      END IF;
      assigned := (seg->>'plannedStartAt')::timestamptz;
      INSERT INTO "KtvAssignments" (employee_id,business_date,booking_id,booking_item_id,segment_id,status,dispatch_source,
        planned_start_time,planned_end_time,room_id,bed_id)
        VALUES(employee,service_day,p_booking_id,p_item_id,seg->>'id','ACTIVE','SWAP_KTV',assigned,
          (seg->>'plannedEndAt')::timestamptz,seg->>'roomId',seg->>'bedId')
        ON CONFLICT(employee_id,booking_item_id) DO UPDATE SET segment_id=EXCLUDED.segment_id,status='ACTIVE',
          planned_start_time=EXCLUDED.planned_start_time,planned_end_time=EXCLUDED.planned_end_time,
          room_id=EXCLUDED.room_id,bed_id=EXCLUDED.bed_id,updated_at=clock_timestamp();
      UPDATE "TurnQueue" SET status='assigned',current_order_id=p_booking_id,booking_item_id=p_item_id,
        booking_item_ids=ARRAY(SELECT DISTINCT unnest(COALESCE(booking_item_ids,ARRAY[]::text[]) || ARRAY[p_item_id])),
        start_time=(seg->>'startTime')::time,estimated_end_time=(seg->>'endTime')::time,
        room_id=seg->>'roomId',bed_id=seg->>'bedId' WHERE employee_id=employee AND date=service_day;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM "Staff" WHERE id=employee AND work_type='TYPE_C') THEN
        INSERT INTO "TurnQueue"(employee_id,date,status,current_order_id,booking_item_id,booking_item_ids,queue_position,turns_completed)
          VALUES(employee,service_day,'assigned',p_booking_id,p_item_id,ARRAY[p_item_id],
            (SELECT COALESCE(max(queue_position),0)+1 FROM "TurnQueue" WHERE date=service_day),0);
      ELSIF NOT FOUND THEN RAISE EXCEPTION 'Nhân viên thay thế chưa có trong sổ tua ngày dịch vụ'; END IF;
      IF EXISTS(SELECT 1 FROM "Staff" WHERE id=employee AND COALESCE(work_type,'TYPE_A') <> 'TYPE_D') THEN
        INSERT INTO "TurnLedger"(date,booking_id,employee_id,source,is_punished) VALUES(service_day,family_id,employee,'SWAP_KTV',false)
          ON CONFLICT(date,booking_id,employee_id) DO UPDATE SET is_punished=false;
      END IF;
    END IF;
  END LOOP;
  IF p_action='CANCEL' AND patched.status::text='CANCELLED' THEN
    UPDATE "Bookings" SET "totalAmount"=GREATEST(0,COALESCE("totalAmount",0)-COALESCE(item.price,0)*COALESCE(item.quantity,1)) WHERE id=p_booking_id;
  END IF;
  PERFORM dispatch_recompute_booking_status(p_booking_id);
  IF NOT EXISTS(SELECT 1 FROM "BookingItems" WHERE "bookingId"=p_booking_id AND status::text <> 'CANCELLED') THEN
    UPDATE "Bookings" SET status='CANCELLED' WHERE id=p_booking_id;
  END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id;
  RETURN jsonb_build_object('success',true,'item',to_jsonb(item));
END $$;
REVOKE ALL ON FUNCTION dispatch_sequential_lifecycle_atomic(text,text,jsonb,jsonb,text,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_sequential_lifecycle_atomic(text,text,jsonb,jsonb,text,jsonb,bigint) TO service_role;

CREATE OR REPLACE FUNCTION guard_sequential_item_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_old_options jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}'::jsonb);
    v_new_options jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}'::jsonb);
    v_old_segments jsonb := COALESCE(jsonb_unwrap_string(OLD.segments), '[]'::jsonb);
    v_new_segments jsonb := COALESCE(jsonb_unwrap_string(NEW.segments), '[]'::jsonb);
    v_old jsonb;
    v_in jsonb;
    v_out jsonb := '[]'::jsonb;
    v_a_done boolean;
    v_b_done boolean;
    v_is_draft boolean;
BEGIN
    IF v_old_options->>'sequentialSlots' IS DISTINCT FROM '2' AND v_new_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN RETURN NEW; END IF;
    v_is_draft := OLD.status IN ('NEW', 'WAITING') AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_old_segments) s
        WHERE COALESCE(s->>'actualStartTime', '') <> '' OR COALESCE(s->>'actualEndTime', '') <> '');
    IF NOT v_is_draft AND v_old_options->>'sequentialSlots' = '2' AND v_new_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'Không được bỏ chế độ nối tiếp qua lưu đơn cũ';
    END IF;
    IF v_old_options->>'finishedAfterA' = 'true' AND v_new_options->>'finishedAfterA' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Dịch vụ đã kết thúc sau A; tải lại đơn';
    END IF;
    IF v_old_options->>'finishedAfterA' IS DISTINCT FROM 'true'
       AND v_new_options->>'finishedAfterA' = 'true'
       AND current_setting('app.sequential_rpc', true) IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'Chỉ được kết thúc sau A qua thao tác quầy';
    END IF;
    IF jsonb_typeof(v_new_segments) <> 'array' THEN RAISE EXCEPTION 'Segments nối tiếp không hợp lệ'; END IF;
    IF NOT v_is_draft AND v_old_options->>'sequentialSlots' = '2' AND current_setting('app.sequential_rpc', true) IS DISTINCT FROM '1' THEN
        FOR v_old IN SELECT value FROM jsonb_array_elements(v_old_segments) LOOP
            SELECT value INTO v_in FROM jsonb_array_elements(v_new_segments)
            WHERE value->>'id' = v_old->>'id' LIMIT 1;
            IF v_in IS NULL THEN v_in := v_old; END IF;
            IF COALESCE(v_old->>'voided', 'false') = 'true' THEN
                IF COALESCE(v_in->>'actualStartTime', '') <> COALESCE(v_old->>'actualStartTime', '') THEN
                    RAISE EXCEPTION 'Lượt KTV đã được thay; tải lại đơn';
                END IF;
                -- Only post-service evidence may be added to cancelled work; never revive it.
                IF v_old->>'note' = 'CANCELLED_NO_CREDIT'
                   AND COALESCE(v_old->>'actualStartTime','') <> '' AND COALESCE(v_old->>'actualEndTime','') <> '' THEN
                    v_old := v_old || COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(v_in)
                      WHERE key IN ('handoverTime','handoverPhotoUrls','feedbackTime','reviewTime')), '{}');
                END IF;
                v_out := v_out || jsonb_build_array(v_old);
                CONTINUE;
            END IF;
            -- Assignment/slot changes belong to the locked RPC. A stale KTV write
            -- must not revive a replaced B or move either slot's planned time.
            v_in := v_in || jsonb_build_object(
                'ktvId', v_old->'ktvId', 'sequenceSlot', v_old->'sequenceSlot',
                'voided', v_old->'voided', 'roomId', v_old->'roomId',
                'bedId', v_old->'bedId', 'startTime', v_old->'startTime',
                'endTime', v_old->'endTime', 'duration', v_old->'duration',
                'plannedStartAt', v_old->'plannedStartAt',
                'plannedEndAt', v_old->'plannedEndAt');
            IF COALESCE(v_old->>'actualStartTime', '') <> '' THEN
                v_in := jsonb_set(v_in, '{actualStartTime}', v_old->'actualStartTime', true);
            END IF;
            IF COALESCE(v_old->>'actualEndTime', '') <> '' THEN
                v_in := jsonb_set(v_in, '{actualEndTime}', v_old->'actualEndTime', true);
            END IF;
            v_out := v_out || jsonb_build_array(v_in);
        END LOOP;
        NEW.segments := v_out;
        v_new_segments := v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_segments) s
               WHERE COALESCE(s->>'voided', 'false') <> 'true'
                 AND COALESCE(s->>'actualEndTime', '') <> ''
                 AND COALESCE(s->>'actualStartTime', '') = '') THEN
        RAISE EXCEPTION 'Không thể kết thúc lượt KTV chưa bắt đầu';
    END IF;
    SELECT COALESCE(bool_or(COALESCE(s->>'actualStartTime', '') <> '' AND COALESCE(s->>'actualEndTime', '') <> ''), false)
    INTO v_a_done FROM jsonb_array_elements(v_new_segments) s
    WHERE s->>'sequenceSlot' = '1' AND COALESCE(s->>'voided', 'false') <> 'true';
    SELECT COALESCE(bool_or(COALESCE(s->>'actualStartTime', '') <> '' AND COALESCE(s->>'actualEndTime', '') <> ''), false)
    INTO v_b_done FROM jsonb_array_elements(v_new_segments) s
    WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'voided', 'false') <> 'true';
    IF current_setting('app.sequential_rpc',true) IS DISTINCT FROM '1'
       AND COALESCE(v_new_options->'closedSequentialSlots','[]') IS DISTINCT FROM COALESCE(v_old_options->'closedSequentialSlots','[]') THEN
        RAISE EXCEPTION 'Chỉ được đóng lượt A/B qua thao tác chọn phạm vi';
    END IF;
    IF NEW.status NOT IN ('CANCELLED','PAUSED','IN_PROGRESS','PREPARING','READY','WAITING','NEW')
       AND NOT ((v_a_done OR COALESCE(v_new_options->'closedSequentialSlots','[]') @> '[1]'::jsonb)
         AND (v_b_done OR COALESCE(v_new_options->'closedSequentialSlots','[]') @> '[2]'::jsonb
           OR (v_new_options->>'finishedAfterA' = 'true' AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_new_segments) s WHERE s->>'sequenceSlot'='2' AND COALESCE(s->>'actualStartTime','') <> '')))
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_segments) s
           WHERE COALESCE(s->>'voided','false') <> 'true' AND COALESCE(s->>'ktvId','') <> ''
             AND (COALESCE(s->>'actualStartTime','')='' OR COALESCE(s->>'actualEndTime','')=''))) THEN
        RAISE EXCEPTION 'Dịch vụ nối tiếp còn lượt chưa hoàn tất';
    END IF;
    RETURN NEW;
END;
$$;

-- Latest saved plan is the edit baseline; audit and optimistic locking are atomic.
-- Requires jsonb_unwrap_string and the sequential RPCs. No shared DB application here.
CREATE OR REPLACE FUNCTION dispatch_edit_snapshot(p_segments jsonb, p_options jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'segments', COALESCE((SELECT jsonb_object_agg(s->>'id', jsonb_strip_nulls(jsonb_build_object(
      'ktvId', s->'ktvId', 'sequenceSlot', s->'sequenceSlot', 'startTime', s->'startTime',
      'endTime', s->'endTime', 'duration', s->'duration', 'plannedStartAt', s->'plannedStartAt',
      'plannedEndAt', s->'plannedEndAt', 'actualStartTime', s->'actualStartTime',
      'actualEndTime', s->'actualEndTime', 'voided', s->'voided', 'pauses', s->'pauses')))
      FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(p_segments), '[]')) s WHERE s->>'id' IS NOT NULL), '{}'),
    'names', COALESCE(NULLIF(jsonb_unwrap_string(p_options)->'serviceNamesForKtvs', 'null'), '{}'),
    'displayName', jsonb_unwrap_string(p_options)->'displayName');
$$;

CREATE OR REPLACE FUNCTION keep_dispatch_edit_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_opts jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}');
  new_opts jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}');
  before_state jsonb;
  after_state jsonb;
  changes jsonb := '[]';
  old_seg jsonb;
  new_seg jsonb;
  segment_id text;
  field_name text;
  employee_id text;
  revision bigint := COALESCE((old_opts->>'dispatchRevision')::bigint, 0);
  action_name text := NULLIF(current_setting('app.dispatch_action', true), '');
  actor jsonb := COALESCE(NULLIF(current_setting('app.dispatch_actor', true), '')::jsonb, 'null');
BEGIN
  -- A background writer holding old options must not undo a saved service name.
  IF action_name IS NULL AND COALESCE((new_opts->>'dispatchRevision')::bigint, 0) < revision THEN
    new_opts := (new_opts - 'serviceNamesForKtvs' - 'displayName') ||
      jsonb_build_object('serviceNamesForKtvs', COALESCE(old_opts->'serviceNamesForKtvs', '{}'),
                         'displayName', old_opts->'displayName');
  END IF;
  before_state := dispatch_edit_snapshot(OLD.segments, old_opts);
  after_state := dispatch_edit_snapshot(NEW.segments, new_opts);
  FOR segment_id IN SELECT jsonb_object_keys(before_state->'segments') UNION SELECT jsonb_object_keys(after_state->'segments') LOOP
    old_seg := before_state->'segments'->segment_id;
    new_seg := after_state->'segments'->segment_id;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','startTime','endTime','duration','plannedStartAt','plannedEndAt','actualStartTime','actualEndTime','voided','pauses']) LOOP
      IF old_seg->field_name IS DISTINCT FROM new_seg->field_name THEN
        changes := changes || jsonb_build_array(jsonb_build_object('segmentId', segment_id,
          'employeeId', COALESCE(new_seg->>'ktvId', old_seg->>'ktvId'), 'field', field_name,
          'before', old_seg->field_name, 'after', new_seg->field_name));
      END IF;
    END LOOP;
  END LOOP;
  FOR employee_id IN SELECT jsonb_object_keys(before_state->'names') UNION SELECT jsonb_object_keys(after_state->'names') LOOP
    IF before_state->'names'->employee_id IS DISTINCT FROM after_state->'names'->employee_id THEN
      changes := changes || jsonb_build_array(jsonb_build_object('employeeId', employee_id,
        'field', 'serviceNameForKtv', 'before', before_state->'names'->employee_id, 'after', after_state->'names'->employee_id));
    END IF;
  END LOOP;
  IF before_state->'displayName' IS DISTINCT FROM after_state->'displayName' THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'displayName',
      'before', before_state->'displayName', 'after', after_state->'displayName'));
  END IF;
  new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
    'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]'));
  -- Preserve counter entries that arrived while the form was open, plus new entries.
  IF old_opts ? 'counterLog' OR new_opts ? 'counterLog' THEN
    new_opts := jsonb_set(new_opts, '{counterLog}', COALESCE((SELECT jsonb_agg(value ORDER BY first_pos)
      FROM (SELECT value, min(ord) first_pos FROM jsonb_array_elements(
        COALESCE(old_opts->'counterLog', '[]') || COALESCE(new_opts->'counterLog', '[]')) WITH ORDINALITY a(value, ord)
        GROUP BY value) unique_entries), '[]'));
  END IF;
  IF changes <> '[]' OR action_name IS NOT NULL THEN
    revision := revision + 1;
    new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
      'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]') || jsonb_build_array(jsonb_build_object(
        'revision', revision, 'at', clock_timestamp(), 'action', COALESCE(action_name, 'UPDATE'),
        'actor', actor, 'changes', changes)));
  END IF;
  NEW.options := new_opts;
  RETURN NEW;
END;
$$;


-- Service-role FINISH commit: all item/child writes and booking status share one transaction.
CREATE OR REPLACE FUNCTION ktv_finish_service_atomic(
    p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb,
    p_guest_ratings jsonb, p_updates jsonb, p_booking_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    booking_row "Bookings"%ROWTYPE;
    item_row "BookingItems"%ROWTYPE;
    snapshot jsonb;
    patch jsonb;
    field text;
    guests jsonb;
BEGIN
    IF jsonb_typeof(p_item_snapshots) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_guest_ratings) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_updates) = 0
       OR p_booking_status IS NULL
       OR p_booking_status NOT IN ('NEW','PREPARING','IN_PROGRESS','CLEANING','FEEDBACK','DONE') THEN
        RAISE EXCEPTION 'Invalid FINISH batch';
    END IF;
    SELECT * INTO booking_row FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
    -- Match dispatch's lock order: booking, items by id, guests by id.
    PERFORM id FROM "BookingItems" WHERE "bookingId" = p_booking_id ORDER BY id FOR UPDATE;
    PERFORM id FROM "BookingGuests" WHERE booking_id = p_booking_id ORDER BY id FOR UPDATE;
    IF p_booking_snapshot->>'id' IS DISTINCT FROM p_booking_id
       OR to_jsonb(booking_row)->'status' IS DISTINCT FROM p_booking_snapshot->'status'
       OR to_jsonb(booking_row)->'rating' IS DISTINCT FROM p_booking_snapshot->'rating' THEN
        RAISE EXCEPTION 'FINISH snapshot changed; reload booking';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'rating',rating) ORDER BY id),'[]') INTO guests
      FROM "BookingGuests" WHERE booking_id = p_booking_id;
    IF guests IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(value ORDER BY value->>'id'),'[]') FROM jsonb_array_elements(p_guest_ratings)) THEN
        RAISE EXCEPTION 'FINISH ratings changed; reload booking';
    END IF;
    IF jsonb_array_length(p_item_snapshots) <> (SELECT count(*) FROM "BookingItems" WHERE "bookingId" = p_booking_id)
       OR jsonb_array_length(p_item_snapshots) <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_item_snapshots))
       OR jsonb_array_length(p_updates) <> (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_updates)) THEN
        RAISE EXCEPTION 'FINISH item set changed; reload booking';
    END IF;
    FOR snapshot IN SELECT value FROM jsonb_array_elements(p_item_snapshots) LOOP
        SELECT * INTO item_row FROM "BookingItems" WHERE id = snapshot->>'id' AND "bookingId" = p_booking_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'FINISH item not found'; END IF;
        -- Every field used by the handler must be present, not omitted by a malformed payload.
        IF NOT snapshot ?& ARRAY['id','segments','status','itemRating','guest_id','options','handover_status','handover_images','handover_skipped','handover_submitted_at','serviceId'] THEN
            RAISE EXCEPTION 'Incomplete FINISH snapshot';
        END IF;
        FOR field IN SELECT jsonb_object_keys(snapshot) LOOP
            IF (CASE WHEN field = 'handover_submitted_at'
                THEN item_row.handover_submitted_at IS DISTINCT FROM (snapshot->>field)::timestamptz
                ELSE to_jsonb(item_row)->field IS DISTINCT FROM snapshot->field END) THEN
                RAISE EXCEPTION 'FINISH item snapshot changed: %; reload booking', item_row.id;
            END IF;
        END LOOP;
    END LOOP;
    FOR patch IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_item_snapshots) s WHERE s->>'id' = patch->>'id')
           OR patch->>'status' IS NULL
           OR patch->>'status' NOT IN ('CANCELLED','DONE','IN_PROGRESS','PAUSED','CLEANING','FEEDBACK')
           OR NOT patch ? 'status'
           OR (patch - ARRAY['id','segments','status','handover_images','handover_status','handover_skipped','handover_submitted_at']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Invalid FINISH item update';
        END IF;
        IF patch ? 'segments' AND jsonb_typeof(patch->'segments') = 'string' THEN
            patch := jsonb_set(patch,'{segments}',(patch->>'segments')::jsonb);
        END IF;
        IF patch ? 'segments' AND jsonb_typeof(patch->'segments') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Invalid FINISH segments';
        END IF;
        SELECT * INTO item_row FROM "BookingItems" WHERE id = patch->>'id' AND "bookingId" = p_booking_id;
        SELECT * INTO item_row FROM jsonb_populate_record(item_row,patch - 'id');
        UPDATE "BookingItems" SET segments = item_row.segments, status = item_row.status,
            handover_images = item_row.handover_images, handover_status = item_row.handover_status,
            handover_skipped = item_row.handover_skipped, handover_submitted_at = item_row.handover_submitted_at
          WHERE id = item_row.id;
    END LOOP;
    SELECT * INTO booking_row FROM jsonb_populate_record(booking_row, jsonb_build_object('status', p_booking_status));
    UPDATE "Bookings" SET status = booking_row.status, "updatedAt" = now() WHERE id = p_booking_id RETURNING * INTO booking_row;
    RETURN jsonb_build_object('success',true,'booking',to_jsonb(booking_row));
END $$;
REVOKE ALL ON FUNCTION ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text) TO service_role;

-- Closed B cannot be revived through a later assignment.
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

-- Release room duty after scoped cancellation without reopening a closed A/B slot.
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
      WHERE (COALESCE(s->>'voided','false') <> 'true' OR s->>'note'='CANCELLED_NO_CREDIT')
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
      WHERE COALESCE(s->>'ktvId','') <> '' AND (COALESCE(s->>'voided','false') <> 'true'
        OR (s->>'note'='CANCELLED_NO_CREDIT' AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''));
    IF opts->>'sequentialSlots' = '2' THEN
      all_done := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_segments) s
        WHERE COALESCE(s->>'voided','false') <> 'true' AND COALESCE(s->>'ktvId','') <> ''
          AND (COALESCE(s->>'actualStartTime','') = '' OR COALESCE(s->>'actualEndTime','') = ''))
        AND (COALESCE(opts->'closedSequentialSlots','[]') @> '[1]'::jsonb OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'sequenceSlot'='1'
            AND COALESCE(s->>'voided','false') <> 'true' AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''))
        AND (COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb OR opts->>'finishedAfterA'='true' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'sequenceSlot'='2'
            AND COALESCE(s->>'voided','false') <> 'true' AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''));
    END IF;
    rated := item."itemRating" IS NOT NULL OR b.rating IS NOT NULL OR EXISTS (
      SELECT 1 FROM "BookingGuests" WHERE id = item.guest_id AND rating IS NOT NULL);
    next_status := CASE WHEN item.status IN ('DONE','CANCELLED') THEN item.status::text
      WHEN NOT COALESCE(all_done,false) THEN CASE WHEN item.status::text='PAUSED' THEN 'PAUSED' ELSE 'IN_PROGRESS' END
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

REVOKE ALL ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) TO service_role;

-- Keep initial dispatch A/B plans consistent with their own assigned minutes.
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