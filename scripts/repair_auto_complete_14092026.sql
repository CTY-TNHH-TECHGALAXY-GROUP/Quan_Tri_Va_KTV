-- ==============================================================================
-- ONE-OFF REPAIR 14/09/2026 — run in Supabase SQL Editor
-- ==============================================================================
-- ⚠️ Run AFTER migration 20260914180000_auto_complete_require_all_segments_done.sql
--    (otherwise the old job closes the 07/09 item again within a minute).
--
-- The first auto-complete job closed 2 items while a KTV segment was still open.
-- Each UPDATE only fires if the row is still in that wrong state, so running this
-- twice — or after the KTV has finished — changes nothing.

BEGIN;

-- Order #005 child B, "BODY GỘI": NH021 still working (16:20–17:20) → back to IN_PROGRESS
UPDATE "BookingItems"
   SET status  = 'IN_PROGRESS',
       options = jsonb_unwrap_string(options) - 'autoCompletedNoRating' - 'autoCompletedAt'
 WHERE id = '11NDK-005-14092026-item2'
   AND status = 'DONE'
   AND jsonb_unwrap_string(options) ? 'autoCompletedAt'
   AND booking_item_has_open_segment(segments);

UPDATE "Bookings"
   SET status = 'IN_PROGRESS', "updatedAt" = now() AT TIME ZONE 'UTC'
 WHERE id = '11NDK-005-14092026-B'
   AND status = 'DONE'
   AND EXISTS (SELECT 1 FROM "BookingItems" WHERE id = '11NDK-005-14092026-item2' AND status = 'IN_PROGRESS');

-- Old order 07/09: NH07 segment never started → back to FEEDBACK (state before the job)
UPDATE "BookingItems"
   SET status  = 'FEEDBACK',
       options = jsonb_unwrap_string(options) - 'autoCompletedNoRating' - 'autoCompletedAt'
 WHERE id = '11NDK-008-07092026-item3'
   AND status = 'DONE'
   AND jsonb_unwrap_string(options) ? 'autoCompletedAt'
   AND booking_item_has_open_segment(segments);

COMMIT;

-- Check: item2 = IN_PROGRESS, item3 = FEEDBACK, booking B = IN_PROGRESS
SELECT id, status FROM "BookingItems" WHERE id IN ('11NDK-005-14092026-item2', '11NDK-008-07092026-item3')
UNION ALL
SELECT id, status::text FROM "Bookings" WHERE id = '11NDK-005-14092026-B';
