-- =============================================================================
-- Promotion Engine v5 — USED_UP status, ACTIVE / PAST tracking, re-issue after a
-- pass is closed, per-profile voucher history.
-- Plan: plans/plan_promotion_v5_followups.md (user decisions 03/10/2026).
--
--   * effectiveStatus USED_UP: ONE_TIME / LIMITED pass whose live uses reached the limit.
--     Recomputed live, so cancelling a use brings the pass back to ACTIVE.
--   * Re-issue: one usable pass per customer per campaign. Passes that are CANCELLED,
--     EXPIRED or USED_UP no longer block a new pass; EXPIRED / USED_UP ones get
--     superseded_at / superseded_by and are treated as closed for good.
--   * promo_search_passes(..., p_group ACTIVE|PAST), overview.pastPasses, pass.endedAt.
--   * Candidates: alreadyHasPass = holds a USABLE pass; passHistory of every voucher
--     the profile ever had; blocked customers sorted last.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema
-- -----------------------------------------------------------------------------
ALTER TABLE "CustomerPromotionPasses"
    ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
    ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES "CustomerPromotionPasses"(id);

-- One OPEN pass per customer per campaign (cancelled / superseded passes are history).
DROP INDEX IF EXISTS uq_promo_pass_customer_campaign;
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_pass_customer_campaign_open
    ON "CustomerPromotionPasses"(customer_id, campaign_id)
    WHERE one_pass_per_customer AND status <> 'CANCELLED' AND superseded_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Effective status (one place) + end time
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_pass_effective_status(p_pass "CustomerPromotionPasses", p_campaign_status text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_used int;
BEGIN
    IF p_pass.status IN ('CANCELLED', 'SUSPENDED') THEN RETURN p_pass.status; END IF;
    IF p_pass.usage_type IN ('ONE_TIME', 'LIMITED') THEN
        SELECT count(*) INTO v_used FROM "PromotionUsages"
         WHERE promotion_pass_id = p_pass.id AND status <> 'CANCELLED';
        IF v_used >= COALESCE(p_pass.usage_limit, 1) THEN RETURN 'USED_UP'; END IF;
    END IF;
    IF p_pass.status = 'EXPIRED' OR p_pass.superseded_at IS NOT NULL
       OR p_campaign_status = 'ENDED' OR now() > p_pass.valid_until THEN
        RETURN 'EXPIRED';
    END IF;
    IF p_campaign_status <> 'ACTIVE' THEN RETURN 'INACTIVE'; END IF;
    IF now() < p_pass.valid_from THEN RETURN 'NOT_STARTED'; END IF;
    RETURN 'ACTIVE';
END;
$$;

-- When a closed pass ended: cancel time, last use (USED_UP), or validity end.
CREATE OR REPLACE FUNCTION promo_pass_ended_at(p_pass "CustomerPromotionPasses", p_eff text)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE p_eff
        WHEN 'CANCELLED' THEN p_pass.updated_at
        WHEN 'USED_UP' THEN (SELECT max(applied_at) FROM "PromotionUsages"
                              WHERE promotion_pass_id = p_pass.id AND status <> 'CANCELLED')
        WHEN 'EXPIRED' THEN LEAST(p_pass.valid_until, COALESCE(p_pass.superseded_at, p_pass.valid_until))
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION promo_customer_holds_usable_pass(p_customer_id text, p_campaign_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id
         WHERE p.customer_id = p_customer_id AND p.campaign_id = p_campaign_id
           AND promo_pass_effective_status(p, c.status) IN ('ACTIVE', 'NOT_STARTED', 'SUSPENDED', 'INACTIVE'));
$$;

-- Every voucher the profile ever had (all campaigns), newest first.
CREATE OR REPLACE FUNCTION promo_customer_pass_history(p_customer_id text, p_limit int DEFAULT 10)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(jsonb_agg(h ORDER BY issued DESC), '[]'::jsonb) FROM (
        SELECT p.issued_at AS issued, jsonb_build_object(
                   'passId', p.id, 'voucherCode', p.voucher_code,
                   'campaignId', c.id, 'campaignName', c.name,
                   'effectiveStatus', promo_pass_effective_status(p, c.status),
                   'issuedAt', promo_iso(p.issued_at)) AS h
          FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id
         WHERE p.customer_id = p_customer_id
         ORDER BY p.issued_at DESC
         LIMIT GREATEST(COALESCE(p_limit, 10), 1)) t;
$$;

-- 3. Messages
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
        WHEN 'PROMOTION_USED_UP' THEN 'Voucher đã dùng hết lượt'
        WHEN 'ORDER_MENU_NOT_ELIGIBLE' THEN 'Đơn không có dịch vụ thuộc menu được áp dụng của voucher'
        ELSE p_code
    END;
$$;

-- 4. Pass JSON
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
        'endedAt', promo_iso(promo_pass_ended_at(p, v_eff))
    );
