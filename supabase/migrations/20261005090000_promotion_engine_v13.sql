-- =============================================================================
-- Promotion Engine v13 — apply condition by ORDER SOURCE (user 05/10/2026, gấp)
-- Plan: plans/plan_promotion_dieu_kien_nguon_don.md
--   promo_booking_channel(booking) = ONE channel, first match wins:
--     WEB_BOOKING      id / billCode starts 'WB-', or source WEB_BOOKING / WebBooking / HOME_BOOKING
--     ADVANCE_BOOKING  id starts 'BK-' (internal advance booking), notes WEB_ADVANCE_BOOKING, source *_BOOKING
--     WALK_IN          everything else (*_WALK_IN, NDK…, *_MENU)
--   (Bookings.source alone is unreliable: web orders are stored as STANDARD_WALK_IN since ~23/09.)
--   Each apply condition may carry sources: [] = any source. Counter can still override.
--   No data change; existing campaigns have no sources → unchanged behaviour.
-- =============================================================================

CREATE OR REPLACE FUNCTION promo_booking_channel(p_booking_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE
        WHEN b.id LIKE 'WB-%' OR COALESCE(b."billCode", '') LIKE 'WB-%'
             OR b.source IN ('WEB_BOOKING', 'WebBooking', 'HOME_BOOKING') THEN 'WEB_BOOKING'
        WHEN b.id LIKE 'BK-%' OR COALESCE(b.notes, '') LIKE '%WEB_ADVANCE_BOOKING%'
             OR b.source LIKE '%\_BOOKING' ESCAPE '\' THEN 'ADVANCE_BOOKING'
        ELSE 'WALK_IN'
    END
    FROM "Bookings" b WHERE b.id = p_booking_id;
$$;

-- Staff-facing (Vietnamese) label, used in unmet reasons; customer wording is in TS (5 languages).
CREATE OR REPLACE FUNCTION promo_channel_label(p_channel text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_channel WHEN 'WEB_BOOKING' THEN 'Web Booking' WHEN 'ADVANCE_BOOKING' THEN 'Đặt trước'
                          WHEN 'WALK_IN' THEN 'Khách tại quầy' ELSE COALESCE(p_channel, '?') END;
$$;

CREATE OR REPLACE FUNCTION promo_normalize_conditions(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_match text := upper(COALESCE(p->>'match', 'ALL'));
    v_in jsonb := CASE WHEN jsonb_typeof(p->'conditions') = 'array' THEN p->'conditions' ELSE '[]'::jsonb END;
    v_out jsonb := '[]'::jsonb;
    c jsonb;
    v_min numeric;
    v_amt numeric;
    v_menus jsonb; v_cats jsonb; v_ids jsonb; v_srcs jsonb;
BEGIN
    IF v_match NOT IN ('ALL', 'ANY') THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'applyConditions.match phải là ALL hoặc ANY';
    END IF;
    IF jsonb_array_length(v_in) > 10 THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'Tối đa 10 điều kiện';
    END IF;
    FOR c IN SELECT * FROM jsonb_array_elements(v_in) LOOP
        v_menus := promo_jsonb_text_array(c->'menus', true);
        v_cats := promo_jsonb_text_array(c->'categories', true);
        v_ids := promo_jsonb_text_array(c->'serviceIds', false);
        v_srcs := promo_jsonb_text_array(c->'sources', true);
        IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_srcs) x WHERE x NOT IN ('WEB_BOOKING', 'WALK_IN', 'ADVANCE_BOOKING')) THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'sources chỉ nhận WEB_BOOKING, WALK_IN, ADVANCE_BOOKING';
        END IF;
        v_min := NULLIF(c->>'minMinutes', '')::numeric;
        v_amt := NULLIF(c->>'minOrderAmount', '')::numeric;
        IF v_min IS NOT NULL AND (v_min <> trunc(v_min) OR v_min < 1 OR v_min > 1440) THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'minMinutes phải là số phút nguyên từ 1 đến 1440';
        END IF;
        IF v_amt IS NOT NULL AND v_amt < 0 THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'minOrderAmount không được âm';
        END IF;
        IF jsonb_array_length(v_menus) = 0 AND jsonb_array_length(v_cats) = 0 AND jsonb_array_length(v_ids) = 0
           AND jsonb_array_length(v_srcs) = 0
           AND v_min IS NULL AND v_amt IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = 'Mỗi điều kiện cần ít nhất một tiêu chí';
        END IF;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'menus', v_menus, 'categories', v_cats, 'serviceIds', v_ids,
            'minMinutes', v_min::int, 'minOrderAmount', v_amt, 'sources', v_srcs));
    END LOOP;
    RETURN jsonb_build_object('match', v_match, 'conditions', v_out);
