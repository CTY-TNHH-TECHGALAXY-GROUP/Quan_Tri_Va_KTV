-- Migration: Create KTV Wallet Tables (Phase 1)
-- Date: 2026-05-05

-- 1. Create WalletAdjustments table
CREATE TABLE IF NOT EXISTS "WalletAdjustments" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id text NOT NULL REFERENCES "Staff"(id) ON DELETE CASCADE,
    amount numeric NOT NULL,
    type text NOT NULL CHECK (type IN ('GIFT', 'PENALTY', 'INITIAL', 'ADJUST')),
    reason text,
    created_by text, -- ID of the admin who created this
    created_at timestamptz DEFAULT now()
);

-- Index for fast lookup by KTV
CREATE INDEX IF NOT EXISTS idx_wallet_adjustments_staff_id ON "WalletAdjustments"(staff_id);

-- Enable RLS
ALTER TABLE "WalletAdjustments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for WalletAdjustments" ON "WalletAdjustments";
CREATE POLICY "Enable all for WalletAdjustments" ON "WalletAdjustments" FOR ALL USING (true) WITH CHECK (true);

-- 2. Create KTVWithdrawals table
CREATE TABLE IF NOT EXISTS "KTVWithdrawals" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id text NOT NULL REFERENCES "Staff"(id) ON DELETE CASCADE,
    amount numeric NOT NULL CHECK (amount > 0),
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    note text,
    request_date timestamptz DEFAULT now(),
    processed_at timestamptz,
    processed_by text -- ID of the admin who processed this
);

-- Index for fast lookup by KTV and status
CREATE INDEX IF NOT EXISTS idx_ktv_withdrawals_staff_id ON "KTVWithdrawals"(staff_id);
CREATE INDEX IF NOT EXISTS idx_ktv_withdrawals_status ON "KTVWithdrawals"(status);

-- Enable RLS
ALTER TABLE "KTVWithdrawals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for KTVWithdrawals" ON "KTVWithdrawals";
CREATE POLICY "Enable all for KTVWithdrawals" ON "KTVWithdrawals" FOR ALL USING (true) WITH CHECK (true);

