-- =============================================================================
-- Promotion Engine v7 — configurable apply conditions (one config for apply + auto-issue).
-- Plan: plans/plan_promotion_apply_conditions.md §7 (user decisions 03/10/2026).
--
-- PromotionCampaigns.apply_conditions =
--   { "match": "ALL" | "ANY",
--     "conditions": [ { "menus": [...], "categories": [...], "serviceIds": [...],
--                       "minMinutes": 90, "minOrderAmount": null } ] }
--
--   * A condition is met when ONE initial service of the order satisfies every criterion it
--     sets (each list = "one of"): menu prefix, category, service id, minutes >= minMinutes —
--     and, if set, the order's paid amount >= minOrderAmount.
--   * Initial services = what the customer chose when sending the order: not cancelled,
--     not utility, not a promotion item, not a merged child, not an unpaid or later add-on
--     (options.isAddon). Minutes of ONE service = vipDuration → duration → Services.duration
--     (not multiplied by quantity).
--   * match ALL = every condition met, ANY = at least one. No conditions = any order.
--   * Used by: apply check (ORDER_CONDITION_NOT_MET), order candidates, % discount base
--     (matched services only), auto-issue on DONE, customer filter "onlyQualified".
--   * Legacy campaigns are converted from qualification_config / qualification_value.
-- =============================================================================

ALTER TABLE "PromotionCampaigns"
    ADD COLUMN IF NOT EXISTS apply_conditions jsonb NOT NULL DEFAULT '{"match":"ALL","conditions":[]}'::jsonb;

-- -----------------------------------------------------------------------------
-- 1. Normalisation / validation / legacy conversion
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_jsonb_text_array(p jsonb, p_upper boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN p_upper THEN upper(trim(x)) ELSE trim(x) END), '[]'::jsonb)
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END) x
     WHERE trim(x) <> '';
$$;

-- Clean + validate. Raises check_violation on invalid input (caught by create / update).
CREATE OR REPLACE FUNCTION promo_normalize_conditions(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_match text := upper(COALESCE(p->>'match', 'ALL'));
    v_in jsonb := CASE WHEN jsonb_typeof(p->'conditions') = 'array' THEN p->'conditions' ELSE '[]'::jsonb END;
    v_out jsonb := '[]'::jsonb;
    c jsonb;
    v_min numeric;
    v_amt numeric;
    v_menus jsonb; v_cats jsonb; v_ids jsonb;
BEGIN
    IF v_match NOT IN ('ALL', 'ANY') THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'applyConditions.match phải là ALL hoặc ANY';
    END IF;
    IF jsonb_array_length(v_in) > 10 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'Tối đa 10 điều kiện';
    END IF;
    FOR c IN SELECT * FROM jsonb_array_elements(v_in) LOOP
        v_menus := promo_jsonb_text_array(c->'menus', true);
        v_cats := promo_jsonb_text_array(c->'categories', true);
        v_ids := promo_jsonb_text_array(c->'serviceIds', false);
        v_min := NULLIF(c->>'minMinutes', '')::numeric;
        v_amt := NULLIF(c->>'minOrderAmount', '')::numeric;
        IF v_min IS NOT NULL AND (v_min <> trunc(v_min) OR v_min < 1 OR v_min > 1440) THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'minMinutes phải là số phút nguyên từ 1 đến 1440';
        END IF;
        IF v_amt IS NOT NULL AND v_amt < 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'minOrderAmount không được âm';
        END IF;
        IF jsonb_array_length(v_menus) = 0 AND jsonb_array_length(v_cats) = 0 AND jsonb_array_length(v_ids) = 0
           AND v_min IS NULL AND v_amt IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'Mỗi điều kiện cần ít nhất một tiêu chí';
        END IF;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'menus', v_menus, 'categories', v_cats, 'serviceIds', v_ids,
            'minMinutes', v_min::int, 'minOrderAmount', v_amt));
    END LOOP;
    RETURN jsonb_build_object('match', v_match, 'conditions', v_out);
END;
$$;

-- Legacy (qualification_config + MIN_PAID_DURATION / MIN_ORDER_AMOUNT) → apply_conditions.
-- Old scope meant "serviceIds OR (menu AND category)", so mixed scopes become two ANY conditions.
CREATE OR REPLACE FUNCTION promo_conditions_from_legacy(p_config jsonb, p_qtype text, p_qvalue numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_cfg jsonb := COALESCE(p_config, '{}'::jsonb);
    v_ids jsonb := promo_jsonb_text_array(v_cfg->'serviceIds');
    v_menus jsonb := promo_jsonb_text_array(v_cfg->'serviceIdPrefixes', true);
    v_cats jsonb := promo_jsonb_text_array(v_cfg->'serviceCategories', true);
    v_min int := CASE WHEN p_qtype = 'MIN_PAID_DURATION' THEN p_qvalue::int END;
    v_amt numeric := CASE WHEN p_qtype = 'MIN_ORDER_AMOUNT' THEN p_qvalue END;
    v_conds jsonb := '[]'::jsonb;
BEGIN
    IF jsonb_array_length(v_menus) > 0 OR jsonb_array_length(v_cats) > 0 THEN
        v_conds := v_conds || jsonb_build_array(jsonb_build_object('menus', v_menus, 'categories', v_cats, 'serviceIds', '[]'::jsonb,
                                                                   'minMinutes', v_min, 'minOrderAmount', v_amt));
    END IF;
    IF jsonb_array_length(v_ids) > 0 THEN
        v_conds := v_conds || jsonb_build_array(jsonb_build_object('menus', '[]'::jsonb, 'categories', '[]'::jsonb, 'serviceIds', v_ids,
                                                                   'minMinutes', v_min, 'minOrderAmount', v_amt));
    END IF;
    IF jsonb_array_length(v_conds) = 0 AND (v_min IS NOT NULL OR v_amt IS NOT NULL) THEN
        v_conds := jsonb_build_array(jsonb_build_object('menus', '[]'::jsonb, 'categories', '[]'::jsonb, 'serviceIds', '[]'::jsonb,
                                                        'minMinutes', v_min, 'minOrderAmount', v_amt));
    END IF;
    RETURN jsonb_build_object('match', CASE WHEN jsonb_array_length(v_conds) > 1 THEN 'ANY' ELSE 'ALL' END, 'conditions', v_conds);
END;
$$;

-- Union of all criteria (kept in qualification_config for labels / old readers).
CREATE OR REPLACE FUNCTION promo_conditions_scope(p_conditions jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'serviceIdPrefixes', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(p_conditions->'conditions') c, jsonb_array_elements_text(c->'menus') x), '[]'::jsonb),
        'serviceCategories', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(p_conditions->'conditions') c, jsonb_array_elements_text(c->'categories') x), '[]'::jsonb),
        'serviceIds', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(p_conditions->'conditions') c, jsonb_array_elements_text(c->'serviceIds') x), '[]'::jsonb));
