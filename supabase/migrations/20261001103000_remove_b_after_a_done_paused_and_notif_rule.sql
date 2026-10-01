-- plans/plan_fix_feedback_test_tay_20261001.md (mục V1/V3/T3, 01/10/2026)
-- V3: gỡ B chưa bắt đầu được cả khi dịch vụ đang PAUSED (trước báo "Ca đã chuyển trạng thái" gây hiểu nhầm).
--     Thân copy nguyên từ 20260927180000_unassign_unstarted_dispatch_staff.sql, chỉ thêm 'PAUSED'.
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

-- V1: A đã xong + form bỏ B → tự "Kết thúc sau A". Thân copy từ 20261001102000_running_a_remove_b_then_adjust.sql.
CREATE OR REPLACE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb;
  old_a jsonb; incoming_a jsonb; old_b jsonb; incoming_b jsonb; saved jsonb;
  a_minutes integer; b_minutes integer; patched jsonb:='[]'; changes jsonb:='[]'; result jsonb;
  close_b boolean; done_a jsonb; item_found boolean;
BEGIN
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
    item_found := FOUND;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old_a:=NULL; incoming_a:=NULL; old_b:=NULL; incoming_b:=NULL; close_b:=false;
    IF FOUND AND item.status::text IN ('IN_PROGRESS','PAUSED') THEN
      SELECT value INTO old_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE (opts->>'sequentialSlots' IS DISTINCT FROM '2' OR value->>'sequenceSlot'='1')
          AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')='';
      IF old_a IS NOT NULL THEN
        SELECT value INTO incoming_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
          WHERE value->>'id'=old_a->>'id' AND COALESCE(value->>'voided','false')<>'true';
        SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
          WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
        IF old_b IS NOT NULL THEN
          SELECT value INTO incoming_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
            WHERE value->>'id'=old_b->>'id' AND COALESCE(value->>'voided','false')<>'true';
        END IF;
      END IF;
    END IF;
    -- V1: A đã XONG (dịch vụ còn chờ B) mà form bỏ B chưa bắt đầu → hoàn tất dịch vụ theo A,
    -- đúng như thao tác "Kết thúc sau A". Trước đây chỉ void B: dịch vụ kẹt IN_PROGRESS mãi.
    IF item_found AND old_a IS NULL AND item.status::text='IN_PROGRESS' AND opts->>'sequentialSlots'='2' THEN
      done_a:=NULL; old_b:=NULL;
      SELECT value INTO done_a FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')<>'';
      SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
      IF done_a IS NOT NULL AND old_b IS NOT NULL AND COALESCE(old_b->>'actualStartTime','')=''
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]')) n
                        WHERE n->>'id'=old_b->>'id' AND COALESCE(n->>'voided','false')<>'true') THEN
        PERFORM dispatch_unassign_unstarted_staff(p_booking_id, item.id, old_b->>'ktvId',
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0), p_actor);
        PERFORM dispatch_finish_sequential_after_a(p_booking_id, item.id);
        SELECT * INTO item FROM "BookingItems" WHERE id = item.id;
        edit := edit || jsonb_build_object('status', item.status::text,
          'segments', jsonb_unwrap_string(item.segments),
          'technicianCodes', to_jsonb(item."technicianCodes"),
          'options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}') || jsonb_build_object(
            'dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision',
            'finishedAfterA', true));
        changes := changes || jsonb_build_array(jsonb_build_object('itemId', item.id,
          'employeeId', old_b->>'ktvId', 'removedB', true, 'finishedAfterA', true));
      END IF;
      old_b := NULL;
    END IF;
    -- Quầy bỏ B chưa bắt đầu khi A đang làm (kèm hoặc không kèm đổi thời lượng A; quầy đã
    -- xác nhận popup). Thứ tự: (1) gỡ B — void, huỷ phân công, xoá lượt tua nếu B không còn
    -- phân công; (2) đổi thời lượng A nếu có; (3) đóng lượt 2 để dịch vụ hoàn tất theo A.
    -- Đóng lượt 2 SAU khi đổi A vì _a chặn giảm A dưới thời lượng dịch vụ khi B đã đóng.
    IF old_a IS NOT NULL AND old_b IS NOT NULL AND incoming_b IS NULL AND COALESCE(old_b->>'actualStartTime','')='' THEN
      PERFORM dispatch_unassign_unstarted_staff(p_booking_id, item.id, old_b->>'ktvId',
        COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0), p_actor);
      SELECT * INTO item FROM "BookingItems" WHERE id = item.id;
      edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
        || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision'));
      changes := changes || jsonb_build_array(jsonb_build_object('itemId', item.id,
        'employeeId', old_b->>'ktvId', 'removedB', true));
      old_b := NULL; close_b := true;
    END IF;
    IF old_a IS NOT NULL AND incoming_a IS NOT NULL AND
      (incoming_a->'duration' IS DISTINCT FROM old_a->'duration' OR
       (old_b IS NOT NULL AND incoming_b IS NOT NULL AND
        (incoming_b->>'startTime' IS DISTINCT FROM old_b->>'startTime' OR
         incoming_b->'duration' IS DISTINCT FROM old_b->'duration'))) THEN
      a_minutes:=(incoming_a->>'duration')::integer;
      IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
        WHERE COALESCE(incoming_a->>k,'') IS DISTINCT FROM COALESCE(old_a->>k,''))
        OR incoming_a->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(old_a->>'startTime')::time)+make_interval(mins=>a_minutes),'HH24:MI') THEN
        RAISE EXCEPTION 'Chỉ được đổi thời lượng A; giữ nguyên nhân viên, phòng và giờ bắt đầu';
      END IF;
      IF old_b IS NOT NULL THEN
        IF incoming_b IS NULL OR COALESCE(old_b->>'actualStartTime','')<>''
          OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','actualStartTime','actualEndTime','voided']) k
            WHERE COALESCE(incoming_b->>k,'') IS DISTINCT FROM COALESCE(old_b->>k,'')) THEN
          RAISE EXCEPTION 'Chỉ được đổi thời lượng A và giờ B chưa bắt đầu';
        END IF;
        b_minutes:=(incoming_b->>'duration')::integer;
        IF incoming_b->>'endTime' IS DISTINCT FROM to_char(
          (date '2000-01-01'+(incoming_b->>'startTime')::time)+make_interval(mins=>b_minutes),'HH24:MI') THEN
          RAISE EXCEPTION 'Giờ kết thúc B không khớp thời lượng';
        END IF;
        saved:=dispatch_adjust_running_sequential_pair(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),
          a_minutes,incoming_b->>'startTime',b_minutes,'{}'::jsonb,p_actor);
        saved:=saved->'savedItem';
        changes:=changes||jsonb_build_array(
          jsonb_build_object('itemId',item.id,'employeeId',old_a->>'ktvId','minutes',a_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_a->>'id')),
          jsonb_build_object('itemId',item.id,'employeeId',old_b->>'ktvId','minutes',b_minutes,
            'startTime',(SELECT value->>'startTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id'),
            'endTime',(SELECT value->>'endTime' FROM jsonb_array_elements(saved->'segments') WHERE value->>'id'=old_b->>'id')));
      ELSE
        saved:=dispatch_adjust_running_sequential_a(p_booking_id,item.id,
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),a_minutes,p_actor);
        changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
          'minutes',a_minutes,'startTime',saved->>'startTime','endTime',saved->>'endTime','closedB',saved->'closedB'));
      END IF;
      edit:=edit||jsonb_build_object('segments',saved->'segments','options',
        COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object(
          'dispatchRevision',saved->'options'->'dispatchRevision')||
          CASE WHEN saved->'options' ? 'closedSequentialSlots'
            THEN jsonb_build_object('closedSequentialSlots',saved->'options'->'closedSequentialSlots')
            ELSE '{}'::jsonb END);
    END IF;
    IF close_b THEN
      PERFORM set_config('app.sequential_rpc','1',true);
      UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}')
        || jsonb_build_object('closedSequentialSlots',
             COALESCE(jsonb_unwrap_string(options)->'closedSequentialSlots','[]') || '[2]'::jsonb)
        WHERE id = item.id RETURNING * INTO item;
      PERFORM set_config('app.sequential_rpc','',true);
      edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
        || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision',
                              'closedSequentialSlots', jsonb_unwrap_string(item.options)->'closedSequentialSlots'));
    END IF;
    patched:=patched||jsonb_build_array(edit);
  END LOOP;
  result:=dispatch_commit_form_base(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',patched),p_actor);
  RETURN result||jsonb_build_object('durationChanges',changes);
END $$;

-- T3: rule thông báo đổi đơn cho KTV — chỉ người được nhắc tới nhận (trước đây không có rule
-- nên mọi KTV đều thấy thông báo đổi giờ/bỏ lượt của đồng nghiệp). Chỉ thêm khi chưa có.
UPDATE "SystemConfigs"
SET value = (CASE WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb ELSE value END)
  || jsonb_build_object('KTV_ORDER_CHANGED', jsonb_build_object(
       'icon', '🔁', 'label', 'Quầy đổi phân công của KTV', 'sound', 'ktv-don-hang-moi.wav',
       'enabled', true, 'allowed_roles', jsonb_build_array('ktv'),
       'require_on_shift', false, 'include_target_employee', true))
WHERE key = 'notification_rules'
  AND NOT ((CASE WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb ELSE value END) ? 'KTV_ORDER_CHANGED');
