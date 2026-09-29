-- A completed prior assignment can leave TurnQueue pointing at its old order.
-- Reconcile only when the next assignment is ACTIVE and the old work was handed over.
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
  result := ktv_finish_service_atomic(p_booking_id,p_booking_snapshot,p_item_snapshots,p_guest_ratings,p_updates,'IN_PROGRESS');
  UPDATE "Bookings" SET "timeStart" = COALESCE("timeStart",p_started_at) WHERE id = p_booking_id;
  SELECT * INTO t FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = service_day FOR UPDATE;
  IF NOT FOUND OR (p_turn_patch - ARRAY['status','current_order_id','start_time','estimated_end_time','room_id','bed_id','booking_item_id','booking_item_ids']) <> '{}'
    OR p_turn_patch->>'current_order_id' IS DISTINCT FROM p_booking_id THEN
    RAISE EXCEPTION 'TurnQueue changed; reload';
  END IF;
  IF t.current_order_id IS NOT NULL AND t.current_order_id <> p_booking_id THEN
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=p_employee_id
      AND ka.business_date=service_day AND ka.booking_id=p_booking_id AND ka.segment_id=p_target_segment_id
      AND ka.status='ACTIVE')
      OR EXISTS (SELECT 1 FROM "BookingItems" old_item,
        jsonb_array_elements(COALESCE(jsonb_unwrap_string(old_item.segments),'[]')) old_seg
        WHERE old_item."bookingId"=t.current_order_id
          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(old_seg->>'ktvId'),'\s+-\s+'))
          AND COALESCE(old_seg->>'voided','false')<>'true'
          AND COALESCE(old_seg->>'actualStartTime','')<>''
          AND (COALESCE(old_seg->>'actualEndTime','')='' OR (COALESCE(old_seg->>'handoverTime','')=''
            AND NOT (old_item.handover_status='SKIPPED' AND old_item.handover_skipped IS TRUE)))) THEN
      RAISE EXCEPTION 'Ca trước chưa bàn giao hoặc phân công mới đã đổi; tải lại';
    END IF;
  END IF;
  SELECT * INTO t FROM jsonb_populate_record(t,p_turn_patch);
  UPDATE "TurnQueue" SET status = t.status, current_order_id = t.current_order_id,
    start_time = t.start_time, estimated_end_time = t.estimated_end_time,
    room_id = t.room_id, bed_id = t.bed_id, booking_item_id = t.booking_item_id, booking_item_ids = t.booking_item_ids
    WHERE employee_id = p_employee_id AND date = service_day;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;
REVOKE ALL ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamp with time zone,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamp with time zone,jsonb) TO service_role;

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
    AND ka.status IN ('ACTIVE','QUEUED','READY')
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
  IF b_start<a_end THEN RAISE EXCEPTION 'B không thể bắt đầu trước khi A kết thúc'; END IF;
  IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status IN ('ACTIVE','QUEUED','READY')
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

-- The release RPC can leave a completed order in TurnQueue when the next
-- assignment was already ACTIVE. Reconcile it in the same transaction.
ALTER FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) RENAME TO ktv_release_work_atomic_base;
REVOKE ALL ON FUNCTION ktv_release_work_atomic_base(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION ktv_release_work_atomic(
  p_booking_id text, p_employee_id text, p_photo_urls jsonb, p_item_ids jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; turn_row "TurnQueue"%ROWTYPE; next_work "KtvAssignments"%ROWTYPE;
  work_day date;
BEGIN
  result := ktv_release_work_atomic_base(p_booking_id,p_employee_id,p_photo_urls,p_item_ids);
  FOR work_day IN SELECT DISTINCT business_date FROM "KtvAssignments"
    WHERE employee_id=p_employee_id AND booking_id=p_booking_id AND status='COMPLETED' LOOP
    SELECT * INTO turn_row FROM "TurnQueue" WHERE employee_id=p_employee_id AND date=work_day FOR UPDATE;
    IF NOT FOUND OR turn_row.current_order_id IS DISTINCT FROM p_booking_id THEN CONTINUE; END IF;
    -- A second started segment in this order still owns the queue.
    IF EXISTS (SELECT 1 FROM "BookingItems" bi,
      jsonb_array_elements(COALESCE(jsonb_unwrap_string(bi.segments),'[]')) s
      WHERE bi."bookingId"=p_booking_id
        AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'voided','false')<>'true'
        AND COALESCE(s->>'actualStartTime','')<>'' AND COALESCE(s->>'actualEndTime','')='') THEN CONTINUE; END IF;
    SELECT ka.* INTO next_work FROM "KtvAssignments" ka
      JOIN "Bookings" b ON b.id=ka.booking_id
      JOIN "BookingItems" bi ON bi.id=ka.booking_item_id
      WHERE ka.employee_id=p_employee_id AND ka.business_date=work_day AND ka.status='ACTIVE'
        AND ka.booking_item_id IS DISTINCT FROM turn_row.booking_item_id
        AND b.status NOT IN ('DONE','CANCELLED','SPLIT')
        AND bi.status NOT IN ('DONE','CANCELLED','FEEDBACK','CLEANING')
      ORDER BY ka.planned_start_time NULLS LAST,ka.priority,ka.created_at LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE "TurnQueue" SET status='assigned',current_order_id=next_work.booking_id,
      booking_item_id=next_work.booking_item_id,booking_item_ids=ARRAY[next_work.booking_item_id]::text[],
      room_id=next_work.room_id,bed_id=next_work.bed_id,
      start_time=(next_work.planned_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
      estimated_end_time=(next_work.planned_end_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
      WHERE employee_id=p_employee_id AND date=work_day;
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) TO service_role;
