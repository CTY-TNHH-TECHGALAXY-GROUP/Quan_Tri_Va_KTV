-- Baseline (TEST, 2026-10-08T22:14:02.449Z) of functions touched by v17

-- ===== promo_apply_pass
CREATE OR REPLACE FUNCTION public.promo_apply_pass(p_pass_id uuid, p_booking_id text, p_staff_id text, p_override_conditions boolean DEFAULT false, p_override_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ===== promo_cancel_usage
CREATE OR REPLACE FUNCTION public.promo_cancel_usage(p_usage_id uuid, p_staff_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ===== promo_check_apply_ex
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
$function$
;

-- ===== promo_insert_pass
CREATE OR REPLACE FUNCTION public.promo_insert_pass(p_campaign_id uuid, p_customer_id text, p_source_booking_id text, p_issue_source text, p_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ===== promo_issue_bulk
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
$function$
;

-- ===== promo_issue_for_booking
CREATE OR REPLACE FUNCTION public.promo_issue_for_booking(p_booking_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ===== promo_issue_manual
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
$function$
;

-- ===== promo_on_booking_status
CREATE OR REPLACE FUNCTION public.promo_on_booking_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- Never block closing / cancelling the order; the error goes to the Postgres logs.
        RAISE WARNING 'promo trigger booking_status:% booking=% error=%', NEW.status::text, NEW.id, SQLERRM;
    END;
    RETURN NULL;
END;
$function$
;

-- ===== promo_on_item_cancel
CREATE OR REPLACE FUNCTION public.promo_on_item_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        RAISE WARNING 'promo trigger item_cancel booking=% item=% error=%', v_row."bookingId", v_row.id, SQLERRM;
    END;
    RETURN NULL;
END;
$function$
;

-- ===== promo_set_pass_status
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
$function$
;

-- ===== promo_web_activate
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
$function$
;

-- ===== promo_web_campaign_stats
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
        'stockStatus', (SELECT status FROM "PromotionCampaignStock" WHERE campaign_id = c.id))
      FROM "PromotionCampaigns" c WHERE c.id = p_campaign_id;
$function$
;

-- ===== promo_web_configure
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
$function$
;

-- ===== promo_web_counts
CREATE OR REPLACE FUNCTION public.promo_web_counts(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'reserved',  count(*) FILTER (WHERE status = 'RESERVED'),
        'active',    count(*) FILTER (WHERE status = 'ACTIVE'),
        'redeemed',  count(*) FILTER (WHERE status = 'REDEEMED'),
        'expired',   count(*) FILTER (WHERE status = 'EXPIRED'),
        'cancelled', count(*) FILTER (WHERE status = 'CANCELLED'),
        'allocated', count(*) FILTER (WHERE status IN ('RESERVED', 'ACTIVE', 'REDEEMED')))
    FROM "PromotionWebClaims" WHERE campaign_id = p_campaign_id;
$function$
;

-- ===== promo_web_expire_all
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
    RETURN v_n;
END;
$function$
;

-- ===== promo_web_expire_locked
CREATE OR REPLACE FUNCTION public.promo_web_expire_locked(p_campaign_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
    UPDATE "PromotionWebClaims"
       SET status = 'EXPIRED', ended_at = now(), end_reason = 'RESERVATION_EXPIRED', updated_at = now()
     WHERE campaign_id = p_campaign_id AND status = 'RESERVED' AND reservation_expires_at <= now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$function$
;

-- ===== promo_web_on_usage_status
CREATE OR REPLACE FUNCTION public.promo_web_on_usage_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ===== promo_web_preview
CREATE OR REPLACE FUNCTION public.promo_web_preview(p_code text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'eligible', (v_eval->>'met')::boolean,
        'unmetReasons', v_unmet,
        'benefitType', c.benefit_type,
        'benefitValue', c.benefit_value,
        'discountAmount', v_discount,
        'appliedMinutes', v_minutes,
        'subtotalAmount', v_subtotal,
        'totalAmount', v_subtotal - v_discount));
END;
$function$
;

-- ===== promo_web_public_stock_json
CREATE OR REPLACE FUNCTION public.promo_web_public_stock_json(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object('slug', public_slug, 'status', status, 'benefitType', benefit_type,
                              'benefitValue', benefit_value, 'total', total, 'available', available, 'version', version,
                              'validFrom', promo_iso(valid_from), 'validUntil', promo_iso(valid_until))
      FROM "PromotionCampaignStock" WHERE campaign_id = p_campaign_id;
$function$
;

-- ===== promo_web_refresh_stock_locked
CREATE OR REPLACE FUNCTION public.promo_web_refresh_stock_locked(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ===== promo_web_release
CREATE OR REPLACE FUNCTION public.promo_web_release(p_campaign_id uuid, p_claim_id uuid, p_reason text, p_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- ===== promo_web_reserve
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
$function$
;

-- ===== promo_web_voucher_status
CREATE OR REPLACE FUNCTION public.promo_web_voucher_status(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