END;
$$;

CREATE OR REPLACE FUNCTION promo_evaluate_conditions(p_booking_id text, p_conditions jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_match text := upper(COALESCE(p_conditions->>'match', 'ALL'));
    v_conds jsonb := COALESCE(p_conditions->'conditions', '[]'::jsonb);
    v_amount numeric;
    v_results jsonb := '[]'::jsonb;
    v_all_ids text[] := ARRAY[]::text[];
    v_met_count int := 0;
    v_n int := jsonb_array_length(COALESCE(p_conditions->'conditions', '[]'::jsonb));
    c jsonb;
    i int := 0;
    v_ids text[];
    v_best int;
    v_scope_best int;
    v_amt_ok boolean;
    v_met boolean;
    v_overall boolean;
    v_matched_amount numeric;
    v_channel text := promo_booking_channel(p_booking_id);
    v_src_ok boolean;
BEGIN
    SELECT COALESCE(sum(line_amount), 0) INTO v_amount FROM promo_initial_items(p_booking_id);

    IF v_n = 0 THEN
        SELECT COALESCE(array_agg(item_id), ARRAY[]::text[]), COALESCE(sum(line_amount), 0)
          INTO v_all_ids, v_matched_amount FROM promo_initial_items(p_booking_id);
        RETURN jsonb_build_object('met', cardinality(v_all_ids) > 0, 'match', v_match, 'orderAmount', v_amount, 'channel', v_channel,
                                  'matchedItemIds', to_jsonb(v_all_ids), 'matchedAmount', v_matched_amount, 'results', '[]'::jsonb);
    END IF;

    FOR c IN SELECT * FROM jsonb_array_elements(v_conds) LOOP
        SELECT COALESCE(array_agg(item_id), ARRAY[]::text[]), max(unit_minutes) INTO v_ids, v_best
          FROM promo_initial_items(p_booking_id) it
         WHERE promo_item_meets(it.service_id, it.category, it.unit_minutes, c);
        -- longest service inside the scope (ignoring minMinutes) → "đơn đang có 60 phút"
        SELECT max(unit_minutes) INTO v_scope_best
          FROM promo_initial_items(p_booking_id) it
         WHERE promo_item_meets(it.service_id, it.category, NULL, c - 'minMinutes');
        v_amt_ok := NULLIF(c->>'minOrderAmount', '') IS NULL OR v_amount >= (c->>'minOrderAmount')::numeric;
        v_src_ok := jsonb_array_length(COALESCE(c->'sources', '[]'::jsonb)) = 0
                    OR (c->'sources') ? v_channel;
        v_met := cardinality(v_ids) > 0 AND v_amt_ok AND v_src_ok;
        IF v_met THEN
            v_met_count := v_met_count + 1;
            v_all_ids := v_all_ids || v_ids;
        END IF;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
            'index', i, 'met', v_met, 'matchedItemIds', to_jsonb(v_ids),
            'bestMinutes', COALESCE(v_scope_best, 0),
            'minMinutes', c->'minMinutes', 'minOrderAmount', c->'minOrderAmount', 'amountMet', v_amt_ok,
            'sources', COALESCE(c->'sources', '[]'::jsonb), 'sourceMet', v_src_ok));
        i := i + 1;
    END LOOP;

    v_overall := CASE WHEN v_match = 'ANY' THEN v_met_count > 0 ELSE v_met_count = v_n END;
    SELECT COALESCE(sum(line_amount), 0) INTO v_matched_amount
      FROM promo_initial_items(p_booking_id) WHERE item_id = ANY (v_all_ids);
    RETURN jsonb_build_object('met', v_overall, 'match', v_match, 'orderAmount', v_amount, 'channel', v_channel,
        'matchedItemIds', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM unnest(v_all_ids) x), '[]'::jsonb),
        'matchedAmount', CASE WHEN v_overall THEN v_matched_amount ELSE 0 END,
        'results', v_results);
