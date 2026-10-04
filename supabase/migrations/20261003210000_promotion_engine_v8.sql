-- =============================================================================
-- Promotion Engine v8 — counter may apply a voucher to an order that misses the
-- apply conditions, after confirming, with a MANDATORY reason (user 03/10/2026).
-- Plan: plans/plan_promotion_override_apply.md §7.
--
--   * Only ORDER_CONDITION_NOT_MET can be overridden. Expired / suspended / cancelled /
--     used up / already applied / order not open stay hard blocks.
--   * promo_apply_pass(..., p_override_conditions, p_override_note): reason 3–500 chars,
--     else OVERRIDE_REASON_REQUIRED. Usage records conditions_overridden, the reasons at
--     that moment and the note; staff_id is the acting receptionist.
--   * Candidates: eligibility ELIGIBLE / NOT_ELIGIBLE / BLOCKED, canOverride, unmetReasons.
--   * % discount on an override with no matching service = whole paid order.
-- =============================================================================

ALTER TABLE "PromotionUsages"
    ADD COLUMN IF NOT EXISTS conditions_overridden boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS override_reasons jsonb,
    ADD COLUMN IF NOT EXISTS override_note text;
CREATE INDEX IF NOT EXISTS idx_promo_usage_overridden ON "PromotionUsages"(applied_at) WHERE conditions_overridden;

DROP FUNCTION IF EXISTS promo_apply_pass(uuid, text, text);
DROP FUNCTION IF EXISTS promo_list_usages(date, date, uuid, text, text, uuid, int);

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
        WHEN 'OVERRIDE_REASON_REQUIRED' THEN 'Đơn chưa đủ điều kiện — cần nhập lý do để áp ngoại lệ'
        WHEN 'ORDER_MENU_NOT_ELIGIBLE' THEN 'Đơn không có dịch vụ thuộc menu được áp dụng của voucher'
        ELSE p_code
    END;
$$;

