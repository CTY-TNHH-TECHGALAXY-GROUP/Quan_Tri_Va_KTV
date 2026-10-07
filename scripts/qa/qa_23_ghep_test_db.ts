/**
 * QA #23 — GHÉP DỊCH VỤ / GHÉP KHÁC KTV / TÁCH KHÁCH chạy trên **DB TEST** bằng server action THẬT.
 *
 * Gọi đúng `saveDraftDispatch` (lưu cả đơn), `saveDispatchForm` (lưu từng dòng KTV), RPC
 * `split_booking_into_sub_bookings` (tách khách) — chỉ thay phần đăng nhập / thông báo / cache của Next.
 * Phía form (bấm ghép) dùng đúng hàm của form: pickLeadingService, ktvsRemovedByMerge, mergeServicesIntoParent,
 * withFollowingServices, và cách dựng payload của handleSaveDraft.
 * Đọc lại DB rồi kiểm: chặng / KTV / dấu ghép, tổng phút đồng hồ KTV (cách app KTV tính), điều kiện tự hoàn tất.
 *
 * AN TOÀN: dừng ngay nếu URL không phải Supabase TEST (eknggruuiuadwldacpmb). Dữ liệu tiền tố QA-GHEP-, xoá khi xong.
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_23_ghep_test_db.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import Module from 'module';

const TEST_REF = 'eknggruuiuadwldacpmb';
const envFile = path.join(__dirname, '../../.worktrees/sequential-two-slot-handoff-20260926/.env.local');
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
}
if (!String(process.env.NEXT_PUBLIC_SUPABASE_URL).includes(TEST_REF)) throw new Error('DỪNG: không phải DB TEST');

// Thay phần phụ thuộc request của Next (đăng nhập, header, thông báo, cache) — logic lưu giữ nguyên.
const STUBS: Record<string, any> = {
    '@/lib/auth-server': { requirePermission: async () => true, requirePermissionAny: async () => true, requireBusinessUser: async () => null, authErrorResponse: () => null },
    'next/cache': { unstable_noStore: () => {}, revalidatePath: () => {} },
    'next/server': { after: () => {}, NextResponse: { json: (b: any) => b } },
    'next/headers': { headers: async () => new Map(), cookies: async () => ({ get: () => undefined }) },
    '@/lib/push-helper': { sendPushNotification: async () => true },
    '@/lib/notification-helper': { createNotification: async () => true },
    'server-only': {},
};
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) {
    return STUBS[request] ?? originalLoad.call(this, request, ...rest);
};

/* eslint-disable @typescript-eslint/no-require-imports */
const actions = require('@/app/reception/dispatch/actions');
const { getSupabaseAdmin } = require('@/lib/supabaseAdmin');
const { mergeServicesIntoParent, ktvsRemovedByMerge } = require('@/app/reception/dispatch/_components/QuickDispatchTable.logic');
const ms = require('@/lib/dispatch/merged-service');
const { ktvAssignedMinutes, parseKtvSegments, parseKtvOptions } = require('@/lib/ktvUtils');
const { finish, fatal } = require('./_exit');
/* eslint-enable @typescript-eslint/no-require-imports */

