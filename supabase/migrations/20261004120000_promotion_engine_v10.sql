-- =============================================================================
-- Promotion Engine v10 — keep 3 tables (user 04/10/2026): drop PromotionIssueErrors.
-- The two trigger functions now RAISE WARNING (visible in Supabase → Logs → Postgres)
-- instead of inserting a row; they still never block the booking / item update.
-- The table only ever held trigger errors (empty on the test DB); nothing else reads it.
-- =============================================================================

CREATE OR REPLACE FUNCTION promo_on_booking_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

CREATE OR REPLACE FUNCTION promo_on_item_cancel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

DROP TABLE IF EXISTS "PromotionIssueErrors";
