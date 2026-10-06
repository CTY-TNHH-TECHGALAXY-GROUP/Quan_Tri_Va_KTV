/**
 * QA #25 — NÚT "HỦY GỘP" trên **DB TEST**: không ảnh hưởng nhận đơn, gửi đơn, tài khoản nhân viên.
 *   - Chụp số dòng mọi bảng sổ/hàng đợi KTV trước–sau (phải không đổi).
 *   - Ghi lại mọi thông báo / push server định gửi (stub đếm lời gọi).
 *   - Đã bắt đầu → bị chặn (form + server), DB giữ nguyên.
 * Khung dùng chung với QA #23:
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
const SENT: { kind: string; a: string }[] = [];
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
    '@/lib/push-helper': { sendPushNotification: async (...a: any[]) => { SENT.push({ kind: 'push', a: JSON.stringify(a).slice(0, 120) }); return true; } },
    '@/lib/notification-helper': { createNotification: async (n: any) => { SENT.push({ kind: 'notify', a: `${n?.type} → ${n?.employeeId || 'admin'}` }); return true; } },
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
const RUN = 'U' + Date.now().toString(36).toUpperCase();
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


const { unmergeFromLeading, hasStartedWork } = require('@/app/reception/dispatch/_components/QuickDispatchTable.logic');
const { KtvCommissionService } = require('@/lib/services/KtvCommissionService');
const { updateBookingItemStatus } = actions;
const LEDGERS = ['TurnQueue', 'KtvAssignments', 'TurnLedger', 'KTVDTurnLedger', 'KTVServiceHoursLedger', 'WalletAdjustments', 'KTVBonusLedger', 'KTVPiggyBankLedger', 'StaffNotifications'];
async function snapshot() {
    const out: Record<string, number | string> = {};
    for (const t of LEDGERS) { const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true }); out[t] = error ? `lỗi: ${error.message.slice(0, 30)}` : (count ?? 0); }
    return out;
}
const T = (r: any) => (r?.success ? 'ok' : `LỖI: ${r?.error || 'không rõ'}`);
const optsOf = (i: any) => parseKtvOptions(i.options);
const row = (ca: string, luong: string, ok: boolean, chi_tiet: string) => report.push({ ca, luong, ket_qua: ok ? 'ĐẠT' : 'HỎNG', chi_tiet: chi_tiet.slice(0, 100) });
/** Bấm "Hủy gộp" trên form đúng như handleUnmergeSingle mới (kể cả chặn khi đã bắt đầu). */
function pressUnmerge(blocks: any[], leadingId: string) {
    const lead = blocks.find(b => b.id === leadingId); const kids = lead.mergedServiceIds || [];
    if (hasStartedWork(lead) || blocks.some(b => kids.includes(b.id) && hasStartedWork(b))) return { blocked: true, blocks };
    return { blocked: false, blocks: unmergeFromLeading(blocks, leadingId).map((b: any) => (b.id === leadingId || kids.includes(b.id)) ? { ...b, customerGroupId: undefined } : b) };
}
async function mergedOrder(tag: string, guests = [['NHS0101', 'NHS0040']]) {
    const id = await createBooking(tag, guests);
    let b = await loadBlocks([id]); b = assign(b, `${id}-g1-1`, ['SEQ_TEST_A'], '20:00');
    b = pressMerge(b, [`${id}-g1-1`, `${id}-g1-2`]).blocks;
    const r = await saveWhole(id, b);
    if (!r.success) throw new Error('setup ghép: ' + r.error);
    return id;
}

