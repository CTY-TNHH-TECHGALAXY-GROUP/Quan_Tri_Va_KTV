// Read-only audit of the isolated TEST project; never prints connection credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Client}=require('pg');
const env=require('dotenv').parse(fs.readFileSync(path.join(__dirname,'../.env.local'))),ref='eknggruuiuadwldacpmb',url=new URL(env.DATABASE_URL);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,ref+'.supabase.co');
assert.ok(url.hostname==='db.'+ref+'.supabase.co'||decodeURIComponent(url.username).endsWith('.'+ref));
const db=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000,statement_timeout:15000});
(async()=>{await db.connect();try{await db.query('BEGIN READ ONLY');
  const pending=(await db.query(`SELECT b.id,b.status,to_char(b."bookingDate",'YYYY-MM-DD') AS day,
    (SELECT count(*)::int FROM "BookingItems" i WHERE i."bookingId"=b.id) AS items,
    (SELECT count(*)::int FROM "KtvAssignments" a WHERE a.booking_id=b.id) AS assignments
    FROM "Bookings" b WHERE b.id LIKE 'SEQ_PENDING_20260928_%' ORDER BY b.id`)).rows;
  assert.equal(pending.length,15);assert.ok(pending.every(r=>r.status==='NEW'&&r.assignments===0&&r.day==='2026-09-28'));
  const overlaps=(await db.query(`SELECT a.employee_id,a.booking_id AS first_booking,a.booking_item_id AS first_item,a.status AS first_status,
    a.planned_start_time AS first_start,a.planned_end_time AS first_end,b.booking_id AS second_booking,b.booking_item_id AS second_item,
    b.status AS second_status,b.planned_start_time AS second_start,b.planned_end_time AS second_end
    FROM "KtvAssignments" a JOIN "KtvAssignments" b ON a.employee_id=b.employee_id AND a.id::text<b.id::text
    AND a.status IN ('ACTIVE','QUEUED','READY') AND b.status IN ('ACTIVE','QUEUED','READY')
    AND a.planned_start_time<b.planned_end_time AND b.planned_start_time<a.planned_end_time ORDER BY a.employee_id`)).rows;
  const invalid=(await db.query(`SELECT id,employee_id,booking_id,booking_item_id,status,planned_start_time,planned_end_time
    FROM "KtvAssignments" WHERE status IN ('ACTIVE','QUEUED','READY') AND (planned_start_time IS NULL OR planned_end_time IS NULL
    OR NOT isfinite(planned_start_time) OR NOT isfinite(planned_end_time) OR planned_end_time<=planned_start_time)`)).rows;
  const orphan=(await db.query(`SELECT a.id,a.booking_id,a.booking_item_id,a.status FROM "KtvAssignments" a
    LEFT JOIN "BookingItems" i ON i.id=a.booking_item_id AND i."bookingId"=a.booking_id
    WHERE a.status IN ('ACTIVE','QUEUED','READY') AND i.id IS NULL`)).rows;
  const duplicateActive=(await db.query(`SELECT employee_id,business_date,count(*)::int AS n FROM "KtvAssignments" WHERE status='ACTIVE'
    GROUP BY employee_id,business_date HAVING count(*)>1`)).rows;
  const leftovers=(await db.query(`SELECT id FROM "Bookings" WHERE id LIKE 'SEQ_CONFLICT_QA_%'`)).rows;
  assert.equal(leftovers.length,0);
  const extension=(await db.query(`SELECT name,default_version,installed_version FROM pg_available_extensions WHERE name='btree_gist'`)).rows;
  const definitions=(await db.query(`SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('dispatch_confirm_booking','sync_unstarted_dispatch_plan','dispatch_save_sequential_update')`)).rows;
  const report={project:ref,pending,overlaps,invalid,orphan,duplicateActive,leftovers,extension};
  fs.writeFileSync(path.join(__dirname,'../_plans/sequential_schedule_audit_20260928.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(__dirname,'../_plans/sequential_schedule_functions_20260928.json'),JSON.stringify(definitions,null,2)+'\n');
  await db.query('ROLLBACK');
  console.log(JSON.stringify({pending:pending.length,allNewUnassigned:true,overlaps:overlaps.length,invalid:invalid.length,orphan:orphan.length,
    duplicateActive:duplicateActive.length,raceLeftovers:leftovers.length,btreeGistAvailable:extension.length===1,btreeGistInstalled:extension[0]?.installed_version||null}));
}finally{await db.end();}})().catch(error=>{console.error('FAILED:',error.message);process.exitCode=1;});
