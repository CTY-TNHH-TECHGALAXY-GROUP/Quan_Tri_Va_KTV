-- Fix: estimated_end_time và start_time bị lưu sai múi giờ (UTC thay vì VN)
-- Nguyên nhân: ON CONFLICT UPDATE dùng AT TIME ZONE 'Asia/Bangkok' chuyển VN→UTC trước khi ::time
-- Fix: cast trực tiếp elem->>'endTime'::time giống nhánh INSERT

CREATE OR REPLACE FUNCTION dispatch_confirm_booking(
    p_booking_id text,
    p_date date,
    p_item_updates jsonb,
    p_staff_assignments jsonb
) RETURNS void AS $$
DECLARE
    v_item jsonb;
    v_assignment jsonb;
    v_booking_item_id text;
BEGIN
    -- ============================================================
    -- PHASE 1: Dọn dẹp TurnQueue CŨ cho booking này
    -- ============================================================
    UPDATE "TurnQueue"
    SET 
        "status" = 'waiting',
        "current_order_id" = NULL,
        "booking_item_id" = NULL,
        "booking_item_ids" = NULL,
        "room_id" = NULL,
        "bed_id" = NULL,
        "start_time" = NULL,
        "estimated_end_time" = NULL
    WHERE "date" = p_date
      AND "current_order_id" = p_booking_id
      AND "employee_id" NOT IN (
          SELECT elem->>'ktvId' FROM jsonb_array_elements(p_staff_assignments) elem
      );

    -- ============================================================
    -- PHASE 2: Update BookingItems
    -- ============================================================
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_item_updates) LOOP
        UPDATE "BookingItems"
        SET
            "technicianCodes" = CASE
                WHEN v_item->'technicianCodes' IS NOT NULL AND jsonb_typeof(v_item->'technicianCodes') = 'array'
                THEN ARRAY(SELECT jsonb_array_elements_text(v_item->'technicianCodes'))
                ELSE "technicianCodes"
            END,
            "segments" = COALESCE(v_item->>'segments', "segments"::text),
            "options" = CASE
                WHEN v_item->'options' IS NOT NULL AND jsonb_typeof(v_item->'options') = 'object'
                THEN v_item->'options'
                ELSE "options"
            END,
            "status" = COALESCE(NULLIF(v_item->>'status', ''), "status"),
            "updatedAt" = now()
        WHERE "id" = v_item->>'id'
          AND "bookingId" = p_booking_id;
    END LOOP;

    -- ============================================================
    -- PHASE 3: Upsert TurnQueue
    -- ============================================================
    FOR v_assignment IN SELECT * FROM jsonb_array_elements(p_staff_assignments) LOOP
        v_booking_item_id := v_assignment->>'bookingItemId';

        INSERT INTO "TurnQueue" (
            "employee_id", "date", "status", "current_order_id",
            "booking_item_id", "booking_item_ids",
            "room_id", "bed_id", "queue_position",
            "start_time", "estimated_end_time",
            "last_served_at"
        )
        VALUES (
            v_assignment->>'ktvId',
            p_date,
            'assigned',
            p_booking_id,
            v_booking_item_id,
            ARRAY[v_booking_item_id]::text[],
            CASE WHEN v_assignment->>'roomId' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'roomId' END,
            CASE WHEN v_assignment->>'bedId' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'bedId' END,
            COALESCE((CASE WHEN v_assignment->>'queuePos' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'queuePos' END)::integer, 0),
            (CASE WHEN v_assignment->>'startTime' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'startTime' END)::time,
            (CASE WHEN v_assignment->>'endTime' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'endTime' END)::time,
            now()
        )
        ON CONFLICT ("employee_id", "date") DO UPDATE
        SET
            "status" = CASE WHEN "TurnQueue"."status" = 'working' THEN 'working' ELSE 'assigned' END,
            "current_order_id" = EXCLUDED."current_order_id",
            "booking_item_id" = COALESCE((
                SELECT elem->>'bookingItemId'
                FROM jsonb_array_elements(p_staff_assignments) elem
                WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                LIMIT 1
            ), EXCLUDED."booking_item_id"),
            "booking_item_ids" = (
                SELECT array_agg(DISTINCT elem->>'bookingItemId')
                FROM jsonb_array_elements(p_staff_assignments) elem
                WHERE elem->>'ktvId' = v_assignment->>'ktvId'
            ),
            "room_id" = (
                SELECT NULLIF(elem->>'roomId', '')
                FROM jsonb_array_elements(p_staff_assignments) elem
                WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                  AND elem->>'roomId' NOT IN ('', 'undefined', 'null')
                ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                LIMIT 1
            ),
            "bed_id" = (
                SELECT NULLIF(elem->>'bedId', '')
                FROM jsonb_array_elements(p_staff_assignments) elem
                WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                  AND elem->>'bedId' NOT IN ('', 'undefined', 'null')
                ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                LIMIT 1
            ),
            "queue_position" = CASE
                WHEN EXCLUDED."queue_position" > 0 THEN EXCLUDED."queue_position"
                ELSE "TurnQueue"."queue_position"
            END,
            -- ✅ FIX: cast trực tiếp ::time, KHÔNG dùng AT TIME ZONE (giữ nguyên giờ VN)
            "start_time" = COALESCE((
                SELECT MIN((elem->>'startTime')::time)
                FROM jsonb_array_elements(p_staff_assignments) elem
                WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                  AND elem->>'startTime' NOT IN ('', 'undefined', 'null')
            ), EXCLUDED."start_time"),
            "estimated_end_time" = COALESCE((
                SELECT MAX((elem->>'endTime')::time)
                FROM jsonb_array_elements(p_staff_assignments) elem
                WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                  AND elem->>'endTime' NOT IN ('', 'undefined', 'null')
            ), EXCLUDED."estimated_end_time"),
            "last_served_at" = EXCLUDED."last_served_at";
    END LOOP;

    -- ============================================================
    -- PHASE 4: Update Booking status
    -- ============================================================
    UPDATE "Bookings"
    SET
        "status" = 'DISPATCHED',
        "updatedAt" = now()
    WHERE "id" = p_booking_id;

END;
$$ LANGUAGE plpgsql;
