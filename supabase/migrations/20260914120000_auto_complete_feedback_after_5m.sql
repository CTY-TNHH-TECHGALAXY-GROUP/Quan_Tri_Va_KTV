-- ================================================================
-- Auto-complete FEEDBACK items 5 minutes after they enter FEEDBACK
-- ================================================================
-- Owner decision 14/09/2026 — plans/plan_tu_hoan_tat_don_khong_danh_gia.md
--
--  · An item waiting for the customer's rating (status FEEDBACK: the KTV has
--    already cleaned and handed over) is closed to DONE N minutes after it
--    entered FEEDBACK, so the KTV sees settled money. N is editable by the
--    manager (SystemConfigs.customer_rating_timeout_minutes, default 5).
--  · Already rated but still FEEDBACK → closed on the next run (≤ 1 minute).
--  · The customer may still rate later: the rating is recorded and the ledger
--    trigger (trg_ktvd_enqueue_item) recomputes the money.
--  · itemRating stays NULL, never 0. NULL is how "no customer rating" is
--    recognised (KTV history), and handleFinishService treats any non-NULL
--    value as "rated".
--  · Only items that entered FEEDBACK on/after 01/09/2026 (VN) are closed.
--  · Never touches CLEANING / IN_PROGRESS / PAUSED / CANCELLED / DONE items:
--    room debt (CLEANING, handover SKIPPED/REJECTED) is left intact.
--  · Booking status is recomputed with the same rules as
--    lib/dispatch-status.ts → recomputeBookingStatus (utility services ignored,
--    as submitCustomerRating does). Keep both in sync. A DONE booking is never
--    moved backwards.
--
-- Replaces `auto_skip_rating_job` / auto_skip_rating_after_24h()
-- (scripts/auto_skip_rating.sql): it keyed off the booking status, leaving items
-- stuck in FEEDBACK, and forced every non-DONE item (CLEANING, CANCELLED) to DONE.

-- `segments` / `options` are jsonb but ~85% of rows hold a JSON *string*
-- (written with JSON.stringify). Unwrap safely: a malformed string must not
-- make the every-minute job fail.
CREATE OR REPLACE FUNCTION jsonb_unwrap_string(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p IS NULL OR jsonb_typeof(p) <> 'string' THEN
        RETURN p;
    END IF;
    RETURN (p #>> '{}')::jsonb;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Latest `feedbackTime` across an item's segments (set when the item enters
-- FEEDBACK — handleFinishService and the reception status update both write it).
CREATE OR REPLACE FUNCTION booking_item_last_feedback_time(p_segments jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_segs jsonb := jsonb_unwrap_string(p_segments);
    v_max  timestamptz;
BEGIN
    IF v_segs IS NULL OR jsonb_typeof(v_segs) <> 'array' THEN
        RETURN NULL;
    END IF;
    SELECT max((s ->> 'feedbackTime')::timestamptz)
      INTO v_max
      FROM jsonb_array_elements(v_segs) s
     WHERE jsonb_typeof(s) = 'object'
       AND COALESCE(s ->> 'feedbackTime', '') <> '';
    RETURN v_max;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
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

    WITH candidates AS (
        SELECT i.id,
               (i."itemRating" IS NULL AND g.rating IS NULL) AS no_rating,
               COALESCE(
                   booking_item_last_feedback_time(i.segments),
                   i.handover_submitted_at,
                   i."timeEnd",
                   b."updatedAt" AT TIME ZONE 'UTC'
               ) AS entered_feedback_at
          FROM "BookingItems" i
          JOIN "Bookings" b ON b.id = i."bookingId"
          LEFT JOIN "BookingGuests" g ON g.id = i.guest_id
         WHERE i.status = 'FEEDBACK'
    ), closed AS (
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
          FROM candidates c
         WHERE i.id = c.id
           AND i.status = 'FEEDBACK'
           -- Owner decision 14/09: only items that entered FEEDBACK from 01/09/2026
           -- (VN time). Older stuck items (May–Aug, never paid) would add money to
           -- months already settled — the manager reviews those by hand.
           AND c.entered_feedback_at >= TIMESTAMPTZ '2026-09-01 00:00:00+07'
           AND (NOT c.no_rating OR c.entered_feedback_at < now() - v_wait_minutes * INTERVAL '1 minute')
        RETURNING i."bookingId"
    )
    SELECT count(*), array_agg(DISTINCT "bookingId")
      INTO v_items, v_booking_ids
      FROM closed;

    IF v_items = 0 THEN
        RETURN 0;
    END IF;

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

-- Waiting time setting. The key already existed (seeded 30 on 22/07/2026 by
-- 20260722000006, never read by any code). Owner decision 14/09: 5 minutes.
-- Only the untouched seed value 30 is replaced, so re-running this file never
-- overwrites a value the manager has set.
INSERT INTO "SystemConfigs" (key, value, description)
VALUES (
    'customer_rating_timeout_minutes',
    '5'::jsonb,
    'Số phút chờ khách đánh giá sau khi KTV bàn giao. Quá hạn hệ thống tự Hoàn tất đơn (khách vẫn chấm muộn được). 0 = hoàn tất ngay.'
)
ON CONFLICT (key) DO UPDATE
    SET value = CASE WHEN "SystemConfigs".value = '30'::jsonb THEN EXCLUDED.value ELSE "SystemConfigs".value END,
        description = EXCLUDED.description,
        updated_at = now();

-- @@CRON_SECTION@@ (scripts/qa/qa_auto_complete_feedback.cjs runs only the part above)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_skip_rating_job') THEN
        PERFORM cron.unschedule('auto_skip_rating_job');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_complete_feedback_job') THEN
        PERFORM cron.unschedule('auto_complete_feedback_job');
    END IF;
END;
$$;

SELECT cron.schedule(
    'auto_complete_feedback_job',
    '* * * * *',
    $$ SELECT auto_complete_unrated_feedback(); $$
);

DROP FUNCTION IF EXISTS auto_skip_rating_after_24h();
