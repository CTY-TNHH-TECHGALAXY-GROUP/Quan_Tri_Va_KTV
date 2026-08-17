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
    v_ledger_booking_id text;
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
    -- Guard: Không cho dispatch đơn cha đã tách
    IF EXISTS (SELECT 1 FROM "Bookings" WHERE "id" = p_booking_id AND "status"::text = 'SPLIT') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Đơn đã tách thành đơn con. Vui lòng điều phối từng đơn con riêng.');
    END IF;

    -- 0.5. Clean up assignments for KTVs that are NO LONGER in the new staff list for this booking
    DECLARE
        v_updated_item_ids text[];
        v_removed_ktv_id text;
        v_removed_item_id text;
        v_was_working boolean;
    BEGIN
        SELECT array_agg(elem->>'id') INTO v_updated_item_ids
        FROM jsonb_array_elements(p_item_updates) elem
        WHERE elem->>'id' IS NOT NULL;

        IF v_updated_item_ids IS NULL THEN
            v_updated_item_ids := ARRAY[]::text[];
        END IF;

        FOR v_removed_ktv_id, v_removed_item_id IN
            SELECT "employee_id", "booking_item_id" FROM "KtvAssignments" ka
            WHERE "booking_id" = p_booking_id
              AND "status" IN ('ACTIVE', 'QUEUED', 'READY')
              AND "booking_item_id" = ANY(v_updated_item_ids)
              AND NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(p_staff_assignments) elem
                  WHERE elem->>'ktvId' = ka."employee_id"
                    AND elem->>'bookingItemId' = ka."booking_item_id"
              )
        LOOP
            UPDATE "KtvAssignments"
            SET "status" = 'COMPLETED', "updated_at" = now()
            WHERE "booking_id" = p_booking_id
              AND "employee_id" = v_removed_ktv_id
              AND "booking_item_id" = v_removed_item_id
              AND "status" IN ('ACTIVE', 'QUEUED', 'READY');

            SELECT EXISTS(
                SELECT 1 FROM "TurnQueue"
                WHERE "employee_id" = v_removed_ktv_id
                  AND "date" = p_date
                  AND "current_order_id" = p_booking_id
                  AND "status" = 'working'
            ) INTO v_was_working;

            UPDATE "TurnQueue"
            SET "status" = CASE WHEN "status" = 'off' THEN 'off' ELSE 'waiting' END,
                "current_order_id" = NULL,
                "booking_item_id" = NULL,
                "booking_item_ids" = ARRAY[]::text[],
                "room_id" = NULL,
                "bed_id" = NULL,
                "start_time" = NULL,
                "estimated_end_time" = NULL
            WHERE "employee_id" = v_removed_ktv_id
              AND "date" = p_date
              AND "current_order_id" = p_booking_id;

            IF NOT v_was_working THEN
                IF NOT EXISTS (
                    SELECT 1 FROM "KtvAssignments"
                    WHERE "booking_id" = p_booking_id
                      AND "employee_id" = v_removed_ktv_id
                      AND "status" IN ('ACTIVE', 'QUEUED', 'READY')
                ) AND NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements(p_staff_assignments) elem
                    WHERE elem->>'ktvId' = v_removed_ktv_id
                ) THEN
                    DELETE FROM "TurnLedger"
                    WHERE "date" = p_date
                      AND "booking_id" = p_booking_id
                      AND "employee_id" = v_removed_ktv_id;
                END IF;
            END IF;
              
            PERFORM promote_next_assignment(v_removed_ktv_id, p_date);
        END LOOP;
    END;

    -- 1. Validate & insert TurnLedger
    FOR v_assignment IN SELECT jsonb_array_elements(p_staff_assignments)
    LOOP
        UPDATE "KtvAssignments" ka
        SET "status" = 'COMPLETED', "updated_at" = now()
        FROM "Bookings" b
        WHERE ka."booking_id" = b."id"
          AND ka."employee_id" = v_assignment->>'ktvId'
          AND ka."business_date" = p_date
          AND ka."status" = 'ACTIVE'
          AND b."status" IN ('DONE', 'FEEDBACK', 'CANCELLED', 'COMPLETED');

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
            SELECT COALESCE(parent_booking_id, id) INTO v_ledger_booking_id
            FROM "Bookings"
            WHERE id = p_booking_id;

            INSERT INTO "TurnLedger" ("date", "booking_id", "employee_id", "source")
            VALUES (p_date, v_ledger_booking_id, v_assignment->>'ktvId', 'DISPATCH_CONFIRM')
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

        -- 2b. Xử lý Trạng thái ACTIVE & Đồng bộ TurnQueue
        DECLARE
            v_is_active_on_other boolean;
            v_is_active_on_this boolean;
        BEGIN
            SELECT EXISTS (
                SELECT 1
                FROM "KtvAssignments"
                WHERE "employee_id" = v_assignment->>'ktvId'
                  AND "business_date" = p_date
                  AND "status" = 'ACTIVE'
                  AND "booking_id" <> p_booking_id
                  AND "id" <> v_assignment_id
            ) INTO v_is_active_on_other;

            SELECT EXISTS (
                SELECT 1
                FROM "KtvAssignments"
                WHERE "employee_id" = v_assignment->>'ktvId'
                  AND "business_date" = p_date
                  AND "status" = 'ACTIVE'
                  AND "booking_id" = p_booking_id
                  AND "id" <> v_assignment_id
            ) INTO v_is_active_on_this;

            IF NOT v_is_active_on_other AND NOT v_is_active_on_this THEN
                UPDATE "KtvAssignments"
                SET "status" = 'ACTIVE'
                WHERE "id" = v_assignment_id;
            END IF;

            IF NOT v_is_active_on_other THEN
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
                        ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                        LIMIT 1
                    ), EXCLUDED."booking_item_id"),
                    "booking_item_ids" = (
                        SELECT array_agg(DISTINCT elem->>'bookingItemId')
                        FROM jsonb_array_elements(p_staff_assignments) elem
                        WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                    ),
                    "room_id" = CASE
                        WHEN "TurnQueue"."status" = 'working' THEN "TurnQueue"."room_id"
                        ELSE (
                            SELECT NULLIF(elem->>'roomId', '')
                            FROM jsonb_array_elements(p_staff_assignments) elem
                            WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                              AND elem->>'roomId' NOT IN ('', 'undefined', 'null')
                            ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                            LIMIT 1
                        )
                    END,
                    "bed_id" = CASE
                        WHEN "TurnQueue"."status" = 'working' THEN "TurnQueue"."bed_id"
                        ELSE (
                            SELECT NULLIF(elem->>'bedId', '')
                            FROM jsonb_array_elements(p_staff_assignments) elem
                            WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                              AND elem->>'bedId' NOT IN ('', 'undefined', 'null')
                            ORDER BY (elem->>'startTime')::time ASC NULLS LAST
                            LIMIT 1
                        )
                    END,
                    "queue_position" = CASE
                        WHEN EXCLUDED."queue_position" > 0 THEN EXCLUDED."queue_position"
                        ELSE "TurnQueue"."queue_position"
                    END,
                    "start_time" = CASE 
                        WHEN "TurnQueue"."status" = 'working' THEN "TurnQueue"."start_time"
                        ELSE COALESCE((
                            SELECT MIN((elem->>'startTime')::time)
                            FROM jsonb_array_elements(p_staff_assignments) elem
                            WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                              AND elem->>'startTime' NOT IN ('', 'undefined', 'null')
                        ), EXCLUDED."start_time")
                    END,
                    "estimated_end_time" = CASE
                        WHEN "TurnQueue"."status" = 'working' THEN "TurnQueue"."estimated_end_time"
                        ELSE COALESCE((
                            SELECT MAX((elem->>'endTime')::time)
                            FROM jsonb_array_elements(p_staff_assignments) elem
                            WHERE elem->>'ktvId' = v_assignment->>'ktvId'
                              AND elem->>'endTime' NOT IN ('', 'undefined', 'null')
                        ), EXCLUDED."estimated_end_time")
                    END,
                    "last_served_at" = EXCLUDED."last_served_at";
            END IF;
        END;
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
                WHEN 'CANCELLED' THEN 99 WHEN 'SPLIT' THEN 98
                ELSE -1
            END;

            v_new_idx := CASE p_status
                WHEN 'NEW' THEN 0 WHEN 'WAITING' THEN 0 WHEN 'PREPARING' THEN 1 WHEN 'IN_PROGRESS' THEN 2 
                WHEN 'COMPLETED' THEN 3 WHEN 'CLEANING' THEN 3 WHEN 'waiting_rating' THEN 4 WHEN 'FEEDBACK' THEN 4 WHEN 'DONE' THEN 5
                WHEN 'CANCELLED' THEN 99 WHEN 'SPLIT' THEN 98
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
