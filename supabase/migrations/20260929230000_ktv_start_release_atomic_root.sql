-- KTV START/RELEASE must commit every affected row together. Only the server role calls these RPCs.
CREATE OR REPLACE FUNCTION ktv_start_work_atomic(
  p_booking_id text, p_employee_id text, p_target_item_id text, p_target_segment_id text,
  p_expected jsonb, p_updates jsonb, p_started_at timestamptz,
  p_turn_id uuid, p_turn_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  b "Bookings"%ROWTYPE; item "BookingItems"%ROWTYPE; turn "TurnQueue"%ROWTYPE;
  expected jsonb; patch jsonb; old_segments jsonb; new_segments jsonb;
  old_target jsonb; new_target jsonb; service_day date;
BEGIN
  IF p_started_at IS NULL OR COALESCE(p_employee_id,'')='' OR jsonb_typeof(p_expected)<>'array'
     OR jsonb_typeof(p_updates)<>'array' OR jsonb_array_length(p_expected)=0
     OR jsonb_array_length(p_expected)<>jsonb_array_length(p_updates) THEN
    RAISE EXCEPTION 'START payload invalid';
  END IF;
  SELECT * INTO b FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN
    RAISE EXCEPTION 'Đơn đã thay đổi; tải lại';
  END IF;
  service_day:=b."bookingDate"::date;
  PERFORM id FROM "BookingItems" WHERE "bookingId"=p_booking_id ORDER BY id FOR UPDATE;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_expected))<>jsonb_array_length(p_expected)
     OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_updates))<>jsonb_array_length(p_updates) THEN
    RAISE EXCEPTION 'START items invalid';
  END IF;
  FOR expected IN SELECT value FROM jsonb_array_elements(p_expected) LOOP
    SELECT * INTO item FROM "BookingItems" WHERE id=expected->>'id' AND "bookingId"=p_booking_id;
    SELECT value INTO patch FROM jsonb_array_elements(p_updates) WHERE value->>'id'=item.id;
    IF NOT FOUND OR patch IS NULL OR item.status::text IN ('DONE','CANCELLED')
       OR item.status::text IS DISTINCT FROM expected->>'status'
       OR jsonb_unwrap_string(item.segments) IS DISTINCT FROM jsonb_unwrap_string(expected->'segments') THEN
      RAISE EXCEPTION 'Ca đã thay đổi; tải lại trước khi bắt đầu';
    END IF;
    old_segments:=jsonb_unwrap_string(item.segments);
    new_segments:=jsonb_unwrap_string(patch->'segments');
    IF jsonb_typeof(old_segments)<>'array' OR jsonb_typeof(new_segments)<>'array'
       OR jsonb_array_length(old_segments)<>jsonb_array_length(new_segments)
       OR patch->>'status'<>'IN_PROGRESS' THEN
      RAISE EXCEPTION 'START segments invalid';
    END IF;
    IF item.id=p_target_item_id THEN
      SELECT value INTO old_target FROM jsonb_array_elements(old_segments) WHERE value->>'id'=p_target_segment_id;
      SELECT value INTO new_target FROM jsonb_array_elements(new_segments) WHERE value->>'id'=p_target_segment_id;
      IF old_target IS NULL OR new_target IS NULL OR COALESCE(old_target->>'actualStartTime','')<>''
         OR COALESCE(old_target->>'actualEndTime','')<>''
         OR lower(p_employee_id)<>lower(old_target->>'ktvId')
         OR (new_target->>'actualStartTime')::timestamptz IS DISTINCT FROM p_started_at THEN
        RAISE EXCEPTION 'Chặng đã bắt đầu hoặc không còn được gán; tải lại';
      END IF;
    END IF;
    UPDATE "BookingItems" SET segments=new_segments,status='IN_PROGRESS' WHERE id=item.id;
  END LOOP;
  IF old_target IS NULL THEN RAISE EXCEPTION 'START target missing'; END IF;
  -- Keep merged display-only children in sync with their parent in this commit.
  UPDATE "BookingItems" child SET status=parent.status
    FROM "BookingItems" parent
    WHERE child."bookingId"=p_booking_id AND parent."bookingId"=p_booking_id
      AND parent.id=jsonb_unwrap_string(child.options)->>'mergedIntoId'
      AND child.status IS DISTINCT FROM parent.status
      AND child.status::text NOT IN ('DONE','CANCELLED');
  IF p_turn_id IS NOT NULL THEN
    SELECT * INTO turn FROM "TurnQueue" WHERE id=p_turn_id AND employee_id=p_employee_id AND date=service_day FOR UPDATE;
    IF NOT FOUND OR (turn.current_order_id IS NOT NULL AND turn.current_order_id<>p_booking_id)
       OR (p_turn_patch-ARRAY['status','start_time','current_order_id','room_id','bed_id',
                              'booking_item_id','booking_item_ids','estimated_end_time'])<>'{}'::jsonb
       OR p_turn_patch->>'current_order_id' IS DISTINCT FROM p_booking_id THEN
      RAISE EXCEPTION 'Sổ tua đã thay đổi; tải lại';
    END IF;
    SELECT * INTO turn FROM jsonb_populate_record(turn,p_turn_patch);
    UPDATE "TurnQueue" SET status=turn.status,start_time=turn.start_time,
      current_order_id=turn.current_order_id,room_id=turn.room_id,bed_id=turn.bed_id,
      booking_item_id=turn.booking_item_id,booking_item_ids=turn.booking_item_ids,
      estimated_end_time=turn.estimated_end_time WHERE id=p_turn_id;
  END IF;
  UPDATE "Bookings" SET "timeStart"=COALESCE("timeStart",p_started_at),status='IN_PROGRESS',
    "updatedAt"=clock_timestamp() WHERE id=p_booking_id;
  RETURN jsonb_build_object('success',true);
