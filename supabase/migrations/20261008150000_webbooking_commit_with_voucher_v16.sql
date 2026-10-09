-- =============================================================================
-- Promotion Engine v16: web booking writer WITH a web-claim voucher.
-- Plan: plans/plan_evoucher_webbooking_gioi_han.md (GĐ4, user decisions 08/10/2026).
--
-- public.webbooking_commit_booking_with_voucher(p_booking, p_items, p_voucher_code)
--   * NO voucher code     -> exactly webbooking_commit_booking (same result, same errors).
--   * First commit        -> webbooking_commit_booking + promo_web_activate in ONE transaction.
--                            Voucher rejected -> RAISE 'VOUCHER_REJECTED:<code>' so the booking
--                            rolls back too; the website asks "book without the voucher?".
--   * Replay (same idLegacy) of a booking that already carries this voucher:
--                            compared WITHOUT the KM line and with the pre-discount total
--                            (the plain writer would say IDEMPOTENCY_KEY_REUSED because the
--                            discount line / lower totalAmount differ from the request).
--
-- The plain writer is NOT modified (baseline: plans/sql/baseline_webbooking_commit_booking_20261008.sql),
-- so the live WebBooking route keeps working untouched until it switches to this function.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.webbooking_commit_booking_with_voucher(
    p_booking JSONB,
    p_items JSONB,
    p_voucher_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_code        TEXT := NULLIF(upper(trim(COALESCE(p_voucher_code, ''))), '');
    v_key         TEXT := NULLIF(p_booking->>'idLegacy', '');
    v_existing    RECORD;
    v_claim       RECORD;
    v_discount    NUMERIC;
    v_in_items    JSONB;
    v_old_items   JSONB;
    v_in_parent   JSONB;
    v_old_parent  JSONB;
    v_result      JSONB;
    v_activation  JSONB;
BEGIN
    -- No voucher, or a payload the plain writer rejects anyway (missing idempotency key).
    IF v_code IS NULL OR v_key IS NULL THEN
        RETURN public.webbooking_commit_booking(p_booking, p_items);
    END IF;
    IF length(v_code) > 40 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOUCHER_REJECTED:VOUCHER_NOT_FOUND';
    END IF;

    -- Same lock as the plain writer (advisory xact locks are re-entrant in one session).
    PERFORM pg_advisory_xact_lock(hashtextextended('webbooking:idlegacy:' || v_key, 0));
    SELECT b.id, b."billCode" AS bill_code, b."totalAmount" AS total_amount, b."guestCount" AS guest_count,
           b."branchName" AS branch_name, b."bookingDate" AS booking_date, b."timeBooking" AS time_booking,
           b."customerName" AS customer_name, b."customerPhone" AS customer_phone,
           b."customerEmail" AS customer_email, b."customerGender" AS customer_gender,
           b."customerLang" AS customer_lang, b."customerId" AS customer_id, b."roomName" AS room_name
      INTO v_existing
      FROM public."Bookings" b WHERE b."idLegacy" = v_key;

    IF v_existing.id IS NOT NULL THEN
        SELECT w.voucher_code, w.status, u.discount_amount
          INTO v_claim
          FROM public."PromotionWebClaims" w
          JOIN public."PromotionUsages" u ON u.id = w.usage_id
         WHERE w.activation_booking_id = v_existing.id AND w.status IN ('ACTIVE', 'REDEEMED');

        -- Earlier attempt committed WITHOUT a voucher: a replay never changes a booking.
        IF v_claim.voucher_code IS NULL THEN
            v_result := public.webbooking_commit_booking(p_booking, p_items);
            RETURN v_result || jsonb_build_object('voucher', jsonb_build_object('applied', false, 'reason', 'REPLAY_WITHOUT_VOUCHER'));
        END IF;
        IF v_claim.voucher_code IS DISTINCT FROM v_code THEN
            RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'IDEMPOTENCY_KEY_REUSED';
        END IF;

        -- Same normalisation as the plain writer's replay check, minus the promotion line,
        -- and the total BEFORE the discount (the request always carries the full price).
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'serviceId', x->>'serviceId', 'quantity', (x->>'quantity')::INTEGER,
                   'price', (x->>'price')::NUMERIC, 'options', x->'options')
                 ORDER BY x->>'serviceId', (x->>'quantity')::INTEGER, (x->>'price')::NUMERIC, (x->'options')::TEXT), '[]'::JSONB)
          INTO v_in_items FROM jsonb_array_elements(p_items) x;
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'serviceId', i."serviceId", 'quantity', i.quantity, 'price', i.price, 'options', i.options)
                 ORDER BY i."serviceId", i.quantity, i.price, i.options::TEXT), '[]'::JSONB)
          INTO v_old_items FROM public."BookingItems" i
         WHERE i."bookingId" = v_existing.id
           AND COALESCE(i.options->>'isPromotion', '') <> 'true';

        v_in_parent := jsonb_build_object(
            'guestCount', COALESCE((p_booking->>'guestCount')::INTEGER, 1), 'branchName', p_booking->>'branchName',
            'bookingDate', (p_booking->>'bookingDate')::TIMESTAMP, 'timeBooking', p_booking->>'timeBooking',
            'customerName', p_booking->>'customerName', 'customerPhone', p_booking->>'customerPhone',
            'customerEmail', p_booking->>'customerEmail', 'customerGender', p_booking->>'customerGender',
            'customerLang', p_booking->>'customerLang', 'customerId', p_booking->>'customerId',
            'roomName', p_booking->>'roomName', 'totalAmount', (p_booking->>'totalAmount')::NUMERIC);
        v_old_parent := jsonb_build_object(
            'guestCount', v_existing.guest_count, 'branchName', v_existing.branch_name,
            'bookingDate', v_existing.booking_date, 'timeBooking', v_existing.time_booking,
            'customerName', v_existing.customer_name, 'customerPhone', v_existing.customer_phone,
            'customerEmail', v_existing.customer_email, 'customerGender', v_existing.customer_gender,
            'customerLang', v_existing.customer_lang, 'customerId', v_existing.customer_id,
            'roomName', v_existing.room_name, 'totalAmount', v_existing.total_amount + v_claim.discount_amount);

        IF v_in_parent IS DISTINCT FROM v_old_parent OR v_in_items IS DISTINCT FROM v_old_items THEN
            RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'IDEMPOTENCY_KEY_REUSED';
        END IF;
        RETURN jsonb_build_object('success', true, 'idempotent', true,
            'bookingId', v_existing.id, 'billCode', v_existing.bill_code,
            'voucher', jsonb_build_object('applied', true, 'voucherCode', v_claim.voucher_code,
                'discountAmount', v_claim.discount_amount, 'totalAmount', v_existing.total_amount,
                'subtotalAmount', v_existing.total_amount + v_claim.discount_amount));
    END IF;

    -- First commit.
    v_result := public.webbooking_commit_booking(p_booking, p_items);
    IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) OR COALESCE((v_result->>'idempotent')::BOOLEAN, false) THEN
        RETURN v_result;   -- BOOKING_IN_PROGRESS etc.: untouched writer answer
    END IF;

    v_activation := public.promo_web_activate(v_code, v_result->>'bookingId');
    IF NOT COALESCE((v_activation->>'success')::BOOLEAN, false) THEN
        -- Rolls back the booking as well: one transaction, nothing half-written.
        RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'VOUCHER_REJECTED:' || COALESCE(v_activation->'error'->>'code', 'UNKNOWN'),
            DETAIL = COALESCE(v_activation->'error'->>'message', '');
    END IF;

    RETURN v_result || jsonb_build_object('voucher', jsonb_build_object('applied', true,
        'voucherCode', v_code,
        'discountAmount', (v_activation->'data'->>'discountAmount')::NUMERIC,
        'totalAmount', (v_activation->'data'->>'totalAmount')::NUMERIC,
        'subtotalAmount', (p_booking->>'totalAmount')::NUMERIC));