const sb = getSupabaseAdmin();
const DATE = '2026-10-07';
const SVC: Record<string, { name: string; duration: number }> = {
    NHS0101: { name: 'Ấn huyệt chân chuyên nghiệp', duration: 60 },
    NHS0040: { name: 'Kết hợp 4 liệu trình', duration: 70 },
};
const BED = { roomId: 'SEQ_TEST_ROOM', bedId: 'SEQ_TEST_BED_1' };
const RUN = Date.now().toString(36).toUpperCase();
const created: string[] = [];
let failures = 0;
const report: any[] = [];
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
    return ok;
}
const addMin = (hhmm: string, m: number) => { const [h, mm] = hhmm.split(':').map(Number); const t = ((h * 60 + mm + m) % 1440 + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** Tạo đơn NEW: guests = [[serviceId, ...], ...] → item id = <booking>-g<khách>-<n>. */
async function createBooking(tag: string, guests: string[][]) {
    const id = `QA-GHEP-${RUN}-${tag}`;
    created.push(id);
    const { error: bErr } = await sb.from('Bookings').insert({ id, billCode: id, customerName: `QA ${tag}`, status: 'NEW', source: 'STANDARD_WALK_IN',
        bookingDate: `${DATE}T20:00:00`, guestCount: guests.length, totalAmount: 0, paymentMethod: 'Tiền mặt', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    if (bErr) throw bErr;
    let order = 0;
    for (let g = 0; g < guests.length; g++) {
        const guestId = `${id}-guest${g + 1}`;
        const { error: gErr } = await sb.from('BookingGuests').insert({ id: guestId, booking_id: id, guest_index: g + 1, guest_label: `Khách ${g + 1}`, status: 'PENDING' });
        if (gErr) throw gErr;
        for (let n = 0; n < guests[g].length; n++) {
            const sid = guests[g][n];
            const { error: iErr } = await sb.from('BookingItems').insert({ id: `${id}-g${g + 1}-${n + 1}`, bookingId: id, serviceId: sid, quantity: 1, price: 0, status: 'NEW',
                guest_id: guestId, segments: [], technicianCodes: [], options: { displayName: SVC[sid].name, duration: SVC[sid].duration, order: order++, customerGroupId: `${id}-g${g + 1}` } });
            if (iErr) throw iErr;
        }
    }
    return id;
}

/** Item DB → ServiceBlock như màn điều phối dựng. */
async function loadBlocks(bookingIds: string[]) {
    const { data, error } = await sb.from('BookingItems').select('*').in('bookingId', bookingIds).order('id');
    if (error) throw error;
    return (data || []).map((it: any) => {
        const o = parseKtvOptions(it.options);
        const segs = parseKtvSegments(it.segments);
        const byKtv = new Map<string, any[]>();
        segs.forEach((s: any) => { if (!byKtv.has(s.ktvId)) byKtv.set(s.ktvId, []); byKtv.get(s.ktvId)!.push(s); });
        return { id: it.id, bookingId: it.bookingId, serviceId: it.serviceId, serviceName: SVC[it.serviceId]?.name || it.serviceId,
            duration: SVC[it.serviceId]?.duration || 60, status: it.status, options: o, displayName: o.displayName,
            mergedIntoId: o.mergedIntoId, mergedServiceIds: o.mergedServiceIds, customerGroupId: o.customerGroupId,
            staffList: [...byKtv.entries()].map(([ktvId, segments]) => ({ id: `row-${it.id}-${ktvId}`, ktvId, ktvName: ktvId, segments })),
            selectedRoomId: null, bedId: null, adminNote: '', genderReq: '', strength: '', focus: '', avoid: '', customerNote: '' };
    });
}

const assign = (blocks: any[], itemId: string, ktvIds: string[], start: string) => blocks.map(b => b.id !== itemId ? b : {
    ...b, staffList: ktvIds.map((k, i) => ({ id: `row-${itemId}-${k}`, ktvId: k, ktvName: k,
        segments: [{ id: `seg-${itemId}-${i}`, ...BED, startTime: start, endTime: addMin(start, b.duration), duration: b.duration }] })) });

/** Bấm "Gộp chung KTV" trên form (đúng các hàm của QuickDispatchTable). */
function pressMerge(blocks: any[], selectIds: string[]) {
    const selected = selectIds.map(id => blocks.find(b => b.id === id));
    const leading = ms.pickLeadingService(selected, blocks, () => false);
    const following = selected.filter((s: any) => s.id !== leading.id);
    const removed = ktvsRemovedByMerge(blocks, leading.id, following.map((f: any) => f.id));
    let next = mergeServicesIntoParent(blocks, leading.id, following);
    const name = [leading, ...following].map((s: any) => `${s.serviceName} (${s.duration}p)`).join(' + ');
    next = next.map((b: any) => b.id === leading.id ? { ...b, displayName: name, options: { ...b.options, displayName: name } } : b);
    // Trang điều phối (onUpdateServices sau sửa): dịch vụ sau không có KTV.
    next = next.map((b: any) => ms.mergedIntoIdOf(b) ? { ...b, staffList: [] } : b);
    return { blocks: next, leadingId: leading.id, removed };
}

/** Lưu cả đơn (handleSaveDraft sau sửa). */
async function saveWhole(bookingId: string, blocks: any[]) {
    const mine = blocks.filter(b => b.bookingId === bookingId);
    const itemUpdates = mine.map((svc, index) => {
        const isChild = !!ms.mergedIntoIdOf(svc);
        const segments = isChild ? [] : svc.staffList.filter((r: any) => r.ktvId).flatMap((r: any) => r.segments.map((s: any) => ({ ...s, ktvId: r.ktvId })));
        return { id: svc.id, roomName: segments[0]?.roomId || BED.roomId, bedId: segments[0]?.bedId || BED.bedId,
            technicianCodes: isChild ? [] : svc.staffList.map((r: any) => r.ktvId).filter(Boolean), segments,
            options: { ...svc.options, displayName: svc.displayName || svc.serviceName, mergedIntoId: ms.mergedIntoIdOf(svc) ?? null,
                mergedServiceIds: svc.mergedServiceIds, customerGroupId: svc.customerGroupId || svc.id, order: index } };
    });
    return actions.saveDraftDispatch(bookingId, { date: DATE, bedId: BED.bedId, roomName: BED.roomId, notes: '', itemUpdates });
}

/** Lưu từng dòng KTV (onSaveStaffRow → saveDispatchForm, kèm followingIds). */
async function saveRows(bookingId: string, blocks: any[]) {
    const results: any[] = [];
    for (const item of blocks.filter(b => b.bookingId === bookingId && !ms.mergedIntoIdOf(b) && b.staffList.some((r: any) => r.ktvId))) {
        const { data } = await sb.from('BookingItems').select('options').eq('id', item.id).single();
        const revision = Number(parseKtvOptions(data?.options).dispatchRevision || 0);
        const followingIds = ms.withFollowingServices([item.id], blocks).filter((id: string) => id !== item.id);
        results.push(await actions.saveDispatchForm(bookingId, item.id, item.staffList, revision, false, item.displayName || item.options?.displayName || item.serviceName, false, followingIds));
    }
    return results;
}

/** Tách khách (đúng cách handleSaveDraft dựng kế hoạch): nhóm theo customerGroupId, dịch vụ sau đi theo dịch vụ trước. */
async function splitGuests(bookingId: string, blocks: any[]) {
    const groups = new Map<string, string[]>();
    blocks.filter(b => b.bookingId === bookingId && !ms.mergedIntoIdOf(b)).forEach(svc => {
        const gid = svc.customerGroupId || svc.id;
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid)!.push(svc.id, ...blocks.filter(c => ms.mergedIntoIdOf(c) === svc.id).map(c => c.id));
    });
    const plan = [...groups.values()].map((itemIds, i) => ({ suffix: String.fromCharCode(65 + i), itemIds }));
    const { data, error } = await sb.rpc('split_booking_into_sub_bookings', { p_booking_id: bookingId, p_split_plan: plan });
    if (error || data?.success !== true) throw new Error('split: ' + (error?.message || data?.error));
    plan.forEach(p => created.push(`${bookingId}-${p.suffix}`));
    return plan.map(p => `${bookingId}-${p.suffix}`);
}

/** Đọc DB: tình trạng từng KTV và dịch vụ sau. */
async function inspect(bookingIds: string[]) {
    const { data } = await sb.from('BookingItems').select('*').in('bookingId', bookingIds).order('id');
    const items = data || [];
    const timer = (ktv: string) => items.filter((i: any) => (i.technicianCodes || []).includes(ktv)).reduce((s: number, i: any) => s + ktvAssignedMinutes(i, ktv), 0);
    const followers = items.filter((i: any) => parseKtvOptions(i.options).mergedIntoId);
    const followersClean = followers.every((f: any) => !parseKtvSegments(f.segments).length && !(f.technicianCodes || []).length);
    const sameBooking = followers.every((f: any) => items.find((p: any) => p.id === parseKtvOptions(f.options).mergedIntoId)?.bookingId === f.bookingId);
    const ends = items.flatMap((i: any) => parseKtvSegments(i.segments).map((s: any) => `${s.ktvId} ${s.startTime}-${s.endTime} ${s.duration}p`));
    return { items, timer, followers, followersClean, sameBooking, ends };
}

interface Row { ca: string; nhom: string; cach_luu: string; ket_qua: string; dong_ho: string; sau_sach: string; ghi_chu: string }
const push = (r: Row) => report.push(r);

async function main() {
    // ───────── GỘP CHUNG KTV ─────────
    {   // 1
        const id = await createBooking('C1', [['NHS0101', 'NHS0040']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '21:42');
        const m = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]);
        const r = await saveWhole(id, m.blocks); const s = await inspect([id]);
        console.log('\n#1 Gộp chung KTV — KTV gán ở dịch vụ trước, lưu cả đơn');
        const ok = [check(r.success, 'lưu thành công', r.error || ''), check(s.timer('SEQ_TEST_A') === 130, 'đồng hồ SEQ_TEST_A = 130', String(s.timer('SEQ_TEST_A'))), check(s.followersClean && s.followers.length === 1, 'dịch vụ sau đã ghép, không chặng/KTV')].every(Boolean);
        push({ ca: '1', nhom: 'Gộp chung KTV', cach_luu: 'cả đơn', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: s.ends.join('; ') });
    }
    {   // 2
        const id = await createBooking('C2', [['NHS0101', 'NHS0040']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '21:42'); b = assign(b, `${id}-g1-2`, ['SEQ_TEST_A'], '22:42');
        const m = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]);
        const r = await saveWhole(id, m.blocks); const s = await inspect([id]);
        console.log('\n#2 Gộp chung KTV — gán CÙNG KTV ở cả 2 dịch vụ rồi ghép (lỗi lần 1 hôm 06/10)');
        const ok = [check(r.success, 'lưu thành công (trước đây: "Giờ hoặc thời lượng không hợp lệ")', r.error || ''), check(s.timer('SEQ_TEST_A') === 130, 'đồng hồ = 130, không cộng trùng', String(s.timer('SEQ_TEST_A'))), check(s.followersClean, 'dịch vụ sau sạch')].every(Boolean);
        push({ ca: '2', nhom: 'Gộp chung KTV', cach_luu: 'cả đơn', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: `gỡ: ${m.removed.join(',') || 'không'}` });
    }
    {   // 3
        const id = await createBooking('C3', [['NHS0101', 'NHS0040']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '21:42');
        const m = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]);
        const rs = await saveRows(id, m.blocks); const s = await inspect([id]);
        console.log('\n#3 Gộp chung KTV — ghép rồi LƯU TỪNG DÒNG KTV (lỗi lần 2 hôm 06/10)');
        const ok = [check(rs.every(r => r.success), 'lưu dòng thành công', rs.map(r => r.error).filter(Boolean).join('; ')), check(s.followers.length === 1 && s.followersClean, 'dịch vụ sau đã được đánh dấu ghép (trước đây: còn sót)'), check(s.timer('SEQ_TEST_A') === 130, 'đồng hồ = 130', String(s.timer('SEQ_TEST_A')))].every(Boolean);
        push({ ca: '3', nhom: 'Gộp chung KTV', cach_luu: 'từng dòng', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')}`, sau_sach: s.followersClean && s.followers.length ? 'có' : 'KHÔNG', ghi_chu: s.ends.join('; ') });
    }
    {   // 4
        const id = await createBooking('C4', [['NHS0101', 'NHS0040']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A', 'SEQ_TEST_B'], '21:00');
        const m = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]);
        const rs = await saveRows(id, m.blocks); const s = await inspect([id]);
        console.log('\n#4 Gộp chung KTV — 2 KTV trên dịch vụ trước, lưu từng dòng');
        const ok = [check(rs.every(r => r.success), 'lưu thành công', rs.map(r => r.error).filter(Boolean).join('; ')), check(s.timer('SEQ_TEST_A') === 130 && s.timer('SEQ_TEST_B') === 130, 'cả 2 KTV đồng hồ 130', `A=${s.timer('SEQ_TEST_A')} B=${s.timer('SEQ_TEST_B')}`), check(s.followersClean, 'dịch vụ sau sạch')].every(Boolean);
        push({ ca: '4', nhom: 'Gộp chung KTV', cach_luu: 'từng dòng', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')} B=${s.timer('SEQ_TEST_B')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: '2KTV-1DV' });
    }
    {   // 5
        const id = await createBooking('C5', [['NHS0101', 'NHS0040']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '23:30');
        const m = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]);
        const r = await saveWhole(id, m.blocks); const s = await inspect([id]);
        console.log('\n#5 Gộp chung KTV — ca đêm qua nửa đêm 23:30 + 130p');
        const ok = [check(r.success, 'lưu thành công', r.error || ''), check(s.ends.some((e: string) => e.includes('23:30-01:40 130p')), 'chặng 23:30–01:40, 130p', s.ends.join('; '))].every(Boolean);
        push({ ca: '5', nhom: 'Gộp chung KTV', cach_luu: 'cả đơn', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: s.ends.join('; ') });
    }
    // ───────── GỘP KHÁC KTV ─────────
    {   // 6
        const id = await createBooking('K6', [['NHS0101', 'NHS0040']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '20:00'); b = assign(b, `${id}-g1-2`, ['SEQ_TEST_B'], '20:00');
        const m = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]);
        const r = await saveWhole(id, m.blocks); const s = await inspect([id]);
        console.log('\n#6 Gộp khác KTV — trước SEQ_TEST_A, sau SEQ_TEST_B, lưu cả đơn');
        const ok = [check(r.success, 'lưu thành công', r.error || ''), check(JSON.stringify(m.removed) === '["SEQ_TEST_B"]', 'quầy được báo gỡ SEQ_TEST_B', JSON.stringify(m.removed)), check(s.timer('SEQ_TEST_A') === 130 && s.timer('SEQ_TEST_B') === 0, 'A làm 130, B không còn trong đơn', `A=${s.timer('SEQ_TEST_A')} B=${s.timer('SEQ_TEST_B')}`)].every(Boolean);
        push({ ca: '6', nhom: 'Gộp khác KTV', cach_luu: 'cả đơn', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')} B=${s.timer('SEQ_TEST_B')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: `gỡ ${m.removed.join(',')}` });
    }
    {   // 7
        const id = await createBooking('K7', [['NHS0101', 'NHS0040']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-2`, ['SEQ_TEST_B'], '20:00');
        const m = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]);
        const rs = await saveRows(id, m.blocks); const s = await inspect([id]);
        console.log('\n#7 Gộp khác KTV — dịch vụ trước CHƯA có KTV, dịch vụ sau có SEQ_TEST_B, lưu từng dòng');
        const ok = [check(rs.length === 1 && rs.every(r => r.success), 'lưu thành công', rs.map(r => r.error).filter(Boolean).join('; ')), check(s.timer('SEQ_TEST_B') === 130, 'B chuyển sang dịch vụ trước, đồng hồ 130', String(s.timer('SEQ_TEST_B'))), check(s.followersClean, 'dịch vụ sau sạch')].every(Boolean);
        push({ ca: '7', nhom: 'Gộp khác KTV', cach_luu: 'từng dòng', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `B=${s.timer('SEQ_TEST_B')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: 'KTV chuyển sang trước' });
    }
    // ───────── TÁCH KHÁCH ─────────
    {   // 8
        const id = await createBooking('T8', [['NHS0101', 'NHS0040'], ['NHS0101', 'NHS0040']]);
        const subs = await splitGuests(id, await loadBlocks([id]));
        let b = await loadBlocks(subs);
        const [A, B] = subs;
        const itA = b.filter((x: any) => x.bookingId === A).map((x: any) => x.id).sort(); const itB = b.filter((x: any) => x.bookingId === B).map((x: any) => x.id).sort();
        b = assign(b, itA[0], ['SEQ_TEST_A'], '21:42'); b = assign(b, itB[0], ['SEQ_TEST_B'], '21:42');
        b = pressMerge(b, itA).blocks; b = pressMerge(b, itB).blocks;
        const rs = [...await saveRows(A, b), ...await saveRows(B, b)]; const s = await inspect(subs);
        console.log('\n#8 Tách khách TRƯỚC rồi ghép trong từng thẻ, lưu từng dòng (đúng đơn Glenn 06/10)');
        const ok = [check(rs.every(r => r.success), 'lưu cả 2 thẻ thành công', rs.map(r => r.error).filter(Boolean).join('; ')), check(s.followers.length === 2 && s.followersClean && s.sameBooking, 'mỗi khách: dịch vụ sau ghép đúng, cùng đơn con'), check(s.timer('SEQ_TEST_A') === 130 && s.timer('SEQ_TEST_B') === 130, 'A=130, B=130', `A=${s.timer('SEQ_TEST_A')} B=${s.timer('SEQ_TEST_B')}`)].every(Boolean);
        push({ ca: '8', nhom: 'Tách khách', cach_luu: 'từng dòng', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')} B=${s.timer('SEQ_TEST_B')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: subs.map((x: string) => x.split('-').pop()).join('+') });
    }
    {   // 9
        const id = await createBooking('T9', [['NHS0101', 'NHS0040'], ['NHS0101']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '20:00'); b = assign(b, `${id}-g2-1`, ['SEQ_TEST_C'], '20:00');
        b = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]).blocks;
        const r0 = await saveWhole(id, b);
        const subs = await splitGuests(id, await loadBlocks([id]));
        const s = await inspect(subs);
        console.log('\n#9 Ghép TRƯỚC rồi tách khách');
        const ok = [check(r0.success, 'lưu ghép trước khi tách', r0.error || ''), check(s.sameBooking && s.followers.length === 1, 'dịch vụ sau đi cùng đơn con của dịch vụ trước'), check(s.timer('SEQ_TEST_A') === 130 && s.timer('SEQ_TEST_C') === 60, 'A=130 (khách 1), C=60 (khách 2)', `A=${s.timer('SEQ_TEST_A')} C=${s.timer('SEQ_TEST_C')}`)].every(Boolean);
        push({ ca: '9', nhom: 'Tách khách', cach_luu: 'cả đơn → tách', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')} C=${s.timer('SEQ_TEST_C')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: subs.map((x: string) => x.split('-').pop()).join('+') });
    }
    // ───────── LỚP SERVER ─────────
    {   // 10
        const id = await createBooking('S10', [['NHS0101', 'NHS0040']]);
        const legacy = [
            { id: `${id}-g1-1`, technicianCodes: ['SEQ_TEST_A'], segments: [{ id: 'seg-x1', ...BED, ktvId: 'SEQ_TEST_A', startTime: '21:42', endTime: '23:52', duration: 130 }],
              options: { displayName: 'Ấn huyệt chân (60p) + Kết hợp 4 liệu trình (70p)', mergedServiceIds: [`${id}-g1-2`], customerGroupId: `${id}-g1` } },
            { id: `${id}-g1-2`, technicianCodes: ['SEQ_TEST_A'], segments: [{ id: 'seg-x2', ...BED, ktvId: 'SEQ_TEST_A', startTime: '21:42', endTime: '21:42', duration: 0 }],
              options: { displayName: 'Kết hợp 4 liệu trình', mergedIntoId: `${id}-g1-1`, customerGroupId: `${id}-g1` } },
        ];
        const r = await actions.saveDraftDispatch(id, { date: DATE, bedId: BED.bedId, roomName: BED.roomId, notes: '', itemUpdates: legacy });
        const s = await inspect([id]);
        const id2 = await createBooking('S10b', [['NHS0101']]);
        const r2 = await actions.saveDraftDispatch(id2, { date: DATE, bedId: BED.bedId, roomName: BED.roomId, notes: '', itemUpdates: [
            { id: `${id2}-g1-1`, technicianCodes: ['SEQ_TEST_A'], segments: [{ id: 'seg-y', ...BED, ktvId: 'SEQ_TEST_A', startTime: '21:00', endTime: '08:40', duration: 700 }], options: { displayName: 'Ấn huyệt chân chuyên nghiệp' } }] });
        console.log('\n#10 Lớp server: payload kiểu cũ (dịch vụ sau mang chặng 0 phút) + lỗi 700 phút');
        const ok = [check(r.success, 'payload cũ vẫn lưu được (server tự làm sạch)', r.error || ''), check(s.followersClean && s.timer('SEQ_TEST_A') === 130, 'dịch vụ sau sạch, đồng hồ 130', String(s.timer('SEQ_TEST_A'))), check(!r2.success && /Ấn huyệt chân.*700/.test(r2.error || ''), 'lỗi 700 phút nói rõ dịch vụ + số phút', r2.error || '')].every(Boolean);
        push({ ca: '10', nhom: 'Lớp server', cach_luu: 'payload cũ', ket_qua: ok ? 'ĐẠT' : 'HỎNG', dong_ho: `A=${s.timer('SEQ_TEST_A')}`, sau_sach: s.followersClean ? 'có' : 'KHÔNG', ghi_chu: (r2.error || '').slice(0, 70) });
    }
}

async function cleanup() {
    const all = [...new Set(created)];
    const { data: subs } = await sb.from('Bookings').select('id').in('parent_booking_id', all);
    const ids = [...new Set([...all, ...(subs || []).map((x: any) => x.id)])];
    await sb.from('BookingItems').delete().in('bookingId', ids);
    await sb.from('BookingGuests').delete().in('booking_id', ids);
    await sb.from('StaffNotifications').delete().in('bookingId', ids);
    await sb.from('Bookings').delete().in('id', ids);
    const { count } = await sb.from('Bookings').select('id', { count: 'exact', head: true }).like('id', `QA-GHEP-${RUN}%`);
    console.log(`\nDọn dữ liệu TEST: còn ${count ?? '?'} đơn QA-GHEP-${RUN}`);
}

main()
    .catch(e => { failures++; console.error(e); })
    .finally(async () => {
        console.log('\n=== BẢNG KẾT QUẢ 10 CA (DB TEST) ===');
        console.table(report);
        await cleanup().catch(e => console.error('cleanup:', e.message));
        console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG'} — ${failures} loi ===`);
        finish(failures, 60);
    })
    .catch(fatal);
