// This script is deliberately restricted to the user's isolated test project.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env.local')));
const expectedRef = 'eknggruuiuadwldacpmb';
const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
const dbUrl = new URL(env.DATABASE_URL);
assert.equal(url.hostname, expectedRef + '.supabase.co', 'Only the isolated test project is allowed');
assert.ok(dbUrl.hostname === 'db.' + expectedRef + '.supabase.co' ||
  decodeURIComponent(dbUrl.username).endsWith('.' + expectedRef), 'DATABASE_URL must match the test project');
const migrations = [
  '20260925120000_live_sequential_handoff.sql',
  '20260926120000_dispatch_edit_history.sql',
  '20260926140000_ktv_finish_service_atomic.sql',
  '20260927120000_sequential_operational_consistency.sql',
  '20260927150000_sequential_scoped_lifecycle.sql',
  '20260927180000_unassign_unstarted_dispatch_staff.sql',
  '20260927190000_sync_unstarted_dispatch_plan.sql',
  '20260927200000_dispatch_form_commit.sql',
  '20260927210000_turn_queue_edits.sql',
  '20260927220000_extend_running_sequential_a.sql',
  '20260927230000_adjust_running_sequential_duration.sql',
  '20260928010000_start_after_completed_queue.sql',
  '20260928020000_prevent_live_assignment_overlap.sql',
  '20260928030000_adjust_running_sequential_pair.sql',
];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const accountsFile = '/private/tmp/sequential-test-accounts-' + expectedRef + '.json';

