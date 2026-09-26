-- Latest saved plan is the edit baseline; audit and optimistic locking are atomic.
-- Requires jsonb_unwrap_string and the sequential RPCs. No shared DB application here.
CREATE OR REPLACE FUNCTION dispatch_edit_snapshot(p_segments jsonb, p_options jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'segments', COALESCE((SELECT jsonb_object_agg(s->>'id', jsonb_strip_nulls(jsonb_build_object(
      'ktvId', s->'ktvId', 'sequenceSlot', s->'sequenceSlot', 'startTime', s->'startTime',
      'endTime', s->'endTime', 'duration', s->'duration', 'plannedStartAt', s->'plannedStartAt',
      'plannedEndAt', s->'plannedEndAt', 'actualStartTime', s->'actualStartTime',
      'actualEndTime', s->'actualEndTime', 'voided', s->'voided')))
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
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','startTime','endTime','duration','plannedStartAt','plannedEndAt','actualStartTime','actualEndTime','voided']) LOOP
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

-- Runs after the existing sequential guard so the audit describes what was saved.
DROP TRIGGER IF EXISTS zz_dispatch_edit_history ON "BookingItems";
CREATE TRIGGER zz_dispatch_edit_history BEFORE UPDATE OF segments, options ON "BookingItems"
FOR EACH ROW EXECUTE FUNCTION keep_dispatch_edit_history();

-- Edit an existing sequential service without resending/recreating A's assignment.
CREATE OR REPLACE FUNCTION dispatch_save_sequential_update(p_booking_id text, p_edit jsonb, p_confirm_overlap boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item_row "BookingItems"%ROWTYPE;
  opts jsonb;
  old_segments jsonb;
  incoming_segments jsonb := jsonb_unwrap_string(p_edit->'segments');
  old_segment jsonb;
  incoming jsonb;
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
     OR item_row.status NOT IN ('PREPARING','READY','IN_PROGRESS')
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
    IF old_segment->>'sequenceSlot' = '2' AND COALESCE(old_segment->>'voided','false') <> 'true' THEN
      b := old_segment; next_b := incoming;
    ELSE
      FOR field_name IN SELECT unnest(ARRAY['startTime','endTime','duration','plannedStartAt','plannedEndAt']) LOOP
        IF COALESCE(incoming->>field_name,'') IS DISTINCT FROM COALESCE(old_segment->>field_name,'') THEN
          RAISE EXCEPTION 'Không đổi kế hoạch A hoặc chặng cũ khi cập nhật B';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF b IS NOT NULL AND (b->'startTime' IS DISTINCT FROM next_b->'startTime'
      OR b->'endTime' IS DISTINCT FROM next_b->'endTime' OR b->'duration' IS DISTINCT FROM next_b->'duration') THEN
    IF COALESCE(b->>'actualStartTime','') <> '' THEN RAISE EXCEPTION 'B đã bắt đầu; không sửa giờ dự kiến'; END IF;
    IF COALESCE(next_b->>'startTime','') = '' OR COALESCE((next_b->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'Giờ/phút B không hợp lệ';
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
      RAISE EXCEPTION USING MESSAGE = 'OVERLAP_CONFIRM_REQUIRED', DETAIL = result::text;
    END IF;
    IF COALESCE((result->>'success')::boolean,false) = false THEN RAISE EXCEPTION 'Chưa cập nhật được kế hoạch B'; END IF;
  END IF;
  -- Read options again: the planned-time RPC may already have appended an audit entry.
  UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}') || COALESCE(jsonb_unwrap_string(p_edit->'options'),'{}')
  WHERE id = item_row.id;
  RETURN '{"success":true}';
END;
$$;
REVOKE ALL ON FUNCTION dispatch_save_sequential_update(text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_save_sequential_update(text,jsonb,boolean) TO service_role;

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
  PERFORM set_config('app.dispatch_action', p_action, true);
  PERFORM set_config('app.dispatch_actor', COALESCE(p_actor, 'null')::text, true);
  IF p_action IN ('DRAFT','DISPATCH') THEN
    FOR edit IN SELECT value FROM jsonb_array_elements(item_updates) LOOP
      SELECT * INTO item_row FROM "BookingItems" WHERE id = edit->>'id';
      IF jsonb_unwrap_string(item_row.options)->>'sequentialSlots' = '2'
         AND item_row.status IN ('PREPARING','READY','IN_PROGRESS') THEN
        PERFORM dispatch_save_sequential_update(p_booking_id,edit,COALESCE((p_payload->>'confirmOverlap')::boolean,false));
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
    result := dispatch_assign_sequential_slot_b(p_booking_id, p_payload->>'itemId', p_payload->>'toKtvId',
      (p_payload->>'plannedStartAt')::timestamptz, (p_payload->>'durationMinutes')::integer,
      COALESCE((p_payload->>'confirmOverlap')::boolean, false));
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
REVOKE ALL ON FUNCTION dispatch_apply_edit(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_apply_edit(text,text,jsonb,jsonb) TO service_role;
