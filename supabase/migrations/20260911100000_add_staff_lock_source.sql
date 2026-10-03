-- Staff.lock_source — WHO locked the account, written in the SAME row as status.
--
-- Staff.status = 'KHÓA_TÀI_KHOẢN' is shared by two very different locks:
--   * disciplinary locks (cron daily-absence-check, reject-order flow) — the
--     KTV must keep seeing the reason, it is part of the Type D regulations;
--   * the admin "Hoạt động" switch on the Features table (manual lock) — the
--     KTV must only see "Tính năng của bạn đang bảo trì".
-- Guessing the kind from KTVDPenaltyLedger / SecurityAuditLogs is wrong or racy
-- (old ACCOUNT_LOCK rows outlive the unlock; lock routes flip status before they
-- write the audit row). A column updated together with status is atomic.
--
-- Values:
--   'MANUAL'     = locked by an admin via the "Hoạt động" switch.
--   'DISCIPLINE' = reserved for disciplinary writers.
--   NULL         = disciplinary or legacy lock (current writers leave it NULL),
--                  or the account is not locked.
-- Readers treat ONLY 'MANUAL' specially; everything else keeps the current
-- disciplinary behaviour.

ALTER TABLE public."Staff"
    ADD COLUMN IF NOT EXISTS lock_source text;

ALTER TABLE public."Staff"
    DROP CONSTRAINT IF EXISTS check_staff_lock_source;

ALTER TABLE public."Staff"
    ADD CONSTRAINT check_staff_lock_source
    CHECK (lock_source IS NULL OR lock_source IN ('MANUAL', 'DISCIPLINE'));

-- A stale 'MANUAL' left on an unlocked row would make the NEXT disciplinary
-- lock look manual (the KTV would lose the reason). Several code paths write
-- status without knowing about this column (unlock, employee edit form, turn
-- queue board). Clearing it here covers all of them, present and future.
CREATE OR REPLACE FUNCTION public.staff_clear_lock_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'KHÓA_TÀI_KHOẢN' THEN
        NEW.lock_source := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_clear_lock_source_trigger ON public."Staff";

CREATE TRIGGER staff_clear_lock_source_trigger
    BEFORE INSERT OR UPDATE OF status, lock_source ON public."Staff"
    FOR EACH ROW
    EXECUTE FUNCTION public.staff_clear_lock_source();

COMMENT ON COLUMN public."Staff".lock_source IS
    'Who locked the account. MANUAL = admin "Hoạt động" switch (KTV sees the maintenance notice). NULL/DISCIPLINE = disciplinary or legacy lock (KTV sees the reason). Auto-cleared by trigger when status leaves KHÓA_TÀI_KHOẢN.';
