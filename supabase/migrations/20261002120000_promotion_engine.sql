-- =============================================================================
-- Promotion Engine — campaigns, customer passes (E-Voucher), usage history.
-- Plan: plans/plan_promotion_engine_backend.md
--
-- Single source of truth: every business rule lives in the promo_* functions
-- below. TS (lib/services/PromotionEngineService.ts) and wrb-noi-bo only call
-- them. Reason: bookings reach DONE from >10 TS writers AND from pg_cron SQL
-- (auto_complete_unrated_feedback), so issuing must hang off a DB trigger.
--
-- Benefit is attached to an order as a BookingItem of an engine-owned
-- promotion service (Services.id = 'KM####', is_promotion = true):
--   FREE_MINUTES      -> price 0, duration N, dispatched like an add-on (KTV is paid)
--   PERCENT_DISCOUNT  -> utility line, negative price, totalAmount reduced
--   FIXED_DISCOUNT    -> utility line, negative price, totalAmount reduced
-- Paid items are never mutated.
--
-- Depends on: jsonb_unwrap_string() (20260914120000), pgcrypto (extensions).
-- All functions: SECURITY DEFINER, execute granted to service_role only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Services tag
-- -----------------------------------------------------------------------------
ALTER TABLE "Services" ADD COLUMN IF NOT EXISTS is_promotion boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN "Services".is_promotion IS
    'Engine-owned promotion service (id KM####). Excluded from qualifying minutes and from service pickers.';

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PromotionCampaigns" (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_code           text NOT NULL UNIQUE,
    name                    text NOT NULL,
    description             text,
    benefit_type            text NOT NULL,
    benefit_value           numeric NOT NULL,
    benefit_config          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- maxDiscountAmount, discountScope
    benefit_service_id      text REFERENCES "Services"(id),
    valid_from              timestamptz NOT NULL,
    valid_until             timestamptz NOT NULL,
    usage_type              text NOT NULL DEFAULT 'UNLIMITED',
    usage_limit             integer,                               -- per pass, LIMITED only
    max_usage_per_customer  integer,
    max_usage_per_order     integer NOT NULL DEFAULT 1,
    qualification_type      text NOT NULL DEFAULT 'MANUAL_ASSIGNMENT',
    qualification_value     numeric,
    qualification_config    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- serviceIdPrefixes, serviceCategories, serviceIds
    assignment_mode         text NOT NULL DEFAULT 'MANUAL_ONLY',
    one_pass_per_customer   boolean NOT NULL DEFAULT true,
    voucher_prefix          text NOT NULL DEFAULT 'KM',
    status                  text NOT NULL DEFAULT 'DRAFT',
    created_by              text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promo_campaign_benefit_type_chk CHECK (benefit_type IN ('FREE_MINUTES','PERCENT_DISCOUNT','FIXED_DISCOUNT','FREE_SERVICE','FREE_UPGRADE')),
    CONSTRAINT promo_campaign_usage_type_chk CHECK (usage_type IN ('ONE_TIME','LIMITED','UNLIMITED')),
    CONSTRAINT promo_campaign_qualification_chk CHECK (qualification_type IN ('MIN_PAID_DURATION','MIN_ORDER_AMOUNT','SPECIFIC_SERVICE','MANUAL_ASSIGNMENT','CUSTOM')),
    CONSTRAINT promo_campaign_assignment_chk CHECK (assignment_mode IN ('AUTO','SPECIFIC_CUSTOMER','CUSTOMER_GROUP','MANUAL_ONLY')),
    CONSTRAINT promo_campaign_status_chk CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','ENDED')),
    CONSTRAINT promo_campaign_window_chk CHECK (valid_until > valid_from),
    CONSTRAINT promo_campaign_per_order_chk CHECK (max_usage_per_order >= 1),
    CONSTRAINT promo_campaign_per_customer_chk CHECK (max_usage_per_customer IS NULL OR max_usage_per_customer >= 1),
    CONSTRAINT promo_campaign_value_chk CHECK (benefit_value > 0),
    CONSTRAINT promo_campaign_percent_chk CHECK (benefit_type <> 'PERCENT_DISCOUNT' OR benefit_value <= 100),
    CONSTRAINT promo_campaign_minutes_int_chk CHECK (benefit_type <> 'FREE_MINUTES' OR benefit_value = trunc(benefit_value)),
    CONSTRAINT promo_campaign_limited_chk CHECK (usage_type <> 'LIMITED' OR (usage_limit IS NOT NULL AND usage_limit >= 1)),
    CONSTRAINT promo_campaign_prefix_chk CHECK (voucher_prefix ~ '^[A-Z0-9]{2,10}$')
);

