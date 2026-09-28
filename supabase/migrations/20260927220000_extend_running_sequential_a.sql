-- Give the running A employee the full service when B has not started.
CREATE FUNCTION dispatch_extend_running_sequential_a(
  p_booking_id text, p_item_id text, p_expected_revision bigint, p_minutes integer, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; opts jsonb; v_segments jsonb; a jsonb;
  starts_at timestamptz; ends_at timestamptz; service_day date; saved "BookingItems"%ROWTYPE;
BEGIN
  IF p_minutes NOT BETWEEN 1 AND 600 OR p_expected_revision IS NULL THEN RAISE EXCEPTION 'Thời lượng không hợp lệ'; END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dịch vụ'; END IF;
  opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
  v_segments:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF item.status::text <> 'IN_PROGRESS' OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> p_expected_revision
    OR COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi điều chỉnh';
  END IF;
  SELECT value INTO a FROM jsonb_array_elements(v_segments) WHERE value->>'sequenceSlot'='1'
    AND COALESCE(value->>'voided','false')<>'true';
  IF a IS NULL OR COALESCE(a->>'actualStartTime','')='' OR COALESCE(a->>'actualEndTime','')<>''
    OR p_minutes <= COALESCE((a->>'duration')::integer,0)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'sequenceSlot'='2'
      AND (COALESCE(s->>'voided','false')<>'true' OR COALESCE(s->>'actualStartTime','')<>'')) THEN
    RAISE EXCEPTION 'Chỉ được giao trọn cho A đang làm khi B chưa được gán hoặc bắt đầu';
  END IF;
  starts_at:=(a->>'actualStartTime')::timestamptz;
  ends_at:=starts_at+make_interval(mins=>p_minutes);
  IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=a->>'ktvId'
    AND ka.booking_item_id<>p_item_id AND ka.status IN ('ACTIVE','QUEUED','READY')
    AND ka.planned_start_time<ends_at AND ka.planned_end_time>starts_at) THEN
    RAISE EXCEPTION 'Nhân viên có phân công khác chồng với giờ mới';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
    AND ka.employee_id=a->>'ktvId' AND (ka.segment_id=a->>'id' OR ka.segment_id IS NULL)
    AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Không tìm thấy phân công đang làm của A';
  END IF;
  v_segments:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(v_segments) WITH ORDINALITY s(value,ord));
  opts:=jsonb_set(opts,'{closedSequentialSlots}',COALESCE(opts->'closedSequentialSlots','[]')||'[2]'::jsonb,true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','EXTEND_A_FULL',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  UPDATE "BookingItems" SET segments=v_segments,options=opts WHERE id=p_item_id RETURNING * INTO saved;
  UPDATE "KtvAssignments" SET planned_start_time=starts_at,planned_end_time=ends_at,updated_at=clock_timestamp()
    WHERE booking_id=p_booking_id AND booking_item_id=p_item_id AND employee_id=a->>'ktvId'
      AND (segment_id=a->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
  UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
    (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
    (max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date
      AND ka.booking_id=p_booking_id AND ka.status IN ('ACTIVE','QUEUED','READY'))
    WHERE t.employee_id=a->>'ktvId' AND t.date=service_day AND t.current_order_id=p_booking_id;
  RETURN jsonb_build_object('success',true,'revision',jsonb_unwrap_string(saved.options)->'dispatchRevision',
    'employeeId',a->>'ktvId','startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'));
END $$;
REVOKE ALL ON FUNCTION dispatch_extend_running_sequential_a(text,text,bigint,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_extend_running_sequential_a(text,text,bigint,integer,jsonb) TO service_role;
