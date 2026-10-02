-- plans/plan_fix_doi_gio_b_dang_lam_va_nut_tai_lai_20261002.md (H1, 02/10/2026)
-- A đã xong, B (lượt 2) đang làm: quầy đổi thời lượng B qua form điều phối.
-- (1) RPC mới dispatch_adjust_running_sequential_b — thân dẫn từ dispatch_adjust_running_sequential_a
--     đang chạy: chọn chặng lượt 2 đang chạy, A phải xong; mốc kết thúc mới phải sau hiện tại.
-- (2) dispatch_commit_form — thân copy nguyên bản đang chạy trên TEST, chỉ thêm nhánh H1.
CREATE OR REPLACE FUNCTION public.dispatch_adjust_running_sequential_b(p_booking_id text, p_item_id text, p_expected_revision bigint, p_minutes integer, p_actor jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
  -- `a` here is the running slot-2 (B) segment; every other live segment (A) must be finished.
  SELECT value INTO a FROM jsonb_array_elements(segs)
    WHERE opts->>'sequentialSlots'='2' AND value->>'sequenceSlot'='2'
      AND COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'actualStartTime','')<>''
      AND COALESCE(value->>'actualEndTime','')='';
  IF a IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(segs) s WHERE s->>'id' IS DISTINCT FROM a->>'id'
      AND COALESCE(s->>'voided','false')<>'true' AND COALESCE(s->>'actualEndTime','')='') THEN
    RAISE EXCEPTION 'Chỉ được sửa thời lượng B đang làm sau khi A đã xong';
  END IF;
  starts_at:=(a->>'actualStartTime')::timestamptz;
  ends_at:=starts_at+make_interval(mins=>p_minutes);
  IF ends_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Thời lượng mới phải lớn hơn số phút B đã làm (% phút)',
      floor(extract(epoch FROM clock_timestamp()-starts_at)/60)::integer;
  END IF;
  IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_item_id<>p_item_id
    AND ka.status='ACTIVE'
    AND (ka.employee_id=a->>'ktvId' OR (ka.room_id=a->>'roomId' AND ka.bed_id=a->>'bedId'))
    AND ka.planned_start_time<ends_at AND ka.planned_end_time>starts_at) THEN
    RAISE EXCEPTION 'Nhân viên hoặc giường có phân công chồng với giờ mới';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.booking_id=p_booking_id AND ka.booking_item_id=p_item_id
    AND ka.employee_id=a->>'ktvId' AND (ka.segment_id=a->>'id' OR ka.segment_id IS NULL)
    AND ka.status IN ('ACTIVE','QUEUED','READY')) THEN
    RAISE EXCEPTION 'Không tìm thấy phân công đang làm của B';
  END IF;
  segs:=(SELECT jsonb_agg(CASE WHEN value->>'id'=a->>'id' THEN value||jsonb_build_object(
    'startTime',to_char(starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'endTime',to_char(ends_at AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI'),
    'duration',p_minutes,'plannedStartAt',starts_at,'plannedEndAt',ends_at)
    ELSE value END ORDER BY ord) FROM jsonb_array_elements(segs) WITH ORDINALITY s(value,ord));
  previous_rpc:=current_setting('app.sequential_rpc',true);
  previous_action:=current_setting('app.dispatch_action',true);
  previous_actor:=current_setting('app.dispatch_actor',true);
  PERFORM set_config('app.sequential_rpc','1',true);
  PERFORM set_config('app.dispatch_action','ADJUST_B_DURATION',true);
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
END $fn$
;
REVOKE ALL ON FUNCTION dispatch_adjust_running_sequential_b(text,text,bigint,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_adjust_running_sequential_b(text,text,bigint,integer,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_commit_form(p_booking_id text, p_action text, p_payload jsonb, p_actor jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
    -- H1 (02/10/2026): A đã xong, B (lượt 2) đang làm — quầy đổi thời lượng B (đã xác nhận popup).
    -- Trước đây không có nhánh này nên base chặn "Nhân viên đã bắt đầu".
    IF item_found AND old_a IS NULL AND item.status::text IN ('IN_PROGRESS','PAUSED') AND opts->>'sequentialSlots'='2' THEN
      old_b:=NULL; incoming_b:=NULL;
      SELECT value INTO old_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(item.segments),'[]'))
        WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true'
          AND COALESCE(value->>'actualStartTime','')<>'' AND COALESCE(value->>'actualEndTime','')='';
      IF old_b IS NOT NULL THEN
        SELECT value INTO incoming_b FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(edit->'segments'),'[]'))
          WHERE value->>'id'=old_b->>'id' AND COALESCE(value->>'voided','false')<>'true';
        IF incoming_b IS NOT NULL AND incoming_b->'duration' IS DISTINCT FROM old_b->'duration' THEN
          b_minutes:=(incoming_b->>'duration')::integer;
          IF EXISTS(SELECT 1 FROM unnest(ARRAY['id','ktvId','sequenceSlot','roomId','bedId','startTime','actualStartTime','actualEndTime','voided']) k
            WHERE COALESCE(incoming_b->>k,'') IS DISTINCT FROM COALESCE(old_b->>k,'')) THEN
            RAISE EXCEPTION 'Chỉ được đổi thời lượng B đang làm; giữ nguyên nhân viên, phòng và giờ bắt đầu';
          END IF;
          saved:=dispatch_adjust_running_sequential_b(p_booking_id,item.id,
            COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0),b_minutes,p_actor);
          changes:=changes||jsonb_build_array(jsonb_build_object('itemId',item.id,'employeeId',saved->>'employeeId',
            'minutes',b_minutes,'startTime',saved->>'startTime','endTime',saved->>'endTime'));
          edit:=edit||jsonb_build_object('segments',saved->'segments','options',
            COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||jsonb_build_object('dispatchRevision',saved->'options'->'dispatchRevision'));
        END IF;
      END IF;
      old_b:=NULL; incoming_b:=NULL;
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
END $fn$
;