$$;

UPDATE "PromotionCampaigns"
   SET apply_conditions = promo_conditions_from_legacy(qualification_config, qualification_type, qualification_value)
 WHERE apply_conditions = '{"match":"ALL","conditions":[]}'::jsonb;

-- -----------------------------------------------------------------------------
-- 2. Evaluation — the ONE place
-- -----------------------------------------------------------------------------
-- Services the customer chose when sending the order.
CREATE OR REPLACE FUNCTION promo_initial_items(p_booking_id text)
RETURNS TABLE(item_id text, service_id text, service_name text, category text, menu text,
              unit_minutes int, line_amount numeric, guest_id text, room_name text, bed_id text, item_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT bi.id, bi."serviceId",
           COALESCE(NULLIF(jsonb_unwrap_string(bi.options)->>'displayName', ''), s."nameVN", bi."serviceId"),
           s.category, promo_service_menu(bi."serviceId"),
           promo_item_minutes(bi.options, s.duration, 1),
           COALESCE(bi.price, 0) * GREATEST(COALESCE(bi.quantity, 1), 1),
           bi.guest_id, bi."roomName", bi."bedId", bi.status
      FROM "Bookings" b
      JOIN "BookingItems" bi ON bi."bookingId" = b.id
      LEFT JOIN "Services" s ON s.id = bi."serviceId"
     WHERE b.id = p_booking_id AND b.status::text <> 'SPLIT'
       AND COALESCE(bi.status, '') <> 'CANCELLED'
       AND NOT COALESCE(s.is_utility, false) AND COALESCE(bi."serviceId", '') <> 'NHS0900'
       AND NOT COALESCE(s.is_promotion, false)
       AND COALESCE(jsonb_unwrap_string(bi.options)->>'isPromotion', '') <> 'true'
       AND NULLIF(jsonb_unwrap_string(bi.options)->>'mergedIntoId', '') IS NULL
       AND COALESCE(jsonb_unwrap_string(bi.options)->>'isPaid', '') <> 'false'
       AND COALESCE(jsonb_unwrap_string(bi.options)->>'isAddon', '') <> 'true';
$$;

CREATE OR REPLACE FUNCTION promo_item_meets(p_service_id text, p_category text, p_minutes int, p_cond jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_menus text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_cond->'menus', '[]'::jsonb)));
    v_cats text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_cond->'categories', '[]'::jsonb)));
    v_ids text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_cond->'serviceIds', '[]'::jsonb)));
    v_min int := NULLIF(p_cond->>'minMinutes', '')::int;
BEGIN
    IF cardinality(v_menus) > 0 AND NOT EXISTS (SELECT 1 FROM unnest(v_menus) m WHERE upper(COALESCE(p_service_id, '')) LIKE m || '%') THEN RETURN false; END IF;
    IF cardinality(v_cats) > 0 AND NOT (promo_service_categories(p_category) && v_cats) THEN RETURN false; END IF;
    IF cardinality(v_ids) > 0 AND NOT (p_service_id = ANY (v_ids)) THEN RETURN false; END IF;
    IF v_min IS NOT NULL AND COALESCE(p_minutes, 0) < v_min THEN RETURN false; END IF;
    RETURN true;
END;
$$;

-- { met, match, orderAmount, matchedItemIds, matchedAmount,
--   results: [ { index, met, matchedItemIds, bestMinutes, minMinutes, minOrderAmount, amountMet } ] }
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
BEGIN
    SELECT COALESCE(sum(line_amount), 0) INTO v_amount FROM promo_initial_items(p_booking_id);

    IF v_n = 0 THEN
        SELECT COALESCE(array_agg(item_id), ARRAY[]::text[]), COALESCE(sum(line_amount), 0)
          INTO v_all_ids, v_matched_amount FROM promo_initial_items(p_booking_id);
        RETURN jsonb_build_object('met', cardinality(v_all_ids) > 0, 'match', v_match, 'orderAmount', v_amount,
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
        v_met := cardinality(v_ids) > 0 AND v_amt_ok;
        IF v_met THEN
            v_met_count := v_met_count + 1;
            v_all_ids := v_all_ids || v_ids;
        END IF;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
            'index', i, 'met', v_met, 'matchedItemIds', to_jsonb(v_ids),
            'bestMinutes', COALESCE(v_scope_best, 0),
            'minMinutes', c->'minMinutes', 'minOrderAmount', c->'minOrderAmount', 'amountMet', v_amt_ok));
        i := i + 1;
    END LOOP;

    v_overall := CASE WHEN v_match = 'ANY' THEN v_met_count > 0 ELSE v_met_count = v_n END;
    SELECT COALESCE(sum(line_amount), 0) INTO v_matched_amount
      FROM promo_initial_items(p_booking_id) WHERE item_id = ANY (v_all_ids);
    RETURN jsonb_build_object('met', v_overall, 'match', v_match, 'orderAmount', v_amount,
        'matchedItemIds', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM unnest(v_all_ids) x), '[]'::jsonb),
        'matchedAmount', CASE WHEN v_overall THEN v_matched_amount ELSE 0 END,
        'results', v_results);
END;
$$;

