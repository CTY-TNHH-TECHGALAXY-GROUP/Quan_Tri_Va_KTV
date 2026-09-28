-- A running employee may change assigned minutes through the normal Save/Dispatch form.
-- B stays available for a shorter A; it closes only when A covers this item's service length.
DROP FUNCTION IF EXISTS dispatch_extend_running_sequential_a(text,text,bigint,integer,jsonb);

CREATE FUNCTION dispatch_adjust_running_sequential_a(
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
  IF item.status::text<>'IN_PROGRESS' OR opts->>'sequentialSlots' IS DISTINCT FROM '2'
    OR COALESCE((opts->>'dispatchRevision')::bigint,0)<>p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã thay đổi; tải lại đơn trước khi sửa thời lượng';
  END IF;
  SELECT value INTO a FROM jsonb_array_elements(segs) WHERE value->>'sequenceSlot'='1'
    AND COALESCE(value->>'voided','false')<>'true';
  IF a IS NULL OR COALESCE(a->>'actualStartTime','')='' OR COALESCE(a->>'actualEndTime','')<>''
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(segs) s WHERE s->>'sequenceSlot'='2'
      AND (COALESCE(s->>'voided','false')<>'true' OR COALESCE(s->>'actualStartTime','')<>'')) THEN
    RAISE EXCEPTION 'Chỉ được sửa thời lượng A đang làm khi B chưa nhận việc';
  END IF;
  SELECT duration INTO service_minutes FROM "Services" WHERE id=item."serviceId";
  service_minutes:=COALESCE(NULLIF((opts->>'vipDuration')::integer,0),NULLIF((opts->>'duration')::integer,0),service_minutes);
  IF service_minutes IS NULL OR service_minutes<1 THEN RAISE EXCEPTION 'Không xác định được thời lượng dịch vụ'; END IF;
  IF COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb AND p_minutes<service_minutes THEN
    RAISE EXCEPTION 'Lượt B đã đóng; không thể giảm A xuống dưới thời lượng dịch vụ';
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
  segs:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  IF p_minutes>=service_minutes AND NOT COALESCE(opts->'closedSequentialSlots','[]') @> '[2]'::jsonb THEN
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

ALTER FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) RENAME TO dispatch_commit_form_base;
REVOKE ALL ON FUNCTION dispatch_commit_form_base(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; old_a jsonb; incoming_a jsonb; saved jsonb;
  proposed integer; patched jsonb:='[]'; changes jsonb:='[]'; result jsonb;
BEGIN
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
    old_a:=NULL; incoming_a:=NULL;
    IF FOUND AND item.status::text='IN_PROGRESS' AND jsonb_unwrap_string(item.options)->>'sequentialSlots'='2' THEN
      SELECT value INTO old_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
      SELECT value INTO incoming_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
        WHERE value->>'id'=old_a->>'id';
    END IF;
    IF old_a IS NOT NULL AND incoming_a IS NOT NULL AND COALESCE(old_a->>'actualStartTime','')<>''
      AND COALESCE(old_a->>'actualEndTime','')='' AND incoming_a->'duration' IS DISTINCT FROM old_a->'duration' THEN
      proposed:=(incoming_a->>'duration')::integer;
      IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
        WHERE COALESCE(incoming_a->>k,'') IS DISTINCT FROM COALESCE(old_a->>k,''))
        OR incoming_a->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(old_a->>'startTime')::time)+make_interval(mins=>proposed),'HH24:MI')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]')) s
          WHERE s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false')<>'true') THEN
        RAISE EXCEPTION 'Chỉ được đổi thời lượng A; giữ nguyên nhân viên, giờ bắt đầu và lượt B';
      END IF;
      saved:=dispatch_adjust_running_sequential_a(p_booking_id,item.id,
        COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),proposed,p_actor);
      changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
        'minutes',proposed,'startTime',saved->>'startTime','endTime',saved->>'endTime','closedB',saved->'closedB'));
      edit:=edit||jsonb_build_object('segments',saved->'segments','options',
        COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object(
          'dispatchRevision',saved->'options'->'dispatchRevision',
          'closedSequentialSlots',COALESCE(saved->'options'->'closedSequentialSlots','[]'::jsonb)));
    END IF;
    patched:=patched||jsonb_build_array(edit);
  END LOOP;
  result:=dispatch_commit_form_base(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',patched),p_actor);
  RETURN result||jsonb_build_object('durationChanges',changes);
END $$;
REVOKE ALL ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) TO service_role;
