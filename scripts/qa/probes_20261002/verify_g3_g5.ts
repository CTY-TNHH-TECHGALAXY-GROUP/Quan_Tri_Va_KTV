/** G3 (tắt nối tiếp khi B trống) + G5 (gán B gửi 2 lần) qua server action / service thật. Dữ liệu QA riêng, tự dọn. */
import fs from 'node:fs';
import * as auth from '@/lib/auth-server';
const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
if (!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
(auth as any).requirePermission = async () => null;
const actions = require('@/app/reception/dispatch/actions');
const { performSequentialLifecycle } = require('@/lib/services/SequentialLifecycleService');
const { getSupabaseAdmin } = require('@/lib/supabaseAdmin');
const db = new Client({ connectionString: env.DATABASE_URL }); const q = (s: string, p: any[] = []) => db.query(s, p);
const stamp = Date.now().toString(36).toUpperCase().slice(-6); const P = `QAG35-${stamp}`;
const K = (n: number) => `QG35${stamp}${n}`; const B = (n: number) => `${P}-B${n}`; const I = (n: number) => `${B(n)}-I1`;
const ROOM = `${P}-R`, BED = `${P}-D`; let day = ''; let fail = 0;
const j = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
const check = (label: string, ok: any, detail: any = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ' — ' + JSON.stringify(detail).slice(0, 300)}`); };
const vn = (off: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + off * 60e3));
const item = async (n: number) => (await q('select * from "BookingItems" where id=$1', [I(n)])).rows[0];
const rev = async (n: number) => Number(j((await item(n)).options).dispatchRevision || 0);
async function setup() {
  const cutoff = Number((await q(`select value from "SystemConfigs" where key='spa_day_cutoff_hours'`)).rows[0]?.value ?? 7);
  day = new Date(Date.now() + (7 - cutoff) * 3600e3).toISOString().slice(0, 10);
  await q('begin');
  await q('insert into "Rooms"(id,name,capacity,type) values($1,$2,4,$3)', [ROOM, 'QA G35', 'TEST']);
  await q('insert into "Beds"(id,name,"roomId") values($1,$2,$3)', [BED, 'QA G35 giường', ROOM]);
  for (let n = 1; n <= 4; n++) {
    await q(`insert into "Staff"(id,full_name,status,gender,position,work_type,online_status) values($1,$2,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`, [K(n), `QA G35 ${n}`]);
    await q(`insert into "TurnQueue"(employee_id,date,queue_position,check_in_order,status) values($1,$2,999,999,'waiting')`, [K(n), day]);
  }
  for (let n = 1; n <= 3; n++) {
    await q(`insert into "Bookings"(id,"billCode","bookingDate","customerName",notes,status,"totalAmount","createdAt","updatedAt") values($1,$1,(now() at time zone 'UTC'),$2,'QA G35; xoa sau test','NEW',300000,now(),now())`, [B(n), `QA G35 ${n}`]);
    await q(`insert into "BookingItems"(id,"bookingId","serviceId",quantity,price,status,options) values($1,$2,'NHP0001',1,300000,'NEW','{}')`, [I(n), B(n)]);
  }
  await q('commit');
}
const segA = (n: number, ktv: string) => ({ id: `${B(n)}-S1`, ktvId: ktv, roomId: ROOM, bedId: BED, startTime: vn(10), endTime: vn(40), duration: 30, sequenceSlot: 1 });
async function commit(n: number, action: 'DRAFT' | 'DISPATCH', segments: any[], options: any, status = 'PREPARING') {
  const itemUpdates = [{ id: I(n), status, segments, options, technicianCodes: segments.map(s => s.ktvId), roomName: ROOM, bedId: BED }];
  const staffAssignments = action === 'DISPATCH' ? segments.map(s => ({ ktvId: s.ktvId, bookingItemId: I(n), segmentId: s.id, startTime: s.startTime, endTime: s.endTime, roomId: ROOM, bedId: BED, queuePos: 1 })) : [];
  const r = (await q(`select dispatch_commit_form($1,$2,$3,'{}') r`, [B(n), action, JSON.stringify({ date: day, status, roomName: ROOM, bedId: BED, technicianCode: segments.map(s => s.ktvId).join(' - '), itemUpdates, staffAssignments })])).rows[0].r;
  if (!r?.success) throw new Error(`commit B${n}: ${JSON.stringify(r)}`);
}
async function run() {
  await setup();
  // G3a: đơn đã điều phối, nối tiếp, chỉ có A → đóng lượt B
  await commit(1, 'DISPATCH', [segA(1, K(1))], { sequentialSlots: 2 });
  const r1 = await performSequentialLifecycle(getSupabaseAdmin(), I(1), { action: 'CANCEL', targetSlots: [2], reason: 'Bật nhầm nối tiếp' }, await rev(1), B(1));
  const it1 = await item(1); const o1 = j(it1.options);
  check('G3a đóng lượt B trống thành công', r1?.success === true, r1);
  check('G3a closedSequentialSlots=[2], A giữ nguyên chặng + PREPARING', JSON.stringify(o1.closedSequentialSlots) === '[2]' && it1.status === 'PREPARING' && j(it1.segments).length === 1 && j(it1.segments)[0].voided !== true, [o1.closedSequentialSlots, it1.status]);
  check('G3a KA của A vẫn ACTIVE', (await q(`select status from "KtvAssignments" where booking_id=$1`, [B(1)])).rows.every(r => r.status === 'ACTIVE'));
  // G3b: đơn nháp (lưu NHÁP, status WAITING) có sequentialSlots → lưu lại không nối tiếp
  await commit(2, 'DRAFT', [segA(2, K(2))], { sequentialSlots: 2 }, 'WAITING');
  const before = j((await item(2)).options).sequentialSlots;
  const it2 = await item(2);
  const res2 = await actions.saveDraftDispatch(B(2), { roomName: ROOM, bedId: BED, itemUpdates: [{ id: I(2), roomName: ROOM, bedId: BED, technicianCodes: [K(2)], status: 'WAITING', segments: [{ ...segA(2, K(2)), sequenceSlot: undefined }], options: { ...j(it2.options), sequentialSlots: null } }] });
  const after = j((await item(2)).options).sequentialSlots;
  check(`G3b đơn nháp: tắt nối tiếp được lưu (trước=${before}, sau=${after ?? 'không'})`, res2.success && Number(after) !== 2, res2.error || after);
  // G5: gán B khi A đã bắt đầu, gửi 2 lần cùng revision
  await commit(3, 'DISPATCH', [segA(3, K(3))], { sequentialSlots: 2 });
  await q(`update "BookingItems" set segments = jsonb_set(jsonb_unwrap_string(segments),'{0,actualStartTime}', to_jsonb(now()::text)), status='IN_PROGRESS' where id=$1`, [I(3)]);
  const r0 = await rev(3);
  // Same as the counter page: business day + clock, +07 (see plan_fix_nua_dem for the day-shift issue).
  const plannedStartAt = new Date(`${day}T${vn(40)}:00+07:00`).toISOString();
  const input = { bookingId: B(3), itemId: I(3), toKtvId: K(4), plannedStartAt, durationMinutes: 30, expectedRevision: r0, confirmOverlap: true, metadata: { serviceNamesForKtvs: { [K(4)]: 'Tên riêng cho B' }, notesForKtvs: {} } };
  const first = await actions.handoffSequentialKtv(input);
  const second = await actions.handoffSequentialKtv(input);
  check('G5 lần 1 thành công', first.success === true, first);
  check('G5 lần 2 bị từ chối vì revision cũ (đúng câu client nhận diện)', second.success === false && /bản lưu mới|đã thay đổi/i.test(second.error || ''), second);
  const fresh = await actions.getDispatchItemState(B(3), I(3));
  const savedB = fresh.item?.segments.find((s: any) => Number(s.sequenceSlot) === 2 && s.voided !== true);
  const alreadySaved = !!savedB && savedB.ktvId === K(4) && Number(savedB.duration) === 30 && Math.abs(Date.parse(savedB.plannedStartAt) - Date.parse(plannedStartAt)) < 60000;
  check('G5 client nhận ra "đã lưu ở lần trước" → báo thành công', alreadySaved, savedB);
  check('G4 tên dịch vụ riêng của B được lưu', fresh.item?.options?.serviceNamesForKtvs?.[K(4)] === 'Tên riêng cho B', fresh.item?.options?.serviceNamesForKtvs);
  const notes = Number((await q(`select count(*) n from "StaffNotifications" where "bookingId"=$1 and "employeeId"=$2 and type='KTV_NEW_ORDER'`, [B(3), K(4)])).rows[0].n);
  check('G5 B chỉ nhận 1 thông báo phân công', notes === 1, notes);
}
async function cleanup() {
  const bks = [1, 2, 3].map(B); await q('begin');
  for (const t of ['TurnLedger', 'KtvAssignments']) await q(`delete from "${t}" where booking_id=any($1)`, [bks]);
  await q('delete from "StaffNotifications" where "bookingId"=any($1)', [bks]);
  await q('delete from "TurnQueue" where employee_id like $1', [`QG35${stamp}%`]);
  await q('delete from "BookingItems" where "bookingId"=any($1)', [bks]); await q('delete from "Bookings" where id=any($1)', [bks]);
  await q('delete from "Staff" where id like $1', [`QG35${stamp}%`]); await q('delete from "Beds" where id=$1', [BED]); await q('delete from "Rooms" where id=$1', [ROOM]);
  await q('commit'); return Number((await q('select count(*) n from "Bookings" where id like $1', [`${P}%`])).rows[0].n);
}
(async () => { await db.connect(); try { await run(); } catch (e: any) { fail++; console.log('RUN ERR', e.message); } finally { try { console.log('leftovers', await cleanup()); } catch (e: any) { await q('rollback').catch(() => 0); console.log('CLEANUP ERR', e.message, 'stamp', stamp); } await db.end(); console.log(JSON.stringify({ failed: fail })); if (fail) process.exitCode = 1; } })();
