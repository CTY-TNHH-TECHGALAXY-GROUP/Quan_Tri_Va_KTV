-- =============================================================================
-- Promotion Engine v15 — limited-quantity e-vouchers claimed on Web Booking.
-- Plan: plans/plan_evoucher_webbooking_gioi_han.md (user decisions 08/10/2026).
--
--   * PromotionCampaigns.distribution_channel = 'WEB_CLAIM': admin sets total_quantity,
--     reservation_minutes, per-phone limits, public_slug; web_claim_paused stops NEW saves
--     only (reserved / active vouchers keep working).
--   * PromotionWebClaims: RESERVED -> ACTIVE -> REDEEMED, or -> EXPIRED / CANCELLED.
--     allocated = RESERVED + ACTIVE + REDEEMED, always <= total_quantity. Every path that
--     changes allocation or the public stock locks the campaign row first (lock order:
--     campaign -> claim -> pass -> booking).
--   * Activation = pass (voucher_code = claim code, issue_source WEB_CLAIM) + the existing
--     promo_apply_pass, so the discount line, totalAmount and DONE/CANCELLED triggers are
--     the engine's own. Called only from the web booking writer (service_role).
--   * PromotionCampaignStock: the ONLY promo table anon may read; in supabase_realtime.
--   * Kill switch: SystemConfigs.promotion_web_claim_enabled (default off).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema
-- -----------------------------------------------------------------------------
ALTER TABLE "PromotionCampaigns"
    ADD COLUMN IF NOT EXISTS distribution_channel text NOT NULL DEFAULT 'ADMIN_ISSUE',
    ADD COLUMN IF NOT EXISTS total_quantity integer,
    ADD COLUMN IF NOT EXISTS reservation_minutes integer NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS max_open_per_phone integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS max_total_per_phone integer,
    ADD COLUMN IF NOT EXISTS web_claim_paused boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS public_slug text;

