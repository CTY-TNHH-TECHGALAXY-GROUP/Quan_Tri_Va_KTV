-- =============================================================================
-- Promotion Engine v3 — dynamic menu / category scope + public e-voucher view.
-- Plan: plans/plan_promotion_engine_backend.md (v5).
--
--   * Menu scope (PromotionCampaigns.qualification_config = { serviceIdPrefixes,
--     serviceCategories, serviceIds }) is chosen by the admin from the LIVE
--     Services catalogue (promo_menu_catalog). One scope drives:
--       - qualifying minutes / amount for issuing,
--       - which orders a voucher can be applied to (ORDER_MENU_NOT_ELIGIBLE),
--       - the base of a percentage discount.
--     Empty scope = every menu.
--   * Menu = service id prefix (letters before the first digit / "_"), e.g.
--     NHP, NHS, NHT. Display labels live in SystemConfigs.promotion_menu_labels,
--     unknown prefixes show the prefix itself — nothing is hard-coded here.
--   * Categories are normalised: '["Body"]', 'Body' and 'BODY' are one category.
--   * promo_public_voucher_by_token: data for the public /voucher?t= page.
-- =============================================================================

INSERT INTO "SystemConfigs"(key, value, description) VALUES
    ('promotion_menu_labels', '{"NHP":"Menu VIP","NHS":"Menu Standard","NHT":"Menu Deep Body"}'::jsonb,
     'Promotion Engine: tên hiển thị của menu theo prefix mã dịch vụ. Prefix chưa khai báo hiện đúng prefix.')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 1. Normalisation helpers
-- -----------------------------------------------------------------------------
-- Menu code of a service id: leading letters (NHP0003 → NHP, VIP_1K_90 → VIP).
CREATE OR REPLACE FUNCTION promo_service_menu(p_service_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT NULLIF(upper(substring(COALESCE(p_service_id, '') FROM '^[A-Za-z]+')), '');
$$;

-- Category values of a service, upper-cased: handles '["Body"]', 'Body', 'BODY', '["A","B"]'.
CREATE OR REPLACE FUNCTION promo_service_categories(p_category text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v jsonb;
BEGIN
    IF p_category IS NULL OR trim(p_category) = '' THEN RETURN ARRAY[]::text[]; END IF;
    IF left(trim(p_category), 1) = '[' THEN
        BEGIN
            v := trim(p_category)::jsonb;
            IF jsonb_typeof(v) = 'array' THEN
                RETURN ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(v) x WHERE trim(x) <> '');
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
    RETURN ARRAY[upper(trim(p_category))];
END;
$$;

CREATE OR REPLACE FUNCTION promo_scope_is_empty(p_config jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_array_length(NULLIF(p_config->'serviceIds', 'null'::jsonb)), 0) = 0
       AND COALESCE(jsonb_array_length(NULLIF(p_config->'serviceIdPrefixes', 'null'::jsonb)), 0) = 0
       AND COALESCE(jsonb_array_length(NULLIF(p_config->'serviceCategories', 'null'::jsonb)), 0) = 0;
$$;

-- Is a service inside the campaign scope? Empty scope = yes.
-- Within the scope: serviceIds OR (menu prefix AND (no category filter OR category)).
-- Categories without prefixes match in every menu.
CREATE OR REPLACE FUNCTION promo_service_in_scope(p_service_id text, p_category text, p_config jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_cfg jsonb := COALESCE(p_config, '{}'::jsonb);
    v_ids text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(v_cfg->'serviceIds', 'null'::jsonb), '[]'::jsonb)));
    v_pre text[] := ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(COALESCE(NULLIF(v_cfg->'serviceIdPrefixes', 'null'::jsonb), '[]'::jsonb)) x);
    v_cat text[] := ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(COALESCE(NULLIF(v_cfg->'serviceCategories', 'null'::jsonb), '[]'::jsonb)) x);
    v_menu_ok boolean;
    v_cat_ok boolean;
