/** Probe route KTV từ chối đơn (plan_fix_reject_order_ket_don_20261002). Dữ liệu QA riêng, tự dọn. */
import fs from 'node:fs';
import { Client } from 'pg';
import * as auth from '@/lib/auth-server';
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
if (!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
(auth as any).requireActiveStaff = async () => null;   // probe acts as the KTV themself
(auth as any).requireStaffMatches = async () => null;
const { POST } = require('@/app/api/ktv/discipline/reject-order/route');

const db = new Client({ connectionString: env.DATABASE_URL }); const q = (s: string, p: any[] = []) => db.query(s, p);
const stamp = process.env.CLEANUP_ONLY || Date.now().toString(36).toUpperCase().slice(-6); const P = `QARJ-${stamp}`;
const K = (n: number) => `QRJ${stamp}${n}`; const B = (n: number) => `${P}-B${n}`; const I = (n: number, i = 1) => `${B(n)}-I${i}`;
const ROOM = `${P}-R`, BED = `${P}-D`;
const j = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
const evidence: any[] = []; let day = '';
const check = (label: string, ok: any, detail: any = '') => { evidence.push({ label, pass: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ' — ' + JSON.stringify(detail)}`); };
const vnClock = (offMin: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + offMin * 60e3));
const reject = async (who: string, itemId: string) => {
  const res: Response = await POST(new Request('http://local/api/ktv/discipline/reject-order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ staffId: who, bookingItemId: itemId, reason: 'QA probe' }) }));
  return { status: res.status, body: await res.json() };
};
const item = async (id: string) => (await q('select * from "BookingItems" where id=$1', [id])).rows[0];
const segsOf = async (id: string) => j((await item(id)).segments) as any[];
const ka = async (bk: string, who: string) => (await q('select status from "KtvAssignments" where booking_id=$1 and employee_id=$2', [bk, who])).rows.map(r => r.status);
const tq = async (who: string) => (await q('select status,current_order_id,booking_item_ids from "TurnQueue" where employee_id=$1 and date=$2', [who, day])).rows[0];
const ledger = async (who: string) => Number((await q('select count(*) n from "TurnLedger" where employee_id=$1', [who])).rows[0].n);
const points = async (who: string) => Number((await q('select coalesce(sum(total_points),0) n, count(*) c from "KTVDisciplinePoints" where staff_id=$1', [who])).rows[0].c);
let photo = '';

async function setup() {
  const cutoff = Number((await q(`select value from "SystemConfigs" where key='spa_day_cutoff_hours'`)).rows[0]?.value ?? 7);
  day = new Date(Date.now() + (7 - cutoff) * 3600e3).toISOString().slice(0, 10);
  photo = `data:image/png;base64,${(await require('sharp')({ create: { width: 1, height: 1, channels: 4, background: '#fff' } }).png().toBuffer()).toString('base64')}`;
  await q('begin');
  await q('insert into "Rooms"(id,name,capacity,type) values($1,$2,4,$3)', [ROOM, 'QA reject', 'TEST']);
  await q('insert into "Beds"(id,name,"roomId") values($1,$2,$3)', [BED, 'QA reject giường', ROOM]);
  for (let n = 1; n <= 9; n++) {
    await q(`insert into "Staff"(id,full_name,status,gender,position,work_type,online_status) values($1,$2,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`, [K(n), `QA REJECT ${n}`]);
    await q(`insert into "TurnQueue"(employee_id,date,queue_position,check_in_order,status) values($1,$2,999,999,'waiting')`, [K(n), day]);
  }
  for (let n = 1; n <= 7; n++) {
    // bookingDate = now (naive UTC) → after-midnight night shift inside business day `day`.
    await q(`insert into "Bookings"(id,"billCode","bookingDate","customerName",notes,status,"totalAmount","createdAt","updatedAt") values($1,$1,(now() at time zone 'UTC'),$2,'QA reject probe; xoa sau test','NEW',300000,now(),now())`, [B(n), `QA REJECT ${n}`]);
    const count = n === 6 ? 2 : 1;
    for (let i = 1; i <= count; i++) await q(`insert into "BookingItems"(id,"bookingId","serviceId",quantity,price,status,options) values($1,$2,'NHP0001',1,300000,'NEW','{}')`, [I(n, i), B(n)]);
  }
  await q('commit');
}
const seg = (n: number, ktv: string, s: number, off: number, min: number, slot?: number) => ({ id: `${B(n)}-S${s}`, ktvId: ktv, roomId: ROOM, bedId: BED, startTime: vnClock(off), endTime: vnClock(off + min), duration: min, ...(slot ? { sequenceSlot: slot } : {}) });
async function dispatch(n: number, segments: any[], options: any = {}) {
  const itemUpdates = [{ id: I(n), status: 'PREPARING', segments, options, technicianCodes: [...new Set(segments.map(s => s.ktvId))], roomName: ROOM, bedId: BED }];
  const staffAssignments = segments.map(s => ({ ktvId: s.ktvId, bookingItemId: I(n), segmentId: s.id, startTime: s.startTime, endTime: s.endTime, roomId: ROOM, bedId: BED, queuePos: 1 }));
  const payload = { date: day, status: 'PREPARING', roomName: ROOM, bedId: BED, technicianCode: itemUpdates[0].technicianCodes.join(' - '), itemUpdates, staffAssignments };
  const r = (await q(`select dispatch_commit_form($1,'DISPATCH',$2,'{}') r`, [B(n), JSON.stringify(payload)])).rows[0].r;
  if (!r?.success) throw new Error(`dispatch B${n}: ${JSON.stringify(r)}`);
}
const accept = (id: string, who: string) => q(`update "BookingItems" set options = jsonb_set(coalesce(options::jsonb,'{}'),'{acceptedByStaff}', jsonb_build_object($2::text, now()::text)) where id=$1`, [id, who]);
async function startKtv(n: number, who: string, segId: string) {
  const r = await fetch('http://127.0.0.1:3102/api/ktv/booking', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bookingId: B(n), techCode: who, status: 'IN_PROGRESS', action: 'START_TIMER', targetSegmentId: segId, startPhotoBase64: photo, guestSlipperPhotoBase64: photo }) });
  const body = await r.json(); if (!body.success) throw new Error(`start ${who}: ${JSON.stringify(body).slice(0, 200)}`);
}

async function run() {
  await setup();
  // C1 — 1KTV-1DV, đã nhận đơn rồi từ chối
  await dispatch(1, [seg(1, K(1), 1, 5, 60)]); await accept(I(1), K(1));
  const l1 = await ledger(K(1)); const r1 = await reject(K(1), I(1)); const it1 = await item(I(1)); const s1 = j(it1.segments)[0];
  check('C1 reject 200', r1.status === 200 && r1.body.success, r1);
  check('C1 chặng void UNASSIGNED', s1.voided === true && s1.note === 'UNASSIGNED', s1);
  check('C1 item WAITING, technicianCodes rỗng', it1.status === 'WAITING' && it1.technicianCodes.length === 0, [it1.status, it1.technicianCodes]);
  check('C1 xoá mốc đã nhận đơn của KTV', !j(it1.options).acceptedByStaff?.[K(1)], j(it1.options).acceptedByStaff);
  check('C1 KtvAssignments CANCELLED', (await ka(B(1), K(1))).every(s => s === 'CANCELLED'), await ka(B(1), K(1)));
  const t1 = await tq(K(1)); check('C1 TurnQueue waiting, current_order_id null', t1.status === 'waiting' && t1.current_order_id === null, t1);
  check('C1 giữ tua (TurnLedger không bị xoá)', (await ledger(K(1))) === l1 && l1 >= 0, { before: l1, after: await ledger(K(1)) });
  check('C1 có trừ điểm kỷ luật', (await points(K(1))) >= 1, await points(K(1)));
  const again = await reject(K(1), I(1)); check('C1 từ chối lần 2 → 404, không phạt thêm', again.status === 404 && (await points(K(1))) === 1, again);

  // C2 — 2KTV-1DV: chỉ người từ chối bị gỡ
  await dispatch(2, [seg(2, K(2), 1, 5, 60), seg(2, K(3), 2, 5, 60)]);
  const r2 = await reject(K(2), I(2)); const it2 = await item(I(2)); const segs2 = j(it2.segments);
  check('C2 reject 200', r2.status === 200, r2);
  check('C2 K3 vẫn còn chặng, item giữ PREPARING', segs2.find((s: any) => s.ktvId === K(3)).voided !== true && it2.status === 'PREPARING' && JSON.stringify(it2.technicianCodes) === JSON.stringify([K(3)]), [it2.status, it2.technicianCodes]);
  check('C2 KA: K2 CANCELLED, K3 vẫn ACTIVE', (await ka(B(2), K(2)))[0] === 'CANCELLED' && (await ka(B(2), K(3)))[0] === 'ACTIVE', [await ka(B(2), K(2)), await ka(B(2), K(3))]);

  // C3 — nối tiếp: A đang làm, B từ chối
  await dispatch(3, [seg(3, K(4), 1, -1, 30, 1), seg(3, K(5), 2, 29, 30, 2)], { sequentialSlots: 2 });
  await startKtv(3, K(4), `${B(3)}-S1`);
  const r3 = await reject(K(5), I(3)); const segs3 = await segsOf(I(3)); const it3 = await item(I(3));
  check('C3 B reject 200', r3.status === 200, r3);
  check('C3 A không bị đụng (vẫn chạy, slot 1)', segs3.find(s => s.ktvId === K(4)).actualStartTime && segs3.find(s => s.ktvId === K(4)).voided !== true && it3.status === 'IN_PROGRESS', it3.status);
  check('C3 B void, KA B CANCELLED, KA A ACTIVE', segs3.find(s => s.ktvId === K(5)).voided === true && (await ka(B(3), K(5)))[0] === 'CANCELLED' && (await ka(B(3), K(4)))[0] === 'ACTIVE', [await ka(B(3), K(5)), await ka(B(3), K(4))]);
  check('C3 TurnQueue B waiting, A vẫn working', (await tq(K(5))).status === 'waiting' && (await tq(K(4))).status === 'working', [await tq(K(5)), await tq(K(4))]);

  // C4 — đã bắt đầu thì không được từ chối, không bị phạt
  await dispatch(4, [seg(4, K(6), 1, -1, 30)]); await startKtv(4, K(6), `${B(4)}-S1`);
  const r4 = await reject(K(6), I(4));
  check('C4 đã bắt đầu → 409 và câu báo rõ', r4.status === 409 && /đã bắt đầu/.test(r4.body.error), r4);
  check('C4 không trừ điểm, chặng/KA giữ nguyên', (await points(K(6))) === 0 && (await ka(B(4), K(6)))[0] === 'ACTIVE' && (await segsOf(I(4)))[0].voided !== true, await points(K(6)));

  // C5 — KTV có đơn kế tiếp đang chờ → đơn đó được đẩy lên, current_order_id là id ĐƠN
  await dispatch(5, [seg(5, K(7), 1, 5, 30)]); await dispatch(7, [seg(7, K(7), 1, 40, 30)]);
  check('C5 trước: B5 ACTIVE, B7 QUEUED', (await ka(B(5), K(7)))[0] === 'ACTIVE' && ['QUEUED', 'READY'].includes((await ka(B(7), K(7)))[0]), [await ka(B(5), K(7)), await ka(B(7), K(7))]);
  const r5 = await reject(K(7), I(5)); const t5 = await tq(K(7));
  check('C5 reject 200', r5.status === 200, r5);
  check('C5 B7 lên ACTIVE', (await ka(B(7), K(7)))[0] === 'ACTIVE', await ka(B(7), K(7)));
  check('C5 TurnQueue assigned, current_order_id = id đơn B7', t5.status === 'assigned' && t5.current_order_id === B(7), t5);

  // C6 — 1KTV-2DV gộp (dịch vụ con mergedIntoId không có chặng riêng)
  await dispatch(6, [seg(6, K(8), 1, 5, 60)]);
  await q(`update "BookingItems" set "technicianCodes"=$2, status='PREPARING', options=$3 where id=$1`, [I(6, 2), [K(8)], JSON.stringify({ mergedIntoId: I(6), acceptedByStaff: { [K(8)]: new Date().toISOString() } })]);
  const r6 = await reject(K(8), I(6)); const c6 = await item(I(6, 2));
  check('C6 reject 200', r6.status === 200, r6);
  check('C6 cả cụm ghép được gỡ (cha void, con hết tên + WAITING)', (await segsOf(I(6)))[0].voided === true && c6.technicianCodes.length === 0 && c6.status === 'WAITING' && !j(c6.options).acceptedByStaff?.[K(8)], [c6.status, c6.technicianCodes]);

}

async function cleanup() {
  await q('begin');
  const bks = Array.from({ length: 7 }, (_, i) => B(i + 1));
  for (const t of ['TurnLedger', 'KtvAssignments']) await q(`delete from "${t}" where booking_id=any($1)`, [bks]);
  for (const t of ['KTVDisciplinePoints', 'KTVDisciplineLedger']) await q(`delete from "${t}" where staff_id like $1`, [`QRJ${stamp}%`]);
  await q('delete from "StaffNotifications" where "bookingId"=any($1)', [bks]);
  await q('delete from "TurnQueue" where employee_id like $1', [`QRJ${stamp}%`]);
  await q('delete from "BookingItems" where "bookingId"=any($1)', [bks]);
  await q('delete from "Bookings" where id=any($1)', [bks]);
  await q('delete from "Staff" where id like $1', [`QRJ${stamp}%`]);
  await q('delete from "Beds" where id=$1', [BED]); await q('delete from "Rooms" where id=$1', [ROOM]);
  await q('commit');
  return Number((await q('select count(*) n from "Bookings" where id like $1', [`${P}%`])).rows[0].n);
}
(async () => {
  await db.connect(); let left: any = null;
  try { if (!process.env.CLEANUP_ONLY) await run(); } catch (e: any) { check('RUN', false, String(e.message || e)); }
  finally { try { left = await cleanup(); } catch (e: any) { await q('rollback').catch(() => null); check('CLEANUP', false, String(e.message)); } await db.end(); }
  const passed = evidence.filter(e => e.pass).length, failed = evidence.length - passed;
  fs.writeFileSync('_plans/probes_claude_20261002/verify_reject_order_result.json', JSON.stringify({ day, prefix: P, evidence, leftovers: left }, null, 2));
  console.log(JSON.stringify({ passed, failed, leftovers: left })); if (failed) process.exitCode = 1;
})();
