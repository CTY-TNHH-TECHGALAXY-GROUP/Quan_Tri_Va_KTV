-- Migration: Cập nhật logic tính tiền tua: Tính từng dịch vụ rồi cộng lại
-- Date: 2026-06-03

-- 1. Update get_ktv_wallet_balance
CREATE OR REPLACE FUNCTION get_ktv_wallet_balance(p_staff_id text)
RETURNS jsonb AS $$
DECLARE
    v_total_commission numeric := 0;
    v_total_tip numeric := 0;
    v_total_adjustment numeric := 0;
    v_total_withdrawn numeric := 0;
    v_total_pending numeric := 0;
    v_min_deposit numeric := 500000;
    v_milestones jsonb;
    v_rate_60 numeric := 100000;
    v_config_val text;
    v_turn record;
    v_item record;
    v_seg record;
    v_ktv_duration integer;
    v_seg_arr jsonb;
    v_seg_item jsonb;
    v_real_mins integer;
    v_has_items boolean;
BEGIN
    -- 1. Load Configurations
    SELECT value::text INTO v_config_val FROM "SystemConfigs" WHERE key = 'KTV_MINIMUM_DEPOSIT';
    IF FOUND AND v_config_val IS NOT NULL THEN
        v_min_deposit := REPLACE(v_config_val, '"', '')::numeric;
    END IF;

    SELECT value INTO v_milestones FROM "SystemConfigs" WHERE key = 'ktv_commission_milestones';
    IF NOT FOUND OR v_milestones IS NULL THEN
        v_milestones := '{"1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "120": 200000, "180": 300000, "300": 500000}'::jsonb;
    END IF;

    SELECT value::text INTO v_config_val FROM "SystemConfigs" WHERE key = 'ktv_commission_per_60min';
    IF FOUND AND v_config_val IS NOT NULL THEN
        v_rate_60 := REPLACE(v_config_val, '"', '')::numeric;
    END IF;

    -- 2. Calculate Adjustments (+/-) FROM 04-05-2026
    SELECT COALESCE(SUM(amount), 0) INTO v_total_adjustment
    FROM "WalletAdjustments"
    WHERE staff_id = p_staff_id AND created_at >= '2026-05-04'::date;

    -- 3. Calculate Withdrawals (-) FROM 04-05-2026
    SELECT COALESCE(SUM(amount), 0) INTO v_total_withdrawn
    FROM "KTVWithdrawals"
    WHERE staff_id = p_staff_id AND status = 'APPROVED' AND request_date >= '2026-05-04'::date;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_pending
    FROM "KTVWithdrawals"
    WHERE staff_id = p_staff_id AND status = 'PENDING' AND request_date >= '2026-05-04'::date;

    -- 4. Calculate Tips FROM 04-05-2026
    SELECT COALESCE(SUM(
        CASE 
            WHEN array_length("technicianCodes", 1) > 0 THEN tip / array_length("technicianCodes", 1)
            ELSE tip 
        END
    ), 0) INTO v_total_tip
    FROM "BookingItems"
    WHERE p_staff_id = ANY("technicianCodes") AND status = 'DONE' AND "timeEnd" >= '2026-05-04'::date;

    -- 5. Calculate Commission from TurnLedger & BookingItems FROM 04-05-2026
    FOR v_turn IN 
        SELECT DISTINCT booking_id 
        FROM "TurnLedger" 
        WHERE employee_id = p_staff_id AND counted_at >= '2026-05-04'::date
    LOOP
        v_has_items := false;

        FOR v_item IN 
            SELECT i.segments, i.status, s.duration as default_duration, s.id as service_id, s."nameVN" as service_name, s.is_utility
            FROM "BookingItems" i
            LEFT JOIN "Services" s ON i."serviceId" = s.id
            WHERE i."bookingId" = v_turn.booking_id 
              AND p_staff_id = ANY(i."technicianCodes")
        LOOP
            -- Ignore utility / private room (KHÔNG tính vào tiền tua)
            IF v_item.is_utility = true OR v_item.service_id = 'NHS0900' OR LOWER(COALESCE(v_item.service_name, '')) LIKE '%phòng riêng%' OR LOWER(COALESCE(v_item.service_name, '')) LIKE '%phong rieng%' THEN
                CONTINUE;
            END IF;

            v_has_items := true;
            v_ktv_duration := 0;

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
                            v_real_mins := get_mins_from_times(v_seg_item->>'startTime', v_seg_item->>'endTime');
                            IF v_real_mins > 0 THEN
                                v_ktv_duration := v_ktv_duration + v_real_mins;
                            ELSE
                                v_ktv_duration := v_ktv_duration + COALESCE((v_seg_item->>'duration')::integer, COALESCE(v_item.default_duration, 60));
                            END IF;
                        END IF;
                    END LOOP;
                EXCEPTION WHEN OTHERS THEN
                    v_ktv_duration := v_ktv_duration + COALESCE(v_item.default_duration, 60);
                END;
            ELSE
                v_ktv_duration := v_ktv_duration + COALESCE(v_item.default_duration, 60);
            END IF;

            -- Nếu thời gian = 0, gán mặc định 60p
            IF v_ktv_duration <= 0 THEN
                v_ktv_duration := 60;
            END IF;

            -- Tính tiền CHO TỪNG DỊCH VỤ rồi cộng dồn
            IF v_milestones ? v_ktv_duration::text THEN
                v_total_commission := v_total_commission + (v_milestones->>v_ktv_duration::text)::numeric;
            ELSE
                v_total_commission := v_total_commission + (ROUND((v_ktv_duration::numeric / 60) * v_rate_60 / 1000) * 1000);
            END IF;
        END LOOP;

        -- Fallback: Nếu đơn không có item hợp lệ nào (bị filter hết) thì tính mặc định 60p
        IF NOT v_has_items THEN
            IF v_milestones ? '60' THEN
                v_total_commission := v_total_commission + (v_milestones->>'60')::numeric;
            ELSE
                v_total_commission := v_total_commission + v_rate_60;
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

