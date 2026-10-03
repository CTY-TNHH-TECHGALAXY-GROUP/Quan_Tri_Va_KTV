-- =============================================================================
-- Promotion Engine v9 — voucher prefix derived from the campaign code when the admin
-- leaves it empty (user 03/10/2026). OCT_FREE30_2026 → OCT, SUMMER-VIP → SUMMER;
-- taken by another campaign → OCT2, OCT3… Stored at creation, never recomputed.
-- =============================================================================

CREATE OR REPLACE FUNCTION promo_derive_voucher_prefix(p_campaign_code text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_base text := left(COALESCE(substring(upper(COALESCE(p_campaign_code, '')) FROM '[A-Z0-9]+'), ''), 8);
    v_try text;
    n int := 1;
BEGIN
    IF length(v_base) < 2 THEN v_base := 'KM'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('promo_voucher_prefix'));
    v_try := v_base;
    WHILE EXISTS (SELECT 1 FROM "PromotionCampaigns" WHERE voucher_prefix = v_try) LOOP
        n := n + 1;
        v_try := left(v_base, 10 - length(n::text)) || n;
    END LOOP;
    RETURN v_try;
END;
$$;

CREATE OR REPLACE FUNCTION promo_create_campaign(p_payload jsonb, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id uuid;
    v_empty "PromotionCampaigns";
    v_conds jsonb;
    v_prefix text;
BEGIN
    IF COALESCE(p_payload->>'benefit_type', '') IN ('FREE_SERVICE', 'FREE_UPGRADE') THEN
        RETURN promo_err('BENEFIT_NOT_SUPPORTED', 'Loại ưu đãi này chưa được hỗ trợ');
    END IF;
    IF EXISTS (SELECT 1 FROM "PromotionCampaigns" WHERE campaign_code = upper(p_payload->>'campaign_code')) THEN
        RETURN promo_err('CAMPAIGN_CODE_EXISTS', 'Mã chương trình đã tồn tại');
    END IF;
    v_conds := COALESCE(promo_payload_conditions(p_payload, v_empty), '{"match":"ALL","conditions":[]}'::jsonb);
    -- Admin may leave the prefix empty: derive it from the campaign code (unique, stored once).
    v_prefix := CASE WHEN NULLIF(trim(COALESCE(p_payload->>'voucher_prefix', '')), '') IS NOT NULL
                     THEN upper(trim(p_payload->>'voucher_prefix'))
                     ELSE promo_derive_voucher_prefix(p_payload->>'campaign_code') END;
    IF COALESCE(p_payload->>'assignment_mode', 'MANUAL_ONLY') = 'AUTO' AND jsonb_array_length(v_conds->'conditions') = 0 THEN
        RETURN promo_err('CAMPAIGN_INVALID', 'Phát tự động cần ít nhất một điều kiện');
    END IF;

    INSERT INTO "PromotionCampaigns" (
        campaign_code, name, description, benefit_type, benefit_value, benefit_config,
        valid_from, valid_until, usage_type, usage_limit, max_usage_per_customer, max_usage_per_order,
        qualification_type, qualification_value, qualification_config, apply_conditions, assignment_mode,
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
        promo_conditions_scope(v_conds),
        v_conds,
        COALESCE(p_payload->>'assignment_mode', 'MANUAL_ONLY'),
        COALESCE((p_payload->>'one_pass_per_customer')::boolean, true),
        v_prefix,
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
