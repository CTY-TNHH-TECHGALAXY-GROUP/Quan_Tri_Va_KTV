-- F6b (plans/plan_fix_feedback_test_tay_20261001.md): KTV được bắt đầu đúng chặng mình bấm.
-- Thân hàm copy nguyên từ 20260929010000_unstick_staff_and_running_duration.sql, chỉ thêm khối đổi thứ tự.
CREATE OR REPLACE FUNCTION ktv_start_service_atomic(
  p_booking_id text, p_booking_snapshot jsonb, p_item_snapshots jsonb, p_guest_ratings jsonb,
  p_updates jsonb, p_employee_id text, p_target_segment_id text, p_started_at timestamptz, p_turn_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b "Bookings"%ROWTYPE; t "TurnQueue"%ROWTYPE; result jsonb; service_day date;
BEGIN
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b."timeStart" IS DISTINCT FROM NULLIF(p_booking_snapshot->>'timeStart','')::timestamptz
     OR b.status::text IN ('DONE','CANCELLED','SPLIT') THEN RAISE EXCEPTION 'START snapshot changed; reload'; END IF;
  service_day := b."bookingDate"::date;
  IF service_day IS NULL OR p_started_at IS NULL OR COALESCE(p_employee_id,'') = '' THEN RAISE EXCEPTION 'Invalid START'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_updates) patch,
    jsonb_array_elements(jsonb_unwrap_string(patch->'segments')) seg
    WHERE seg->>'id' = p_target_segment_id AND lower(p_employee_id) = ANY(regexp_split_to_array(lower(seg->>'ktvId'),'\s+-\s+'))
      AND COALESCE(seg->>'voided','false') <> 'true' AND NULLIF(seg->>'actualStartTime','')::timestamptz = p_started_at) THEN
    RAISE EXCEPTION 'Invalid START target';
  END IF;
  -- KTV bấm bắt đầu một chặng đang QUEUED/READY (vd 2 dịch vụ, chặng B đã tới lượt trong khi
  -- dịch vụ kia chưa bắt đầu): đưa chặng đó lên ACTIVE, hạ phân công ACTIVE CHƯA bắt đầu khác
  -- của chính KTV trong ngày về QUEUED. Phân công đã bắt đầu thì không đụng.
  IF EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id=p_employee_id AND business_date=service_day
             AND booking_id=p_booking_id AND segment_id=p_target_segment_id AND status IN ('QUEUED','READY')) THEN
    UPDATE "KtvAssignments" ka SET status='QUEUED', updated_at=clock_timestamp()
      WHERE ka.employee_id=p_employee_id AND ka.business_date=service_day AND ka.status='ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM "BookingItems" i, jsonb_array_elements(COALESCE(jsonb_unwrap_string(i.segments),'[]')) s
                        WHERE i.id=ka.booking_item_id AND (ka.segment_id IS NULL OR s->>'id'=ka.segment_id)
                          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
                          AND COALESCE(s->>'voided','false')<>'true' AND COALESCE(s->>'actualStartTime','')<>'');
    UPDATE "KtvAssignments" SET status='ACTIVE', updated_at=clock_timestamp()
      WHERE employee_id=p_employee_id AND business_date=service_day AND booking_id=p_booking_id
        AND segment_id=p_target_segment_id AND status IN ('QUEUED','READY');
  END IF;
  result := ktv_finish_service_atomic(p_booking_id,p_booking_snapshot,p_item_snapshots,p_guest_ratings,p_updates,'IN_PROGRESS');
  UPDATE "Bookings" SET "timeStart" = COALESCE("timeStart",p_started_at) WHERE id = p_booking_id;
  SELECT * INTO t FROM "TurnQueue" WHERE employee_id = p_employee_id AND date = service_day FOR UPDATE;
  IF NOT FOUND OR (p_turn_patch - ARRAY['status','current_order_id','start_time','estimated_end_time','room_id','bed_id','booking_item_id','booking_item_ids']) <> '{}'
    OR p_turn_patch->>'current_order_id' IS DISTINCT FROM p_booking_id THEN
    RAISE EXCEPTION 'TurnQueue changed; reload';
  END IF;
  IF t.current_order_id IS NOT NULL AND t.current_order_id <> p_booking_id THEN
    IF NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=p_employee_id
      AND ka.business_date=service_day AND ka.booking_id=p_booking_id AND ka.segment_id=p_target_segment_id
      AND ka.status='ACTIVE')
      OR EXISTS (SELECT 1 FROM "BookingItems" old_item,
        jsonb_array_elements(COALESCE(jsonb_unwrap_string(old_item.segments),'[]')) old_seg
        WHERE old_item."bookingId"=t.current_order_id
          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(old_seg->>'ktvId'),'\s+-\s+'))
          AND COALESCE(old_seg->>'voided','false')<>'true'
          AND COALESCE(old_seg->>'actualStartTime','')<>''
          AND (COALESCE(old_seg->>'actualEndTime','')='' OR (COALESCE(old_seg->>'handoverTime','')=''
            AND NOT (old_item.handover_status='SKIPPED' AND old_item.handover_skipped IS TRUE)))) THEN
      RAISE EXCEPTION 'Ca trước chưa bàn giao hoặc phân công mới đã đổi; tải lại';
    END IF;
  END IF;
  SELECT * INTO t FROM jsonb_populate_record(t,p_turn_patch);
  UPDATE "TurnQueue" SET status = t.status, current_order_id = t.current_order_id,
    start_time = t.start_time, estimated_end_time = t.estimated_end_time,
    room_id = t.room_id, bed_id = t.bed_id, booking_item_id = t.booking_item_id, booking_item_ids = t.booking_item_ids
    WHERE employee_id = p_employee_id AND date = service_day;
  SELECT * INTO b FROM "Bookings" WHERE id = p_booking_id;
  RETURN jsonb_build_object('success',true,'booking',to_jsonb(b));
END $$;

-- Sửa dữ liệu TEST: phân công bị ghi đè segment_id=null bởi dòng "giữ chỗ" thiếu segmentId
-- (page.tsx keepalive). Gán lại khi item chỉ có đúng 1 chặng sống của KTV đó.
UPDATE "KtvAssignments" ka SET segment_id = x.seg_id, updated_at = clock_timestamp()
FROM (SELECT ka2.id, min(s->>'id') seg_id
      FROM "KtvAssignments" ka2 JOIN "BookingItems" i ON i.id = ka2.booking_item_id,
           jsonb_array_elements(COALESCE(jsonb_unwrap_string(i.segments),'[]')) s
      WHERE ka2.segment_id IS NULL AND ka2.status IN ('ACTIVE','QUEUED','READY')
        AND s->>'ktvId' = ka2.employee_id AND COALESCE(s->>'voided','false') <> 'true'
      GROUP BY ka2.id HAVING count(*) = 1) x
WHERE ka.id = x.id;