-- 2. Update get_ktv_wallet_timeline
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
    v_total_booking_duration integer;
    v_milestones jsonb;
    v_rate_60 numeric := 100000;
    v_config_val text;
    v_seg_arr jsonb;
    v_seg_item jsonb;
    v_turn_amount numeric;
    v_real_mins integer;
    v_has_items boolean;
BEGIN
    -- 1. Load Configurations
    SELECT value INTO v_milestones FROM "SystemConfigs" WHERE key = 'ktv_commission_milestones';
    IF NOT FOUND OR v_milestones IS NULL THEN
        v_milestones := '{"1": 2000, "30": 50000, "45": 75000, "60": 100000, "70": 115000, "90": 150000, "120": 200000, "180": 300000, "300": 500000}'::jsonb;
    END IF;

    SELECT value::text INTO v_config_val FROM "SystemConfigs" WHERE key = 'ktv_commission_per_60min';
    IF FOUND AND v_config_val IS NOT NULL THEN
        v_rate_60 := REPLACE(v_config_val, '"', '')::numeric;
    END IF;

    -- 2. Process TurnLedger (Commission)
    FOR v_turn IN 
        SELECT DISTINCT tl.booking_id, tl.counted_at, tl.id as turn_id
        FROM "TurnLedger" tl
        WHERE tl.employee_id = p_staff_id
          AND tl.counted_at >= '2026-05-04'::date
          AND EXTRACT(MONTH FROM tl.counted_at) = p_month
          AND EXTRACT(YEAR FROM tl.counted_at) = p_year
    LOOP
        v_turn_amount := 0;
        v_total_booking_duration := 0;
        v_has_items := false;

        FOR v_item IN 
            SELECT i.id as item_id, i.segments, i.status, s.duration as default_duration, s.id as service_id, s."nameVN" as service_name, s.is_utility
            FROM "BookingItems" i
            LEFT JOIN "Services" s ON i."serviceId" = s.id
            WHERE i."bookingId" = v_turn.booking_id 
              AND p_staff_id = ANY(i."technicianCodes")
        LOOP
            -- Ignore utility / private room
            IF v_item.is_utility = true OR v_item.service_id = 'NHS0900' OR LOWER(COALESCE(v_item.service_name, '')) LIKE '%phòng riêng%' OR LOWER(COALESCE(v_item.service_name, '')) LIKE '%phong rieng%' THEN
                CONTINUE;
            END IF;

            v_has_items := true;
            v_ktv_duration := 0;

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
                            v_real_mins := get_mins_from_times(v_seg_item->>'startTime', v_seg_item->>'endTime');
                            IF v_real_mins > 0 THEN
                                v_ktv_duration := v_ktv_duration + v_real_mins;
                            ELSE
                                v_ktv_duration := v_ktv_duration + COALESCE((v_seg_item->>'duration')::integer, COALESCE(v_item.default_duration, 60));
                            END IF;
                        END IF;
                    END LOOP;
                EXCEPTION WHEN OTHERS THEN
                    v_ktv_duration := v_ktv_duration + COALESCE(v_item.default_duration, 60);
                END;
            ELSE
                v_ktv_duration := v_ktv_duration + COALESCE(v_item.default_duration, 60);
            END IF;

            -- Nếu thời gian = 0, gán mặc định 60p
            IF v_ktv_duration <= 0 THEN
                v_ktv_duration := 60;
            END IF;
            
            v_total_booking_duration := v_total_booking_duration + v_ktv_duration;

            -- Tính tiền CHO TỪNG DỊCH VỤ rồi cộng dồn
            IF v_milestones ? v_ktv_duration::text THEN
                v_turn_amount := v_turn_amount + (v_milestones->>v_ktv_duration::text)::numeric;
            ELSE
                v_turn_amount := v_turn_amount + (ROUND((v_ktv_duration::numeric / 60) * v_rate_60 / 1000) * 1000);
            END IF;
        END LOOP;

        IF NOT v_has_items THEN
            v_total_booking_duration := 60;
            IF v_milestones ? '60' THEN
                v_turn_amount := (v_milestones->>'60')::numeric;
            ELSE
                v_turn_amount := v_rate_60;
            END IF;
        END IF;

        IF v_turn_amount > 0 THEN
            id := v_turn.turn_id::text;
            type := 'COMMISSION';
            title := 'Tiền tua đơn ' || v_turn.booking_id;
            amount := v_turn_amount;
            created_at := v_turn.counted_at;
            status := 'SUCCESS';
            note := v_total_booking_duration::text || ' phút';
            RETURN NEXT;
        END IF;
    END LOOP;

    -- 3. Process Tips
    FOR v_turn IN
        SELECT b.id as item_id, b.tip, b."timeEnd", b."bookingId", b."technicianCodes"
        FROM "BookingItems" b
        WHERE p_staff_id = ANY(b."technicianCodes")
          AND b.status = 'DONE'
          AND b.tip > 0
          AND b."timeEnd" >= '2026-05-04'::date
          AND EXTRACT(MONTH FROM b."timeEnd") = p_month
          AND EXTRACT(YEAR FROM b."timeEnd") = p_year
    LOOP
        id := v_turn.item_id;
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
        SELECT wa.id as adj_id, wa.type as adj_type, wa.reason, wa.amount as adj_amount, wa.created_at as adj_date
        FROM "WalletAdjustments" wa
        WHERE wa.staff_id = p_staff_id
          AND wa.created_at >= '2026-05-04'::date
          AND EXTRACT(MONTH FROM wa.created_at) = p_month
          AND EXTRACT(YEAR FROM wa.created_at) = p_year
    LOOP
        id := v_turn.adj_id::text;
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
        SELECT kw.id as w_id, kw.amount as w_amount, kw.request_date, kw.status as w_status, kw.note as w_note
        FROM "KTVWithdrawals" kw
        WHERE kw.staff_id = p_staff_id
          AND kw.request_date >= '2026-05-04'::date
          AND EXTRACT(MONTH FROM kw.request_date) = p_month
          AND EXTRACT(YEAR FROM kw.request_date) = p_year
    LOOP
        id := v_turn.w_id::text;
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