async function main() {
  const db = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 12000 });
  await db.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const pre = await db.query(read('_plans/sequential_migration_preflight_20260927.sql'));
    assert.equal(pre[1].rows.length, 0, 'Missing required baseline columns');
    assert.ok(pre[2].rows.every(r => r.exists_before_migration), 'Missing baseline RPC');
    for (const name of ['idx_ktvassignments_one_active_per_day','ktvassignments_emp_item_unique'])
      assert.ok(pre[3].rows.some(r => r.indexname === name && r.indexdef.startsWith('CREATE UNIQUE INDEX')), 'Missing uniqueness contract: ' + name);
    assert.equal(pre[4].rows.length, 3, 'Missing Supabase roles');
    await db.query('ROLLBACK');
    console.log('PASS test DB preflight: ' + expectedRef);

    if (process.argv.includes('--migrate')) {
      const before = await db.query("SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition,p.proacl::text AS privileges FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'");
      fs.writeFileSync('/private/tmp/sequential-test-functions-before-' + expectedRef + '.json', JSON.stringify(before.rows, null, 2), { mode: 0o600 });
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
      for (const file of migrations) {
        const version = file.split('_')[0];
        const applied = await db.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version=$1', [version]);
        if (applied.rowCount) { console.log('Already recorded: ' + file); continue; }
        const sql = read('supabase/migrations/' + file);
        await db.query(sql);
        await db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',
          [version, file.slice(version.length + 1, -4), [sql]]);
        console.log('Applied in transaction: ' + file);
      }
      const checks = await db.query(read('_plans/sequential_migration_postcheck_20260927.sql'));
      assert.equal(checks[0].rows.length, 11);
      assert.ok(checks[0].rows.every(r => r.exists_after_migration && r.service_can_execute && !r.client_can_execute && !r.anon_can_execute));
      assert.ok(checks[1].rows.every(r => r.enabled_mode === 'O'));
      assert.equal(checks[2].rows.length, 0);
      const pair = await db.query("SELECT has_function_privilege('service_role','dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb)','EXECUTE') AS server_ok, has_function_privilege('authenticated','dispatch_adjust_running_sequential_pair(text,text,bigint,integer,text,integer,jsonb,jsonb)','EXECUTE') AS client_ok");
      assert.equal(pair.rows[0].server_ok, true);
      assert.equal(pair.rows[0].client_ok, false);
      await db.query("NOTIFY pgrst, 'reload schema'");
      await db.query('COMMIT');
      console.log('PASS committed migrations and postcheck: 12 RPC, 2 triggers, no duplicate ACTIVE');
    }

    if (process.argv.includes('--seed')) {
      const password = fs.existsSync(accountsFile) ? JSON.parse(fs.readFileSync(accountsFile)).password : 'SeqTest-' + randomBytes(12).toString('hex');
      const accounts = [{ id: 'SEQ_TEST_ADMIN', username: 'seq_admin', name: 'TEST Admin', role: 'ADMIN' },
        ...['A','B','C'].map(slot => ({ id: 'SEQ_TEST_' + slot, username: 'seq_' + slot.toLowerCase(), name: 'TEST KTV ' + slot, role: 'TECHNICIAN' }))];
      fs.writeFileSync(accountsFile, JSON.stringify({ project: expectedRef, password, accounts }, null, 2), { mode: 0o600 });
      await db.query('BEGIN');
      for (const [i, a] of accounts.entries()) {
        await db.query(`INSERT INTO "Staff"(id,full_name,status,gender,position,work_type,online_status)
          VALUES($1,$2,'ĐANG LÀM','Female',$3,'TYPE_A','AT_VENUE') ON CONFLICT(id) DO NOTHING`, [a.id,a.name,a.role === 'ADMIN' ? 'Admin' : 'KTV']);
        await db.query(`INSERT INTO "Users"(id,username,password,code,"fullName",role,"isOnShift")
          VALUES($1,$2,$3,$1,$4,$5,true) ON CONFLICT(id) DO NOTHING`, [a.id,a.username,password,a.name,a.role]);
        if (a.role !== 'TECHNICIAN') continue;
        await db.query(`INSERT INTO "TurnQueue"(employee_id,date,queue_position,check_in_order,status)
          VALUES($1,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,$2,$2,'waiting') ON CONFLICT(employee_id,date) DO NOTHING`, [a.id,i]);
        await db.query(`INSERT INTO "KTVAttendance"("employeeId","employeeName","checkType",status,"checkedAt",date)
          SELECT $1,$2,'CHECK_IN','CONFIRMED',now(),(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
          WHERE NOT EXISTS(SELECT 1 FROM "KTVAttendance" WHERE "employeeId"=$1 AND date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND status='CONFIRMED')`, [a.id,a.name]);
      }
      await db.query(`INSERT INTO "Rooms"(id,name,capacity,type) VALUES('SEQ_TEST_ROOM','TEST Phòng nối tiếp',3,'STANDARD') ON CONFLICT(id) DO NOTHING`);
      for (let i=1;i<=3;i++) await db.query(`INSERT INTO "Beds"(id,name,"roomId") VALUES($1,$2,'SEQ_TEST_ROOM') ON CONFLICT(id) DO NOTHING`, ['SEQ_TEST_BED_'+i,'TEST Giường '+i]);
      for (const minutes of [60,90]) await db.query(`INSERT INTO "Services"(id,code,"nameVN","nameEN",duration,"priceVND",category)
        VALUES($1,$1,$2,$2,$3,300000,'BODY') ON CONFLICT(id) DO NOTHING`, ['SEQ_TEST_SVC_'+minutes,'TEST Body '+minutes+' phút',minutes]);
      for (let i=1;i<=5;i++) {
        const id='SEQ_TEST_ORDER_'+i;
        await db.query(`INSERT INTO "Bookings"(id,"billCode","bookingDate","timeBooking","customerName","updatedAt",source,"totalAmount",status)
          VALUES($1,$1,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'16:00',$2,now(),'STANDARD_WALK_IN',300000,'NEW') ON CONFLICT(id) DO NOTHING`, [id,'TEST Case '+i]);
        await db.query(`INSERT INTO "BookingItems"(id,"bookingId","serviceId",price,status,options)
          VALUES($1,$2,$3,300000,'NEW','{}'::jsonb) ON CONFLICT(id) DO NOTHING`, [id+'_ITEM',id,'SEQ_TEST_SVC_'+(i===1?90:60)]);
      }
      await db.query('COMMIT');
      const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
      const buckets = await admin.storage.listBuckets();
      if (buckets.error) throw buckets.error;
      if (!buckets.data.some(bucket => bucket.id === 'attendance')) {
        const created = await admin.storage.createBucket('attendance', { public: true });
        if (created.error) throw created.error;
      }
      console.log('PASS attendance bucket exists for start/handover photos');
      const listed = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (listed.error) throw listed.error;
      for (const a of accounts) {
        const email = a.username + '@nganhaspa.internal';
        let user = listed.data.users.find(u => u.email === email);
        if (!user) {
          const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
            user_metadata: { business_user_id: a.id, techCode: a.id, role: a.role, fullName: a.name } });
          if (created.error) throw created.error;
          user = created.data.user;
        }
        await db.query('UPDATE "Users" SET auth_user_id=$2 WHERE id=$1', [a.id,user.id]);
        const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
        const login = await client.auth.signInWithPassword({ email, password });
        if (login.error) throw login.error;
        assert.equal(login.data.user.id,user.id);
        const own = await client.from('Users').select('id, isOnShift').eq('id',a.id).single();
        if (own.error) throw own.error;
        assert.equal(own.data.id,a.id);
        console.log('PASS real Auth login: ' + a.username);
      }
      console.log('Seed ready: 4 accounts, 3 beds, 5 NEW orders. Credentials: ' + accountsFile);
    }
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { await db.end(); }
}
main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; });
