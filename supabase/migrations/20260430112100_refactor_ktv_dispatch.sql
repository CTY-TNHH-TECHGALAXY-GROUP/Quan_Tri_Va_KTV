-- 1. Mở rộng bảng TurnQueue
ALTER TABLE "TurnQueue" ADD COLUMN IF NOT EXISTS "booking_item_ids" text[] DEFAULT '{}';

-- Backfill dữ liệu cũ
UPDATE "TurnQueue" 
SET "booking_item_ids" = ARRAY["booking_item_id"] 
WHERE "booking_item_id" IS NOT NULL AND "booking_item_ids" = '{}';

-- 2. Tạo bảng TurnLedger (Sổ cái ghi nhận Tua)
CREATE TABLE IF NOT EXISTS "TurnLedger" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "date" date NOT NULL,
    "booking_id" text NOT NULL,
    "employee_id" text NOT NULL,
    "counted_at" timestamptz NOT NULL DEFAULT now(),
    "source" text DEFAULT 'DISPATCH_CONFIRM',
    "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Thêm Unique Constraint để đảm bảo Idempotency (1 KTV / 1 Bill = 1 Tua)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'turnledger_date_booking_employee_key') THEN
        ALTER TABLE "TurnLedger" ADD CONSTRAINT "turnledger_date_booking_employee_key" UNIQUE ("date", "booking_id", "employee_id");
    END IF;
END $$;

-- Cấp quyền RLS cho TurnLedger (Mở cho anon/authenticated giống các bảng khác)
ALTER TABLE "TurnLedger" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all for TurnLedger" ON "TurnLedger";
CREATE POLICY "Enable all for TurnLedger" 
ON "TurnLedger"
AS PERMISSIVE FOR ALL
USING (true)
WITH CHECK (true);

-- 3. Tạo RPC dispatch_confirm_booking
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
    v_ledger_inserted boolean;
    v_error text;
BEGIN
    -- 1. Validate & Insert TurnLedger (Idempotency Check)
    FOR v_assignment IN SELECT jsonb_array_elements(p_staff_assignments)
    LOOP
        v_ledger_inserted := false;
        
        BEGIN
            INSERT INTO "TurnLedger" ("date", "booking_id", "employee_id", "source")
            VALUES (p_date, p_booking_id, v_assignment->>'ktvId', 'DISPATCH_CONFIRM')
            ON CONFLICT ("date", "booking_id", "employee_id") DO NOTHING;
            
            IF FOUND THEN
                v_ledger_inserted := true;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            v_error := SQLERRM;
            RAISE EXCEPTION 'Lỗi khi insert TurnLedger cho %: %', v_assignment->>'ktvId', v_error;
        END;

        -- 2. Update TurnQueue
        -- Update the queue position, status to 'assigned', and other info
        UPDATE "TurnQueue"
        SET 
            "status" = 'assigned',
            "current_order_id" = p_booking_id,
            "booking_item_id" = v_assignment->>'bookingItemId',
            "booking_item_ids" = string_to_array(v_assignment->>'bookingItemId', ','),
            "room_id" = v_assignment->>'roomId',
            "bed_id" = v_assignment->>'bedId',
            "queue_position" = (v_assignment->>'queuePos')::integer,
            "start_time" = (v_assignment->>'startTime')::time,
            "estimated_end_time" = (v_assignment->>'endTime')::time,
            "last_served_at" = now()
        WHERE "employee_id" = v_assignment->>'ktvId' AND "date" = p_date;
        
    END LOOP;

    -- 3. Update Bookings (Tổng quát)
    UPDATE "Bookings"
    SET 
        "status" = COALESCE(p_status, "status"::text)::"BookingStatus",
        "technicianCode" = COALESCE(p_technician_code, "technicianCode"),
        "bedId" = COALESCE(p_bed_id, "bedId"),
        "roomName" = COALESCE(p_room_name, "roomName"),
        "notes" = COALESCE(p_notes, "notes"),
        "updatedAt" = now()
    WHERE "id" = p_booking_id;

    -- 4. Update BookingItems (Chi tiết từng dịch vụ)
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
