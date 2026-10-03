-- =============================================================================
-- Promotion Engine v2 — shared vouchers, open-order candidates, validity modes,
-- e-voucher email outbox, admin read models, Web Booking voucher lookup.
-- Plan: plans/plan_promotion_engine_backend.md (v4, v4.9 decisions).
-- Builds on 20261002120000_promotion_engine.sql (already applied on test DB).
--
-- Changes in behaviour:
--   * A voucher can be used on ANY open order (shared with friends).
--     PromotionUsages.customer_id = customer of the ORDER (nullable);
--     pass_owner_id = owner of the voucher.
--   * Auto issue on DONE is gated by SystemConfigs.promotion_auto_issue_enabled
--     (default false — admins issue manually for now).
--   * Validity: CAMPAIGN_PERIOD (whole campaign window, e.g. the month) or
--     DAYS_FROM_ISSUE (N VN days from issue, capped at campaign end).
--     "By uses" stays usage_type LIMITED + usage_limit.
--   * One shared predicate promo_check_apply() decides canApply for the
--     candidate list AND the real apply.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Settings
-- -----------------------------------------------------------------------------
INSERT INTO "SystemConfigs"(key, value, description) VALUES
    ('promotion_auto_issue_enabled', 'false'::jsonb, 'Promotion Engine: tự phát e-voucher khi đơn DONE (campaign AUTO). Mặc định tắt.'),
    ('promotion_email_enabled', 'true'::jsonb, 'Promotion Engine: gửi e-voucher và email nhắc hạn qua email.'),
    ('promotion_expiry_reminder_days', '3'::jsonb, 'Promotion Engine: gửi email nhắc trước khi voucher hết hạn (số ngày).')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION promo_setting_text(p_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT NULLIF(trim(both '"' FROM trim(value #>> '{}')), '') FROM "SystemConfigs" WHERE key = p_key;
$$;

CREATE OR REPLACE FUNCTION promo_setting_bool(p_key text, p_default boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v text := lower(promo_setting_text(p_key));
BEGIN
    IF v IN ('true', '1', 'yes', 'on') THEN RETURN true; END IF;
    IF v IN ('false', '0', 'no', 'off') THEN RETURN false; END IF;
    RETURN p_default;
END;
$$;

CREATE OR REPLACE FUNCTION promo_setting_int(p_key text, p_default int)
RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN COALESCE(promo_setting_text(p_key)::numeric::int, p_default);
EXCEPTION WHEN OTHERS THEN
    RETURN p_default;
END;
$$;

-- Business day = VN day shifted by spa_day_cutoff_hours (same rule as lib/business-date.ts).
-- Returns VN-local and UTC-naive bounds [start, end).
CREATE OR REPLACE FUNCTION promo_business_day_bounds()
RETURNS TABLE(business_date date, vn_start timestamp, vn_end timestamp, utc_start timestamp, utc_end timestamp)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cut   int := promo_setting_int('spa_day_cutoff_hours', 7);
    v_vnnow timestamp := now() AT TIME ZONE 'Asia/Ho_Chi_Minh';
BEGIN
    IF v_cut < 0 OR v_cut >= 24 THEN v_cut := 7; END IF;
    business_date := (v_vnnow - make_interval(hours => v_cut))::date;
    vn_start := business_date + make_interval(hours => v_cut);
    vn_end := vn_start + interval '1 day';
    utc_start := (vn_start AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'UTC';
    utc_end := (vn_end AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'UTC';
    RETURN NEXT;
END;
$$;

-- Customer's preferred language = most frequent Bookings.customerLang
-- (same rule as preferredLangCode in app/api/customers/route.ts). vi/en/cn/jp/kr.
CREATE OR REPLACE FUNCTION promo_customer_language(p_customer_id text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v text;
BEGIN
    SELECT lower(trim("customerLang")) INTO v
      FROM "Bookings"
     WHERE "customerId" = p_customer_id AND COALESCE(trim("customerLang"), '') <> ''
     GROUP BY lower(trim("customerLang"))
     ORDER BY count(*) DESC, max("createdAt") DESC
     LIMIT 1;
    v := CASE v WHEN 'vn' THEN 'vi' WHEN 'zh' THEN 'cn' WHEN 'ja' THEN 'jp' WHEN 'ko' THEN 'kr' ELSE v END;
    RETURN CASE WHEN v IN ('vi', 'en', 'cn', 'jp', 'kr') THEN v ELSE 'vi' END;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Schema changes
-- -----------------------------------------------------------------------------
ALTER TABLE "PromotionCampaigns"
    ADD COLUMN IF NOT EXISTS validity_type text NOT NULL DEFAULT 'CAMPAIGN_PERIOD',
    ADD COLUMN IF NOT EXISTS validity_days integer;
ALTER TABLE "PromotionCampaigns" DROP CONSTRAINT IF EXISTS promo_campaign_validity_chk;
ALTER TABLE "PromotionCampaigns" ADD CONSTRAINT promo_campaign_validity_chk CHECK (
    validity_type IN ('CAMPAIGN_PERIOD', 'DAYS_FROM_ISSUE')
    AND (validity_type <> 'DAYS_FROM_ISSUE' OR (validity_days IS NOT NULL AND validity_days BETWEEN 1 AND 3650)));

ALTER TABLE "PromotionUsages" ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE "PromotionUsages" ADD COLUMN IF NOT EXISTS pass_owner_id text;
UPDATE "PromotionUsages" u SET pass_owner_id = p.customer_id
  FROM "CustomerPromotionPasses" p WHERE p.id = u.promotion_pass_id AND u.pass_owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promo_usage_applied_at ON "PromotionUsages"(applied_at);

ALTER TABLE "CustomerPromotionPasses"
    ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'SKIPPED',
    ADD COLUMN IF NOT EXISTS email_to text,
    ADD COLUMN IF NOT EXISTS email_lang text,
    ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS email_last_error text,
    ADD COLUMN IF NOT EXISTS email_claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS reminder_status text NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS reminder_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS reminder_claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
ALTER TABLE "CustomerPromotionPasses" DROP CONSTRAINT IF EXISTS promo_pass_email_status_chk;
ALTER TABLE "CustomerPromotionPasses" ADD CONSTRAINT promo_pass_email_status_chk CHECK (
    email_status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')
    AND reminder_status IN ('NONE', 'SENDING', 'SENT', 'FAILED'));
CREATE INDEX IF NOT EXISTS idx_promo_pass_email_pending ON "CustomerPromotionPasses"(email_status) WHERE email_status IN ('PENDING', 'SENDING');

DROP FUNCTION IF EXISTS promo_active_orders_for_pass(uuid);
DROP FUNCTION IF EXISTS promo_list_passes(uuid, int, int);

-- -----------------------------------------------------------------------------
-- 2. Messages (one place)
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
        ELSE p_code
    END;
$$;

-- -----------------------------------------------------------------------------
-- 3. JSON shapes (match lib/types/promotion-client.ts of the frontend)
-- -----------------------------------------------------------------------------
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

-- p_include_token: admin detail / issue / lookup / customer history. Never in lists.
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
        'reminderSentAt', promo_iso(p.reminder_sent_at)
    );
END;
$$;

CREATE OR REPLACE FUNCTION promo_staff_name(p_staff_id text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v text;
BEGIN
    IF p_staff_id IS NULL THEN RETURN NULL; END IF;
    SELECT "fullName" INTO v FROM "Users" WHERE id = p_staff_id OR username = p_staff_id LIMIT 1;
    IF v IS NULL THEN SELECT full_name INTO v FROM "Staff" WHERE id = p_staff_id LIMIT 1; END IF;
    RETURN COALESCE(NULLIF(v, ''), p_staff_id);
EXCEPTION WHEN OTHERS THEN
    RETURN p_staff_id;
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
        'cancelReason', u.cancel_reason)
    FROM "PromotionUsages" u
    JOIN "CustomerPromotionPasses" p ON p.id = u.promotion_pass_id
    JOIN "PromotionCampaigns" c ON c.id = u.campaign_id
    LEFT JOIN "Bookings" b ON b.id = u.booking_id
    LEFT JOIN "Customers" oc ON oc.id = u.customer_id
    LEFT JOIN "Customers" po ON po.id = u.pass_owner_id
    WHERE u.id = p_usage_id;
$$;

-- Order card used by the candidate list and the apply result.
CREATE OR REPLACE FUNCTION promo_booking_json(p_booking_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id', b.id, 'billCode', b."billCode", 'status', b.status::text,
        'customerId', b."customerId", 'customerName', b."customerName", 'customerPhone', b."customerPhone",
        'bookingTime', b."timeBooking",
        'roomLabel', COALESCE(NULLIF(b."roomName", ''),
                              (SELECT string_agg(DISTINCT bi."roomName", ', ') FROM "BookingItems" bi
                                WHERE bi."bookingId" = b.id AND COALESCE(bi.status, '') <> 'CANCELLED' AND NULLIF(bi."roomName", '') IS NOT NULL)),
        'totalAmount', b."totalAmount",
        'createdAt', promo_iso(b."createdAt" AT TIME ZONE 'UTC'),
        'source', b.source,
        'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', bi.id, 'serviceId', bi."serviceId",
                       'serviceName', COALESCE(jsonb_unwrap_string(bi.options)->>'displayName', s."nameVN", bi."serviceId"),
                       'durationMinutes', promo_item_minutes(bi.options, s.duration, bi.quantity),
                       'price', COALESCE(bi.price, 0) * GREATEST(COALESCE(bi.quantity, 1), 1),
                       'status', bi.status,
                       'isPromotion', COALESCE(s.is_promotion, false) OR COALESCE((jsonb_unwrap_string(bi.options)->>'isPromotion') = 'true', false))
                     ORDER BY bi.id)
              FROM "BookingItems" bi LEFT JOIN "Services" s ON s.id = bi."serviceId"
             WHERE bi."bookingId" = b.id AND COALESCE(bi.status, '') <> 'CANCELLED'), '[]'::jsonb)
    ) || (SELECT jsonb_build_object(
              'totalDurationMinutes', (m->>'totalMinutes')::int,
              'paidMinutes', (m->>'paidMinutes')::int,
              'promotionMinutes', (m->>'promotionMinutes')::int)
            FROM promo_order_minutes(b.id, '{}'::jsonb) m)
    FROM "Bookings" b WHERE b.id = p_booking_id;
$$;

-- -----------------------------------------------------------------------------
-- 4. Validity + issuing
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_pass_window(p_campaign_id uuid, p_at timestamptz)
RETURNS TABLE(valid_from timestamptz, valid_until timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    v_start timestamptz;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF c.validity_type = 'DAYS_FROM_ISSUE' THEN
        v_start := GREATEST(c.valid_from, p_at);
        valid_from := v_start;
        -- end of the N-th VN day counting the issue day as day 1, capped at campaign end
        valid_until := LEAST(c.valid_until,
            ((((v_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + c.validity_days)::timestamp - interval '1 second')
                AT TIME ZONE 'Asia/Ho_Chi_Minh'));
    ELSE
        valid_from := c.valid_from;
        valid_until := c.valid_until;
    END IF;
    RETURN NEXT;
END;
$$;

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
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    SELECT * INTO w FROM promo_pass_window(c.id, now());
    SELECT NULLIF(trim(email), '') INTO v_email FROM "Customers" WHERE id = p_customer_id;

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
            RETURN jsonb_build_object('created', true, 'passId', v_id);
        END IF;

        SELECT id INTO v_exist FROM "CustomerPromotionPasses"
        WHERE campaign_id = c.id
          AND ((c.one_pass_per_customer AND customer_id = p_customer_id)
               OR (p_source_booking_id IS NOT NULL AND source_booking_id = p_source_booking_id))
        ORDER BY issued_at LIMIT 1;
        IF v_exist IS NOT NULL THEN
            RETURN jsonb_build_object('created', false, 'passId', v_exist);
        END IF;
    END LOOP;
    RAISE EXCEPTION 'promo_insert_pass: could not generate unique voucher code';
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
          AND qualification_type IN ('MIN_PAID_DURATION', 'MIN_ORDER_AMOUNT', 'SPECIFIC_SERVICE')
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
-- 5. Campaign create / update (validity + lock only on real rule changes)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_create_campaign(p_payload jsonb, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id uuid;
BEGIN
    IF COALESCE(p_payload->>'benefit_type', '') IN ('FREE_SERVICE', 'FREE_UPGRADE') THEN
        RETURN promo_err('BENEFIT_NOT_SUPPORTED', 'Loại ưu đãi này chưa được hỗ trợ');
    END IF;
    IF EXISTS (SELECT 1 FROM "PromotionCampaigns" WHERE campaign_code = upper(p_payload->>'campaign_code')) THEN
        RETURN promo_err('CAMPAIGN_CODE_EXISTS', 'Mã chương trình đã tồn tại');
    END IF;

    INSERT INTO "PromotionCampaigns" (
        campaign_code, name, description, benefit_type, benefit_value, benefit_config,
        valid_from, valid_until, usage_type, usage_limit, max_usage_per_customer, max_usage_per_order,
        qualification_type, qualification_value, qualification_config, assignment_mode,
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
        COALESCE(NULLIF(p_payload->'qualification_config', 'null'::jsonb), '{}'::jsonb),
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

-- Does payload key k carry a value different from the current campaign row?
CREATE OR REPLACE FUNCTION promo_campaign_key_changed(c "PromotionCampaigns", k text, v jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
    cur jsonb := to_jsonb(c) -> k;
    nv  jsonb := CASE WHEN v = 'null'::jsonb OR v = '""'::jsonb THEN NULL ELSE v END;
BEGIN
    IF k IN ('valid_from', 'valid_until') THEN
        RETURN (nv #>> '{}')::timestamptz IS DISTINCT FROM (cur #>> '{}')::timestamptz;
    ELSIF k IN ('campaign_code', 'voucher_prefix') THEN
        RETURN upper(nv #>> '{}') IS DISTINCT FROM upper(cur #>> '{}');
    ELSIF k IN ('benefit_config', 'qualification_config') THEN
        RETURN COALESCE(nv, '{}'::jsonb) IS DISTINCT FROM COALESCE(cur, '{}'::jsonb);
    ELSIF jsonb_typeof(cur) = 'number' OR jsonb_typeof(nv) = 'number' THEN
        RETURN (nv #>> '{}')::numeric IS DISTINCT FROM (cur #>> '{}')::numeric;
    ELSE
        RETURN (nv #>> '{}') IS DISTINCT FROM (cur #>> '{}');
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION promo_update_campaign(p_campaign_id uuid, p_payload jsonb, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    v_rule_keys constant text[] := ARRAY['benefit_type','benefit_value','benefit_config','valid_from','usage_type',
        'usage_limit','max_usage_per_customer','max_usage_per_order','qualification_type','qualification_value',
        'qualification_config','assignment_mode','one_pass_per_customer','voucher_prefix','campaign_code',
        'validity_type','validity_days'];
    k text;
    v_changed text[] := ARRAY[]::text[];
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
    IF c.status <> 'DRAFT' AND cardinality(v_changed) > 0 THEN
        RETURN promo_err('CAMPAIGN_LOCKED', 'Chỉ sửa được quy tắc khi chương trình còn ở trạng thái Nháp',
                         jsonb_build_object('data', jsonb_build_object('fields', to_jsonb(v_changed))));
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
        qualification_config   = COALESCE(NULLIF(p_payload->'qualification_config', 'null'::jsonb), qualification_config),
        assignment_mode        = COALESCE(p_payload->>'assignment_mode', assignment_mode),
        one_pass_per_customer  = COALESCE((p_payload->>'one_pass_per_customer')::boolean, one_pass_per_customer),
        voucher_prefix         = COALESCE(upper(NULLIF(p_payload->>'voucher_prefix', '')), voucher_prefix),
        validity_type          = COALESCE(p_payload->>'validity_type', validity_type),
        validity_days          = CASE WHEN p_payload ? 'validity_days' THEN NULLIF(p_payload->>'validity_days', '')::int ELSE validity_days END,
        updated_at             = now()
    WHERE id = p_campaign_id;

    -- Moving the campaign end extends open passes of CAMPAIGN_PERIOD campaigns only.
    IF p_payload ? 'valid_until' AND promo_campaign_key_changed(c, 'valid_until', p_payload -> 'valid_until')
       AND c.validity_type = 'CAMPAIGN_PERIOD' THEN
        UPDATE "CustomerPromotionPasses" SET valid_until = (p_payload->>'valid_until')::timestamptz, updated_at = now()
        WHERE campaign_id = p_campaign_id AND status IN ('ACTIVE', 'EXPIRED')
          AND (p_payload->>'valid_until')::timestamptz > valid_from;
        UPDATE "CustomerPromotionPasses" SET status = 'ACTIVE', status_reason = NULL, updated_at = now()
        WHERE campaign_id = p_campaign_id AND status = 'EXPIRED' AND valid_until > now();
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

-- -----------------------------------------------------------------------------
-- 6. Apply — one predicate for candidates and apply
-- -----------------------------------------------------------------------------
-- Discount a pass would give on a booking right now (0 for FREE_MINUTES).
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
    v_base := CASE WHEN c.benefit_config->>'discountScope' = 'QUALIFYING_ITEMS'
                   THEN (promo_order_minutes(p_booking_id, c.qualification_config)->>'qualifyingAmount')::numeric
                   ELSE (promo_order_minutes(p_booking_id, '{}'::jsonb)->>'paidAmount')::numeric END;
    v_disc := CASE WHEN p.benefit_type = 'PERCENT_DISCOUNT' THEN round(v_base * p.benefit_value / 100) ELSE p.benefit_value END;
    v_cap := NULLIF(c.benefit_config->>'maxDiscountAmount', '')::numeric;
    IF v_cap IS NOT NULL THEN v_disc := LEAST(v_disc, v_cap); END IF;
    RETURN GREATEST(0, LEAST(v_disc, GREATEST(COALESCE(v_total, 0), 0)));
END;
$$;

-- Returns NULL when the pass can be applied to the booking, else the error code.
-- No locks; promo_apply_pass calls it again after locking pass + booking.
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
    -- Shared vouchers: the per-customer cap counts the ORDER's customer.
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
    v_guest     text;
    v_room      text;
    v_bed       text;
    v_item_id   text;
    v_usage_id  uuid := gen_random_uuid();
    v_minutes   integer := 0;
    v_discount  numeric := 0;
    v_now_utc   timestamp := (now() AT TIME ZONE 'UTC');
BEGIN
    -- Lock order: pass -> booking. Serialises concurrent applies of the same pass.
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
     ORDER BY (bi.status = 'IN_PROGRESS') DESC, bi.id
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
-- 7. Read models
-- -----------------------------------------------------------------------------
-- Open orders of the whole spa in the current business day, pass owner's first.
CREATE OR REPLACE FUNCTION promo_order_candidates(p_pass_id uuid, p_q text DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_owner text;
    d record;
    v_q text := NULLIF(trim(COALESCE(p_q, '')), '');
    v_rows jsonb;
BEGIN
    SELECT customer_id INTO v_owner FROM "CustomerPromotionPasses" WHERE id = p_pass_id;
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

CREATE OR REPLACE FUNCTION promo_overview()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT promo_ok(jsonb_build_object(
        'activeCampaigns', (SELECT count(*) FROM "PromotionCampaigns"
                             WHERE status = 'ACTIVE' AND now() BETWEEN valid_from AND valid_until),
        'passesIssued', (SELECT count(*) FROM "CustomerPromotionPasses"),
        'activePasses', (SELECT count(*) FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id
                          WHERE promo_pass_effective_status(p, c.status) = 'ACTIVE'),
        'usesThisMonth', (SELECT count(*) FROM "PromotionUsages"
                           WHERE status <> 'CANCELLED'
                             AND applied_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'))
    ));
$$;

-- p_status filters the EFFECTIVE status; p_expiry: VALID | EXPIRING_7D | EXPIRED.
CREATE OR REPLACE FUNCTION promo_search_passes(p_q text DEFAULT NULL, p_campaign_id uuid DEFAULT NULL, p_status text DEFAULT NULL,
                                               p_expiry text DEFAULT NULL, p_limit int DEFAULT 100, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q text := NULLIF(trim(COALESCE(p_q, '')), '');
    v_total int;
    v_items jsonb;
BEGIN
    WITH f AS (
        SELECT p.id, p.issued_at, promo_pass_effective_status(p, c.status) AS eff, p.valid_until
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
    )
    SELECT (SELECT count(*) FROM g),
           COALESCE((SELECT jsonb_agg(promo_pass_json(id, false) ORDER BY issued_at DESC)
                       FROM (SELECT id, issued_at FROM g ORDER BY issued_at DESC
                              LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500) OFFSET GREATEST(COALESCE(p_offset, 0), 0)) t),
                    '[]'::jsonb)
      INTO v_total, v_items;
    RETURN promo_ok(jsonb_build_object('total', v_total, 'items', v_items));
END;
$$;

-- p_from / p_to: VN calendar dates, inclusive.
CREATE OR REPLACE FUNCTION promo_list_usages(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_campaign_id uuid DEFAULT NULL,
                                             p_status text DEFAULT NULL, p_q text DEFAULT NULL, p_pass_id uuid DEFAULT NULL,
                                             p_limit int DEFAULT 500)
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
          AND (v_q IS NULL OR p.voucher_code ILIKE '%' || v_q || '%' OR b."billCode" ILIKE '%' || v_q || '%'
               OR COALESCE(oc."fullName", b."customerName") ILIKE '%' || v_q || '%'
               OR COALESCE(oc.phone, b."customerPhone") ILIKE '%' || v_q || '%')
        ORDER BY u.applied_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000)
    ) t;
    RETURN promo_ok(v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION promo_search_customers(p_q text, p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q text := NULLIF(trim(COALESCE(p_q, '')), '');
    v_rows jsonb;
BEGIN
    IF v_q IS NULL OR length(v_q) < 2 THEN RETURN promo_ok('[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', "fullName", 'phone', phone, 'email', email,
                                                 'language', promo_customer_language(id)) ORDER BY rk, last_visit DESC NULLS LAST), '[]'::jsonb)
      INTO v_rows
      FROM (
        SELECT id, "fullName", phone, email, "lastVisited" AS last_visit,
               CASE WHEN phone = v_q OR lower(email) = lower(v_q) OR id = v_q THEN 0 ELSE 1 END AS rk
          FROM "Customers"
         WHERE "fullName" ILIKE '%' || v_q || '%' OR phone ILIKE '%' || v_q || '%'
            OR email ILIKE '%' || v_q || '%' OR id = v_q
         ORDER BY rk, "lastVisited" DESC NULLS LAST
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
      ) t;
    RETURN promo_ok(v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION promo_customer_promotions(p_customer_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_active jsonb := '[]'::jsonb;
    v_past   jsonb := '[]'::jsonb;
    v_usage  jsonb;
    r        record;
    v_json   jsonb;
BEGIN
    FOR r IN SELECT id FROM "CustomerPromotionPasses" WHERE customer_id = p_customer_id ORDER BY issued_at DESC LOOP
        v_json := promo_pass_json(r.id, true);
        IF v_json->>'effectiveStatus' IN ('ACTIVE', 'NOT_STARTED') THEN
            v_active := v_active || jsonb_build_array(v_json);
        ELSE
            v_past := v_past || jsonb_build_array(v_json - 'qrToken');
        END IF;
    END LOOP;
    -- Uses on this customer's orders AND uses of this customer's vouchers by others.
    SELECT COALESCE(jsonb_agg(promo_usage_json(id) ORDER BY applied_at DESC), '[]'::jsonb) INTO v_usage
      FROM "PromotionUsages" WHERE customer_id = p_customer_id OR pass_owner_id = p_customer_id;
    RETURN promo_ok(jsonb_build_object('active', v_active, 'past', v_past, 'usages', v_usage));
END;
$$;

-- Web Booking History (same Supabase project, called server-side with service role).
-- Only voucher data: no phone, staff or order history.
CREATE OR REPLACE FUNCTION promo_public_vouchers_by_email(p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_email text := lower(trim(COALESCE(p_email, '')));
    v_active jsonb := '[]'::jsonb;
    v_past jsonb := '[]'::jsonb;
    r record;
    j jsonb;
    v_item jsonb;
BEGIN
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN promo_ok(jsonb_build_object('active', '[]'::jsonb, 'past', '[]'::jsonb)); END IF;
    FOR r IN
        SELECT p.id FROM "CustomerPromotionPasses" p JOIN "Customers" cu ON cu.id = p.customer_id
         WHERE lower(trim(cu.email)) = v_email
         ORDER BY p.issued_at DESC
    LOOP
        j := promo_pass_json(r.id, true);
        v_item := jsonb_build_object(
            'id', j->'id', 'voucherCode', j->'voucherCode', 'effectiveStatus', j->'effectiveStatus',
            'campaign', jsonb_build_object('name', j#>'{campaign,name}'),
            'customerName', j#>'{customer,name}',
            'benefit', jsonb_build_object('type', j#>'{benefit,type}', 'value', j#>'{benefit,value}'),
            'usage', jsonb_build_object('type', j#>'{usage,type}', 'limit', j#>'{usage,limit}', 'usedCount', j#>'{usage,usedCount}'),
            'validFrom', j->'validFrom', 'validUntil', j->'validUntil', 'issuedAt', j->'issuedAt');
        IF j->>'effectiveStatus' IN ('ACTIVE', 'NOT_STARTED') THEN
            v_active := v_active || jsonb_build_array(v_item || jsonb_build_object('qrToken', j->'qrToken'));
        ELSE
            v_past := v_past || jsonb_build_array(v_item);
        END IF;
    END LOOP;
    RETURN promo_ok(jsonb_build_object('active', v_active, 'past', v_past));
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. E-voucher email outbox
-- -----------------------------------------------------------------------------
-- Claims one pass for sending (kind ISSUE | REMINDER). p_force: admin "resend".
-- Returns the data the TS mailer needs, or an error / {skipped}.
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
        RETURN promo_err('PROMOTION_' || CASE WHEN v_eff = 'INACTIVE' THEN 'INACTIVE' ELSE v_eff END, 'Voucher không còn hiệu lực, không gửi email');
    END IF;
    IF NOT promo_setting_bool('promotion_email_enabled', true) THEN
        RETURN promo_ok(jsonb_build_object('skipped', true, 'reason', 'EMAIL_DISABLED'));
    END IF;

    -- Always send to the CURRENT email on the customer profile.
    SELECT NULLIF(trim(email), '') INTO v_to FROM "Customers" WHERE id = p.customer_id;
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
        'campaignDescription', c.description));
END;
$$;

-- Batch for the cron: pending ISSUE emails + due REMINDERs. SKIP LOCKED → no double send.
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
           AND p.email_attempts < 5 AND p.status = 'ACTIVE' AND p.valid_until > now()
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

CREATE OR REPLACE FUNCTION promo_mark_email_result(p_pass_id uuid, p_kind text, p_ok boolean, p_error text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF upper(p_kind) = 'ISSUE' THEN
        UPDATE "CustomerPromotionPasses" SET
            email_status = CASE WHEN p_ok THEN 'SENT' WHEN email_attempts + 1 >= 5 THEN 'FAILED' ELSE 'PENDING' END,
            email_attempts = email_attempts + 1,
            email_sent_at = CASE WHEN p_ok THEN now() ELSE email_sent_at END,
            email_last_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END,
            updated_at = now()
         WHERE id = p_pass_id;
    ELSE
        UPDATE "CustomerPromotionPasses" SET
            reminder_status = CASE WHEN p_ok THEN 'SENT' ELSE 'FAILED' END,
            reminder_attempts = reminder_attempts + 1,
            reminder_sent_at = CASE WHEN p_ok THEN now() ELSE reminder_sent_at END,
            email_last_error = CASE WHEN p_ok THEN email_last_error ELSE left(p_error, 500) END,
            updated_at = now()
         WHERE id = p_pass_id;
    END IF;
    RETURN promo_ok(promo_pass_json(p_pass_id, false));
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Grants — service_role only (re-run for new/changed functions)
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
