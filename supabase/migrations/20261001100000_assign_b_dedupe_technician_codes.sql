-- F3 (plans/plan_fix_feedback_test_tay_20261001.md): gán B không được thêm KTV đã có sẵn
-- trong technicianCodes (TEST: ["B","C","C"] → hai dòng "C" trên điều phối/Kanban).
-- Thân hàm copy nguyên từ 20260929160000_live_queue_and_early_b.sql, chỉ đổi 1 dòng.
CREATE OR REPLACE FUNCTION dispatch_assign_sequential_slot_b(
    p_booking_id text, p_item_id text, p_to_ktv text,
    p_planned_start_at timestamptz, p_duration_minutes integer, p_confirm_overlap boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_a_assignment "KtvAssignments"%ROWTYPE;
    v_turn "TurnQueue"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_new_b jsonb;
    v_reference timestamptz;
    v_old_ktv text;
    v_b_id text;
    v_end_at timestamptz;
    v_service_day date;
    v_expected_at timestamptz;
BEGIN
    IF COALESCE(p_to_ktv, '') = '' OR p_planned_start_at IS NULL
       OR p_duration_minutes NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'Thông tin lượt B không hợp lệ';
    END IF;
    SELECT "bookingDate"::date INTO v_service_day FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF v_service_day IS NULL THEN RAISE EXCEPTION 'Missing service day'; END IF;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS', 'PAUSED') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND (COALESCE(value->>'voided', 'false') <> 'true'
      OR (COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb AND value->>'note'='CANCELLED_NO_CREDIT'))
    ORDER BY COALESCE(value->>'voided','false')='true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR (COALESCE(v_options->>'finishedAfterA', 'false') = 'true' OR COALESCE(v_options->'closedSequentialSlots','[]') @> '[2]'::jsonb)
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND (status IN ('ACTIVE', 'COMPLETED')
        OR (status='CANCELLED' AND COALESCE(v_options->'closedSequentialSlots','[]') @> '[1]'::jsonb))
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phân công của A'; END IF;
    v_reference := COALESCE(NULLIF(v_a->>'actualEndTime', '')::timestamptz,
                            v_a_assignment.planned_end_time);
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND v_reference IS NOT NULL THEN
        IF v_a_assignment.planned_start_time IS NOT NULL
           AND v_reference <= v_a_assignment.planned_start_time THEN
            v_reference := v_reference + interval '1 day';
        END IF;
    END IF;
    v_expected_at := (v_service_day + (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time < (v_a->>'startTime')::time THEN
        v_expected_at := v_expected_at + interval '1 day';
    END IF;
    IF p_planned_start_at IS DISTINCT FROM v_expected_at OR v_a_assignment.business_date <> v_service_day THEN
        RAISE EXCEPTION 'B must follow the booking service day; reload plan';
    END IF;
    IF v_reference IS NULL THEN RAISE EXCEPTION 'Giờ kết thúc của A chưa hợp lệ; hãy sửa mốc A'; END IF;
    IF p_planned_start_at < v_reference AND COALESCE(p_confirm_overlap, false) = false THEN
        RETURN jsonb_build_object('success', false, 'code', 'OVERLAP_CONFIRM_REQUIRED',
            'referenceAt', v_reference, 'referenceKind',
            CASE WHEN COALESCE(v_a->>'actualEndTime', '') <> '' THEN 'actual' ELSE 'planned' END);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Staff" WHERE id = p_to_ktv AND status = 'ĐANG LÀM') THEN
        RAISE EXCEPTION 'KTV B không khả dụng';
    END IF;
    v_old_ktv := v_b->>'ktvId';
    SELECT * INTO v_turn FROM "TurnQueue"
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date FOR UPDATE;
    IF NOT FOUND OR (p_to_ktv IS DISTINCT FROM v_old_ktv
       AND (v_turn.status <> 'waiting' OR v_turn.current_order_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'KTV B không còn rảnh; tải lại sổ tua';
    END IF;
    IF EXISTS (SELECT 1 FROM "KtvAssignments"
               WHERE employee_id = p_to_ktv AND business_date = v_a_assignment.business_date
                 AND status = 'ACTIVE' AND (booking_item_id <> p_item_id OR segment_id IS DISTINCT FROM v_b->>'id')) THEN
        RAISE EXCEPTION 'KTV B đang có phân công khác';
    END IF;
    v_end_at := p_planned_start_at + make_interval(mins => p_duration_minutes);
    IF EXISTS (SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id = p_to_ktv
      AND ka.status = 'ACTIVE' AND (ka.booking_item_id <> p_item_id OR ka.segment_id IS DISTINCT FROM v_b->>'id')
      AND ka.planned_start_time < v_end_at AND ka.planned_end_time > p_planned_start_at) THEN
        RAISE EXCEPTION 'KTV B has another overlapping assignment';
    END IF;
    v_b_id := CASE WHEN p_to_ktv = v_old_ktv THEN v_b->>'id' ELSE gen_random_uuid()::text END;
    v_new_b := jsonb_build_object(
        'id', v_b_id, 'ktvId', p_to_ktv, 'sequenceSlot', 2,
        'roomId', v_a->'roomId', 'bedId', v_a->'bedId',
        'plannedStartAt', p_planned_start_at, 'plannedEndAt', v_end_at,
        'startTime', to_char(p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'endTime', to_char(v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI'),
        'duration', p_duration_minutes);
    IF v_b IS NOT NULL THEN
        IF p_to_ktv = v_old_ktv THEN
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b_id THEN v_new_b ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        ELSE
            v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                                  THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                           FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
            v_segments := v_segments || jsonb_build_array(v_new_b);
            UPDATE "KtvAssignments" SET status = 'CANCELLED'
            WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
            DELETE FROM "TurnLedger" tl USING "Bookings" booking
            WHERE booking.id = p_booking_id AND tl.date = v_a_assignment.business_date
              AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
              AND tl.employee_id = v_old_ktv
              AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                              JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                              WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                                AND ka.business_date = tl.date AND ka.employee_id = v_old_ktv
                                AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
            PERFORM promote_next_assignment(v_old_ktv, v_a_assignment.business_date);
        END IF;
    ELSE
        v_segments := v_segments || jsonb_build_array(v_new_b);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET segments = v_segments,
        "technicianCodes" = array_append(array_remove(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv), p_to_ktv)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    INSERT INTO "KtvAssignments" (employee_id, business_date, booking_id, booking_item_id,
        segment_id, planned_start_time, planned_end_time, room_id, bed_id, status, dispatch_source)
    VALUES (p_to_ktv, v_a_assignment.business_date, p_booking_id, p_item_id, v_b_id,
        p_planned_start_at, v_end_at, v_a->>'roomId', v_a->>'bedId', 'ACTIVE', 'SEQUENTIAL_SLOT_B')
    ON CONFLICT (employee_id, booking_item_id) DO UPDATE SET
        segment_id = EXCLUDED.segment_id, planned_start_time = EXCLUDED.planned_start_time,
        planned_end_time = EXCLUDED.planned_end_time, status = 'ACTIVE',
        dispatch_source = EXCLUDED.dispatch_source;
    UPDATE "TurnQueue" SET status = 'assigned', current_order_id = p_booking_id,
        booking_item_id = p_item_id, booking_item_ids = ARRAY[p_item_id]::text[],
        room_id = v_a->>'roomId', bed_id = v_a->>'bedId',
        start_time = (p_planned_start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time = (v_end_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
    WHERE employee_id = p_to_ktv AND date = v_a_assignment.business_date;
    INSERT INTO "TurnLedger" (date, booking_id, employee_id, source)
    SELECT v_a_assignment.business_date, COALESCE(parent_booking_id, id), p_to_ktv, 'DISPATCH_CONFIRM'
    FROM "Bookings" WHERE id = p_booking_id
    ON CONFLICT (date, booking_id, employee_id) DO NOTHING;
    RETURN jsonb_build_object('success', true, 'segmentId', v_b_id);
END;
$$;

-- Dọn mảng đã bị trùng (giữ thứ tự xuất hiện đầu tiên).
UPDATE "BookingItems" SET "technicianCodes" = ARRAY(
    SELECT c FROM (SELECT c, min(o) o FROM unnest("technicianCodes") WITH ORDINALITY u(c, o) GROUP BY c) x ORDER BY o)
WHERE cardinality("technicianCodes") <> (SELECT count(DISTINCT c) FROM unnest("technicianCodes") c);