-- Human summary of the conditions (labels resolved; wording is done per language in TS).
CREATE OR REPLACE FUNCTION promo_conditions_summary(p_conditions jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_map jsonb;
    v_out jsonb := '[]'::jsonb;
    c jsonb;
BEGIN
    SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value
                WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb END
      INTO v_map FROM "SystemConfigs" WHERE key = 'promotion_menu_labels';
    v_map := COALESCE(v_map, '{}'::jsonb);
    FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_conditions->'conditions', '[]'::jsonb)) LOOP
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'menus', COALESCE((SELECT jsonb_agg(COALESCE(NULLIF(v_map->>m, ''), m)) FROM jsonb_array_elements_text(c->'menus') m), '[]'::jsonb),
            'categories', COALESCE((SELECT jsonb_agg(promo_category_label(x)) FROM jsonb_array_elements_text(c->'categories') x), '[]'::jsonb),
            'services', COALESCE((SELECT jsonb_agg(COALESCE(NULLIF(s."nameVN", ''), NULLIF(s."nameEN", ''), x) ORDER BY o)
                                    FROM jsonb_array_elements_text(c->'serviceIds') WITH ORDINALITY AS t(x, o)
                                    LEFT JOIN "Services" s ON s.id = t.x), '[]'::jsonb),
            'minMinutes', c->'minMinutes',
            'minOrderAmount', c->'minOrderAmount'));
    END LOOP;
    RETURN jsonb_build_object('match', upper(COALESCE(p_conditions->>'match', 'ALL')), 'conditions', v_out);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('match', 'ALL', 'conditions', '[]'::jsonb);
END;
$$;