END;
$$;

-- 5. Issuing (re-issue after close)
CREATE OR REPLACE FUNCTION promo_insert_pass(p_campaign_id uuid, p_customer_id text, p_source_booking_id text,
                                             p_issue_source text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c        "PromotionCampaigns"%ROWTYPE;
    w        record;
    v_email  text;
    v_id     uuid;
    v_exist  uuid;
    v_old    "CustomerPromotionPasses"%ROWTYPE;
    v_closed uuid[] := ARRAY[]::uuid[];
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    SELECT * INTO w FROM promo_pass_window(c.id, now());
    SELECT promo_real_email(email) INTO v_email FROM "Customers" WHERE id = p_customer_id;

    -- Re-issue rule (user 03/10/2026): a customer still HOLDING a usable pass of the campaign
    -- (ACTIVE / NOT_STARTED / SUSPENDED / INACTIVE) gets no second one. Closed passes
    -- (EXPIRED / USED_UP — CANCELLED is already outside the unique index) are marked
    -- superseded so a new pass can be issued; they stay in history.
    IF c.one_pass_per_customer THEN
        FOR v_old IN
            SELECT p.* FROM "CustomerPromotionPasses" p
             WHERE p.campaign_id = c.id AND p.customer_id = p_customer_id
               AND p.status <> 'CANCELLED' AND p.superseded_at IS NULL
             FOR UPDATE
        LOOP
            IF promo_pass_effective_status(v_old, c.status) IN ('EXPIRED', 'USED_UP') THEN
                UPDATE "CustomerPromotionPasses" SET superseded_at = now(), updated_at = now() WHERE id = v_old.id;
                v_closed := v_closed || v_old.id;
            END IF;
        END LOOP;
    END IF;

    FOR attempt IN 1 .. 6 LOOP
        INSERT INTO "CustomerPromotionPasses" (
            campaign_id, customer_id, voucher_code, qr_token, status, benefit_type, benefit_value,
            usage_type, usage_limit, valid_from, valid_until, one_pass_per_customer,
            source_booking_id, issue_source, issued_by, email_status, email_to, email_lang)
        VALUES (
            c.id, p_customer_id, c.voucher_prefix || '-' || promo_random_code(6), promo_random_token(), 'ACTIVE',
            c.benefit_type, c.benefit_value,
            c.usage_type, CASE WHEN c.usage_type = 'ONE_TIME' THEN 1 ELSE c.usage_limit END,
            w.valid_from, w.valid_until, c.one_pass_per_customer,
            p_source_booking_id, p_issue_source, p_staff_id,
            CASE WHEN v_email IS NULL THEN 'SKIPPED' ELSE 'PENDING' END, v_email, promo_customer_language(p_customer_id))
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_id;

        IF v_id IS NOT NULL THEN
            IF cardinality(v_closed) > 0 THEN
                UPDATE "CustomerPromotionPasses" SET superseded_by = v_id WHERE id = ANY (v_closed);
            END IF;
            RETURN jsonb_build_object('created', true, 'passId', v_id, 'reissued', cardinality(v_closed) > 0
                                      OR EXISTS (SELECT 1 FROM "CustomerPromotionPasses" x WHERE x.campaign_id = c.id
                                                  AND x.customer_id = p_customer_id AND x.id <> v_id));
        END IF;

        SELECT id INTO v_exist FROM "CustomerPromotionPasses"
        WHERE campaign_id = c.id
          AND ((c.one_pass_per_customer AND customer_id = p_customer_id AND status <> 'CANCELLED' AND superseded_at IS NULL)
               OR (p_source_booking_id IS NOT NULL AND source_booking_id = p_source_booking_id))
        ORDER BY issued_at LIMIT 1;
        IF v_exist IS NOT NULL THEN
            RETURN jsonb_build_object('created', false, 'passId', v_exist);
        END IF;
    END LOOP;
    RAISE EXCEPTION 'promo_insert_pass: could not generate unique voucher code';
END;
$$;

CREATE OR REPLACE FUNCTION promo_issue_bulk(p_campaign_id uuid, p_customer_ids text[], p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    v_ids text[];
    v_id text;
    v_res jsonb;
    v_pass record;
    v_out jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình'); END IF;
    IF c.status = 'ENDED' OR c.valid_until <= now() THEN RETURN promo_err('PROMOTION_EXPIRED', 'Chương trình đã kết thúc'); END IF;
    IF c.status <> 'ACTIVE' THEN RETURN promo_err('PROMOTION_INACTIVE', 'Chương trình chưa kích hoạt'); END IF;

    SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_customer_ids) x WHERE NULLIF(trim(x), '') IS NOT NULL;
    IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
        RETURN promo_err('VALIDATION_ERROR', 'Chưa chọn khách', jsonb_build_object('data', jsonb_build_object('field', 'customerIds')));
    END IF;
    IF cardinality(v_ids) > 50 THEN
        RETURN promo_err('VALIDATION_ERROR', 'Tối đa 50 khách mỗi lần phát', jsonb_build_object('data', jsonb_build_object('field', 'customerIds')));
    END IF;

    FOREACH v_id IN ARRAY v_ids LOOP
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM "Customers" WHERE id = v_id) THEN
                v_out := v_out || jsonb_build_array(jsonb_build_object('customerId', v_id, 'status', 'FAILED', 'errorCode', 'CUSTOMER_NOT_FOUND'));
                CONTINUE;
            END IF;
            v_res := promo_insert_pass(c.id, v_id, NULL, 'MANUAL', p_staff_id);
            SELECT id, voucher_code, email_status INTO v_pass FROM "CustomerPromotionPasses" WHERE id = (v_res->>'passId')::uuid;
            v_out := v_out || jsonb_build_array(jsonb_build_object(
                'customerId', v_id,
                'status', CASE WHEN (v_res->>'created')::boolean THEN 'ISSUED' ELSE 'ALREADY_EXISTS' END,
                'passId', v_pass.id, 'voucherCode', v_pass.voucher_code, 'emailStatus', v_pass.email_status,
                'reissued', COALESCE((v_res->>'reissued')::boolean, false)));
        EXCEPTION WHEN OTHERS THEN
            v_out := v_out || jsonb_build_array(jsonb_build_object('customerId', v_id, 'status', 'FAILED', 'errorCode', 'INTERNAL_ERROR', 'message', left(SQLERRM, 200)));
        END;
    END LOOP;
    RETURN promo_ok(jsonb_build_object('results', v_out));
