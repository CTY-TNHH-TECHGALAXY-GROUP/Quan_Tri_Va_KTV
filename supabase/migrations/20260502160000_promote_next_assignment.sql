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
    -- Clean up stale ACTIVE assignments if the booking is already DONE/COMPLETED/CANCELLED
    UPDATE "KtvAssignments" ka
    SET "status" = 'COMPLETED', "updated_at" = now()
    FROM "Bookings" b
    WHERE ka."booking_id" = b."id"
      AND ka."employee_id" = p_employee_id
      AND ka."business_date" = p_business_date
      AND ka."status" = 'ACTIVE'
      AND b."status" IN ('DONE', 'COMPLETED', 'CANCELLED');

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
        "start_time" = NULL,
        "estimated_end_time" = NULL
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
                "booking_item_id", "booking_item_ids", "room_id", "bed_id", "queue_position"
            ) VALUES (
                p_employee_id, p_business_date, 'assigned', v_next_assignment.booking_id,
                v_next_assignment.booking_item_id, ARRAY[v_next_assignment.booking_item_id]::text[],
                v_next_assignment.room_id, v_next_assignment.bed_id, v_max_pos + 1
            );
        END;
    END IF;

    RETURN jsonb_build_object('success', true, 'promoted_booking_id', v_next_assignment.booking_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
