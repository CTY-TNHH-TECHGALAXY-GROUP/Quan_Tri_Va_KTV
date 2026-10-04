-- =============================================================================
-- ROLLBACK Promotion Engine v1–v12 (plans/plan_chay_migration_promotion_len_db_that.md §5)
-- Run in ONE transaction. Step 1 alone (drop triggers) = quick, data-preserving rollback.
-- Steps 2+ DELETE promotion data: back up PromotionCampaigns / CustomerPromotionPasses /
-- PromotionUsages first if any real voucher was issued.
-- =============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Engine stops reacting to bookings
DROP TRIGGER IF EXISTS tr_promo_on_booking_status ON "Bookings";
DROP TRIGGER IF EXISTS tr_promo_on_item_cancel ON "BookingItems";
DROP TRIGGER IF EXISTS tr_promo_on_item_delete ON "BookingItems";

-- 2. Daily expiry job
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promo_expire_passes_job') THEN
        PERFORM cron.unschedule('promo_expire_passes_job');
    END IF;
END $$;

-- 3. Functions
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'promo\_%' LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', f.sig);
    END LOOP;
END $$;

-- 4. Tables
DROP TABLE IF EXISTS "PromotionUsages";
DROP TABLE IF EXISTS "CustomerPromotionPasses";
DROP TABLE IF EXISTS "PromotionCampaigns";
DROP TABLE IF EXISTS "PromotionIssueErrors";

-- 5. Services column (only when no engine service KM#### exists)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM "Services" WHERE id ~ '^KM[0-9]+$') THEN
        ALTER TABLE "Services" DROP COLUMN IF EXISTS is_promotion;
    ELSE
        RAISE NOTICE 'Services KM#### exist: keep column is_promotion';
    END IF;
END $$;

-- 6. Settings + migration history
DELETE FROM "SystemConfigs" WHERE key LIKE 'promotion\_%';
DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261002120500','20261002180000','20261002200000','20261003090500','20261003120000','20261003150000',
                   '20261003180000','20261003210000','20261004090000','20261004120000','20261004150500','20261004180000');
COMMIT;
