-- plans/plan_fix_reject_order_ket_don_20261002.md (02/10/2026)
-- KTV từ chối đơn dùng chung RPC bỏ phân công của quầy (void chặng, huỷ KtvAssignments,
-- đẩy phân công kế tiếp) thay vì route tự gỡ một nửa. p_reject=true: giữ tua (TurnLedger)
-- như hành vi cũ của từ chối và xoá mốc "đã nhận đơn" của chính KTV.
-- Thân copy nguyên từ bản đang chạy (= 20261001103000), chỉ thêm p_reject.
DROP FUNCTION IF EXISTS dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb);
CREATE OR REPLACE FUNCTION public.dispatch_unassign_unstarted_staff(p_booking_id text, p_item_id text, p_ktv_id text, p_expected_revision bigint, p_actor jsonb, p_reject boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
  IF NOT FOUND OR item.status NOT IN ('NEW','WAITING','PREPARING','READY','IN_PROGRESS','PAUSED') THEN
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
  IF COALESCE(p_reject,false) THEN
    -- KTV rejected: their own acceptance stamp must not survive a later re-dispatch to them.
    opts := (opts #- ARRAY['acceptedByStaff',p_ktv_id]) #- ARRAY['acceptedByStaff',upper(p_ktv_id)];
    IF lower(COALESCE(opts->>'acceptedBy',''))=lower(p_ktv_id) THEN opts := opts - 'acceptedBy' - 'acceptedAt'; END IF;
  END IF;
  UPDATE "BookingItems" SET segments=v_segments, options=opts,
    "technicianCodes"=ARRAY(SELECT DISTINCT s->>'ktvId' FROM jsonb_array_elements(remaining) s),
    status=CASE WHEN jsonb_array_length(remaining)=0 THEN 'WAITING' ELSE status END
    WHERE id=p_item_id;
  PERFORM set_config('app.sequential_rpc','',true);
  UPDATE "KtvAssignments" SET status='CANCELLED',updated_at=clock_timestamp()
    WHERE booking_item_id=p_item_id AND booking_id=p_booking_id AND employee_id=p_ktv_id
      AND status IN ('ACTIVE','QUEUED','READY');
  -- A reject still costs the KTV their turn (same as before 02/10/2026); only reception unassign refunds it.
  IF NOT COALESCE(p_reject,false) THEN
  DELETE FROM "TurnLedger" tl WHERE tl.employee_id=p_ktv_id AND tl.date=service_day AND tl.booking_id=family_id
    AND NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka JOIN "Bookings" b ON b.id=ka.booking_id
      WHERE COALESCE(b.parent_booking_id,b.id)=family_id AND ka.employee_id=p_ktv_id
        AND ka.business_date=service_day AND ka.status IN ('ACTIVE','QUEUED','READY','COMPLETED'));
  END IF;
  PERFORM promote_next_assignment(p_ktv_id,service_day);
  SELECT COALESCE((jsonb_unwrap_string(options)->>'dispatchRevision')::bigint,0) INTO p_expected_revision
    FROM "BookingItems" WHERE id=p_item_id;
  PERFORM set_config('app.dispatch_action','',true);
  PERFORM set_config('app.dispatch_actor','',true);
  RETURN jsonb_build_object('success',true,'revision',p_expected_revision);
END $fn$
;
REVOKE ALL ON FUNCTION dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_unassign_unstarted_staff(text,text,text,bigint,jsonb,boolean) TO service_role;