async function main() {
    const before = await snapshot();
    const sentStart = SENT.length;
    {   // U1
        const id = await mergedOrder('U1');
        const u = pressUnmerge(await loadBlocks([id]), `${id}-g1-1`);
        const r1 = await saveWhole(id, u.blocks); const s1 = await inspect([id]);
        const lead = s1.items.find((i: any) => i.id === `${id}-g1-1`);
        let b = assign(await loadBlocks([id]), `${id}-g1-2`, ['SEQ_TEST_B'], '21:00');
        const r2 = await saveWhole(id, b); const s2 = await inspect([id]);
        console.log('\nU1 Hủy gộp trước điều phối (lưu cả đơn) → gán KTV cho dịch vụ sau');
        const ok = [check(!u.blocked && r1.success && r2.success, 'hủy gộp + lưu', [T(r1), T(r2)].join(' / ')),
            check(s1.timer('SEQ_TEST_A') === 60, 'A trả về 60p (trước đây giữ 130p)', String(s1.timer('SEQ_TEST_A'))),
            check(optsOf(lead).displayName === 'Ấn huyệt chân chuyên nghiệp', 'tên trả về tên gốc', optsOf(lead).displayName),
            check(s1.followers.length === 0 && !(optsOf(lead).mergedServiceIds || []).length, 'dấu ghép xoá hết trong DB'),
            check(s2.timer('SEQ_TEST_B') === 70 && s2.timer('SEQ_TEST_A') === 60, 'gán B: A=60, B=70', `A=${s2.timer('SEQ_TEST_A')} B=${s2.timer('SEQ_TEST_B')}`)].every(Boolean);
        row('U1', 'Hủy gộp trước điều phối (cả đơn)', ok, `A ${s1.timer('SEQ_TEST_A')}p "${optsOf(lead).displayName}"; sau gán B=${s2.timer('SEQ_TEST_B')}`);
    }
    {   // U2
        const id = await mergedOrder('U2');
        const u = pressUnmerge(await loadBlocks([id]), `${id}-g1-1`);
        const rs = await saveRows(id, u.blocks); const s = await inspect([id]);
        const lead = s.items.find((i: any) => i.id === `${id}-g1-1`);
        console.log('\nU2 Hủy gộp rồi LƯU TỪNG DÒNG KTV');
        const ok = [check(rs.length === 1 && rs.every(r => r.success), 'lưu dòng', rs.map(T).join(' / ')),
            check(s.followers.length === 0, 'dịch vụ sau được nhả khỏi dấu ghép'), check(!(optsOf(lead).mergedServiceIds || []).length, 'dịch vụ trước hết danh sách ghép'),
            check(s.timer('SEQ_TEST_A') === 60 && optsOf(lead).displayName === 'Ấn huyệt chân chuyên nghiệp', 'A=60, tên gốc', `${s.timer('SEQ_TEST_A')} "${optsOf(lead).displayName}"`)].every(Boolean);
        row('U2', 'Hủy gộp rồi lưu từng dòng', ok, `A ${s.timer('SEQ_TEST_A')}p, dịch vụ sau ghép: ${s.followers.length}`);
    }
    {   // U3 — đã điều phối (PREPARING), KTV chưa bắt đầu: KTV nhận đơn giữ nguyên
        const id = await mergedOrder('U3');
        await sb.from('BookingItems').update({ status: 'PREPARING' }).in('id', [`${id}-g1-1`, `${id}-g1-2`]);
        await sb.from('Bookings').update({ status: 'PREPARING' }).eq('id', id);
        const techBefore = (await itemsOf(id)).find((i: any) => i.id === `${id}-g1-1`).technicianCodes;
        const u = pressUnmerge(await loadBlocks([id]), `${id}-g1-1`);
        const r = await saveWhole(id, u.blocks); const s = await inspect([id]);
        const lead = s.items.find((i: any) => i.id === `${id}-g1-1`);
        console.log('\nU3 Hủy gộp sau khi đã điều phối, KTV chưa bắt đầu');
        const ok = [check(!u.blocked && r.success, 'cho phép hủy gộp + lưu', T(r)),
            check(JSON.stringify(lead.technicianCodes) === JSON.stringify(techBefore), 'KTV nhận đơn giữ nguyên (cùng dịch vụ, cùng người)', `${JSON.stringify(techBefore)} → ${JSON.stringify(lead.technicianCodes)}`),
            check(s.timer('SEQ_TEST_A') === 60, 'đồng hồ KTV A còn 60p', String(s.timer('SEQ_TEST_A')))].every(Boolean);
        row('U3', 'Hủy gộp sau điều phối, chưa bắt đầu', ok, `KTV ${JSON.stringify(lead.technicianCodes)}, A=${s.timer('SEQ_TEST_A')}p, trạng thái ${lead.status}`);
    }
    {   // U4 — đã bắt đầu: phải bị chặn, DB giữ nguyên
        const id = await mergedOrder('U4');
        const st = await updateBookingItemStatus([`${id}-g1-1`], 'IN_PROGRESS', DATE, id, ['SEQ_TEST_A']);
        const blocks = await loadBlocks([id]);
        const u = pressUnmerge(blocks, `${id}-g1-1`);
        // Cố tình gửi bản hủy gộp vượt qua form (giả lập form cũ / lỗi giao diện) → server phải chặn.
        const forced = unmergeFromLeading(blocks, `${id}-g1-1`);
        const r = await saveWhole(id, forced); const s = await inspect([id]);
        console.log('\nU4 Hủy gộp khi KTV ĐÃ bắt đầu');
        const ok = [check(st.success, 'bắt đầu dịch vụ', T(st)), check(u.blocked, 'form chặn hủy gộp'),
            check(!r.success && /đã bắt đầu/.test(r.error || ''), 'server chặn nếu form để lọt', r.error || 'lưu được (SAI)'),
            check(s.timer('SEQ_TEST_A') === 130 && s.followers.length === 1, 'DB giữ nguyên: A 130p, vẫn ghép', `A=${s.timer('SEQ_TEST_A')} ghép=${s.followers.length}`)].every(Boolean);
        row('U4', 'Hủy gộp khi đã bắt đầu → chặn', ok, (r.error || '').slice(0, 80));
    }
    {   // U5 — tách khách khi nhóm đang ghép (nút tách khách) → hủy gộp + tách
        const id = await mergedOrder('U5', [['NHS0101', 'NHS0040'], ['NHS0101']]);
        let b = assign(await loadBlocks([id]), `${id}-g2-1`, ['SEQ_TEST_C'], '20:00');
        await saveWhole(id, b);
        b = await loadBlocks([id]);
        const u = pressUnmerge(b, `${id}-g1-1`);
        const b2 = u.blocks.map((x: any) => x.id === `${id}-g1-2` ? { ...x, customerGroupId: `${id}-g1-2` } : x);
        const r = await saveWhole(id, b2);
        const subs = await splitGuests(id, await loadBlocks([id]));
        const s = await inspect(subs);
        console.log('\nU5 Tách khách khi đang ghép (hủy gộp + tách)');
        const ok = [check(r.success, 'lưu', T(r)), check(subs.length === 3, 'tách thành 3 đơn con', subs.map((x: string) => x.split('-').pop()).join('+')),
            check(s.timer('SEQ_TEST_A') === 60 && s.timer('SEQ_TEST_C') === 60 && s.followers.length === 0, 'A=60, C=60, không còn ghép', `A=${s.timer('SEQ_TEST_A')} C=${s.timer('SEQ_TEST_C')}`)].every(Boolean);
        row('U5', 'Tách khách khi đang ghép', ok, `${subs.length} đơn con; A=${s.timer('SEQ_TEST_A')} C=${s.timer('SEQ_TEST_C')}`);
    }
    {   // U6 — tài khoản: cơ sở tính tiền tua sau hủy gộp
        const id = await mergedOrder('U6');
        const merged = (await itemsOf(id)).find((i: any) => i.id === `${id}-g1-1`);
        const basisMerged = KtvCommissionService.calculateItemExpectedDuration(merged, 'SEQ_TEST_A', 60);
        const u = pressUnmerge(await loadBlocks([id]), `${id}-g1-1`); await saveWhole(id, u.blocks);
        const after = (await itemsOf(id)).find((i: any) => i.id === `${id}-g1-1`);
        const basisAfter = KtvCommissionService.calculateItemExpectedDuration(after, 'SEQ_TEST_A', 60);
        const follow = (await itemsOf(id)).find((i: any) => i.id === `${id}-g1-2`);
        console.log('\nU6 Cơ sở tính tiền tua của KTV (KtvCommissionService)');
        const ok = [check(basisMerged === 130 && basisAfter === 60, 'phút tính tua: ghép 130 → hủy gộp 60', `${basisMerged} → ${basisAfter}`),
            check(!(follow.technicianCodes || []).length, 'dịch vụ sau chưa có ai được tính tiền')].every(Boolean);
        row('U6', 'Cơ sở tiền tua sau hủy gộp', ok, `${basisMerged}p → ${basisAfter}p`);
    }
    const after = await snapshot();
    const allIds = [...new Set(created)];
    const { data: subIds } = await sb.from('Bookings').select('id').in('parent_booking_id', allIds);
    const { data: notes } = await sb.from('StaffNotifications').select('bookingId, type, employeeId, message, createdAt')
        .in('bookingId', [...allIds, ...(subIds || []).map((x: any) => x.id)]).order('createdAt');
    console.log('\nThông báo DB tự sinh cho đơn test:');
    console.table((notes || []).map((n: any) => ({ don: String(n.bookingId).split('-').slice(-1)[0] + ' ' + String(n.bookingId).split('-').slice(-2, -1)[0], loai: n.type, nguoi_nhan: n.employeeId || 'admin', noi_dung: String(n.message || '').slice(0, 70) })));
    // StaffNotifications: trigger DB tự sinh 1 "NEW_ORDER" cho admin mỗi khi CÓ ĐƠN MỚI (dữ liệu test + đơn con khi tách) —
    // không liên quan hủy gộp. Hợp lệ khi phần tăng = đúng số NEW_ORDER của đơn test và KHÔNG có thông báo nào tới KTV.
    const newOrderCount = (notes || []).filter((n: any) => n.type === 'NEW_ORDER' && !n.employeeId).length;
    const toKtv = (notes || []).filter((n: any) => n.employeeId);
    const diff = LEDGERS.filter(t => t === 'StaffNotifications'
        ? Number(after[t]) - Number(before[t]) !== newOrderCount
        : before[t] !== after[t]).map(t => `${t}: ${before[t]}→${after[t]}`);
    const sent = SENT.slice(sentStart);
    console.log('\nSổ / hàng đợi KTV trước–sau:', JSON.stringify(before), '\n→', JSON.stringify(after));
    console.log('Thông báo / push server định gửi:', sent.length ? JSON.stringify(sent) : 'không có');
    const ok7 = [check(diff.length === 0, 'không bảng sổ / hàng đợi KTV nào thay đổi số dòng', diff.join('; ') || 'không đổi'),
        check(sent.length === 0 && toKtv.length === 0, 'không thông báo / push nào tới KTV', JSON.stringify([...sent, ...toKtv.map((n: any) => n.employeeId)]))].every(Boolean);
    row('U7', 'Sổ KTV + thông báo trong toàn bộ U1–U6', ok7, diff.join('; ') || `sổ KTV không đổi; tới KTV: ${toKtv.length}; NEW_ORDER admin do tạo đơn: ${newOrderCount}`);
}

async function itemsOf(id: string) { const { data } = await sb.from('BookingItems').select('*').eq('bookingId', id).order('id'); return data || []; }

async function cleanup() {
    const all = [...new Set(created)];
    const { data: subs } = await sb.from('Bookings').select('id').in('parent_booking_id', all);
    const ids = [...new Set([...all, ...(subs || []).map((x: any) => x.id)])];
    await sb.from('BookingItems').delete().in('bookingId', ids);
    await sb.from('BookingGuests').delete().in('booking_id', ids);
    await sb.from('StaffNotifications').delete().in('bookingId', ids);
    await sb.from('Bookings').delete().in('id', ids);
    const { count } = await sb.from('Bookings').select('id', { count: 'exact', head: true }).in('id', ids);
    console.log(`\nDọn dữ liệu TEST: còn ${count ?? '?'} đơn`);
}

main()
    .catch(e => { failures++; console.error(e); })
    .finally(async () => {
        console.log('\n=== BẢNG KẾT QUẢ HỦY GỘP (DB TEST) ===');
        console.table(report);
        await cleanup().catch(e => console.error('cleanup:', e.message));
        console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG'} — ${failures} loi ===`);
        finish(failures, 60);
    })
    .catch(fatal);
