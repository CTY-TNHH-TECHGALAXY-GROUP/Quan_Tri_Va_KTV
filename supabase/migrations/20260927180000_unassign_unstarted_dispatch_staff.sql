-- Removing a plan is distinct from closing A/B: the free slot remains assignable.
CREATE OR REPLACE FUNCTION dispatch_unassign_unstarted_staff(
  p_booking_id text, p_item_id text, p_ktv_id text, p_expected_revision bigint, p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item "BookingItems"%ROWTYPE;
  opts jsonb;
  v_segments jsonb;
  target jsonb;
  remaining jsonb;
  service_day date;
  family_id text;
BEGIN
  SELECT "bookingDate"::date, COALESCE(parent_booking_id,id) INTO service_day,family_id
    FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  SELECT * INTO item FROM "BookingItems" WHERE id=p_item_id AND "bookingId"=p_booking_id FOR UPDATE;
  IF NOT FOUND OR item.status NOT IN ('NEW','WAITING','PREPARING','READY','IN_PROGRESS') THEN
    RAISE EXCEPTION 'Ca đã chuyển trạng thái; tải lại đơn';
  END IF;
  opts := COALESCE(jsonb_unwrap_string(item.options),'{}');
  v_segments := COALESCE(jsonb_unwrap_string(item.segments),'[]');
  IF p_expected_revision IS NULL OR COALESCE((opts->>'dispatchRevision')::bigint,0) <> p_expected_revision THEN
    RAISE EXCEPTION 'Ca đã có bản lưu mới; bản đang sửa chưa được lưu';
  END IF;
  SELECT value INTO target FROM jsonb_array_elements(v_segments)
    WHERE value->>'ktvId'=p_ktv_id AND COALESCE(value->>'voided','false') <> 'true' LIMIT 1;
  IF target IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE s->>'ktvId'=p_ktv_id AND COALESCE(s->>'voided','false') <> 'true'
      AND (COALESCE(s->>'actualStartTime','') <> '' OR COALESCE(s->>'actualEndTime','') <> '')) THEN
    RAISE EXCEPTION 'Nhân viên đã bắt đầu hoặc đã đổi; dùng Dừng/Đổi để giữ giờ thực tế';
  END IF;
  IF target->>'sequenceSlot'='1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_segments) s
    WHERE s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false') <> 'true'
      AND COALESCE(s->>'actualStartTime','') <> '') THEN
    RAISE EXCEPTION 'B đã bắt đầu; không được bỏ kế hoạch A qua thao tác bỏ phân công';
  END IF;
  v_segments := (SELECT jsonb_agg(CASE
    WHEN s->>'ktvId'=p_ktv_id AND COALESCE(s->>'voided','false') <> 'true'
      THEN s || jsonb_build_object('voided',true,'voidedAt',clock_timestamp(),'note','UNASSIGNED','customCommissionDuration',0)
    WHEN target->>'sequenceSlot'='1' AND s->>'sequenceSlot'='2' AND COALESCE(s->>'voided','false') <> 'true'
      THEN s || '{"sequenceSlot":1}'::jsonb
    ELSE s END ORDER BY ord) FROM jsonb_array_elements(v_segments) WITH ORDINALITY r(s,ord));
  remaining := COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(v_segments) s WHERE COALESCE(s->>'voided','false') <> 'true'),'[]');
  PERFORM set_config('app.dispatch_action','UNASSIGN_STAFF',true);
  PERFORM set_config('app.dispatch_actor',COALESCE(p_actor,'null')::text,true);
  PERFORM set_config('app.sequential_rpc','1',true);
  UPDATE "BookingItems" SET segments=v_segments,
    "technicianCodes"=ARRAY(SELECT DISTINCT s->>'ktvId' FROM jsonb_array_elements(remaining) s),
    status=CASE WHEN jsonb_array_length(remaining)=0 THEN 'WAITING' ELSE status END
    WHERE id=p_item_id;
  PERFORM set_config('app.sequential_rpc','',true);
  UPDATE "KtvAssignments" SET status='CANCELLED',updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND booking_id=p_booking_id AND employee_id=p_ktv_id
      AND status IN ('ACTIVE','QUEUED','READY');
  DELETE FROM "TurnLedger" tl WHERE tl.employee_id=p_ktv_id AND tl.date=service_day AND tl.booking_id=family_id
    AND NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka JOIN "Bookings" b ON b.id=ka.booking_id
      WHERE COALESCE(b.parent_booking_id,b.id)=family_id AND ka.employee_id=p_ktv_id
        AND ka.business_date=service_day AND ka.status IN ('ACTIVE','QUEUED','READY','COMPLETED'));
  PERFORM promote_next_assignment(p_ktv_id,service_day);
  SELECT COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint,0) INTO p_expected_revision
    FROM "BookingItems" WHERE id=p_item_id;
  PERFORM set_config('app.dispatch_action','',true);
  PERFORM set_config('app.dispatch_actor','',true);
  RETURN jsonb_build_object('success',true,'revision',p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb) TO service_role;

-- All unstarted plans are editable; running and historical work stays immutable.
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
REVOKE ALL ON FUNCTION dispatch_save_sequential_update(text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_save_sequential_update(text,jsonb,boolean) TO service_role;

-- One Save may remove several rows; all removals either commit or roll back together.
CREATE OR REPLACE FUNCTION dispatch_unassign_unstarted_staffs(
  p_booking_id text,p_item_id text,p_ktv_ids text[],p_expected_revision bigint,p_actor jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE employee text; result jsonb;
BEGIN
  PERFORM 1 FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  IF p_ktv_ids IS NULL OR cardinality(p_ktv_ids)=0 OR cardinality(p_ktv_ids)<> (SELECT count(DISTINCT id) FROM unnest(p_ktv_ids) id) THEN
    RAISE EXCEPTION 'Danh sách nhân viên cần bỏ không hợp lệ';
  END IF;
  FOREACH employee IN ARRAY p_ktv_ids LOOP
    result:=dispatch_unassign_unstarted_staff(p_booking_id,p_item_id,employee,p_expected_revision,p_actor);
    p_expected_revision:=(result->>'revision')::bigint;
  END LOOP;
  RETURN jsonb_build_object('success',true,'revision',p_expected_revision);
END $$;
REVOKE ALL ON FUNCTION dispatch_unassign_unstarted_staffs(text,text,text[],bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_unassign_unstarted_staffs(text,text,text[],bigint,jsonb) TO service_role;