CREATE TABLE IF NOT EXISTS "CustomerPromotionPasses" (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id             uuid NOT NULL REFERENCES "PromotionCampaigns"(id),
    customer_id             text NOT NULL REFERENCES "Customers"(id),
    voucher_code            text NOT NULL UNIQUE,
    qr_token                text NOT NULL UNIQUE,
    status                  text NOT NULL DEFAULT 'ACTIVE',
    benefit_type            text NOT NULL,
    benefit_value           numeric NOT NULL,
    usage_type              text NOT NULL,
    usage_limit             integer,
    valid_from              timestamptz NOT NULL,
    valid_until             timestamptz NOT NULL,
    one_pass_per_customer   boolean NOT NULL DEFAULT true,
    source_booking_id       text REFERENCES "Bookings"(id),
    issue_source            text NOT NULL,
    issued_at               timestamptz NOT NULL DEFAULT now(),
    issued_by               text,
    status_reason           text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promo_pass_status_chk CHECK (status IN ('ACTIVE','EXPIRED','SUSPENDED','CANCELLED')),
    CONSTRAINT promo_pass_issue_source_chk CHECK (issue_source IN ('AUTO','MANUAL'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_pass_customer_campaign
    ON "CustomerPromotionPasses"(customer_id, campaign_id) WHERE one_pass_per_customer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_pass_source_booking
    ON "CustomerPromotionPasses"(source_booking_id, campaign_id) WHERE source_booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promo_pass_customer ON "CustomerPromotionPasses"(customer_id);

CREATE TABLE IF NOT EXISTS "PromotionUsages" (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_pass_id       uuid NOT NULL REFERENCES "CustomerPromotionPasses"(id),
    campaign_id             uuid NOT NULL REFERENCES "PromotionCampaigns"(id),
    customer_id             text NOT NULL,
    booking_id              text NOT NULL REFERENCES "Bookings"(id),
    booking_item_id         text,
    benefit_type            text NOT NULL,
    benefit_value           numeric NOT NULL,
    applied_minutes         integer NOT NULL DEFAULT 0,
    discount_amount         numeric NOT NULL DEFAULT 0,
    staff_id                text,
    status                  text NOT NULL DEFAULT 'APPLIED',
    applied_at              timestamptz NOT NULL DEFAULT now(),
    completed_at            timestamptz,
    cancelled_at            timestamptz,
    cancel_reason           text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promo_usage_status_chk CHECK (status IN ('APPLIED','COMPLETED','CANCELLED'))
);
-- max_usage_per_order = 1 enforced by the DB; >1 is counted under the pass lock.
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_usage_pass_booking_live
    ON "PromotionUsages"(promotion_pass_id, booking_id) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_promo_usage_booking ON "PromotionUsages"(booking_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_pass ON "PromotionUsages"(promotion_pass_id);

CREATE TABLE IF NOT EXISTS "PromotionIssueErrors" (
    id          bigserial PRIMARY KEY,
    booking_id  text,
    stage       text,
    error       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "PromotionCampaigns"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPromotionPasses"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromotionUsages"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromotionIssueErrors"     ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only. qr_token must never reach anon/authenticated.
REVOKE ALL ON "PromotionCampaigns", "CustomerPromotionPasses", "PromotionUsages", "PromotionIssueErrors"
    FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Small helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_err(p_code text, p_message text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object('success', false, 'error', jsonb_build_object('code', p_code, 'message', p_message)) || p_extra;
$$;

CREATE OR REPLACE FUNCTION promo_ok(p_data jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object('success', true, 'data', p_data);
$$;

-- Unambiguous alphabet (no 0/O/1/I/L/U).
CREATE OR REPLACE FUNCTION promo_random_code(p_len int)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public, extensions AS $$
DECLARE
    v_alpha constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
    v_bytes bytea := gen_random_bytes(p_len);
    v_out   text := '';
BEGIN
    FOR i IN 0 .. p_len - 1 LOOP
        v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) % length(v_alpha)) + 1, 1);
    END LOOP;
    RETURN v_out;
END;
$$;

-- 256-bit opaque token, base64url. Carries no customer data.
CREATE OR REPLACE FUNCTION promo_random_token()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public, extensions AS $$
    SELECT rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
$$;

CREATE OR REPLACE FUNCTION promo_iso(p timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p IS NULL THEN NULL
                ELSE to_char(p AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' END;
$$;

-- Minutes of one booking item: vipDuration -> options.duration -> Services.duration, x quantity.
CREATE OR REPLACE FUNCTION promo_item_minutes(p_options jsonb, p_service_duration integer, p_quantity integer)
RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_opt jsonb := COALESCE(jsonb_unwrap_string(p_options), '{}'::jsonb);
    v_min numeric;
BEGIN
    IF jsonb_typeof(v_opt) <> 'object' THEN v_opt := '{}'::jsonb; END IF;
    BEGIN
        v_min := COALESCE(NULLIF(v_opt->>'vipDuration', '')::numeric,
                          NULLIF(v_opt->>'duration', '')::numeric,
                          p_service_duration, 0);
    EXCEPTION WHEN OTHERS THEN
        v_min := COALESCE(p_service_duration, 0);
    END;
    RETURN GREATEST(0, round(v_min * GREATEST(COALESCE(p_quantity, 1), 1)))::integer;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Qualification — the ONE formula for "paid qualifying minutes"
-- -----------------------------------------------------------------------------
-- Counts an item when ALL hold:
--   not CANCELLED; not utility; not a promotion service / promotion item;
--   not a display-only merged child (options.mergedIntoId);
--   not an unpaid add-on (options.isPaid = false);
--   matches config.serviceIds / serviceIdPrefixes / serviceCategories (empty config = any service).
-- SPLIT parents count 0 (their children are the real orders).
CREATE OR REPLACE FUNCTION promo_order_minutes(p_booking_id text, p_config jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_status    text;
    v_cfg       jsonb := COALESCE(p_config, '{}'::jsonb);
    v_ids       text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_cfg->'serviceIds', '[]'::jsonb)));
    v_prefixes  text[] := ARRAY(SELECT upper(jsonb_array_elements_text(COALESCE(v_cfg->'serviceIdPrefixes', '[]'::jsonb))));
    v_cats      text[] := ARRAY(SELECT upper(jsonb_array_elements_text(COALESCE(v_cfg->'serviceCategories', '[]'::jsonb))));
    v_filtered  boolean;
    v_paid      integer := 0;
    v_qual      integer := 0;
    v_promo     integer := 0;
    v_amount    numeric := 0;
    v_qual_amt  numeric := 0;
    r           record;
    v_opt       jsonb;
    v_min       integer;
    v_matches   boolean;
BEGIN
    SELECT status::text INTO v_status FROM "Bookings" WHERE id = p_booking_id;
    IF v_status IS NULL OR v_status = 'SPLIT' THEN
        RETURN jsonb_build_object('paidMinutes', 0, 'qualifyingMinutes', 0, 'promotionMinutes', 0,
                                  'totalMinutes', 0, 'paidAmount', 0, 'qualifyingAmount', 0);
    END IF;
    v_filtered := cardinality(v_ids) > 0 OR cardinality(v_prefixes) > 0 OR cardinality(v_cats) > 0;

    FOR r IN
        SELECT bi."serviceId" AS service_id, bi.status, bi.options, bi.quantity, bi.price,
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

        v_paid := v_paid + v_min;
        v_amount := v_amount + COALESCE(r.price, 0) * GREATEST(COALESCE(r.quantity, 1), 1);

        v_matches := NOT v_filtered
            OR r.service_id = ANY (v_ids)
            OR upper(COALESCE(r.category, '')) = ANY (v_cats)
            OR EXISTS (SELECT 1 FROM unnest(v_prefixes) p WHERE upper(COALESCE(r.service_id, '')) LIKE p || '%');
        IF v_matches THEN
            v_qual := v_qual + v_min;
            v_qual_amt := v_qual_amt + COALESCE(r.price, 0) * GREATEST(COALESCE(r.quantity, 1), 1);
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'paidMinutes', v_paid,
        'qualifyingMinutes', v_qual,
        'promotionMinutes', v_promo,
        'totalMinutes', v_paid + v_promo,
        'paidAmount', v_amount,
        'qualifyingAmount', v_qual_amt
    );
END;
$$;

-- Does a booking qualify for a campaign? Returns {eligible, reason, ...minutes}.
CREATE OR REPLACE FUNCTION promo_evaluate_booking_for_campaign(p_booking_id text, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c   "PromotionCampaigns"%ROWTYPE;
    m   jsonb;
    v_ok boolean;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('eligible', false, 'reason', 'CAMPAIGN_NOT_FOUND'); END IF;
    m := promo_order_minutes(p_booking_id, c.qualification_config);

    v_ok := CASE c.qualification_type
        WHEN 'MIN_PAID_DURATION' THEN (m->>'qualifyingMinutes')::numeric >= COALESCE(c.qualification_value, 0)
                                      AND (m->>'qualifyingMinutes')::numeric > 0
        WHEN 'MIN_ORDER_AMOUNT'  THEN (m->>'qualifyingAmount')::numeric >= COALESCE(c.qualification_value, 0)
                                      AND (m->>'qualifyingMinutes')::numeric > 0
        WHEN 'SPECIFIC_SERVICE'  THEN (m->>'qualifyingMinutes')::numeric > 0
        ELSE false   -- MANUAL_ASSIGNMENT / CUSTOM never auto-qualify
    END;
    RETURN m || jsonb_build_object('eligible', v_ok,
        'reason', CASE WHEN v_ok THEN NULL ELSE 'ORDER_NOT_ELIGIBLE' END,
        'qualificationType', c.qualification_type,
        'qualificationValue', c.qualification_value);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Effective status + JSON shapes (stable API contract)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_pass_effective_status(p_pass "CustomerPromotionPasses", p_campaign_status text)
RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN p_pass.status IN ('CANCELLED', 'SUSPENDED', 'EXPIRED') THEN p_pass.status
        WHEN p_campaign_status = 'ENDED' OR now() > p_pass.valid_until THEN 'EXPIRED'
        WHEN p_campaign_status <> 'ACTIVE' THEN 'INACTIVE'
        WHEN now() < p_pass.valid_from THEN 'NOT_STARTED'
        ELSE 'ACTIVE'
    END;
$$;

CREATE OR REPLACE FUNCTION promo_pass_json(p_pass_id uuid, p_include_token boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p   "CustomerPromotionPasses"%ROWTYPE;
    c   "PromotionCampaigns"%ROWTYPE;
    v_name   text;
    v_used   integer;
    v_last   timestamptz;
    v_eff    text;
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p.campaign_id;
    SELECT "fullName" INTO v_name FROM "Customers" WHERE id = p.customer_id;
    SELECT count(*), max(applied_at) INTO v_used, v_last
      FROM "PromotionUsages" WHERE promotion_pass_id = p.id AND status <> 'CANCELLED';
    v_eff := promo_pass_effective_status(p, c.status);

    RETURN jsonb_build_object(
        'id', p.id,
        'voucherCode', p.voucher_code,
        'qrToken', CASE WHEN p_include_token AND v_eff IN ('ACTIVE', 'NOT_STARTED') THEN p.qr_token END,
        'status', p.status,
        'effectiveStatus', v_eff,
        'campaign', jsonb_build_object('id', c.id, 'code', c.campaign_code, 'name', c.name, 'status', c.status),
        'customer', jsonb_build_object('id', p.customer_id, 'name', v_name),
        'benefit', jsonb_build_object('type', p.benefit_type, 'value', p.benefit_value,
                                      'serviceId', c.benefit_service_id),
        'usage', jsonb_build_object('type', p.usage_type, 'limit', p.usage_limit, 'usedCount', v_used,
                                    'maxPerOrder', c.max_usage_per_order, 'lastUsedAt', promo_iso(v_last)),
        'validFrom', promo_iso(p.valid_from),
        'validUntil', promo_iso(p.valid_until),
        'issueSource', p.issue_source,
        'sourceBookingId', p.source_booking_id,
        'issuedAt', promo_iso(p.issued_at),
        'issuedBy', p.issued_by
    );
END;
$$;

CREATE OR REPLACE FUNCTION promo_campaign_json(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id', c.id, 'campaignCode', c.campaign_code, 'name', c.name, 'description', c.description,
        'benefitType', c.benefit_type, 'benefitValue', c.benefit_value, 'benefitConfig', c.benefit_config,
        'benefitServiceId', c.benefit_service_id,
        'validFrom', promo_iso(c.valid_from), 'validUntil', promo_iso(c.valid_until),
        'usageType', c.usage_type, 'usageLimit', c.usage_limit,
        'maxUsagePerCustomer', c.max_usage_per_customer, 'maxUsagePerOrder', c.max_usage_per_order,
        'qualificationType', c.qualification_type, 'qualificationValue', c.qualification_value,
        'qualificationConfig', c.qualification_config,
        'assignmentMode', c.assignment_mode, 'onePassPerCustomer', c.one_pass_per_customer,
        'voucherPrefix', c.voucher_prefix, 'status', c.status,
        'passCount', (SELECT count(*) FROM "CustomerPromotionPasses" p WHERE p.campaign_id = c.id),
        'usageCount', (SELECT count(*) FROM "PromotionUsages" u WHERE u.campaign_id = c.id AND u.status <> 'CANCELLED'),
        'createdBy', c.created_by, 'createdAt', promo_iso(c.created_at), 'updatedAt', promo_iso(c.updated_at))
    FROM "PromotionCampaigns" c WHERE c.id = p_campaign_id;
$$;

-- -----------------------------------------------------------------------------
-- 5. Campaign admin
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_default_service_names(p_type text, p_value numeric)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_type
        WHEN 'FREE_MINUTES'     THEN ARRAY['Khuyến mãi +' || p_value::int || ' phút', 'Promotion +' || p_value::int || ' mins']
        WHEN 'PERCENT_DISCOUNT' THEN ARRAY['Khuyến mãi giảm ' || trim_scale(p_value) || '%', 'Promotion ' || trim_scale(p_value) || '% off']
        WHEN 'FIXED_DISCOUNT'   THEN ARRAY['Khuyến mãi giảm ' || to_char(p_value, 'FM999G999G999') || 'đ', 'Promotion ' || to_char(p_value, 'FM999G999G999') || ' VND off']
        ELSE ARRAY['Khuyến mãi', 'Promotion']
    END;
$$;

-- Creates/updates the engine-owned KM#### service that represents the benefit.
CREATE OR REPLACE FUNCTION promo_sync_benefit_service(p_campaign_id uuid, p_name_vn text DEFAULT NULL, p_name_en text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c        "PromotionCampaigns"%ROWTYPE;
    v_id     text;
    v_names  text[];
    v_util   boolean;
    v_dur    integer;
    v_next   integer;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id FOR UPDATE;
    v_names := promo_default_service_names(c.benefit_type, c.benefit_value);
    v_util  := c.benefit_type IN ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT');
    v_dur   := CASE WHEN c.benefit_type = 'FREE_MINUTES' THEN c.benefit_value::int ELSE 0 END;

    IF c.benefit_service_id IS NOT NULL THEN
        UPDATE "Services" SET
            "nameVN" = COALESCE(p_name_vn, "nameVN"),
            "nameEN" = COALESCE(p_name_en, "nameEN"),
            duration = v_dur,
            is_utility = v_util
        WHERE id = c.benefit_service_id;
        RETURN c.benefit_service_id;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('promo_benefit_service_id'));
    SELECT COALESCE(max(substring(id FROM '^KM([0-9]+)$')::int), 0) + 1 INTO v_next
      FROM "Services" WHERE id ~ '^KM[0-9]+$';
    v_id := 'KM' || lpad(v_next::text, 4, '0');

    INSERT INTO "Services" (id, code, "nameVN", "nameEN", "priceVND", "priceUSD", duration, category,
                            "isActive", is_utility, is_promotion, service_group, min_ktv_required,
                            description, tags)
    VALUES (v_id, v_id, COALESCE(p_name_vn, v_names[1]), COALESCE(p_name_en, v_names[2]), 0, 0, v_dur, 'PROMOTION',
            true, v_util, true, 'ADDON', CASE WHEN v_util THEN 0 ELSE 1 END,
            jsonb_build_object('vn', c.name, 'en', c.name),
            jsonb_build_array(jsonb_build_object('vn', 'Khuyến mãi', 'en', 'Promotion')));

    UPDATE "PromotionCampaigns" SET benefit_service_id = v_id, updated_at = now() WHERE id = c.id;
    RETURN v_id;
END;
$$;

-- p_payload keys (snake_case, validated again in TS with zod):
-- campaign_code, name, description, benefit_type, benefit_value, benefit_config, valid_from, valid_until,
-- usage_type, usage_limit, max_usage_per_customer, max_usage_per_order, qualification_type,
-- qualification_value, qualification_config, assignment_mode, one_pass_per_customer, voucher_prefix,
-- service_name_vn, service_name_en
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
        one_pass_per_customer, voucher_prefix, status, created_by)
    VALUES (
        upper(p_payload->>'campaign_code'),
        p_payload->>'name',
        p_payload->>'description',
        p_payload->>'benefit_type',
        (p_payload->>'benefit_value')::numeric,
        COALESCE(p_payload->'benefit_config', '{}'::jsonb),
        (p_payload->>'valid_from')::timestamptz,
        (p_payload->>'valid_until')::timestamptz,
        COALESCE(p_payload->>'usage_type', 'UNLIMITED'),
        NULLIF(p_payload->>'usage_limit', '')::int,
        NULLIF(p_payload->>'max_usage_per_customer', '')::int,
        COALESCE(NULLIF(p_payload->>'max_usage_per_order', '')::int, 1),
        COALESCE(p_payload->>'qualification_type', 'MANUAL_ASSIGNMENT'),
        NULLIF(p_payload->>'qualification_value', '')::numeric,
        COALESCE(p_payload->'qualification_config', '{}'::jsonb),
        COALESCE(p_payload->>'assignment_mode', 'MANUAL_ONLY'),
        COALESCE((p_payload->>'one_pass_per_customer')::boolean, true),
        upper(COALESCE(NULLIF(p_payload->>'voucher_prefix', ''), 'KM')),
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

-- Rule fields (benefit, qualification, usage) are editable only while DRAFT.
-- ACTIVE/INACTIVE may change name, description, valid_until.
CREATE OR REPLACE FUNCTION promo_update_campaign(p_campaign_id uuid, p_payload jsonb, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    v_rule_keys constant text[] := ARRAY['benefit_type','benefit_value','benefit_config','valid_from','usage_type',
        'usage_limit','max_usage_per_customer','max_usage_per_order','qualification_type','qualification_value',
        'qualification_config','assignment_mode','one_pass_per_customer','voucher_prefix','campaign_code'];
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình'); END IF;
    IF c.status = 'ENDED' THEN RETURN promo_err('CAMPAIGN_ENDED', 'Chương trình đã kết thúc'); END IF;
    IF c.status <> 'DRAFT' AND p_payload ?| v_rule_keys THEN
        RETURN promo_err('CAMPAIGN_LOCKED', 'Chỉ sửa được quy tắc khi chương trình còn ở trạng thái Nháp');
    END IF;
    IF p_payload->>'benefit_type' IN ('FREE_SERVICE', 'FREE_UPGRADE') THEN
        RETURN promo_err('BENEFIT_NOT_SUPPORTED', 'Loại ưu đãi này chưa được hỗ trợ');
    END IF;

    UPDATE "PromotionCampaigns" SET
        campaign_code          = COALESCE(upper(p_payload->>'campaign_code'), campaign_code),
        name                   = COALESCE(p_payload->>'name', name),
        description            = CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,
        benefit_type           = COALESCE(p_payload->>'benefit_type', benefit_type),
        benefit_value          = COALESCE((p_payload->>'benefit_value')::numeric, benefit_value),
        benefit_config         = COALESCE(p_payload->'benefit_config', benefit_config),
        valid_from             = COALESCE((p_payload->>'valid_from')::timestamptz, valid_from),
        valid_until            = COALESCE((p_payload->>'valid_until')::timestamptz, valid_until),
        usage_type             = COALESCE(p_payload->>'usage_type', usage_type),
        usage_limit            = CASE WHEN p_payload ? 'usage_limit' THEN NULLIF(p_payload->>'usage_limit', '')::int ELSE usage_limit END,
        max_usage_per_customer = CASE WHEN p_payload ? 'max_usage_per_customer' THEN NULLIF(p_payload->>'max_usage_per_customer', '')::int ELSE max_usage_per_customer END,
        max_usage_per_order    = COALESCE((p_payload->>'max_usage_per_order')::int, max_usage_per_order),
        qualification_type     = COALESCE(p_payload->>'qualification_type', qualification_type),
        qualification_value    = CASE WHEN p_payload ? 'qualification_value' THEN NULLIF(p_payload->>'qualification_value', '')::numeric ELSE qualification_value END,
        qualification_config   = COALESCE(p_payload->'qualification_config', qualification_config),
        assignment_mode        = COALESCE(p_payload->>'assignment_mode', assignment_mode),
        one_pass_per_customer  = COALESCE((p_payload->>'one_pass_per_customer')::boolean, one_pass_per_customer),
        voucher_prefix         = COALESCE(upper(NULLIF(p_payload->>'voucher_prefix', '')), voucher_prefix),
        updated_at             = now()
    WHERE id = p_campaign_id;

    -- Passes keep their own snapshot; only extend still-open passes when valid_until moves.
    IF p_payload ? 'valid_until' THEN
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

-- p_action: ACTIVATE | DEACTIVATE | END
CREATE OR REPLACE FUNCTION promo_set_campaign_status(p_campaign_id uuid, p_action text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    v_new text;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình'); END IF;
    IF c.status = 'ENDED' THEN RETURN promo_err('CAMPAIGN_ENDED', 'Chương trình đã kết thúc'); END IF;

    v_new := CASE upper(p_action) WHEN 'ACTIVATE' THEN 'ACTIVE' WHEN 'DEACTIVATE' THEN 'INACTIVE' WHEN 'END' THEN 'ENDED' END;
    IF v_new IS NULL THEN RETURN promo_err('INVALID_ACTION', 'Thao tác không hợp lệ'); END IF;
    IF v_new = 'ACTIVE' AND c.valid_until <= now() THEN
        RETURN promo_err('PROMOTION_EXPIRED', 'Chương trình đã quá hạn, không thể kích hoạt');
    END IF;
    IF v_new = 'ACTIVE' AND c.benefit_service_id IS NULL THEN
        PERFORM promo_sync_benefit_service(c.id);
    END IF;

    UPDATE "PromotionCampaigns" SET status = v_new, updated_at = now() WHERE id = c.id;
    RETURN promo_ok(promo_campaign_json(c.id));
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Issuing passes
-- -----------------------------------------------------------------------------
-- Inserts one pass. Idempotent: existing pass (same customer+campaign when
-- one_pass_per_customer, or same source booking) is returned with created=false.
CREATE OR REPLACE FUNCTION promo_insert_pass(p_campaign_id uuid, p_customer_id text, p_source_booking_id text,
                                             p_issue_source text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c        "PromotionCampaigns"%ROWTYPE;
    v_id     uuid;
    v_exist  uuid;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;

    FOR attempt IN 1 .. 6 LOOP
        INSERT INTO "CustomerPromotionPasses" (
            campaign_id, customer_id, voucher_code, qr_token, status, benefit_type, benefit_value,
            usage_type, usage_limit, valid_from, valid_until, one_pass_per_customer,
            source_booking_id, issue_source, issued_by)
        VALUES (
            c.id, p_customer_id, c.voucher_prefix || '-' || promo_random_code(6), promo_random_token(), 'ACTIVE',
            c.benefit_type, c.benefit_value,
            c.usage_type, CASE WHEN c.usage_type = 'ONE_TIME' THEN 1 ELSE c.usage_limit END,
            c.valid_from, c.valid_until, c.one_pass_per_customer,
            p_source_booking_id, p_issue_source, p_staff_id)
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
        -- else: voucher_code / qr_token collision -> retry with fresh randoms
    END LOOP;
    RAISE EXCEPTION 'promo_insert_pass: could not generate unique voucher code';
END;
$$;

-- Called by the Bookings trigger when an order reaches DONE.
CREATE OR REPLACE FUNCTION promo_issue_for_booking(p_booking_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_customer text;
    v_status   text;
    c          record;
    v_eval     jsonb;
    v_res      jsonb;
    v_out      jsonb := '[]'::jsonb;
BEGIN
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
            v_res := promo_insert_pass(c.id, v_customer, p_booking_id, 'AUTO', 'SYSTEM');
            v_out := v_out || jsonb_build_array(v_res || jsonb_build_object('campaignId', c.id));
        END IF;
    END LOOP;
    RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION promo_issue_manual(p_campaign_id uuid, p_customer_id text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c     "PromotionCampaigns"%ROWTYPE;
    v_res jsonb;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình'); END IF;
    IF c.status IN ('ENDED') OR c.valid_until <= now() THEN
        RETURN promo_err('PROMOTION_EXPIRED', 'Chương trình đã kết thúc');
    END IF;
    IF c.status <> 'ACTIVE' THEN RETURN promo_err('PROMOTION_INACTIVE', 'Chương trình chưa kích hoạt'); END IF;
    IF NOT EXISTS (SELECT 1 FROM "Customers" WHERE id = p_customer_id) THEN
        RETURN promo_err('CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng');
    END IF;

    -- Manual issue never has a source booking; dedupe only via one_pass_per_customer.
    v_res := promo_insert_pass(c.id, p_customer_id, NULL, 'MANUAL', p_staff_id);
    IF NOT (v_res->>'created')::boolean THEN
        RETURN promo_err('PASS_ALREADY_EXISTS', 'Khách đã có voucher của chương trình này',
                         jsonb_build_object('data', promo_pass_json((v_res->>'passId')::uuid, true)));
    END IF;
    RETURN promo_ok(promo_pass_json((v_res->>'passId')::uuid, true));
END;
$$;

-- p_action: SUSPEND | REACTIVATE | CANCEL
CREATE OR REPLACE FUNCTION promo_set_pass_status(p_pass_id uuid, p_action text, p_reason text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p "CustomerPromotionPasses"%ROWTYPE;
    v_new text;
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('PROMOTION_NOT_FOUND', 'Không tìm thấy voucher'); END IF;
    IF p.status = 'CANCELLED' THEN RETURN promo_err('PROMOTION_CANCELLED', 'Voucher đã bị huỷ'); END IF;
    v_new := CASE upper(p_action) WHEN 'SUSPEND' THEN 'SUSPENDED' WHEN 'REACTIVATE' THEN 'ACTIVE' WHEN 'CANCEL' THEN 'CANCELLED' END;
    IF v_new IS NULL THEN RETURN promo_err('INVALID_ACTION', 'Thao tác không hợp lệ'); END IF;
    IF v_new = 'ACTIVE' AND p.valid_until <= now() THEN
        RETURN promo_err('PROMOTION_EXPIRED', 'Voucher đã hết hạn');
    END IF;
    UPDATE "CustomerPromotionPasses"
       SET status = v_new, status_reason = COALESCE(p_reason, upper(p_action) || ' by ' || COALESCE(p_staff_id, '?')), updated_at = now()
     WHERE id = p.id;
    RETURN promo_ok(promo_pass_json(p.id, true));
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Apply / cancel
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_apply_pass(p_pass_id uuid, p_booking_id text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p           "CustomerPromotionPasses"%ROWTYPE;
    c           "PromotionCampaigns"%ROWTYPE;
    b           record;
    v_svc       record;
    v_used_pass integer;
    v_used_order integer;
    v_used_cust integer;
    v_guest     text;
    v_room      text;
    v_bed       text;
    v_item_id   text;
    v_usage_id  uuid := gen_random_uuid();
    v_minutes   integer := 0;
    v_discount  numeric := 0;
    v_base      numeric;
    v_cap       numeric;
    v_mins      jsonb;
    v_now_utc   timestamp := (now() AT TIME ZONE 'UTC');   -- Bookings."updatedAt" is UTC (same as cron RPCs)
BEGIN
    -- Lock order: pass -> booking. Serialises concurrent applies of the same pass.
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('PROMOTION_NOT_FOUND', 'Không tìm thấy voucher'); END IF;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p.campaign_id;

    IF p.status = 'CANCELLED' THEN RETURN promo_err('PROMOTION_CANCELLED', 'Voucher đã bị huỷ'); END IF;
    IF p.status = 'SUSPENDED' THEN RETURN promo_err('PROMOTION_SUSPENDED', 'Voucher đang bị tạm khoá'); END IF;
    IF p.status = 'EXPIRED' OR c.status = 'ENDED' OR now() > p.valid_until OR now() > c.valid_until THEN
        RETURN promo_err('PROMOTION_EXPIRED', 'Voucher đã hết hạn');
    END IF;
    IF c.status <> 'ACTIVE' THEN RETURN promo_err('PROMOTION_INACTIVE', 'Chương trình khuyến mãi đang tạm dừng'); END IF;
    IF now() < p.valid_from OR now() < c.valid_from THEN
        RETURN promo_err('PROMOTION_NOT_STARTED', 'Voucher chưa đến thời gian áp dụng');
    END IF;
    IF p.benefit_type NOT IN ('FREE_MINUTES', 'PERCENT_DISCOUNT', 'FIXED_DISCOUNT') THEN
        RETURN promo_err('BENEFIT_NOT_SUPPORTED', 'Loại ưu đãi này chưa được hỗ trợ');
    END IF;

    SELECT id, status::text AS status, "customerId" AS customer_id, "totalAmount" AS total_amount
      INTO b FROM "Bookings" WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng'); END IF;
    IF b.customer_id IS DISTINCT FROM p.customer_id THEN
        RETURN promo_err('ORDER_CUSTOMER_MISMATCH', 'Đơn hàng không thuộc khách hàng của voucher');
    END IF;
    IF b.status NOT IN ('NEW', 'PREPARING', 'IN_PROGRESS') THEN
        RETURN promo_err('ORDER_NOT_ACTIVE', 'Đơn hàng không còn ở trạng thái áp dụng được');
    END IF;

    SELECT count(*) FILTER (WHERE TRUE), count(*) FILTER (WHERE booking_id = p_booking_id)
      INTO v_used_pass, v_used_order
      FROM "PromotionUsages" WHERE promotion_pass_id = p.id AND status <> 'CANCELLED';
    IF v_used_order >= c.max_usage_per_order THEN
        RETURN promo_err('PROMOTION_ALREADY_APPLIED', 'Voucher đã được áp dụng cho đơn này');
    END IF;
    IF p.usage_type IN ('ONE_TIME', 'LIMITED') AND v_used_pass >= COALESCE(p.usage_limit, 1) THEN
        RETURN promo_err('PROMOTION_USAGE_LIMIT_REACHED', 'Voucher đã hết lượt sử dụng');
    END IF;
    IF c.max_usage_per_customer IS NOT NULL THEN
        SELECT count(*) INTO v_used_cust FROM "PromotionUsages"
         WHERE campaign_id = c.id AND customer_id = p.customer_id AND status <> 'CANCELLED';
        IF v_used_cust >= c.max_usage_per_customer THEN
            RETURN promo_err('PROMOTION_USAGE_LIMIT_REACHED', 'Khách đã dùng hết lượt của chương trình');
        END IF;
    END IF;

    SELECT * INTO v_svc FROM "Services" WHERE id = c.benefit_service_id;
    IF NOT FOUND THEN RETURN promo_err('BENEFIT_NOT_SUPPORTED', 'Chương trình chưa có dịch vụ khuyến mãi'); END IF;

    -- Attach to the guest/room of the first real (non-utility, non-promo) item.
    SELECT bi.guest_id, bi."roomName", bi."bedId" INTO v_guest, v_room, v_bed
      FROM "BookingItems" bi LEFT JOIN "Services" s ON s.id = bi."serviceId"
     WHERE bi."bookingId" = p_booking_id AND COALESCE(bi.status, '') <> 'CANCELLED'
       AND NOT COALESCE(s.is_utility, false) AND NOT COALESCE(s.is_promotion, false)
       AND COALESCE(bi."serviceId", '') <> 'NHS0900'
     ORDER BY (bi.status = 'IN_PROGRESS') DESC, bi.id
     LIMIT 1;
    IF NOT FOUND THEN RETURN promo_err('ORDER_NOT_ELIGIBLE', 'Đơn chưa có dịch vụ để áp dụng khuyến mãi'); END IF;

    v_mins := promo_order_minutes(p_booking_id, '{}'::jsonb);
    IF p.benefit_type = 'FREE_MINUTES' THEN
        v_minutes := p.benefit_value::int;
    ELSE
        v_base := CASE WHEN c.benefit_config->>'discountScope' = 'QUALIFYING_ITEMS'
                       THEN (promo_order_minutes(p_booking_id, c.qualification_config)->>'qualifyingAmount')::numeric
                       ELSE (v_mins->>'paidAmount')::numeric END;
        v_discount := CASE WHEN p.benefit_type = 'PERCENT_DISCOUNT'
                           THEN round(v_base * p.benefit_value / 100)
                           ELSE p.benefit_value END;
        v_cap := NULLIF(c.benefit_config->>'maxDiscountAmount', '')::numeric;
        IF v_cap IS NOT NULL THEN v_discount := LEAST(v_discount, v_cap); END IF;
        v_discount := LEAST(v_discount, GREATEST(COALESCE(b.total_amount, 0), 0));
        IF v_discount <= 0 THEN RETURN promo_err('ORDER_NOT_ELIGIBLE', 'Đơn chưa có giá trị để giảm'); END IF;
    END IF;

    v_item_id := p_booking_id || '-promo-' || replace(v_usage_id::text, '-', '');

    BEGIN
        INSERT INTO "PromotionUsages" (id, promotion_pass_id, campaign_id, customer_id, booking_id, booking_item_id,
                                       benefit_type, benefit_value, applied_minutes, discount_amount, staff_id, status)
        VALUES (v_usage_id, p.id, c.id, p.customer_id, p_booking_id, v_item_id,
                p.benefit_type, p.benefit_value, v_minutes, v_discount, p_staff_id, 'APPLIED');
    EXCEPTION WHEN unique_violation THEN
        RETURN promo_err('PROMOTION_ALREADY_APPLIED', 'Voucher đã được áp dụng cho đơn này');
    END;

    -- FREE_MINUTES: a 0đ add-on waiting for dispatch (KTV paid via the normal flow).
    -- Discounts: a utility ledger line with negative price; utility items are
    -- skipped by every booking-status recompute, so status DONE is inert.
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

    IF v_discount > 0 THEN
        UPDATE "Bookings" SET "totalAmount" = GREATEST(0, COALESCE("totalAmount", 0) - v_discount), "updatedAt" = v_now_utc
         WHERE id = p_booking_id;
    ELSE
        UPDATE "Bookings" SET "updatedAt" = v_now_utc WHERE id = p_booking_id;
    END IF;

    RETURN promo_ok(jsonb_build_object(
        'usageId', v_usage_id,
        'bookingId', p_booking_id,
        'bookingItemId', v_item_id,
        'benefit', jsonb_build_object('type', p.benefit_type, 'value', p.benefit_value, 'serviceId', v_svc.id),
        'appliedMinutes', v_minutes,
        'discountAmount', v_discount,
        'order', promo_order_minutes(p_booking_id, '{}'::jsonb),
        'pass', promo_pass_json(p.id, false)));
END;
$$;

-- Internal: mark usage cancelled (no item changes). Idempotent.
CREATE OR REPLACE FUNCTION promo_mark_usage_cancelled(p_usage_id uuid, p_reason text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE "PromotionUsages" SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = p_reason, updated_at = now()
     WHERE id = p_usage_id AND status = 'APPLIED';
$$;

-- Reception cancels an applied promotion. Only while the promo item has not started.
CREATE OR REPLACE FUNCTION promo_cancel_usage(p_usage_id uuid, p_staff_id text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    u  "PromotionUsages"%ROWTYPE;
    i  record;
    v_now_utc timestamp := (now() AT TIME ZONE 'UTC');
BEGIN
    SELECT * INTO u FROM "PromotionUsages" WHERE id = p_usage_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('USAGE_NOT_FOUND', 'Không tìm thấy lượt áp dụng'); END IF;
    IF u.status = 'CANCELLED' THEN RETURN promo_ok(jsonb_build_object('usageId', u.id, 'status', 'CANCELLED')); END IF;
    IF u.status = 'COMPLETED' THEN RETURN promo_err('USAGE_COMPLETED', 'Đơn đã hoàn tất, không thể huỷ khuyến mãi'); END IF;

    PERFORM 1 FROM "Bookings" WHERE id = u.booking_id FOR UPDATE;
    SELECT id, status, price, quantity, "technicianCodes" AS techs INTO i
      FROM "BookingItems" WHERE id = u.booking_item_id FOR UPDATE;

    IF FOUND AND u.benefit_type = 'FREE_MINUTES' AND i.status <> 'CANCELLED'
       AND (i.status NOT IN ('WAITING', 'NEW') OR COALESCE(cardinality(i.techs), 0) > 0) THEN
        RETURN promo_err('PROMOTION_ITEM_IN_SERVICE',
            'Dịch vụ khuyến mãi đã được điều phối — huỷ dịch vụ đó ở màn Điều phối');
    END IF;

    UPDATE "PromotionUsages" SET status = 'CANCELLED', cancelled_at = now(),
           cancel_reason = COALESCE(p_reason, 'Cancelled by ' || COALESCE(p_staff_id, '?')), updated_at = now()
     WHERE id = u.id;

    IF FOUND AND i.status <> 'CANCELLED' THEN
        UPDATE "BookingItems" SET status = 'CANCELLED' WHERE id = i.id;
        IF COALESCE(i.price, 0) < 0 THEN
            UPDATE "Bookings" SET "totalAmount" = COALESCE("totalAmount", 0) - (i.price * COALESCE(i.quantity, 1)),
                   "updatedAt" = v_now_utc
             WHERE id = u.booking_id;
        END IF;
    END IF;
    RETURN promo_ok(jsonb_build_object('usageId', u.id, 'status', 'CANCELLED'));
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Read models
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_lookup_pass(p_qr_token text DEFAULT NULL, p_voucher_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NULLIF(trim(p_qr_token), '') IS NOT NULL THEN
        SELECT id INTO v_id FROM "CustomerPromotionPasses" WHERE qr_token = trim(p_qr_token);
    ELSIF NULLIF(trim(p_voucher_code), '') IS NOT NULL THEN
        SELECT id INTO v_id FROM "CustomerPromotionPasses" WHERE voucher_code = upper(trim(p_voucher_code));
    END IF;
    IF v_id IS NULL THEN RETURN promo_err('PROMOTION_NOT_FOUND', 'Mã voucher không hợp lệ'); END IF;
    RETURN promo_ok(promo_pass_json(v_id, false));
END;
$$;

CREATE OR REPLACE FUNCTION promo_list_campaigns(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT promo_ok(COALESCE(jsonb_agg(promo_campaign_json(id) ORDER BY created_at DESC), '[]'::jsonb))
    FROM "PromotionCampaigns" WHERE p_status IS NULL OR status = p_status;
$$;

CREATE OR REPLACE FUNCTION promo_list_passes(p_campaign_id uuid, p_limit int DEFAULT 200, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT promo_ok(jsonb_build_object(
        'total', (SELECT count(*) FROM "CustomerPromotionPasses" WHERE campaign_id = p_campaign_id),
        'items', COALESCE((SELECT jsonb_agg(promo_pass_json(id, true) ORDER BY issued_at DESC)
                             FROM (SELECT id, issued_at FROM "CustomerPromotionPasses"
                                    WHERE campaign_id = p_campaign_id
                                    ORDER BY issued_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 500) OFFSET GREATEST(p_offset, 0)) t),
                          '[]'::jsonb)));
$$;

-- Active orders (NEW / PREPARING / IN_PROGRESS) of the pass owner, today first.
CREATE OR REPLACE FUNCTION promo_active_orders_for_pass(p_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_customer text;
    v_today    date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
    v_rows     jsonb;
BEGIN
    SELECT customer_id INTO v_customer FROM "CustomerPromotionPasses" WHERE id = p_pass_id;
    IF v_customer IS NULL THEN RETURN promo_err('PROMOTION_NOT_FOUND', 'Không tìm thấy voucher'); END IF;

    SELECT COALESCE(jsonb_agg(row_json ORDER BY is_today DESC, booking_date DESC), '[]'::jsonb) INTO v_rows
    FROM (
        -- createdAt is UTC; bookingDate is stored VN-local by reception but UTC by some
        -- web writers, so "today" accepts either and bookingDate is returned as stored.
        SELECT ((b."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today
                OR b."bookingDate"::date = v_today) AS is_today,
               b."createdAt" AS booking_date,
               jsonb_build_object(
                   'id', b.id,
                   'billCode', b."billCode",
                   'status', b.status::text,
                   'customerName', b."customerName",
                   'isToday', ((b."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_today
                               OR b."bookingDate"::date = v_today),
                   'timeBooking', b."timeBooking",
                   'bookingDate', to_char(b."bookingDate", 'YYYY-MM-DD"T"HH24:MI:SS'),
                   'createdAt', promo_iso(b."createdAt" AT TIME ZONE 'UTC'),
                   'totalAmount', b."totalAmount",
                   'services', COALESCE((
                       SELECT jsonb_agg(jsonb_build_object(
                                  'itemId', bi.id, 'serviceId', bi."serviceId",
                                  'name', COALESCE(jsonb_unwrap_string(bi.options)->>'displayName', s."nameVN", bi."serviceId"),
                                  'minutes', promo_item_minutes(bi.options, s.duration, bi.quantity),
                                  'status', bi.status,
                                  'isPromotion', COALESCE(s.is_promotion, false)) ORDER BY bi.id)
                         FROM "BookingItems" bi LEFT JOIN "Services" s ON s.id = bi."serviceId"
                        WHERE bi."bookingId" = b.id AND COALESCE(bi.status, '') <> 'CANCELLED'), '[]'::jsonb),
                   'alreadyAppliedThisPass', EXISTS (
                       SELECT 1 FROM "PromotionUsages" u
                        WHERE u.promotion_pass_id = p_pass_id AND u.booking_id = b.id AND u.status <> 'CANCELLED')
               ) || promo_order_minutes(b.id, '{}'::jsonb) AS row_json
        FROM "Bookings" b
        WHERE b."customerId" = v_customer
          AND b.status::text IN ('NEW', 'PREPARING', 'IN_PROGRESS')
        ORDER BY b."createdAt" DESC
        LIMIT 30
    ) t;
    RETURN promo_ok(v_rows);
END;
$$;

-- Customer history: active passes, past passes, usage history.
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
            v_past := v_past || jsonb_build_array(v_json);
        END IF;
    END LOOP;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', u.id, 'passId', u.promotion_pass_id, 'voucherCode', p.voucher_code,
               'campaignName', c.name, 'bookingId', u.booking_id, 'billCode', b."billCode",
               'benefitType', u.benefit_type, 'benefitValue', u.benefit_value,
               'appliedMinutes', u.applied_minutes, 'discountAmount', u.discount_amount,
               'status', u.status, 'staffId', u.staff_id,
               'appliedAt', promo_iso(u.applied_at), 'completedAt', promo_iso(u.completed_at),
               'cancelledAt', promo_iso(u.cancelled_at), 'cancelReason', u.cancel_reason)
             ORDER BY u.applied_at DESC), '[]'::jsonb)
      INTO v_usage
      FROM "PromotionUsages" u
      JOIN "CustomerPromotionPasses" p ON p.id = u.promotion_pass_id
      JOIN "PromotionCampaigns" c ON c.id = u.campaign_id
      LEFT JOIN "Bookings" b ON b.id = u.booking_id
     WHERE u.customer_id = p_customer_id;

    RETURN promo_ok(jsonb_build_object('active', v_active, 'past', v_past, 'usages', v_usage));
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Lifecycle triggers
-- -----------------------------------------------------------------------------
-- Bookings -> DONE: settle usages, then issue passes. -> CANCELLED: cancel usages.
-- Never blocks the status change: failures are logged to PromotionIssueErrors.
CREATE OR REPLACE FUNCTION promo_on_booking_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    u record;
    v_item_status text;
BEGIN
    BEGIN
        IF NEW.status::text = 'DONE' THEN
            FOR u IN SELECT id, booking_item_id FROM "PromotionUsages" WHERE booking_id = NEW.id AND status = 'APPLIED' LOOP
                SELECT status INTO v_item_status FROM "BookingItems" WHERE id = u.booking_item_id;
                IF v_item_status IS NULL OR v_item_status = 'CANCELLED' THEN
                    PERFORM promo_mark_usage_cancelled(u.id, 'PROMO_ITEM_CANCELLED');
                ELSE
                    UPDATE "PromotionUsages" SET status = 'COMPLETED', completed_at = now(), updated_at = now()
                     WHERE id = u.id;
                END IF;
            END LOOP;
            PERFORM promo_issue_for_booking(NEW.id);
        ELSIF NEW.status::text = 'CANCELLED' THEN
            FOR u IN SELECT id FROM "PromotionUsages" WHERE booking_id = NEW.id AND status = 'APPLIED' LOOP
                PERFORM promo_mark_usage_cancelled(u.id, 'ORDER_CANCELLED');
            END LOOP;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO "PromotionIssueErrors"(booking_id, stage, error) VALUES (NEW.id, 'booking_status:' || NEW.status::text, SQLERRM);
    END;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_promo_on_booking_status ON "Bookings";
CREATE TRIGGER tr_promo_on_booking_status
    AFTER UPDATE OF status ON "Bookings"
    FOR EACH ROW
    WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('DONE', 'CANCELLED'))
    EXECUTE FUNCTION promo_on_booking_status();

-- Promo item cancelled/removed through the normal dispatch flows -> usage cancelled.
CREATE OR REPLACE FUNCTION promo_on_item_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row record;
    v_usage text;
BEGIN
    IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
    BEGIN
        v_usage := jsonb_unwrap_string(v_row.options)->>'promotionUsageId';
        IF v_usage IS NOT NULL THEN
            PERFORM promo_mark_usage_cancelled(v_usage::uuid,
                CASE WHEN TG_OP = 'DELETE' THEN 'PROMO_ITEM_REMOVED' ELSE 'PROMO_ITEM_CANCELLED' END);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO "PromotionIssueErrors"(booking_id, stage, error) VALUES (v_row."bookingId", 'item_cancel', SQLERRM);
    END;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_promo_on_item_cancel ON "BookingItems";
CREATE TRIGGER tr_promo_on_item_cancel
    AFTER UPDATE OF status ON "BookingItems"
    FOR EACH ROW
    WHEN (NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED')
    EXECUTE FUNCTION promo_on_item_cancel();

DROP TRIGGER IF EXISTS tr_promo_on_item_delete ON "BookingItems";
CREATE TRIGGER tr_promo_on_item_delete
    AFTER DELETE ON "BookingItems"
    FOR EACH ROW
    EXECUTE FUNCTION promo_on_item_cancel();

-- -----------------------------------------------------------------------------
-- 10. Expiry (cosmetic — apply always checks now())
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_expire_passes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_n integer;
BEGIN
    UPDATE "CustomerPromotionPasses" SET status = 'EXPIRED', status_reason = 'VALID_UNTIL_PASSED', updated_at = now()
     WHERE status = 'ACTIVE' AND valid_until < now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE "PromotionCampaigns" SET status = 'ENDED', updated_at = now()
     WHERE status IN ('ACTIVE', 'INACTIVE') AND valid_until < now();
    RETURN v_n;
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promo_expire_passes_job') THEN
            PERFORM cron.unschedule('promo_expire_passes_job');
        END IF;
        -- 17:05 UTC = 00:05 Asia/Ho_Chi_Minh
        PERFORM cron.schedule('promo_expire_passes_job', '5 17 * * *', 'SELECT promo_expire_passes();');
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. Grants — service_role only
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