END;
$$;

REVOKE ALL ON FUNCTION public.webbooking_commit_booking_with_voucher(JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webbooking_commit_booking_with_voucher(JSONB, JSONB, TEXT) TO service_role;

-- =============================================================================
-- Checkout preview: the discount BEFORE the booking exists, with the engine's own formula.
-- =============================================================================

-- Formula moved out of promo_compute_discount_ex (body unchanged) so the preview, which has
-- no pass yet, uses the very same code. promo_compute_discount_ex now only reads the pass.
CREATE OR REPLACE FUNCTION promo_compute_discount_core(p_campaign_id uuid, p_benefit_type text, p_benefit_value numeric,
                                                       p_booking_id text, p_override_conditions boolean)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    v_total numeric;
    v_base numeric;
    v_disc numeric;
    v_cap numeric;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF p_benefit_type NOT IN ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT') THEN RETURN 0; END IF;
    SELECT "totalAmount" INTO v_total FROM "Bookings" WHERE id = p_booking_id;
    v_base := (promo_evaluate_conditions(p_booking_id, c.apply_conditions)->>'matchedAmount')::numeric;
    -- Percent discount = on the WHOLE order incl. Phòng riêng (user 05/10/2026); otherwise the
    -- configured scope, or the whole order on an override where no service met the conditions.
    IF p_benefit_type = 'PERCENT_DISCOUNT' OR c.benefit_config->>'discountScope' = 'ORDER'
       OR (p_override_conditions AND COALESCE(v_base, 0) = 0) THEN
        v_base := (promo_order_minutes(p_booking_id, '{}'::jsonb)->>'paidAmount')::numeric;
    END IF;
    v_disc := CASE WHEN p_benefit_type = 'PERCENT_DISCOUNT' THEN round(v_base * p_benefit_value / 100) ELSE p_benefit_value END;
    v_cap := NULLIF(c.benefit_config->>'maxDiscountAmount', '')::numeric;
    IF v_cap IS NOT NULL THEN v_disc := LEAST(v_disc, v_cap); END IF;
    RETURN GREATEST(0, LEAST(v_disc, GREATEST(COALESCE(v_total, 0), 0)));
END;
$$;

CREATE OR REPLACE FUNCTION promo_compute_discount_ex(p_pass_id uuid, p_booking_id text, p_override_conditions boolean)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p "CustomerPromotionPasses"%ROWTYPE;
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id;
    RETURN promo_compute_discount_core(p.campaign_id, p.benefit_type, p.benefit_value, p_booking_id, p_override_conditions);
END;
$$;

-- promo_web_preview(code, items): what APPLY shows at checkout.
--   items = the SAME lines the website will send to the writer: [{serviceId, quantity, options}].
--   Prices come from Services (never the client). A throw-away booking is written inside a
--   sub-transaction, evaluated by the engine, then rolled back: nothing is kept, no realtime
--   event is emitted (rolled-back changes never reach logical replication).
CREATE OR REPLACE FUNCTION promo_web_preview(p_code text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_code      text := upper(trim(COALESCE(p_code, '')));
    v           "PromotionWebClaims"%ROWTYPE;
    c           "PromotionCampaigns"%ROWTYPE;
    v_tmp       text := 'WB-PREVIEW-' || replace(gen_random_uuid()::text, '-', '');
    v_item      jsonb;
    v_price     numeric;
    v_qty       int;
    v_index     int := 0;
    v_subtotal  numeric := 0;
    v_eval      jsonb;
    v_unmet     jsonb := '[]'::jsonb;
    v_discount  numeric := 0;
    v_minutes   int := 0;
    v_bad_item  boolean := false;
BEGIN
    IF NOT promo_setting_bool('promotion_web_claim_enabled', false) THEN
        RETURN promo_err('FEATURE_DISABLED', 'Chương trình voucher web đang tắt.');
    END IF;
    SELECT * INTO v FROM "PromotionWebClaims" WHERE voucher_code = v_code;
    IF NOT FOUND THEN RETURN promo_err('VOUCHER_NOT_FOUND', 'Mã voucher không tồn tại.'); END IF;
    IF v.status IN ('ACTIVE', 'REDEEMED') THEN RETURN promo_err('VOUCHER_ALREADY_USED', 'Voucher đã được dùng cho đơn khác.'); END IF;
    IF v.status = 'CANCELLED' THEN RETURN promo_err('VOUCHER_CANCELLED', 'Voucher đã bị huỷ.'); END IF;
    IF v.status = 'EXPIRED' OR v.reservation_expires_at <= now() THEN
        RETURN promo_err('VOUCHER_EXPIRED', 'Voucher đã hết thời gian giữ chỗ.');
    END IF;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = v.campaign_id;
    IF c.status = 'ENDED' OR now() > c.valid_until THEN RETURN promo_err('CAMPAIGN_ENDED', 'Chương trình đã kết thúc.'); END IF;
    IF c.status <> 'ACTIVE' THEN RETURN promo_err('CAMPAIGN_INACTIVE', 'Chương trình đang tạm ngưng.'); END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
        RETURN promo_err('INVALID_REQUEST', 'Giỏ hàng không hợp lệ.');
    END IF;

    BEGIN
        INSERT INTO "Bookings" (id, "billCode", source, status, "totalAmount", "guestCount", "updatedAt")
        VALUES (v_tmp, v_tmp, 'WebBooking', 'NEW', 0, 1, now() AT TIME ZONE 'UTC');

        FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
            v_index := v_index + 1;
            v_qty := CASE WHEN COALESCE(v_item->>'quantity', '') ~ '^[0-9]+$' THEN (v_item->>'quantity')::int END;
            SELECT s."priceVND" INTO v_price FROM "Services" s WHERE s.id = v_item->>'serviceId' AND s."isActive" = true;
            IF v_price IS NULL OR v_qty IS NULL OR v_qty < 1 OR v_qty > 20
               OR jsonb_typeof(COALESCE(v_item->'options', '{}'::jsonb)) <> 'object' THEN
                v_bad_item := true;
                RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROMO_WEB_PREVIEW_DONE';
            END IF;
            v_subtotal := v_subtotal + v_price * v_qty;
            INSERT INTO "BookingItems" (id, "bookingId", "serviceId", quantity, price, status, options, tip)
            VALUES (v_tmp || '-' || v_index, v_tmp, v_item->>'serviceId', v_qty, v_price, 'WAITING',
                    COALESCE(v_item->'options', '{}'::jsonb), 0);
        END LOOP;
        UPDATE "Bookings" SET "totalAmount" = v_subtotal WHERE id = v_tmp;

        v_eval := promo_evaluate_conditions(v_tmp, c.apply_conditions);
        IF (v_eval->>'met')::boolean THEN
            v_discount := promo_compute_discount_core(c.id, c.benefit_type, c.benefit_value, v_tmp, false);
            v_minutes := CASE WHEN c.benefit_type = 'FREE_MINUTES' THEN c.benefit_value::int ELSE 0 END;
        ELSE
            v_unmet := COALESCE(promo_unmet_reasons(v_tmp, c.apply_conditions), '[]'::jsonb);
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROMO_WEB_PREVIEW_DONE';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'PROMO_WEB_PREVIEW_DONE' THEN RAISE; END IF;
    END;

    IF v_bad_item THEN
        RETURN promo_err('SERVICE_NOT_BOOKABLE', 'Có dịch vụ không còn đặt được. Vui lòng xem lại giỏ hàng.');
    END IF;
    RETURN promo_ok(jsonb_build_object(
        'voucherCode', v.voucher_code,
        'status', 'RESERVED',
        'expiresAt', promo_iso(v.reservation_expires_at),
        'eligible', (v_eval->>'met')::boolean,
        'unmetReasons', v_unmet,
        'benefitType', c.benefit_type,
        'benefitValue', c.benefit_value,
        'discountAmount', v_discount,
        'appliedMinutes', v_minutes,
        'subtotalAmount', v_subtotal,
        'totalAmount', v_subtotal - v_discount));
END;
$$;

REVOKE ALL ON FUNCTION promo_compute_discount_core(uuid, text, numeric, text, boolean), promo_web_preview(text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION promo_compute_discount_core(uuid, text, numeric, text, boolean), promo_web_preview(text, jsonb)
    TO service_role;
