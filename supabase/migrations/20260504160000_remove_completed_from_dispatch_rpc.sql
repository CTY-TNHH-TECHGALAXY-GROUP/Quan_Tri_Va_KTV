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
    v_assignment_id uuid;
    v_booking_item_id text;
    v_segment_id text;
    v_planned_start_time timestamptz;
    v_planned_end_time timestamptz;
    v_priority integer;
    v_sequence_no integer;
    v_dispatch_source text;
BEGIN
    -- 1. Validate & insert TurnLedger (idempotent)
    FOR v_assignment IN SELECT jsonb_array_elements(p_staff_assignments)
    LOOP
        -- 0. Self-Healing Guard: Dọn dẹp assignments ảo (kẹt) trước khi cấp mới
        UPDATE "KtvAssignments" ka
        SET "status" = 'COMPLETED', "updated_at" = now()
        FROM "Bookings" b
        WHERE ka."booking_id" = b."id"
          AND ka."employee_id" = v_assignment->>'ktvId'
          AND ka."business_date" = p_date
          AND ka."status" = 'ACTIVE'
          AND b."status" IN ('DONE', 'FEEDBACK', 'CANCELLED', 'COMPLETED'); -- Changed logic to not clean CLEANING

        IF EXISTS (
            SELECT 1 FROM "TurnQueue"
            WHERE "employee_id" = v_assignment->>'ktvId'
              AND "date" = p_date
              AND "status" = 'waiting'
        ) THEN
            UPDATE "KtvAssignments"
            SET "status" = 'COMPLETED', "updated_at" = now()
            WHERE "employee_id" = v_assignment->>'ktvId'
              AND "business_date" = p_date
              AND "status" = 'ACTIVE';
        END IF;
        BEGIN
            INSERT INTO "TurnLedger" ("date", "booking_id", "employee_id", "source")
            VALUES (p_date, p_booking_id, v_assignment->>'ktvId', 'DISPATCH_CONFIRM')
            ON CONFLICT ("date", "booking_id", "employee_id") DO NOTHING;
        EXCEPTION WHEN OTHERS THEN
            v_error := SQLERRM;
            RAISE EXCEPTION 'Loi khi ghi so cai cho %: %', v_assignment->>'ktvId', v_error;
        END;

        v_booking_item_id := NULLIF(v_assignment->>'bookingItemId', '');
        IF v_booking_item_id IS NULL OR v_booking_item_id IN ('undefined', 'null') THEN
            RAISE EXCEPTION 'bookingItemId is required for KTV assignment of %', v_assignment->>'ktvId';
        END IF;

        v_segment_id := NULLIF(v_assignment->>'segmentId', '');
        IF v_segment_id IN ('undefined', 'null') THEN
            v_segment_id := NULL;
        END IF;

        v_priority := COALESCE(NULLIF(v_assignment->>'priority', '')::integer, 0);
        v_sequence_no := COALESCE(NULLIF(v_assignment->>'sequenceNo', '')::integer, 0);
        v_dispatch_source := COALESCE(NULLIF(v_assignment->>'dispatchSource', ''), 'DISPATCH_CONFIRM');

        v_planned_start_time := CASE
            WHEN NULLIF(v_assignment->>'startTime', '') IS NULL OR v_assignment->>'startTime' IN ('undefined', 'null') THEN NULL
            ELSE ((p_date::text || ' ' || (v_assignment->>'startTime'))::timestamp AT TIME ZONE 'Asia/Bangkok')
        END;

        v_planned_end_time := CASE
            WHEN NULLIF(v_assignment->>'endTime', '') IS NULL OR v_assignment->>'endTime' IN ('undefined', 'null') THEN NULL
            ELSE ((p_date::text || ' ' || (v_assignment->>'endTime'))::timestamp AT TIME ZONE 'Asia/Bangkok')
        END;

        -- 2a. Insert or update KtvAssignments
        INSERT INTO "KtvAssignments" (
            "employee_id",
            "business_date",
            "booking_id",
            "booking_item_id",
            "segment_id",
            "planned_start_time",
            "planned_end_time",
            "room_id",
            "bed_id",
            "priority",
            "sequence_no",
            "status",
            "dispatch_source"
        )
        VALUES (
            v_assignment->>'ktvId',
            p_date,
            p_booking_id,
            v_booking_item_id,
            v_segment_id,
            v_planned_start_time,
            v_planned_end_time,
            CASE WHEN v_assignment->>'roomId' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'roomId' END,
            CASE WHEN v_assignment->>'bedId' IN ('', 'undefined', 'null') THEN NULL ELSE v_assignment->>'bedId' END,
            v_priority,
            v_sequence_no,
            'QUEUED',
            v_dispatch_source
        )
        ON CONFLICT ("employee_id", "booking_item_id") DO UPDATE
        SET
            "segment_id" = EXCLUDED."segment_id",
            "planned_start_time" = EXCLUDED."planned_start_time",
            "planned_end_time" = EXCLUDED."planned_end_time",
            "room_id" = EXCLUDED."room_id",
            "bed_id" = EXCLUDED."bed_id",
            "priority" = EXCLUDED."priority",
            "sequence_no" = EXCLUDED."sequence_no",
            "dispatch_source" = EXCLUDED."dispatch_source"
        RETURNING id INTO v_assignment_id;

        -- 2b. Promote to ACTIVE only when this KTV has no current ACTIVE assignment for the business date
        IF NOT EXISTS (
            SELECT 1
            FROM "KtvAssignments"
            WHERE "employee_id" = v_assignment->>'ktvId'
              AND "business_date" = p_date
              AND "status" = 'ACTIVE'
              AND "id" <> v_assignment_id
        ) THEN
            UPDATE "KtvAssignments"
            SET "status" = 'ACTIVE'
            WHERE "id" = v_assignment_id;

            -- TurnQueue mirrors only the single active assignment.
            INSERT INTO "TurnQueue" (
                "employee_id",
                "date",
                "status",
                "current_order_id",
                "booking_item_id",
                "booking_item_ids",
                "room_id",
                "bed_id",
                "queue_position",
                "start_time",
                "estimated_end_time",
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
                    ORDER BY (p_date::text || ' ' || (elem->>'startTime'))::timestamp AT TIME ZONE 'Asia/Bangkok' ASC NULLS LAST
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
                    ORDER BY (p_date::text || ' ' || (elem->>'startTime'))::timestamp AT TIME ZONE 'Asia/Bangkok' ASC NULLS LAST
                    LIMIT 1
                ),
                "bed_id" = (
                    SELECT NULLIF(elem->>'bedId', '')
                    FROM jsonb_array_elements(p_staff_assignments) elem
                    WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                      AND elem->>'bedId' NOT IN ('', 'undefined', 'null')
                    ORDER BY (p_date::text || ' ' || (elem->>'startTime'))::timestamp AT TIME ZONE 'Asia/Bangkok' ASC NULLS LAST
                    LIMIT 1
                ),
                "queue_position" = CASE
                    WHEN EXCLUDED."queue_position" > 0 THEN EXCLUDED."queue_position"
                    ELSE "TurnQueue"."queue_position"
                END,
                "start_time" = COALESCE((
                    SELECT MIN((p_date::text || ' ' || (elem->>'startTime'))::timestamp AT TIME ZONE 'Asia/Bangkok')::time
                    FROM jsonb_array_elements(p_staff_assignments) elem
                    WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                      AND elem->>'startTime' NOT IN ('', 'undefined', 'null')
                ), EXCLUDED."start_time"),
                "estimated_end_time" = COALESCE((
                    SELECT MAX((p_date::text || ' ' || (elem->>'endTime'))::timestamp AT TIME ZONE 'Asia/Bangkok')::time
                    FROM jsonb_array_elements(p_staff_assignments) elem
                    WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                      AND elem->>'endTime' NOT IN ('', 'undefined', 'null')
                ), EXCLUDED."estimated_end_time"),
                "last_served_at" = EXCLUDED."last_served_at";
        END IF;
    END LOOP;

    -- 2.5. Validate Booking Status Transition
    IF p_status IS NOT NULL THEN
        DECLARE
            v_current_status text;
            v_current_idx integer;
            v_new_idx integer;
        BEGIN
            SELECT "status"::text INTO v_current_status FROM "Bookings" WHERE "id" = p_booking_id;
            
            v_current_idx := CASE v_current_status
                WHEN 'NEW' THEN 0 WHEN 'WAITING' THEN 0 WHEN 'PREPARING' THEN 1 WHEN 'IN_PROGRESS' THEN 2 
                WHEN 'COMPLETED' THEN 3 WHEN 'CLEANING' THEN 3 WHEN 'waiting_rating' THEN 4 WHEN 'FEEDBACK' THEN 4 WHEN 'DONE' THEN 5
                WHEN 'CANCELLED' THEN 99
                ELSE -1
            END;

            v_new_idx := CASE p_status
                WHEN 'NEW' THEN 0 WHEN 'WAITING' THEN 0 WHEN 'PREPARING' THEN 1 WHEN 'IN_PROGRESS' THEN 2 
                WHEN 'COMPLETED' THEN 3 WHEN 'CLEANING' THEN 3 WHEN 'waiting_rating' THEN 4 WHEN 'FEEDBACK' THEN 4 WHEN 'DONE' THEN 5
                WHEN 'CANCELLED' THEN 99
                ELSE -1
            END;

            IF v_new_idx < v_current_idx AND p_status != 'CANCELLED' AND v_current_status != 'CANCELLED' THEN
                RAISE EXCEPTION 'Invalid status transition from % to %', v_current_status, p_status;
            END IF;
        END;
    END IF;

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

    -- 4. Upsert BookingItems
    FOR v_item IN SELECT jsonb_array_elements(p_item_updates)
    LOOP
        UPDATE "BookingItems"
        SET 
            "roomName" = CASE WHEN v_item->>'roomName' IN ('', 'undefined', 'null') THEN NULL ELSE COALESCE(v_item->>'roomName', "roomName") END,
            "bedId" = CASE WHEN v_item->>'bedId' IN ('', 'undefined', 'null') THEN NULL ELSE COALESCE(v_item->>'bedId', "bedId") END,
            "technicianCodes" = CASE WHEN jsonb_typeof(v_item->'technicianCodes') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_item->'technicianCodes')) ELSE "technicianCodes" END,
            "status" = COALESCE(NULLIF(v_item->>'status', ''), "status"),
            "segments" = CASE WHEN jsonb_typeof(v_item->'segments') = 'array' THEN v_item->'segments' ELSE "segments" END,
            "options" = CASE WHEN jsonb_typeof(v_item->'options') = 'object' THEN v_item->'options' ELSE "options" END
        WHERE "id" = v_item->>'id';
    END LOOP;

    RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- RPC: promote_next_assignment
