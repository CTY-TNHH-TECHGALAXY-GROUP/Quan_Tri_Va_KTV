/**
 * QA #27 — CHUẨN HOÁ segments (trigger aa_normalize_segments) trên **DB TEST**: đúng lỗi gốc + các lần ghi chuỗi của app.
 *   P1 Thêm dịch vụ phát sinh → gán KTV → lưu (trước đây: cannot extract elements from a scalar).
 *   P2 Quầy bắt đầu / hoàn tất (code ghi chuỗi) → DB lưu MẢNG, trạng thái đúng.
 *   P3 Huỷ đơn (cancelBooking ghi chuỗi) → DB lưu MẢNG.
 *   P4 Ghi chuỗi thẳng như app KTV (handleStart/Finish, review) → DB lưu MẢNG, nội dung giữ nguyên.
 * Mục tiêu: chứng minh hai thay đổi KHÔNG làm lệch luồng khác (CLAUDE.md 4.5 — vùng nổ).
 * Phần dưới dùng chung khung với QA #23:
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
const RUN = 'P' + Date.now().toString(36).toUpperCase();
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
        results.push(await actions.saveDispatchForm(bookingId, item.id, item.staffList, revision, false, item.displayName, false, followingIds));
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


const { BookingModificationService } = require('@/lib/services/BookingModificationService');
const { unmergeServicesAction, saveSequentialPair, updateBookingItemStatus, getDispatchData } = actions;
const createdCustomers: string[] = [];
const T = (r: any) => (r?.success ? 'ok' : `LỖI: ${r?.error || 'không rõ'}`);
async function itemsOf(id: string) { const { data } = await sb.from('BookingItems').select('*').in('bookingId', [id]).order('id'); return data || []; }
const optsOf = (i: any) => parseKtvOptions(i.options);
const row = (ca: string, luong: string, ok: boolean, chi_tiet: string) => report.push({ ca, luong, ket_qua: ok ? 'ĐẠT' : 'HỎNG', chi_tiet: chi_tiet.slice(0, 95) });


const segType = async (itemId: string) => {
    const { data } = await sb.rpc('jsonb_typeof_probe', {}).then(() => ({ data: null })).catch(() => ({ data: null }));
    void data;
    const r = await sb.from('BookingItems').select('segments').eq('id', itemId).single();
    return Array.isArray(r.data?.segments) ? 'array' : typeof r.data?.segments;
};
async function main() {
    {   // P1
        const id = await createBooking('P1', [['NHS0101']]);
        const add = await BookingModificationService.addAddonServices(id, [{ serviceId: 'NHS0040', qty: 1 }], 'QA');
        const addon = (await itemsOf(id)).find((i: any) => i.id.includes('-addon-'));
        const t0 = await segType(addon.id);
        let b = await loadBlocks([id]); b = assign(b, addon.id, ['SEQ_TEST_B'], '21:00');
        const r = await saveWhole(id, b); const s = await inspect([id]);
        console.log('\nP1 Thêm phát sinh → gán KTV → lưu');
        const ok = [check(add.success, 'thêm phát sinh', T(add)), check(t0 === 'array', 'phát sinh mới lưu dạng mảng (code ghi chuỗi)', t0),
            check(r.success, 'gán KTV + lưu ĐƯỢC (trước đây lỗi scalar)', T(r)), check(s.timer('SEQ_TEST_B') === 70, 'KTV B nhận 70p', String(s.timer('SEQ_TEST_B')))].every(Boolean);
        row('P1', 'Phát sinh → gán KTV → lưu', ok, `${T(r)}; B=${s.timer('SEQ_TEST_B')}p`);
    }
    {   // P2
        const id = await createBooking('P2', [['NHS0101']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '20:00');
        const r1 = await saveWhole(id, b);
        const r2 = await updateBookingItemStatus([`${id}-g1-1`], 'IN_PROGRESS', DATE, id, ['SEQ_TEST_A']);
        const t1 = await segType(`${id}-g1-1`);
        const r3 = await updateBookingItemStatus([`${id}-g1-1`], 'DONE', DATE, id, ['SEQ_TEST_A']);
        const it = (await itemsOf(id))[0]; const t2 = await segType(`${id}-g1-1`);
        console.log('\nP2 Quầy bắt đầu → hoàn tất');
        const ok = [check(r1.success && r2.success && r3.success, 'các bước', [T(r1), T(r2), T(r3)].join(' / ')),
            check(t1 === 'array' && t2 === 'array', 'sau bắt đầu / hoàn tất vẫn lưu mảng', `${t1}, ${t2}`),
            check(it.status === 'DONE' && !!parseKtvSegments(it.segments)[0]?.actualStartTime, 'DONE, giữ giờ bắt đầu', it.status)].every(Boolean);
        row('P2', 'Bắt đầu → hoàn tất', ok, `${it.status}, kiểu ${t2}`);
    }
    {   // P3
        const id = await createBooking('P3', [['NHS0101']]);
        let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '20:00');
        await saveWhole(id, b);
        const r = await actions.cancelBooking(id, DATE, 'NONE', 'QA chuẩn hoá');
        const it = (await itemsOf(id))[0]; const t = await segType(`${id}-g1-1`);
        console.log('\nP3 Huỷ đơn');
        const ok = [check(r.success, 'huỷ', T(r)), check(it.status === 'CANCELLED' && t === 'array', 'CANCELLED, lưu mảng', `${it.status}, ${t}`)].every(Boolean);
        row('P3', 'Huỷ đơn', ok, `${it.status}, kiểu ${t}`);
    }
    {   // P4
        const id = await createBooking('P4', [['NHS0101']]);
        const seg = [{ id: 'sx', ktvId: 'SEQ_TEST_A', startTime: '20:00', endTime: '21:00', duration: 60, actualStartTime: new Date().toISOString() }];
        const { error } = await sb.from('BookingItems').update({ segments: JSON.stringify(seg), status: 'IN_PROGRESS' }).eq('id', `${id}-g1-1`);
        const it = (await itemsOf(id))[0]; const t = await segType(`${id}-g1-1`);
        console.log('\nP4 Ghi chuỗi như app KTV (handleStartTimer)');
        const ok = [check(!error, 'ghi được', error?.message || ''), check(t === 'array' && it.segments.length === 1 && Object.entries(seg[0]).every(([k, v]) => it.segments[0][k] === v), 'lưu mảng, nội dung giữ nguyên (so từng khoá — jsonb tự sắp thứ tự khoá)', t)].every(Boolean);
        row('P4', 'App KTV ghi chuỗi', ok, `kiểu ${t}`);
    }
}
async function cleanupTmp() {
    const ids = [...new Set(created)];
    await sb.from('BookingItems').delete().in('bookingId', ids); await sb.from('BookingGuests').delete().in('booking_id', ids);
    await sb.from('StaffNotifications').delete().in('bookingId', ids); await sb.from('Bookings').delete().in('id', ids);
    console.log(`\nDọn: ${ids.length} đơn test`);
}
main().catch(e => { failures++; console.error(e); }).finally(async () => {
    console.log('\n=== BẢNG KẾT QUẢ CHUẨN HOÁ (DB TEST) ==='); console.table(report);
    await cleanupTmp().catch(e => console.error(e.message));
    console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG'} — ${failures} loi ===`); finish(failures, 60);
}).catch(fatal);