BEGIN
    IF promo_scope_is_empty(v_cfg) THEN RETURN true; END IF;
    IF p_service_id = ANY (v_ids) THEN RETURN true; END IF;
    IF cardinality(v_pre) = 0 AND cardinality(v_cat) = 0 THEN RETURN false; END IF;   -- only serviceIds given
    v_menu_ok := cardinality(v_pre) = 0
        OR EXISTS (SELECT 1 FROM unnest(v_pre) p WHERE upper(COALESCE(p_service_id, '')) LIKE p || '%');
    v_cat_ok := cardinality(v_cat) = 0 OR promo_service_categories(p_category) && v_cat;
    RETURN v_menu_ok AND v_cat_ok;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Order minutes (same contract as v1, scope via promo_service_in_scope)
-- -----------------------------------------------------------------------------
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
        IF r.is_utility OR r.service_id = 'NHS0900' THEN CONTINUE; END IF;
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

-- -----------------------------------------------------------------------------
-- 3. Apply: menu scope check + discount base
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
        WHEN 'ORDER_NOT_ELIGIBLE' THEN 'Đơn chưa có dịch vụ hoặc giá trị để áp dụng khuyến mãi'
        WHEN 'ORDER_MENU_NOT_ELIGIBLE' THEN 'Đơn không có dịch vụ thuộc menu được áp dụng của voucher'
        ELSE p_code
    END;
$$;

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
    -- Base = services inside the menu scope (whole paid order when the scope is empty,
    -- or when benefit_config.discountScope = 'ORDER').
    v_base := CASE WHEN c.benefit_config->>'discountScope' = 'ORDER'
                   THEN (promo_order_minutes(p_booking_id, '{}'::jsonb)->>'paidAmount')::numeric
                   ELSE (promo_order_minutes(p_booking_id, c.qualification_config)->>'qualifyingAmount')::numeric END;
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
    IF p.status = 'EXPIRED' OR c.status = 'ENDED' OR now() > p.valid_until OR now() > c.valid_until THEN
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

    IF NOT EXISTS (
        SELECT 1 FROM "BookingItems" bi LEFT JOIN "Services" s ON s.id = bi."serviceId"
         WHERE bi."bookingId" = p_booking_id AND COALESCE(bi.status, '') <> 'CANCELLED'
           AND NOT COALESCE(s.is_utility, false) AND NOT COALESCE(s.is_promotion, false)
           AND COALESCE(bi."serviceId", '') <> 'NHS0900') THEN
        RETURN 'ORDER_NOT_ELIGIBLE';
    END IF;
    IF NOT promo_scope_is_empty(c.qualification_config) AND NOT EXISTS (
        SELECT 1 FROM "BookingItems" bi LEFT JOIN "Services" s ON s.id = bi."serviceId"
         WHERE bi."bookingId" = p_booking_id AND COALESCE(bi.status, '') <> 'CANCELLED'
           AND NOT COALESCE(s.is_utility, false) AND NOT COALESCE(s.is_promotion, false)
           AND promo_service_in_scope(bi."serviceId", s.category, c.qualification_config)) THEN
        RETURN 'ORDER_MENU_NOT_ELIGIBLE';
    END IF;
    IF p.benefit_type IN ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT') AND promo_compute_discount(p.id, p_booking_id) <= 0 THEN
        RETURN 'ORDER_NOT_ELIGIBLE';
    END IF;
    RETURN NULL;
END;
$$;

