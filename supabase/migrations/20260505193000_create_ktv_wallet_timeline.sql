-- Migration: KTV Wallet Timeline RPC
-- Date: 2026-05-05

CREATE OR REPLACE FUNCTION get_ktv_wallet_timeline(p_staff_id text, p_month integer, p_year integer)
RETURNS TABLE (
    id text,
    type text,
    title text,
    amount numeric,
    created_at timestamptz,
    status text,
    note text
) AS $$
DECLARE
    v_turn record;
    v_item record;
    v_seg record;
    v_ktv_duration integer;
    v_milestones jsonb;
    v_rate_60 numeric := 100000;
    v_config_val text;
    v_seg_arr jsonb;
    v_seg_item jsonb;
    v_turn_amount numeric;
BEGIN
    -- 1. Load Configurations
    SELECT value INTO v_milestones FROM "SystemConfigs" WHERE key = 'ktv_commission_milestones';
    IF NOT FOUND OR v_milestones IS NULL THEN
        v_milestones := '{"1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000,"100": 165000, "120": 200000, "180": 300000, "300": 500000}'::jsonb;
    END IF;

    SELECT value::text INTO v_config_val FROM "SystemConfigs" WHERE key = 'ktv_commission_per_60min';
    IF FOUND AND v_config_val IS NOT NULL THEN
        v_rate_60 := REPLACE(v_config_val, '"', '')::numeric;
    END IF;

    -- 2. Process TurnLedger (Commission)
    FOR v_turn IN 
        SELECT DISTINCT booking_id, counted_at, id as turn_id
        FROM "TurnLedger" 
        WHERE employee_id = p_staff_id
          AND counted_at >= '2026-05-04'::date
          AND EXTRACT(MONTH FROM counted_at) = p_month
          AND EXTRACT(YEAR FROM counted_at) = p_year
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
                v_turn_amount := (v_milestones->>v_ktv_duration::text)::numeric;
            ELSE
                v_turn_amount := (ROUND((v_ktv_duration::numeric / 60) * v_rate_60 / 1000) * 1000);
            END IF;
            
            id := v_turn.turn_id::text;
            type := 'COMMISSION';
            title := 'Tiền tua đơn ' || v_turn.booking_id;
            amount := v_turn_amount;
            created_at := v_turn.counted_at;
            status := 'SUCCESS';
            note := v_ktv_duration::text || ' phút';
            RETURN NEXT;
        END IF;
    END LOOP;

    -- 3. Process Tips
    FOR v_turn IN
        SELECT id, tip, "timeEnd", "bookingId", "technicianCodes"
        FROM "BookingItems"
        WHERE p_staff_id = ANY("technicianCodes")
          AND status = 'DONE'
          AND tip > 0
          AND "timeEnd" >= '2026-05-04'::date
          AND EXTRACT(MONTH FROM "timeEnd") = p_month
          AND EXTRACT(YEAR FROM "timeEnd") = p_year
    LOOP
        id := v_turn.id;
        type := 'TIP';
        title := 'Tiền Tip đơn ' || COALESCE(v_turn."bookingId", '');
        IF array_length(v_turn."technicianCodes", 1) > 0 THEN
            amount := v_turn.tip / array_length(v_turn."technicianCodes", 1);
        ELSE
            amount := v_turn.tip;
        END IF;
        created_at := v_turn."timeEnd";
        status := 'SUCCESS';
        note := '';
        RETURN NEXT;
    END LOOP;

    -- 4. Process Adjustments
    FOR v_turn IN
        SELECT id, type as adj_type, reason, amount as adj_amount, created_at as adj_date
        FROM "WalletAdjustments"
        WHERE staff_id = p_staff_id
          AND created_at >= '2026-05-04'::date
          AND EXTRACT(MONTH FROM created_at) = p_month
          AND EXTRACT(YEAR FROM created_at) = p_year
    LOOP
        id := v_turn.id::text;
        IF v_turn.adj_type = 'GIFT' THEN type := 'GIFT';
        ELSIF v_turn.adj_type = 'PENALTY' THEN type := 'PENALTY';
        ELSE type := 'ADJUSTMENT'; END IF;
        
        IF v_turn.adj_amount >= 0 THEN
            title := 'Thưởng / Cộng tiền';
        ELSE
            title := 'Phạt / Trừ tiền';
        END IF;
        
        amount := v_turn.adj_amount;
        created_at := v_turn.adj_date;
        status := 'SUCCESS';
        note := v_turn.reason;
        RETURN NEXT;
    END LOOP;

    -- 5. Process Withdrawals
    FOR v_turn IN
        SELECT id, amount as w_amount, request_date, status as w_status, note as w_note
        FROM "KTVWithdrawals"
        WHERE staff_id = p_staff_id
          AND request_date >= '2026-05-04'::date
          AND EXTRACT(MONTH FROM request_date) = p_month
          AND EXTRACT(YEAR FROM request_date) = p_year
    LOOP
        id := v_turn.id::text;
        type := 'WITHDRAWAL';
        title := 'Rút tiền mặt';
        amount := -v_turn.w_amount; -- Negative for withdrawals
        created_at := v_turn.request_date;
        status := v_turn.w_status;
        note := v_turn.w_note;
        RETURN NEXT;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;
