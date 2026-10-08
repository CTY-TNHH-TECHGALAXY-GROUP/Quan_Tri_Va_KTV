/**
 * QA: popup nhắc tắt Báo khách — hoãn dùng chung mọi máy quầy. CHỈ chạy trên DB TEST.
 *   node --env-file=<test .env.local> scripts/qa/qa_27_bao_khach_hoan_nhac.mjs   (dev server :3005 trỏ TEST)
 *
 * Mỗi "máy" = state của Bảng điều phối (board) + 1 vòng poll của popup. Hàm `pollOnce` /
 * `visible` chép đúng luật trong GuestArrivalReminder.logic.ts. Gọi API thật qua dev server.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!URL.includes('eknggruuiuad')) { console.log('NOT TEST DB, abort'); process.exit(1); }
const BASE = 'http://localhost:3005/api/reception/guest-arrival';
const admin = createClient(URL, process.env.SUPABASE_SECRET_KEY);

let fail = 0;
const check = (name, ok, extra = '') => { if (!ok) fail++; console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' → ' + extra : ''}`); };
const get = async () => (await fetch(BASE)).json();
const call = async (method, body) => (await fetch(BASE, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json();
const toMs = iso => (iso ? new Date(iso).getTime() : null);

const makeDevice = (name) => ({ name, board: { active: false, lockedAt: '' }, server: null, X: 15, localSnooze: null, resyncs: 0 });
// = fetchGuestArrivalLock() của page
const boardFetch = async d => { const r = await get(); d.board = r.active && r.data ? { active: true, lockedAt: r.data.created_at } : { active: false, lockedAt: '' }; };
// = poll() của hook
const pollOnce = async d => {
  const r = await get();
  d.X = r.reminderMinutes;
  d.server = { active: !!r.active && !!r.data, createdAt: r.data?.created_at ?? '', snoozeMs: toMs(r.data?.reminder_snoozed_until) };
  if (d.server.active !== d.board.active || (d.server.active && d.server.createdAt !== d.board.lockedAt)) { d.resyncs++; await boardFetch(d); }
};
const visible = (d, now = Date.now()) => {
  const sameLock = !!d.server?.active && d.server.createdAt === d.board.lockedAt;
  const snooze = Math.max(sameLock ? d.server.snoozeMs ?? 0 : 0, d.localSnooze ?? 0) || null;
  const lockedAtMs = toMs(d.board.lockedAt);
  return d.board.active && sameLock && d.X > 0 && lockedAtMs !== null && now >= (snooze ?? lockedAtMs + d.X * 60_000);
};
// "Vẫn còn khách" của hook
const snooze = async d => { d.localSnooze = Date.now() + d.X * 60_000; return call('PATCH', { minutes: d.X }); };

(async () => {
  const pre = await admin.from('GuestArrivalEvents').select('id').is('released_at', null);
  if (pre.data?.length) { console.log('TEST đang có khoá bật sẵn — dừng để không đụng.'); process.exit(1); }
  const X = (await get()).reminderMinutes;
  console.log(`reminderMinutes trên TEST = ${X}\n`);
  if (!(X > 0)) { console.log('Đặt X > 0 trước khi test'); process.exit(1); }

  const A = makeDevice('A'), B = makeDevice('B');
  await boardFetch(A); await boardFetch(B); // cả 2 mở bảng khi chưa có khoá

  // Máy A bật Báo khách; tạo như đã bật từ X+1 phút trước để không phải chờ.
  const createdAt = new Date(Date.now() - (X + 1) * 60_000).toISOString();
  const ins = await admin.from('GuestArrivalEvents')
    .insert({ created_by: 'QA', created_by_name: 'QA test', created_at: createdAt, note: 'QA qa_27' }).select('id').single();
  check('Tạo khoá test (bật từ X+1 phút trước)', !ins.error, ins.error?.message);

  try {
    await boardFetch(A);                 // máy A tự bật → board A biết ngay
    await pollOnce(A); await pollOnce(B); // vòng poll kế tiếp (≤30s)
    check('1. Máy A hiện popup', visible(A));
    check('2. Máy B (bảng chưa biết có khoá) tự đồng bộ bảng và hiện popup', B.resyncs === 1 && B.board.active && visible(B), `resyncs=${B.resyncs}`);

    const p = await snooze(A);
    check('3. A bấm "Vẫn còn khách" → PATCH ok', p.success && p.active, p.snoozedUntil);
    check('4. A ẩn ngay', !visible(A));
    check('5. B trước vòng poll vẫn hiện (độ trễ ≤30s là chấp nhận)', visible(B));
    await pollOnce(B);
    check('6. B sau vòng poll → ẩn', !visible(B));

    const C = makeDevice('C'); await boardFetch(C); await pollOnce(C);
    check('7. Máy C mở sau → không hiện (biết đang hoãn)', !visible(C));
    const due = C.server.snoozeMs;
    check('8. Mốc nhắc lại ≈ bây giờ + X phút', Math.abs(due - (Date.now() + X * 60_000)) < 30_000,
      new Date(due).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
    check('9. Hết hoãn → A, B, C cùng hiện lại', [A, B, C].every(d => visible(d, due + 1000)));

    // B bấm "Tắt Báo khách" (toggle của page: board B đang active → DELETE)
    check('10. B bấm Tắt → board B đang active nên toggle gọi DELETE (không bật nhầm)', B.board.active);
    const del = await call('DELETE'); await boardFetch(B);
    check('11. DELETE ok', del.success, del.message);
    await pollOnce(A); await pollOnce(C);
    check('12. A, C sau vòng poll → bảng tự đồng bộ "không có khoá", không popup', !A.board.active && !C.board.active && !visible(A) && !visible(C));

    // Khoá mới không kế thừa mốc hoãn cũ, cũng không kế thừa hoãn tại máy
    await admin.from('GuestArrivalEvents').insert({ created_by: 'QA', created_by_name: 'QA test', created_at: createdAt, note: 'QA qa_27 #2' });
    await boardFetch(A); A.localSnooze = null; await pollOnce(A);
    check('13. Khoá mới: mốc hoãn trống, đã quá X → hiện ngay', A.server.snoozeMs === null && visible(A));
    await call('DELETE');
  } finally {
    await admin.from('GuestArrivalEvents').update({ released_at: new Date().toISOString(), released_by: 'QA' }).is('released_at', null).eq('created_by', 'QA');
  }
  console.log(fail ? `\n❌ ${fail} lỗi` : '\n✅ Tất cả đạt');
  process.exit(fail ? 1 : 0);
})();