ALTER TABLE "PromotionCampaigns" DROP CONSTRAINT IF EXISTS promo_campaign_distribution_chk;
ALTER TABLE "PromotionCampaigns" ADD CONSTRAINT promo_campaign_distribution_chk CHECK (
    distribution_channel IN ('ADMIN_ISSUE', 'WEB_CLAIM')
    AND (distribution_channel <> 'WEB_CLAIM' OR (total_quantity IS NOT NULL AND total_quantity >= 1 AND public_slug IS NOT NULL))
    AND reservation_minutes BETWEEN 5 AND 1440
    AND max_open_per_phone >= 1
    AND (max_total_per_phone IS NULL OR max_total_per_phone >= 1)
    AND (public_slug IS NULL OR public_slug ~ '^[a-z0-9][a-z0-9-]{1,59}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_campaign_public_slug ON "PromotionCampaigns"(public_slug) WHERE public_slug IS NOT NULL;

ALTER TABLE "CustomerPromotionPasses" DROP CONSTRAINT IF EXISTS promo_pass_issue_source_chk;
ALTER TABLE "CustomerPromotionPasses" ADD CONSTRAINT promo_pass_issue_source_chk
    CHECK (issue_source IN ('AUTO', 'MANUAL', 'WEB_CLAIM'));

CREATE TABLE IF NOT EXISTS "PromotionWebClaims" (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id             uuid NOT NULL REFERENCES "PromotionCampaigns"(id),
    voucher_code            text NOT NULL UNIQUE,
    status                  text NOT NULL DEFAULT 'RESERVED',
    device_hash             text,
    ip_hash                 text,
    reserved_at             timestamptz NOT NULL DEFAULT now(),
    reservation_expires_at  timestamptz NOT NULL,
    activated_at            timestamptz,
    activation_booking_id   text REFERENCES "Bookings"(id),
    activation_channel      text,
    customer_id             text,
    phone                   text,
    pass_id                 uuid REFERENCES "CustomerPromotionPasses"(id),
    usage_id                uuid REFERENCES "PromotionUsages"(id),
    redeemed_at             timestamptz,
    ended_at                timestamptz,
    end_reason              text,
    ended_by                text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promo_claim_status_chk CHECK (status IN ('RESERVED', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT promo_claim_active_chk CHECK (status NOT IN ('ACTIVE', 'REDEEMED')
        OR (activation_booking_id IS NOT NULL AND pass_id IS NOT NULL AND usage_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_claim_booking ON "PromotionWebClaims"(activation_booking_id)
    WHERE activation_booking_id IS NOT NULL AND status IN ('ACTIVE', 'REDEEMED');
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_claim_usage ON "PromotionWebClaims"(usage_id) WHERE usage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promo_claim_campaign_status ON "PromotionWebClaims"(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_promo_claim_phone ON "PromotionWebClaims"(campaign_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS "PromotionCampaignStock" (
    campaign_id     uuid PRIMARY KEY REFERENCES "PromotionCampaigns"(id) ON DELETE CASCADE,
    public_slug     text NOT NULL UNIQUE,
    status          text NOT NULL,          -- OPEN | PAUSED | SOLD_OUT | ENDED | INACTIVE
    benefit_type    text NOT NULL,
    benefit_value   numeric NOT NULL,
    total           integer NOT NULL,
    available       integer NOT NULL,
    valid_from      timestamptz NOT NULL,
    valid_until     timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT promo_stock_available_chk CHECK (available >= 0 AND available <= total)
);
-- Realtime does not guarantee delivery order: clients keep the highest version only.
ALTER TABLE "PromotionCampaignStock" ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

ALTER TABLE "PromotionWebClaims" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PromotionWebClaims" FROM anon, authenticated;   -- no policies: service_role only

ALTER TABLE "PromotionCampaignStock" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PromotionCampaignStock" FROM anon, authenticated;
GRANT SELECT ON "PromotionCampaignStock" TO anon, authenticated;
DROP POLICY IF EXISTS promo_stock_public_read ON "PromotionCampaignStock";
CREATE POLICY promo_stock_public_read ON "PromotionCampaignStock" FOR SELECT TO anon, authenticated USING (true);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND tablename = 'PromotionCampaignStock') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE "PromotionCampaignStock";
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Stock (caller must hold the campaign row lock)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_web_counts(p_campaign_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'reserved',  count(*) FILTER (WHERE status = 'RESERVED'),
        'active',    count(*) FILTER (WHERE status = 'ACTIVE'),
        'redeemed',  count(*) FILTER (WHERE status = 'REDEEMED'),
        'expired',   count(*) FILTER (WHERE status = 'EXPIRED'),
        'cancelled', count(*) FILTER (WHERE status = 'CANCELLED'),
        'allocated', count(*) FILTER (WHERE status IN ('RESERVED', 'ACTIVE', 'REDEEMED')))
    FROM "PromotionWebClaims" WHERE campaign_id = p_campaign_id;
$$;

-- Expire stale reservations of one campaign. Caller holds the campaign lock.
CREATE OR REPLACE FUNCTION promo_web_expire_locked(p_campaign_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
    UPDATE "PromotionWebClaims"
       SET status = 'EXPIRED', ended_at = now(), end_reason = 'RESERVATION_EXPIRED', updated_at = now()
     WHERE campaign_id = p_campaign_id AND status = 'RESERVED' AND reservation_expires_at <= now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION promo_web_refresh_stock_locked(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c        "PromotionCampaigns"%ROWTYPE;
    v_counts jsonb;
    v_avail  int;
    v_status text;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF NOT FOUND OR c.distribution_channel <> 'WEB_CLAIM' THEN
        DELETE FROM "PromotionCampaignStock" WHERE campaign_id = p_campaign_id;
        RETURN NULL;
    END IF;
    v_counts := promo_web_counts(p_campaign_id);
    v_avail := GREATEST(0, c.total_quantity - (v_counts->>'allocated')::int);
    v_status := CASE
        WHEN c.status = 'ENDED' OR now() > c.valid_until THEN 'ENDED'
        WHEN c.status <> 'ACTIVE' THEN 'INACTIVE'
        WHEN c.web_claim_paused THEN 'PAUSED'
        WHEN v_avail = 0 THEN 'SOLD_OUT'
        ELSE 'OPEN' END;

    INSERT INTO "PromotionCampaignStock" AS s (campaign_id, public_slug, status, benefit_type, benefit_value,
                                               total, available, valid_from, valid_until, updated_at)
    VALUES (c.id, c.public_slug, v_status, c.benefit_type, c.benefit_value,
            c.total_quantity, v_avail, c.valid_from, c.valid_until, clock_timestamp())
    ON CONFLICT (campaign_id) DO UPDATE SET
        public_slug = EXCLUDED.public_slug, status = EXCLUDED.status, benefit_type = EXCLUDED.benefit_type,
        benefit_value = EXCLUDED.benefit_value, total = EXCLUDED.total, available = EXCLUDED.available,
        valid_from = EXCLUDED.valid_from, valid_until = EXCLUDED.valid_until,
        updated_at = clock_timestamp(), version = s.version + 1
    -- Skip no-op writes so realtime only fires on a real change.
    WHERE (s.public_slug, s.status, s.benefit_type, s.benefit_value, s.total, s.available, s.valid_from, s.valid_until)
          IS DISTINCT FROM
          (EXCLUDED.public_slug, EXCLUDED.status, EXCLUDED.benefit_type, EXCLUDED.benefit_value,
           EXCLUDED.total, EXCLUDED.available, EXCLUDED.valid_from, EXCLUDED.valid_until);

    RETURN v_counts || jsonb_build_object('total', c.total_quantity, 'available', v_avail, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION promo_web_public_stock_json(p_campaign_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object('slug', public_slug, 'status', status, 'benefitType', benefit_type,
                              'benefitValue', benefit_value, 'total', total, 'available', available, 'version', version,
                              'validFrom', promo_iso(valid_from), 'validUntil', promo_iso(valid_until))
      FROM "PromotionCampaignStock" WHERE campaign_id = p_campaign_id;
$$;

CREATE OR REPLACE FUNCTION promo_web_normalize_phone(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT NULLIF(regexp_replace(regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g'), '^84', '0'), '');
$$;

-- -----------------------------------------------------------------------------
-- 3. Reserve (public, called by the WebBooking server with service_role)
-- -----------------------------------------------------------------------------
-- 🔧 Abuse limits: one open reservation per device; a few per IP (spa / office Wi-Fi share one IP).
CREATE OR REPLACE FUNCTION promo_web_reserve(p_slug text, p_device_hash text, p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c_max_open_per_ip constant int := 3;
    c        "PromotionCampaigns"%ROWTYPE;
    v_claim  "PromotionWebClaims"%ROWTYPE;
    v_counts jsonb;
    v_code   text;
    v_expiry timestamptz;
BEGIN
    IF NOT promo_setting_bool('promotion_web_claim_enabled', false) THEN
        RETURN promo_err('FEATURE_DISABLED', 'Chương trình voucher web đang tắt.');
    END IF;
    IF NULLIF(trim(COALESCE(p_device_hash, '')), '') IS NULL OR length(p_device_hash) > 128
       OR NULLIF(trim(COALESCE(p_ip_hash, '')), '') IS NULL OR length(p_ip_hash) > 128 THEN
        RETURN promo_err('INVALID_REQUEST', 'Thiếu thông tin thiết bị.');
    END IF;

    SELECT * INTO c FROM "PromotionCampaigns"
     WHERE public_slug = p_slug AND distribution_channel = 'WEB_CLAIM'
       FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.'); END IF;

    PERFORM promo_web_expire_locked(c.id);

    -- Same device already holds a live reservation: hand it back (multi-tab, double click).
    SELECT * INTO v_claim FROM "PromotionWebClaims"
     WHERE campaign_id = c.id AND device_hash = p_device_hash AND status = 'RESERVED'
     ORDER BY reserved_at DESC LIMIT 1;
    IF FOUND THEN
        PERFORM promo_web_refresh_stock_locked(c.id);
        RETURN promo_ok(jsonb_build_object('reused', true, 'voucherCode', v_claim.voucher_code, 'status', 'RESERVED',
                        'expiresAt', promo_iso(v_claim.reservation_expires_at),
                        'stock', promo_web_public_stock_json(c.id)));
    END IF;

    IF c.status = 'ENDED' OR now() > c.valid_until THEN
        PERFORM promo_web_refresh_stock_locked(c.id);
        RETURN promo_err('CAMPAIGN_ENDED', 'Chương trình đã kết thúc.');
    END IF;
    IF c.status <> 'ACTIVE' THEN RETURN promo_err('CAMPAIGN_INACTIVE', 'Chương trình đang tạm ngưng.'); END IF;
    IF now() < c.valid_from THEN RETURN promo_err('CAMPAIGN_NOT_STARTED', 'Chương trình chưa bắt đầu.'); END IF;
    IF c.web_claim_paused THEN RETURN promo_err('CAMPAIGN_PAUSED', 'Chương trình đang tạm dừng phát voucher.'); END IF;

    IF (SELECT count(*) FROM "PromotionWebClaims"
         WHERE campaign_id = c.id AND ip_hash = p_ip_hash AND status = 'RESERVED') >= c_max_open_per_ip THEN
        RETURN promo_err('RATE_LIMITED', 'Bạn đã lưu quá nhiều voucher. Vui lòng thử lại sau.');
    END IF;

    v_counts := promo_web_counts(c.id);
    IF (v_counts->>'allocated')::int >= c.total_quantity THEN
        PERFORM promo_web_refresh_stock_locked(c.id);
        RETURN promo_err('SOLD_OUT', 'Voucher đã được lưu hết.',
                         jsonb_build_object('data', jsonb_build_object('stock', promo_web_public_stock_json(c.id))));
    END IF;

    v_expiry := LEAST(now() + make_interval(mins => c.reservation_minutes), c.valid_until);
    FOR attempt IN 1 .. 6 LOOP
        v_code := c.voucher_prefix || '-' || promo_random_code(6);
        CONTINUE WHEN EXISTS (SELECT 1 FROM "CustomerPromotionPasses" WHERE voucher_code = v_code);
        INSERT INTO "PromotionWebClaims" (campaign_id, voucher_code, status, device_hash, ip_hash, reservation_expires_at)
        VALUES (c.id, v_code, 'RESERVED', p_device_hash, p_ip_hash, v_expiry)
        ON CONFLICT (voucher_code) DO NOTHING
        RETURNING * INTO v_claim;
        EXIT WHEN v_claim.id IS NOT NULL;
    END LOOP;
    IF v_claim.id IS NULL THEN RAISE EXCEPTION 'promo_web_reserve: could not generate unique voucher code'; END IF;

    PERFORM promo_web_refresh_stock_locked(c.id);
    RETURN promo_ok(jsonb_build_object('reused', false, 'voucherCode', v_claim.voucher_code, 'status', 'RESERVED',
                    'expiresAt', promo_iso(v_claim.reservation_expires_at),
                    'stock', promo_web_public_stock_json(c.id)));
END;
$$;

-- Public, read-only view of one voucher code (checkout auto-detect, /v/{code}).
-- Never returns customer, phone or the full booking id.
CREATE OR REPLACE FUNCTION promo_web_voucher_status(p_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v  "PromotionWebClaims"%ROWTYPE;
    c  "PromotionCampaigns"%ROWTYPE;
    v_status text;
BEGIN
    SELECT * INTO v FROM "PromotionWebClaims" WHERE voucher_code = upper(trim(COALESCE(p_code, '')));
    IF NOT FOUND THEN RETURN promo_err('VOUCHER_NOT_FOUND', 'Mã voucher không tồn tại.'); END IF;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = v.campaign_id;
    v_status := CASE WHEN v.status = 'RESERVED' AND v.reservation_expires_at <= now() THEN 'EXPIRED' ELSE v.status END;
    RETURN promo_ok(jsonb_build_object(
        'voucherCode', v.voucher_code,
        'status', v_status,
        'expiresAt', CASE WHEN v_status = 'RESERVED' THEN promo_iso(v.reservation_expires_at) END,
        'activatedAt', promo_iso(v.activated_at),
        'bookingRef', CASE WHEN v.activation_booking_id IS NOT NULL THEN right(v.activation_booking_id, 3) END,
        'campaign', jsonb_build_object('slug', c.public_slug, 'name', c.name, 'nameI18n', c.name_i18n,
                                       'benefitType', c.benefit_type, 'benefitValue', c.benefit_value,
                                       'benefitConfig', c.benefit_config,
                                       'conditions', promo_conditions_summary(c.apply_conditions),
                                       'validUntil', promo_iso(c.valid_until))));
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Activate (ONLY from the web booking writer, same transaction as the booking)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_web_activate(p_code text, p_booking_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_code      text := upper(trim(COALESCE(p_code, '')));
    v_cid       uuid;
    c           "PromotionCampaigns"%ROWTYPE;
    v           "PromotionWebClaims"%ROWTYPE;
    b           record;
    v_phone     text;
    v_open      int;
    v_total     int;
    v_pass_id   uuid;
    v_apply     jsonb;
BEGIN
    IF NOT promo_setting_bool('promotion_web_claim_enabled', false) THEN
        RETURN promo_err('FEATURE_DISABLED', 'Chương trình voucher web đang tắt.');
    END IF;

    -- Lock order: campaign -> claim.
    SELECT campaign_id INTO v_cid FROM "PromotionWebClaims" WHERE voucher_code = v_code;
    IF v_cid IS NULL THEN RETURN promo_err('VOUCHER_NOT_FOUND', 'Mã voucher không tồn tại.'); END IF;
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = v_cid FOR UPDATE;
    SELECT * INTO v FROM "PromotionWebClaims" WHERE voucher_code = v_code FOR UPDATE;

    -- Idempotent replay of the same booking.
    IF v.status IN ('ACTIVE', 'REDEEMED') AND v.activation_booking_id = p_booking_id THEN
        RETURN promo_ok(jsonb_build_object('replay', true, 'voucherCode', v.voucher_code, 'usageId', v.usage_id,
                        'discountAmount', (SELECT discount_amount FROM "PromotionUsages" WHERE id = v.usage_id)));
    END IF;
    IF v.status IN ('ACTIVE', 'REDEEMED') THEN RETURN promo_err('VOUCHER_ALREADY_USED', 'Voucher đã được dùng cho đơn khác.'); END IF;
    IF v.status = 'CANCELLED' THEN RETURN promo_err('VOUCHER_CANCELLED', 'Voucher đã bị huỷ.'); END IF;
    IF v.status = 'EXPIRED' OR v.reservation_expires_at <= now() THEN
        RETURN promo_err('VOUCHER_EXPIRED', 'Voucher đã hết thời gian giữ chỗ.');
    END IF;

    IF c.status = 'ENDED' OR now() > c.valid_until THEN RETURN promo_err('CAMPAIGN_ENDED', 'Chương trình đã kết thúc.'); END IF;
    IF c.status <> 'ACTIVE' THEN RETURN promo_err('CAMPAIGN_INACTIVE', 'Chương trình đang tạm ngưng.'); END IF;
    -- web_claim_paused only stops new saves: reserved vouchers still activate (user 08/10/2026).

    SELECT id, "billCode" AS bill_code, source, "customerId" AS customer_id, "customerPhone" AS phone
      INTO b FROM "Bookings" WHERE id = p_booking_id;
    IF NOT FOUND THEN RETURN promo_err('ORDER_NOT_FOUND', promo_error_message('ORDER_NOT_FOUND')); END IF;
    -- Web Booking only: checked at creation time, inside the web writer's transaction.
    -- Bookings.source is rewritten later by the counter, so it is never read again.
    IF b.source IS DISTINCT FROM 'WebBooking' OR b.bill_code NOT LIKE 'WB-%' THEN
        RETURN promo_err('WEB_BOOKING_REQUIRED', 'Voucher chỉ áp dụng cho đơn đặt qua Oria Web Booking.');
    END IF;
    IF b.customer_id IS NULL THEN RETURN promo_err('VOUCHER_CUSTOMER_REQUIRED', 'Thiếu hồ sơ khách hàng.'); END IF;

    v_phone := promo_web_normalize_phone(b.phone);
    IF v_phone IS NOT NULL THEN
        SELECT count(*) FILTER (WHERE status = 'ACTIVE'), count(*) INTO v_open, v_total
          FROM "PromotionWebClaims"
         WHERE campaign_id = c.id AND phone = v_phone AND status IN ('ACTIVE', 'REDEEMED');
        IF v_open >= c.max_open_per_phone
           OR (c.max_total_per_phone IS NOT NULL AND v_total >= c.max_total_per_phone) THEN
            RETURN promo_err('PHONE_LIMIT_REACHED', 'Số điện thoại này đã dùng hết lượt voucher của chương trình.');
        END IF;
    END IF;

    -- Pass + apply as one unit: any failure rolls back to this savepoint.
    BEGIN
        INSERT INTO "CustomerPromotionPasses" (
            campaign_id, customer_id, voucher_code, qr_token, status, benefit_type, benefit_value,
            usage_type, usage_limit, valid_from, valid_until, one_pass_per_customer,
            issue_source, issued_by, email_status)
        VALUES (
            c.id, b.customer_id, v.voucher_code, promo_random_token(), 'ACTIVE', c.benefit_type, c.benefit_value,
            'ONE_TIME', 1, c.valid_from, c.valid_until, false,
            'WEB_CLAIM', 'WEB_BOOKING', 'SKIPPED')
        RETURNING id INTO v_pass_id;

        v_apply := promo_apply_pass(v_pass_id, p_booking_id, 'WEB_BOOKING', false, NULL);
        IF NOT COALESCE((v_apply->>'success')::boolean, false) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PROMO_WEB_APPLY_FAILED';
        END IF;
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'PROMO_WEB_APPLY_FAILED' THEN RETURN v_apply; END IF;
        RAISE;
    END;

    UPDATE "PromotionWebClaims"
       SET status = 'ACTIVE', activated_at = now(), activation_booking_id = p_booking_id,
           activation_channel = 'WEB_BOOKING', customer_id = b.customer_id, phone = v_phone,
           pass_id = v_pass_id, usage_id = (v_apply->'data'->>'usageId')::uuid, updated_at = now()
     WHERE id = v.id;

    PERFORM promo_web_refresh_stock_locked(c.id);
    RETURN promo_ok(jsonb_build_object('replay', false, 'voucherCode', v.voucher_code,
                    'usageId', v_apply->'data'->>'usageId',
                    'discountAmount', (v_apply->'data'->>'discountAmount')::numeric,
                    'appliedMinutes', (v_apply->'data'->>'appliedMinutes')::int,
                    'totalAmount', (SELECT "totalAmount" FROM "Bookings" WHERE id = p_booking_id)));
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Usage lifecycle -> claim (DONE = REDEEMED; cancelled order / removed discount = slot back)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_web_on_usage_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cid uuid;
BEGIN
    SELECT campaign_id INTO v_cid FROM "PromotionWebClaims" WHERE usage_id = NEW.id;
    IF v_cid IS NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM "PromotionCampaigns" WHERE id = v_cid FOR UPDATE;

    IF NEW.status = 'COMPLETED' THEN
        UPDATE "PromotionWebClaims" SET status = 'REDEEMED', redeemed_at = now(), updated_at = now()
         WHERE usage_id = NEW.id AND status = 'ACTIVE';
    ELSIF NEW.status = 'CANCELLED' THEN
        UPDATE "PromotionWebClaims"
           SET status = 'CANCELLED', ended_at = now(), end_reason = COALESCE(NEW.cancel_reason, 'USAGE_CANCELLED'), updated_at = now()
         WHERE usage_id = NEW.id AND status IN ('ACTIVE', 'REDEEMED');
        -- The pass must never be re-applied at the counter (web-only rule).
        UPDATE "CustomerPromotionPasses" SET status = 'CANCELLED', status_reason = 'WEB_CLAIM_USAGE_CANCELLED', updated_at = now()
         WHERE id = NEW.promotion_pass_id AND status <> 'CANCELLED';
    END IF;
    PERFORM promo_web_refresh_stock_locked(v_cid);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_promo_web_on_usage_status ON "PromotionUsages";
CREATE TRIGGER tr_promo_web_on_usage_status
    AFTER UPDATE OF status ON "PromotionUsages"
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION promo_web_on_usage_status();

-- Campaign edits (status, quantity, pause, window) refresh the public stock;
-- ENDED / INACTIVE expire open reservations.
CREATE OR REPLACE FUNCTION promo_web_on_campaign_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.distribution_channel = 'WEB_CLAIM' OR OLD.distribution_channel = 'WEB_CLAIM' THEN
        IF NEW.status IN ('ENDED', 'INACTIVE') AND OLD.status IS DISTINCT FROM NEW.status THEN
            UPDATE "PromotionWebClaims"
               SET status = 'EXPIRED', ended_at = now(), end_reason = 'CAMPAIGN_' || NEW.status, updated_at = now()
             WHERE campaign_id = NEW.id AND status = 'RESERVED';
        END IF;
        PERFORM promo_web_refresh_stock_locked(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_promo_web_on_campaign_change ON "PromotionCampaigns";
CREATE TRIGGER tr_promo_web_on_campaign_change
    AFTER UPDATE ON "PromotionCampaigns"
    FOR EACH ROW EXECUTE FUNCTION promo_web_on_campaign_change();

-- -----------------------------------------------------------------------------
-- 6. Admin controls (called from admin API after authorizePromotion)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_web_configure(p_campaign_id uuid, p_config jsonb, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c        "PromotionCampaigns"%ROWTYPE;
    v_total  int := (p_config->>'totalQuantity')::int;
    v_alloc  int;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.'); END IF;
    IF v_total IS NULL OR v_total < 1 THEN RETURN promo_err('VALIDATION_ERROR', 'Tổng số voucher phải từ 1 trở lên.'); END IF;
    PERFORM promo_web_expire_locked(c.id);
    v_alloc := (promo_web_counts(c.id)->>'allocated')::int;
    IF v_total < v_alloc THEN
        RETURN promo_err('QUANTITY_BELOW_ALLOCATED', format('Đã cấp %s voucher, không thể giảm tổng xuống %s.', v_alloc, v_total),
                         jsonb_build_object('data', jsonb_build_object('allocated', v_alloc)));
    END IF;

    BEGIN
        UPDATE "PromotionCampaigns" SET
            distribution_channel = 'WEB_CLAIM',
            total_quantity       = v_total,
            reservation_minutes  = COALESCE((p_config->>'reservationMinutes')::int, reservation_minutes),
            max_open_per_phone   = COALESCE((p_config->>'maxOpenPerPhone')::int, max_open_per_phone),
            max_total_per_phone  = CASE WHEN p_config ? 'maxTotalPerPhone' THEN (p_config->>'maxTotalPerPhone')::int ELSE max_total_per_phone END,
            public_slug          = COALESCE(NULLIF(lower(trim(p_config->>'publicSlug')), ''), public_slug),
            updated_at           = now()
         WHERE id = c.id;
    EXCEPTION
        WHEN check_violation THEN RETURN promo_err('VALIDATION_ERROR', 'Cấu hình voucher web không hợp lệ.');
        WHEN unique_violation THEN RETURN promo_err('SLUG_TAKEN', 'Đường dẫn chương trình đã được dùng.');
    END;
    RETURN promo_ok(promo_web_campaign_stats(c.id));
END;
$$;

CREATE OR REPLACE FUNCTION promo_web_set_paused(p_campaign_id uuid, p_paused boolean, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE "PromotionCampaigns" SET web_claim_paused = p_paused, updated_at = now()
     WHERE id = p_campaign_id AND distribution_channel = 'WEB_CLAIM';
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.'); END IF;
    RETURN promo_ok(promo_web_campaign_stats(p_campaign_id));
END;
$$;

-- Revoke one RESERVED voucher, or every RESERVED voucher of the campaign (p_claim_id NULL):
-- the emergency button when bots drain the stock. ACTIVE vouchers are revoked by cancelling
-- the usage on the order (promo_cancel_usage), which returns the slot via the trigger.
CREATE OR REPLACE FUNCTION promo_web_release(p_campaign_id uuid, p_claim_id uuid, p_reason text, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
    PERFORM 1 FROM "PromotionCampaigns" WHERE id = p_campaign_id AND distribution_channel = 'WEB_CLAIM' FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.'); END IF;
    UPDATE "PromotionWebClaims"
       SET status = 'CANCELLED', ended_at = now(), ended_by = p_staff_id,
           end_reason = COALESCE(NULLIF(trim(p_reason), ''), 'ADMIN_RELEASED'), updated_at = now()
     WHERE campaign_id = p_campaign_id AND status = 'RESERVED' AND (p_claim_id IS NULL OR id = p_claim_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF p_claim_id IS NOT NULL AND v_n = 0 THEN
        RETURN promo_err('VOUCHER_NOT_RESERVED', 'Chỉ thu hồi được voucher đang giữ chỗ.');
    END IF;
    PERFORM promo_web_refresh_stock_locked(p_campaign_id);
    RETURN promo_ok(promo_web_campaign_stats(p_campaign_id) || jsonb_build_object('released', v_n));
END;
$$;

CREATE OR REPLACE FUNCTION promo_web_campaign_stats(p_campaign_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT promo_web_counts(c.id) || jsonb_build_object(
        'campaignId', c.id, 'distributionChannel', c.distribution_channel, 'campaignStatus', c.status,
        'publicSlug', c.public_slug, 'total', c.total_quantity,
        'available', CASE WHEN c.total_quantity IS NULL THEN NULL
                          ELSE GREATEST(0, c.total_quantity - (promo_web_counts(c.id)->>'allocated')::int) END,
        'paused', c.web_claim_paused, 'reservationMinutes', c.reservation_minutes,
        'maxOpenPerPhone', c.max_open_per_phone, 'maxTotalPerPhone', c.max_total_per_phone,
        'stockStatus', (SELECT status FROM "PromotionCampaignStock" WHERE campaign_id = c.id))
      FROM "PromotionCampaigns" c WHERE c.id = p_campaign_id;
$$;

CREATE OR REPLACE FUNCTION promo_web_list_claims(p_campaign_id uuid, p_status text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(jsonb_agg(row_json ORDER BY reserved_at DESC), '[]'::jsonb) FROM (
        SELECT w.reserved_at, jsonb_build_object(
            'id', w.id, 'voucherCode', w.voucher_code,
            'status', CASE WHEN w.status = 'RESERVED' AND w.reservation_expires_at <= now() THEN 'EXPIRED' ELSE w.status END,
            'reservedAt', promo_iso(w.reserved_at), 'expiresAt', promo_iso(w.reservation_expires_at),
            'activatedAt', promo_iso(w.activated_at), 'bookingId', w.activation_booking_id,
            'redeemedAt', promo_iso(w.redeemed_at), 'endedAt', promo_iso(w.ended_at), 'endReason', w.end_reason,
            'customerId', w.customer_id, 'customerName', cu."fullName", 'phone', w.phone,
            'discountAmount', u.discount_amount) AS row_json
          FROM "PromotionWebClaims" w
          LEFT JOIN "Customers" cu ON cu.id = w.customer_id
          LEFT JOIN "PromotionUsages" u ON u.id = w.usage_id
         WHERE w.campaign_id = p_campaign_id AND (p_status IS NULL OR w.status = p_status)
         ORDER BY w.reserved_at DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)) t;
$$;

-- -----------------------------------------------------------------------------
-- 7. Expiry job (backup only: every RPC above already expires lazily)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_web_expire_all()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r   record;
    v_n int := 0;
BEGIN
    FOR r IN SELECT DISTINCT campaign_id FROM "PromotionWebClaims"
              WHERE status = 'RESERVED' AND reservation_expires_at <= now()
    LOOP
        PERFORM 1 FROM "PromotionCampaigns" WHERE id = r.campaign_id FOR UPDATE;
        v_n := v_n + promo_web_expire_locked(r.campaign_id);
        PERFORM promo_web_refresh_stock_locked(r.campaign_id);
    END LOOP;
    -- Campaigns that just passed valid_until flip to ENDED on the public card.
    FOR r IN SELECT campaign_id FROM "PromotionCampaignStock" WHERE status <> 'ENDED' AND now() > valid_until
    LOOP
        PERFORM 1 FROM "PromotionCampaigns" WHERE id = r.campaign_id FOR UPDATE;
        PERFORM promo_web_refresh_stock_locked(r.campaign_id);
    END LOOP;
    RETURN v_n;
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'promo_web_expire_job';
        PERFORM cron.schedule('promo_web_expire_job', '*/2 * * * *', 'SELECT public.promo_web_expire_all()');
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Grants: service_role only (WebBooking server / admin API)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION promo_web_counts(uuid), promo_web_expire_locked(uuid), promo_web_refresh_stock_locked(uuid),
    promo_web_public_stock_json(uuid), promo_web_reserve(text, text, text), promo_web_voucher_status(text),
    promo_web_activate(text, text), promo_web_configure(uuid, jsonb, text), promo_web_set_paused(uuid, boolean, text),
    promo_web_release(uuid, uuid, text, text), promo_web_campaign_stats(uuid), promo_web_list_claims(uuid, text, int),
    promo_web_expire_all(), promo_web_on_usage_status(), promo_web_on_campaign_change()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION promo_web_reserve(text, text, text), promo_web_voucher_status(text),
    promo_web_activate(text, text), promo_web_configure(uuid, jsonb, text), promo_web_set_paused(uuid, boolean, text),
    promo_web_release(uuid, uuid, text, text), promo_web_campaign_stats(uuid), promo_web_list_claims(uuid, text, int),
    promo_web_expire_all()
    TO service_role;
