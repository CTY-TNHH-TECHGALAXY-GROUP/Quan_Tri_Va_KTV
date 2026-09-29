const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('pglite-2');
const root = path.resolve(__dirname, '../..');
const db = new PGlite();
const sql = (text, values) => db.query(text, values);
const one = async text => (await sql(text)).rows[0];
const startAt = '2026-09-29T03:00:00Z';
const turnId = '11111111-1111-4111-8111-111111111111';
const initial = id => ({ id: id + '-seg', ktvId: 'A', startTime: '10:00', duration: 30 });
async function callStart(ids) {
  const rows = (await sql('SELECT id,status,segments FROM "BookingItems" ORDER BY id')).rows.filter(x => ids.includes(x.id));
  const expected = rows.map(r => ({ id: r.id, status: r.status, segments: r.segments }));
  const updates = rows.map(r => ({ id: r.id, status: 'IN_PROGRESS', segments: [{ ...initial(r.id), actualStartTime: startAt }] }));
  return sql('SELECT ktv_start_work_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9) result', [
    'booking','A',ids[0],ids[0]+'-seg',JSON.stringify(expected),JSON.stringify(updates),startAt,turnId,
    JSON.stringify({status:'working',current_order_id:'booking',start_time:'10:00',booking_item_id:ids[0],booking_item_ids:ids,room_id:null,bed_id:null,estimated_end_time:'10:30'})
  ]);
}
(async()=>{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE "Bookings"(id text PRIMARY KEY,"bookingDate" date,"timeStart" timestamptz,status text,"updatedAt" timestamptz);
 CREATE TABLE "BookingItems"(id text PRIMARY KEY,"bookingId" text,status text,segments jsonb,options jsonb DEFAULT '{}',
   handover_images jsonb DEFAULT '[]',handover_status text DEFAULT 'PENDING',handover_skipped boolean DEFAULT false,handover_submitted_at timestamptz);
 CREATE TABLE "TurnQueue"(id uuid PRIMARY KEY,employee_id text,date date,status text,current_order_id text,
   start_time time,estimated_end_time time,room_id text,bed_id text,booking_item_id text,booking_item_ids text[]);
 CREATE TABLE "KtvAssignments"(booking_item_id text,segment_id text,employee_id text,business_date date,booking_id text,status text,updated_at timestamptz);
 CREATE FUNCTION jsonb_unwrap_string(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
   SELECT CASE WHEN jsonb_typeof(p)='string' THEN (p #>> '{}')::jsonb ELSE p END $$;
 CREATE FUNCTION promote_next_assignment(p_employee_id text,p_business_date date) RETURNS jsonb LANGUAGE plpgsql AS $$
 BEGIN
   UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL,booking_item_id=NULL,booking_item_ids='{}'
     WHERE employee_id=p_employee_id AND date=p_business_date AND status='assigned';
   RETURN '{"success":true}'::jsonb;
 END $$;`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260929230000_ktv_start_release_atomic_root.sql'),'utf8'));
 await sql(`INSERT INTO "Bookings" VALUES('booking','2026-09-29',NULL,'PREPARING',now())`);
 await sql(`INSERT INTO "TurnQueue"(id,employee_id,date,status,current_order_id) VALUES($1,'A','2026-09-29','assigned','booking')`,[turnId]);
 for(const id of ['one','two']) await sql('INSERT INTO "BookingItems"(id,"bookingId",status,segments) VALUES($1,$2,$3,$4)',[id,'booking','PREPARING',JSON.stringify(JSON.stringify([initial(id)]))]);
 await db.exec(`CREATE FUNCTION fail_second_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.id='two' AND NEW.status='IN_PROGRESS' THEN RAISE EXCEPTION 'injected second write failure'; END IF;
   RETURN NEW; END $$;
 CREATE TRIGGER fail_second BEFORE UPDATE ON "BookingItems" FOR EACH ROW EXECUTE FUNCTION fail_second_item();`);
 await assert.rejects(callStart(['one','two']),/injected second write failure/);
 assert.equal((await one(`SELECT status FROM "BookingItems" WHERE id='one'`)).status,'PREPARING');
 assert.equal((await one(`SELECT status FROM "Bookings" WHERE id='booking'`)).status,'PREPARING');
 await db.exec('DROP TRIGGER fail_second ON "BookingItems"');
 assert.equal((await callStart(['one','two'])).rows[0].result.success,true);
 assert.equal((await one(`SELECT status FROM "BookingItems" WHERE id='two'`)).status,'IN_PROGRESS');
 await assert.rejects(callStart(['one','two']),/Ca đã thay đổi|Chặng đã bắt đầu/);
 assert.equal((await one(`SELECT segments->0->>'actualStartTime' start FROM "BookingItems" WHERE id='one'`)).start,startAt);
 console.log('PASS atomic START: two-item rollback, success, duplicate preserves start');
 await sql(`UPDATE "BookingItems" SET status='CANCELLED' WHERE id='two'`);
 await assert.rejects(callStart(['two']),/Ca đã thay đổi/);
 await sql(`UPDATE "BookingItems" SET segments=$1 WHERE id='two'`,[JSON.stringify([{...initial('two'),voided:true}])]);
 console.log('PASS cancelled item cannot START');
 await sql(`UPDATE "BookingItems" SET segments=$1,handover_status='SKIPPED',handover_skipped=true WHERE id='one'`,[JSON.stringify([{...initial('one'),actualStartTime:startAt,actualEndTime:'2026-09-29T03:30:00Z'}])]);
 await sql(`INSERT INTO "KtvAssignments" VALUES('one','one-seg','A','2026-09-29','booking','ACTIVE',now())`);
 await db.exec(`CREATE OR REPLACE FUNCTION promote_next_assignment(p_employee_id text,p_business_date date) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"success":false,"error":"injected"}'::jsonb $$;`);
 await assert.rejects(sql(`SELECT ktv_release_work_root_atomic('booking','A','2026-09-29','[]'::jsonb)`),/Không kéo được đơn kế tiếp/);
 assert.equal((await one(`SELECT status FROM "KtvAssignments" WHERE booking_item_id='one'`)).status,'ACTIVE');
 assert.equal((await one(`SELECT segments->0->>'handoverTime' AS mark FROM "BookingItems" WHERE id='one'`)).mark,null);
 await db.exec(`CREATE OR REPLACE FUNCTION promote_next_assignment(p_employee_id text,p_business_date date) RETURNS jsonb LANGUAGE plpgsql AS $$
 BEGIN UPDATE "TurnQueue" SET status='waiting',current_order_id=NULL WHERE employee_id=p_employee_id AND date=p_business_date AND status='assigned';
 RETURN '{"success":true}'::jsonb; END $$;`);
 assert.equal((await sql(`SELECT ktv_release_work_root_atomic('booking','A','2026-09-29','[]'::jsonb) result`)).rows[0].result.success,true);
 assert.equal((await one(`SELECT status FROM "KtvAssignments" WHERE booking_item_id='one'`)).status,'COMPLETED');
 assert.equal((await one(`SELECT status FROM "TurnQueue" WHERE employee_id='A'`)).status,'waiting');
 assert.equal((await one(`SELECT segments->0->>'handoverTime' AS mark FROM "BookingItems" WHERE id='one'`)).mark,null);
 console.log('PASS atomic RELEASE: promotion failure rolls back; successful release frees queue');
 await sql(`INSERT INTO "BookingItems"(id,"bookingId",status,segments,handover_status,handover_skipped)
   VALUES('debt','booking','FEEDBACK',$1,'SKIPPED',true)`,[JSON.stringify([{...initial('debt'),actualStartTime:startAt,actualEndTime:'2026-09-29T03:30:00Z'}])]);
 await sql(`UPDATE "TurnQueue" SET status='working',current_order_id='other' WHERE employee_id='A'`);
 await sql(`INSERT INTO "KtvAssignments" VALUES('other','other-seg','A','2026-09-29','other','ACTIVE',now())`);
 assert.equal((await sql(`SELECT ktv_release_work_root_atomic('booking','A','2026-09-29','["https://local.test/photo.jpg"]'::jsonb) result`)).rows[0].result.success,true);
 assert.equal((await one(`SELECT status FROM "TurnQueue" WHERE employee_id='A'`)).status,'working');
 assert.equal((await one(`SELECT handover_status FROM "BookingItems" WHERE id='debt'`)).handover_status,'PENDING');
 console.log('PASS debt repayment keeps another working order and records submitted photo');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.close());