END;
$$;

-- 6. Apply guard
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

-- 7. Read models
CREATE OR REPLACE FUNCTION promo_overview()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT promo_ok(jsonb_build_object(
        'activeCampaigns', (SELECT count(*) FROM "PromotionCampaigns"
                             WHERE status = 'ACTIVE' AND now() BETWEEN valid_from AND valid_until),
        'passesIssued', (SELECT count(*) FROM "CustomerPromotionPasses"),
        'activePasses', (SELECT count(*) FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id
                          WHERE promo_pass_effective_status(p, c.status) = 'ACTIVE'),
        'pastPasses', (SELECT count(*) FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id
                        WHERE promo_pass_effective_status(p, c.status) IN ('EXPIRED', 'USED_UP', 'CANCELLED')),
        'usesThisMonth', (SELECT count(*) FROM "PromotionUsages"
                           WHERE status <> 'CANCELLED'
                             AND applied_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'))
    ));
$$;

DROP FUNCTION IF EXISTS promo_search_passes(text, uuid, text, text, int, int);
CREATE OR REPLACE FUNCTION promo_search_passes(p_q text DEFAULT NULL, p_campaign_id uuid DEFAULT NULL, p_status text DEFAULT NULL,
                                               p_expiry text DEFAULT NULL, p_limit int DEFAULT 100, p_offset int DEFAULT 0,
                                               p_group text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q text := NULLIF(trim(COALESCE(p_q, '')), '');
    v_total int;
    v_items jsonb;
BEGIN
    WITH f AS (
        SELECT p.id, p.issued_at, promo_pass_effective_status(p, c.status) AS eff, p.valid_until,
               promo_pass_ended_at(p, promo_pass_effective_status(p, c.status)) AS ended_at
        FROM "CustomerPromotionPasses" p
        JOIN "PromotionCampaigns" c ON c.id = p.campaign_id
        LEFT JOIN "Customers" cu ON cu.id = p.customer_id
        WHERE (p_campaign_id IS NULL OR p.campaign_id = p_campaign_id)
          AND (v_q IS NULL OR p.voucher_code ILIKE '%' || v_q || '%' OR cu."fullName" ILIKE '%' || v_q || '%'
               OR cu.phone ILIKE '%' || v_q || '%' OR cu.email ILIKE '%' || v_q || '%')
    ), g AS (
        SELECT * FROM f
        WHERE (p_status IS NULL OR eff = p_status)
          AND (p_expiry IS NULL
               OR (p_expiry = 'VALID' AND eff IN ('ACTIVE', 'NOT_STARTED'))
               OR (p_expiry = 'EXPIRING_7D' AND eff = 'ACTIVE' AND valid_until <= now() + interval '7 days')
               OR (p_expiry = 'EXPIRED' AND eff = 'EXPIRED'))
          -- ACTIVE tab: still usable or re-openable; PAST tab: closed for good.
          AND (p_group IS NULL
               OR (upper(p_group) = 'ACTIVE' AND eff IN ('ACTIVE', 'NOT_STARTED', 'SUSPENDED', 'INACTIVE'))
               OR (upper(p_group) = 'PAST' AND eff IN ('EXPIRED', 'USED_UP', 'CANCELLED')))
    )
    SELECT (SELECT count(*) FROM g),
           COALESCE((SELECT jsonb_agg(promo_pass_json(id, false) ORDER BY rn)
                       FROM (SELECT id, row_number() OVER (ORDER BY
                                    CASE WHEN upper(COALESCE(p_group, '')) = 'ACTIVE' THEN valid_until END ASC,
                                    CASE WHEN upper(COALESCE(p_group, '')) = 'PAST' THEN ended_at END DESC,
                                    issued_at DESC) AS rn
                               FROM g
                              ORDER BY CASE WHEN upper(COALESCE(p_group, '')) = 'ACTIVE' THEN valid_until END ASC,
                                       CASE WHEN upper(COALESCE(p_group, '')) = 'PAST' THEN ended_at END DESC,
                                       issued_at DESC
                              LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) t),
                    '[]'::jsonb)
      INTO v_total, v_items;
    RETURN promo_ok(jsonb_build_object('total', v_total, 'items', v_items));
END;
$$;

CREATE OR REPLACE FUNCTION promo_customer_candidates(p_campaign_id uuid, p_filter jsonb DEFAULT '{}'::jsonb,
                                                     p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    f jsonb := COALESCE(p_filter, '{}'::jsonb);
    v_q text := NULLIF(trim(COALESCE(f->>'q', '')), '');
    v_has_email boolean := COALESCE((f->>'hasEmail')::boolean, true);
    v_only_q boolean := COALESCE((f->>'onlyQualified')::boolean, false);
    v_qf date := NULLIF(f->>'qualifiedFrom', '')::date;
    v_qt date := NULLIF(f->>'qualifiedTo', '')::date;
    v_vf date := NULLIF(f->>'visitFrom', '')::date;
    v_vt date := NULLIF(f->>'visitTo', '')::date;
    v_min_visits int := NULLIF(f->>'minVisits', '')::int;
    v_min_spent numeric := NULLIF(f->>'minSpent', '')::numeric;
    v_tier text := NULLIF(upper(f->>'tier'), '');
    v_vip text := NULLIF(upper(f->>'vipMenu'), '');
    v_guest text := NULLIF(upper(f->>'guestType'), '');
    v_gender text := NULLIF(upper(f->>'gender'), '');
    v_nat text := NULLIF(trim(COALESCE(f->>'nationality', '')), '');
    v_lang text := NULLIF(lower(f->>'language'), '');
    v_auto_q boolean;
    v_compute_q boolean;
    v_total int;
    v_no_email int;
    v_items jsonb;
    v_nats jsonb;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình'); END IF;
    IF v_tier IS NOT NULL AND v_tier NOT IN ('NEW', 'RETURNING') THEN
        RETURN promo_err('VALIDATION_ERROR', 'tier phải là NEW hoặc RETURNING', jsonb_build_object('data', jsonb_build_object('field', 'tier')));
    END IF;
    IF (v_qf IS NULL) <> (v_qt IS NULL) OR v_qt < v_qf OR v_qt - v_qf > 92 THEN
        IF v_qf IS NOT NULL OR v_qt IS NOT NULL THEN
            RETURN promo_err('VALIDATION_ERROR', 'Khoảng "đơn đạt điều kiện" cần đủ từ–đến, tối đa 93 ngày',
                             jsonb_build_object('data', jsonb_build_object('field', 'qualifiedFrom')));
        END IF;
    END IF;
    IF v_only_q AND v_qf IS NULL THEN
        RETURN promo_err('VALIDATION_ERROR', 'Lọc "có đơn đạt điều kiện" cần khoảng ngày (tối đa 93 ngày)',
                         jsonb_build_object('data', jsonb_build_object('field', 'qualifiedFrom')));
    END IF;
    v_auto_q := c.qualification_type IN ('MIN_PAID_DURATION', 'MIN_ORDER_AMOUNT', 'SPECIFIC_SERVICE');
    v_compute_q := v_qf IS NOT NULL AND v_auto_q;

    CREATE TEMP TABLE IF NOT EXISTS _promo_cand (
        customer_id text PRIMARY KEY, name text, phone text, email text, real_email text, gender text,
        nationality text, language text, visit_count int, total_spent numeric, last_visit_at timestamp,
        vip_menu_count int, guest_type text, tier text, qualifying int) ON COMMIT DROP;
    TRUNCATE _promo_cand;

    INSERT INTO _promo_cand
    SELECT s.*, 0 FROM promo_customer_stats(NULL) s
     WHERE (v_q IS NULL OR s.name ILIKE '%' || v_q || '%' OR s.phone ILIKE '%' || v_q || '%' OR s.email ILIKE '%' || v_q || '%')
       AND (v_vf IS NULL OR s.last_visit_at::date >= v_vf)
       AND (v_vt IS NULL OR s.last_visit_at::date <= v_vt)
       AND (v_min_visits IS NULL OR s.visit_count >= v_min_visits)
       AND (v_min_spent IS NULL OR s.total_spent >= v_min_spent)
       AND (v_tier IS NULL OR s.tier = v_tier)
       AND (v_vip IS NULL OR (v_vip = 'USED' AND s.vip_menu_count > 0) OR (v_vip = 'NOT_USED' AND s.vip_menu_count = 0))
       AND (v_guest IS NULL OR s.guest_type = v_guest)
       AND (v_gender IS NULL OR s.gender = v_gender)
       AND (v_nat IS NULL OR lower(s.nationality) = lower(v_nat))
       AND (v_lang IS NULL OR s.language = v_lang);

    IF v_compute_q THEN
        -- Same engine predicate as auto-issue: DONE order in the VN range that is eligible for THIS campaign.
        UPDATE _promo_cand t SET qualifying = x.n
          FROM (
            SELECT b."customerId" AS cid, count(*)::int AS n
              FROM "Bookings" b
             WHERE b."customerId" IN (SELECT customer_id FROM _promo_cand)
               AND b.status::text = 'DONE'
               AND COALESCE(b."bookingDate", b."createdAt") >= v_qf::timestamp
               AND COALESCE(b."bookingDate", b."createdAt") < (v_qt + 1)::timestamp
               AND (promo_evaluate_booking_for_campaign(b.id, c.id)->>'eligible')::boolean
             GROUP BY b."customerId") x
         WHERE x.cid = t.customer_id;
    END IF;
    IF v_only_q AND v_auto_q THEN
        DELETE FROM _promo_cand WHERE qualifying = 0;
    END IF;

    SELECT count(*) FILTER (WHERE NOT v_has_email OR real_email IS NOT NULL),
           CASE WHEN v_has_email THEN count(*) FILTER (WHERE real_email IS NULL) ELSE 0 END
      INTO v_total, v_no_email FROM _promo_cand;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', customer_id, 'name', name, 'phone', phone, 'email', real_email,
               'gender', gender, 'nationality', nationality, 'language', language,
               'visitCount', visit_count, 'totalSpent', total_spent,
               'lastVisitAt', CASE WHEN last_visit_at IS NULL THEN NULL ELSE to_char(last_visit_at, 'YYYY-MM-DD"T"HH24:MI:SS') END,
               'vipMenuCount', vip_menu_count, 'vipMenuUsed', vip_menu_count > 0,
               'guestType', guest_type, 'tier', tier,
               'qualifyingOrderCount', qualifying,
               -- true only while the customer HOLDS a usable pass of this campaign (cannot be issued again)
               'alreadyHasPass', t.holds_usable,
               'passHistory', promo_customer_pass_history(t.customer_id, 10))
             ORDER BY t.holds_usable, last_visit_at DESC NULLS LAST, name), '[]'::jsonb)
      INTO v_items
      FROM (SELECT x.*, promo_customer_holds_usable_pass(x.customer_id, c.id) AS holds_usable FROM _promo_cand x
             WHERE NOT v_has_email OR real_email IS NOT NULL
             ORDER BY promo_customer_holds_usable_pass(x.customer_id, c.id), last_visit_at DESC NULLS LAST, name
             LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) t;

    SELECT COALESCE(jsonb_agg(n ORDER BY n), '[]'::jsonb) INTO v_nats
      FROM (SELECT DISTINCT trim(nationality) AS n FROM "Customers" WHERE NULLIF(trim(nationality), '') IS NOT NULL) z;

    RETURN promo_ok(jsonb_build_object(
        'rows', v_items, 'total', v_total,
        'limit', LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50), 'offset', GREATEST(COALESCE(p_offset, 0), 0),
        'excludedNoEmail', v_no_email, 'nationalities', v_nats,
        'qualificationIgnored', (v_only_q OR v_qf IS NOT NULL) AND NOT v_auto_q,
        'qualifyingComputed', v_compute_q));
