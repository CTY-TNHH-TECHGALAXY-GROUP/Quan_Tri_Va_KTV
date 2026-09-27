-- Read-only audit for the reported bill. Does not modify assignments or actual timestamps.
-- Requires the project's jsonb_unwrap_string helper. Run against the intended DB manually.
WITH matched AS (
  SELECT booking.id AS booking_id, item.id AS item_id, ka.employee_id, ka.segment_id,
    ka.status, ka.business_date, ka.planned_start_time, ka.planned_end_time,
    seg->>'startTime' AS segment_start_clock, seg->>'endTime' AS segment_end_clock,
    (seg->>'duration')::numeric AS assigned_minutes,
    svc.duration AS catalogue_minutes, seg->>'actualStartTime' AS actual_start,
    seg->>'actualEndTime' AS actual_end,
    count(*) OVER (PARTITION BY ka.employee_id,ka.booking_item_id) AS matching_segments
  FROM "Bookings" booking
  JOIN "BookingItems" item ON item."bookingId"=booking.id
  JOIN "KtvAssignments" ka ON ka.booking_id=booking.id AND ka.booking_item_id=item.id
  LEFT JOIN "Services" svc ON svc.id=item."serviceId"
  CROSS JOIN LATERAL jsonb_array_elements(jsonb_unwrap_string(item.segments)) seg
  WHERE booking.id='11NDK-004-26092026'
    AND lower(ka.employee_id)=ANY(regexp_split_to_array(lower(seg->>'ktvId'),'\s+-\s+'))
    AND (ka.segment_id=seg->>'id' OR ka.segment_id IS NULL)
    AND COALESCE(seg->>'voided','false') <> 'true'
    AND seg->>'duration' ~ '^[0-9]+(\.[0-9]+)?$'
)
SELECT *, EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 AS assignment_minutes,
  planned_start_time + assigned_minutes * interval '1 minute' AS expected_end_from_assignment_start,
  CASE WHEN matching_segments <> 1 THEN 'MANUAL_REVIEW_MULTIPLE_SEGMENTS'
       WHEN EXTRACT(EPOCH FROM planned_end_time-planned_start_time)/60 IS DISTINCT FROM assigned_minutes
       THEN 'DURATION_MISMATCH' ELSE 'MATCH' END AS audit_result
FROM matched ORDER BY employee_id,segment_id;
