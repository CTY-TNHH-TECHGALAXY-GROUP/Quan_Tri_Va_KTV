-- Staff.pending_lock — a disciplinary lock that is DECIDED but POSTPONED because
-- the KTV still has an order in flight.
--
-- The Type D midnight cron (daily-absence-check) may decide to lock a KTV who is
-- still serving, cleaning the room, or waiting for the counter to approve the
-- handover photos. Locking right away kicks them out of the app mid-order: they
-- cannot finish, hand over, or redo the cleaning if the counter rejects it.
--
-- So the cron writes the decision here instead, and the cron
-- /api/cron/type-d-pending-lock (every 5 minutes) applies the lock once
-- findUnfinishedWorkToday(..., { tinhCaChoDuyet: true }) is empty. Orders are
-- filtered by business date, so at the 06:00 cutoff last night's orders no
-- longer count and the lock lands at the latest then.
--
-- Shape: { "caseKey", "workDate", "reason", "source", "decidedAt", "billCodes" }
-- NULL = nothing pending. Cleared when the lock is applied, when discipline is
-- switched off, and on manual unlock.
--
-- plans/plan_khoa_khi_chua_dang_ky_lich_loai_d.md §9

ALTER TABLE public."Staff"
    ADD COLUMN IF NOT EXISTS pending_lock jsonb;

-- The 5-minute cron only ever asks "who has something pending".
CREATE INDEX IF NOT EXISTS idx_staff_pending_lock
    ON public."Staff" (id)
    WHERE pending_lock IS NOT NULL;

COMMENT ON COLUMN public."Staff".pending_lock IS
    'Disciplinary lock decided but postponed until the KTV finishes their in-flight order. {caseKey, workDate, reason, source, decidedAt, billCodes}. Applied and cleared by /api/cron/type-d-pending-lock; also cleared on unlock.';
