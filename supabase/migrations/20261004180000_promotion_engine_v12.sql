-- =============================================================================
-- Promotion Engine v12 — e-voucher English first + campaign text in 5 languages
-- Plan: plans/plan_promotion_voucher_ngon_ngu.md (user 04/10/2026).
--   * PromotionCampaigns.name / description = the ENGLISH text (required name, as before).
--     name_i18n / description_i18n = optional translations {vi, cn, jp, kr}; a missing
--     language falls back to English. Display text only — editable after issuing.
--   * Customer language fallback vi → en (email when the customer has no booking language).
--   * Service names on vouchers / condition text / menu catalogue: nameEN first.
--   Only ADDS columns with defaults; no existing data is changed.
-- =============================================================================

ALTER TABLE "PromotionCampaigns"
    ADD COLUMN IF NOT EXISTS name_i18n jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS description_i18n jsonb NOT NULL DEFAULT '{}'::jsonb;
-- CHECK cannot hold a subquery: key rule lives in an IMMUTABLE helper.
CREATE OR REPLACE FUNCTION promo_i18n_keys_ok(p_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_typeof(p_value) = 'object'
       AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('vi', 'cn', 'jp', 'kr'));
$$;
ALTER TABLE "PromotionCampaigns" DROP CONSTRAINT IF EXISTS promo_campaign_i18n_chk;
ALTER TABLE "PromotionCampaigns" ADD CONSTRAINT promo_campaign_i18n_chk
    CHECK (promo_i18n_keys_ok(name_i18n) AND promo_i18n_keys_ok(description_i18n));

