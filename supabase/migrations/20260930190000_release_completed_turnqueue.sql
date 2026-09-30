-- A completed release must free the employee's turn, even when the old row is
-- still marked working. Keep this in the release transaction, not the GET API.
CREATE OR REPLACE FUNCTION ktv_release_work_atomic(
  p_booking_id text, p_employee_id text, p_photo_urls jsonb, p_item_ids jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
  turn_row "TurnQueue"%ROWTYPE;
  next_work "KtvAssignments"%ROWTYPE;
  work_day date;
  promotion jsonb;
  next_running boolean;
BEGIN
  result := ktv_release_work_atomic_base(p_booking_id,p_employee_id,p_photo_urls,p_item_ids);
  FOR work_day IN SELECT DISTINCT business_date FROM "KtvAssignments"
    WHERE employee_id=p_employee_id AND booking_id=p_booking_id AND status='COMPLETED' LOOP
    SELECT * INTO turn_row FROM "TurnQueue"
      WHERE employee_id=p_employee_id AND date=work_day FOR UPDATE;
    IF NOT FOUND OR turn_row.current_order_id IS DISTINCT FROM p_booking_id THEN CONTINUE; END IF;

    -- Another started segment of this order still owns the turn.
    IF EXISTS (SELECT 1 FROM "BookingItems" bi,
      jsonb_array_elements(COALESCE(jsonb_unwrap_string(bi.segments),'[]')) s
      WHERE bi."bookingId"=p_booking_id
        AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
        AND COALESCE(s->>'voided','false')<>'true'
        AND COALESCE(s->>'actualStartTime','')<>'' AND COALESCE(s->>'actualEndTime','')='') THEN CONTINUE; END IF;

    -- A separately activated job takes precedence over the queued jobs.
    SELECT ka.* INTO next_work FROM "KtvAssignments" ka
      JOIN "Bookings" b ON b.id=ka.booking_id
      JOIN "BookingItems" bi ON bi.id=ka.booking_item_id
      WHERE ka.employee_id=p_employee_id AND ka.business_date=work_day AND ka.status='ACTIVE'
        AND b.status NOT IN ('DONE','CANCELLED','SPLIT')
        AND bi.status NOT IN ('DONE','CANCELLED','FEEDBACK','CLEANING')
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(jsonb_unwrap_string(bi.segments),'[]')) s
          WHERE (ka.segment_id IS NULL OR s->>'id'=ka.segment_id)
            AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
            AND COALESCE(s->>'voided','false')<>'true' AND COALESCE(s->>'actualEndTime','')='')
      ORDER BY ka.planned_start_time NULLS LAST,ka.priority,ka.created_at LIMIT 1;
    IF FOUND THEN
      SELECT EXISTS (SELECT 1 FROM "BookingItems" bi,
        jsonb_array_elements(COALESCE(jsonb_unwrap_string(bi.segments),'[]')) s
        WHERE bi.id=next_work.booking_item_id
          AND (next_work.segment_id IS NULL OR s->>'id'=next_work.segment_id)
          AND lower(p_employee_id)=ANY(regexp_split_to_array(lower(s->>'ktvId'),'\s+-\s+'))
          AND COALESCE(s->>'actualStartTime','')<>'' AND COALESCE(s->>'actualEndTime','')='') INTO next_running;
      UPDATE "TurnQueue" SET status=CASE WHEN next_running THEN 'working' ELSE 'assigned' END,
        current_order_id=next_work.booking_id,
        booking_item_id=next_work.booking_item_id,booking_item_ids=ARRAY[next_work.booking_item_id]::text[],
        room_id=next_work.room_id,bed_id=next_work.bed_id,
        start_time=(next_work.planned_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time,
        estimated_end_time=(next_work.planned_end_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::time
        WHERE employee_id=p_employee_id AND date=work_day;
      CONTINUE;
    END IF;

    IF turn_row.status='off' THEN
      UPDATE "TurnQueue" SET current_order_id=NULL,booking_item_id=NULL,
        booking_item_ids=ARRAY[]::text[],room_id=NULL,bed_id=NULL,
        start_time=NULL,estimated_end_time=NULL
        WHERE employee_id=p_employee_id AND date=work_day;
      CONTINUE;
    END IF;

    -- The promotion RPC deliberately defers while working. The released work
    -- is no longer running, so unlock that guard before promoting or clearing.
    UPDATE "TurnQueue" SET status='assigned'
      WHERE employee_id=p_employee_id AND date=work_day;
    promotion := promote_next_assignment(p_employee_id,work_day);
    IF NOT COALESCE((promotion->>'success')::boolean,false) THEN
      RAISE EXCEPTION 'Promotion failed after release: %',promotion;
    END IF;
  END LOOP;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ktv_release_work_atomic(text,text,jsonb,jsonb) TO service_role;