END $$;

CREATE OR REPLACE FUNCTION ktv_release_work_root_atomic(
  p_booking_id text, p_employee_id text, p_business_date date, p_photo_urls jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  item "BookingItems"%ROWTYPE; segments jsonb; updated_segments jsonb; seg jsonb;
  images jsonb; changed boolean; finished_ids text[]:='{}';
  now_at timestamptz:=clock_timestamp(); promotion jsonb;
BEGIN
  IF COALESCE(p_employee_id,'')='' OR jsonb_typeof(p_photo_urls)<>'array'
     OR jsonb_array_length(p_photo_urls)>20 OR EXISTS(
       SELECT 1 FROM jsonb_array_elements(p_photo_urls) value WHERE jsonb_typeof(value)<>'string') THEN
    RAISE EXCEPTION 'RELEASE payload invalid';
  END IF;
  PERFORM id FROM "Bookings" WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Đơn không tồn tại'; END IF;
  PERFORM id FROM "BookingItems" WHERE "bookingId"=p_booking_id ORDER BY id FOR UPDATE;
  FOR item IN SELECT * FROM "BookingItems" WHERE "bookingId"=p_booking_id ORDER BY id LOOP
    segments:=jsonb_unwrap_string(item.segments);
    IF jsonb_typeof(segments)<>'array' THEN RAISE EXCEPTION 'Segments invalid'; END IF;
    changed:=false;
    updated_segments:='[]'::jsonb;
    FOR seg IN SELECT value FROM jsonb_array_elements(segments) LOOP
      IF lower(COALESCE(seg->>'ktvId',''))=lower(p_employee_id)
         AND COALESCE(seg->>'actualStartTime','')<>'' AND COALESCE(seg->>'actualEndTime','')<>''
         AND COALESCE(seg->>'voided','false')<>'true' THEN
        changed:=true;
        IF COALESCE(seg->>'handoverTime','')='' THEN
          IF jsonb_array_length(p_photo_urls)=0 AND item.handover_status IS DISTINCT FROM 'SKIPPED' THEN
            RAISE EXCEPTION 'Cần ảnh bàn giao hoặc bỏ qua bàn giao hợp lệ';
          END IF;
          IF jsonb_array_length(p_photo_urls)>0 THEN
            seg:=seg||jsonb_build_object('handoverTime',now_at,'handoverPhotoUrls',p_photo_urls);
          END IF;
        END IF;
      END IF;
      updated_segments:=updated_segments||jsonb_build_array(seg);
    END LOOP;
    IF changed THEN
      finished_ids:=array_append(finished_ids,item.id);
      IF jsonb_array_length(p_photo_urls)>0 THEN
        SELECT COALESCE(jsonb_object_agg(p_employee_id||' · Ảnh '||ord::text,value),'{}'::jsonb)
          INTO images FROM jsonb_array_elements(p_photo_urls) WITH ORDINALITY v(value,ord);
        UPDATE "BookingItems" SET segments=updated_segments,
          handover_images=(CASE WHEN jsonb_typeof(item.handover_images)='object' THEN item.handover_images
            WHEN jsonb_typeof(item.handover_images)='array' THEN (
              SELECT COALESCE(jsonb_object_agg('Ảnh cũ '||ord::text,value),'{}'::jsonb)
              FROM jsonb_array_elements(item.handover_images) WITH ORDINALITY v(value,ord))
            ELSE '{}'::jsonb END)||images,
          handover_status='PENDING',handover_skipped=false,handover_submitted_at=now_at WHERE id=item.id;
      ELSE
        UPDATE "BookingItems" SET segments=updated_segments WHERE id=item.id;
      END IF;
    END IF;
  END LOOP;
  IF cardinality(finished_ids)=0 THEN RAISE EXCEPTION 'Không có ca đã làm xong để bàn giao'; END IF;
  UPDATE "KtvAssignments" SET status='COMPLETED',updated_at=now_at
    WHERE employee_id=p_employee_id AND business_date=p_business_date AND booking_id=p_booking_id
      AND booking_item_id=ANY(finished_ids) AND status IN ('ACTIVE','QUEUED','READY')
      AND (segment_id IS NULL OR EXISTS(
        SELECT 1 FROM "BookingItems" bi,jsonb_array_elements(jsonb_unwrap_string(bi.segments)) entry
        WHERE bi.id=booking_item_id AND entry->>'id'=segment_id
          AND lower(entry->>'ktvId')=lower(p_employee_id)
          AND COALESCE(entry->>'actualStartTime','')<>'' AND COALESCE(entry->>'actualEndTime','')<>''));
  -- A still-working segment must retain the employee's current order.
  IF NOT EXISTS(SELECT 1 FROM "BookingItems" bi,jsonb_array_elements(jsonb_unwrap_string(bi.segments)) entry
      WHERE bi."bookingId"=p_booking_id AND lower(entry->>'ktvId')=lower(p_employee_id)
        AND COALESCE(entry->>'voided','false')<>'true' AND COALESCE(entry->>'actualStartTime','')<>''
        AND COALESCE(entry->>'actualEndTime','')='')
     AND NOT EXISTS(SELECT 1 FROM "KtvAssignments" WHERE employee_id=p_employee_id
       AND business_date=p_business_date AND status='ACTIVE')
     AND NOT EXISTS(SELECT 1 FROM "TurnQueue" WHERE employee_id=p_employee_id AND date=p_business_date
       AND current_order_id IS NOT NULL AND current_order_id<>p_booking_id) THEN
    UPDATE "TurnQueue" SET status='assigned' WHERE employee_id=p_employee_id AND date=p_business_date
      AND current_order_id=p_booking_id AND status='working';
    promotion:=promote_next_assignment(p_employee_id,p_business_date);
    IF promotion ? 'success' AND COALESCE((promotion->>'success')::boolean,false)=false THEN
      RAISE EXCEPTION 'Không kéo được đơn kế tiếp: %',COALESCE(promotion->>'error',promotion->>'message','unknown');
    END IF;
  END IF;
  RETURN jsonb_build_object('success',true);
END $$;

REVOKE ALL ON FUNCTION ktv_start_work_atomic(text,text,text,text,jsonb,jsonb,timestamptz,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_start_work_atomic(text,text,text,text,jsonb,jsonb,timestamptz,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION ktv_release_work_root_atomic(text,text,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_root_atomic(text,text,date,jsonb) TO service_role;
