-- Prevent live assignment overlaps and protect actual running work.
-- Preflight existing overlaps and invalid clocks before applying in one transaction.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The legacy dispatcher temporarily writes same-day midnight clocks before its
-- outer RPC repairs them. Check final state at COMMIT, while the index always has
-- a valid range expression. Empty temporary ranges cannot survive the final guard.
ALTER TABLE "KtvAssignments" ADD CONSTRAINT ktv_assignments_no_live_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tstzrange(planned_start_time,GREATEST(planned_start_time,planned_end_time),'[)') WITH &&
  ) WHERE (status IN ('ACTIVE','QUEUED','READY')
    AND planned_start_time IS NOT NULL AND planned_end_time IS NOT NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION validate_final_ktv_assignment_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KtvAssignments" WHERE id=NEW.id
    AND status IN ('ACTIVE','QUEUED','READY')
    AND (planned_start_time IS NULL OR planned_end_time IS NULL
      OR NOT isfinite(planned_start_time) OR NOT isfinite(planned_end_time)
      OR planned_end_time<=planned_start_time)) THEN
    RAISE EXCEPTION 'Giờ phân công không hợp lệ; tải lại và kiểm tra';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER validate_final_ktv_assignment_plan_trigger
  AFTER INSERT OR UPDATE ON "KtvAssignments" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_final_ktv_assignment_plan();
REVOKE ALL ON FUNCTION validate_final_ktv_assignment_plan() FROM PUBLIC,anon,authenticated;

-- A stale waiting queue is not evidence that physical work has ended.
CREATE FUNCTION protect_running_ktv_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status='COMPLETED' AND OLD.status IN ('ACTIVE','QUEUED','READY')
    AND EXISTS (SELECT 1 FROM "BookingItems" i,
      jsonb_array_elements(COALESCE(jsonb_unwrap_string(i.segments),'[]')) s
      WHERE i.id=OLD.booking_item_id AND i."bookingId"=OLD.booking_id
        AND (OLD.segment_id IS NULL OR s->>'id'=OLD.segment_id)
        AND lower(OLD.employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'voided','false')<>'true'
        AND COALESCE(s->>'actualStartTime','')<>'' AND COALESCE(s->>'actualEndTime','')='') THEN
    RAISE EXCEPTION 'KTV đang làm, chưa kết thúc; không được tự dọn phân công';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_running_ktv_assignment_trigger BEFORE UPDATE OF status ON "KtvAssignments"
  FOR EACH ROW EXECUTE FUNCTION protect_running_ktv_assignment();
REVOKE ALL ON FUNCTION protect_running_ktv_assignment() FROM PUBLIC,anon,authenticated;
