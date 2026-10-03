-- =============================================================================
-- Promotion Engine v6 — human-readable menu scope for the customer page.
-- Request from Agent B (promotion_frontend_yeu_cau_backend.md §8.1): the public
-- voucher only carried menu CODES (NHP); the /voucher page must show names.
--
--   promo_scope_labels(config) → jsonb text array, e.g. ["Menu VIP"] or
--   ["Menu Standard · Body", "Menu Standard · Foot"]:
--     menus      → SystemConfigs.promotion_menu_labels (fallback: the code)
--                  + " · <Category>" for each selected category, only when the categories
--                  really narrow the menu (NHP + VIP_MENU covering all VIP services → "Menu VIP")
--     categories only → category names (Title Case)
--     serviceIds → service names (nameVN → nameEN → id)
--   Empty scope → [] (the page shows "all menus").
-- Exposed as public voucher `menuLabels` and campaign `applicableMenus.labels`.
-- =============================================================================

-- 'VIP_MENU' → 'Vip Menu', 'EAR CLEAN' → 'Ear Clean'
CREATE OR REPLACE FUNCTION promo_category_label(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT initcap(lower(replace(trim(p_code), '_', ' ')));
$$;

CREATE OR REPLACE FUNCTION promo_scope_labels(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg jsonb := COALESCE(p_config, '{}'::jsonb);
    v_map jsonb;
    v_menus text[] := ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(COALESCE(NULLIF(v_cfg->'serviceIdPrefixes', 'null'::jsonb), '[]'::jsonb)) x);
    v_cats text[] := ARRAY(SELECT upper(trim(x)) FROM jsonb_array_elements_text(COALESCE(NULLIF(v_cfg->'serviceCategories', 'null'::jsonb), '[]'::jsonb)) x);
    v_ids text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(v_cfg->'serviceIds', 'null'::jsonb), '[]'::jsonb)));
    v_out text[] := ARRAY[]::text[];
    m text;
    cat text;
    v_menu_label text;
    v_covers boolean;
BEGIN
    SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value
                WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb END
      INTO v_map FROM "SystemConfigs" WHERE key = 'promotion_menu_labels';
    v_map := COALESCE(v_map, '{}'::jsonb);

    FOREACH m IN ARRAY v_menus LOOP
        v_menu_label := COALESCE(NULLIF(v_map->>m, ''), m);
        -- Categories that cover every active service of the menu add nothing (e.g. NHP + VIP_MENU → "Menu VIP").
        v_covers := cardinality(v_cats) = 0 OR NOT EXISTS (
            SELECT 1 FROM "Services" s
             WHERE COALESCE(s."isActive", true) AND NOT COALESCE(s.is_promotion, false) AND NOT COALESCE(s.is_utility, false)
               AND promo_service_menu(s.id) = m
               AND NOT (promo_service_categories(s.category) && v_cats));
        IF v_covers THEN
            v_out := v_out || v_menu_label;
        ELSE
            FOREACH cat IN ARRAY v_cats LOOP
                v_out := v_out || (v_menu_label || ' · ' || promo_category_label(cat));
            END LOOP;
        END IF;
    END LOOP;
    IF cardinality(v_menus) = 0 THEN
        v_out := v_out || ARRAY(SELECT promo_category_label(x) FROM unnest(v_cats) x);
    END IF;
    IF cardinality(v_ids) > 0 THEN
        v_out := v_out || ARRAY(
            SELECT COALESCE(NULLIF(s."nameVN", ''), NULLIF(s."nameEN", ''), i.id)
              FROM unnest(v_ids) WITH ORDINALITY AS i(id, ord)
              LEFT JOIN "Services" s ON s.id = i.id
             ORDER BY i.ord);
    END IF;
    RETURN to_jsonb(v_out);
EXCEPTION WHEN OTHERS THEN
    RETURN to_jsonb(v_menus);   -- bad label config must never break the customer page
END;
$$;

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
        'applicableMenus', jsonb_build_object(
            'menus', COALESCE(c.qualification_config->'serviceIdPrefixes', '[]'::jsonb),
            'categories', COALESCE(c.qualification_config->'serviceCategories', '[]'::jsonb),
            'serviceIds', COALESCE(c.qualification_config->'serviceIds', '[]'::jsonb),
            'allMenus', promo_scope_is_empty(c.qualification_config),
            'labels', promo_scope_labels(c.qualification_config)),
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

CREATE OR REPLACE FUNCTION promo_public_voucher_by_token(p_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id uuid;
    j jsonb;
    v_menus jsonb;
    v_labels jsonb;
BEGIN
    IF NULLIF(trim(COALESCE(p_qr_token, '')), '') IS NULL OR length(p_qr_token) > 200 THEN
        RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND'));
    END IF;
    SELECT id INTO v_id FROM "CustomerPromotionPasses" WHERE qr_token = trim(p_qr_token);
    IF v_id IS NULL THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    j := promo_pass_json(v_id, true);
    SELECT promo_campaign_json(c.id)->'applicableMenus', promo_scope_labels(c.qualification_config) INTO v_menus, v_labels
      FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id WHERE p.id = v_id;
    RETURN promo_ok(jsonb_build_object(
        'campaignName', j#>'{campaign,name}',
        'benefit', jsonb_build_object('type', j#>'{benefit,type}', 'value', j#>'{benefit,value}'),
        'usage', jsonb_build_object('type', j#>'{usage,type}', 'limit', j#>'{usage,limit}',
                                    'maxPerOrder', j#>'{usage,maxPerOrder}', 'usedCount', j#>'{usage,usedCount}'),
        'validFrom', j->'validFrom',
        'validUntil', j->'validUntil',
        'voucherCode', j->'voucherCode',
        'voucherPrefix', split_part(j->>'voucherCode', '-', 1),
        'customerName', j#>'{customer,name}',
        'status', j->'status',
        'effectiveStatus', j->'effectiveStatus',
        'applicableMenus', v_menus,
        'menuLabels', v_labels,
        'qrToken', CASE WHEN j->>'effectiveStatus' IN ('ACTIVE', 'NOT_STARTED') THEN j->'qrToken' END));
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
