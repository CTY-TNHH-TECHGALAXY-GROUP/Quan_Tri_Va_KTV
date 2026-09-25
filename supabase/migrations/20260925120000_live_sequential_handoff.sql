-- Two explicit positions on one BookingItem. Check migration history before deploying.
-- jsonb_unwrap_string is defined by 20260914120000_auto_complete_feedback_after_5m.sql.

CREATE OR REPLACE FUNCTION dispatch_enable_sequential_item(p_booking_id text, p_item_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
BEGIN
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF jsonb_typeof(v_options) <> 'object' OR jsonb_typeof(v_segments) <> 'array'
       OR jsonb_array_length(v_segments) <> 1 THEN
        RAISE EXCEPTION 'Chỉ chọn nối tiếp cho dịch vụ có một chặng A';
    END IF;
    v_a := v_segments->0;
    IF COALESCE(v_a->>'ktvId', '') = '' OR COALESCE(v_a->>'id', '') = ''
       OR COALESCE(v_a->>'voided', 'false') = 'true' THEN
        RAISE EXCEPTION 'Chặng A không hợp lệ';
    END IF;
    IF COALESCE(v_a->>'actualEndTime', '') = '' AND NOT EXISTS (
        SELECT 1 FROM "KtvAssignments" WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
          AND employee_id = v_a->>'ktvId' AND planned_end_time IS NOT NULL
          AND status IN ('ACTIVE', 'COMPLETED')) THEN
        RAISE EXCEPTION 'Hãy sửa giờ kết thúc dự kiến của A trước khi chọn nối tiếp';
    END IF;
    IF v_options->>'sequentialSlots' = '2' THEN
        RETURN jsonb_build_object('success', true);
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET
        options = v_options || '{"sequentialSlots":2}'::jsonb,
        segments = jsonb_build_array(v_a || '{"sequenceSlot":1}'::jsonb)
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    RETURN jsonb_build_object('success', true);
END;
$$;

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
BEGIN
    IF COALESCE(p_to_ktv, '') = '' OR p_planned_start_at IS NULL
       OR p_duration_minutes NOT BETWEEN 1 AND 600 THEN
        RAISE EXCEPTION 'Thông tin lượt B không hợp lệ';
    END IF;
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status NOT IN ('PREPARING', 'READY', 'IN_PROGRESS') THEN
        RAISE EXCEPTION 'Dịch vụ đã thay đổi; tải lại đơn';
    END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' OR jsonb_typeof(v_segments) <> 'array' THEN
        RAISE EXCEPTION 'Quầy chưa chọn chế độ nối tiếp';
    END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF v_a IS NULL OR p_to_ktv = v_a->>'ktvId' OR COALESCE(v_options->>'finishedAfterA', 'false') = 'true'
       OR (v_b IS NOT NULL AND COALESCE(v_b->>'actualStartTime', '') <> '') THEN
        RAISE EXCEPTION 'Không thể gán B: A/B đã thay đổi';
    END IF;
    SELECT * INTO v_a_assignment FROM "KtvAssignments"
    WHERE booking_id = p_booking_id AND booking_item_id = p_item_id
      AND employee_id = v_a->>'ktvId' AND status IN ('ACTIVE', 'COMPLETED')
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
        "technicianCodes" = array_append(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv)
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

CREATE OR REPLACE FUNCTION dispatch_finish_sequential_after_a(p_booking_id text, p_item_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item "BookingItems"%ROWTYPE;
    v_segments jsonb;
    v_options jsonb;
    v_a jsonb;
    v_b jsonb;
    v_date date;
BEGIN
    SELECT * INTO v_item FROM "BookingItems"
    WHERE id = p_item_id AND "bookingId" = p_booking_id FOR UPDATE;
    IF NOT FOUND OR v_item.status <> 'IN_PROGRESS' THEN RAISE EXCEPTION 'Dịch vụ đã thay đổi'; END IF;
    v_options := COALESCE(jsonb_unwrap_string(v_item.options), '{}'::jsonb);
    v_segments := COALESCE(jsonb_unwrap_string(v_item.segments), '[]'::jsonb);
    IF v_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Không phải dịch vụ nối tiếp'; END IF;
    SELECT value INTO v_a FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '1' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    SELECT value INTO v_b FROM jsonb_array_elements(v_segments)
    WHERE value->>'sequenceSlot' = '2' AND COALESCE(value->>'voided', 'false') <> 'true' LIMIT 1;
    IF COALESCE(v_a->>'actualStartTime', '') = '' OR COALESCE(v_a->>'actualEndTime', '') = ''
       OR COALESCE(v_b->>'actualStartTime', '') <> '' THEN
        RAISE EXCEPTION 'Chỉ kết thúc sau A khi A đã xong và B chưa bắt đầu';
    END IF;
    IF v_b IS NOT NULL THEN
        v_segments := (SELECT jsonb_agg(CASE WHEN value->>'id' = v_b->>'id'
                                              THEN value || '{"voided":true}'::jsonb ELSE value END ORDER BY ord)
                       FROM jsonb_array_elements(v_segments) WITH ORDINALITY AS rows(value, ord));
        SELECT business_date INTO v_date FROM "KtvAssignments"
        WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE'
        LIMIT 1 FOR UPDATE;
        UPDATE "KtvAssignments" SET status = 'CANCELLED'
        WHERE booking_item_id = p_item_id AND segment_id = v_b->>'id' AND status = 'ACTIVE';
        DELETE FROM "TurnLedger" tl USING "Bookings" booking
        WHERE booking.id = p_booking_id AND tl.date = v_date
          AND tl.booking_id = COALESCE(booking.parent_booking_id, booking.id)
          AND tl.employee_id = v_b->>'ktvId'
          AND NOT EXISTS (SELECT 1 FROM "KtvAssignments" ka
                          JOIN "Bookings" other_booking ON other_booking.id = ka.booking_id
                          WHERE COALESCE(other_booking.parent_booking_id, other_booking.id) = tl.booking_id
                            AND ka.business_date = tl.date AND ka.employee_id = v_b->>'ktvId'
                            AND ka.status IN ('ACTIVE', 'QUEUED', 'READY', 'COMPLETED'));
        IF v_date IS NOT NULL THEN PERFORM promote_next_assignment(v_b->>'ktvId', v_date); END IF;
    END IF;
    PERFORM set_config('app.sequential_rpc', '1', true);
    UPDATE "BookingItems" SET options = v_options || '{"finishedAfterA":true}'::jsonb,
        segments = v_segments, status = 'CLEANING', "timeEnd" = clock_timestamp(),
        "technicianCodes" = array_remove("technicianCodes", v_b->>'ktvId')
    WHERE id = p_item_id;
    PERFORM set_config('app.sequential_rpc', '', true);
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Merge concurrent KTV writes by segment ID and reject terminal status while a slot is open.
CREATE OR REPLACE FUNCTION guard_sequential_item_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_old_options jsonb := COALESCE(jsonb_unwrap_string(OLD.options), '{}'::jsonb);
    v_new_options jsonb := COALESCE(jsonb_unwrap_string(NEW.options), '{}'::jsonb);
    v_old_segments jsonb := COALESCE(jsonb_unwrap_string(OLD.segments), '[]'::jsonb);
    v_new_segments jsonb := COALESCE(jsonb_unwrap_string(NEW.segments), '[]'::jsonb);
    v_old jsonb;
    v_in jsonb;
    v_out jsonb := '[]'::jsonb;
    v_a_done boolean;
    v_b_done boolean;
BEGIN
    IF v_old_options->>'sequentialSlots' IS DISTINCT FROM '2' AND v_new_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN RETURN NEW; END IF;
    IF v_old_options->>'sequentialSlots' = '2' AND v_new_options->>'sequentialSlots' IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'Không được bỏ chế độ nối tiếp qua lưu đơn cũ';
    END IF;
    IF v_old_options->>'finishedAfterA' = 'true' AND v_new_options->>'finishedAfterA' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Dịch vụ đã kết thúc sau A; tải lại đơn';
    END IF;
    IF v_old_options->>'finishedAfterA' IS DISTINCT FROM 'true'
       AND v_new_options->>'finishedAfterA' = 'true'
       AND current_setting('app.sequential_rpc', true) IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'Chỉ được kết thúc sau A qua thao tác quầy';
    END IF;
    IF jsonb_typeof(v_new_segments) <> 'array' THEN RAISE EXCEPTION 'Segments nối tiếp không hợp lệ'; END IF;
    IF v_old_options->>'sequentialSlots' = '2' AND current_setting('app.sequential_rpc', true) IS DISTINCT FROM '1' THEN
        FOR v_old IN SELECT value FROM jsonb_array_elements(v_old_segments) LOOP
            SELECT value INTO v_in FROM jsonb_array_elements(v_new_segments)
            WHERE value->>'id' = v_old->>'id' LIMIT 1;
            IF v_in IS NULL THEN v_in := v_old; END IF;
            IF COALESCE(v_old->>'voided', 'false') = 'true' THEN
                IF COALESCE(v_in->>'actualStartTime', '') <> COALESCE(v_old->>'actualStartTime', '') THEN
                    RAISE EXCEPTION 'Lượt KTV đã được thay; tải lại đơn';
                END IF;
                v_out := v_out || jsonb_build_array(v_old);
                CONTINUE;
            END IF;
            -- Assignment/slot changes belong to the locked RPC. A stale KTV write
            -- must not revive a replaced B or move either slot's planned time.
            v_in := v_in || jsonb_build_object(
                'ktvId', v_old->'ktvId', 'sequenceSlot', v_old->'sequenceSlot',
                'voided', v_old->'voided', 'roomId', v_old->'roomId',
                'bedId', v_old->'bedId', 'startTime', v_old->'startTime',
                'endTime', v_old->'endTime', 'duration', v_old->'duration',
                'plannedStartAt', v_old->'plannedStartAt',
                'plannedEndAt', v_old->'plannedEndAt');
            IF COALESCE(v_old->>'actualStartTime', '') <> '' THEN
                v_in := jsonb_set(v_in, '{actualStartTime}', v_old->'actualStartTime', true);
            END IF;
            IF COALESCE(v_old->>'actualEndTime', '') <> '' THEN
                v_in := jsonb_set(v_in, '{actualEndTime}', v_old->'actualEndTime', true);
            END IF;
            v_out := v_out || jsonb_build_array(v_in);
        END LOOP;
        NEW.segments := v_out;
        v_new_segments := v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_segments) s
               WHERE COALESCE(s->>'voided', 'false') <> 'true'
                 AND COALESCE(s->>'actualEndTime', '') <> ''
                 AND COALESCE(s->>'actualStartTime', '') = '') THEN
        RAISE EXCEPTION 'Không thể kết thúc lượt KTV chưa bắt đầu';
    END IF;
    SELECT COALESCE(bool_or(COALESCE(s->>'actualStartTime', '') <> '' AND COALESCE(s->>'actualEndTime', '') <> ''), false)
    INTO v_a_done FROM jsonb_array_elements(v_new_segments) s
    WHERE s->>'sequenceSlot' = '1' AND COALESCE(s->>'voided', 'false') <> 'true';
    SELECT COALESCE(bool_or(COALESCE(s->>'actualStartTime', '') <> '' AND COALESCE(s->>'actualEndTime', '') <> ''), false)
    INTO v_b_done FROM jsonb_array_elements(v_new_segments) s
    WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'voided', 'false') <> 'true';
    IF NEW.status NOT IN ('CANCELLED', 'PAUSED', 'IN_PROGRESS', 'PREPARING', 'READY', 'WAITING', 'NEW')
       AND NOT (v_a_done AND (v_b_done OR (COALESCE(v_new_options->>'finishedAfterA', 'false') = 'true'
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new_segments) s
                           WHERE s->>'sequenceSlot' = '2' AND COALESCE(s->>'actualStartTime', '') <> '')))) THEN
        RAISE EXCEPTION 'Dịch vụ nối tiếp còn lượt chưa hoàn tất';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_live_handoff_segments_trigger ON "BookingItems";
DROP TRIGGER IF EXISTS guard_sequential_item_update_trigger ON "BookingItems";
CREATE TRIGGER guard_sequential_item_update_trigger
BEFORE UPDATE OF segments, options, status ON "BookingItems"
FOR EACH ROW EXECUTE FUNCTION guard_sequential_item_update();
DROP TRIGGER IF EXISTS guard_live_handoff_assignment_trigger ON "KtvAssignments";
DROP FUNCTION IF EXISTS dispatch_live_sequential_handoff(text,text,text,text,text,integer);

REVOKE ALL ON FUNCTION dispatch_enable_sequential_item(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dispatch_assign_sequential_slot_b(text,text,text,timestamptz,integer,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION dispatch_finish_sequential_after_a(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_enable_sequential_item(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_assign_sequential_slot_b(text,text,text,timestamptz,integer,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION dispatch_finish_sequential_after_a(text,text) TO service_role;
