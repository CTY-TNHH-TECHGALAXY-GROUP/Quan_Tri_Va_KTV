-- =============================================================================
-- Promotion Engine v14 — Phòng riêng counts in the order total; % discount on the whole order
-- Plan: plans/plan_promotion_phong_rieng_va_phut_tang.md §A (user 05/10/2026).
--   * Bookings.totalAmount already includes Phòng riêng (NHS0900, 105.000đ) on every order;
--     the engine excluded it → "đơn từ X đồng" and "giảm %" now use the same total.
--   * Utilities never add minutes and never make an order "match a menu".
--   * Usages already applied keep their recorded discount.
-- =============================================================================

-- Paid utility lines (Phòng riêng…) of an order, excluding promotion lines and cancelled ones.
CREATE OR REPLACE FUNCTION promo_utility_amount(p_booking_id text)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(sum(COALESCE(bi.price, 0) * GREATEST(COALESCE(bi.quantity, 1), 1)), 0)
      FROM "BookingItems" bi
      LEFT JOIN "Services" s ON s.id = bi."serviceId"
     WHERE bi."bookingId" = p_booking_id
       AND COALESCE(bi.status, '') <> 'CANCELLED'
       AND (COALESCE(s.is_utility, false) OR bi."serviceId" = 'NHS0900')
       AND NOT COALESCE(s.is_promotion, false)
       AND COALESCE(jsonb_unwrap_string(bi.options)->>'isPromotion', '') <> 'true'
       AND COALESCE(jsonb_unwrap_string(bi.options)->>'isPaid', '') <> 'false';
$$;

CREATE OR REPLACE FUNCTION promo_order_minutes(p_booking_id text, p_config jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status   text;
    v_paid     integer := 0;
    v_qual     integer := 0;
    v_promo    integer := 0;
    v_amount   numeric := 0;
    v_qual_amt numeric := 0;
    r          record;
    v_opt      jsonb;
    v_min      integer;
    v_line     numeric;
BEGIN
    SELECT status::text INTO v_status FROM "Bookings" WHERE id = p_booking_id;
    IF v_status IS NULL OR v_status = 'SPLIT' THEN
        RETURN jsonb_build_object('paidMinutes', 0, 'qualifyingMinutes', 0, 'promotionMinutes', 0,
                                  'totalMinutes', 0, 'paidAmount', 0, 'qualifyingAmount', 0);
    END IF;

    FOR r IN
        SELECT bi."serviceId" AS service_id, bi.options, bi.quantity, bi.price,
               s.duration AS svc_duration, s.category, COALESCE(s.is_utility, false) AS is_utility,
               COALESCE(s.is_promotion, false) AS is_promotion
        FROM "BookingItems" bi
        LEFT JOIN "Services" s ON s.id = bi."serviceId"
        WHERE bi."bookingId" = p_booking_id
          AND COALESCE(bi.status, '') <> 'CANCELLED'
    LOOP
        v_opt := COALESCE(jsonb_unwrap_string(r.options), '{}'::jsonb);
        IF jsonb_typeof(v_opt) <> 'object' THEN v_opt := '{}'::jsonb; END IF;
        v_min := promo_item_minutes(r.options, r.svc_duration, r.quantity);

        IF r.is_promotion OR (v_opt->>'isPromotion') = 'true' THEN
            IF NOT r.is_utility THEN v_promo := v_promo + v_min; END IF;
            CONTINUE;
        END IF;
        -- Utilities (Phòng riêng) are part of the order total (user 05/10/2026), never of minutes.
        IF r.is_utility OR r.service_id = 'NHS0900' THEN
            IF COALESCE(v_opt->>'isPaid', '') <> 'false' THEN
                v_amount := v_amount + COALESCE(r.price, 0) * GREATEST(COALESCE(r.quantity, 1), 1);
            END IF;
            CONTINUE;
        END IF;
        IF NULLIF(v_opt->>'mergedIntoId', '') IS NOT NULL THEN CONTINUE; END IF;
        IF (v_opt->>'isPaid') = 'false' THEN CONTINUE; END IF;

        v_line := COALESCE(r.price, 0) * GREATEST(COALESCE(r.quantity, 1), 1);
        v_paid := v_paid + v_min;
        v_amount := v_amount + v_line;
        IF promo_service_in_scope(r.service_id, r.category, p_config) THEN
            v_qual := v_qual + v_min;
            v_qual_amt := v_qual_amt + v_line;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'paidMinutes', v_paid, 'qualifyingMinutes', v_qual, 'promotionMinutes', v_promo,
        'totalMinutes', v_paid + v_promo, 'paidAmount', v_amount, 'qualifyingAmount', v_qual_amt);
END;
$$;

