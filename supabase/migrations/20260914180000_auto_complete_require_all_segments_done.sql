-- ================================================================
-- Auto-complete: wait until the WHOLE child order is finished
-- ================================================================
-- Incident 14/09/2026 16:27 (VN), order 11NDK-005-14092026-B, item2 "BODY GỘI":
-- two KTVs in sequence. KTV 1 finished at 16:20 and the item was put in
-- FEEDBACK while KTV 2 (NH021, 16:20–17:20) was still working. The job from
-- 20260914120000 only looked at item status and closed the item to DONE five
-- minutes later, with NH021 mid-service.
--
-- Rules (owner, 14/09):
--   1. Every KTV segment must be really finished (`actualEndTime`), including
--      the next KTV in a sequence. Voided segments (swapped out, cancelled no
--      credit) are ignored. Unreadable segments → treated as unfinished.
--   2. The wait is per CHILD ORDER (booking): it starts only when every
--      service of that order is finished — status FEEDBACK or DONE, no open
--      segment. CANCELLED services and utility services are ignored.
--   3. The wait counts from the LAST service that finished, and all waiting
--      services of the order are closed together — the customer rates once
--      for everyone who served them.
--   4. Unchanged: FEEDBACK only; 01/09/2026 (VN) cutoff, now on the order's
--      finish time; itemRating stays NULL; a DONE booking is never moved back;
--      wait minutes from SystemConfigs.customer_rating_timeout_minutes.

