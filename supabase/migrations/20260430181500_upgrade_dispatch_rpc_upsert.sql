-- Cập nhật RPC dispatch_confirm_booking để hỗ trợ UPSERT cho TurnQueue
CREATE OR REPLACE FUNCTION dispatch_confirm_booking(
    p_booking_id text,
    p_date date,
    p_status text,
    p_technician_code text,
    p_bed_id text,
    p_room_name text,
    p_notes text,
    p_staff_assignments jsonb,
    p_item_updates jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_assignment jsonb;
    v_item jsonb;
    v_error text;
    v_max_pos integer;
    v_max_checkin integer;
BEGIN
    -- 1. Validate & Insert TurnLedger (Idempotency Check)
    FOR v_assignment IN SELECT jsonb_array_elements(p_staff_assignments)
    LOOP
        BEGIN
            INSERT INTO "TurnLedger" ("date", "booking_id", "employee_id", "source")
            VALUES (p_date, p_booking_id, v_assignment->>'ktvId', 'DISPATCH_CONFIRM')
            ON CONFLICT ("date", "booking_id", "employee_id") DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
            v_error := SQLERRM;
            RAISE EXCEPTION 'Lỗi khi ghi sổ cái cho %: %', v_assignment->>'ktvId', v_error;
        END;

        -- 2. Update hoặc Insert TurnQueue (UPSERT)
        -- Nếu KTV chưa có trong hàng đợi hôm nay (do lỗi điểm danh), ta tự tạo luôn
        INSERT INTO "TurnQueue" (
            "employee_id", "date", "status", "current_order_id", 
            "booking_item_id", "booking_item_ids", "room_id", "bed_id", 
            "queue_position", "start_time", "estimated_end_time", "last_served_at"
        )
        VALUES (
            v_assignment->>'ktvId', 
            p_date, 
            'assigned', 
            p_booking_id,
            v_assignment->>'bookingItemId',
            string_to_array(v_assignment->>'bookingItemId', ','),
            v_assignment->>'roomId',
            v_assignment->>'bedId',
            COALESCE((v_assignment->>'queuePos')::integer, 0),
            (v_assignment->>'startTime')::time,
            (v_assignment->>'endTime')::time,
            now()
        )
        ON CONFLICT ("employee_id", "date") DO UPDATE
        SET 
            "status" = 'assigned',
            "current_order_id" = EXCLUDED."current_order_id",
            "booking_item_id" = EXCLUDED."booking_item_id",
            "booking_item_ids" = EXCLUDED."booking_item_ids",
            "room_id" = EXCLUDED."room_id",
            "bed_id" = EXCLUDED."bed_id",
            "queue_position" = CASE WHEN EXCLUDED."queue_position" > 0 THEN EXCLUDED."queue_position" ELSE "TurnQueue"."queue_position" END,
            "start_time" = EXCLUDED."start_time",
            "estimated_end_time" = EXCLUDED."estimated_end_time",
            "last_served_at" = EXCLUDED."last_served_at";
        
    END LOOP;

    -- 3. Update Bookings
    UPDATE "Bookings"
    SET 
        "status" = COALESCE(p_status, "status"::text)::"BookingStatus",
        "technicianCode" = COALESCE(p_technician_code, "technicianCode"),
        "bedId" = COALESCE(p_bed_id, "bedId"),
        "roomName" = COALESCE(p_room_name, "roomName"),
        "notes" = COALESCE(p_notes, "notes"),
        "updatedAt" = now()
    WHERE "id" = p_booking_id;

    -- 4. Update BookingItems
    IF p_item_updates IS NOT NULL THEN
        FOR v_item IN SELECT jsonb_array_elements(p_item_updates)
        LOOP
            UPDATE "BookingItems"
            SET 
                "roomName" = COALESCE(v_item->>'roomName', "roomName"),
                "bedId" = COALESCE(v_item->>'bedId', "bedId"),
                "status" = COALESCE(v_item->>'status', "status"::text)::"BookingStatus",
                "technicianCodes" = ARRAY(SELECT jsonb_array_elements_text(v_item->'technicianCodes')),
                "segments" = v_item->'segments',
                "options" = v_item->'options'
            WHERE "id" = v_item->>'id';
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
