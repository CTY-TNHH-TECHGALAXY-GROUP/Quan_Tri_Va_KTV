-- Promotion engine v17 — web-claim e-voucher hardening after the 09/10/2026 review.
-- Plan: plans/plan_evoucher_sua_loi_sau_ra_soat.md. Baseline of every replaced function:
-- plans/sql/baseline_promo_functions_before_v17_20261009.sql (rollback = re-run those bodies).
--
--  A1  Self-heal of ACTIVE claims in the 2-minute cron: split orders, no-shows (end of the
--      appointment day, user D1), orders stuck after service, and trigger errors that the
--      booking-status trigger swallows.
--  A2  An order closed DONE with no real service left cancels its voucher usage (and the
--      discount line) instead of consuming it. Applies to every campaign.
--  A3  Web-claim campaigns: only new PERCENT / FIXED, non-AUTO campaigns without passes can
--      convert (user D3); admin issuing and counter apply are refused for them.
--  A4  Admin pass status actions are refused on web-claim passes.
--  A5  Public stock is refreshed on every path that expired reservations.
--  A6  The appointment must fall inside the campaign window (user D2).
-- Bookings."bookingDate" is the VN wall-clock time without a zone (WebBooking writer).

-- ─── A3: campaign shape ──────────────────────────────────────────────────────────────────

