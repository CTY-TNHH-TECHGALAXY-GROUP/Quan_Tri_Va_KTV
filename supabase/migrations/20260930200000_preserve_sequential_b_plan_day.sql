-- Keep B on its persisted calendar day when A starts late. This form sends a
-- clock for B, not a date; moving B to another day requires the dated B editor.
CREATE OR REPLACE FUNCTION dispatch_adjust_running_sequential_pair(
  p_booking_id text, p_item_id text, p_expected_revision bigint,
  p_a_minutes integer, p_b_start text, p_b_minutes integer, p_metadata jsonb, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; saved "BookingItems"%ROWTYPE;
  opts jsonb; segs jsonb; a jsonb; b jsonb;
  service_day date; b_plan_day date; a_start timestamptz; a_end timestamptz;
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
  IF COALESCE(b->>'startTime','')='' OR
    abs(extract(epoch FROM (p_b_start::time - (b->>'startTime')::time))) >= 43200 THEN
    RAISE EXCEPTION 'Giờ B có thể chuyển ngày; dùng Sửa B để chọn ngày/giờ đầy đủ';
  END IF;
  SELECT COALESCE(
    (NULLIF(b->>'plannedStartAt','')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    (SELECT (ka.planned_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
        AND ka.employee_id=b->>'ktvId' AND (ka.segment_id=b->>'id' OR ka.segment_id IS NULL)
        AND ka.status IN ('ACTIVE','QUEUED','READY')
      ORDER BY (ka.segment_id IS DISTINCT FROM b->>'id'),ka.created_at LIMIT 1)) INTO b_plan_day;
  IF b_plan_day IS NULL THEN RAISE EXCEPTION 'Thiếu ngày phân công B; tải lại đơn'; END IF;
  b_start:=(b_plan_day+p_b_start::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
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
