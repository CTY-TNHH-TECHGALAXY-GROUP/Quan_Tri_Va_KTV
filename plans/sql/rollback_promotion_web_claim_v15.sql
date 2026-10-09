-- Rollback of 20261008100000_promotion_web_claim_v15.sql (web-claim e-vouchers)
-- and 20261008150000_webbooking_commit_with_voucher_v16.sql (writer wrapper).
-- Switch the WebBooking route back to webbooking_commit_booking BEFORE running this.
-- Safe to run before any web voucher has been ACTIVATED. If some were activated, their
-- passes / usages / KM lines on bookings stay (they are normal engine rows) — only the
-- claim tracking is removed. Check first:
--   SELECT status, count(*) FROM "PromotionWebClaims" GROUP BY 1;
BEGIN;

DROP FUNCTION IF EXISTS public.webbooking_commit_booking_with_voucher(JSONB, JSONB, TEXT);
DROP FUNCTION IF EXISTS promo_web_preview(text, jsonb);

-- v16 split the discount formula into promo_compute_discount_core: restore the v14 body first.
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
    -- Percent discount = on the WHOLE order incl. Phòng riêng (user 05/10/2026); otherwise the
    -- configured scope, or the whole order on an override where no service met the conditions.
    IF p.benefit_type = 'PERCENT_DISCOUNT' OR c.benefit_config->>'discountScope' = 'ORDER'
       OR (p_override_conditions AND COALESCE(v_base, 0) = 0) THEN
        v_base := (promo_order_minutes(p_booking_id, '{}'::jsonb)->>'paidAmount')::numeric;
    END IF;
    v_disc := CASE WHEN p.benefit_type = 'PERCENT_DISCOUNT' THEN round(v_base * p.benefit_value / 100) ELSE p.benefit_value END;
    v_cap := NULLIF(c.benefit_config->>'maxDiscountAmount', '')::numeric;
    IF v_cap IS NOT NULL THEN v_disc := LEAST(v_disc, v_cap); END IF;
    RETURN GREATEST(0, LEAST(v_disc, GREATEST(COALESCE(v_total, 0), 0)));
END;
$$;
DROP FUNCTION IF EXISTS promo_compute_discount_core(uuid, text, numeric, text, boolean);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'promo_web_expire_job';
    END IF;
END $$;

DROP TRIGGER IF EXISTS tr_promo_web_on_usage_status ON "PromotionUsages";
DROP TRIGGER IF EXISTS tr_promo_web_on_campaign_change ON "PromotionCampaigns";

DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'promo\_web\_%' LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s', f.sig);
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'PromotionCampaignStock') THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE "PromotionCampaignStock";
    END IF;
END $$;
DROP TABLE IF EXISTS "PromotionCampaignStock";
DROP TABLE IF EXISTS "PromotionWebClaims";

-- Passes issued by the web stay valid history; only restore the CHECK when none exist.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "CustomerPromotionPasses" WHERE issue_source = 'WEB_CLAIM') THEN
        ALTER TABLE "CustomerPromotionPasses" DROP CONSTRAINT IF EXISTS promo_pass_issue_source_chk;
        ALTER TABLE "CustomerPromotionPasses" ADD CONSTRAINT promo_pass_issue_source_chk CHECK (issue_source IN ('AUTO', 'MANUAL'));
    ELSE
        RAISE NOTICE 'WEB_CLAIM passes exist: keep issue_source CHECK';
    END IF;
END $$;

ALTER TABLE "PromotionCampaigns" DROP CONSTRAINT IF EXISTS promo_campaign_distribution_chk;
DROP INDEX IF EXISTS uq_promo_campaign_public_slug;
ALTER TABLE "PromotionCampaigns"
    DROP COLUMN IF EXISTS distribution_channel,
    DROP COLUMN IF EXISTS total_quantity,
    DROP COLUMN IF EXISTS reservation_minutes,
    DROP COLUMN IF EXISTS max_open_per_phone,
    DROP COLUMN IF EXISTS max_total_per_phone,
    DROP COLUMN IF EXISTS web_claim_paused,
    DROP COLUMN IF EXISTS public_slug;

DELETE FROM "SystemConfigs" WHERE key = 'promotion_web_claim_enabled';
DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261008100000', '20261008150000');
COMMIT;