-- Keep only vi/cn/jp/kr string values, trimmed, non-empty, at most p_max chars.
-- 'en' is the base column itself, so it is never stored here.
CREATE OR REPLACE FUNCTION promo_i18n_clean(p_value jsonb, p_max int)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_object_agg(k, left(trim(v), p_max)), '{}'::jsonb)
      FROM jsonb_each_text(CASE WHEN jsonb_typeof(p_value) = 'object' THEN p_value ELSE '{}'::jsonb END) AS e(k, v)
     WHERE k IN ('vi', 'cn', 'jp', 'kr') AND trim(COALESCE(v, '')) <> '';
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
        campaign_code, name, description, name_i18n, description_i18n, benefit_type, benefit_value, benefit_config,
        valid_from, valid_until, usage_type, usage_limit, max_usage_per_customer, max_usage_per_order,
        qualification_type, qualification_value, qualification_config, apply_conditions, assignment_mode,
        one_pass_per_customer, voucher_prefix, validity_type, validity_days, status, created_by)
    VALUES (
        upper(p_payload->>'campaign_code'),
        p_payload->>'name',
        NULLIF(p_payload->>'description', ''),
        promo_i18n_clean(p_payload->'name_i18n', 120),
        promo_i18n_clean(p_payload->'description_i18n', 2000),
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

CREATE OR REPLACE FUNCTION promo_update_campaign(p_campaign_id uuid, p_payload jsonb, p_staff_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    c "PromotionCampaigns"%ROWTYPE;
    v_rule_keys constant text[] := ARRAY['benefit_type','benefit_value','benefit_config','valid_from','usage_type',
        'usage_limit','max_usage_per_customer','max_usage_per_order','assignment_mode','one_pass_per_customer',
        'voucher_prefix','campaign_code','validity_type','validity_days'];
    k text;
    v_changed text[] := ARRAY[]::text[];
    v_conds jsonb;
    v_mode text;
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
    v_conds := promo_payload_conditions(p_payload, c);
    IF v_conds IS NOT NULL AND v_conds IS DISTINCT FROM c.apply_conditions THEN
        v_changed := v_changed || 'apply_conditions'::text;
    END IF;
    IF c.status <> 'DRAFT' AND cardinality(v_changed) > 0 THEN
        RETURN promo_err('CAMPAIGN_LOCKED', 'Chỉ sửa được quy tắc khi chương trình còn ở trạng thái Nháp',
                         jsonb_build_object('data', jsonb_build_object('fields', to_jsonb(v_changed))));
    END IF;
    v_mode := COALESCE(p_payload->>'assignment_mode', c.assignment_mode);
    IF v_mode = 'AUTO' AND jsonb_array_length(COALESCE(v_conds, c.apply_conditions)->'conditions') = 0 THEN
        RETURN promo_err('CAMPAIGN_INVALID', 'Phát tự động cần ít nhất một điều kiện');
    END IF;

    UPDATE "PromotionCampaigns" SET
        campaign_code          = COALESCE(upper(NULLIF(p_payload->>'campaign_code', '')), campaign_code),
        name                   = COALESCE(NULLIF(p_payload->>'name', ''), name),
        description            = CASE WHEN p_payload ? 'description' THEN NULLIF(p_payload->>'description', '') ELSE description END,
        -- Display text only: editable even after vouchers were issued (not a rule key).
        name_i18n              = CASE WHEN p_payload ? 'name_i18n' THEN promo_i18n_clean(p_payload->'name_i18n', 120) ELSE name_i18n END,
        description_i18n       = CASE WHEN p_payload ? 'description_i18n' THEN promo_i18n_clean(p_payload->'description_i18n', 2000) ELSE description_i18n END,
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
        apply_conditions       = COALESCE(v_conds, apply_conditions),
        qualification_config   = CASE WHEN v_conds IS NOT NULL THEN promo_conditions_scope(v_conds) ELSE qualification_config END,
        assignment_mode        = COALESCE(p_payload->>'assignment_mode', assignment_mode),
        one_pass_per_customer  = COALESCE((p_payload->>'one_pass_per_customer')::boolean, one_pass_per_customer),
        voucher_prefix         = COALESCE(upper(NULLIF(p_payload->>'voucher_prefix', '')), voucher_prefix),
        validity_type          = COALESCE(p_payload->>'validity_type', validity_type),
        validity_days          = CASE WHEN p_payload ? 'validity_days' THEN NULLIF(p_payload->>'validity_days', '')::int ELSE validity_days END,
        updated_at             = now()
    WHERE id = p_campaign_id;

    IF p_payload ? 'valid_until' AND promo_campaign_key_changed(c, 'valid_until', p_payload -> 'valid_until')
       AND c.validity_type = 'CAMPAIGN_PERIOD' THEN
        UPDATE "CustomerPromotionPasses" SET valid_until = (p_payload->>'valid_until')::timestamptz, updated_at = now()
        WHERE campaign_id = p_campaign_id AND status IN ('ACTIVE', 'EXPIRED') AND superseded_at IS NULL
          AND (p_payload->>'valid_until')::timestamptz > valid_from;
        UPDATE "CustomerPromotionPasses" SET status = 'ACTIVE', status_reason = NULL, updated_at = now()
        WHERE campaign_id = p_campaign_id AND status = 'EXPIRED' AND superseded_at IS NULL AND valid_until > now();
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

CREATE OR REPLACE FUNCTION promo_campaign_json(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id', c.id, 'campaignCode', c.campaign_code, 'name', c.name, 'description', c.description,
        'nameI18n', c.name_i18n, 'descriptionI18n', c.description_i18n,
        'benefit', jsonb_build_object('type', c.benefit_type, 'value', c.benefit_value,
                                      'config', c.benefit_config, 'serviceId', c.benefit_service_id),
        'usage', jsonb_build_object('type', c.usage_type, 'limit', c.usage_limit,
                                    'maxPerOrder', c.max_usage_per_order, 'maxPerCustomer', c.max_usage_per_customer),
        'qualification', jsonb_build_object('type', c.qualification_type, 'value', c.qualification_value,
                                            'config', c.qualification_config),
        'applyConditions', c.apply_conditions,
        'conditionsSummary', promo_conditions_summary(c.apply_conditions),
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
        'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'nameI18n', c.name_i18n, 'campaignCode', c.campaign_code, 'status', c.status),
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
        'reminderSentAt', promo_iso(p.reminder_sent_at),
        'supersededAt', promo_iso(p.superseded_at),
        'supersededBy', p.superseded_by,
        'endedAt', promo_iso(promo_pass_ended_at(p, v_eff)),
        -- What the card must say ("Menu VIP · từ 90 phút"): same config the apply check uses.
        'conditionsSummary', promo_conditions_summary(c.apply_conditions)
    );
END;
$$;

CREATE OR REPLACE FUNCTION promo_public_voucher_by_token(p_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id uuid;
    j jsonb;
    v_menus jsonb;
    v_labels jsonb;
    v_summary jsonb;
BEGIN
    IF NULLIF(trim(COALESCE(p_qr_token, '')), '') IS NULL OR length(p_qr_token) > 200 THEN
        RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND'));
    END IF;
    SELECT id INTO v_id FROM "CustomerPromotionPasses" WHERE qr_token = trim(p_qr_token);
    IF v_id IS NULL THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    j := promo_pass_json(v_id, true);
    SELECT promo_campaign_json(c.id)->'applicableMenus', promo_scope_labels(c.qualification_config), promo_conditions_summary(c.apply_conditions)
      INTO v_menus, v_labels, v_summary
      FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id WHERE p.id = v_id;
    RETURN promo_ok(jsonb_build_object(
        'campaignName', j#>'{campaign,name}',
        'campaignNameI18n', COALESCE(j#>'{campaign,nameI18n}', '{}'::jsonb),
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
        'conditionsSummary', v_summary,
        'qrToken', CASE WHEN j->>'effectiveStatus' IN ('ACTIVE', 'NOT_STARTED') THEN j->'qrToken' END));
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
        'campaignDescription', c.description,
        'campaignDescriptionI18n', c.description_i18n,
        'conditionsSummary', promo_conditions_summary(c.apply_conditions)));
END;
$$;

CREATE OR REPLACE FUNCTION promo_conditions_summary(p_conditions jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_map jsonb;
    v_out jsonb := '[]'::jsonb;
    c jsonb;
BEGIN
    SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value
                WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb END
      INTO v_map FROM "SystemConfigs" WHERE key = 'promotion_menu_labels';
    v_map := COALESCE(v_map, '{}'::jsonb);
    FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_conditions->'conditions', '[]'::jsonb)) LOOP
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'menus', COALESCE((SELECT jsonb_agg(COALESCE(NULLIF(v_map->>m, ''), m)) FROM jsonb_array_elements_text(c->'menus') m), '[]'::jsonb),
            -- Categories that cover every active service of the chosen menus add nothing
            -- (NHP + VIP_MENU → "Menu VIP"), same rule as promo_scope_labels.
            'categories', CASE WHEN promo_categories_cover_menus(c->'menus', c->'categories') THEN '[]'::jsonb
                               ELSE COALESCE((SELECT jsonb_agg(promo_category_label(x)) FROM jsonb_array_elements_text(c->'categories') x), '[]'::jsonb) END,
            'services', COALESCE((SELECT jsonb_agg(COALESCE(NULLIF(s."nameEN", ''), NULLIF(s."nameVN", ''), x) ORDER BY o)
                                    FROM jsonb_array_elements_text(c->'serviceIds') WITH ORDINALITY AS t(x, o)
                                    LEFT JOIN "Services" s ON s.id = t.x), '[]'::jsonb),
            'minMinutes', c->'minMinutes',
            'minOrderAmount', c->'minOrderAmount'));
    END LOOP;
    RETURN jsonb_build_object('match', upper(COALESCE(p_conditions->>'match', 'ALL')), 'conditions', v_out);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('match', 'ALL', 'conditions', '[]'::jsonb);
