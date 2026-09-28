-- Save and Dispatch commit the whole editable form in one transaction.
CREATE OR REPLACE FUNCTION dispatch_commit_form(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  edit jsonb; item "BookingItems"%ROWTYPE; opts jsonb; desired jsonb; old jsonb;
  seg jsonb; incoming jsonb; plans jsonb; next_b jsonb; old_b jsonb;
  revision bigint; result jsonb; updates jsonb := '[]'; removed text;
  confirm_overlap boolean; service_day date; start_at timestamptz;
BEGIN
  IF p_action NOT IN ('DRAFT','DISPATCH') OR jsonb_typeof(COALESCE(p_payload->'itemUpdates','[]')) <> 'array' THEN
    RAISE EXCEPTION 'Thao tác lưu không hợp lệ';
  END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy đơn'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')))
    <> jsonb_array_length(COALESCE(p_payload->'itemUpdates','[]')) THEN RAISE EXCEPTION 'Trùng dịch vụ trong bản lưu'; END IF;
  -- Lock and check every revision before the first removal, enable, or assignment.
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) ORDER BY value->>'id' LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id' AND "bookingId"=p_booking_id FOR UPDATE;
    IF NOT FOUND OR COALESCE((jsonb_unwrap_string(item.options)->>'dispatchRevision')::bigint,0)
      <> COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0) THEN
      RAISE EXCEPTION 'Dịch vụ đã có bản lưu mới. Bản đang sửa chưa được lưu; tải lại và kiểm tra.';
    END IF;
  END LOOP;
  FOR edit IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'itemUpdates','[]')) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=edit->>'id';
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}');
    old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    desired:=COALESCE(jsonb_unwrap_string(edit->'segments'),old);
    IF jsonb_typeof(desired)<>'array' OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(desired))<>jsonb_array_length(desired) THEN
      RAISE EXCEPTION 'Danh sách chặng không hợp lệ';
    END IF;
    FOR incoming IN SELECT value FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' LOOP
      IF COALESCE(incoming->>'id','')='' OR COALESCE(incoming->>'ktvId','')=''
        OR COALESCE(incoming->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR COALESCE((incoming->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Giờ hoặc thời lượng không hợp lệ'; END IF;
    END LOOP;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND
      ((SELECT count(DISTINCT value->>'sequenceSlot') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
      OR (EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true'))
      OR (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true' AND COALESCE(value->>'sequenceSlot','') NOT IN ('1','2'))
      OR (SELECT count(DISTINCT value->>'ktvId') FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')
        <> (SELECT count(*) FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true')) THEN
      RAISE EXCEPTION 'Nối tiếp cần A và tối đa một B khác nhân viên';
    END IF;
    -- Actual work is immutable even if a client omits it from the form.
    FOR seg IN SELECT value FROM jsonb_array_elements(old) WHERE COALESCE(value->>'voided','false')<>'true'
      AND (COALESCE(value->>'actualStartTime','')<>'' OR COALESCE(value->>'actualEndTime','')<>'') LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['ktvId','roomId','bedId','startTime','endTime','duration','actualStartTime','actualEndTime']) k
        WHERE COALESCE(incoming->>k,'') IS DISTINCT FROM COALESCE(seg->>k,'')) THEN
        RAISE EXCEPTION 'Nhân viên đã bắt đầu; dùng Dừng/Đổi để giữ giờ thực tế';
      END IF;
    END LOOP;
    IF item.status NOT IN ('PREPARING','READY','IN_PROGRESS') THEN
      IF p_action='DISPATCH' AND item.status IN ('NEW','WAITING') AND EXISTS(SELECT 1 FROM jsonb_array_elements(desired) WHERE COALESCE(value->>'voided','false')<>'true') THEN
        edit:=edit||jsonb_build_object('status','PREPARING');
      END IF;
      updates:=updates||jsonb_build_array(edit); CONTINUE;
    END IF;
    confirm_overlap:=COALESCE(p_payload->'confirmedOverlapItemIds','[]') ? item.id
      OR (jsonb_array_length(p_payload->'itemUpdates')=1 AND COALESCE((p_payload->>'confirmOverlap')::boolean,false));
    revision:=COALESCE((opts->>'dispatchRevision')::bigint,0);
    FOR removed IN SELECT DISTINCT value->>'ktvId' FROM jsonb_array_elements(old) oldseg
      WHERE COALESCE(value->>'voided','false')<>'true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n
        WHERE n->>'ktvId'=oldseg.value->>'ktvId' AND COALESCE(n->>'voided','false')<>'true') LOOP
      result:=dispatch_unassign_unstarted_staff(p_booking_id,item.id,removed,revision,p_actor);
      revision:=(result->>'revision')::bigint;
    END LOOP;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    opts:=COALESCE(jsonb_unwrap_string(item.options),'{}'); old:=COALESCE(jsonb_unwrap_string(item.segments),'[]');
    next_b:=NULL;
    SELECT value INTO next_b FROM jsonb_array_elements(desired) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    SELECT value INTO old_b FROM jsonb_array_elements(old) WHERE value->>'sequenceSlot'='2' AND COALESCE(value->>'voided','false')<>'true';
    -- New employees can only enter a live form as an unstarted sequential B.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(desired) n WHERE COALESCE(n->>'voided','false')<>'true'
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old) s WHERE s->>'id'=n->>'id' AND s->>'ktvId'=n->>'ktvId' AND COALESCE(s->>'voided','false')<>'true')
      AND NOT (jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND n->>'sequenceSlot'='2' AND old_b IS NULL)) THEN
      RAISE EXCEPTION 'Ca đã điều phối; nhân viên mới chỉ được gán vào lượt B chưa bắt đầu';
    END IF;
    -- Build the old shape for the shared DRAFT updater; historical work is copied from DB.
    plans:='[]';
    FOR seg IN SELECT value FROM jsonb_array_elements(old) LOOP
      SELECT value INTO incoming FROM jsonb_array_elements(desired) WHERE value->>'id'=seg->>'id' AND value->>'ktvId'=seg->>'ktvId' AND COALESCE(value->>'voided','false')<>'true';
      IF incoming IS NOT NULL AND COALESCE(seg->>'voided','false')<>'true' AND COALESCE(seg->>'actualStartTime','')='' AND COALESCE(seg->>'actualEndTime','')='' THEN
        seg:=seg||jsonb_build_object('startTime',incoming->'startTime','endTime',incoming->'endTime','duration',incoming->'duration');
      END IF;
      plans:=plans||jsonb_build_array(seg);
    END LOOP;
    incoming:=edit||jsonb_build_object('segments',plans,'options',COALESCE(jsonb_unwrap_string(edit->'options'),'{}')||
      jsonb_build_object('dispatchRevision',revision,'sequentialSlots',opts->'sequentialSlots'));
    result:=dispatch_apply_edit(p_booking_id,'DRAFT',p_payload||jsonb_build_object('newGuests','[]'::jsonb,'guestUpdates','[]'::jsonb,
      'itemUpdates',jsonb_build_array(incoming - 'guest_id'),'confirmOverlap',confirm_overlap),p_actor);
    revision:=(result->'revisions'->>item.id)::bigint;
    IF jsonb_unwrap_string(edit->'options')->>'sequentialSlots'='2' AND opts->>'sequentialSlots' IS DISTINCT FROM '2' THEN
      result:=dispatch_apply_edit(p_booking_id,'ENABLE_SEQUENTIAL',jsonb_build_object('itemId',item.id,'expectedRevision',revision),p_actor);
      revision:=(result->'revisions'->>item.id)::bigint;
    END IF;
    IF next_b IS NOT NULL AND old_b IS NULL THEN
      SELECT value INTO seg FROM "BookingItems" bi,jsonb_array_elements(jsonb_unwrap_string(bi.segments)) WHERE bi.id=item.id AND value->>'sequenceSlot'='1' AND COALESCE(value->>'voided','false')<>'true';
      IF seg IS NULL OR COALESCE(next_b->>'roomId','') IS DISTINCT FROM COALESCE(seg->>'roomId','') OR COALESCE(next_b->>'bedId','') IS DISTINCT FROM COALESCE(seg->>'bedId','') THEN
        RAISE EXCEPTION 'Lượt B cần cùng phòng và giường với A';
      END IF;
      start_at:=COALESCE(NULLIF(next_b->>'plannedStartAt','')::timestamptz,(service_day+(next_b->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF COALESCE(next_b->>'plannedStartAt','')='' AND next_b->>'startTime'<seg->>'startTime' THEN start_at:=start_at+interval '1 day'; END IF;
      result:=dispatch_apply_edit(p_booking_id,'ASSIGN_B',jsonb_build_object('itemId',item.id,'expectedRevision',revision,'toKtvId',next_b->>'ktvId',
        'plannedStartAt',start_at,'durationMinutes',(next_b->>'duration')::integer,'confirmOverlap',confirm_overlap),p_actor);
      IF result->>'code'='OVERLAP_CONFIRM_REQUIRED' THEN RAISE EXCEPTION USING MESSAGE='OVERLAP_CONFIRM_REQUIRED',DETAIL=(result||jsonb_build_object('itemId',item.id))::text; END IF;
      IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Không gán được B'; END IF;
    END IF;
    SELECT * INTO item FROM "BookingItems" WHERE id=item.id;
    -- The final common call applies guest changes and metadata with the acknowledged revision.
    updates:=updates||jsonb_build_array(edit||jsonb_build_object('segments',jsonb_unwrap_string(item.segments),
      'technicianCodes',to_jsonb(item."technicianCodes"),'status',item.status,'options',jsonb_unwrap_string(item.options)||
      (COALESCE(jsonb_unwrap_string(edit->'options'),'{}')-'dispatchRevision')||jsonb_build_object('dispatchRevision',jsonb_unwrap_string(item.options)->'dispatchRevision')));
  END LOOP;
  result:=dispatch_apply_edit(p_booking_id,p_action,p_payload||jsonb_build_object('itemUpdates',updates),p_actor);
  IF COALESCE((result->>'success')::boolean,false)=false THEN RAISE EXCEPTION 'Chưa lưu được phân công'; END IF;
  RETURN result||jsonb_build_object('savedItems',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',bi.id,'status',bi.status,
    'segments',jsonb_unwrap_string(bi.segments),'options',jsonb_unwrap_string(bi.options),'roomName',bi."roomName",'bedId',bi."bedId") ORDER BY bi.id)
    FROM "BookingItems" bi WHERE bi."bookingId"=p_booking_id AND bi.id IN(SELECT value->>'id' FROM jsonb_array_elements(updates))),'[]'));
END $$;
REVOKE ALL ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION dispatch_commit_form(text,text,jsonb,jsonb) TO service_role;
