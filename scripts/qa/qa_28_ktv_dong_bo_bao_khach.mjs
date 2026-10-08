/**
 * QA: màn điểm danh KTV Loại D tự mở khoá tan ca khi quầy tắt Báo khách (không cần tải lại).
 * CHỈ chạy trên DB TEST, dev server :3005 trỏ TEST.
 *   node --env-file=<test .env.local> scripts/qa/qa_28_ktv_dong_bo_bao_khach.mjs
 * `shouldRefresh` chép đúng luật trong AttendanceTypeD.tsx (fetchState).
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!URL.includes('eknggruuiuad')) { console.log('NOT TEST DB, abort'); process.exit(1); }
const admin = createClient(URL, process.env.SUPABASE_SECRET_KEY);
const BASE = 'http://localhost:3005';

let fail = 0;
const check = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? '✅' : '❌'} ${n}${x ? ' → ' + x : ''}`); };
const shouldRefresh = (lockNow, screenLockActive, checkStatus) =>
  typeof lockNow === 'boolean' && lockNow !== screenLockActive && checkStatus !== 'LOADING_GPS';
const onCall = async code => (await fetch(`${BASE}/api/ktv/type-d/on-call?techCode=${code}`)).json();

(async () => {
  const pre = await admin.from('GuestArrivalEvents').select('id').is('released_at', null);
  if (pre.data?.length) { console.log('TEST đang có khoá bật sẵn — dừng.'); process.exit(1); }
  const { data: st } = await admin.from('Staff').select('id').eq('work_type', 'TYPE_D').limit(1);
  const code = st?.[0]?.id; console.log('KTV Loại D test:', code, '\n');

  let r = await onCall(code);
  check('1. Chưa bật khoá → guestArrivalLockActive = false', r.data?.guestArrivalLockActive === false);
  check('   Các trường cũ vẫn đủ (allow_on_call, online_status, businessDate, isOffToday)',
    ['allow_on_call', 'online_status', 'businessDate', 'isOffToday'].every(k => k in r.data));

  await admin.from('GuestArrivalEvents').insert({ created_by: 'QA', created_by_name: 'QA test', note: 'QA qa_28' });
  try {
    r = await onCall(code);
    check('2. Quầy bật khoá → true', r.data?.guestArrivalLockActive === true);
    check('3. Màn KTV đang thấy "mở" → nạp lại để khoá nút', shouldRefresh(true, false, 'CONFIRMED'));
    check('4. Đã khớp (đang khoá) → không nạp lại thừa', !shouldRefresh(true, true, 'CONFIRMED'));
    check('5. Đang gửi điểm danh → không nạp lại', !shouldRefresh(true, false, 'LOADING_GPS'));

    const del = await (await fetch(`${BASE}/api/reception/guest-arrival`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    check('6. Quầy tắt Báo khách', del.success);
    r = await onCall(code);
    check('7. Sau khi tắt → false', r.data?.guestArrivalLockActive === false);
    check('8. Màn KTV đang khoá → nạp lại, nút tan ca sáng lại', shouldRefresh(false, true, 'CONFIRMED'));

    check('9. API lỗi/thiếu dữ liệu → undefined thì bỏ qua', !shouldRefresh(undefined, true, 'CONFIRMED'));
  } finally {
    await admin.from('GuestArrivalEvents').update({ released_at: new Date().toISOString(), released_by: 'QA' }).is('released_at', null).eq('created_by', 'QA');
  }
  console.log(fail ? `\n❌ ${fail} lỗi` : '\n✅ Tất cả đạt');
  process.exit(fail ? 1 : 0);
})();