-- 3. Add Config to SystemConfigs
INSERT INTO "SystemConfigs" (id, key, value, description)
VALUES (
    gen_random_uuid(),
    'KTV_MINIMUM_DEPOSIT',
    '"500000"',
    'Số tiền cọc tối thiểu KTV phải giữ lại trong hệ thống'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 4. RPC Function to get KTV Balance
CREATE OR REPLACE FUNCTION get_ktv_wallet_balance(p_staff_id text)
RETURNS jsonb AS $$
DECLARE
    v_total_commission numeric := 0;
    v_total_tip numeric := 0;
    v_total_adjustment numeric := 0;
    v_total_withdrawn numeric := 0;
    v_total_pending numeric := 0;
    v_min_deposit numeric := 500000;
    
    v_turn record;
    v_item record;
    v_seg record;
    v_ktv_duration integer;
    v_milestones jsonb;
    v_rate_60 numeric := 100000; -- Default fallback
    v_config_val text;
    v_seg_arr jsonb;
    v_seg_item jsonb;
    
BEGIN
    -- 1. Load Configurations
    SELECT value::text INTO v_config_val FROM "SystemConfigs" WHERE key = 'KTV_MINIMUM_DEPOSIT';
    IF FOUND AND v_config_val IS NOT NULL THEN
        -- Handle case where value is a JSON string "500000" or raw 500000
        v_min_deposit := REPLACE(v_config_val, '"', '')::numeric;
    END IF;

    SELECT value INTO v_milestones FROM "SystemConfigs" WHERE key = 'ktv_commission_milestones';
    IF NOT FOUND OR v_milestones IS NULL THEN
        -- Default milestones if not found in DB
        v_milestones := '{"1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "120": 200000, "180": 300000, "300": 500000}'::jsonb;
    END IF;

    SELECT value::text INTO v_config_val FROM "SystemConfigs" WHERE key = 'ktv_commission_per_60min';
    IF FOUND AND v_config_val IS NOT NULL THEN
        v_rate_60 := REPLACE(v_config_val, '"', '')::numeric;
    END IF;

    -- 2. Calculate Adjustments (+/-)
    SELECT COALESCE(SUM(amount), 0) INTO v_total_adjustment
    FROM "WalletAdjustments"
    WHERE staff_id = p_staff_id AND created_at >= '2026-05-04'::date;

    -- 3. Calculate Withdrawals (-)
    SELECT COALESCE(SUM(amount), 0) INTO v_total_withdrawn
    FROM "KTVWithdrawals"
    WHERE staff_id = p_staff_id AND status = 'APPROVED' AND request_date >= '2026-05-04'::date;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_pending
    FROM "KTVWithdrawals"
    WHERE staff_id = p_staff_id AND status = 'PENDING' AND request_date >= '2026-05-04'::date;

    -- 4. Calculate Tips
    SELECT COALESCE(SUM(
        CASE 
            WHEN array_length("technicianCodes", 1) > 0 THEN tip / array_length("technicianCodes", 1)
            ELSE tip 
        END
    ), 0) INTO v_total_tip
    FROM "BookingItems"
    WHERE p_staff_id = ANY("technicianCodes") AND status = 'DONE' AND "timeEnd" >= '2026-05-04'::date;

    -- 5. Calculate Commission from TurnLedger & BookingItems
    FOR v_turn IN 
        SELECT DISTINCT booking_id 
        FROM "TurnLedger" 
        WHERE employee_id = p_staff_id AND counted_at >= '2026-05-04'::date
    LOOP
        v_ktv_duration := 0;

        FOR v_item IN 
            SELECT i.id, s.duration, i.segments, i.status 
            FROM "BookingItems" i
            LEFT JOIN "Services" s ON i."serviceId" = s.id
            WHERE i."bookingId" = v_turn.booking_id 
              AND p_staff_id = ANY(i."technicianCodes")
              AND i.status IN ('COMPLETED', 'DONE', 'FEEDBACK', 'CLEANING')
        LOOP
            IF v_item.segments IS NOT NULL THEN
                BEGIN
                    IF jsonb_typeof(v_item.segments) = 'string' THEN
                        v_seg_arr := v_item.segments::text::jsonb;
                    ELSE
                        v_seg_arr := v_item.segments;
                    END IF;
                    
                    FOR v_seg_item IN SELECT * FROM jsonb_array_elements(v_seg_arr)
                    LOOP
                        IF v_seg_item->>'ktvId' = p_staff_id THEN
                            v_ktv_duration := v_ktv_duration + COALESCE((v_seg_item->>'duration')::integer, 60);
                        END IF;
                    END LOOP;
                EXCEPTION WHEN OTHERS THEN
                    v_ktv_duration := v_ktv_duration + COALESCE(v_item.duration, 60);
                END;
            ELSE
                v_ktv_duration := v_ktv_duration + COALESCE(v_item.duration, 60);
            END IF;
        END LOOP;

        IF v_ktv_duration > 0 THEN
            IF v_milestones ? v_ktv_duration::text THEN
                v_total_commission := v_total_commission + (v_milestones->>v_ktv_duration::text)::numeric;
            ELSE
                v_total_commission := v_total_commission + (ROUND((v_ktv_duration::numeric / 60) * v_rate_60 / 1000) * 1000);
            END IF;
        END IF;
    END LOOP;

    -- 6. Compile Results
    RETURN jsonb_build_object(
        'total_commission', v_total_commission,
        'total_tip', v_total_tip,
        'total_adjustment', v_total_adjustment,
        'total_withdrawn', v_total_withdrawn,
        'total_pending', v_total_pending,
        'gross_income', v_total_commission + v_total_adjustment,
        'available_balance', (v_total_commission + v_total_adjustment) - v_total_withdrawn,
        'effective_balance', (v_total_commission + v_total_adjustment) - v_total_withdrawn - v_total_pending,
        'min_deposit', v_min_deposit
    );
END;
$$ LANGUAGE plpgsql;