CREATE OR REPLACE FUNCTION promo_evaluate_conditions(p_booking_id text, p_conditions jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_match text := upper(COALESCE(p_conditions->>'match', 'ALL'));
    v_conds jsonb := COALESCE(p_conditions->'conditions', '[]'::jsonb);
    v_amount numeric;
    v_results jsonb := '[]'::jsonb;
    v_all_ids text[] := ARRAY[]::text[];
    v_met_count int := 0;
    v_n int := jsonb_array_length(COALESCE(p_conditions->'conditions', '[]'::jsonb));
    c jsonb;
    i int := 0;
    v_ids text[];
    v_best int;
    v_scope_best int;
    v_amt_ok boolean;
    v_met boolean;
    v_overall boolean;
    v_matched_amount numeric;
    v_channel text := promo_booking_channel(p_booking_id);
    v_src_ok boolean;
BEGIN
    -- Order total = initial services + paid utilities (Phòng riêng), like Bookings.totalAmount.
    SELECT COALESCE(sum(line_amount), 0) + promo_utility_amount(p_booking_id) INTO v_amount FROM promo_initial_items(p_booking_id);

    IF v_n = 0 THEN
        SELECT COALESCE(array_agg(item_id), ARRAY[]::text[]), COALESCE(sum(line_amount), 0)
          INTO v_all_ids, v_matched_amount FROM promo_initial_items(p_booking_id);
        RETURN jsonb_build_object('met', cardinality(v_all_ids) > 0, 'match', v_match, 'orderAmount', v_amount, 'channel', v_channel,
                                  'matchedItemIds', to_jsonb(v_all_ids), 'matchedAmount', v_matched_amount, 'results', '[]'::jsonb);
    END IF;

    FOR c IN SELECT * FROM jsonb_array_elements(v_conds) LOOP
        SELECT COALESCE(array_agg(item_id), ARRAY[]::text[]), max(unit_minutes) INTO v_ids, v_best
          FROM promo_initial_items(p_booking_id) it
         WHERE promo_item_meets(it.service_id, it.category, it.unit_minutes, c);
        -- longest service inside the scope (ignoring minMinutes) → "đơn đang có 60 phút"
        SELECT max(unit_minutes) INTO v_scope_best
          FROM promo_initial_items(p_booking_id) it
         WHERE promo_item_meets(it.service_id, it.category, NULL, c - 'minMinutes');
        v_amt_ok := NULLIF(c->>'minOrderAmount', '') IS NULL OR v_amount >= (c->>'minOrderAmount')::numeric;
        v_src_ok := jsonb_array_length(COALESCE(c->'sources', '[]'::jsonb)) = 0
                    OR (c->'sources') ? v_channel;
        v_met := cardinality(v_ids) > 0 AND v_amt_ok AND v_src_ok;
        IF v_met THEN
            v_met_count := v_met_count + 1;
            v_all_ids := v_all_ids || v_ids;
        END IF;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
            'index', i, 'met', v_met, 'matchedItemIds', to_jsonb(v_ids),
            'bestMinutes', COALESCE(v_scope_best, 0),
            'minMinutes', c->'minMinutes', 'minOrderAmount', c->'minOrderAmount', 'amountMet', v_amt_ok,
            'sources', COALESCE(c->'sources', '[]'::jsonb), 'sourceMet', v_src_ok));
        i := i + 1;
    END LOOP;

    v_overall := CASE WHEN v_match = 'ANY' THEN v_met_count > 0 ELSE v_met_count = v_n END;
    SELECT COALESCE(sum(line_amount), 0) INTO v_matched_amount
      FROM promo_initial_items(p_booking_id) WHERE item_id = ANY (v_all_ids);
    RETURN jsonb_build_object('met', v_overall, 'match', v_match, 'orderAmount', v_amount, 'channel', v_channel,
        'matchedItemIds', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM unnest(v_all_ids) x), '[]'::jsonb),
        'matchedAmount', CASE WHEN v_overall THEN v_matched_amount ELSE 0 END,
        'results', v_results);
END;
$$;

CREATE OR REPLACE FUNCTION promo_compute_discount_ex(p_pass_id uuid, p_booking_id text, p_override_conditions boolean)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p "CustomerPromotionPasses"%ROWTYPE;
    c "PromotionCampaigns"%ROWTYPE;
    v_total numeric;
    v_base numeric;
    v_disc numeric;
    v_cap numeric;
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p.campaign_id;
    IF p.benefit_type NOT IN ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT') THEN RETURN 0; END IF;
    SELECT "totalAmount" INTO v_total FROM "Bookings" WHERE id = p_booking_id;
    v_base := (promo_evaluate_conditions(p_booking_id, c.apply_conditions)->>'matchedAmount')::numeric;
    -- Percent discount = on the WHOLE order incl. Phòng riêng (user 05/10/2026); otherwise the
    -- configured scope, or the whole order on an override where no service met the conditions.
    IF p.benefit_type = 'PERCENT_DISCOUNT' OR c.benefit_config->>'discountScope' = 'ORDER'
       OR (p_override_conditions AND COALESCE(v_base, 0) = 0) THEN
        v_base := (promo_order_minutes(p_booking_id, '{}'::jsonb)->>'paidAmount')::numeric;
    END IF;
    v_disc := CASE WHEN p.benefit_type = 'PERCENT_DISCOUNT' THEN round(v_base * p.benefit_value / 100) ELSE p.benefit_value END;
    v_cap := NULLIF(c.benefit_config->>'maxDiscountAmount', '')::numeric;
    IF v_cap IS NOT NULL THEN v_disc := LEAST(v_disc, v_cap); END IF;
    RETURN GREATEST(0, LEAST(v_disc, GREATEST(COALESCE(v_total, 0), 0)));
END;
$$;

DO $$
DECLARE fn record;
BEGIN
    FOR fn IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = 'promo_utility_amount' LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
    END LOOP;
END;
$$;
