-- READ ONLY. Run AFTER applying the five migrations, before enabling the new app flow.
WITH required(signature) AS (VALUES
 ('dispatch_enable_sequential_item(text,text)'),
 ('dispatch_assign_sequential_slot_b(text,text,text,timestamp with time zone,integer,boolean)'),
 ('dispatch_finish_sequential_after_a(text,text)'),
 ('dispatch_save_sequential_update(text,jsonb,boolean)'),('dispatch_apply_edit(text,text,jsonb,jsonb)'),
 ('dispatch_sequential_lifecycle_atomic(text,text,jsonb,jsonb,text,jsonb,bigint)'),
 ('ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text)'),
 ('ktv_start_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text,text,timestamp with time zone,jsonb)'),
 ('ktv_release_work_atomic(text,text,jsonb,jsonb)'),
 ('dispatch_commit_form(text,text,jsonb,jsonb)'),
 ('turn_queue_apply_edits(date,text,jsonb)')
), functions AS (SELECT signature,to_regprocedure('public.' || signature) AS oid FROM required)
SELECT f.signature,f.oid IS NOT NULL AS exists_after_migration,p.prosecdef AS security_definer,p.proconfig,
 CASE WHEN f.oid IS NOT NULL THEN has_function_privilege('service_role',f.oid,'EXECUTE') ELSE false END AS service_can_execute,
 CASE WHEN f.oid IS NOT NULL THEN has_function_privilege('authenticated',f.oid,'EXECUTE') ELSE NULL END AS client_can_execute,
 CASE WHEN f.oid IS NOT NULL THEN has_function_privilege('anon',f.oid,'EXECUTE') ELSE NULL END AS anon_can_execute
FROM functions f LEFT JOIN pg_proc p ON p.oid=f.oid ORDER BY f.signature;
-- Each row must exist, service_can_execute=true, client_can_execute=false, anon_can_execute=false.

SELECT required.name,t.tgenabled AS enabled_mode,p.proname AS function_name
FROM (VALUES ('guard_sequential_item_update_trigger'),('zz_dispatch_edit_history')) required(name)
LEFT JOIN pg_trigger t ON t.tgname=required.name AND t.tgrelid='public."BookingItems"'::regclass AND NOT t.tgisinternal
LEFT JOIN pg_proc p ON p.oid=t.tgfoid;
-- Both triggers must exist and be enabled (normally O).

SELECT employee_id,business_date,count(*) AS active_count FROM "KtvAssignments"
 WHERE status='ACTIVE' GROUP BY employee_id,business_date HAVING count(*)>1;
-- Zero rows expected. Cleaning debt uses COMPLETED after the approved skip/release flow, not a second ACTIVE row.
