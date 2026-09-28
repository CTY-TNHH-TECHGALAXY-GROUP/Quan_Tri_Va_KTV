// Approved migration, isolated Supabase TEST only. Preflight, DDL and record commit together.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Client}=require('pg');
const root=path.resolve(__dirname,'..'),ref='eknggruuiuadwldacpmb';
const env=require('dotenv').parse(fs.readFileSync(path.join(root,'.env.local'))),url=new URL(env.DATABASE_URL);
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,ref+'.supabase.co');
assert.ok(url.hostname==='db.'+ref+'.supabase.co'||decodeURIComponent(url.username).endsWith('.'+ref));
const version='20260928020000',file=version+'_prevent_live_assignment_overlap.sql';
const sql=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
const db=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:12000});
const pending=async()=> (await db.query(`SELECT jsonb_build_object(
  'bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM "Bookings" b WHERE id LIKE 'SEQ_PENDING_20260928_%'),
  'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM "BookingItems" i WHERE "bookingId" LIKE 'SEQ_PENDING_20260928_%'),
  'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM "KtvAssignments" a WHERE booking_id LIKE 'SEQ_PENDING_20260928_%')) AS value`)).rows[0].value;
async function verify(){
  const constraint=(await db.query(`SELECT contype,condeferrable,condeferred,convalidated,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid='public."KtvAssignments"'::regclass AND conname='ktv_assignments_no_live_overlap'`)).rows;
  assert.equal(constraint.length,1);assert.equal(constraint[0].contype,'x');
  assert.ok(constraint[0].condeferrable&&constraint[0].condeferred&&constraint[0].convalidated);
  const triggers=(await db.query(`SELECT tgname,tgenabled,tgdeferrable,tginitdeferred FROM pg_trigger
    WHERE tgrelid='public."KtvAssignments"'::regclass AND tgname=ANY($1) ORDER BY tgname`,
    [['validate_final_ktv_assignment_plan_trigger','protect_running_ktv_assignment_trigger']])).rows;
  assert.equal(triggers.length,2);assert.ok(triggers.every(t=>t.tgenabled==='O'));
  assert.ok(triggers.find(t=>t.tgname==='validate_final_ktv_assignment_plan_trigger').tginitdeferred);
  for(const fn of ['validate_final_ktv_assignment_plan()','protect_running_ktv_assignment()']){
    const access=(await db.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS client`,[fn])).rows[0];
    assert.deepEqual(access,{anon:false,client:false});
  }
  return {constraint:constraint[0],triggers};
}
(async()=>{await db.connect();try{
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
  await db.query('LOCK TABLE "KtvAssignments" IN ACCESS EXCLUSIVE MODE');
  const before=await pending();
  assert.equal(before.bookings.length,15);assert.ok(before.bookings.every(b=>b.status==='NEW'));assert.equal(before.assignments,null);
  const old=(await db.query('SELECT statements FROM supabase_migrations.schema_migrations WHERE version=$1',[version])).rows;
  if(old.length){
    assert.deepEqual(old[0].statements,[sql],'recorded migration must match approved SQL');
    await verify();await db.query('ROLLBACK');console.log('PASS approved migration already recorded and verified');return;
  }
  const conflicts=await db.query(`SELECT a.id,b.id FROM "KtvAssignments" a JOIN "KtvAssignments" b
    ON a.employee_id=b.employee_id AND a.id::text<b.id::text
    WHERE a.status IN ('ACTIVE','QUEUED','READY') AND b.status IN ('ACTIVE','QUEUED','READY')
      AND a.planned_start_time<b.planned_end_time AND b.planned_start_time<a.planned_end_time`);
  assert.equal(conflicts.rowCount,0,'Existing overlaps must be resolved explicitly before applying');
  const invalid=await db.query(`SELECT id FROM "KtvAssignments" WHERE status IN ('ACTIVE','QUEUED','READY')
    AND (planned_start_time IS NULL OR planned_end_time IS NULL OR NOT isfinite(planned_start_time)
      OR NOT isfinite(planned_end_time) OR planned_end_time<=planned_start_time)`);
  assert.equal(invalid.rowCount,0,'Existing invalid assignment clocks must be resolved explicitly');
  const backup=(await db.query(`SELECT pg_get_constraintdef(oid) AS definition,conname FROM pg_constraint
    WHERE conrelid='public."KtvAssignments"'::regclass`)).rows;
  fs.writeFileSync(path.join(root,'_plans/sequential_no_overlap_before_apply_20260928.json'),JSON.stringify({project:ref,pending:before,constraints:backup},null,2)+'\n');
  await db.query(sql);
  const checks=await verify();assert.deepEqual(await pending(),before,'migration must preserve all 15 pending orders');
  await db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',[version,'prevent_live_assignment_overlap',[sql]]);
  await db.query("NOTIFY pgrst, 'reload schema'");
  await db.query('COMMIT');
  await verify();assert.deepEqual(await pending(),before);
  fs.writeFileSync(path.join(root,'_plans/sequential_no_overlap_applied_20260928.json'),JSON.stringify({project:ref,version,appliedAt:new Date().toISOString(),pendingPreserved:15,checks},null,2)+'\n');
  console.log('PASS committed '+file+' on TEST '+ref+'; constraint and two triggers verified; 15 NEW orders preserved');
}catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}})().catch(error=>{console.error('FAILED:',error.message);process.exitCode=1;});