-- Issuing (auto) uses the same conditions; AUTO needs at least one condition.
CREATE OR REPLACE FUNCTION promo_evaluate_booking_for_campaign(p_booking_id text, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c   "PromotionCampaigns"%ROWTYPE;
    m   jsonb;
    e   jsonb;
    v_ok boolean;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('eligible', false, 'reason', 'CAMPAIGN_NOT_FOUND'); END IF;
    m := promo_order_minutes(p_booking_id, c.qualification_config);
    e := promo_evaluate_conditions(p_booking_id, c.apply_conditions);
    v_ok := jsonb_array_length(c.apply_conditions->'conditions') > 0 AND (e->>'met')::boolean;
    RETURN m || jsonb_build_object('eligible', v_ok,
        'reason', CASE WHEN v_ok THEN NULL ELSE 'ORDER_CONDITION_NOT_MET' END,
        'conditions', e);
END;
$$;

CREATE OR REPLACE FUNCTION promo_issue_for_booking(p_booking_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_customer text;
    v_status   text;
    c          record;
    v_eval     jsonb;
    v_out      jsonb := '[]'::jsonb;
BEGIN
    IF NOT promo_setting_bool('promotion_auto_issue_enabled', false) THEN RETURN v_out; END IF;
    SELECT "customerId", status::text INTO v_customer, v_status FROM "Bookings" WHERE id = p_booking_id;
    IF v_status IS DISTINCT FROM 'DONE' OR NULLIF(v_customer, '') IS NULL
       OR NOT EXISTS (SELECT 1 FROM "Customers" WHERE id = v_customer) THEN
        RETURN v_out;
    END IF;
    FOR c IN
        SELECT id FROM "PromotionCampaigns"
         WHERE status = 'ACTIVE' AND assignment_mode = 'AUTO'
           AND now() >= valid_from AND now() <= valid_until
           AND jsonb_array_length(apply_conditions->'conditions') > 0
         ORDER BY created_at
    LOOP
        v_eval := promo_evaluate_booking_for_campaign(p_booking_id, c.id);
        IF (v_eval->>'eligible')::boolean THEN
            v_out := v_out || jsonb_build_array(promo_insert_pass(c.id, v_customer, p_booking_id, 'AUTO', 'SYSTEM')
                                                || jsonb_build_object('campaignId', c.id));
        END IF;
    END LOOP;
    RETURN v_out;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Apply path
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_error_message(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_code
        WHEN 'PROMOTION_NOT_FOUND' THEN 'Không tìm thấy voucher'
        WHEN 'PROMOTION_CANCELLED' THEN 'Voucher đã bị huỷ'
        WHEN 'PROMOTION_SUSPENDED' THEN 'Voucher đang bị tạm khoá'
        WHEN 'PROMOTION_EXPIRED' THEN 'Voucher đã hết hạn'
        WHEN 'PROMOTION_INACTIVE' THEN 'Chương trình khuyến mãi đang tạm dừng'
        WHEN 'PROMOTION_NOT_STARTED' THEN 'Voucher chưa đến thời gian áp dụng'
        WHEN 'BENEFIT_NOT_SUPPORTED' THEN 'Loại ưu đãi này chưa được hỗ trợ'
        WHEN 'ORDER_NOT_FOUND' THEN 'Không tìm thấy đơn hàng'
        WHEN 'ORDER_NOT_ACTIVE' THEN 'Đơn hàng không còn ở trạng thái áp dụng được'
        WHEN 'PROMOTION_ALREADY_APPLIED' THEN 'Voucher đã được áp dụng cho đơn này'
        WHEN 'PROMOTION_USAGE_LIMIT_REACHED' THEN 'Voucher đã hết lượt sử dụng'
        WHEN 'PROMOTION_USED_UP' THEN 'Voucher đã dùng hết lượt'
        WHEN 'ORDER_NOT_ELIGIBLE' THEN 'Đơn chưa có dịch vụ hoặc giá trị để áp dụng khuyến mãi'
        WHEN 'ORDER_CONDITION_NOT_MET' THEN 'Đơn chưa đạt điều kiện áp dụng của voucher'
        WHEN 'ORDER_MENU_NOT_ELIGIBLE' THEN 'Đơn không có dịch vụ thuộc menu được áp dụng của voucher'
        ELSE p_code
    END;
$$;

-- Discount base = paid amount of the services that met the conditions (whole order when
-- benefit_config.discountScope = 'ORDER').
CREATE OR REPLACE FUNCTION promo_compute_discount(p_pass_id uuid, p_booking_id text)
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
    v_base := CASE WHEN c.benefit_config->>'discountScope' = 'ORDER'
                   THEN (promo_order_minutes(p_booking_id, '{}'::jsonb)->>'paidAmount')::numeric
                   ELSE (promo_evaluate_conditions(p_booking_id, c.apply_conditions)->>'matchedAmount')::numeric END;
    v_disc := CASE WHEN p.benefit_type = 'PERCENT_DISCOUNT' THEN round(v_base * p.benefit_value / 100) ELSE p.benefit_value END;
    v_cap := NULLIF(c.benefit_config->>'maxDiscountAmount', '')::numeric;
    IF v_cap IS NOT NULL THEN v_disc := LEAST(v_disc, v_cap); END IF;
    RETURN GREATEST(0, LEAST(v_disc, GREATEST(COALESCE(v_total, 0), 0)));
END;
$$;

CREATE OR REPLACE FUNCTION promo_check_apply(p_pass_id uuid, p_booking_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p "CustomerPromotionPasses"%ROWTYPE;
    c "PromotionCampaigns"%ROWTYPE;
    b record;
    v_used_pass int;
    v_used_order int;
    v_used_cust int;
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id;
    IF NOT FOUND THEN RETURN 'PROMOTION_NOT_FOUND'; END IF;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p.campaign_id;

    IF p.status = 'CANCELLED' THEN RETURN 'PROMOTION_CANCELLED'; END IF;
    IF p.status = 'SUSPENDED' THEN RETURN 'PROMOTION_SUSPENDED'; END IF;
    IF p.status = 'EXPIRED' OR p.superseded_at IS NOT NULL OR c.status = 'ENDED' OR now() > p.valid_until OR now() > c.valid_until THEN
        RETURN 'PROMOTION_EXPIRED';
    END IF;
    IF c.status <> 'ACTIVE' THEN RETURN 'PROMOTION_INACTIVE'; END IF;
    IF now() < p.valid_from OR now() < c.valid_from THEN RETURN 'PROMOTION_NOT_STARTED'; END IF;
    IF p.benefit_type NOT IN ('FREE_MINUTES', 'PERCENT_DISCOUNT', 'FIXED_DISCOUNT') THEN RETURN 'BENEFIT_NOT_SUPPORTED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "Services" WHERE id = c.benefit_service_id) THEN RETURN 'BENEFIT_NOT_SUPPORTED'; END IF;

    SELECT id, status::text AS status, "customerId" AS customer_id INTO b FROM "Bookings" WHERE id = p_booking_id;
    IF NOT FOUND THEN RETURN 'ORDER_NOT_FOUND'; END IF;
    IF b.status NOT IN ('NEW', 'PREPARING', 'IN_PROGRESS') THEN RETURN 'ORDER_NOT_ACTIVE'; END IF;

    SELECT count(*), count(*) FILTER (WHERE booking_id = p_booking_id) INTO v_used_pass, v_used_order
      FROM "PromotionUsages" WHERE promotion_pass_id = p.id AND status <> 'CANCELLED';
    IF v_used_order >= c.max_usage_per_order THEN RETURN 'PROMOTION_ALREADY_APPLIED'; END IF;
    IF p.usage_type IN ('ONE_TIME', 'LIMITED') AND v_used_pass >= COALESCE(p.usage_limit, 1) THEN
        RETURN 'PROMOTION_USAGE_LIMIT_REACHED';
    END IF;
    IF c.max_usage_per_customer IS NOT NULL AND b.customer_id IS NOT NULL THEN
        SELECT count(*) INTO v_used_cust FROM "PromotionUsages"
         WHERE campaign_id = c.id AND customer_id = b.customer_id AND status <> 'CANCELLED';
        IF v_used_cust >= c.max_usage_per_customer THEN RETURN 'PROMOTION_USAGE_LIMIT_REACHED'; END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM promo_initial_items(p_booking_id)) THEN RETURN 'ORDER_NOT_ELIGIBLE'; END IF;
    IF NOT (promo_evaluate_conditions(p_booking_id, c.apply_conditions)->>'met')::boolean THEN
        RETURN 'ORDER_CONDITION_NOT_MET';
    END IF;
    IF p.benefit_type IN ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT') AND promo_compute_discount(p.id, p_booking_id) <= 0 THEN
        RETURN 'ORDER_NOT_ELIGIBLE';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION promo_apply_pass(p_pass_id uuid, p_booking_id text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p           "CustomerPromotionPasses"%ROWTYPE;
    c           "PromotionCampaigns"%ROWTYPE;
    b           record;
    v_svc       record;
    v_code      text;
    v_eval      jsonb;
    v_guest     text;
    v_room      text;
    v_bed       text;
    v_item_id   text;
    v_usage_id  uuid := gen_random_uuid();
    v_minutes   integer := 0;
    v_discount  numeric := 0;
    v_now_utc   timestamp := (now() AT TIME ZONE 'UTC');
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    SELECT id, status::text AS status, "customerId" AS customer_id INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;

    v_code := promo_check_apply(p_pass_id, p_booking_id);
    IF v_code IS NOT NULL THEN RETURN promo_err(v_code, promo_error_message(v_code)); END IF;

    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p.campaign_id;
    SELECT * INTO v_svc FROM "Services" WHERE id = c.benefit_service_id;
    v_eval := promo_evaluate_conditions(p_booking_id, c.apply_conditions);

    -- The benefit joins the guest / room of the service that met the conditions.
    SELECT it.guest_id, it.room_name, it.bed_id INTO v_guest, v_room, v_bed
      FROM promo_initial_items(p_booking_id) it
     ORDER BY (it.item_id IN (SELECT jsonb_array_elements_text(v_eval->'matchedItemIds'))) DESC,
              (it.item_status = 'IN_PROGRESS') DESC, it.item_id
     LIMIT 1;

    IF p.benefit_type = 'FREE_MINUTES' THEN
        v_minutes := p.benefit_value::int;
    ELSE
        v_discount := promo_compute_discount(p.id, p_booking_id);
    END IF;

    v_item_id := p_booking_id || '-promo-' || replace(v_usage_id::text, '-', '');

    BEGIN
        INSERT INTO "PromotionUsages" (id, promotion_pass_id, campaign_id, customer_id, pass_owner_id, booking_id,
                                       booking_item_id, benefit_type, benefit_value, applied_minutes, discount_amount,
                                       staff_id, status)
        VALUES (v_usage_id, p.id, c.id, b.customer_id, p.customer_id, p_booking_id,
                v_item_id, p.benefit_type, p.benefit_value, v_minutes, v_discount, p_staff_id, 'APPLIED');
    EXCEPTION WHEN unique_violation THEN
        RETURN promo_err('PROMOTION_ALREADY_APPLIED', promo_error_message('PROMOTION_ALREADY_APPLIED'));
    END;

    INSERT INTO "BookingItems" (id, "bookingId", "serviceId", quantity, price, status, "technicianCodes",
                                "roomName", "bedId", segments, options, guest_id)
    VALUES (v_item_id, p_booking_id, v_svc.id, 1, -v_discount,
            CASE WHEN p.benefit_type = 'FREE_MINUTES' THEN 'WAITING' ELSE 'DONE' END,
            '{}'::text[],
            CASE WHEN p.benefit_type = 'FREE_MINUTES' THEN v_room END,
            CASE WHEN p.benefit_type = 'FREE_MINUTES' THEN v_bed END,
            '[]'::jsonb,
            jsonb_build_object('isAddon', true, 'isPaid', true, 'isPromotion', true,
                               'promotionUsageId', v_usage_id, 'promotionPassId', p.id,
                               'promotionCampaignCode', c.campaign_code,
                               'displayName', v_svc."nameVN", 'duration', v_minutes,
                               'discountAmount', v_discount),
            v_guest);

    UPDATE "Bookings" SET "totalAmount" = GREATEST(0, COALESCE("totalAmount", 0) - v_discount), "updatedAt" = v_now_utc
     WHERE id = p_booking_id;

    RETURN promo_ok(jsonb_build_object(
        'usageId', v_usage_id,
        'bookingItemId', v_item_id,
        'appliedMinutes', v_minutes,
        'discountAmount', v_discount,
        'benefit', jsonb_build_object('type', p.benefit_type, 'value', p.benefit_value, 'serviceId', v_svc.id),
        'booking', promo_booking_json(p_booking_id),
        'pass', promo_pass_json(p.id, false)));
END;
$$;

-- Order candidates: add the per-condition result so the counter sees WHY an order is blocked.
CREATE OR REPLACE FUNCTION promo_order_candidates(p_pass_id uuid, p_q text DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_owner text;
    v_conds jsonb;
    d record;
    v_q text := NULLIF(trim(COALESCE(p_q, '')), '');
    v_rows jsonb;
BEGIN
    SELECT p.customer_id, c.apply_conditions INTO v_owner, v_conds
      FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id WHERE p.id = p_pass_id;
    IF NOT FOUND THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    SELECT * INTO d FROM promo_business_day_bounds();

    SELECT COALESCE(jsonb_agg(row_json ORDER BY is_owner DESC, created DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT COALESCE(b."customerId" = v_owner, false) AS is_owner,
               b."createdAt" AS created,
               promo_booking_json(b.id) || jsonb_build_object(
                   'isPassOwnerOrder', COALESCE(b."customerId" = v_owner, false),
                   'canApply', chk IS NULL,
                   'blockedReasonCode', chk,
                   'blockedReason', CASE WHEN chk IS NULL THEN NULL ELSE promo_error_message(chk) END,
                   'conditionResult', promo_evaluate_conditions(b.id, v_conds),
                   'alreadyAppliedThisPass', EXISTS (
                       SELECT 1 FROM "PromotionUsages" u
                        WHERE u.promotion_pass_id = p_pass_id AND u.booking_id = b.id AND u.status <> 'CANCELLED')
               ) AS row_json
        FROM "Bookings" b
        CROSS JOIN LATERAL (SELECT promo_check_apply(p_pass_id, b.id) AS chk) x
        WHERE b.status::text IN ('NEW', 'PREPARING', 'IN_PROGRESS')
          AND ((b."createdAt" >= d.utc_start AND b."createdAt" < d.utc_end)
               OR (b."bookingDate" >= d.vn_start AND b."bookingDate" < d.vn_end))
          AND (v_q IS NULL
               OR b."billCode" ILIKE '%' || v_q || '%'
               OR b.id ILIKE '%' || v_q || '%'
               OR b."customerName" ILIKE '%' || v_q || '%'
               OR b."customerPhone" ILIKE '%' || v_q || '%'
               OR b."roomName" ILIKE '%' || v_q || '%'
               OR EXISTS (SELECT 1 FROM "BookingItems" bi WHERE bi."bookingId" = b.id AND bi."roomName" ILIKE '%' || v_q || '%'))
        ORDER BY (b."customerId" = v_owner) DESC NULLS LAST, b."createdAt" DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    ) t;
    RETURN promo_ok(v_rows);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Campaign create / update / JSON
-- -----------------------------------------------------------------------------
-- Resolve the conditions of a payload: explicit apply_conditions wins, else legacy fields.
CREATE OR REPLACE FUNCTION promo_payload_conditions(p_payload jsonb, c "PromotionCampaigns")
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p_payload ? 'apply_conditions' AND p_payload->'apply_conditions' <> 'null'::jsonb THEN
        RETURN promo_normalize_conditions(p_payload->'apply_conditions');
    END IF;
    IF p_payload ?| ARRAY['qualification_config', 'qualification_type', 'qualification_value'] THEN
        RETURN promo_conditions_from_legacy(
            COALESCE(NULLIF(p_payload->'qualification_config', 'null'::jsonb), c.qualification_config, '{}'::jsonb),
            COALESCE(p_payload->>'qualification_type', c.qualification_type, 'MANUAL_ASSIGNMENT'),
            CASE WHEN p_payload ? 'qualification_value' THEN NULLIF(p_payload->>'qualification_value', '')::numeric ELSE c.qualification_value END);
    END IF;
    RETURN NULL;   -- unchanged
END;
$$;

CREATE OR REPLACE FUNCTION promo_create_campaign(p_payload jsonb, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id uuid;
    v_empty "PromotionCampaigns";
    v_conds jsonb;
BEGIN
    IF COALESCE(p_payload->>'benefit_type', '') IN ('FREE_SERVICE', 'FREE_UPGRADE') THEN
        RETURN promo_err('BENEFIT_NOT_SUPPORTED', 'Loại ưu đãi này chưa được hỗ trợ');
    END IF;
    IF EXISTS (SELECT 1 FROM "PromotionCampaigns" WHERE campaign_code = upper(p_payload->>'campaign_code')) THEN
        RETURN promo_err('CAMPAIGN_CODE_EXISTS', 'Mã chương trình đã tồn tại');
    END IF;
    v_conds := COALESCE(promo_payload_conditions(p_payload, v_empty), '{"match":"ALL","conditions":[]}'::jsonb);
    IF COALESCE(p_payload->>'assignment_mode', 'MANUAL_ONLY') = 'AUTO' AND jsonb_array_length(v_conds->'conditions') = 0 THEN
        RETURN promo_err('CAMPAIGN_INVALID', 'Phát tự động cần ít nhất một điều kiện');
    END IF;

    INSERT INTO "PromotionCampaigns" (
        campaign_code, name, description, benefit_type, benefit_value, benefit_config,
        valid_from, valid_until, usage_type, usage_limit, max_usage_per_customer, max_usage_per_order,
        qualification_type, qualification_value, qualification_config, apply_conditions, assignment_mode,
        one_pass_per_customer, voucher_prefix, validity_type, validity_days, status, created_by)
    VALUES (
        upper(p_payload->>'campaign_code'),
        p_payload->>'name',
        NULLIF(p_payload->>'description', ''),
        p_payload->>'benefit_type',
        (p_payload->>'benefit_value')::numeric,
        COALESCE(NULLIF(p_payload->'benefit_config', 'null'::jsonb), '{}'::jsonb),
        (p_payload->>'valid_from')::timestamptz,
        (p_payload->>'valid_until')::timestamptz,
        COALESCE(p_payload->>'usage_type', 'UNLIMITED'),
        NULLIF(p_payload->>'usage_limit', '')::int,
        NULLIF(p_payload->>'max_usage_per_customer', '')::int,
        COALESCE(NULLIF(p_payload->>'max_usage_per_order', '')::int, 1),
        COALESCE(p_payload->>'qualification_type', 'MANUAL_ASSIGNMENT'),
        NULLIF(p_payload->>'qualification_value', '')::numeric,
        promo_conditions_scope(v_conds),
        v_conds,
        COALESCE(p_payload->>'assignment_mode', 'MANUAL_ONLY'),
        COALESCE((p_payload->>'one_pass_per_customer')::boolean, true),
        upper(COALESCE(NULLIF(p_payload->>'voucher_prefix', ''), 'KM')),
        COALESCE(p_payload->>'validity_type', 'CAMPAIGN_PERIOD'),
        NULLIF(p_payload->>'validity_days', '')::int,
        'DRAFT',
        p_staff_id)
    RETURNING id INTO v_id;

    PERFORM promo_sync_benefit_service(v_id, NULLIF(p_payload->>'service_name_vn', ''), NULLIF(p_payload->>'service_name_en', ''));
    RETURN promo_ok(promo_campaign_json(v_id));
EXCEPTION
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
        RETURN promo_err('CAMPAIGN_INVALID', SQLERRM);
    WHEN unique_violation THEN
        RETURN promo_err('CAMPAIGN_CODE_EXISTS', 'Mã chương trình đã tồn tại');
END;
$$;

CREATE OR REPLACE FUNCTION promo_update_campaign(p_campaign_id uuid, p_payload jsonb, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    v_rule_keys constant text[] := ARRAY['benefit_type','benefit_value','benefit_config','valid_from','usage_type',
        'usage_limit','max_usage_per_customer','max_usage_per_order','assignment_mode','one_pass_per_customer',
        'voucher_prefix','campaign_code','validity_type','validity_days'];
    k text;
    v_changed text[] := ARRAY[]::text[];
    v_conds jsonb;
    v_mode text;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình'); END IF;
    IF c.status = 'ENDED' THEN RETURN promo_err('CAMPAIGN_ENDED', 'Chương trình đã kết thúc'); END IF;
    IF p_payload->>'benefit_type' IN ('FREE_SERVICE', 'FREE_UPGRADE') THEN
        RETURN promo_err('BENEFIT_NOT_SUPPORTED', 'Loại ưu đãi này chưa được hỗ trợ');
    END IF;

    FOREACH k IN ARRAY v_rule_keys LOOP
        IF p_payload ? k AND promo_campaign_key_changed(c, k, p_payload -> k) THEN
            v_changed := v_changed || k;
        END IF;
    END LOOP;
    v_conds := promo_payload_conditions(p_payload, c);
    IF v_conds IS NOT NULL AND v_conds IS DISTINCT FROM c.apply_conditions THEN
        v_changed := v_changed || 'apply_conditions'::text;
    END IF;
    IF c.status <> 'DRAFT' AND cardinality(v_changed) > 0 THEN
        RETURN promo_err('CAMPAIGN_LOCKED', 'Chỉ sửa được quy tắc khi chương trình còn ở trạng thái Nháp',
                         jsonb_build_object('data', jsonb_build_object('fields', to_jsonb(v_changed))));
    END IF;
    v_mode := COALESCE(p_payload->>'assignment_mode', c.assignment_mode);
    IF v_mode = 'AUTO' AND jsonb_array_length(COALESCE(v_conds, c.apply_conditions)->'conditions') = 0 THEN
        RETURN promo_err('CAMPAIGN_INVALID', 'Phát tự động cần ít nhất một điều kiện');
    END IF;

    UPDATE "PromotionCampaigns" SET
        campaign_code          = COALESCE(upper(NULLIF(p_payload->>'campaign_code', '')), campaign_code),
        name                   = COALESCE(NULLIF(p_payload->>'name', ''), name),
        description            = CASE WHEN p_payload ? 'description' THEN NULLIF(p_payload->>'description', '') ELSE description END,
        benefit_type           = COALESCE(p_payload->>'benefit_type', benefit_type),
        benefit_value          = COALESCE((p_payload->>'benefit_value')::numeric, benefit_value),
        benefit_config         = COALESCE(NULLIF(p_payload->'benefit_config', 'null'::jsonb), benefit_config),
        valid_from             = COALESCE((p_payload->>'valid_from')::timestamptz, valid_from),
        valid_until            = COALESCE((p_payload->>'valid_until')::timestamptz, valid_until),
        usage_type             = COALESCE(p_payload->>'usage_type', usage_type),
        usage_limit            = CASE WHEN p_payload ? 'usage_limit' THEN NULLIF(p_payload->>'usage_limit', '')::int ELSE usage_limit END,
        max_usage_per_customer = CASE WHEN p_payload ? 'max_usage_per_customer' THEN NULLIF(p_payload->>'max_usage_per_customer', '')::int ELSE max_usage_per_customer END,
        max_usage_per_order    = COALESCE((p_payload->>'max_usage_per_order')::int, max_usage_per_order),
        qualification_type     = COALESCE(p_payload->>'qualification_type', qualification_type),
        qualification_value    = CASE WHEN p_payload ? 'qualification_value' THEN NULLIF(p_payload->>'qualification_value', '')::numeric ELSE qualification_value END,
        apply_conditions       = COALESCE(v_conds, apply_conditions),
        qualification_config   = CASE WHEN v_conds IS NOT NULL THEN promo_conditions_scope(v_conds) ELSE qualification_config END,
        assignment_mode        = COALESCE(p_payload->>'assignment_mode', assignment_mode),
        one_pass_per_customer  = COALESCE((p_payload->>'one_pass_per_customer')::boolean, one_pass_per_customer),
        voucher_prefix         = COALESCE(upper(NULLIF(p_payload->>'voucher_prefix', '')), voucher_prefix),
        validity_type          = COALESCE(p_payload->>'validity_type', validity_type),
        validity_days          = CASE WHEN p_payload ? 'validity_days' THEN NULLIF(p_payload->>'validity_days', '')::int ELSE validity_days END,
        updated_at             = now()
    WHERE id = p_campaign_id;

    IF p_payload ? 'valid_until' AND promo_campaign_key_changed(c, 'valid_until', p_payload -> 'valid_until')
       AND c.validity_type = 'CAMPAIGN_PERIOD' THEN
        UPDATE "CustomerPromotionPasses" SET valid_until = (p_payload->>'valid_until')::timestamptz, updated_at = now()
        WHERE campaign_id = p_campaign_id AND status IN ('ACTIVE', 'EXPIRED') AND superseded_at IS NULL
          AND (p_payload->>'valid_until')::timestamptz > valid_from;
        UPDATE "CustomerPromotionPasses" SET status = 'ACTIVE', status_reason = NULL, updated_at = now()
        WHERE campaign_id = p_campaign_id AND status = 'EXPIRED' AND superseded_at IS NULL AND valid_until > now();
    END IF;

    PERFORM promo_sync_benefit_service(p_campaign_id, NULLIF(p_payload->>'service_name_vn', ''), NULLIF(p_payload->>'service_name_en', ''));
    RETURN promo_ok(promo_campaign_json(p_campaign_id));
EXCEPTION
    WHEN check_violation OR not_null_violation OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
        RETURN promo_err('CAMPAIGN_INVALID', SQLERRM);
    WHEN unique_violation THEN
        RETURN promo_err('CAMPAIGN_CODE_EXISTS', 'Mã chương trình đã tồn tại');
END;
$$;

CREATE OR REPLACE FUNCTION promo_campaign_json(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id', c.id, 'campaignCode', c.campaign_code, 'name', c.name, 'description', c.description,
        'benefit', jsonb_build_object('type', c.benefit_type, 'value', c.benefit_value,
                                      'config', c.benefit_config, 'serviceId', c.benefit_service_id),
        'usage', jsonb_build_object('type', c.usage_type, 'limit', c.usage_limit,
                                    'maxPerOrder', c.max_usage_per_order, 'maxPerCustomer', c.max_usage_per_customer),
        'qualification', jsonb_build_object('type', c.qualification_type, 'value', c.qualification_value,
                                            'config', c.qualification_config),
        'applyConditions', c.apply_conditions,
        'conditionsSummary', promo_conditions_summary(c.apply_conditions),
        'applicableMenus', jsonb_build_object(
            'menus', COALESCE(c.qualification_config->'serviceIdPrefixes', '[]'::jsonb),
            'categories', COALESCE(c.qualification_config->'serviceCategories', '[]'::jsonb),
            'serviceIds', COALESCE(c.qualification_config->'serviceIds', '[]'::jsonb),
            'allMenus', promo_scope_is_empty(c.qualification_config),
            'labels', promo_scope_labels(c.qualification_config)),
        'validity', jsonb_build_object('type', c.validity_type, 'days', c.validity_days),
        'assignmentMode', c.assignment_mode, 'onePassPerCustomer', c.one_pass_per_customer,
        'status', c.status,
        'validFrom', promo_iso(c.valid_from), 'validUntil', promo_iso(c.valid_until),
        'voucherPrefix', c.voucher_prefix,
        'benefitServiceId', c.benefit_service_id,
        'issuedPassCount', (SELECT count(*) FROM "CustomerPromotionPasses" p WHERE p.campaign_id = c.id),
        'usageCount', (SELECT count(*) FROM "PromotionUsages" u WHERE u.campaign_id = c.id AND u.status <> 'CANCELLED'),
        'createdBy', c.created_by, 'createdAt', promo_iso(c.created_at), 'updatedAt', promo_iso(c.updated_at))
    FROM "PromotionCampaigns" c WHERE c.id = p_campaign_id;
$$;

-- Keep scope labels in sync for campaigns converted above.
UPDATE "PromotionCampaigns" SET qualification_config = promo_conditions_scope(apply_conditions)
 WHERE jsonb_array_length(apply_conditions->'conditions') > 0;

-- Public voucher: conditions summary for the customer page.
CREATE OR REPLACE FUNCTION promo_public_voucher_by_token(p_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id uuid;
    j jsonb;
    v_menus jsonb;
    v_labels jsonb;
    v_summary jsonb;
BEGIN
    IF NULLIF(trim(COALESCE(p_qr_token, '')), '') IS NULL OR length(p_qr_token) > 200 THEN
        RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND'));
    END IF;
    SELECT id INTO v_id FROM "CustomerPromotionPasses" WHERE qr_token = trim(p_qr_token);
    IF v_id IS NULL THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    j := promo_pass_json(v_id, true);
    SELECT promo_campaign_json(c.id)->'applicableMenus', promo_scope_labels(c.qualification_config), promo_conditions_summary(c.apply_conditions)
      INTO v_menus, v_labels, v_summary
      FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id WHERE p.id = v_id;
    RETURN promo_ok(jsonb_build_object(
        'campaignName', j#>'{campaign,name}',
        'benefit', jsonb_build_object('type', j#>'{benefit,type}', 'value', j#>'{benefit,value}'),
        'usage', jsonb_build_object('type', j#>'{usage,type}', 'limit', j#>'{usage,limit}',
                                    'maxPerOrder', j#>'{usage,maxPerOrder}', 'usedCount', j#>'{usage,usedCount}'),
        'validFrom', j->'validFrom',
        'validUntil', j->'validUntil',
        'voucherCode', j->'voucherCode',
        'voucherPrefix', split_part(j->>'voucherCode', '-', 1),
        'customerName', j#>'{customer,name}',
        'status', j->'status',
        'effectiveStatus', j->'effectiveStatus',
        'applicableMenus', v_menus,
        'menuLabels', v_labels,
        'conditionsSummary', v_summary,
        'qrToken', CASE WHEN j->>'effectiveStatus' IN ('ACTIVE', 'NOT_STARTED') THEN j->'qrToken' END));
END;
$$;

-- Pass JSON carries the conditions so every voucher card shows the real rule.
CREATE OR REPLACE FUNCTION promo_pass_json(p_pass_id uuid, p_include_token boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p   "CustomerPromotionPasses"%ROWTYPE;
    c   "PromotionCampaigns"%ROWTYPE;
    cu  record;
    v_used int;
    v_last timestamptz;
    v_eff  text;
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p.campaign_id;
    SELECT "fullName" AS name, phone, email INTO cu FROM "Customers" WHERE id = p.customer_id;
    SELECT count(*), max(applied_at) INTO v_used, v_last
      FROM "PromotionUsages" WHERE promotion_pass_id = p.id AND status <> 'CANCELLED';
    v_eff := promo_pass_effective_status(p, c.status);

    RETURN jsonb_build_object(
        'id', p.id,
        'voucherCode', p.voucher_code,
        'qrToken', CASE WHEN p_include_token THEN p.qr_token END,
        'status', p.status,
        'effectiveStatus', v_eff,
        'statusReason', p.status_reason,
        'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'campaignCode', c.campaign_code, 'status', c.status),
        'customer', jsonb_build_object('id', p.customer_id, 'name', cu.name, 'phone', cu.phone, 'email', cu.email),
        'benefit', jsonb_build_object('type', p.benefit_type, 'value', p.benefit_value, 'serviceId', c.benefit_service_id),
        'usage', jsonb_build_object('type', p.usage_type, 'limit', p.usage_limit, 'usedCount', v_used,
                                    'maxPerOrder', c.max_usage_per_order, 'lastUsedAt', promo_iso(v_last)),
        'lastUsedAt', promo_iso(v_last),
        'validFrom', promo_iso(p.valid_from),
        'validUntil', promo_iso(p.valid_until),
        'issuedAt', promo_iso(p.issued_at),
        'issueSource', p.issue_source,
        'issuedBy', p.issued_by,
        'sourceBookingId', p.source_booking_id,
        'emailStatus', p.email_status,
        'emailTo', p.email_to,
        'emailLang', p.email_lang,
        'emailSentAt', promo_iso(p.email_sent_at),
        'emailLastError', p.email_last_error,
        'reminderStatus', p.reminder_status,
        'reminderSentAt', promo_iso(p.reminder_sent_at),
        'supersededAt', promo_iso(p.superseded_at),
        'supersededBy', p.superseded_by,
        'endedAt', promo_iso(promo_pass_ended_at(p, v_eff)),
        -- What the card must say ("Menu VIP · từ 90 phút"): same config the apply check uses.
        'conditionsSummary', promo_conditions_summary(c.apply_conditions)
    );
END;
$$;

-- Email claim carries the conditions so the e-voucher states them.
CREATE OR REPLACE FUNCTION promo_claim_pass_email(p_pass_id uuid, p_kind text DEFAULT 'ISSUE', p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p "CustomerPromotionPasses"%ROWTYPE;
    c "PromotionCampaigns"%ROWTYPE;
    v_eff text;
    v_to text;
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p.campaign_id;
    v_eff := promo_pass_effective_status(p, c.status);
    IF v_eff NOT IN ('ACTIVE', 'NOT_STARTED') THEN
        RETURN promo_err('PROMOTION_' || v_eff, 'Voucher không còn hiệu lực, không gửi email');
    END IF;
    IF NOT promo_setting_bool('promotion_email_enabled', true) THEN
        RETURN promo_ok(jsonb_build_object('skipped', true, 'reason', 'EMAIL_DISABLED'));
    END IF;

    -- Always the CURRENT, REAL email on the customer profile.
    SELECT promo_real_email(email) INTO v_to FROM "Customers" WHERE id = p.customer_id;
    IF v_to IS NULL THEN
        IF upper(p_kind) = 'ISSUE' THEN
            UPDATE "CustomerPromotionPasses" SET email_status = 'SKIPPED', email_to = NULL, updated_at = now() WHERE id = p.id;
        END IF;
        RETURN promo_err('CUSTOMER_NO_EMAIL', 'Hồ sơ khách chưa có email');
    END IF;

    IF upper(p_kind) = 'ISSUE' THEN
        IF NOT p_force AND (p.email_status = 'SENT'
                            OR (p.email_status = 'SENDING' AND p.email_claimed_at > now() - interval '15 minutes')) THEN
            RETURN promo_ok(jsonb_build_object('skipped', true, 'reason', 'ALREADY_' || p.email_status));
        END IF;
        UPDATE "CustomerPromotionPasses"
           SET email_status = 'SENDING', email_claimed_at = now(), email_to = v_to,
               email_lang = promo_customer_language(p.customer_id),
               email_attempts = CASE WHEN p_force THEN 0 ELSE email_attempts END, updated_at = now()
         WHERE id = p.id;
    ELSIF upper(p_kind) = 'REMINDER' THEN
        IF p.reminder_status IN ('SENT') AND NOT p_force THEN
            RETURN promo_ok(jsonb_build_object('skipped', true, 'reason', 'ALREADY_SENT'));
        END IF;
        UPDATE "CustomerPromotionPasses"
           SET reminder_status = 'SENDING', reminder_claimed_at = now(), email_to = v_to,
               email_lang = promo_customer_language(p.customer_id), updated_at = now()
         WHERE id = p.id;
    ELSE
        RETURN promo_err('INVALID_ACTION', 'kind phải là ISSUE hoặc REMINDER');
    END IF;

    RETURN promo_ok(jsonb_build_object(
        'passId', p.id, 'kind', upper(p_kind), 'to', v_to, 'lang', promo_customer_language(p.customer_id),
        'pass', promo_pass_json(p.id, true),
        'campaignDescription', c.description,
        'conditionsSummary', promo_conditions_summary(c.apply_conditions)));
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Grants — service_role only
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    f record;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'promo\_%'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END LOOP;
END;
$$;