END;
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
            SELECT COALESCE(NULLIF(s."nameEN", ''), NULLIF(s."nameVN", ''), i.id)
              FROM unnest(v_ids) WITH ORDINALITY AS i(id, ord)
              LEFT JOIN "Services" s ON s.id = i.id
             ORDER BY i.ord);
    END IF;
    RETURN to_jsonb(v_out);
EXCEPTION WHEN OTHERS THEN
    RETURN to_jsonb(v_menus);   -- bad label config must never break the customer page
END;
$$;

CREATE OR REPLACE FUNCTION promo_menu_catalog()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_labels jsonb;
    v_out jsonb;
BEGIN
    SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value
                WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb END
      INTO v_labels FROM "SystemConfigs" WHERE key = 'promotion_menu_labels';
    v_labels := COALESCE(v_labels, '{}'::jsonb);

    WITH svc AS (
        SELECT s.id, COALESCE(NULLIF(s."nameEN", ''), NULLIF(s."nameVN", ''), s.id) AS name, s.category,
               promo_service_menu(s.id) AS menu, promo_service_categories(s.category) AS cats
          FROM "Services" s
         WHERE COALESCE(s."isActive", true) AND NOT COALESCE(s.is_promotion, false) AND NOT COALESCE(s.is_utility, false)
           AND promo_service_menu(s.id) IS NOT NULL
    ), cat AS (
        SELECT menu, c AS code, count(*) AS n, initcap(lower(c)) AS label
          FROM svc, unnest(svc.cats) c
         GROUP BY menu, c
    )
    SELECT COALESCE(jsonb_agg(m ORDER BY m->>'code'), '[]'::jsonb) INTO v_out
      FROM (
        SELECT jsonb_build_object(
                   'code', svc.menu,
                   'label', COALESCE(v_labels->>svc.menu, svc.menu),
                   'serviceCount', count(*),
                   'categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', cat.code, 'label', COALESCE(cat.label, cat.code),
                                                                               'serviceCount', cat.n) ORDER BY cat.code)
                                             FROM cat WHERE cat.menu = svc.menu), '[]'::jsonb),
                   'services', jsonb_agg(jsonb_build_object('id', svc.id, 'name', svc.name, 'category', svc.category,
                                                            'categoryCodes', to_jsonb(svc.cats)) ORDER BY svc.id)) AS m
          FROM svc GROUP BY svc.menu
      ) t;
    RETURN promo_ok(v_out);
END;
$$;

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
    RETURN CASE WHEN v IN ('vi', 'en', 'cn', 'jp', 'kr') THEN v ELSE 'en' END;
END;
$$;