CREATE OR REPLACE FUNCTION promo_categories_cover_menus(p_menus jsonb, p_categories jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_array_length(COALESCE(p_menus, '[]'::jsonb)) > 0
       AND jsonb_array_length(COALESCE(p_categories, '[]'::jsonb)) > 0
       AND NOT EXISTS (
           SELECT 1 FROM "Services" s
            WHERE COALESCE(s."isActive", true) AND NOT COALESCE(s.is_promotion, false) AND NOT COALESCE(s.is_utility, false)
              AND promo_service_menu(s.id) IN (SELECT upper(x) FROM jsonb_array_elements_text(p_menus) x)
              AND NOT (promo_service_categories(s.category) && ARRAY(SELECT upper(x) FROM jsonb_array_elements_text(p_categories) x)));
$$;

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
            -- Categories that cover every active service of the chosen menus add nothing
            -- (NHP + VIP_MENU → "Menu VIP"), same rule as promo_scope_labels.
            'categories', CASE WHEN promo_categories_cover_menus(c->'menus', c->'categories') THEN '[]'::jsonb
                               ELSE COALESCE((SELECT jsonb_agg(promo_category_label(x)) FROM jsonb_array_elements_text(c->'categories') x), '[]'::jsonb) END,
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

-- Human (Vietnamese) reasons why the order misses the conditions — shown in the counter's
-- note and confirmation popup, and stored on the usage when overridden.
CREATE OR REPLACE FUNCTION promo_vnd(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT replace(to_char(COALESCE(p, 0), 'FM999,999,999,990'), ',', '.') || 'đ';
$$;

CREATE OR REPLACE FUNCTION promo_unmet_reasons(p_booking_id text, p_conditions jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_eval jsonb := promo_evaluate_conditions(p_booking_id, p_conditions);
    v_sum jsonb := promo_conditions_summary(p_conditions);
    v_match text := upper(COALESCE(p_conditions->>'match', 'ALL'));
    v_out text[] := ARRAY[]::text[];
    r jsonb;
    s jsonb;
    c jsonb;
    i int := 0;
    v_desc text[];
    v_scope_hit boolean;
    v_best int;
    v_detail text[];
BEGIN
    IF (v_eval->>'met')::boolean THEN RETURN '[]'::jsonb; END IF;
    FOR r IN SELECT * FROM jsonb_array_elements(v_eval->'results') LOOP
        c := p_conditions->'conditions'->i;
        s := v_sum->'conditions'->i;
        i := i + 1;
        IF (r->>'met')::boolean THEN CONTINUE; END IF;
        v_desc := ARRAY[]::text[];
        IF jsonb_array_length(s->'menus') > 0 THEN v_desc := v_desc || (SELECT string_agg(x, ' / ') FROM jsonb_array_elements_text(s->'menus') x); END IF;
        IF jsonb_array_length(s->'categories') > 0 THEN v_desc := v_desc || (SELECT string_agg(x, ' / ') FROM jsonb_array_elements_text(s->'categories') x); END IF;
        IF jsonb_array_length(s->'services') > 1 THEN
            v_desc := v_desc || ('một trong: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(s->'services') x));
        ELSIF jsonb_array_length(s->'services') = 1 THEN
            v_desc := v_desc || (s->'services'->>0);
        END IF;
        IF NULLIF(c->>'minMinutes', '') IS NOT NULL THEN v_desc := v_desc || ('từ ' || (c->>'minMinutes') || ' phút'); END IF;
        IF NULLIF(c->>'minOrderAmount', '') IS NOT NULL THEN v_desc := v_desc || ('tổng đơn từ ' || promo_vnd((c->>'minOrderAmount')::numeric)); END IF;

        SELECT count(*) > 0, max(unit_minutes) INTO v_scope_hit, v_best
          FROM promo_initial_items(p_booking_id) it
         WHERE promo_item_meets(it.service_id, it.category, NULL, c - 'minMinutes');
        v_detail := ARRAY[]::text[];
        IF (jsonb_array_length(c->'menus') > 0 OR jsonb_array_length(c->'categories') > 0 OR jsonb_array_length(c->'serviceIds') > 0)
           AND NOT v_scope_hit THEN
            v_detail := v_detail || 'đơn không có dịch vụ nào phù hợp'::text;
        ELSIF NULLIF(c->>'minMinutes', '') IS NOT NULL AND COALESCE(v_best, 0) < (c->>'minMinutes')::int THEN
            v_detail := v_detail || ('dịch vụ phù hợp dài nhất của đơn là ' || COALESCE(v_best, 0) || ' phút');
        END IF;
        IF NOT COALESCE((r->>'amountMet')::boolean, true) THEN
            v_detail := v_detail || ('đơn hiện ' || promo_vnd((v_eval->>'orderAmount')::numeric));
        END IF;
        v_out := v_out || ('Cần ' || array_to_string(v_desc, ' · ')
                           || CASE WHEN cardinality(v_detail) > 0 THEN ' — ' || array_to_string(v_detail, ', ') ELSE '' END);
    END LOOP;
    IF v_match = 'ANY' AND cardinality(v_out) > 1 THEN
        v_out := ARRAY['Cần đạt một trong các điều kiện sau:'] || v_out;
    END IF;
    RETURN to_jsonb(v_out);
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
    -- Whole order when configured, or on an override where no service met the conditions.
    IF c.benefit_config->>'discountScope' = 'ORDER' OR (p_override_conditions AND COALESCE(v_base, 0) = 0) THEN
        v_base := (promo_order_minutes(p_booking_id, '{}'::jsonb)->>'paidAmount')::numeric;
    END IF;
    v_disc := CASE WHEN p.benefit_type = 'PERCENT_DISCOUNT' THEN round(v_base * p.benefit_value / 100) ELSE p.benefit_value END;
    v_cap := NULLIF(c.benefit_config->>'maxDiscountAmount', '')::numeric;
    IF v_cap IS NOT NULL THEN v_disc := LEAST(v_disc, v_cap); END IF;
    RETURN GREATEST(0, LEAST(v_disc, GREATEST(COALESCE(v_total, 0), 0)));
END;
$$;

CREATE OR REPLACE FUNCTION promo_compute_discount(p_pass_id uuid, p_booking_id text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT promo_compute_discount_ex(p_pass_id, p_booking_id, false);
$$;

CREATE OR REPLACE FUNCTION promo_check_apply_ex(p_pass_id uuid, p_booking_id text, p_override_conditions boolean)
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
    -- The ONLY check the counter may override (user 03/10/2026, with a mandatory reason).
    IF NOT (promo_evaluate_conditions(p_booking_id, c.apply_conditions)->>'met')::boolean THEN
        IF NOT p_override_conditions THEN RETURN 'ORDER_CONDITION_NOT_MET'; END IF;
    END IF;
    IF p.benefit_type IN ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT') AND promo_compute_discount_ex(p.id, p_booking_id, p_override_conditions) <= 0 THEN
        RETURN 'ORDER_NOT_ELIGIBLE';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION promo_check_apply(p_pass_id uuid, p_booking_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT promo_check_apply_ex(p_pass_id, p_booking_id, false);
$$;

CREATE OR REPLACE FUNCTION promo_apply_pass(p_pass_id uuid, p_booking_id text, p_staff_id text,
                                            p_override_conditions boolean DEFAULT false, p_override_note text DEFAULT NULL)
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
    v_unmet     jsonb;
    v_overrode  boolean := false;
    v_note      text := NULLIF(trim(COALESCE(p_override_note, '')), '');
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    SELECT id, status::text AS status, "customerId" AS customer_id INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;

    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p.campaign_id;
    v_eval := promo_evaluate_conditions(p_booking_id, c.apply_conditions);
    v_overrode := NOT (v_eval->>'met')::boolean;   -- conditions missed (override needed)

    -- 1) Hard blocks first (expired, used up, already applied, order closed...): never overridable.
    v_code := promo_check_apply_ex(p_pass_id, p_booking_id, true);
    IF v_code IS NOT NULL THEN RETURN promo_err(v_code, promo_error_message(v_code)); END IF;
    -- 2) Conditions missed and no override → tell the counter why, so it can confirm.
    IF v_overrode AND NOT COALESCE(p_override_conditions, false) THEN
        RETURN promo_err('ORDER_CONDITION_NOT_MET', promo_error_message('ORDER_CONDITION_NOT_MET'),
            jsonb_build_object('data', jsonb_build_object('unmetReasons', promo_unmet_reasons(p_booking_id, c.apply_conditions), 'canOverride', true)));
    END IF;
    -- 3) Override needs a reason.
    IF v_overrode AND (v_note IS NULL OR length(v_note) < 3 OR length(v_note) > 500) THEN
        RETURN promo_err('OVERRIDE_REASON_REQUIRED', promo_error_message('OVERRIDE_REASON_REQUIRED'),
                         jsonb_build_object('data', jsonb_build_object('unmetReasons', promo_unmet_reasons(p_booking_id, c.apply_conditions))));
    END IF;
    IF v_overrode THEN v_unmet := promo_unmet_reasons(p_booking_id, c.apply_conditions); END IF;

    SELECT * INTO v_svc FROM "Services" WHERE id = c.benefit_service_id;

    -- The benefit joins the guest / room of the service that met the conditions.
    SELECT it.guest_id, it.room_name, it.bed_id INTO v_guest, v_room, v_bed
      FROM promo_initial_items(p_booking_id) it
     ORDER BY (it.item_id IN (SELECT jsonb_array_elements_text(v_eval->'matchedItemIds'))) DESC,
              (it.item_status = 'IN_PROGRESS') DESC, it.item_id
     LIMIT 1;

    IF p.benefit_type = 'FREE_MINUTES' THEN
        v_minutes := p.benefit_value::int;
    ELSE
        v_discount := promo_compute_discount_ex(p.id, p_booking_id, v_overrode);
    END IF;

    v_item_id := p_booking_id || '-promo-' || replace(v_usage_id::text, '-', '');

    BEGIN
        INSERT INTO "PromotionUsages" (id, promotion_pass_id, campaign_id, customer_id, pass_owner_id, booking_id,
                                       booking_item_id, benefit_type, benefit_value, applied_minutes, discount_amount,
                                       staff_id, status, conditions_overridden, override_reasons, override_note)
        VALUES (v_usage_id, p.id, c.id, b.customer_id, p.customer_id, p_booking_id,
                v_item_id, p.benefit_type, p.benefit_value, v_minutes, v_discount, p_staff_id, 'APPLIED',
                v_overrode, v_unmet, CASE WHEN v_overrode THEN v_note END);
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
                               'discountAmount', v_discount, 'conditionsOverridden', v_overrode),
            v_guest);

    UPDATE "Bookings" SET "totalAmount" = GREATEST(0, COALESCE("totalAmount", 0) - v_discount), "updatedAt" = v_now_utc
     WHERE id = p_booking_id;

    RETURN promo_ok(jsonb_build_object(
        'usageId', v_usage_id,
        'bookingItemId', v_item_id,
        'appliedMinutes', v_minutes,
        'discountAmount', v_discount,
        'conditionsOverridden', v_overrode,
        'overrideReasons', v_unmet,
        'benefit', jsonb_build_object('type', p.benefit_type, 'value', p.benefit_value, 'serviceId', v_svc.id),
        'booking', promo_booking_json(p_booking_id),
        'pass', promo_pass_json(p.id, false)));
END;
$$;

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
                   -- ELIGIBLE / NOT_ELIGIBLE (conditions only → counter may override with a reason) / BLOCKED
                   'eligibility', CASE WHEN chk IS NULL THEN 'ELIGIBLE' WHEN chk = 'ORDER_CONDITION_NOT_MET' THEN 'NOT_ELIGIBLE' ELSE 'BLOCKED' END,
                   'canOverride', chk = 'ORDER_CONDITION_NOT_MET' AND promo_check_apply_ex(p_pass_id, b.id, true) IS NULL,
                   'unmetReasons', CASE WHEN chk = 'ORDER_CONDITION_NOT_MET' THEN promo_unmet_reasons(b.id, v_conds) ELSE '[]'::jsonb END,
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

CREATE OR REPLACE FUNCTION promo_usage_json(p_usage_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id', u.id, 'appliedAt', promo_iso(u.applied_at), 'status', u.status,
        'benefit', jsonb_build_object('type', u.benefit_type, 'value', u.benefit_value),
        'appliedMinutes', u.applied_minutes, 'discountAmount', u.discount_amount,
        'passId', u.promotion_pass_id, 'voucherCode', p.voucher_code,
        'campaignId', u.campaign_id, 'campaignName', c.name,
        'customer', jsonb_build_object('id', u.customer_id,
                                       'name', COALESCE(oc."fullName", b."customerName"),
                                       'phone', COALESCE(oc.phone, b."customerPhone"),
                                       'email', COALESCE(oc.email, b."customerEmail")),
        'passOwner', jsonb_build_object('id', u.pass_owner_id, 'name', po."fullName"),
        'booking', jsonb_build_object('id', u.booking_id, 'billCode', b."billCode"),
        'staffId', u.staff_id, 'staffName', promo_staff_name(u.staff_id),
        'completedAt', promo_iso(u.completed_at), 'cancelledAt', promo_iso(u.cancelled_at),
        'cancelReason', u.cancel_reason,
        'conditionsOverridden', u.conditions_overridden,
        'overrideReasons', COALESCE(u.override_reasons, '[]'::jsonb),
        'overrideNote', u.override_note)
    FROM "PromotionUsages" u
    JOIN "CustomerPromotionPasses" p ON p.id = u.promotion_pass_id
    JOIN "PromotionCampaigns" c ON c.id = u.campaign_id
    LEFT JOIN "Bookings" b ON b.id = u.booking_id
    LEFT JOIN "Customers" oc ON oc.id = u.customer_id
    LEFT JOIN "Customers" po ON po.id = u.pass_owner_id
    WHERE u.id = p_usage_id;
$$;

CREATE OR REPLACE FUNCTION promo_list_usages(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_campaign_id uuid DEFAULT NULL,
                                             p_status text DEFAULT NULL, p_q text DEFAULT NULL, p_pass_id uuid DEFAULT NULL,
                                             p_limit int DEFAULT 500, p_overridden boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q text := NULLIF(trim(COALESCE(p_q, '')), '');
    v_rows jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(promo_usage_json(id) ORDER BY applied_at DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT u.id, u.applied_at
        FROM "PromotionUsages" u
        JOIN "CustomerPromotionPasses" p ON p.id = u.promotion_pass_id
        LEFT JOIN "Bookings" b ON b.id = u.booking_id
        LEFT JOIN "Customers" oc ON oc.id = u.customer_id
        WHERE (p_from IS NULL OR u.applied_at >= (p_from::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
          AND (p_to IS NULL OR u.applied_at < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
          AND (p_campaign_id IS NULL OR u.campaign_id = p_campaign_id)
          AND (p_status IS NULL OR u.status = p_status)
          AND (p_pass_id IS NULL OR u.promotion_pass_id = p_pass_id)
          AND (p_overridden IS NULL OR u.conditions_overridden = p_overridden)
          AND (v_q IS NULL OR p.voucher_code ILIKE '%' || v_q || '%' OR b."billCode" ILIKE '%' || v_q || '%'
               OR COALESCE(oc."fullName", b."customerName") ILIKE '%' || v_q || '%'
               OR COALESCE(oc.phone, b."customerPhone") ILIKE '%' || v_q || '%')
        ORDER BY u.applied_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000)
    ) t;
    RETURN promo_ok(v_rows);
END;
$$;

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
