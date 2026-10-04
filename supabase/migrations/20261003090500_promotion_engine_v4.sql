-- =============================================================================
-- Promotion Engine v4 — customer profile filter + bulk issue.
-- Plan: plans/plan_promotion_bulk_issue.md (decisions 03/10/2026).
--
--   * promo_real_email(): same rule as isDummyEmail (lib/customer.logic.ts) —
--     empty, no '@', or '...@guest.com' is NOT a real address. Fixes vouchers
--     being mailed to auto-generated guest emails.
--   * promo_customer_stats(): ONE source for customer metrics used by the
--     voucher filter. Visits = completed parent bookings (user decision);
--     tier = NEW / RETURNING (>= SystemConfigs.customer_returning_min_visits, default 2);
--     no VIP tier — "VIP menu" is a tag (vip_menu_count > 0).
--     Booking ↔ customer matching mirrors app/api/customers/route.ts.
--   * promo_customer_candidates(): filter page for the campaign screen.
--   * promo_issue_bulk(): issue to many selected profiles, per-customer result.
-- =============================================================================

INSERT INTO "SystemConfigs"(key, value, description) VALUES
    ('customer_returning_min_visits', '2'::jsonb,
     'Số lượt ghé (đơn cha đã hoàn tất) tối thiểu để là "Khách cũ". Dùng cho bộ lọc phát e-voucher.')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 1. Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_real_email(p_email text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_email IS NULL THEN NULL
        WHEN trim(p_email) = '' OR position('@' IN trim(p_email)) = 0 THEN NULL
        WHEN lower(trim(p_email)) LIKE '%@guest.com' THEN NULL
        ELSE trim(p_email)
    END;
$$;

CREATE OR REPLACE FUNCTION promo_gender(p_gender text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_gender IS NULL OR trim(p_gender) = '' THEN NULL
        WHEN lower(trim(p_gender)) IN ('male', 'm', 'nam') THEN 'MALE'
        WHEN lower(trim(p_gender)) IN ('female', 'f', 'nữ', 'nu') THEN 'FEMALE'
        ELSE 'OTHER'
    END;
$$;

-- Completed statuses = lib/customer.logic.ts COMPLETED_STATUSES.
CREATE OR REPLACE FUNCTION promo_is_completed_status(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT p_status IN ('COMPLETED', 'DONE', 'FEEDBACK', 'CLEANING');
$$;

-- -----------------------------------------------------------------------------
-- 2. Email fixes: never mail auto-generated guest addresses
-- -----------------------------------------------------------------------------
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
    SELECT promo_real_email(email) INTO v_email FROM "Customers" WHERE id = p_customer_id;

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
        'campaignDescription', c.description));
END;
$$;

-- Passes already waiting for an email to a guest address: stop them.
UPDATE "CustomerPromotionPasses" p SET email_status = 'SKIPPED', email_to = NULL, updated_at = now()
  FROM "Customers" cu
 WHERE cu.id = p.customer_id AND p.email_status IN ('PENDING', 'SENDING') AND promo_real_email(cu.email) IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Customer metrics — one source for the voucher filter
-- -----------------------------------------------------------------------------
-- Bookings of a customer = customerId match, plus bookings WITHOUT customerId whose
-- (name, real email) equals the profile's (fullName, email) — app/api/customers/route.ts.
CREATE OR REPLACE FUNCTION promo_customer_stats(p_customer_ids text[] DEFAULT NULL)
RETURNS TABLE(
    customer_id text, name text, phone text, email text, real_email text, gender text,
    nationality text, language text,
    visit_count int, total_spent numeric, last_visit_at timestamp, vip_menu_count int,
    guest_type text, tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH cu AS (
        SELECT c.* FROM "Customers" c WHERE p_customer_ids IS NULL OR c.id = ANY (p_customer_ids)
    ), bk AS (
        SELECT cu.id AS cid, b.id, b.parent_booking_id, b.status::text AS status, b."totalAmount", b."bookingDate",
               b.source, b."guestCount", b.nationality
          FROM cu JOIN "Bookings" b ON b."customerId" = cu.id
        UNION
        SELECT cu.id AS cid, b.id, b.parent_booking_id, b.status::text, b."totalAmount", b."bookingDate",
               b.source, b."guestCount", b.nationality
          FROM cu JOIN "Bookings" b
            ON b."customerId" IS NULL
           AND promo_real_email(b."customerEmail") IS NOT NULL AND NULLIF(trim(b."customerName"), '') IS NOT NULL
           AND cu."fullName" IS NOT NULL AND cu.email IS NOT NULL
           AND lower(trim(b."customerName")) = lower(trim(cu."fullName"))
           AND lower(trim(b."customerEmail")) = lower(trim(cu.email))
    ), agg AS (
        SELECT cid,
               count(*) FILTER (WHERE parent_booking_id IS NULL AND promo_is_completed_status(status))::int AS visits,
               COALESCE(sum("totalAmount") FILTER (WHERE promo_is_completed_status(status)), 0) AS spent,
               max("bookingDate") FILTER (WHERE parent_booking_id IS NULL AND promo_is_completed_status(status)) AS last_visit,
               count(*) FILTER (WHERE promo_is_completed_status(status) AND upper(COALESCE(source, '')) LIKE '%VIP%')::int AS vip,
               max(COALESCE("guestCount", 1)) AS max_guests,
               (array_agg(nationality ORDER BY "bookingDate" DESC) FILTER (WHERE NULLIF(trim(nationality), '') IS NOT NULL))[1] AS last_nat
          FROM bk GROUP BY cid
    )
    SELECT cu.id, cu."fullName", cu.phone, cu.email, promo_real_email(cu.email), promo_gender(cu.gender),
           COALESCE(NULLIF(trim(cu.nationality), ''), agg.last_nat),
           promo_customer_language(cu.id),
           COALESCE(agg.visits, 0), COALESCE(agg.spent, 0), agg.last_visit, COALESCE(agg.vip, 0),
           CASE WHEN COALESCE(agg.max_guests, 1) > 1 THEN 'GROUP' ELSE 'SINGLE' END,
           CASE WHEN COALESCE(agg.visits, 0) >= promo_setting_int('customer_returning_min_visits', 2) THEN 'RETURNING' ELSE 'NEW' END
      FROM cu LEFT JOIN agg ON agg.cid = cu.id;
$$;

-- -----------------------------------------------------------------------------
-- 4. Candidate list for a campaign
-- -----------------------------------------------------------------------------
-- p_filter keys (all optional): q, onlyQualified, qualifiedFrom, qualifiedTo (yyyy-MM-dd VN, <= 93 days),
-- visitFrom, visitTo, minVisits, minSpent, tier (NEW|RETURNING), vipMenu (USED|NOT_USED),
-- guestType (SINGLE|GROUP), gender (MALE|FEMALE|OTHER), nationality, language, hasEmail (default true).
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
               'alreadyHasPass', EXISTS (SELECT 1 FROM "CustomerPromotionPasses" p WHERE p.campaign_id = c.id AND p.customer_id = t.customer_id))
             ORDER BY last_visit_at DESC NULLS LAST, name), '[]'::jsonb)
      INTO v_items
      FROM (SELECT * FROM _promo_cand
             WHERE NOT v_has_email OR real_email IS NOT NULL
             ORDER BY last_visit_at DESC NULLS LAST, name
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

-- -----------------------------------------------------------------------------
-- 5. Bulk issue — admin ticks several profiles and issues at once
-- -----------------------------------------------------------------------------
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
                'passId', v_pass.id, 'voucherCode', v_pass.voucher_code, 'emailStatus', v_pass.email_status));
        EXCEPTION WHEN OTHERS THEN
            v_out := v_out || jsonb_build_array(jsonb_build_object('customerId', v_id, 'status', 'FAILED', 'errorCode', 'INTERNAL_ERROR', 'message', left(SQLERRM, 200)));
        END;
    END LOOP;
    RETURN promo_ok(jsonb_build_object('results', v_out));
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
