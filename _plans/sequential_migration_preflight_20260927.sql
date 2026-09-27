-- READ ONLY. Run BEFORE applying the five sequential feature migrations to the selected DB.
-- Run each query separately in Supabase SQL Editor and retain its result.
-- Query 0: record T0. This reads the DB clock; it does NOT persist or enforce a cutoff.
SELECT clock_timestamp() AS preflight_t0,
       current_database() AS database_name,
       current_user AS executing_role;

-- Query 1: zero rows = all required baseline columns exist. A blank DB will fail this check.
WITH required(table_name,column_name) AS (VALUES
 ('Bookings','id'),('Bookings','status'),('Bookings','bookingDate'),('Bookings','parent_booking_id'),
 ('Bookings','rating'),('Bookings','timeStart'),('Bookings','updatedAt'),('Bookings','totalAmount'),
 ('Bookings','guestCount'),('Bookings','technicianCode'),('Bookings','bedId'),('Bookings','roomName'),('Bookings','notes'),
 ('BookingItems','id'),('BookingItems','bookingId'),('BookingItems','serviceId'),('BookingItems','status'),
 ('BookingItems','segments'),('BookingItems','options'),('BookingItems','technicianCodes'),
 ('BookingItems','guest_id'),('BookingItems','pauseStart'),('BookingItems','timeEnd'),
 ('BookingItems','price'),('BookingItems','quantity'),('BookingItems','itemRating'),
 ('BookingItems','roomName'),('BookingItems','bedId'),('BookingItems','handover_status'),
 ('BookingItems','handover_images'),('BookingItems','handover_skipped'),('BookingItems','handover_submitted_at'),
 ('BookingGuests','id'),('BookingGuests','booking_id'),('BookingGuests','rating'),('BookingGuests','guest_index'),
 ('BookingGuests','guest_label'),('BookingGuests','status'),('BookingGuests','bed_id'),('BookingGuests','room_id'),
 ('BookingGuests','notes'),('BookingGuests','focus_area'),
 ('KtvAssignments','id'),('KtvAssignments','priority'),('KtvAssignments','sequence_no'),('KtvAssignments','employee_id'),('KtvAssignments','business_date'),('KtvAssignments','booking_id'),
 ('KtvAssignments','booking_item_id'),('KtvAssignments','segment_id'),('KtvAssignments','status'),
 ('KtvAssignments','planned_start_time'),('KtvAssignments','planned_end_time'),('KtvAssignments','created_at'),
 ('KtvAssignments','updated_at'),('KtvAssignments','room_id'),('KtvAssignments','bed_id'),('KtvAssignments','dispatch_source'),
 ('TurnQueue','id'),('TurnQueue','last_served_at'),('TurnQueue','employee_id'),('TurnQueue','date'),('TurnQueue','status'),('TurnQueue','current_order_id'),
 ('TurnQueue','booking_item_id'),('TurnQueue','booking_item_ids'),('TurnQueue','start_time'),('TurnQueue','estimated_end_time'),
 ('TurnQueue','room_id'),('TurnQueue','bed_id'),('TurnQueue','queue_position'),('TurnQueue','check_in_order'),('TurnQueue','turns_completed'),
 ('TurnLedger','date'),('TurnLedger','booking_id'),('TurnLedger','employee_id'),('TurnLedger','source'),('TurnLedger','is_punished'),
 ('Staff','id'),('Staff','status'),('Staff','work_type'),('Services','id'),('Services','nameVN'),('Services','is_utility'),('Services','duration')
)
SELECT r.table_name,r.column_name FROM required r LEFT JOIN information_schema.columns c
 ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
 WHERE c.column_name IS NULL ORDER BY r.table_name,r.column_name;

-- Query 2: every baseline dependency must exist. No new sequential RPC is required yet.
SELECT signature,to_regprocedure('public.' || signature) IS NOT NULL AS exists_before_migration
FROM (VALUES
 ('jsonb_unwrap_string(jsonb)'),
 ('dispatch_confirm_booking(text,date,text,text,text,text,text,jsonb,jsonb)'),
 ('promote_next_assignment(text,date)'),
 ('skip_handover_with_quota(text,text,integer)')
) required(signature);

-- Query 3: retain both uniqueness contracts; do not drop the ACTIVE index to allow cleaning debt.
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='KtvAssignments'
 ORDER BY indexname;
SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY rolname;
SELECT to_regclass('supabase_migrations.schema_migrations') AS migration_history_table;
-- If migration_history_table exists, inspect its versions before selecting pending files.
-- Expected feature order: 20260925120000, 20260926120000, 20260926140000, 20260927120000, 20260927150000.
