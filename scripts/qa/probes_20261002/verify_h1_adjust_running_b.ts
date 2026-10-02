/** H1: A xong, B đang làm → quầy đổi thời lượng B (server action thật). Dữ liệu QA riêng, tự dọn. */
import fs from 'node:fs';
import * as auth from '@/lib/auth-server';
const { Client } = require('pg');
const env = require('dotenv').parse(fs.readFileSync('.env.local'));
if (!String(env.DATABASE_URL).includes('eknggruuiuadwldacpmb')) throw new Error('Not TEST');
(auth as any).requirePermission = async () => null;
const actions = require('@/app/reception/dispatch/actions');
const db = new Client({ connectionString: env.DATABASE_URL }); const q = (s: string, p: any[] = []) => db.query(s, p);
const stamp = Date.now().toString(36).toUpperCase().slice(-6); const P = `QAH1-${stamp}`;
const K = (n: number) => `QH1${stamp}${n}`; const B = (n: number) => `${P}-B${n}`; const I = (n: number) => `${B(n)}-I1`;
const ROOM = `${P}-R`, BED = `${P}-D`; let day = ''; let fail = 0; let photo = '';
const j = (v: any) => typeof v === 'string' ? JSON.parse(v) : v;
const check = (label: string, ok: any, detail: any = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ' — ' + JSON.stringify(detail).slice(0, 300)}`); };
const vn = (off: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + off * 60e3));
const item = async (n: number) => (await q('select * from "BookingItems" where id=$1', [I(n)])).rows[0];
const patch = async (n: number, who: string, status: string, extra: any = {}) => {
  const r = await fetch('http://127.0.0.1:3102/api/ktv/booking', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bookingId: B(n), techCode: who, status, ...extra }) });
  const body = await r.json(); if (!body.success) throw new Error(`${status} ${who}: ${JSON.stringify(body).slice(0, 200)}`); return body;
};
async function setup() {
  const cutoff = Number((await q(`select value from "SystemConfigs" where key='spa_day_cutoff_hours'`)).rows[0]?.value ?? 7);
  day = new Date(Date.now() + (7 - cutoff) * 3600e3).toISOString().slice(0, 10);
  photo = `data:image/png;base64,${(await require('sharp')({ create: { width: 1, height: 1, channels: 4, background: '#fff' } }).png().toBuffer()).toString('base64')}`;
  await q('begin');
  await q('insert into "Rooms"(id,name,capacity,type) values($1,$2,4,$3)', [ROOM, 'QA H1', 'TEST']);
  await q('insert into "Beds"(id,name,"roomId") values($1,$2,$3)', [BED, 'QA H1 giường', ROOM]);
  for (let n = 1; n <= 2; n++) {
    await q(`insert into "Staff"(id,full_name,status,gender,position,work_type,online_status) values($1,$2,'ĐANG LÀM','Female','KTV','TYPE_A','AT_VENUE')`, [K(n), `QA H1 ${n}`]);
    await q(`insert into "TurnQueue"(employee_id,date,queue_position,check_in_order,status) values($1,$2,999,999,'waiting')`, [K(n), day]);
  }
  await q(`insert into "Bookings"(id,"billCode","bookingDate","customerName",notes,status,"totalAmount","createdAt","updatedAt") values($1,$1,(now() at time zone 'UTC'),$2,'QA H1; xoa sau test','NEW',300000,now(),now())`, [B(1), 'QA H1']);
  await q(`insert into "BookingItems"(id,"bookingId","serviceId",quantity,price,status,options) values($1,$2,'NHP0001',1,300000,'NEW','{}')`, [I(1), B(1)]);
  await q('commit');
}
async function run() {
  await setup();
  const segs = [{ id: `${B(1)}-S1`, ktvId: K(1), roomId: ROOM, bedId: BED, startTime: vn(-1), endTime: vn(0), duration: 1, sequenceSlot: 1 },
                { id: `${B(1)}-S2`, ktvId: K(2), roomId: ROOM, bedId: BED, startTime: vn(0), endTime: vn(30), duration: 30, sequenceSlot: 2 }];
  const itemUpdates = [{ id: I(1), status: 'PREPARING', segments: segs, options: { sequentialSlots: 2 }, technicianCodes: [K(1), K(2)], roomName: ROOM, bedId: BED }];
  const staffAssignments = segs.map(s => ({ ktvId: s.ktvId, bookingItemId: I(1), segmentId: s.id, startTime: s.startTime, endTime: s.endTime, roomId: ROOM, bedId: BED, queuePos: 1 }));
  const r = (await q(`select dispatch_commit_form($1,'DISPATCH',$2,'{}') r`, [B(1), JSON.stringify({ date: day, status: 'PREPARING', roomName: ROOM, bedId: BED, technicianCode: `${K(1)} - ${K(2)}`, itemUpdates, staffAssignments })])).rows[0].r;
  if (!r?.success) throw new Error('dispatch ' + JSON.stringify(r));
  await patch(1, K(1), 'IN_PROGRESS', { action: 'START_TIMER', targetSegmentId: `${B(1)}-S1`, startPhotoBase64: photo, guestSlipperPhotoBase64: photo });
  await patch(1, K(1), 'CLEANING');
  await patch(1, K(2), 'IN_PROGRESS', { action: 'START_TIMER', targetSegmentId: `${B(1)}-S2`, startPhotoBase64: photo, guestSlipperPhotoBase64: photo });
  const before = await item(1); const bSeg = j(before.segments).find((s: any) => s.sequenceSlot === 2);
  check('chuẩn bị: A xong, B đang chạy', j(before.segments).find((s: any) => s.sequenceSlot === 1).actualEndTime && bSeg.actualStartTime && !bSeg.actualEndTime, j(before.segments));
  // Quầy đổi B 30 → 45 phút (form gửi lại toàn bộ chặng như trang điều phối)
  const opts = j(before.options);
  const res = await actions.saveDraftDispatch(B(1), { roomName: ROOM, bedId: BED, itemUpdates: [{ id: I(1), roomName: ROOM, bedId: BED, technicianCodes: [K(1), K(2)], status: before.status,
    segments: j(before.segments).map((s: any) => s.sequenceSlot === 2 ? { ...s, duration: 45, endTime: vn(45) } : s), options: { ...opts, sequentialSlots: 2 } }] });
  check('H1 lưu thành công', res.success === true, res.error);
  const after = await item(1); const b2 = j(after.segments).find((s: any) => s.sequenceSlot === 2);
  const endMs = Date.parse(b2.actualStartTime) + 45 * 60e3;
  check('H1 B: duration 45, plannedEndAt = bắt đầu thực + 45 phút', Number(b2.duration) === 45 && Math.abs(Date.parse(b2.plannedEndAt) - endMs) < 1000, b2);
  check('H1 B vẫn đang chạy, A không đổi', b2.actualStartTime === bSeg.actualStartTime && !b2.actualEndTime && after.status === 'IN_PROGRESS');
  const ka = (await q(`select planned_end_time from "KtvAssignments" where booking_id=$1 and employee_id=$2 and status in ('ACTIVE','QUEUED','READY')`, [B(1), K(2)])).rows[0];
  check('H1 KtvAssignments.planned_end_time cập nhật', ka && Math.abs(new Date(ka.planned_end_time).getTime() - endMs) < 1000, ka);
  check('H1 durationChanges có B', (res.durationChanges || []).some((c: any) => c.employeeId === K(2) && c.minutes === 45), res.durationChanges);
  const note = (await q(`select message from "StaffNotifications" where "bookingId"=$1 and "employeeId"=$2 and type='KTV_ORDER_CHANGED'`, [B(1), K(2)])).rows[0];
  check('H1 B nhận thông báo "Quầy đã thay đổi thời gian dịch vụ"', /Quầy đã thay đổi thời gian dịch vụ của bạn thành 45 phút/.test(note?.message || ''), note);
  const warn = Number((await q(`select count(*) n from "StaffNotifications" where "bookingId"=$1 and type='WARNING'`, [B(1)])).rows[0].n);
  check('H1 admin nhận cảnh báo', warn >= 1, warn);
  const hist = j(after.options).dispatchHistory.map((h: any) => h.action);
  check('H1 lịch sử ghi ADJUST_B_DURATION', hist.includes('ADJUST_B_DURATION'), hist);
  // Giảm xuống dưới số phút đã làm → bị từ chối
  // Real elapsed time (the guard keeps actualStartTime immutable): wait > 1 minute, then ask for 1 minute.
  await new Promise(r => setTimeout(r, 65000));
  const cur = await item(1);
  const low = await actions.saveDraftDispatch(B(1), { roomName: ROOM, bedId: BED, itemUpdates: [{ id: I(1), roomName: ROOM, bedId: BED, technicianCodes: [K(1), K(2)], status: cur.status,
    segments: j(cur.segments).map((s: any) => s.sequenceSlot === 2 ? { ...s, duration: 1 } : s), options: { ...j(cur.options), sequentialSlots: 2 } }] });
  check('H1 giảm B xuống dưới số phút đã làm → bị từ chối', low.success === false && /lớn hơn số phút B đã làm/.test(low.error || ''), low);
  // Đổi nhân viên B đang làm qua form → bị từ chối
  const swap = await actions.saveDraftDispatch(B(1), { roomName: ROOM, bedId: BED, itemUpdates: [{ id: I(1), roomName: ROOM, bedId: BED, technicianCodes: [K(1), K(2)], status: cur.status,
    segments: j(cur.segments).map((s: any) => s.sequenceSlot === 2 ? { ...s, duration: 50, roomId: 'OTHER-ROOM' } : s), options: { ...j(cur.options), sequentialSlots: 2 } }] });
  check('H1 đổi phòng B đang làm qua form → bị từ chối', swap.success === false, swap);
}
async function cleanup() {
  const bks = [B(1)]; await q('begin');
  const urls = (await q('select segments from "BookingItems" where "bookingId"=any($1)', [bks])).rows.flatMap((r: any) => (j(r.segments) || []).flatMap((s: any) => [s.startPhotoUrl, s.guestSlipperPhotoUrl]).filter(Boolean));
  for (const t of ['TurnLedger', 'KtvAssignments']) await q(`delete from "${t}" where booking_id=any($1)`, [bks]);
  await q('delete from "StaffNotifications" where "bookingId"=any($1)', [bks]);
  await q('delete from "TurnQueue" where employee_id like $1', [`QH1${stamp}%`]);
  await q('delete from "BookingItems" where "bookingId"=any($1)', [bks]); await q('delete from "Bookings" where id=any($1)', [bks]);
  await q('delete from "Staff" where id like $1', [`QH1${stamp}%`]); await q('delete from "Beds" where id=$1', [BED]); await q('delete from "Rooms" where id=$1', [ROOM]);
  await q('commit');
  const paths = urls.map((u: string) => u.split('/storage/v1/object/public/attendance/')[1]).filter(Boolean);
  if (paths.length) await require('@/lib/supabaseAdmin').getSupabaseAdmin().storage.from('attendance').remove(paths);
  return Number((await q('select count(*) n from "Bookings" where id like $1', [`${P}%`])).rows[0].n);
}
(async () => { await db.connect(); try { await run(); } catch (e: any) { fail++; console.log('RUN ERR', e.message); } finally { try { console.log('leftovers', await cleanup()); } catch (e: any) { await q('rollback').catch(() => 0); console.log('CLEANUP ERR', e.message, 'stamp', stamp); } await db.end(); console.log(JSON.stringify({ failed: fail })); if (fail) process.exitCode = 1; } })();