END;
$$;

CREATE OR REPLACE FUNCTION promo_unmet_reasons(p_booking_id text, p_conditions jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_eval jsonb := promo_evaluate_conditions(p_booking_id, p_conditions);
    v_sum jsonb := promo_conditions_summary(p_conditions);
    v_match text := upper(COALESCE(p_conditions->>'match', 'ALL'));
    v_out text[] := ARRAY[]::text[];
    r jsonb;
    s jsonb;
    c jsonb;
    i int := 0;
    v_desc text[];
    v_scope_hit boolean;
    v_best int;
    v_detail text[];
BEGIN
    IF (v_eval->>'met')::boolean THEN RETURN '[]'::jsonb; END IF;
    FOR r IN SELECT * FROM jsonb_array_elements(v_eval->'results') LOOP
        c := p_conditions->'conditions'->i;
        s := v_sum->'conditions'->i;
        i := i + 1;
        IF (r->>'met')::boolean THEN CONTINUE; END IF;
        v_desc := ARRAY[]::text[];
        IF jsonb_array_length(s->'menus') > 0 THEN v_desc := v_desc || (SELECT string_agg(x, ' / ') FROM jsonb_array_elements_text(s->'menus') x); END IF;
        IF jsonb_array_length(s->'categories') > 0 THEN v_desc := v_desc || (SELECT string_agg(x, ' / ') FROM jsonb_array_elements_text(s->'categories') x); END IF;
        IF jsonb_array_length(s->'services') > 1 THEN
            v_desc := v_desc || ('một trong: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(s->'services') x));
        ELSIF jsonb_array_length(s->'services') = 1 THEN
            v_desc := v_desc || (s->'services'->>0);
        END IF;
        IF jsonb_array_length(COALESCE(c->'sources', '[]'::jsonb)) > 0 THEN
            v_desc := v_desc || ('đơn ' || (SELECT string_agg(promo_channel_label(x), ' / ') FROM jsonb_array_elements_text(c->'sources') x));
        END IF;
        IF NULLIF(c->>'minMinutes', '') IS NOT NULL THEN v_desc := v_desc || ('từ ' || (c->>'minMinutes') || ' phút'); END IF;
        IF NULLIF(c->>'minOrderAmount', '') IS NOT NULL THEN v_desc := v_desc || ('tổng đơn từ ' || promo_vnd((c->>'minOrderAmount')::numeric)); END IF;

        SELECT count(*) > 0, max(unit_minutes) INTO v_scope_hit, v_best
          FROM promo_initial_items(p_booking_id) it
         WHERE promo_item_meets(it.service_id, it.category, NULL, c - 'minMinutes');
        v_detail := ARRAY[]::text[];
        IF (jsonb_array_length(c->'menus') > 0 OR jsonb_array_length(c->'categories') > 0 OR jsonb_array_length(c->'serviceIds') > 0)
           AND NOT v_scope_hit THEN
            v_detail := v_detail || 'đơn không có dịch vụ nào phù hợp'::text;
        ELSIF NULLIF(c->>'minMinutes', '') IS NOT NULL AND COALESCE(v_best, 0) < (c->>'minMinutes')::int THEN
            v_detail := v_detail || ('dịch vụ phù hợp dài nhất của đơn là ' || COALESCE(v_best, 0) || ' phút');
        END IF;
        IF NOT COALESCE((r->>'sourceMet')::boolean, true) THEN
            v_detail := v_detail || ('đơn này là ' || promo_channel_label(v_eval->>'channel'));
        END IF;
        IF NOT COALESCE((r->>'amountMet')::boolean, true) THEN
            v_detail := v_detail || ('đơn hiện ' || promo_vnd((v_eval->>'orderAmount')::numeric));
        END IF;
        v_out := v_out || ('Cần ' || array_to_string(v_desc, ' · ')
                           || CASE WHEN cardinality(v_detail) > 0 THEN ' — ' || array_to_string(v_detail, ', ') ELSE '' END);
    END LOOP;
    IF v_match = 'ANY' AND cardinality(v_out) > 1 THEN
        v_out := ARRAY['Cần đạt một trong các điều kiện sau:'] || v_out;
    END IF;
    RETURN to_jsonb(v_out);
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
            'minOrderAmount', c->'minOrderAmount',
            'sources', COALESCE(c->'sources', '[]'::jsonb)));
    END LOOP;
    RETURN jsonb_build_object('match', upper(COALESCE(p_conditions->>'match', 'ALL')), 'conditions', v_out);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('match', 'ALL', 'conditions', '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION promo_order_candidates(p_pass_id uuid, p_q text DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_owner text;
    v_conds jsonb;
    d record;
    v_q text := NULLIF(trim(COALESCE(p_q, '')), '');
    v_rows jsonb;
BEGIN
    SELECT p.customer_id, c.apply_conditions INTO v_owner, v_conds
      FROM "CustomerPromotionPasses" p JOIN "PromotionCampaigns" c ON c.id = p.campaign_id WHERE p.id = p_pass_id;
    IF NOT FOUND THEN RETURN promo_err('PROMOTION_NOT_FOUND', promo_error_message('PROMOTION_NOT_FOUND')); END IF;
    SELECT * INTO d FROM promo_business_day_bounds();

    SELECT COALESCE(jsonb_agg(row_json ORDER BY is_owner DESC, created DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT COALESCE(b."customerId" = v_owner, false) AS is_owner,
               b."createdAt" AS created,
               promo_booking_json(b.id) || jsonb_build_object(
                   'isPassOwnerOrder', COALESCE(b."customerId" = v_owner, false),
                   'channel', promo_booking_channel(b.id),
                   'canApply', chk IS NULL,
                   'blockedReasonCode', chk,
                   'blockedReason', CASE WHEN chk IS NULL THEN NULL ELSE promo_error_message(chk) END,
                   'conditionResult', promo_evaluate_conditions(b.id, v_conds),
                   -- ELIGIBLE / NOT_ELIGIBLE (conditions only → counter may override with a reason) / BLOCKED
                   'eligibility', CASE WHEN chk IS NULL THEN 'ELIGIBLE' WHEN chk = 'ORDER_CONDITION_NOT_MET' THEN 'NOT_ELIGIBLE' ELSE 'BLOCKED' END,
                   'canOverride', chk = 'ORDER_CONDITION_NOT_MET' AND promo_check_apply_ex(p_pass_id, b.id, true) IS NULL,
                   'unmetReasons', CASE WHEN chk = 'ORDER_CONDITION_NOT_MET' THEN promo_unmet_reasons(b.id, v_conds) ELSE '[]'::jsonb END,
                   'alreadyAppliedThisPass', EXISTS (
                       SELECT 1 FROM "PromotionUsages" u
                        WHERE u.promotion_pass_id = p_pass_id AND u.booking_id = b.id AND u.status <> 'CANCELLED')
               ) AS row_json
        FROM "Bookings" b
        CROSS JOIN LATERAL (SELECT promo_check_apply(p_pass_id, b.id) AS chk) x
        WHERE b.status::text IN ('NEW', 'PREPARING', 'IN_PROGRESS')
          AND ((b."createdAt" >= d.utc_start AND b."createdAt" < d.utc_end)
               OR (b."bookingDate" >= d.vn_start AND b."bookingDate" < d.vn_end))
          AND (v_q IS NULL
               OR b."billCode" ILIKE '%' || v_q || '%'
               OR b.id ILIKE '%' || v_q || '%'
               OR b."customerName" ILIKE '%' || v_q || '%'
               OR b."customerPhone" ILIKE '%' || v_q || '%'
               OR b."roomName" ILIKE '%' || v_q || '%'
               OR EXISTS (SELECT 1 FROM "BookingItems" bi WHERE bi."bookingId" = b.id AND bi."roomName" ILIKE '%' || v_q || '%'))
        ORDER BY (b."customerId" = v_owner) DESC NULLS LAST, b."createdAt" DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    ) t;
    RETURN promo_ok(v_rows);
END;
$$;

-- Grants: service_role only (same as every promo_* function).
DO $$
DECLARE fn record;
BEGIN
    FOR fn IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname IN ('promo_booking_channel', 'promo_channel_label') LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
    END LOOP;
END;
$$;