ALTER TABLE "PromotionCampaigns" DROP CONSTRAINT IF EXISTS promo_campaign_web_claim_kind_chk;
ALTER TABLE "PromotionCampaigns" ADD CONSTRAINT promo_campaign_web_claim_kind_chk CHECK (
    distribution_channel <> 'WEB_CLAIM'
    OR (benefit_type IN ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT') AND assignment_mode <> 'AUTO'));

-- Why a campaign cannot (yet) be distributed on the web; NULL = eligible.
CREATE OR REPLACE FUNCTION promo_web_ineligible_reason(p_campaign_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE
        WHEN c.id IS NULL THEN 'CAMPAIGN_NOT_FOUND'
        WHEN c.distribution_channel = 'WEB_CLAIM' THEN NULL
        WHEN c.benefit_type NOT IN ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT') THEN 'BENEFIT_TYPE'
        WHEN c.assignment_mode = 'AUTO' THEN 'AUTO_ASSIGNMENT'
        WHEN EXISTS (SELECT 1 FROM "CustomerPromotionPasses" p WHERE p.campaign_id = c.id) THEN 'HAS_PASSES'
        WHEN c.status = 'ENDED' OR now() > c.valid_until THEN 'CAMPAIGN_ENDED'
        ELSE NULL END
      FROM (SELECT p_campaign_id AS id) k
      LEFT JOIN "PromotionCampaigns" c ON c.id = k.id;
$$;

-- Backstop: no pass of a web-claim campaign can be created outside promo_web_activate.
CREATE OR REPLACE FUNCTION promo_web_guard_pass_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_channel text;
BEGIN
    SELECT distribution_channel INTO v_channel FROM "PromotionCampaigns" WHERE id = NEW.campaign_id;
    IF (v_channel = 'WEB_CLAIM') IS DISTINCT FROM (NEW.issue_source = 'WEB_CLAIM') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'WEB_CLAIM_ISSUE_FORBIDDEN';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_promo_web_guard_pass_insert ON "CustomerPromotionPasses";
CREATE TRIGGER tr_promo_web_guard_pass_insert
    BEFORE INSERT ON "CustomerPromotionPasses"
    FOR EACH ROW EXECUTE FUNCTION promo_web_guard_pass_insert();

CREATE OR REPLACE FUNCTION public.promo_issue_manual(p_campaign_id uuid, p_customer_id text, p_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    c     "PromotionCampaigns"%ROWTYPE;
    v_res jsonb;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình'); END IF;
    IF c.distribution_channel = 'WEB_CLAIM' THEN
        RETURN promo_err('WEB_CLAIM_ISSUE_FORBIDDEN', 'Chương trình phát trên Web Booking: khách tự lưu voucher trên web, không phát tay được.');
    END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.promo_issue_bulk(p_campaign_id uuid, p_customer_ids text[], p_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF c.distribution_channel = 'WEB_CLAIM' THEN
        RETURN promo_err('WEB_CLAIM_ISSUE_FORBIDDEN', 'Chương trình phát trên Web Booking: khách tự lưu voucher trên web, không phát tay được.');
    END IF;
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
$function$;

-- Counter apply: a web-claim pass applies only inside promo_web_activate (web-only rule),
-- which marks its booking in a transaction-local setting.
CREATE OR REPLACE FUNCTION public.promo_check_apply_ex(p_pass_id uuid, p_booking_id text, p_override_conditions boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    IF p.issue_source = 'WEB_CLAIM'
       AND current_setting('promo.web_activation_booking', true) IS DISTINCT FROM p_booking_id THEN
        RETURN 'WEB_BOOKING_REQUIRED';
    END IF;
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
$function$;

-- ─── A4: admin pass actions ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promo_set_pass_status(p_pass_id uuid, p_action text, p_reason text, p_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    p "CustomerPromotionPasses"%ROWTYPE;
    v_new text;
BEGIN
    SELECT * INTO p FROM "CustomerPromotionPasses" WHERE id = p_pass_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('PROMOTION_NOT_FOUND', 'Không tìm thấy voucher'); END IF;
    -- A web voucher is driven by its claim and its order: cancelling the pass alone would
    -- leave the discount on the order. Cancel the order's promotion line instead.
    IF p.issue_source = 'WEB_CLAIM' THEN
        RETURN promo_err('WEB_CLAIM_PASS_MANAGED',
            'Voucher web đi theo đơn đặt lịch: huỷ dòng khuyến mãi trên đơn (hoặc huỷ đơn) để trả suất.');
    END IF;
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
$function$;

-- ─── A2: closing an order with no real service ───────────────────────────────────────────

-- A real (served) line: not cancelled, not the private-room add-on, not a discount line.
-- Free-minute lines (price 0) count: they are service time.
CREATE OR REPLACE FUNCTION promo_has_real_items(p_booking_ids text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM "BookingItems" i
         WHERE i."bookingId" = ANY (p_booking_ids)
           AND i.status::text <> 'CANCELLED'
           AND i."serviceId" IS DISTINCT FROM 'NHS0900'
           AND NOT (COALESCE(jsonb_unwrap_string(i.options)->>'isPromotion', 'false') = 'true'
                    AND COALESCE(i.price, 0) < 0));
$$;

-- Cancel a usage together with its line: the line is CANCELLED and a discount is given back
-- to the booking that holds the line (it may be a split child). Caller holds the locks it needs.
CREATE OR REPLACE FUNCTION promo_cancel_usage_with_line(p_usage_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    u "PromotionUsages"%ROWTYPE;
    i record;
BEGIN
    SELECT * INTO u FROM "PromotionUsages" WHERE id = p_usage_id FOR UPDATE;
    IF NOT FOUND OR u.status <> 'APPLIED' THEN RETURN; END IF;
    UPDATE "PromotionUsages" SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = p_reason, updated_at = now()
     WHERE id = u.id;
    SELECT id, "bookingId" AS booking_id, status::text AS status, price, quantity INTO i
      FROM "BookingItems" WHERE id = u.booking_item_id FOR UPDATE;
    IF FOUND AND i.status <> 'CANCELLED' THEN
        UPDATE "BookingItems" SET status = 'CANCELLED' WHERE id = i.id;
        IF COALESCE(i.price, 0) < 0 THEN
            UPDATE "Bookings" SET "totalAmount" = COALESCE("totalAmount", 0) - (i.price * COALESCE(i.quantity, 1)),
                   "updatedAt" = now() AT TIME ZONE 'UTC'
             WHERE id = i.booking_id;
        END IF;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.promo_on_booking_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    u record;
    v_item_status text;
    v_served boolean;
BEGIN
    BEGIN
        IF NEW.status::text = 'DONE' THEN
            v_served := promo_has_real_items(ARRAY[NEW.id]);
            FOR u IN SELECT id, booking_item_id FROM "PromotionUsages" WHERE booking_id = NEW.id AND status = 'APPLIED' LOOP
                SELECT status INTO v_item_status FROM "BookingItems" WHERE id = u.booking_item_id;
                IF v_item_status IS NULL OR v_item_status = 'CANCELLED' THEN
                    PERFORM promo_mark_usage_cancelled(u.id, 'PROMO_ITEM_CANCELLED');
                ELSIF NOT v_served THEN
                    -- Every service was cancelled: the voucher was not used (v17, A2).
                    PERFORM promo_cancel_usage_with_line(u.id, 'NO_SERVICE_PERFORMED');
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
        -- Never block closing / cancelling the order; the error goes to the Postgres logs.
        -- Web-claim usages left APPLIED here are repaired by promo_web_heal_claims (cron).
        RAISE WARNING 'promo trigger booking_status:% booking=% error=%', NEW.status::text, NEW.id, SQLERRM;
    END;
    RETURN NULL;
END;
$function$;

-- ─── A1: self-heal ACTIVE claims ─────────────────────────────────────────────────────────

-- Statuses meaning "the service took place" (it can still be closing: review, cleaning).
CREATE OR REPLACE FUNCTION promo_web_heal_claims()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r           record;
    u           "PromotionUsages"%ROWTYPE;
    b           record;
    v_ids       text[];
    v_states    text[];
    v_today     date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
    v_day_over  boolean;
    v_has_booking boolean;
    v_action    text;
    v_out       jsonb := '{}'::jsonb;
BEGIN
    FOR r IN
        SELECT w.id, w.campaign_id, w.usage_id, w.activation_booking_id
          FROM "PromotionWebClaims" w
          LEFT JOIN "PromotionUsages" pu ON pu.id = w.usage_id
          LEFT JOIN "Bookings" bk ON bk.id = w.activation_booking_id
         WHERE w.status = 'ACTIVE'
           -- Only claims that may need work: no lock churn on healthy open orders.
           AND (pu.status IS DISTINCT FROM 'APPLIED' OR bk.id IS NULL
                OR bk.status::text NOT IN ('NEW', 'PREPARING', 'IN_PROGRESS')
                OR bk."bookingDate"::date < v_today)
         ORDER BY w.campaign_id, w.activated_at
    LOOP
        BEGIN
            -- Lock order: campaign -> claim -> usage -> booking. Never wait on a booking the
            -- counter is editing: skip it and retry on the next run.
            PERFORM 1 FROM "PromotionCampaigns" WHERE id = r.campaign_id FOR UPDATE;
            PERFORM 1 FROM "PromotionWebClaims" WHERE id = r.id AND status = 'ACTIVE' FOR UPDATE;
            IF NOT FOUND THEN CONTINUE; END IF;
            SELECT * INTO u FROM "PromotionUsages" WHERE id = r.usage_id FOR UPDATE;
            SELECT id, status::text AS status, "bookingDate" AS booking_at INTO b
              FROM "Bookings" WHERE id = r.activation_booking_id FOR UPDATE SKIP LOCKED;
            v_has_booking := FOUND;
            IF NOT v_has_booking AND EXISTS (SELECT 1 FROM "Bookings" WHERE id = r.activation_booking_id) THEN
                CONTINUE;  -- locked by the counter right now
            END IF;

            v_action := NULL;
            IF u.id IS NULL OR u.status = 'CANCELLED' THEN
                v_action := 'SYNC_CANCELLED';
            ELSIF u.status = 'COMPLETED' THEN
                v_action := 'SYNC_REDEEMED';
            ELSIF NOT v_has_booking THEN
                v_action := 'CANCEL:ORDER_DELETED';
            ELSE
                v_ids := ARRAY[b.id];
                v_states := ARRAY[b.status];
                IF b.status = 'SPLIT' THEN
                    SELECT COALESCE(array_agg(id), ARRAY[]::text[]), COALESCE(array_agg(status::text), ARRAY[]::text[])
                      INTO v_ids, v_states FROM "Bookings" WHERE parent_booking_id = b.id;
                    v_ids := v_ids || b.id;
                    IF cardinality(v_states) = 0 THEN v_states := ARRAY['SPLIT']; END IF;
                END IF;
                v_day_over := b.booking_at IS NOT NULL AND b.booking_at::date < v_today;

                IF b.status = 'CANCELLED' OR (b.status = 'SPLIT' AND cardinality(v_states) > 0
                                              AND v_states <@ ARRAY['CANCELLED']) THEN
                    v_action := 'CANCEL:ORDER_CANCELLED';
                ELSIF v_states && ARRAY['IN_PROGRESS', 'PAUSED'] THEN
                    v_action := NULL;  -- still being served
                ELSIF v_states <@ ARRAY['DONE', 'CANCELLED']
                      OR (v_day_over AND v_states && ARRAY['DONE', 'COMPLETED', 'FEEDBACK', 'CLEANING']) THEN
                    v_action := CASE WHEN promo_has_real_items(v_ids) THEN 'COMPLETE' ELSE 'CANCEL:NO_SERVICE_PERFORMED' END;
                ELSIF v_day_over AND v_states <@ ARRAY['NEW', 'PREPARING', 'CANCELLED'] THEN
                    -- No-show (user D1): end of the appointment day, the order never started.
                    v_action := 'CANCEL:NO_SHOW';
                END IF;
            END IF;

            IF v_action IS NULL THEN CONTINUE; END IF;
            IF v_action = 'COMPLETE' THEN
                -- Fires tr_promo_web_on_usage_status -> claim REDEEMED.
                UPDATE "PromotionUsages" SET status = 'COMPLETED', completed_at = now(), updated_at = now()
                 WHERE id = u.id AND status = 'APPLIED';
            ELSIF v_action LIKE 'CANCEL:%' THEN
                -- Fires tr_promo_web_on_usage_status -> claim CANCELLED, pass CANCELLED, slot back.
                PERFORM promo_cancel_usage_with_line(u.id, substr(v_action, 8));
            ELSIF v_action = 'SYNC_REDEEMED' THEN
                UPDATE "PromotionWebClaims" SET status = 'REDEEMED', redeemed_at = now(), updated_at = now()
                 WHERE id = r.id AND status = 'ACTIVE';
            ELSIF v_action = 'SYNC_CANCELLED' THEN
                UPDATE "PromotionWebClaims"
                   SET status = 'CANCELLED', ended_at = now(), end_reason = COALESCE(u.cancel_reason, 'USAGE_CANCELLED'), updated_at = now()
                 WHERE id = r.id AND status = 'ACTIVE';
                UPDATE "CustomerPromotionPasses" SET status = 'CANCELLED', status_reason = 'WEB_CLAIM_USAGE_CANCELLED', updated_at = now()
                 WHERE id = (SELECT pass_id FROM "PromotionWebClaims" WHERE id = r.id) AND status <> 'CANCELLED';
            END IF;
            PERFORM promo_web_refresh_stock_locked(r.campaign_id);
            v_out := v_out || jsonb_build_object(r.id::text, v_action);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'promo_web_heal_claims claim=% error=%', r.id, SQLERRM;
        END;
    END LOOP;
    RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.promo_web_expire_all()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- v17: repair ACTIVE claims whose order was split, abandoned or closed without the trigger.
    PERFORM promo_web_heal_claims();
    RETURN v_n;
END;
$function$;

-- ─── A3 + A5: configure ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promo_web_configure(p_campaign_id uuid, p_config jsonb, p_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    c        "PromotionCampaigns"%ROWTYPE;
    v_total  int := (p_config->>'totalQuantity')::int;
    v_alloc  int;
    v_reason text;
BEGIN
    SELECT * INTO c FROM "PromotionCampaigns" WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RETURN promo_err('CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.'); END IF;
    -- Only a new discount campaign can start web distribution (user D3, 09/10/2026).
    v_reason := promo_web_ineligible_reason(c.id);
    IF v_reason IS NOT NULL THEN
        RETURN promo_err('WEB_CLAIM_NOT_ELIGIBLE', CASE v_reason
                WHEN 'BENEFIT_TYPE' THEN 'Chỉ chương trình giảm % hoặc giảm tiền mới phát trên web được.'
                WHEN 'AUTO_ASSIGNMENT' THEN 'Chương trình tự động phát khi đơn hoàn tất không phát trên web được.'
                WHEN 'HAS_PASSES' THEN 'Chương trình đã phát voucher kiểu cũ. Hãy tạo chương trình mới để phát trên web.'
                WHEN 'CAMPAIGN_ENDED' THEN 'Chương trình đã kết thúc.'
                ELSE 'Chương trình không phát trên web được.' END,
            jsonb_build_object('data', jsonb_build_object('reason', v_reason)));
    END IF;
    IF v_total IS NULL OR v_total < 1 THEN RETURN promo_err('VALIDATION_ERROR', 'Tổng số voucher phải từ 1 trở lên.'); END IF;
    IF promo_web_expire_locked(c.id) > 0 THEN PERFORM promo_web_refresh_stock_locked(c.id); END IF;
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
$function$;

-- Stats: eligibility for the admin card (hide "enable" when not allowed) + stuck claims.
CREATE OR REPLACE FUNCTION public.promo_web_campaign_stats(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT promo_web_counts(c.id) || jsonb_build_object(
        'campaignId', c.id, 'distributionChannel', c.distribution_channel, 'campaignStatus', c.status,
        'publicSlug', c.public_slug, 'total', c.total_quantity,
        'available', CASE WHEN c.total_quantity IS NULL THEN NULL
                          ELSE GREATEST(0, c.total_quantity - (promo_web_counts(c.id)->>'allocated')::int) END,
        'paused', c.web_claim_paused, 'reservationMinutes', c.reservation_minutes,
        'maxOpenPerPhone', c.max_open_per_phone, 'maxTotalPerPhone', c.max_total_per_phone,
        'stockStatus', (SELECT status FROM "PromotionCampaignStock" WHERE campaign_id = c.id),
        'webIneligibleReason', promo_web_ineligible_reason(c.id),
        'staleActive', (SELECT count(*) FROM "PromotionWebClaims" w
                         WHERE w.campaign_id = c.id AND w.status = 'ACTIVE' AND w.activated_at < now() - interval '3 days'))
      FROM "PromotionCampaigns" c WHERE c.id = p_campaign_id;
$function$;

-- ─── A5: reserve refreshes the card after lazy expiry ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promo_web_reserve(p_slug text, p_device_hash text, p_ip_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- v17: every return below sees a fresh public card (no-op writes are skipped).
    PERFORM promo_web_expire_locked(c.id);
    PERFORM promo_web_refresh_stock_locked(c.id);

    -- Same device already holds a live reservation: hand it back (multi-tab, double click).
    SELECT * INTO v_claim FROM "PromotionWebClaims"
     WHERE campaign_id = c.id AND device_hash = p_device_hash AND status = 'RESERVED'
     ORDER BY reserved_at DESC LIMIT 1;
    IF FOUND THEN
        RETURN promo_ok(jsonb_build_object('reused', true, 'voucherCode', v_claim.voucher_code, 'status', 'RESERVED',
                        'expiresAt', promo_iso(v_claim.reservation_expires_at),
                        'stock', promo_web_public_stock_json(c.id)));
    END IF;

    IF c.status = 'ENDED' OR now() > c.valid_until THEN RETURN promo_err('CAMPAIGN_ENDED', 'Chương trình đã kết thúc.'); END IF;
    IF c.status <> 'ACTIVE' THEN RETURN promo_err('CAMPAIGN_INACTIVE', 'Chương trình đang tạm ngưng.'); END IF;
    IF now() < c.valid_from THEN RETURN promo_err('CAMPAIGN_NOT_STARTED', 'Chương trình chưa bắt đầu.'); END IF;
    IF c.web_claim_paused THEN RETURN promo_err('CAMPAIGN_PAUSED', 'Chương trình đang tạm dừng phát voucher.'); END IF;

    IF (SELECT count(*) FROM "PromotionWebClaims"
         WHERE campaign_id = c.id AND ip_hash = p_ip_hash AND status = 'RESERVED') >= c_max_open_per_ip THEN
        RETURN promo_err('RATE_LIMITED', 'Bạn đã lưu quá nhiều voucher. Vui lòng thử lại sau.');
    END IF;

    v_counts := promo_web_counts(c.id);
    IF (v_counts->>'allocated')::int >= c.total_quantity THEN
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
$function$;

-- ─── A3 + A6: activate ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.promo_web_activate(p_code text, p_booking_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    SELECT id, "billCode" AS bill_code, source, "customerId" AS customer_id, "customerPhone" AS phone,
           "bookingDate" AS booking_at
      INTO b FROM "Bookings" WHERE id = p_booking_id;
    IF NOT FOUND THEN RETURN promo_err('ORDER_NOT_FOUND', promo_error_message('ORDER_NOT_FOUND')); END IF;
    -- Web Booking only: checked at creation time, inside the web writer's transaction.
    -- Bookings.source is rewritten later by the counter, so it is never read again.
    IF b.source IS DISTINCT FROM 'WebBooking' OR b.bill_code NOT LIKE 'WB-%' THEN
        RETURN promo_err('WEB_BOOKING_REQUIRED', 'Voucher chỉ áp dụng cho đơn đặt qua Oria Web Booking.');
    END IF;
    -- The appointment must fall inside the campaign (user D2, 09/10/2026). VN wall clock.
    IF b.booking_at IS NULL OR (b.booking_at AT TIME ZONE 'Asia/Ho_Chi_Minh') > c.valid_until THEN
        RETURN promo_err('BOOKING_DATE_OUT_OF_RANGE', 'Ngày hẹn nằm ngoài thời gian chương trình.',
                         jsonb_build_object('data', jsonb_build_object('validUntil', promo_iso(c.valid_until))));
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

        -- promo_check_apply_ex lets a WEB_CLAIM pass through only for this booking (v17).
        PERFORM set_config('promo.web_activation_booking', p_booking_id, true);
        v_apply := promo_apply_pass(v_pass_id, p_booking_id, 'WEB_BOOKING', false, NULL);
        PERFORM set_config('promo.web_activation_booking', '', true);
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
$function$;

-- ─── A6: preview takes the appointment time ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS promo_web_preview(text, jsonb);
CREATE OR REPLACE FUNCTION promo_web_preview(p_code text, p_items jsonb, p_booking_at timestamp DEFAULT NULL)
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
    -- Same rule as promo_web_activate (VN wall-clock appointment, user D2).
    IF p_booking_at IS NOT NULL AND (p_booking_at AT TIME ZONE 'Asia/Ho_Chi_Minh') > c.valid_until THEN
        RETURN promo_err('BOOKING_DATE_OUT_OF_RANGE', 'Ngày hẹn nằm ngoài thời gian chương trình.',
                         jsonb_build_object('data', jsonb_build_object('validUntil', promo_iso(c.valid_until))));
    END IF;
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
        'validUntil', promo_iso(c.valid_until),
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

-- ─── Grants: everything here is server-only (service_role) ───────────────────────────────

REVOKE ALL ON FUNCTION promo_web_ineligible_reason(uuid), promo_web_guard_pass_insert(),
    promo_has_real_items(text[]), promo_cancel_usage_with_line(uuid, text), promo_web_heal_claims(),
    promo_web_preview(text, jsonb, timestamp)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION promo_web_ineligible_reason(uuid), promo_has_real_items(text[]),
    promo_cancel_usage_with_line(uuid, text), promo_web_heal_claims(), promo_web_preview(text, jsonb, timestamp)
    TO service_role;
