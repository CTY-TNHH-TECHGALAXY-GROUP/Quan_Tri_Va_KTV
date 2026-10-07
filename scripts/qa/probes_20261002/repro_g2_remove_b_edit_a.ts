/** Tái hiện G2: A/B nối tiếp đã nhận đơn, chưa ai bắt đầu → quầy bỏ B + đổi giờ A. Dữ liệu QA riêng, tự dọn. */
import fs from 'node:fs';
import * as auth from '@/lib/auth-server';
const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
if (!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
(auth as any).requirePermission = async () => null;
const actions = require('@/app/reception/dispatch/actions');
const db = new Client({ connectionString: env.DATABASE_URL }); const q = (s: string, p: any[] = []) => db.query(s, p);
const stamp = Date.now().toString(36).toUpperCase().slice(-6); const P = `QAG2-${stamp}`;
const K = (n: number) => `QG2${stamp}${n}`; const B = (n: number) => `${P}-B${n}`; const I = (n: number) => `${B(n)}-I1`;
const ROOM = `${P}-R`, BED = `${P}-D`; let day = '';
const j = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
const vn = (off: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + off * 60e3));
const seg = (n: number, ktv: string, s: number, off: number, min: number, slot: number) => ({ id: `${B(n)}-S${s}`, ktvId: ktv, roomId: ROOM, bedId: BED, startTime: vn(off), endTime: vn(off + min), duration: min, sequenceSlot: slot });
const item = async (n: number) => (await q('select * from "BookingItems" where id=$1', [I(n)])).rows[0];
const rev = async (n: number) => Number(j((await item(n)).options).dispatchRevision || 0);
async function setup(count: number) {
  const cutoff = Number((await q(`select value from "SystemConfigs" where key='spa_day_cutoff_hours'`)).rows[0]?.value ?? 7);
  day = new Date(Date.now() + (7 - cutoff) * 3600e3).toISOString().slice(0, 10);
  await q('begin');
  await q('insert into "Rooms"(id,name,capacity,type) values($1,$2,4,$3)', [ROOM, 'QA G2', 'TEST']);
  await q('insert into "Beds"(id,name,"roomId") values($1,$2,$3)', [BED, 'QA G2 giường', ROOM]);
  for (let n = 1; n <= 2 * count; n++) {
    await q(`insert into "Staff"(id,full_name,status,gender,position,work_type,online_status) values($1,$2,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`, [K(n), `QA G2 ${n}`]);
    await q(`insert into "TurnQueue"(employee_id,date,queue_position,check_in_order,status) values($1,$2,999,999,'waiting')`, [K(n), day]);
  }
  for (let n = 1; n <= count; n++) {
    await q(`insert into "Bookings"(id,"billCode","bookingDate","customerName",notes,status,"totalAmount","createdAt","updatedAt") values($1,$1,(now() at time zone 'UTC'),$2,'QA G2; xoa sau test','NEW',300000,now(),now())`, [B(n), `QA G2 ${n}`]);
    await q(`insert into "BookingItems"(id,"bookingId","serviceId",quantity,price,status,options) values($1,$2,'NHP0001',1,300000,'NEW','{}')`, [I(n), B(n)]);
  }
  await q('commit');
}
async function dispatchAB(n: number) {
  const segments = [seg(n, K(2 * n - 1), 1, 10, 30, 1), seg(n, K(2 * n), 2, 40, 30, 2)];
  const itemUpdates = [{ id: I(n), status: 'PREPARING', segments, options: { sequentialSlots: 2 }, technicianCodes: segments.map(s => s.ktvId), roomName: ROOM, bedId: BED }];
  const staffAssignments = segments.map(s => ({ ktvId: s.ktvId, bookingItemId: I(n), segmentId: s.id, startTime: s.startTime, endTime: s.endTime, roomId: ROOM, bedId: BED, queuePos: 1 }));
  const r = (await q(`select dispatch_commit_form($1,'DISPATCH',$2,'{}') r`, [B(n), JSON.stringify({ date: day, status: 'PREPARING', roomName: ROOM, bedId: BED, technicianCode: segments.map(s => s.ktvId).join(' - '), itemUpdates, staffAssignments })])).rows[0].r;
  if (!r?.success) throw new Error('dispatch ' + JSON.stringify(r));
  for (const s of segments) await q(`update "BookingItems" set options = jsonb_set(jsonb_unwrap_string(options),'{acceptedByStaff,${s.ktvId}}', to_jsonb(now()::text)) where id=$1`, [I(n)]);
  return segments;
}
async function run() {
  await setup(3);
  // Path 1: row save (saveDispatchForm) — A only, A 30→45
  { const [a] = await dispatchAB(1); const r0 = await rev(1);
    const res = await actions.saveDispatchForm(B(1), I(1), [{ ktvId: a.ktvId, segments: [{ ...a, duration: 45, endTime: vn(55) }] }], r0, true);
    console.log('PATH saveDispatchForm →', JSON.stringify(res).slice(0, 120));
    console.log('  REV returned savedItems=', j(res.savedItem?.options)?.dispatchRevision, 'revisions=', JSON.stringify(res.revisions), 'DB now=', await rev(1)); }
  // Path 2: global Save (saveDraftDispatch)
  { const [a] = await dispatchAB(2); const it = await item(2);
    const res = await actions.saveDraftDispatch(B(2), { roomName: ROOM, bedId: BED, itemUpdates: [{ id: I(2), roomName: ROOM, bedId: BED, technicianCodes: [a.ktvId], status: 'PREPARING', segments: [{ ...a, duration: 45, endTime: vn(55) }], options: { ...j(it.options), sequentialSlots: 2 } }] });
    console.log('PATH saveDraftDispatch →', JSON.stringify(res).slice(0, 120));
    console.log('  REV returned savedItems=', j(res.savedItems?.[0]?.options)?.dispatchRevision, 'revisions=', JSON.stringify(res.revisions), 'DB now=', await rev(2)); }
  // Path 3: Dispatch (processDispatch)
  { const [a] = await dispatchAB(3); const it = await item(3);
    const res = await actions.processDispatch(B(3), { date: day, status: 'PREPARING', roomName: ROOM, bedId: BED, technicianCode: a.ktvId,
      itemUpdates: [{ id: I(3), roomName: ROOM, bedId: BED, technicianCodes: [a.ktvId], status: 'PREPARING', segments: [{ ...a, duration: 45, endTime: vn(55) }], options: { ...j(it.options), sequentialSlots: 2 } }],
      staffAssignments: [{ ktvId: a.ktvId, bookingItemId: I(3), segmentId: a.id, startTime: a.startTime, endTime: vn(55), roomId: ROOM, bedId: BED, queuePos: 1 }] });
    console.log('PATH processDispatch →', JSON.stringify(res).slice(0, 120));
    console.log('  REV returned savedItems=', j(res.savedItems?.[0]?.options)?.dispatchRevision, 'revisions=', JSON.stringify(res.revisions), 'DB now=', await rev(3)); }
  // Second save, exactly as the form with the ghost B row would send it (after a successful remove-B save).
  for (const n of [2, 3]) {
    const it = await item(n); const segs = j(it.segments); const a = segs.find((x: any) => x.sequenceSlot === 1); const opts = j(it.options);
    const draft = await actions.saveDraftDispatch(B(n), { roomName: ROOM, bedId: BED, itemUpdates: [{ id: I(n), roomName: ROOM, bedId: BED,
      technicianCodes: segs.map((x: any) => x.ktvId), status: 'PREPARING', segments: segs, options: { ...opts, sequentialSlots: 2 } }] });
    console.log(`PATH B${n} 2nd saveDraftDispatch (ghost B) →`, JSON.stringify(draft).slice(0, 200));
    const it2 = await item(n); const opts2 = j(it2.options);
    const disp = await actions.processDispatch(B(n), { date: day, status: 'PREPARING', roomName: ROOM, bedId: BED, technicianCode: a.ktvId,
      itemUpdates: [{ id: I(n), roomName: ROOM, bedId: BED, technicianCodes: [a.ktvId], status: 'PREPARING', segments: j(it2.segments), options: { ...opts2, sequentialSlots: 2 } }],
      staffAssignments: [{ ktvId: a.ktvId, bookingItemId: I(n), segmentId: a.id, startTime: a.startTime, endTime: a.endTime, roomId: ROOM, bedId: BED, queuePos: 1 }] });
    console.log(`PATH B${n} 2nd processDispatch (ghost B) →`, JSON.stringify(disp).slice(0, 200));
  }
  for (const n of [1, 2, 3]) { const it = await item(n); console.log(`B${n} after: status=${it.status} codes=${JSON.stringify(it.technicianCodes)} rev=${j(it.options).dispatchRevision} segs=${(j(it.segments) || []).map((s: any) => `${s.ktvId.slice(-1)}:slot${s.sequenceSlot}:dur${s.duration}:void=${s.voided}`).join(' ')}`); }
}
async function cleanup() {
  const bks = [1, 2, 3].map(B); await q('begin');
  for (const t of ['TurnLedger', 'KtvAssignments']) await q(`delete from "${t}" where booking_id=any($1)`, [bks]);
  await q('delete from "StaffNotifications" where "bookingId"=any($1)', [bks]);
  await q('delete from "TurnQueue" where employee_id like $1', [`QG2${stamp}%`]);
  await q('delete from "BookingItems" where "bookingId"=any($1)', [bks]); await q('delete from "Bookings" where id=any($1)', [bks]);
  await q('delete from "Staff" where id like $1', [`QG2${stamp}%`]); await q('delete from "Beds" where id=$1', [BED]); await q('delete from "Rooms" where id=$1', [ROOM]);
  await q('commit'); return Number((await q('select count(*) n from "Bookings" where id like $1', [`${P}%`])).rows[0].n);
}
(async () => { await db.connect(); try { await run(); } catch (e: any) { console.log('RUN ERR', e.message); } finally { try { console.log('leftovers', await cleanup()); } catch (e: any) { await q('rollback').catch(() => 0); console.log('CLEANUP ERR', e.message, 'stamp', stamp); } await db.end(); } })();