END;
$$;

-- 8. Email outbox
CREATE OR REPLACE FUNCTION promo_claim_email_batch(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_out jsonb := '[]'::jsonb;
    v_days int := GREATEST(promo_setting_int('promotion_expiry_reminder_days', 3), 0);
    r record;
    v_claim jsonb;
BEGIN
    IF NOT promo_setting_bool('promotion_email_enabled', true) THEN RETURN promo_ok(v_out); END IF;

    FOR r IN
        SELECT p.id, 'ISSUE' AS kind FROM "CustomerPromotionPasses" p
         WHERE (p.email_status = 'PENDING'
                OR (p.email_status = 'SENDING' AND p.email_claimed_at < now() - interval '15 minutes'))
           AND p.email_attempts < 5 AND p.status = 'ACTIVE' AND p.valid_until > now() AND p.superseded_at IS NULL
         ORDER BY p.issued_at
         LIMIT GREATEST(p_limit, 1)
         FOR UPDATE SKIP LOCKED
    LOOP
        v_claim := promo_claim_pass_email(r.id, 'ISSUE', false);
        IF (v_claim->>'success')::boolean AND NOT COALESCE((v_claim#>>'{data,skipped}')::boolean, false) THEN
            v_out := v_out || jsonb_build_array(v_claim->'data');
        END IF;
    END LOOP;

    IF v_days > 0 THEN
        FOR r IN
            SELECT p.id FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id
             WHERE p.status = 'ACTIVE' AND c.status = 'ACTIVE'
               AND promo_pass_effective_status(p, c.status) = 'ACTIVE'
               AND p.valid_until > now() AND p.valid_until <= now() + make_interval(days => v_days)
               AND p.email_status = 'SENT'
               AND (p.reminder_status IN ('NONE', 'FAILED')
                    OR (p.reminder_status = 'SENDING' AND p.reminder_claimed_at < now() - interval '15 minutes'))
               AND p.reminder_attempts < 3
               -- skip vouchers whose whole life is shorter than the reminder window
               AND p.email_sent_at < p.valid_until - make_interval(days => v_days)
             ORDER BY p.valid_until
             LIMIT GREATEST(p_limit, 1)
             FOR UPDATE OF p SKIP LOCKED
        LOOP
            v_claim := promo_claim_pass_email(r.id, 'REMINDER', false);
            IF (v_claim->>'success')::boolean AND NOT COALESCE((v_claim#>>'{data,skipped}')::boolean, false) THEN
                v_out := v_out || jsonb_build_array(v_claim->'data');
            END IF;
        END LOOP;
    END IF;
    RETURN promo_ok(v_out);
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Grants — service_role only
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