-- Same as v2, but the free-minutes item joins the guest / room of an IN-SCOPE service first.
CREATE OR REPLACE FUNCTION promo_apply_pass(p_pass_id uuid, p_booking_id text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p           "CustomerPromotionPasses"%ROWTYPE;
    c           "PromotionCampaigns"%ROWTYPE;
    b           record;
    v_svc       record;
    v_code      text;
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

    SELECT bi.guest_id, bi."roomName", bi."bedId" INTO v_guest, v_room, v_bed
      FROM "BookingItems" bi LEFT JOIN "Services" s ON s.id = bi."serviceId"
     WHERE bi."bookingId" = p_booking_id AND COALESCE(bi.status, '') <> 'CANCELLED'
       AND NOT COALESCE(s.is_utility, false) AND NOT COALESCE(s.is_promotion, false)
       AND COALESCE(bi."serviceId", '') <> 'NHS0900'
     ORDER BY promo_service_in_scope(bi."serviceId", s.category, c.qualification_config) DESC,
              (bi.status = 'IN_PROGRESS') DESC, bi.id
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

-- -----------------------------------------------------------------------------
-- 4. Menu catalogue (live Services) + campaign JSON exposes the scope
-- -----------------------------------------------------------------------------
-- [{ code, label, serviceCount, categories: [{ code, label, serviceCount }], services: [{ id, name, category, categoryCodes }] }]
CREATE OR REPLACE FUNCTION promo_menu_catalog()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_labels jsonb;
    v_out jsonb;
BEGIN
    SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value
                WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb END
      INTO v_labels FROM "SystemConfigs" WHERE key = 'promotion_menu_labels';
    v_labels := COALESCE(v_labels, '{}'::jsonb);

    WITH svc AS (
        SELECT s.id, COALESCE(NULLIF(s."nameVN", ''), s."nameEN", s.id) AS name, s.category,
               promo_service_menu(s.id) AS menu, promo_service_categories(s.category) AS cats
          FROM "Services" s
         WHERE COALESCE(s."isActive", true) AND NOT COALESCE(s.is_promotion, false) AND NOT COALESCE(s.is_utility, false)
           AND promo_service_menu(s.id) IS NOT NULL
    ), cat AS (
        SELECT menu, c AS code, count(*) AS n, initcap(lower(c)) AS label
          FROM svc, unnest(svc.cats) c
         GROUP BY menu, c
    )
    SELECT COALESCE(jsonb_agg(m ORDER BY m->>'code'), '[]'::jsonb) INTO v_out
      FROM (
        SELECT jsonb_build_object(
                   'code', svc.menu,
                   'label', COALESCE(v_labels->>svc.menu, svc.menu),
                   'serviceCount', count(*),
                   'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', cat.code, 'label', COALESCE(cat.label, cat.code),
                                                                               'serviceCount', cat.n) ORDER BY cat.code)
                                             FROM cat WHERE cat.menu = svc.menu), '[]'::jsonb),
                   'services', jsonb_agg(jsonb_build_object('id', svc.id, 'name', svc.name, 'category', svc.category,
                                                            'categoryCodes', to_jsonb(svc.cats)) ORDER BY svc.id)) AS m
          FROM svc GROUP BY svc.menu
      ) t;
    RETURN promo_ok(v_out);
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
        'applicableMenus', jsonb_build_object(
            'menus', COALESCE(c.qualification_config->'serviceIdPrefixes', '[]'::jsonb),
            'categories', COALESCE(c.qualification_config->'serviceCategories', '[]'::jsonb),
            'serviceIds', COALESCE(c.qualification_config->'serviceIds', '[]'::jsonb),
            'allMenus', promo_scope_is_empty(c.qualification_config)),
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

-- -----------------------------------------------------------------------------
-- 5. Public e-voucher view (/voucher?t=) — whoever holds the QR may see the card.
--    Card data only: no phone, email, staff, orders.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_public_voucher_by_token(p_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id uuid;
    j jsonb;
    v_menus jsonb;
BEGIN
    IF NULLIF(trim(COALESCE(p_qr_token, '')), '') IS NULL OR length(p_qr_token) > 200 THEN
        RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND'));
    END IF;
    SELECT id INTO v_id FROM "CustomerPromotionPasses" WHERE qr_token = trim(p_qr_token);
    IF v_id IS NULL THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    j := promo_pass_json(v_id, true);
    SELECT promo_campaign_json(c.id)->'applicableMenus' INTO v_menus
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
        'qrToken', CASE WHEN j->>'effectiveStatus' IN ('ACTIVE', 'NOT_STARTED') THEN j->'qrToken' END));
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Grants — service_role only
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
