const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('pglite-2');
async function main() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE "Bookings" (id text PRIMARY KEY, status text, rating numeric, "updatedAt" timestamptz);
    CREATE TABLE "BookingGuests" (id text PRIMARY KEY, booking_id text, rating numeric);
    CREATE TABLE "BookingItems" (id text PRIMARY KEY, "bookingId" text, segments jsonb, status text, "itemRating" numeric,
      guest_id text, options jsonb, handover_status text, "serviceId" text,
      handover_images jsonb, handover_skipped boolean, handover_submitted_at timestamptz);
  `);
  await db.exec(readFileSync(join(__dirname, '../supabase/migrations/20260926140000_ktv_finish_service_atomic.sql'), 'utf8'));
  const start = '2026-09-26T03:00:00Z';
  const end = '2026-09-26T03:30:00Z';
  const seg = (id, employee = 'A') => ({ id, ktvId: employee, duration: 30, actualStartTime: start });
  await db.query('INSERT INTO "Bookings" (id,status,rating) VALUES ($1,$2,NULL)', ['booking', 'IN_PROGRESS']);
  const insert = async (id, segments, options = {}) => db.query(`INSERT INTO "BookingItems" (id,"bookingId",segments,status,options,"serviceId") VALUES ($1,'booking',$2,'IN_PROGRESS',$3,'svc')`, [id, JSON.stringify(segments), JSON.stringify(options)]);
  await insert('one', [seg('one-a')]);
  await insert('two', [seg('two-a')]);
  await insert('child', [], { mergedIntoId: 'one' });
  const rows = async () => (await db.query('SELECT * FROM "BookingItems" ORDER BY id')).rows;
  const booking = async () => (await db.query('SELECT * FROM "Bookings"')).rows[0];
  const snapshots = async () => (await db.query('SELECT id,segments,status,"itemRating",guest_id,options,handover_status,handover_images,handover_skipped,handover_submitted_at,"serviceId" FROM "BookingItems" ORDER BY id')).rows;
  const payload = async () => ({ booking: ((row) => ({ ...row, rating: row.rating == null ? null : Number(row.rating) }))(await booking()), snapshots: await snapshots(), guests: (await db.query('SELECT id,rating FROM "BookingGuests" ORDER BY id')).rows.map(row => ({ ...row, rating: row.rating == null ? null : Number(row.rating) })) });
  const finishPatches = async () => (await rows()).map(row => ({ id: row.id, status: 'CLEANING', ...(row.id === 'child' ? {} : { segments: row.segments.map(s => ({ ...s, actualEndTime: s.actualEndTime || end })) }) }));
  const commit = (baseline, patches, status = 'CLEANING') => db.query('SELECT ktv_finish_service_atomic($1,$2,$3,$4,$5,$6) AS result', ['booking', JSON.stringify(baseline.booking), JSON.stringify(baseline.snapshots), JSON.stringify(baseline.guests), JSON.stringify(patches), status]);
  await db.exec(`UPDATE "BookingItems" SET handover_submitted_at = '2026-09-26T03:00:00Z' WHERE id = 'child'`);
  const before = await rows(), bookingBefore = await booking(), baseline = await payload();
  const patches = await finishPatches();
  await db.exec(`CREATE FUNCTION reject_finish_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'two' THEN RAISE EXCEPTION 'second item failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_finish_test BEFORE UPDATE ON "BookingItems" FOR EACH ROW EXECUTE FUNCTION reject_finish_test();`);
  await assert.rejects(() => commit(baseline, patches), /second item failure/);
  assert.deepEqual(await rows(), before);
  assert.deepEqual(await booking(), bookingBefore);
  await db.exec('DROP TRIGGER reject_finish_test ON "BookingItems"');
  console.log('PASS ATOMIC FINISH 1: second target error rolls back all targets, child and Booking status');

  await db.exec(`CREATE FUNCTION reject_child_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'child' THEN RAISE EXCEPTION 'child failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_child_test BEFORE UPDATE ON "BookingItems" FOR EACH ROW EXECUTE FUNCTION reject_child_test();`);
  await assert.rejects(() => commit(baseline, [...patches.filter(p => p.id !== 'child'), patches.find(p => p.id === 'child')]), /child failure/);
  assert.deepEqual(await rows(), before);
  assert.deepEqual(await booking(), bookingBefore);
  await db.exec('DROP TRIGGER reject_child_test ON "BookingItems"');
  console.log('PASS ATOMIC FINISH 2: merged child error rolls back earlier target writes');

  await db.exec(`CREATE FUNCTION reject_booking_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'booking failure'; END $$;
    CREATE TRIGGER reject_booking_test BEFORE UPDATE ON "Bookings" FOR EACH ROW EXECUTE FUNCTION reject_booking_test();`);
  await assert.rejects(() => commit(baseline, patches), /booking failure/);
  assert.deepEqual(await rows(), before);
  assert.deepEqual(await booking(), bookingBefore);
  await db.exec('DROP TRIGGER reject_booking_test ON "Bookings"');
  console.log('PASS ATOMIC FINISH 3: Booking update failure rolls back all item/child changes');

  for (const sql of [
    `UPDATE "BookingItems" SET options = '{"dispatchRevision":1}' WHERE id = 'one'`,
    `UPDATE "BookingItems" SET segments = jsonb_set(segments,'{0,actualStartTime}','"2026-09-26T03:05:00Z"') WHERE id = 'one'`,
    `UPDATE "BookingItems" SET status = 'DONE' WHERE id = 'child'`,
    `UPDATE "Bookings" SET rating = 5`,
    `INSERT INTO "BookingGuests" VALUES ('guest','booking',5)`
  ]) {
    const prior = await payload();
    await db.exec(sql);
    const changed = await rows(), changedBooking = await booking();
    await assert.rejects(() => commit(prior, patches), /changed/);
    assert.deepEqual(await rows(), changed);
    assert.deepEqual(await booking(), changedBooking);
  }
  const staleSet = await payload();
  await insert('late', [seg('late-a')]);
  await assert.rejects(() => commit(staleSet, patches), /item set changed/);
  await db.exec(`DELETE FROM "BookingItems" WHERE id = 'late'`);
  console.log('PASS ATOMIC FINISH 4: options, stamps, child status, booking rating, guest rating/set and item-set stale snapshots rejected');

  const latest = await payload();
  const result = (await commit(latest, await finishPatches())).rows[0].result;
  assert.equal(result.success, true);
  assert.equal(result.booking.status, 'CLEANING');
  assert.ok(result.booking.updatedAt);
  assert.ok((await rows()).filter(r => r.id !== 'child').every(r => r.segments[0].actualEndTime));
  assert.equal((await rows()).find(r => r.id === 'child').status, 'CLEANING');
  const completed = await rows();
  await commit(await payload(), await finishPatches());
  assert.deepEqual(await rows(), completed);
  await assert.rejects(() => commit(latest, patches), /changed/);
  console.log('PASS ATOMIC FINISH 5: successful batch + reload/retry preserve committed stamps; previous version rejected');

  await db.exec('DELETE FROM "BookingItems"');
  await db.exec(`UPDATE "Bookings" SET status = 'IN_PROGRESS'`);
  const oldB = { ...seg('old-b', 'B'), sequenceSlot: 2, voided: true };
  const seqA = { ...seg('seq-a'), sequenceSlot: 1 };
  const seqB = { id: 'seq-b', ktvId: 'B', sequenceSlot: 2, duration: 30 };
  await insert('seq', [seqA, oldB, seqB], { sequentialSlots: 2 });
  await commit(await payload(), [{ id: 'seq', segments: [{ ...seqA, actualEndTime: end }, oldB, seqB], status: 'IN_PROGRESS' }], 'IN_PROGRESS');
  assert.equal((await booking()).status, 'IN_PROGRESS');
  const aDone = (await rows())[0].segments[0];
  const bDone = { ...seqB, actualStartTime: end, actualEndTime: '2026-09-26T04:00:00Z' };
  await commit(await payload(), [{ id: 'seq', segments: [aDone, oldB, bDone], status: 'CLEANING' }]);
  assert.equal((await booking()).status, 'CLEANING');
  assert.deepEqual((await rows())[0].segments[0], aDone);
  assert.deepEqual((await rows())[0].segments[1], oldB);
  console.log('PASS ATOMIC FINISH 6: sequential A waits B, current B completes with cancelled B/A untouched');

  const prior = await payload(), savedRows = await rows();
  await assert.rejects(() => commit(prior, [{ id: 'foreign', status: 'CLEANING' }]), /Invalid FINISH item update/);
  await assert.rejects(() => commit(prior, [{ id: 'seq', status: 'CLEANING', options: {} }]), /Invalid FINISH item update/);
  await assert.rejects(() => commit({ ...prior, snapshots: [{ id: 'seq' }] }, [{ id: 'seq', status: 'CLEANING' }]), /Incomplete FINISH snapshot/);
  await assert.rejects(() => commit(prior, [{ id: 'seq', status: null }]), /Invalid FINISH item update/);
  await assert.rejects(() => commit(prior, [{ id: 'seq', status: 'CLEANING' }], null), /Invalid FINISH batch/);
  assert.deepEqual(await rows(), savedRows);
  const access = (await db.query(`SELECT has_function_privilege('anon','ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text)','EXECUTE') AS anon,
    has_function_privilege('authenticated','ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text)','EXECUTE') AS authenticated,
    has_function_privilege('service_role','ktv_finish_service_atomic(text,jsonb,jsonb,jsonb,jsonb,text)','EXECUTE') AS service`)).rows[0];
  assert.deepEqual(access, { anon: false, authenticated: false, service: true });
  console.log('PASS ATOMIC FINISH 7: malformed/foreign batches fail closed; only service role can execute');
  await db.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
