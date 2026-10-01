-- P0-2 (plans/plan_fix_sequential_p0_p1_20261001.md): lưu form cũ sau khi KTV bàn giao làm mất
-- handoverTime + ảnh. (a) trường bàn giao vào snapshot → RELEASE tăng dispatchRevision;
-- (b) dispatch_commit_form_base giữ bằng chứng KTV từ bản đang lưu.
-- Thân hàm copy nguyên từ 20260927150000 (snapshot, history) và 20260929160000 (commit_form_base).
CREATE OR REPLACE FUNCTION dispatch_edit_snapshot(p_segments jsonb, p_options jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'segments', COALESCE((SELECT jsonb_object_agg(s->>'id', jsonb_strip_nulls(jsonb_build_object(
      'ktvId', s->'ktvId', 'sequenceSlot', s->'sequenceSlot', 'startTime', s->'startTime',
      'endTime', s->'endTime', 'duration', s->'duration', 'plannedStartAt', s->'plannedStartAt',
      'plannedEndAt', s->'plannedEndAt', 'actualStartTime', s->'actualStartTime',
      'actualEndTime', s->'actualEndTime', 'voided', s->'voided', 'pauses', s->'pauses',
      -- Bằng chứng bàn giao: phải làm tăng dispatchRevision để form quầy mở trước đó
      -- bị từ chối thay vì ghi đè mất ảnh/giờ bàn giao.
      'handoverTime', s->'handoverTime', 'handoverPhotoUrls', s->'handoverPhotoUrls',
      'feedbackTime', s->'feedbackTime')))
      FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(p_segments), '[]')) s WHERE s->>'id' IS NOT NULL), '{}'),
    'names', COALESCE(NULLIF(jsonb_unwrap_string(p_options)->'serviceNamesForKtvs', 'null'), '{}'),
    'displayName', jsonb_unwrap_string(p_options)->'displayName');
$$;

CREATE OR REPLACE FUNCTION keep_dispatch_edit_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_opts jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}');
  new_opts jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}');
  before_state jsonb;
  after_state jsonb;
  changes jsonb := '[]';
  old_seg jsonb;
  new_seg jsonb;
  segment_id text;
  field_name text;
  employee_id text;
  revision bigint := COALESCE((old_opts->>'dispatchRevision')::bigint, 0);
  action_name text := NULLIF(current_setting('app.dispatch_action', true), '');
  actor jsonb := COALESCE(NULLIF(current_setting('app.dispatch_actor', true), '')::jsonb, 'null');
BEGIN
  -- A background writer holding old options must not undo a saved service name.
  IF action_name IS NULL AND COALESCE((new_opts->>'dispatchRevision')::bigint, 0) < revision THEN
    new_opts := (new_opts - 'serviceNamesForKtvs' - 'displayName') ||
      jsonb_build_object('serviceNamesForKtvs', COALESCE(old_opts->'serviceNamesForKtvs', '{}'),
                         'displayName', old_opts->'displayName');
  END IF;
  before_state := dispatch_edit_snapshot(OLD.segments, old_opts);
  after_state := dispatch_edit_snapshot(NEW.segments, new_opts);
  FOR segment_id IN SELECT jsonb_object_keys(before_state->'segments') UNION SELECT jsonb_object_keys(after_state->'segments') LOOP
    old_seg := before_state->'segments'->segment_id;
    new_seg := after_state->'segments'->segment_id;
    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','startTime','endTime','duration','plannedStartAt','plannedEndAt','actualStartTime','actualEndTime','voided','pauses',
      'handoverTime','handoverPhotoUrls','feedbackTime']) LOOP
      IF old_seg->field_name IS DISTINCT FROM new_seg->field_name THEN
        changes := changes || jsonb_build_array(jsonb_build_object('segmentId', segment_id,
          'employeeId', COALESCE(new_seg->>'ktvId', old_seg->>'ktvId'), 'field', field_name,
          'before', old_seg->field_name, 'after', new_seg->field_name));
      END IF;
    END LOOP;
  END LOOP;
  FOR employee_id IN SELECT jsonb_object_keys(before_state->'names') UNION SELECT jsonb_object_keys(after_state->'names') LOOP
    IF before_state->'names'->employee_id IS DISTINCT FROM after_state->'names'->employee_id THEN
      changes := changes || jsonb_build_array(jsonb_build_object('employeeId', employee_id,
        'field', 'serviceNameForKtv', 'before', before_state->'names'->employee_id, 'after', after_state->'names'->employee_id));
    END IF;
  END LOOP;
  IF before_state->'displayName' IS DISTINCT FROM after_state->'displayName' THEN
    changes := changes || jsonb_build_array(jsonb_build_object('field', 'displayName',
      'before', before_state->'displayName', 'after', after_state->'displayName'));
  END IF;
  new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
    'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]'));
  -- Preserve counter entries that arrived while the form was open, plus new entries.
  IF old_opts ? 'counterLog' OR new_opts ? 'counterLog' THEN
    new_opts := jsonb_set(new_opts, '{counterLog}', COALESCE((SELECT jsonb_agg(value ORDER BY first_pos)
      FROM (SELECT value, min(ord) first_pos FROM jsonb_array_elements(
        COALESCE(old_opts->'counterLog', '[]') || COALESCE(new_opts->'counterLog', '[]')) WITH ORDINALITY a(value, ord)
        GROUP BY value) unique_entries), '[]'));
  END IF;
  IF changes <> '[]' OR action_name IS NOT NULL THEN
    revision := revision + 1;
    new_opts := new_opts || jsonb_build_object('dispatchRevision', revision,
      'dispatchHistory', COALESCE(old_opts->'dispatchHistory', '[]') || jsonb_build_array(jsonb_build_object(
        'revision', revision, 'at', clock_timestamp(), 'action', COALESCE(action_name, 'UPDATE'),
        'actor', actor, 'changes', changes)));
  END IF;
  NEW.options := new_opts;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_commit_form_base(p_booking_id text,p_action text,p_payload jsonb,p_actor jsonb)
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
    -- Bằng chứng KTV tạo (ảnh bắt đầu, dép khách, bàn giao, giờ feedback) thuộc về
    -- server. Form quầy chỉ sửa kế hoạch; giữ nguyên bản đang lưu của từng chặng
    -- dù client gửi bản cũ hoặc bỏ trống.
    desired := COALESCE((SELECT jsonb_agg(
        CASE WHEN o.value IS NULL THEN d.value
             ELSE (d.value - ARRAY['handoverTime','handoverPhotoUrls','feedbackTime','reviewTime','startPhotoUrl','guestSlipperPhotoUrl'])
                  || COALESCE((SELECT jsonb_object_agg(k.key, k.value) FROM jsonb_each(o.value) k
                     WHERE k.key = ANY(ARRAY['handoverTime','handoverPhotoUrls','feedbackTime','reviewTime','startPhotoUrl','guestSlipperPhotoUrl'])), '{}')
        END ORDER BY d.ord)
      FROM jsonb_array_elements(desired) WITH ORDINALITY d(value, ord)
      LEFT JOIN LATERAL (SELECT x.value FROM jsonb_array_elements(old) x WHERE x.value->>'id' = d.value->>'id' LIMIT 1) o ON true), '[]');
    edit := edit || jsonb_build_object('segments', desired);
    IF item.status NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED') THEN
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
