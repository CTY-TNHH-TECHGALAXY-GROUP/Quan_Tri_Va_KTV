const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('pglite-2');

const migration = readFileSync(join(__dirname, '../supabase/migrations/20260925120000_live_sequential_handoff.sql'), 'utf8');
const startA = '2026-09-26T03:00:00Z';
const endA = '2026-09-26T04:00:00Z';

async function main() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE "Bookings" (id text PRIMARY KEY, parent_booking_id text);
    CREATE TABLE "BookingItems" (id text PRIMARY KEY, "bookingId" text, status text, options jsonb, segments jsonb, "technicianCodes" text[], "timeEnd" timestamptz);
    CREATE TABLE "KtvAssignments" (employee_id text, business_date date, booking_id text, booking_item_id text, segment_id text, planned_start_time timestamptz, planned_end_time timestamptz, room_id text, bed_id text, status text, dispatch_source text, created_at timestamptz DEFAULT now(), UNIQUE(employee_id, booking_item_id));
    CREATE TABLE "TurnQueue" (employee_id text, date date, status text, current_order_id text, booking_item_id text, booking_item_ids text[], room_id text, bed_id text, start_time time, estimated_end_time time);
    CREATE TABLE "TurnLedger" (date date, booking_id text, employee_id text, source text, UNIQUE(date, booking_id, employee_id));
    CREATE TABLE "Staff" (id text, status text);
    CREATE FUNCTION jsonb_unwrap_string(v jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT CASE WHEN jsonb_typeof(v) = 'string' THEN (v #>> '{}')::jsonb ELSE v END $$;
    CREATE FUNCTION promote_next_assignment(e text, d date) RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE "TurnQueue" SET status = 'waiting', current_order_id = NULL, booking_item_id = NULL,
        booking_item_ids = '{}'::text[], start_time = NULL, estimated_end_time = NULL
      WHERE employee_id = e AND date = d;
      RETURN '{"success":true}'::jsonb;
    END $$;
  `);
  await db.exec(migration);

  async function fixture(n) {
    const id = { booking: `b${n}`, item: `i${n}`, a: `A${n}`, b: `B${n}`, c: `C${n}` };
    const aSegment = { id: `a${n}`, ktvId: id.a, roomId: 'R', bedId: 'X', startTime: '10:00', endTime: '11:00', duration: 60, actualStartTime: startA };
    await db.query('INSERT INTO "Bookings" VALUES ($1, NULL)', [id.booking]);
    await db.query('INSERT INTO "BookingItems" VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::text[], NULL)',
      [id.item, id.booking, 'IN_PROGRESS', '{}', JSON.stringify([aSegment]), [id.a]]);
    await db.query(`INSERT INTO "KtvAssignments" (employee_id, business_date, booking_id, booking_item_id, segment_id, planned_start_time, planned_end_time, status)
      VALUES ($1, '2026-09-26', $2, $3, $4, $5, $6, 'ACTIVE')`, [id.a, id.booking, id.item, aSegment.id, startA, endA]);
    for (const employee of [id.b, id.c]) {
      await db.query('INSERT INTO "Staff" VALUES ($1, $2)', [employee, 'ĐANG LÀM']);
      await db.query('INSERT INTO "TurnQueue" (employee_id, date, status) VALUES ($1, $2, $3)', [employee, '2026-09-26', 'waiting']);
    }
    return id;
  }
  const item = async id => (await db.query('SELECT * FROM "BookingItems" WHERE id = $1', [id.item])).rows[0];
  const enable = async id => db.query('SELECT dispatch_enable_sequential_item($1, $2)', [id.booking, id.item]);
  const assign = async (id, employee, at, confirm = false) =>
    (await db.query('SELECT dispatch_assign_sequential_slot_b($1, $2, $3, $4, 20, $5) AS result',
      [id.booking, id.item, employee, at, confirm])).rows[0].result;
  const assignment = async (id, employee) =>
    (await db.query('SELECT * FROM "KtvAssignments" WHERE booking_item_id = $1 AND employee_id = $2', [id.item, employee])).rows[0];
  const ledger = async (id, employee) =>
    (await db.query('SELECT * FROM "TurnLedger" WHERE booking_id = $1 AND employee_id = $2', [id.booking, employee])).rows;
  const log = (n, name) => console.log(`PASS ${n}/12: ${name}`);

  // 1. Mark A as sequential without closing its actual work.
  {
    const id = await fixture(1);
    await enable(id);
    const row = await item(id);
    assert.equal(row.options.sequentialSlots, 2);
    assert.equal(row.segments.length, 1);
    assert.equal(row.segments[0].sequenceSlot, 1);
    assert.equal(row.segments[0].actualEndTime, undefined);
    log(1, 'Bật nối tiếp giữ nguyên giờ thực của A');
  }

  // 2. An overlapping plan needs counter confirmation before B is written.
  {
    const id = await fixture(2);
    await enable(id);
    const overlap = await assign(id, id.b, '2026-09-26T03:40:00Z');
    assert.equal(overlap.code, 'OVERLAP_CONFIRM_REQUIRED');
    assert.equal(overlap.referenceKind, 'planned');
    assert.equal((await item(id)).segments.length, 1);
    assert.equal((await assign(id, id.b, '2026-09-26T03:40:00Z', true)).success, true);
    const row = await item(id);
    assert.equal(row.segments[0].actualEndTime, undefined);
    assert.equal(row.segments[1].actualStartTime, undefined);
    assert.equal((await ledger(id, id.b)).length, 1);
    await db.query(`UPDATE "BookingItems" SET segments = jsonb_set(segments, '{0,actualEndTime}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify('2026-09-26T04:05:00Z'), id.item]);
    const actualOverlap = await assign(id, id.b, endA);
    assert.equal(actualOverlap.code, 'OVERLAP_CONFIRM_REQUIRED');
    assert.equal(actualOverlap.referenceKind, 'actual');
    const beforeEdit = (await item(id)).segments;
    assert.equal((await assign(id, id.b, '2026-09-26T04:15:00Z')).success, true);
    const afterEdit = (await item(id)).segments;
    assert.deepEqual(afterEdit[0], beforeEdit[0]);
    assert.equal(afterEdit[1].id, beforeEdit[1].id);
    assert.equal(afterEdit[1].plannedStartAt, '2026-09-26T04:15:00+00:00');
    assert.equal(afterEdit[1].actualStartTime, undefined);
    log(2, 'Giờ B chồng mốc A dự kiến/thực tế cần xác nhận');
  }

  // 3. Replacing an unstarted B releases its assignment and turn.
  {
    const id = await fixture(3);
    await enable(id);
    await assign(id, id.b, endA);
    assert.equal((await assign(id, id.c, '2026-09-26T04:10:00Z')).success, true);
    const row = await item(id);
    assert.equal(row.segments.length, 3);
    assert.equal(row.segments[1].voided, true);
    assert.equal(row.segments[2].ktvId, id.c);
    assert.equal((await assignment(id, id.b)).status, 'CANCELLED');
    assert.equal((await assignment(id, id.c)).status, 'ACTIVE');
    assert.equal((await ledger(id, id.b)).length, 0);
    assert.equal((await ledger(id, id.c)).length, 1);
    assert.equal((await db.query('SELECT status FROM "TurnQueue" WHERE employee_id = $1', [id.b])).rows[0].status, 'waiting');
    const stale = row.segments.map(s => s.ktvId === id.b ? { ...s, actualStartTime: endA } : s);
    await assert.rejects(db.query('UPDATE "BookingItems" SET segments = $1::jsonb WHERE id = $2', [JSON.stringify(stale), id.item]));
    log(3, 'Đổi B trả tua cũ và chặn B cũ bắt đầu từ dữ liệu stale');
  }

  // 4. A finishing cannot complete the item until counter explicitly skips B.
  {
    const id = await fixture(4);
    await enable(id);
    await assign(id, id.b, endA);
    await db.query(`UPDATE "BookingItems" SET segments = jsonb_set(segments, '{0,actualEndTime}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify('2026-09-26T04:05:00Z'), id.item]);
    await assert.rejects(db.query('UPDATE "BookingItems" SET status = $1 WHERE id = $2', ['CLEANING', id.item]));
    await db.query('SELECT dispatch_finish_sequential_after_a($1, $2)', [id.booking, id.item]);
    const row = await item(id);
    assert.equal(row.status, 'CLEANING');
    assert.equal(row.options.finishedAfterA, true);
    assert.equal(row.segments[0].actualEndTime, '2026-09-26T04:05:00Z');
    assert.equal(row.segments[1].voided, true);
    assert.equal((await assignment(id, id.a)).status, 'ACTIVE');
    assert.equal((await ledger(id, id.b)).length, 0);
    log(4, 'A xong vẫn chờ B; kết thúc sau A giữ mốc A, hủy B');
  }

  // 5. A's end and B's start survive a stale whole-array write.
  {
    const id = await fixture(5);
    await enable(id);
    await assign(id, id.b, endA);
    const stale = (await item(id)).segments;
    await db.query(`UPDATE "BookingItems" SET segments = jsonb_set(segments, '{0,actualEndTime}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify('2026-09-26T04:05:00Z'), id.item]);
    stale[1].actualStartTime = '2026-09-26T03:55:00Z';
    await db.query('UPDATE "BookingItems" SET segments = $1::jsonb WHERE id = $2', [JSON.stringify(stale), id.item]);
    let row = await item(id);
    assert.equal(row.segments[0].actualEndTime, '2026-09-26T04:05:00Z');
    assert.equal(row.segments[1].actualStartTime, '2026-09-26T03:55:00Z');
    await assert.rejects(db.query('UPDATE "BookingItems" SET status = $1 WHERE id = $2', ['CLEANING', id.item]));
    row.segments[1].actualEndTime = '2026-09-26T04:15:00Z';
    await db.query('UPDATE "BookingItems" SET segments = $1::jsonb, status = $2 WHERE id = $3',
      [JSON.stringify(row.segments), 'CLEANING', id.item]);
    assert.equal((await item(id)).status, 'CLEANING');
    log(5, 'Ghi stale giữ cả A.end/B.start, chỉ hoàn tất khi B xong');
  }

  // Exercise the real initial-dispatch RPC too; no shared database is used.
  await db.exec(`
    CREATE TYPE "BookingStatus" AS ENUM ('NEW', 'WAITING', 'PREPARING', 'IN_PROGRESS', 'COMPLETED', 'CLEANING', 'FEEDBACK', 'DONE', 'CANCELLED', 'SPLIT');
    ALTER TABLE "Bookings" ADD COLUMN status "BookingStatus" DEFAULT 'NEW', ADD COLUMN "technicianCode" text,
      ADD COLUMN "bedId" text, ADD COLUMN "roomName" text, ADD COLUMN notes text, ADD COLUMN "updatedAt" timestamptz;
    ALTER TABLE "BookingItems" ADD COLUMN "roomName" text, ADD COLUMN "bedId" text;
    ALTER TABLE "KtvAssignments" ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN priority integer,
      ADD COLUMN sequence_no integer, ADD COLUMN updated_at timestamptz;
    ALTER TABLE "TurnQueue" ADD COLUMN queue_position integer, ADD COLUMN last_served_at timestamptz;
    CREATE UNIQUE INDEX turn_queue_employee_date ON "TurnQueue"(employee_id, date);
  `);
  await db.exec(readFileSync(join(__dirname, '../supabase/migrations/20260830_add_dispatch_booking_guard.sql'), 'utf8'));
  for (const pickBBeforeSending of [true, false]) {
    const n = pickBBeforeSending ? 6 : 7;
    const id = { booking: `b${n}`, item: `i${n}`, a: `A${n}`, b: `B${n}` };
    const a = { id: `a${n}`, ktvId: id.a, roomId: 'R', bedId: 'X', sequenceSlot: 1, startTime: '10:00', endTime: '11:00', duration: 60 };
    const b = { id: `s-b${n}`, ktvId: id.b, roomId: 'R', bedId: 'X', sequenceSlot: 2, startTime: '10:30', endTime: '11:00', duration: 30 };
    await db.query('INSERT INTO "Bookings" (id) VALUES ($1)', [id.booking]);
    await db.query('INSERT INTO "BookingItems" (id, "bookingId", status, options, segments) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)',
      [id.item, id.booking, 'NEW', '{"sequentialSlots":2}', JSON.stringify([a])]);
    // A saved sequential draft can still be changed or cancelled before dispatch.
    await db.query('UPDATE "BookingItems" SET options = $1::jsonb WHERE id = $2', ['{}', id.item]);
    a.duration = 30; a.endTime = '10:30';
    const segments = pickBBeforeSending ? [a, b] : [a];
    await db.query('UPDATE "BookingItems" SET options = $1::jsonb, segments = $2::jsonb WHERE id = $3',
      ['{"sequentialSlots":2}', JSON.stringify(segments), id.item]);
    assert.equal((await item(id)).segments[0].duration, 30);
    assert.equal((await ledger(id, id.b)).length, 0);
    assert.equal(await assignment(id, id.b), undefined);
    for (const employee of [id.a, id.b]) {
      await db.query('INSERT INTO "Staff" VALUES ($1, $2)', [employee, 'ĐANG LÀM']);
      await db.query('INSERT INTO "TurnQueue" (employee_id, date, status) VALUES ($1, $2, $3)', [employee, '2026-09-26', 'waiting']);
    }
    const assignments = segments.map(s => ({ ktvId: s.ktvId, bookingItemId: id.item, segmentId: s.id,
      sequenceNo: s.sequenceSlot, roomId: s.roomId, bedId: s.bedId, startTime: s.startTime, endTime: s.endTime }));
    const updates = [{ id: id.item, status: 'PREPARING', options: { sequentialSlots: 2 }, segments, technicianCodes: segments.map(s => s.ktvId) }];
    const result = (await db.query(`SELECT dispatch_confirm_booking($1, '2026-09-26', 'PREPARING', NULL, NULL, NULL, NULL, $2::jsonb, $3::jsonb) AS result`,
      [id.booking, JSON.stringify(assignments), JSON.stringify(updates)])).rows[0].result;
    assert.equal(result.success, true, result.error);
    assert.equal((await item(id)).status, 'PREPARING');
    assert.equal((await assignment(id, id.a)).segment_id, a.id);
    assert.equal((await ledger(id, id.b)).length, pickBBeforeSending ? 1 : 0);
    if (!pickBBeforeSending) {
      const added = (await db.query('SELECT dispatch_assign_sequential_slot_b($1, $2, $3, $4, 30, false) AS result',
        [id.booking, id.item, id.b, '2026-09-26T03:30:00Z'])).rows[0].result;
      assert.equal(added.success, true);
    }
    assert.equal((await assignment(id, id.b)).status, 'ACTIVE');
    assert.equal((await ledger(id, id.b)).length, 1);
    // Once sent, stale edits cannot move A or replace B via a whole-array save.
    const live = (await item(id)).segments;
    await db.query('UPDATE "BookingItems" SET segments = $1::jsonb WHERE id = $2',
      [JSON.stringify(live.map(s => ({ ...s, duration: 99 }))), id.item]);
    assert.equal((await item(id)).segments[0].duration, 30);
    assert.equal((await item(id)).segments[1].duration, 30);
    log(n, pickBBeforeSending ? 'Nháp sửa được A/B; gửi A+B tạo phân công thật đúng segment' : 'Gửi A với B trống không giữ tua B; chọn B sau tạo phân công thật');
  }
  // Five operational flows use the real dispatch RPC and sequential guard together.
  async function businessFixture(n) {
    const id = { booking: `flow-b${n}`, item: `flow-i${n}`, a: `flow-A${n}`, b: `flow-B${n}`, c: `flow-C${n}` };
    await db.query('INSERT INTO "Bookings" (id) VALUES ($1)', [id.booking]);
    await db.query('INSERT INTO "BookingItems" (id, "bookingId", status, options, segments) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)',
      [id.item, id.booking, 'NEW', '{}', '[]']);
    for (const employee of [id.a, id.b, id.c]) {
      await db.query('INSERT INTO "Staff" VALUES ($1, $2)', [employee, 'ĐANG LÀM']);
      await db.query('INSERT INTO "TurnQueue" (employee_id, date, status) VALUES ($1, $2, $3)', [employee, '2026-09-26', 'waiting']);
    }
    return id;
  }
  const planned = (id, employee, slot, start, duration) => {
    const startMs = Date.parse(`2026-09-26T${start}:00+07:00`);
    const end = new Date(startMs + duration * 60_000);
    return { id: `s-${employee}`, ktvId: employee, sequenceSlot: slot, roomId: 'R', bedId: 'X', startTime: start,
      duration, endTime: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(end) };
  };
  async function dispatch(id, segments, options = { sequentialSlots: 2 }) {
    const assignments = segments.map(s => ({ ktvId: s.ktvId, bookingItemId: id.item, segmentId: s.id,
      sequenceNo: s.sequenceSlot || 0, roomId: s.roomId, bedId: s.bedId, startTime: s.startTime, endTime: s.endTime }));
    const updates = [{ id: id.item, status: 'PREPARING', options, segments, technicianCodes: segments.map(s => s.ktvId) }];
    const result = (await db.query(`SELECT dispatch_confirm_booking($1, '2026-09-26', 'PREPARING', NULL, NULL, NULL, NULL, $2::jsonb, $3::jsonb) AS result`,
      [id.booking, JSON.stringify(assignments), JSON.stringify(updates)])).rows[0].result;
    assert.equal(result.success, true, result.error);
  }
  const assignMinutes = async (id, employee, at, duration) => (await db.query(
    'SELECT dispatch_assign_sequential_slot_b($1, $2, $3, $4, $5, false) AS result',
    [id.booking, id.item, employee, at, duration])).rows[0].result;
  async function actual(id, employee, field, at, status = 'IN_PROGRESS') {
    const segments = (await item(id)).segments;
    segments.find(s => s.ktvId === employee && !s.voided)[field] = at;
    await db.query('UPDATE "BookingItems" SET segments = $1::jsonb, status = $2 WHERE id = $3', [JSON.stringify(segments), status, id.item]);
  }

  {
    const id = await businessFixture(8);
    await dispatch(id, [planned(id, id.a, 1, '10:00', 30), planned(id, id.b, 2, '10:30', 30)]);
    assert.equal((await assignment(id, id.a)).planned_start_time.toISOString(), '2026-09-26T03:00:00.000Z');
    assert.equal((await assignment(id, id.b)).planned_start_time.toISOString(), '2026-09-26T03:30:00.000Z');
    assert.equal((await ledger(id, id.a)).length, 1); assert.equal((await ledger(id, id.b)).length, 1);
    await actual(id, id.a, 'actualStartTime', startA);
    await actual(id, id.a, 'actualEndTime', '2026-09-26T03:30:00Z');
    await assert.rejects(db.query('UPDATE "BookingItems" SET status = $1 WHERE id = $2', ['CLEANING', id.item]));
    await actual(id, id.b, 'actualStartTime', '2026-09-26T03:30:00Z');
    await actual(id, id.b, 'actualEndTime', endA, 'CLEANING');
    assert.equal((await item(id)).status, 'CLEANING');
    log(8, 'FLOW 1: A30/B30 từ mới đến CLEANING, giờ assignment và ledger riêng');
  }
  {
    const id = await businessFixture(9);
    await dispatch(id, [planned(id, id.a, undefined, '10:00', 60)], {});
    const aAssignment = await assignment(id, id.a);
    await dispatch(id, [planned(id, id.a, undefined, '10:00', 30)], {});
    assert.equal((await assignment(id, id.a)).segment_id, aAssignment.segment_id);
    assert.equal((await assignment(id, id.a)).planned_end_time.toISOString(), '2026-09-26T03:30:00.000Z');
    assert.equal((await ledger(id, id.a)).length, 1);
    await enable(id);
    assert.equal((await assignMinutes(id, id.b, '2026-09-26T03:30:00Z', 30)).success, true);
    assert.equal((await item(id)).segments[0].duration, 30);
    assert.equal((await item(id)).segments[0].actualStartTime, undefined);
    const running = await businessFixture('9-running');
    await dispatch(running, [planned(running, running.a, undefined, '10:00', 60)], {});
    await actual(running, running.a, 'actualStartTime', startA);
    await enable(running);
    const stale = (await item(running)).segments.map(s => ({ ...s, duration: 30, endTime: '10:30' }));
    await db.query('UPDATE "BookingItems" SET segments = $1::jsonb WHERE id = $2', [JSON.stringify(stale), running.item]);
    assert.equal((await item(running)).segments[0].duration, 60);
    await actual(running, running.a, 'actualEndTime', '2026-09-26T03:30:00Z');
    const finishedA = (await item(running)).segments[0];
    assert.equal((await assignMinutes(running, running.b, '2026-09-26T03:30:00Z', 30)).success, true);
    assert.deepEqual((await item(running)).segments[0], finishedA);
    await actual(running, running.b, 'actualStartTime', '2026-09-26T03:30:00Z');
    await actual(running, running.b, 'actualEndTime', endA, 'CLEANING');
    log(9, 'FLOW 2: A full60 đã gửi → A30 trước bắt đầu → RPC cập nhật giờ cuối → B30');
  }
  {
    const id = await businessFixture(10);
    await dispatch(id, [planned(id, id.a, 1, '10:00', 30)]);
    assert.equal(await assignment(id, id.b), undefined); assert.equal((await ledger(id, id.b)).length, 0);
    await actual(id, id.a, 'actualStartTime', startA);
    await actual(id, id.a, 'actualEndTime', '2026-09-26T03:35:00Z');
    const aBefore = (await item(id)).segments[0];
    const overlap = await assignMinutes(id, id.b, '2026-09-26T03:30:00Z', 30);
    assert.equal(overlap.code, 'OVERLAP_CONFIRM_REQUIRED'); assert.equal(overlap.referenceKind, 'actual');
    assert.equal((await assignMinutes(id, id.b, '2026-09-26T03:35:00Z', 30)).success, true);
    assert.deepEqual((await item(id)).segments[0], aBefore);
    await actual(id, id.b, 'actualStartTime', '2026-09-26T03:35:00Z');
    await actual(id, id.b, 'actualEndTime', '2026-09-26T04:05:00Z', 'CLEANING');
    assert.deepEqual((await item(id)).segments[0], aBefore);
    log(10, 'FLOW 3: A làm trước/B trống → A xong → gán B theo mốc thực, giữ A');
  }
  {
    const id = await businessFixture(11);
    await db.query('UPDATE "BookingItems" SET options = $1::jsonb, segments = $2::jsonb WHERE id = $3',
      ['{"sequentialSlots":2}', JSON.stringify([planned(id, id.a, 1, '10:00', 40), planned(id, id.b, 2, '10:40', 20)]), id.item]);
    assert.equal(await assignment(id, id.b), undefined);
    await dispatch(id, [planned(id, id.a, 1, '10:00', 30), planned(id, id.c, 2, '10:30', 30)]);
    assert.equal((await item(id)).segments[0].duration, 30); assert.equal((await item(id)).segments[1].duration, 30);
    assert.equal(await assignment(id, id.b), undefined);
    const aBefore = (await item(id)).segments[0];
    const cId = (await item(id)).segments[1].id;
    assert.equal((await assignMinutes(id, id.c, '2026-09-26T03:50:00Z', 30)).success, true);
    assert.equal((await item(id)).segments[1].id, cId);
    assert.deepEqual((await item(id)).segments[0], aBefore);
    assert.equal((await assignMinutes(id, id.b, '2026-09-26T03:50:00Z', 30)).success, true);
    assert.equal((await assignment(id, id.c)).status, 'CANCELLED'); assert.equal((await ledger(id, id.c)).length, 0);
    assert.equal((await assignment(id, id.b)).status, 'ACTIVE'); assert.equal((await ledger(id, id.b)).length, 1);
    const stale = (await item(id)).segments.map(s => s.ktvId === id.c ? { ...s, actualStartTime: endA } : s);
    await assert.rejects(db.query('UPDATE "BookingItems" SET segments = $1::jsonb WHERE id = $2', [JSON.stringify(stale), id.item]));
    await actual(id, id.a, 'actualStartTime', startA);
    await actual(id, id.a, 'actualEndTime', '2026-09-26T03:30:00Z');
    await actual(id, id.b, 'actualStartTime', '2026-09-26T03:50:00Z');
    await assert.rejects(assignMinutes(id, id.c, endA, 20));
    await actual(id, id.b, 'actualEndTime', '2026-09-26T04:20:00Z', 'CLEANING');
    log(11, 'FLOW 4: Đổi nháp/live B và giờ B; ledger/tua đúng; khóa B đã bắt đầu');
  }
  {
    const id = await businessFixture(12);
    await dispatch(id, [planned(id, id.a, 1, '10:00', 30), planned(id, id.b, 2, '10:30', 30)]);
    await actual(id, id.a, 'actualStartTime', startA);
    await actual(id, id.a, 'actualEndTime', '2026-09-26T03:30:00Z');
    const aBefore = (await item(id)).segments[0];
    await db.query('SELECT dispatch_finish_sequential_after_a($1, $2)', [id.booking, id.item]);
    const completed = await item(id);
    assert.equal(completed.status, 'CLEANING'); assert.equal(completed.options.finishedAfterA, true);
    assert.deepEqual(completed.segments[0], aBefore); assert.equal(completed.segments[1].voided, true);
    assert.equal((await assignment(id, id.b)).status, 'CANCELLED'); assert.equal((await ledger(id, id.b)).length, 0);
    await assert.rejects(assignMinutes(id, id.b, endA, 30));
    completed.segments[1].actualStartTime = endA;
    await assert.rejects(db.query('UPDATE "BookingItems" SET segments = $1::jsonb WHERE id = $2', [JSON.stringify(completed.segments), id.item]));
    log(12, 'FLOW 5: Hoàn thành sau A giữ công A, hủy B chưa làm; chặn bắt đầu/gán lại');
  }
  // Five persistence/audit cases use the actual new migration and locked RPC.
  await db.exec('ALTER TABLE "BookingItems" ADD COLUMN guest_id text');
  await db.exec(readFileSync(join(__dirname, '../supabase/migrations/20260926120000_dispatch_edit_history.sql'), 'utf8'));
  const actor = { id: 'ADMIN', name: 'Quầy test', verified: true };
  const apply = async (id, action, payload) => (await db.query('SELECT dispatch_apply_edit($1,$2,$3::jsonb,$4::jsonb) AS result',
    [id.booking, action, JSON.stringify(payload), JSON.stringify(actor)])).rows[0].result;
  const updateOf = row => structuredClone({ id: row.id, segments: row.segments, options: row.options,
    technicianCodes: row.technicianCodes || row.segments.map(s => s.ktvId), roomName: 'R', bedId: 'X' });
  const historyLog = (n, label) => console.log(`PASS HISTORY ${n}/5: ${label}`);
  const id = await businessFixture('history');
  let updated = { id: id.item, segments: [planned(id,id.a,1,'10:00',40), planned(id,id.b,2,'10:40',20)],
    technicianCodes: [id.a,id.b], options: { sequentialSlots: 2, displayName: 'Gói 60', serviceNamesForKtvs: { [id.a]: 'Tên A lần 1', [id.b]: 'Tên B' } } };
  await apply(id, 'DRAFT', { notes: 'Bản 1', itemUpdates: [updated] });
  const first = await item(id);
  updated = updateOf(first);
  updated.segments[0].duration = 30; updated.segments[0].endTime = '10:30';
  updated.segments[1].startTime = '10:30'; updated.segments[1].duration = 30;
  updated.options.serviceNamesForKtvs[id.a] = 'Tên A lần 2';
  await apply(id,'DRAFT',{ notes: 'Bản 2', itemUpdates:[updated] });
  let saved = await item(id);
  assert.equal(saved.options.dispatchRevision, 2);
  assert.equal(saved.segments[0].duration,30);
  assert.equal(saved.options.serviceNamesForKtvs[id.b],'Tên B');
  const second = saved.options.dispatchHistory[1];
  assert.equal(second.actor.id,'ADMIN'); assert.equal(second.action,'DRAFT');
  assert.deepEqual(second.changes.find(c=>c.field==='serviceNameForKtv' && c.employeeId===id.a),
    { employeeId:id.a, field:'serviceNameForKtv', before:'Tên A lần 1', after:'Tên A lần 2' });
  assert.equal(second.changes.find(c=>c.field==='duration' && c.employeeId===id.a).before,40);
  historyLog(1,'Lưu lần 2 lấy trước/sau từ lần 1; tên B và lịch sử lần 1 giữ nguyên');

  updated = updateOf(saved); updated.status = 'PREPARING';
  await apply(id,'DISPATCH',{ date:'2026-09-26', status:'PREPARING', itemUpdates:[updated],
    staffAssignments:saved.segments.map(s=>({ktvId:s.ktvId,bookingItemId:id.item,segmentId:s.id,sequenceNo:s.sequenceSlot,
      roomId:s.roomId,bedId:s.bedId,startTime:s.startTime,endTime:s.endTime})) });
  saved = await item(id);
  assert.equal(saved.options.dispatchHistory.at(-1).action,'DISPATCH');
  assert.equal(saved.options.serviceNamesForKtvs[id.a],'Tên A lần 2');
  assert.equal((await assignment(id,id.b)).planned_start_time.toISOString(),'2026-09-26T03:30:00.000Z');

  const fullA = await businessFixture('history-full');
  await apply(fullA,'DISPATCH',{date:'2026-09-26',status:'PREPARING',
    itemUpdates:[{id:fullA.item,status:'PREPARING',options:{},segments:[planned(fullA,fullA.a,undefined,'10:00',60)],technicianCodes:[fullA.a]}],
    staffAssignments:[{ktvId:fullA.a,bookingItemId:fullA.item,segmentId:`s-${fullA.a}`,roomId:'R',bedId:'X',startTime:'10:00',endTime:'11:00'}]});
  const fullSaved=await item(fullA), half=updateOf(fullSaved);
  half.segments[0].duration=30; half.segments[0].endTime='10:30';
  await apply(fullA,'DRAFT',{date:'2026-09-26',itemUpdates:[half]});
  assert.equal((await assignment(fullA,fullA.a)).planned_end_time.toISOString(),'2026-09-26T03:30:00.000Z');
  let halfSaved=await item(fullA);
  assert.equal(halfSaved.segments[0].plannedEndAt,'2026-09-26T03:30:00+00:00');
  const enabled=await apply(fullA,'ENABLE_SEQUENTIAL',{itemId:fullA.item,expectedRevision:halfSaved.options.dispatchRevision});
  const added=await apply(fullA,'ASSIGN_B',{itemId:fullA.item,expectedRevision:enabled.revisions[fullA.item],
    toKtvId:fullA.b,plannedStartAt:'2026-09-26T03:30:00Z',durationMinutes:30,confirmOverlap:false});
  assert.equal(added.success,true); // Must not ask for overlap against the old 11:00 end.
  historyLog(2,'Nháp → điều phối tiếp tục đúng bản lưu và giữ tên riêng A/B');

  await apply(id,'ASSIGN_B',{itemId:id.item,expectedRevision:saved.options.dispatchRevision,
    toKtvId:id.b,plannedStartAt:'2026-09-26T03:45:00Z',durationMinutes:25,confirmOverlap:false});
  saved = await item(id);
  const staleBRevision = saved.options.dispatchRevision;
  await apply(id,'ASSIGN_B',{itemId:id.item,expectedRevision:staleBRevision,
    toKtvId:id.b,plannedStartAt:'2026-09-26T03:50:00Z',durationMinutes:20,confirmOverlap:false});
  saved = await item(id);
  const bEdit = saved.options.dispatchHistory.at(-1);
  assert.equal(bEdit.action,'ASSIGN_B');
  assert.equal(bEdit.changes.find(c=>c.field==='startTime').before,'10:45');
  assert.equal(bEdit.changes.find(c=>c.field==='startTime').after,'10:50');
  assert.equal(saved.segments[1].duration,20);
  assert.equal(saved.segments[0].duration,30);
  await assert.rejects(apply(id,'ASSIGN_B',{itemId:id.item,expectedRevision:staleBRevision,
    toKtvId:id.b,plannedStartAt:'2026-09-26T04:00:00Z',durationMinutes:10}),/bản lưu mới/);
  assert.deepEqual(await item(id),saved);
  historyLog(3,'Sửa B lần 2 từ giờ B lần 1; modal B cũ bị chặn, A giữ nguyên');

  const other = { item: 'history-other' };
  await db.query('INSERT INTO "BookingItems" (id,"bookingId",status,options,segments) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)',
    [other.item,id.booking,'NEW','{}','[]']);
  const current = updateOf(saved); current.options.serviceNamesForKtvs[id.a]='Không được lưu';
  const beforeBooking = (await db.query('SELECT * FROM "Bookings" WHERE id=$1',[id.booking])).rows[0];
  await assert.rejects(apply(id,'DRAFT',{notes:'Không được lưu',itemUpdates:[current,
    {id:other.item,options:{dispatchRevision:99},segments:[],technicianCodes:[]}]}),/bản lưu mới/);
  assert.deepEqual(await item(id),saved);
  assert.deepEqual((await db.query('SELECT * FROM "Bookings" WHERE id=$1',[id.booking])).rows[0],beforeBooking);
  await assert.rejects(apply(id,'DRAFT',{notes:'Cũ',itemUpdates:[updateOf(first)]}),/bản lưu mới/);
  assert.deepEqual(await item(id),saved);
  historyLog(4,'Tab cũ / một dòng xung đột: cả lô và Booking không đổi, không thêm lịch sử giả');

  const logEntry={action:'PAUSE',by:'ADMIN',at:'2026-09-26T04:00:00Z'};
  await db.query('UPDATE "BookingItems" SET options=options || $1::jsonb WHERE id=$2',
    [JSON.stringify({counterLog:[logEntry]}),id.item]);
  await db.query('UPDATE "BookingItems" SET options=$1::jsonb WHERE id=$2',[JSON.stringify(first.options),id.item]);
  saved=await item(id);
  assert.equal(saved.options.serviceNamesForKtvs[id.a],'Tên A lần 2');
  assert.equal(saved.options.serviceNamesForKtvs[id.b],'Tên B');
  assert.deepEqual(saved.options.counterLog,[logEntry]);
  assert.equal(saved.options.dispatchHistory.length,5);
  assert.equal(saved.options.dispatchRevision,5);

  await actual(id,id.a,'actualStartTime',startA);
  const actualBefore=await item(id), actualEdit=updateOf(actualBefore);
  actualEdit.segments[0].actualStartTime='2026-09-26T03:01:00Z';
  await apply(id,'EDIT_ACTUAL_TIME',{itemUpdates:[actualEdit]});
  const corrected=await item(id);
  assert.equal(corrected.segments[0].actualStartTime,'2026-09-26T03:01:00Z');
  assert.equal(corrected.segments[0].startTime,actualBefore.segments[0].startTime);
  assert.deepEqual(corrected.segments[1],actualBefore.segments[1]);
  assert.equal(corrected.options.dispatchHistory.at(-1).action,'EDIT_ACTUAL_TIME');
  assert.equal(corrected.options.dispatchHistory.at(-1).actor.id,'ADMIN');
  const correctedAgain=updateOf(corrected); correctedAgain.segments[0].actualStartTime='2026-09-26T03:02:00Z';
  await apply(id,'EDIT_ACTUAL_TIME',{itemUpdates:[correctedAgain]});
  assert.equal((await item(id)).options.dispatchHistory.at(-1).changes.find(c=>c.field==='actualStartTime').before,'2026-09-26T03:01:00Z');
  await assert.rejects(apply(id,'EDIT_ACTUAL_TIME',{itemUpdates:[actualEdit]}),/bản lưu mới/);
  const finalActual=await item(id);
  for (const invalidPatch of [
    {duration:99}, {actualStartTime:null,actualEndTime:null},
    {actualEndTime:'2026-09-26T02:00:00Z'}
  ]) {
    const invalid=updateOf(finalActual); Object.assign(invalid.segments[0],invalidPatch);
    await assert.rejects(apply(id,'EDIT_ACTUAL_TIME',{itemUpdates:[invalid]}));
    assert.deepEqual(await item(id),finalActual);
  }

  historyLog(5,'Background options cũ không xóa tên mới, lịch sử hoặc nhật ký quầy');

  await db.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
