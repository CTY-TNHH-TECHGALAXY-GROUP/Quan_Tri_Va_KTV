-- DRAFT callers editing an unstarted plan must update the assignment/queue clocks too.
CREATE OR REPLACE FUNCTION sync_unstarted_dispatch_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE seg jsonb; old_seg jsonb; service_day date; planned_start timestamptz; planned_end timestamptz;
BEGIN
  IF current_setting('app.dispatch_action',true) IS DISTINCT FROM 'DRAFT' THEN RETURN NEW; END IF;
  SELECT "bookingDate"::date INTO service_day FROM "Bookings" WHERE id=NEW."bookingId";
  FOR seg IN SELECT value FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(NEW.segments),'[]')) LOOP
    IF COALESCE(seg->>'voided','false')='true' OR COALESCE(seg->>'actualStartTime','')<>'' OR COALESCE(seg->>'actualEndTime','')<>'' THEN CONTINUE; END IF;
    SELECT value INTO old_seg FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(OLD.segments),'[]'))
      WHERE value->>'id'=seg->>'id' AND value->>'ktvId'=seg->>'ktvId';
    IF old_seg IS NULL OR (seg->'startTime',seg->'endTime',seg->'duration') IS NOT DISTINCT FROM (old_seg->'startTime',old_seg->'endTime',old_seg->'duration') THEN CONTINUE; END IF;
    IF COALESCE((seg->>'duration')::integer,0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Thời lượng nhân viên không hợp lệ'; END IF;
    planned_start := COALESCE(NULLIF(seg->>'plannedStartAt','')::timestamptz,(service_day+(seg->>'startTime')::time) AT TIME ZONE 'Asia/Ho_Chi_Minh');
    planned_end := planned_start+make_interval(mins=>(seg->>'duration')::integer);
    IF seg->>'endTime' IS DISTINCT FROM to_char(planned_end AT TIME ZONE 'Asia/Ho_Chi_Minh','HH24:MI') THEN RAISE EXCEPTION 'Giờ kết thúc không khớp thời lượng'; END IF;
    IF EXISTS(SELECT 1 FROM "KtvAssignments" ka WHERE ka.employee_id=seg->>'ktvId' AND ka.status='ACTIVE'
      AND ka.booking_item_id<>NEW.id AND ka.planned_start_time<planned_end AND ka.planned_end_time>planned_start) THEN
      RAISE EXCEPTION 'Nhân viên có phân công chồng giờ';
    END IF;
    UPDATE "KtvAssignments" SET planned_start_time=planned_start,planned_end_time=planned_end,
      room_id=seg->>'roomId',bed_id=seg->>'bedId',updated_at=clock_timestamp()
      WHERE booking_id=NEW."bookingId" AND booking_item_id=NEW.id AND employee_id=seg->>'ktvId'
        AND (segment_id=seg->>'id' OR segment_id IS NULL) AND status IN ('ACTIVE','QUEUED','READY');
    UPDATE "TurnQueue" t SET (start_time,estimated_end_time)=(SELECT
      (min(ka.planned_start_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,(max(ka.planned_end_time) AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
      FROM "KtvAssignments" ka WHERE ka.employee_id=t.employee_id AND ka.business_date=t.date AND ka.booking_id=NEW."bookingId"
        AND ka.status IN ('ACTIVE','QUEUED','READY') AND ka.booking_item_id=ANY(COALESCE(t.booking_item_ids,ARRAY[]::text[]) || ARRAY[t.booking_item_id]))
      WHERE t.employee_id=seg->>'ktvId' AND t.date=service_day AND t.current_order_id=NEW."bookingId";
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_unstarted_dispatch_plan_trigger ON "BookingItems";
CREATE TRIGGER sync_unstarted_dispatch_plan_trigger AFTER UPDATE OF segments ON "BookingItems"
  FOR EACH ROW EXECUTE FUNCTION sync_unstarted_dispatch_plan();
REVOKE ALL ON FUNCTION sync_unstarted_dispatch_plan() FROM PUBLIC,anon,authenticated;