-- True when a segment with a KTV is not voided and has no real end time.
CREATE OR REPLACE FUNCTION booking_item_has_open_segment(p_segments jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_segs jsonb;
BEGIN
    IF p_segments IS NULL OR jsonb_typeof(p_segments) = 'null' THEN
        RETURN false;
    END IF;
    v_segs := jsonb_unwrap_string(p_segments);
    IF v_segs IS NULL OR jsonb_typeof(v_segs) <> 'array' THEN
        RETURN true;
    END IF;
    RETURN EXISTS (
        SELECT 1
          FROM jsonb_array_elements(v_segs) s
         WHERE jsonb_typeof(s) = 'object'
           AND COALESCE(s ->> 'ktvId', '') <> ''
           AND COALESCE(s ->> 'voided', 'false') <> 'true'
           AND COALESCE(s ->> 'actualEndTime', '') = ''
    );
EXCEPTION WHEN OTHERS THEN
    RETURN true;
END;
$$;

-- Single source for "which FEEDBACK items may be closed now". Used by the job
-- and by scripts/qa/qa_auto_complete_feedback.cjs for its dry run.
CREATE OR REPLACE FUNCTION auto_complete_feedback_candidates(p_wait_minutes numeric)
RETURNS TABLE (item_id text, booking_id text, no_rating boolean, order_finished_at timestamptz)
LANGUAGE sql
STABLE
AS $$
    WITH order_items AS (
        SELECT i.id,
               i."bookingId" AS booking_id,
               i.status,
               (i."itemRating" IS NULL AND g.rating IS NULL) AS no_rating,
               COALESCE(s.is_utility, false) AS is_utility,
               booking_item_has_open_segment(i.segments) AS has_open,
               COALESCE(
                   booking_item_last_feedback_time(i.segments),
                   i.handover_submitted_at,
                   i."timeEnd",
                   b."updatedAt" AT TIME ZONE 'UTC'
               ) AS finished_at
          FROM "BookingItems" i
          JOIN "Bookings" b ON b.id = i."bookingId"
          LEFT JOIN "BookingGuests" g ON g.id = i.guest_id
          LEFT JOIN "Services" s ON s.id = i."serviceId"
         WHERE i."bookingId" IN (SELECT DISTINCT "bookingId" FROM "BookingItems" WHERE status = 'FEEDBACK')
    ), finished_orders AS (
        SELECT booking_id, max(finished_at) AS order_finished_at
          FROM order_items
         WHERE status <> 'CANCELLED' AND NOT is_utility
         GROUP BY booking_id
        HAVING bool_and(status IN ('FEEDBACK', 'DONE') AND NOT has_open)
    )
    SELECT oi.id, oi.booking_id, oi.no_rating, fo.order_finished_at
      FROM order_items oi
      JOIN finished_orders fo ON fo.booking_id = oi.booking_id
     WHERE oi.status = 'FEEDBACK'
       AND NOT oi.is_utility
       AND fo.order_finished_at >= TIMESTAMPTZ '2026-09-01 00:00:00+07'
       AND (NOT oi.no_rating OR fo.order_finished_at < now() - p_wait_minutes * INTERVAL '1 minute');
$$;

CREATE OR REPLACE FUNCTION auto_complete_unrated_feedback()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_items        integer := 0;
    v_booking_ids  text[];
    v_now_iso      text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_wait_minutes numeric;
BEGIN
    -- Waiting time is set by the manager: admin "Cài đặt tính năng → Bàn giao
    -- phòng" (SystemConfigs.customer_rating_timeout_minutes). Missing,
    -- unreadable or negative → 5 minutes. 0 = close right after handover.
    BEGIN
        SELECT (value #>> '{}')::numeric
          INTO v_wait_minutes
          FROM "SystemConfigs"
         WHERE key = 'customer_rating_timeout_minutes';
    EXCEPTION WHEN OTHERS THEN
        v_wait_minutes := NULL;
    END;
    IF v_wait_minutes IS NULL OR v_wait_minutes < 0 THEN
        v_wait_minutes := 5;
    END IF;

    WITH closed AS (
        UPDATE "BookingItems" i
           SET status = 'DONE',
               options = CASE
                   WHEN NOT c.no_rating THEN i.options
                   WHEN jsonb_typeof(jsonb_unwrap_string(i.options)) = 'object'
                       THEN jsonb_unwrap_string(i.options)
                            || jsonb_build_object('autoCompletedNoRating', true, 'autoCompletedAt', v_now_iso)
                   WHEN i.options IS NULL OR jsonb_typeof(i.options) = 'null'
                       THEN jsonb_build_object('autoCompletedNoRating', true, 'autoCompletedAt', v_now_iso)
                   ELSE i.options
               END
          FROM auto_complete_feedback_candidates(v_wait_minutes) c
         WHERE i.id = c.item_id
           AND i.status = 'FEEDBACK'
        RETURNING i."bookingId"
    )
    SELECT count(*), array_agg(DISTINCT "bookingId")
      INTO v_items, v_booking_ids
      FROM closed;

    IF v_items = 0 THEN
        RETURN 0;
    END IF;

    -- Same rules as lib/dispatch-status.ts → recomputeBookingStatus (utility
    -- services ignored, as submitCustomerRating does). Keep both in sync.
    WITH item_statuses AS (
        SELECT i."bookingId" AS booking_id,
               array_agg(i.status) FILTER (WHERE NOT COALESCE(s.is_utility, false)) AS service_statuses,
               array_agg(i.status) AS all_statuses
          FROM "BookingItems" i
          LEFT JOIN "Services" s ON s.id = i."serviceId"
         WHERE i."bookingId" = ANY (v_booking_ids)
         GROUP BY i."bookingId"
    ), computed AS (
        SELECT booking_id,
               CASE
                   WHEN st && ARRAY['IN_PROGRESS', 'PAUSED'] THEN 'IN_PROGRESS'
                   WHEN st && ARRAY['PREPARING', 'WAITING', 'NEW']
                        AND st && ARRAY['IN_PROGRESS', 'PAUSED', 'COMPLETED', 'DONE', 'CANCELLED', 'FEEDBACK', 'CLEANING']
                       THEN 'IN_PROGRESS'
                   WHEN st && ARRAY['CLEANING', 'COMPLETED'] THEN 'CLEANING'
                   WHEN st && ARRAY['FEEDBACK'] THEN 'FEEDBACK'
                   WHEN st <@ ARRAY['DONE', 'CANCELLED'] THEN 'DONE'
                   WHEN st && ARRAY['PREPARING'] THEN 'PREPARING'
                   ELSE 'NEW'
               END AS new_status
          FROM (
              SELECT booking_id, COALESCE(service_statuses, all_statuses) AS st
                FROM item_statuses
          ) picked
    )
    UPDATE "Bookings" b
       SET status = c.new_status::"BookingStatus",
           "updatedAt" = now() AT TIME ZONE 'UTC'
      FROM computed c
     WHERE b.id = c.booking_id
       AND b.status NOT IN ('DONE', 'CANCELLED', 'SPLIT')
       AND b.status::text <> c.new_status;

    RAISE LOG 'auto_complete_unrated_feedback: closed % item(s)', v_items;
    RETURN v_items;
END;
$$;
