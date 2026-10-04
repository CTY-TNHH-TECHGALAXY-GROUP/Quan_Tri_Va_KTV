-- =============================================================================
-- Promotion Engine v11 — fix: customer filter "Có đơn đạt điều kiện chương trình" read the
-- legacy qualification_type, so campaigns created with applyConditions (qualification_type
-- defaults to MANUAL_ASSIGNMENT) returned qualificationIgnored = true and filtered nothing.
-- Reported by Agent B (promotion_frontend_yeu_cau_backend.md §12), 04/10/2026.
-- Now: has conditions ⇔ apply_conditions has ≥ 1 condition; "qualifying order" is still
-- promo_evaluate_booking_for_campaign (apply_conditions since v7).
-- =============================================================================

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
    -- Since v7 the ONE source of conditions is apply_conditions (legacy qualification_type is display-only).
    v_auto_q := jsonb_array_length(COALESCE(c.apply_conditions->'conditions', '[]'::jsonb)) > 0;
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
               -- true only while the customer HOLDS a usable pass of this campaign (cannot be issued again)
               'alreadyHasPass', t.holds_usable,
               'passHistory', promo_customer_pass_history(t.customer_id, 10))
             ORDER BY t.holds_usable, last_visit_at DESC NULLS LAST, name), '[]'::jsonb)
      INTO v_items
      FROM (SELECT x.*, promo_customer_holds_usable_pass(x.customer_id, c.id) AS holds_usable FROM _promo_cand x
             WHERE NOT v_has_email OR real_email IS NOT NULL
             ORDER BY promo_customer_holds_usable_pass(x.customer_id, c.id), last_visit_at DESC NULLS LAST, name
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

DO $$
DECLARE
    fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'promo\_%'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
    END LOOP;
END;
$$;
