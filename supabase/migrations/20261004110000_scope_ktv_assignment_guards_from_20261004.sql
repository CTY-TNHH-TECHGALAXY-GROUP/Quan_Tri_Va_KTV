-- 04/10/2026: the live-assignment guards only apply from business date 2026-10-04 on.
-- Production holds ~320 assignments of earlier days still ACTIVE/QUEUED/READY (orders finished or
-- abandoned before the release/finish RPCs closed them), some overlapping or with an end before the
-- start (old cross-midnight bug). Decision: do not touch past data — leave those rows as they are
-- and enforce the rules for new work only. Same final state on TEST and production; idempotent.
-- Replaces the predicates of 20260928020000 / 20260929160000.

ALTER TABLE "KtvAssignments" DROP CONSTRAINT IF EXISTS ktv_assignments_no_live_overlap;
ALTER TABLE "KtvAssignments" ADD CONSTRAINT ktv_assignments_no_live_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(planned_start_time,GREATEST(planned_start_time,planned_end_time),'[)') WITH &&
  ) WHERE (status='ACTIVE' AND business_date >= DATE '2026-10-04'
    AND planned_start_time IS NOT NULL AND planned_end_time IS NOT NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION validate_final_ktv_assignment_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KtvAssignments" WHERE id=NEW.id
    AND status IN ('ACTIVE','QUEUED','READY')
    AND business_date >= DATE '2026-10-04'
    AND (planned_start_time IS NULL OR planned_end_time IS NULL
      OR NOT isfinite(planned_start_time) OR NOT isfinite(planned_end_time)
      OR planned_end_time<=planned_start_time)) THEN
    RAISE EXCEPTION 'Giờ phân công không hợp lệ; tải lại và kiểm tra';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION validate_final_ktv_assignment_plan() FROM PUBLIC,anon,authenticated;
