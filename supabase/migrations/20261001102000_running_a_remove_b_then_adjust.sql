-- F8 (plans/plan_fix_feedback_test_tay_20261001.md): bỏ B chưa bắt đầu khi A đang làm — kèm hoặc
-- không kèm đổi thời lượng A — trong một lần lưu. Trước đây: bỏ B + đổi A bị chặn; chỉ bỏ B thì
-- không đóng lượt 2 nên A bấm Xong bị trigger chặn "còn lượt chưa hoàn tất". Thân hàm copy nguyên từ 20260929030000_running_form_commit_all_states.sql.
CREATE OR REPLACE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb;
  old_a jsonb; incoming_a jsonb; old_b jsonb; incoming_b jsonb; saved jsonb;
  a_minutes integer; b_minutes integer; patched jsonb:='[]'; changes jsonb:='[]'; result jsonb;
  close_b boolean;
BEGIN
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id;
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
