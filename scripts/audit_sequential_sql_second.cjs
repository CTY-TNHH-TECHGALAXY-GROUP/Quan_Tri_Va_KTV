// Reuse the real migration regression setup, inject read-only audit probes.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.join(__dirname,'test_sequential_sql.cjs');
let source=fs.readFileSync(filename,'utf8');
const marker='  // FINISH acceptance with the actual sequential guard + audit triggers still enabled.';
if(!source.includes(marker))throw Error('Audit injection marker missing');
source=source.replace(marker,`
  const afterAOnly=await businessFixture('audit-after-a');
  await dispatch(afterAOnly,[planned(afterAOnly,afterAOnly.a,1,'10:00',30)]);
  await actual(afterAOnly,afterAOnly.a,'actualStartTime',startA);
  await actual(afterAOnly,afterAOnly.a,'actualEndTime','2026-09-26T03:30:00Z');
  await db.query('UPDATE "Bookings" SET status=$1 WHERE id=$2',['IN_PROGRESS',afterAOnly.booking]);
  await apply(afterAOnly,'FINISH_AFTER_A',{itemId:afterAOnly.item,expectedRevision:(await item(afterAOnly)).options.dispatchRevision});
  assert.equal((await item(afterAOnly)).status,'CLEANING');
  assert.equal((await db.query('SELECT status FROM "Bookings" WHERE id=$1',[afterAOnly.booking])).rows[0].status,'IN_PROGRESS');
  console.log('CONFIRMED SQL FINISH_AFTER_A: item CLEANING but Booking remains IN_PROGRESS');

  const future=await businessFixture('audit-future');
  await dispatch(future,[planned(future,future.a,1,'10:00',30)]);
  await db.query('INSERT INTO "TurnQueue" (employee_id,date,status,current_order_id) VALUES ($1,$2,$3,$4)',[future.b,'2026-09-27','working','other-booking']);
  await db.query('INSERT INTO "KtvAssignments" (employee_id,business_date,booking_id,booking_item_id,segment_id,status,planned_start_time,planned_end_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[future.b,'2026-09-27','other-booking','other-item','other-seg','ACTIVE','2026-09-27T03:00:00Z','2026-09-27T04:00:00Z']);
  const futureResult=await apply(future,'ASSIGN_B',{itemId:future.item,toKtvId:future.b,plannedStartAt:'2026-09-27T03:30:00Z',durationMinutes:30,expectedRevision:(await item(future)).options.dispatchRevision});
  assert.equal(futureResult.success,true);
  assert.equal((await assignment(future,future.b)).business_date.toISOString().slice(0,10),'2026-09-26');
  const duplicateActive=(await db.query('SELECT booking_item_id FROM "KtvAssignments" WHERE employee_id=$1 AND status=$2',[future.b,'ACTIVE'])).rows;
  assert.equal(duplicateActive.length,2);
  console.log('CONFIRMED SQL ASSIGN_B: next-business-day B bypasses that day busy check; two overlapping ACTIVE assignments, ledger/queue day stays A day');

  const encoded=await businessFixture('audit-double');
  await dispatch(encoded,[planned(encoded,encoded.a,1,'10:00',30),planned(encoded,encoded.b,2,'10:30',30)]);
  // Simulate a legacy import/restore: migration guards do not validate INSERT.
  const oldEncoded=await item(encoded);
  await db.query('INSERT INTO "BookingItems" (id,"bookingId",status,segments,options) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)',
    ['audit-double-copy',encoded.booking,'IN_PROGRESS',JSON.stringify(oldEncoded.segments),JSON.stringify(JSON.stringify(JSON.stringify({sequentialSlots:2})))]);
  await db.query('UPDATE "BookingItems" SET status=$1 WHERE id=$2',['DONE','audit-double-copy']);
  assert.equal((await db.query('SELECT status FROM "BookingItems" WHERE id=$1',['audit-double-copy'])).rows[0].status,'DONE');
  console.log('CONFIRMED SQL double options: client sees sequentialSlots2; DB one-layer unwrap permits DONE with both slots unstarted');

`+marker);
const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));loaded._compile(source,filename);
