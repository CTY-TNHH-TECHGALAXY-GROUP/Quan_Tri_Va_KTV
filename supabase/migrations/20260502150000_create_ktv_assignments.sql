-- Migration for KtvAssignments architecture

-- 1. Create status enum (idempotent)
DO $$ BEGIN
    CREATE TYPE "KtvAssignmentStatus" AS ENUM (
        'QUEUED',
        'READY',
        'ACTIVE',
        'COMPLETED',
        'CANCELLED',
        'SKIPPED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create / evolve table
-- NOTE:
-- - Do not drop the table during rollout. This migration must preserve shadow/live data.
-- - The intended model is 1 row = 1 KTV + 1 booking item assignment.
CREATE TABLE IF NOT EXISTS "KtvAssignments" (
    "id" UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    "employee_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "booking_id" TEXT NOT NULL REFERENCES "Bookings"("id") ON DELETE CASCADE,
    "booking_item_id" TEXT NOT NULL,
    "segment_id" TEXT,
    "planned_start_time" TIMESTAMP WITH TIME ZONE,
    "planned_end_time" TIMESTAMP WITH TIME ZONE,
    "room_id" TEXT,
    "bed_id" TEXT,
    "priority" INTEGER DEFAULT 0,
    "sequence_no" INTEGER DEFAULT 0,
    "status" "KtvAssignmentStatus" DEFAULT 'QUEUED',
    "dispatch_source" TEXT,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE "KtvAssignments"
    ALTER COLUMN "booking_item_id" SET NOT NULL;

-- 3. Indexes / constraints
CREATE INDEX IF NOT EXISTS idx_ktvassignments_emp_date
    ON "KtvAssignments" ("employee_id", "business_date");

CREATE INDEX IF NOT EXISTS idx_ktvassignments_status
    ON "KtvAssignments" ("status");

CREATE INDEX IF NOT EXISTS idx_ktvassignments_booking
    ON "KtvAssignments" ("booking_id");

-- Invariant: one ACTIVE assignment per KTV per business date
CREATE UNIQUE INDEX IF NOT EXISTS idx_ktvassignments_one_active_per_day
    ON "KtvAssignments" ("employee_id", "business_date")
    WHERE status = 'ACTIVE';

-- Invariant: no duplicate assignment for the same KTV on the same booking item
CREATE UNIQUE INDEX IF NOT EXISTS idx_ktvassignments_emp_item
    ON "KtvAssignments" ("employee_id", "booking_item_id");

ALTER TABLE "KtvAssignments"
    DROP CONSTRAINT IF EXISTS ktvassignments_emp_item_unique;

ALTER TABLE "KtvAssignments"
    ADD CONSTRAINT ktvassignments_emp_item_unique
    UNIQUE USING INDEX idx_ktvassignments_emp_item;

-- 4. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_ktvassignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ktvassignments_updated_at_trigger ON "KtvAssignments";

CREATE TRIGGER ktvassignments_updated_at_trigger
BEFORE UPDATE ON "KtvAssignments"
FOR EACH ROW
EXECUTE FUNCTION update_ktvassignments_updated_at();

-- 5. Enable RLS but keep behavior aligned with current rollout model
ALTER TABLE "KtvAssignments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON "KtvAssignments";
CREATE POLICY "Enable read access for all users"
    ON "KtvAssignments" FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable insert access for all users" ON "KtvAssignments";
CREATE POLICY "Enable insert access for all users"
    ON "KtvAssignments" FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update access for all users" ON "KtvAssignments";
CREATE POLICY "Enable update access for all users"
    ON "KtvAssignments" FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable delete access for all users" ON "KtvAssignments";
CREATE POLICY "Enable delete access for all users"
    ON "KtvAssignments" FOR DELETE USING (true);

-- 6. Update dispatch_confirm_booking RPC
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
          AND b."status" IN ('DONE', 'COMPLETED', 'CANCELLED');

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
                "booking_item_id" = EXCLUDED."booking_item_id",
                "booking_item_ids" = EXCLUDED."booking_item_ids",
                "room_id" = EXCLUDED."room_id",
                "bed_id" = EXCLUDED."bed_id",
                "queue_position" = CASE
                    WHEN EXCLUDED."queue_position" > 0 THEN EXCLUDED."queue_position"
                    ELSE "TurnQueue"."queue_position"
                END,
                "start_time" = EXCLUDED."start_time",
                "estimated_end_time" = EXCLUDED."estimated_end_time",
                "last_served_at" = EXCLUDED."last_served_at";
        END IF;
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