-- Purpose: Auto-Handoff engine for KTV assignments. Finds the next QUEUED assignment, marks it ACTIVE, and syncs to TurnQueue.

CREATE OR REPLACE FUNCTION promote_next_assignment(
    p_employee_id TEXT,
    p_business_date DATE
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_next_assignment RECORD;
    v_turn_id UUID;
BEGIN
    -- 0. Self-Healing / Reconciliation Guard
    -- Clean up stale ACTIVE assignments if the booking is already DONE/CLEANING/FEEDBACK/CANCELLED
    UPDATE "KtvAssignments" ka
    SET "status" = 'COMPLETED', "updated_at" = now()
    FROM "Bookings" b
    WHERE ka."booking_id" = b."id"
      AND ka."employee_id" = p_employee_id
      AND ka."business_date" = p_business_date
      AND ka."status" = 'ACTIVE'
      AND b."status" IN ('DONE', 'FEEDBACK', 'CANCELLED', 'COMPLETED'); -- Changed logic to not clean CLEANING

    -- Clean up ACTIVE assignments if the KTV's TurnQueue says they are 'waiting'
    -- (meaning the legacy system already released them)
    IF EXISTS (
        SELECT 1 FROM "TurnQueue"
        WHERE "employee_id" = p_employee_id
          AND "date" = p_business_date
          AND "status" = 'waiting'
    ) THEN
        UPDATE "KtvAssignments"
        SET "status" = 'COMPLETED', "updated_at" = now()
        WHERE "employee_id" = p_employee_id
          AND "business_date" = p_business_date
          AND "status" = 'ACTIVE';
    END IF;
    -- 1. Check if there is already an ACTIVE assignment
    IF EXISTS (
        SELECT 1 FROM "KtvAssignments"
        WHERE "employee_id" = p_employee_id
          AND "business_date" = p_business_date
          AND "status" = 'ACTIVE'
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'KTV already has an ACTIVE assignment');
    END IF;

    -- 2. Find the next QUEUED or READY assignment deterministically
    -- Rule: priority ASC, then planned_start_time ASC, then sequence_no ASC, then created_at ASC
    SELECT * INTO v_next_assignment
    FROM "KtvAssignments"
    WHERE "employee_id" = p_employee_id
      AND "business_date" = p_business_date
      AND "status" IN ('QUEUED', 'READY')
    ORDER BY
        "priority" ASC,
        "planned_start_time" ASC NULLS LAST,
        "sequence_no" ASC,
        "created_at" ASC
    LIMIT 1;

    IF NOT FOUND THEN
        -- No more assignments. Clear the TurnQueue.
        -- Find max queue position
        DECLARE
            v_max_pos INTEGER;
        BEGIN
            SELECT COALESCE(MAX("queue_position"), 0) INTO v_max_pos
            FROM "TurnQueue"
            WHERE "date" = p_business_date;

            UPDATE "TurnQueue"
            SET 
                "status" = 'waiting',
                "current_order_id" = NULL,
                "booking_item_id" = NULL,
                "booking_item_ids" = ARRAY[]::text[],
                "room_id" = NULL,
                "bed_id" = NULL,
                "start_time" = NULL,
                "estimated_end_time" = NULL,
                "queue_position" = v_max_pos + 1
            WHERE "employee_id" = p_employee_id AND "date" = p_business_date;
        END;

        RETURN jsonb_build_object('success', true, 'message', 'No next assignment, KTV set to waiting');
    END IF;

    -- 3. Promote to ACTIVE
    UPDATE "KtvAssignments"
    SET "status" = 'ACTIVE', "updated_at" = now()
    WHERE "id" = v_next_assignment.id;

    -- 4. Sync to TurnQueue
    UPDATE "TurnQueue"
    SET
        "status" = 'assigned',
        "current_order_id" = v_next_assignment.booking_id,
        "booking_item_id" = v_next_assignment.booking_item_id,
        "booking_item_ids" = ARRAY[v_next_assignment.booking_item_id]::text[],
        "room_id" = v_next_assignment.room_id,
        "bed_id" = v_next_assignment.bed_id,
        "start_time" = v_next_assignment.planned_start_time::time,
        "estimated_end_time" = v_next_assignment.planned_end_time::time
    WHERE "employee_id" = p_employee_id AND "date" = p_business_date;

    IF NOT FOUND THEN
        -- Fallback: Insert if TurnQueue row for this KTV/date doesn't exist
        DECLARE
            v_max_pos INTEGER;
        BEGIN
            SELECT COALESCE(MAX("queue_position"), 0) INTO v_max_pos
            FROM "TurnQueue"
            WHERE "date" = p_business_date;

            INSERT INTO "TurnQueue" (
                "employee_id", "date", "status", "current_order_id",
                "booking_item_id", "booking_item_ids", "room_id", "bed_id", "queue_position",
                "start_time", "estimated_end_time"
            ) VALUES (
                p_employee_id, p_business_date, 'assigned', v_next_assignment.booking_id,
                v_next_assignment.booking_item_id, ARRAY[v_next_assignment.booking_item_id]::text[],
                v_next_assignment.room_id, v_next_assignment.bed_id, v_max_pos + 1,
                v_next_assignment.planned_start_time::time, v_next_assignment.planned_end_time::time
            );
        END;
    END IF;

    RETURN jsonb_build_object('success', true, 'promoted_booking_id', v_next_assignment.booking_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
