/**
 * QA #29 — HUỶ KHI CÓ TRANH CHẤP trên **DB TEST**: 10 tình huống người khác thao tác đúng lúc quầy bấm huỷ
 * (máy quầy khác lưu / huỷ, KTV bắt đầu / nhận / từ chối / bàn giao, double click). Dùng chung khung của qa_28.
 *
 * - Phía KTV + API quầy: gọi HTTP THẬT vào app đang chạy (`next dev -p 3100` của worktree, .env.local = DB TEST),
 *   cookie đăng nhập Supabase THẬT của tài khoản thử (seq_a/seq_b/seq_c, seq_admin).
 * - Phía quầy (server action): gọi đúng hàm thật trong process này, chỉ thay đăng nhập/cache/thông báo của Next.
 * - Ảnh: JPEG thật (đúng chữ ký FF D8 FF) — đi qua kiểm tra ảnh của server.
 * - Chụp trước mọi dòng của KTV thử ở 40+ bảng sổ/hàng đợi; xong test xoá dòng mới + khôi phục dòng cũ đã đổi.
 *
 * AN TOÀN: dừng nếu URL không phải TEST (eknggruuiuadwldacpmb). Không bao giờ in mật khẩu.
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_29_huy_tranh_chap_test_db.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import Module from 'module';

const TEST_REF = 'eknggruuiuadwldacpmb';
const ROOT = path.join(__dirname, '../..');
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
}
if (!String(process.env.NEXT_PUBLIC_SUPABASE_URL).includes(TEST_REF)) throw new Error('DỪNG: không phải DB TEST');

const STUBS: Record<string, any> = {
    '@/lib/auth-server': { requirePermission: async () => true, requirePermissionAny: async () => true,
        requireBusinessUser: async () => ({ techCode: 'seq_admin', businessUserId: 'seq_admin', username: 'seq_admin', role: 'ADMIN', permissions: [] }),
        authErrorResponse: () => null },
    'next/cache': { unstable_noStore: () => {}, revalidatePath: () => {} },
    'next/server': { after: (fn: any) => { try { const r = typeof fn === 'function' ? fn() : fn; r?.catch?.(() => {}); } catch { /* */ } }, NextResponse: { json: (b: any) => b } },
    'next/headers': { headers: async () => new Map(), cookies: async () => ({ get: () => undefined, getAll: () => [] }) },
    '@/lib/push-helper': { sendPushNotification: async () => true },
    '@/lib/notification-helper': { createNotification: async () => true },
    'server-only': {},
};
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) { return STUBS[request] ?? originalLoad.call(this, request, ...rest); };

/* eslint-disable @typescript-eslint/no-require-imports */
const actions = require('@/app/reception/dispatch/actions');
const webActions = require('@/app/reception/web-booking/actions');
const { getSupabaseAdmin } = require('@/lib/supabaseAdmin');
const { toBusinessDate, DEFAULT_DAY_CUTOFF_HOURS } = require('@/lib/business-date');
const { parseKtvSegments, parseKtvOptions } = require('@/lib/ktvUtils');
const { mergeServicesIntoParent } = require('@/app/reception/dispatch/_components/QuickDispatchTable.logic');
const ms = require('@/lib/dispatch/merged-service');
const { createServerClient } = require('@supabase/ssr');
const { Client } = require('pg');
/* eslint-enable @typescript-eslint/no-require-imports */

const BASE = 'http://localhost:3100';
/** QA_TRIGGER_OFF=1: tắt trigger aa_normalize_segments cả lượt chạy (mô phỏng lùi bằng DROP TRIGGER); tự bật lại khi xong. */
const TRIGGER_OFF = process.env.QA_TRIGGER_OFF === '1';
/** QA_CROSS_MIDNIGHT=1: chỉ chạy F01 + F19 (bắt đầu trước 00:00, đổi/huỷ sau 00:00). Khởi chạy 23:50–23:58 giờ VN. */
const CROSS_MIDNIGHT = process.env.QA_CROSS_MIDNIGHT === '1';
const SKIP_REST = 'SKIP_REST_AFTER_F19';
const sb = getSupabaseAdmin();
const NOW = new Date();
const DATE: string = toBusinessDate(NOW, DEFAULT_DAY_CUTOFF_HOURS);
const KTV = { A: 'SEQ_TEST_A', B: 'SEQ_TEST_B', C: 'SEQ_TEST_C', D: 'SEQ_TEST_KD' };
const ALL_KTV = Object.values(KTV);
const ROOM = 'SEQ_TEST_ROOM';
const BEDS = ['SEQ_TEST_BED_1', 'SEQ_TEST_BED_2', 'SEQ_TEST_BED_3'];
const SVC: Record<string, { name: string; duration: number }> = {
    NHS0101: { name: 'Ấn huyệt chân chuyên nghiệp', duration: 60 },
    NHS0040: { name: 'Kết hợp 4 liệu trình', duration: 70 },
};
// JPEG thật nhỏ (FF D8 FF ... FF D9).
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const createdBookings: string[] = [];
const createdCustomers: string[] = [];
const report: { flow: string; ok: number; fail: number; notes: string[] }[] = [];
let cur: { flow: string; ok: number; fail: number; notes: string[] };
function flow(name: string) { cur = { flow: name, ok: 0, fail: 0, notes: [] }; report.push(cur); console.log(`\n=== ${name} ===`); }
function check(ok: boolean, label: string, detail: any = '') {
    const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${d ? ` — ${d.slice(0, 300)}` : ''}`);
    if (ok) cur.ok++; else { cur.fail++; cur.notes.push(`${label}: ${d.slice(0, 160)}`); }
    return ok;
}
const note = (s: string) => { console.log(`  [INFO] ${s}`); cur.notes.push(s); };

/* ---------- thời gian ---------- */
const vnHHMM = (d = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const addMin = (hhmm: string, m: number) => { const [h, mm] = hhmm.split(':').map(Number); const t = ((h * 60 + mm + m) % 1440 + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ---------- HTTP thật ---------- */
const cookies: Record<string, string> = {};
async function login(key: string, username: string, password: string) {
    const jar = new Map<string, string>();
    const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
            setAll: (cs: any[]) => cs.forEach(c => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))) } });
    let { error } = await client.auth.signInWithPassword({ email: `${username}@nganhaspa.internal`.toLowerCase(), password });
    if (error) {
        // Đúng nhánh auto-heal của app/login/actions.ts: tài khoản có ở Users nhưng chưa có ở Auth.
        const u = (await sb.from("Users").select("*").eq("username", username).eq("password", password).single()).data;
        if (u) {
            const { ensureAuthUser } = require("@/lib/auth-sync");
            await ensureAuthUser(sb, username, password, { business_user_id: u.id, techCode: u.code || u.id, role: u.role || "TECHNICIAN", fullName: u.fullName || username });
            ({ error } = await client.auth.signInWithPassword({ email: `${username}@nganhaspa.internal`.toLowerCase(), password }));
        }
    }
    if (error) throw new Error(`Đăng nhập ${username} thất bại: ${error.message}`);
    cookies[key] = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
}
async function http(who: string, method: string, url: string, body?: any) {
    const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', cookie: cookies[who] || '' },
        body: body ? JSON.stringify(body) : undefined });
    let json: any = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
    return { status: res.status, ...json };
}
const ktvPatch = (who: string, ktv: string, body: any) => http(who, 'PATCH', `/api/ktv/booking?techCode=${ktv}`, { techCode: ktv, ...body });

/* ---------- DB đọc ---------- */
async function items(bookingId: string) {
    const { data, error } = await sb.from('BookingItems').select('*').eq('bookingId', bookingId).order('id');
    if (error) throw error;
    return data as any[];
}
async function booking(bookingId: string) { return (await sb.from('Bookings').select('*').eq('id', bookingId).single()).data as any; }
async function ledger(bookingId: string) { return ((await sb.from('TurnLedger').select('employee_id, source, is_punished').eq('booking_id', bookingId)).data || []) as any[]; }
async function queue(ktv: string) { return (await sb.from('TurnQueue').select('status, current_order_id, turns_completed').eq('employee_id', ktv).eq('date', DATE).maybeSingle()).data as any; }
async function assigns(bookingId: string) { return ((await sb.from('KtvAssignments').select('employee_id, status, booking_item_id').eq('booking_id', bookingId)).data || []) as any[]; }
async function segTypes(bookingId: string) {
    const c = await pgc();
    const r = await c.query(`SELECT id, jsonb_typeof(segments) t FROM "BookingItems" WHERE "bookingId" = $1`, [bookingId]);
    return r.rows as { id: string; t: string }[];
}
let _pg: any = null;
async function pgc() { if (!_pg) { _pg = new Client({ connectionString: process.env.QA_USE_POOLER === "1" ? process.env.DATABASE_URL : process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } }); _pg.on("error", (e: any) => { console.error(`  [INFO] mất kết nối DB, nối lại: ${e.message}`); _pg = null; }); await _pg.connect(); } return _pg; }

/* ---------- quầy: tạo + gửi đơn ---------- */
async function quickBooking(tag: string, serviceIds: string[], guestCount = 1) {
    const res = await actions.createQuickBooking({ customerName: `QA E2E ${tag}`, customerPhone: `0900${String(Date.now()).slice(-6)}`,
        serviceIds, bookingDate: DATE, guestCount, isTestOrder: true });
    if (!res?.success || !res.bookingId) throw new Error(`Tạo đơn ${tag} lỗi: ${res?.error}`);
    createdBookings.push(res.bookingId);
    if (res.customerId) createdCustomers.push(res.customerId);
    return res;
}
type Plan = { itemId: string; ktvs: string[]; bed?: string; start?: string; minutes?: number; follower?: boolean; extraOptions?: any };
async function dispatch(bookingId: string, plans: Plan[], extra: any = {}) {
    const its = await items(bookingId);
    const start = vnHHMM();
    const staffAssignments: any[] = [];
    const itemUpdates = plans.map((p, idx) => {
        const it = its.find(i => i.id === p.itemId)!;
        const o = parseKtvOptions(it.options);
        const dur = p.minutes ?? (SVC[it.serviceId]?.duration || 60);
        const bed = p.bed || BEDS[0];
        const segs = p.follower ? [] : p.ktvs.map((k, i) => ({ id: `seg-${it.id}-${k}-${i}`, ktvId: k, roomId: ROOM, bedId: bed,
            startTime: p.start || start, endTime: addMin(p.start || start, dur), duration: dur }));
        segs.forEach(s => staffAssignments.push({ ktvId: s.ktvId, bookingItemId: it.id, roomId: ROOM, bedId: bed, turnsCompleted: 0, queuePos: 0, startTime: s.startTime, endTime: s.endTime }));
        return { id: it.id, roomName: ROOM, bedId: bed, technicianCodes: p.follower ? [] : p.ktvs,
            status: (p.follower || !p.ktvs.length) ? 'WAITING' : 'PREPARING', segments: segs,
            options: { ...o, displayName: o.displayName || SVC[it.serviceId]?.name, mergedIntoId: null, order: idx, ...(p.extraOptions || {}) } };
    });
    const payload = (confirmed: string[] = [], overlap: string[] = []) => actions.processDispatch(bookingId, {
        status: 'PREPARING', bedId: itemUpdates[0]?.bedId, roomName: ROOM, staffAssignments, date: DATE, notes: '',
        itemUpdates, confirmedUncheckedKtvIds: confirmed, confirmedOverlapItemIds: overlap, ...extra });
    let res = await payload(extra.confirmedUncheckedKtvIds || []);
    const overlap: string[] = [];
    let guard = 0;
    while (res?.code === 'OVERLAP_CONFIRM_REQUIRED' && guard++ < 5) { overlap.push(res.itemId); res = await payload(extra.confirmedUncheckedKtvIds || [], overlap); }
    return res;
}

/* ---------- KTV: một vòng đầy đủ ---------- */
async function ktvAcceptAndStart(who: string, ktv: string, bookingId: string, itemId: string, opts: { slipper?: boolean; targetSegmentId?: string } = {}) {
    const g = await http(who, 'GET', `/api/ktv/booking?techCode=${ktv}`);
    const seen = JSON.stringify(g).includes(bookingId);
    check(seen, `${ktv} mở app thấy đơn`, seen ? '' : JSON.stringify(g).slice(0, 200));
    const acc = await http(who, 'POST', '/api/ktv/accept-order', { staffId: ktv, bookingItemId: itemId });
    check(acc.success === true, `${ktv} bấm "Đã nhận đơn"`, acc.error || '');
    const ready = await ktvPatch(who, ktv, { bookingId, status: 'READY' });
    check(ready.success === true, `${ktv} READY`, ready.error || '');
    const st = await ktvPatch(who, ktv, { bookingId, status: 'IN_PROGRESS', action: 'START_TIMER', startPhotoBase64: JPEG,
        guestSlipperPhotoBase64: opts.slipper === false ? undefined : JPEG, targetSegmentId: opts.targetSegmentId });
    check(st.success === true, `${ktv} bắt đầu (ảnh bắt đầu + ảnh dép)`, st.error || '');
    return st;
}
async function ktvFinish(who: string, ktv: string, bookingId: string) {
    const r = await ktvPatch(who, ktv, { bookingId, status: 'CLEANING' });
    check(r.success === true, `${ktv} bấm Hoàn tất`, r.error || '');
    return r;
}
async function ktvReviewRelease(who: string, ktv: string, bookingId: string, itemIds: string[]) {
    const rv = await http(who, 'POST', '/api/ktv/review', { bookingId, notes: 'QA E2E: khách hài lòng', techCode: ktv });
    check(rv.success === true, `${ktv} gửi đánh giá khách`, rv.error || '');
    const rl = await ktvPatch(who, ktv, { bookingId, status: 'FEEDBACK', action: 'RELEASE_KTV', handoverItemIds: itemIds, photosBase64: [JPEG] });
    check(rl.success === true, `${ktv} bàn giao phòng (ảnh)`, rl.error || '');
}
async function expectSegArrays(bookingId: string) {
    const t = await segTypes(bookingId);
    if (TRIGGER_OFF) {
        // Không có trigger: chuỗi được phép, nhưng mọi dòng phải đọc ra được mảng chặng.
        const rows = await items(bookingId);
        const bad = rows.filter(r => r.segments != null && !Array.isArray(parseKtvSegments(r.segments)));
        check(bad.length === 0, 'chặng đọc được (không trigger)', bad.map(b => b.id).join(','));
        return;
    }
    const bad = t.filter(x => x.t === 'string');
    check(bad.length === 0, 'cột chặng luôn là mảng (trigger chuẩn hoá)', bad.map(b => b.id).join(','));
}
/** Biến chặng của dịch vụ thành CHUỖI JSON như 63 dòng "đang làm" còn trên prod (bỏ qua trigger chỉ cho lệnh này). */
async function makeLegacyString(itemId: string) {
    const c = await pgc();
    await c.query('BEGIN');
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(`UPDATE "BookingItems" SET segments = to_jsonb(segments::text) WHERE id = $1 AND jsonb_typeof(segments) = 'array'`, [itemId]);
    await c.query('COMMIT');
    const t = (await c.query(`SELECT jsonb_typeof(segments) t FROM "BookingItems" WHERE id=$1`, [itemId])).rows[0]?.t;
    check(t === 'string', 'dựng dữ liệu cũ: chặng lưu dạng chuỗi', t);
}

async function fullCycle(who: string, ktv: string, tag: string, bed: string) {
    const q = await quickBooking(tag, ['NHS0101']); const it = (await items(q.bookingId))[0].id;
    let r = await dispatch(q.bookingId, [{ itemId: it, ktvs: [ktv], bed }]);
    if (r?.code === 'NEED_CHECKIN_CONFIRM') { note(`${ktv}: quầy được hỏi xác nhận điểm danh (${JSON.stringify(r.ktvs)})`); r = await dispatch(q.bookingId, [{ itemId: it, ktvs: [ktv], bed }], { confirmedUncheckedKtvIds: [ktv] }); }
    check(r.success === true, `gửi đơn cho ${ktv}`, r.error || r.code || '');
    const l0 = await ledger(q.bookingId); note(`tua khi gửi: ${JSON.stringify(l0)}`);
    await ktvAcceptAndStart(who, ktv, q.bookingId, it);
    check((await items(q.bookingId))[0].status === 'IN_PROGRESS', 'dịch vụ IN_PROGRESS');
    await ktvFinish(who, ktv, q.bookingId);
    await ktvReviewRelease(who, ktv, q.bookingId, [it]);
    const rr = await actions.submitCustomerRating(q.bookingId, 5); check(rr.success === true, 'khách chấm 5', rr.error || '');
    await wait(1000);
    check((await items(q.bookingId))[0].status === 'DONE', 'dịch vụ DONE', (await items(q.bookingId))[0].status);
    await expectSegArrays(q.bookingId);
    return { bookingId: q.bookingId, itemId: it };
}

async function swap(itemId: string, from: string, to: string) {
    const pz = await http('admin', 'POST', '/api/ktv/pause-swap-resume', { action: 'PAUSE', bookingItemId: itemId, employeeId: from });
    check(pz.success === true, `quầy tạm ngưng trước khi đổi ${from}`, pz.error || '');
    const sw = await http('admin', 'POST', '/api/ktv/pause-swap-resume', { action: 'SWAP', bookingItemId: itemId, oldKtvId: from, newKtvId: to, businessDate: DATE, swapReason: 'QA E2E đổi người' });
    check(sw.success === true, `quầy đổi ${from} → ${to}`, sw.error || '');
    return sw;
}
async function startAfterSwap(who: string, ktv: string, bookingId: string, itemId: string) {
    const g = await http(who, 'GET', `/api/ktv/booking?techCode=${ktv}`);
    check(JSON.stringify(g).includes(bookingId), `${ktv} mở app thấy đơn được đổi sang`);
    await http(who, 'POST', '/api/ktv/accept-order', { staffId: ktv, bookingItemId: itemId });
    await ktvPatch(who, ktv, { bookingId, status: 'READY' });
    const st = await ktvPatch(who, ktv, { bookingId, status: 'IN_PROGRESS', action: 'START_TIMER', startPhotoBase64: JPEG });
    check(st.success === true, `${ktv} bấm Bắt đầu sau khi đổi`, st.error || '');
    return st.success === true;
}
const segOf = async (itemId: string, ktv: string) => parseKtvSegments((await sb.from('BookingItems').select('segments').eq('id', itemId).single()).data?.segments).filter((x: any) => x.ktvId === ktv);

/* ---------- chụp trước / khôi phục ---------- */
type Snap = { table: string; cols: string[]; pk: string[]; rows: Map<string, any> };
let snaps: Snap[] = [];
const EMP_COLS = ['employeeId', 'employee_id', 'ktv_id', 'staff_id', 'technicianCode'];
const BK_COLS = ['bookingId', 'booking_id', 'current_order_id'];
async function snapshot() {
    const c = await pgc();
    const r = await c.query(`SELECT c.table_name, array_agg(c.column_name::text) cols FROM information_schema.columns c
        JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND c.column_name = ANY($1) GROUP BY 1`, [EMP_COLS]);
    snaps = [];
    for (const row of r.rows) {
        const pk = (await c.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = ('public."' || $1 || '"')::regclass AND i.indisprimary`, [row.table_name])).rows.map((x: any) => x.attname);
        if (!pk.length) continue;
        const where = row.cols.map((col: string) => `"${col}"::text = ANY($1)`).join(' OR ');
        const data = (await c.query(`SELECT * FROM "${row.table_name}" WHERE ${where}`, [ALL_KTV])).rows;
        const m = new Map<string, any>();
        data.forEach((d: any) => m.set(pk.map((k: string) => String(d[k])).join('|'), d));
        snaps.push({ table: row.table_name, cols: row.cols, pk, rows: m });
    }
    const staff = (await c.query(`SELECT * FROM "Staff" WHERE id = ANY($1)`, [ALL_KTV])).rows;
    snaps.push({ table: 'Staff', cols: ['id'], pk: ['id'], rows: new Map(staff.map((s: any) => [s.id, s])) });
}
async function restore() {
    const c = await pgc();
    const out: any[] = [];
    // 1) dữ liệu theo đơn thử
    const ids = createdBookings;
    if (ids.length) {
        const itemIds = (await c.query(`SELECT id FROM "BookingItems" WHERE "bookingId" = ANY($1)`, [ids])).rows.map((x: any) => x.id);
        const refs = (await c.query(`SELECT table_name, column_name FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
            WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND column_name = ANY($1) AND table_name NOT IN ('Bookings','BookingItems','BookingGuests')`,
            [[...BK_COLS, 'booking_item_id', 'bookingItemId']])).rows;
        for (let pass = 0; pass < 3; pass++) {
            for (const r of refs) {
                const vals = /item/i.test(r.column_name) ? itemIds : ids;
                if (!vals.length) continue;
                try {
                    if (r.column_name === 'current_order_id') await c.query(`UPDATE "${r.table_name}" SET current_order_id = NULL WHERE current_order_id = ANY($1)`, [ids]);
                    else { const d = await c.query(`DELETE FROM "${r.table_name}" WHERE "${r.column_name}"::text = ANY($1)`, [vals]); if (d.rowCount) out.push(`${r.table_name}: -${d.rowCount}`); }
                } catch { /* FK: thử lại lượt sau */ }
            }
        }
        await c.query(`DELETE FROM "BookingItems" WHERE "bookingId" = ANY($1)`, [ids]);
        await c.query(`DELETE FROM "BookingGuests" WHERE booking_id = ANY($1)`, [ids]).catch(() => {});
        const b = await c.query(`DELETE FROM "Bookings" WHERE id = ANY($1) OR parent_booking_id = ANY($1)`, [ids]);
        out.push(`Bookings: -${b.rowCount}`);
    }
    if (createdCustomers.length) { const d = await c.query(`DELETE FROM "Customers" WHERE id = ANY($1)`, [createdCustomers]).catch((e: any) => ({ rowCount: `lỗi ${e.message}` })); out.push(`Customers: -${d.rowCount}`); }
    // 2) dòng của KTV thử: xoá dòng mới, khôi phục dòng cũ đã đổi
    for (let pass = 0; pass < 3; pass++) {
        for (const s of snaps) {
            const where = s.cols.map(col => `"${col}"::text = ANY($1)`).join(' OR ');
            let now: any[] = [];
            try { now = (await c.query(`SELECT * FROM "${s.table}" WHERE ${where}`, [ALL_KTV])).rows; } catch { continue; }
            for (const row of now) {
                const key = s.pk.map(k => String(row[k])).join('|');
                const pkWhere = s.pk.map((k, i) => `"${k}"::text = $${i + 1}`).join(' AND ');
                const pkVals = s.pk.map(k => String(row[k]));
                const old = s.rows.get(key);
                try {
                    if (!old) { await c.query(`DELETE FROM "${s.table}" WHERE ${pkWhere}`, pkVals); out.push(`${s.table}: -1 mới`); }
                    else if (JSON.stringify(old) !== JSON.stringify(row)) {
                        const cols = Object.keys(old).filter(k => !s.pk.includes(k));
                        await c.query(`UPDATE "${s.table}" SET ${cols.map((k, i) => `"${k}" = $${i + 1 + pkVals.length}`).join(', ')} WHERE ${pkWhere}`,
                            [...pkVals, ...cols.map(k => (old[k] !== null && typeof old[k] === 'object' && !(old[k] instanceof Date) && !Array.isArray(old[k]) ? JSON.stringify(old[k]) : old[k]))]);
                        out.push(`${s.table}: khôi phục ${key}`);
                    }
                } catch (e: any) { if (pass === 2) out.push(`${s.table}: lỗi ${e.message.slice(0, 80)}`); }
            }
        }
    }
    return out;
}

/* ---------- các luồng ---------- */
async function main() {
    console.log(`DB TEST · ngày làm việc ${DATE} · giờ VN ${vnHHMM()} · app ${BASE}`);
    const creds = JSON.parse(fs.readFileSync(process.env.QA_CREDS || '', 'utf8'));
    // Always go through pgc() so a dropped pooler connection is replaced instead of killing the run.
    await pgc();
    const c = { query: async (...a: any[]) => (await pgc()).query(...a), end: async () => _pg?.end() } as any;
    const pw = Object.fromEntries((await c.query(`SELECT username, password FROM "Users" WHERE username IN ('seq_admin','seq_b','seq_c','seq_kd')`)).rows.map((r: any) => [r.username, r.password]));
    await login('admin', 'seq_admin', pw.seq_admin);
    await login('A', creds.ktv.u, creds.ktv.p);
    await login('B', 'seq_b', pw.seq_b);
    await login('C', 'seq_c', pw.seq_c);
    await login('D', 'seq_kd', pw.seq_kd);
    await snapshot();
    if (TRIGGER_OFF) {
        await c.query('ALTER TABLE "BookingItems" DISABLE TRIGGER aa_normalize_segments');
        console.log('⚠️  ĐÃ TẮT trigger aa_normalize_segments trên DB TEST cho lượt chạy này');
        // Bị ngắt (Ctrl+C / hết giờ) thì vẫn bật lại trigger trước khi thoát.
        for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, async () => {
            try { await c.query('ALTER TABLE "BookingItems" ENABLE TRIGGER aa_normalize_segments'); console.error('↩️  đã bật lại trigger trước khi thoát'); } finally { process.exit(130); }
        });
    }
    console.log(`Chụp trước: ${snaps.length} bảng, ${snaps.reduce((s, x) => s + x.rows.size, 0)} dòng của KTV thử`);
    // KtvAssignments ACTIVE từ ngày cũ của KTV thử làm app KTV mở nhầm đơn cũ → tạm đóng (sẽ khôi phục).
    await c.query(`UPDATE "KtvAssignments" SET status='COMPLETED' WHERE employee_id = ANY($1) AND status IN ('ACTIVE','QUEUED','READY')`, [ALL_KTV]);
    await c.query(`UPDATE "TurnQueue" SET status='waiting', current_order_id=NULL WHERE employee_id = ANY($1) AND status='working'`, [ALL_KTV]);

    try {
        /* F01 */ flow('F01 Điểm danh vào ca (A, B, C)');
        for (const k of ['A', 'B', 'C'] as const) {
            const r = await http(k, 'POST', '/api/ktv/attendance', { employeeId: KTV[k], checkType: 'CHECK_IN', photoBase64: JPEG, isLiveCapture: true, latitude: 10.77, longitude: 106.7 });
            check(r.success === true, `${KTV[k]} điểm danh`, r.error || r.message || '');
        }
        /* ---------- tranh chấp lúc huỷ: chèn thao tác của người khác ĐÚNG LÚC giữa bước đọc và bước gỡ KTV ---------- */
        const BMS = require('@/lib/services/BookingModificationService').BookingModificationService;
        const SC = require('@supabase/supabase-js').SupabaseClient;
        const origRpc = SC.prototype.rpc;
        let rpcHook: null | ((args: any, n: number) => Promise<void>) = null;
        let rpcCount = 0;
        SC.prototype.rpc = function (fn: string, args: any, ...rest: any[]) {
            if (fn === 'dispatch_unassign_unstarted_staff' && rpcHook) {
                const n = ++rpcCount; const h = rpcHook;
                return (async () => { await h(args, n); return origRpc.call(this, fn, args, ...rest); })();
            }
            return origRpc.call(this, fn, args, ...rest);
        };
        const arm = (h: (args: any, n: number) => Promise<void>) => { rpcCount = 0; rpcHook = async (a, n) => { const keep = rpcHook; rpcHook = null; try { await h(a, n); } finally { if (n < 9) rpcHook = keep; } }; };
        const disarm = () => { rpcHook = null; };
        const RELOAD = 'Đơn vừa thay đổi; tải lại rồi huỷ lại.';
        /** Máy quầy khác vừa lưu bản mới cho dịch vụ: đi đúng đường của RPC lưu (đặt app.dispatch_action → trigger tăng dispatchRevision). */
        const bumpRevision = async (itemId: string) => {
            const before = Number(parseKtvOptions((await sb.from('BookingItems').select('options').eq('id', itemId).single()).data?.options).dispatchRevision || 0);
            await c.query('BEGIN');
            await c.query(`SELECT set_config('app.dispatch_action','QA_OTHER_COUNTER_SAVE',true)`);
            await c.query(`UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}') || '{"qaOtherCounterSave":true}'::jsonb WHERE id=$1`, [itemId]);
            await c.query('COMMIT');
            const after = Number(parseKtvOptions((await sb.from('BookingItems').select('options').eq('id', itemId).single()).data?.options).dispatchRevision || 0);
            check(after === before + 1, 'mô phỏng máy khác lưu: số phiên bản tăng 1', `${before} → ${after}`);
        };
        const openAssign = async (bookingId: string, itemId: string, ktv: string) => (await assigns(bookingId))
            .filter(a => a.booking_item_id === itemId && a.employee_id === ktv && ['ACTIVE', 'QUEUED', 'READY'].includes(a.status));
        const liveSeg = async (itemId: string, ktv: string) => (await segOf(itemId, ktv)).filter((s: any) => s.voided !== true && s.voided !== 'true');
        const cleanTurn = async (bookingId: string, ktv: string) => (await ledger(bookingId)).filter(x => x.employee_id === ktv && !x.is_punished);
        const itemRow = async (bookingId: string, itemId: string) => (await items(bookingId)).find(x => x.id === itemId)!;
        /** Dịch vụ còn NGUYÊN: không huỷ, KTV còn chặng sống + phân công mở + tua. */
        async function expectUntouched(bookingId: string, itemId: string, ktvs: string[], label: string) {
            const it = await itemRow(bookingId, itemId);
            check(it.status !== 'CANCELLED', `${label}: dịch vụ CHƯA bị huỷ`, it.status);
            for (const k of ktvs) {
                check((await liveSeg(itemId, k)).length > 0, `${label}: ${k} vẫn còn trong dịch vụ`);
                check((await openAssign(bookingId, itemId, k)).length > 0, `${label}: phân công của ${k} vẫn mở`, await assigns(bookingId));
                check((await cleanTurn(bookingId, k)).length > 0, `${label}: tua của ${k} còn nguyên`, await ledger(bookingId));
            }
        }
        /** Huỷ SẠCH: dịch vụ CANCELLED, KTV chưa làm được nhả hết (không chặng sống, không phân công mở, không tua, không bị giữ ở đơn). */
        async function expectCleanCancelled(bookingId: string, itemId: string, ktvs: string[], label: string) {
            const it = await itemRow(bookingId, itemId);
            check(it.status === 'CANCELLED', `${label}: dịch vụ CANCELLED`, it.status);
            for (const k of ktvs) {
                check((await liveSeg(itemId, k)).length === 0, `${label}: ${k} không còn chặng sống`, await segOf(itemId, k));
                check((await openAssign(bookingId, itemId, k)).length === 0, `${label}: phân công của ${k} đã đóng`, await assigns(bookingId));
                check((await cleanTurn(bookingId, k)).length === 0, `${label}: ${k} không nhận tua`, await ledger(bookingId));
                const q = await queue(k);
                check(q?.current_order_id !== bookingId, `${label}: ${k} không bị giữ ở đơn đã huỷ`, q);
            }
        }
        const appShows = async (who: string, ktv: string, bookingId: string) => JSON.stringify((await http(who, 'GET', `/api/ktv/booking?techCode=${ktv}`))?.data ?? null).includes(bookingId);
        const httpCancel = (bookingId: string, itemId: string, reason: string) =>
            http('admin', 'POST', '/api/bookings/cancel-item', { bookingId, itemId, reason, cancelCredit: 'NONE' });

        /* T01 */ flow('T01 Huỷ 1 dịch vụ đúng lúc máy quầy khác vừa lưu bản mới');
        { const q = await quickBooking('T01', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          check((await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }])).success === true, 'gửi đơn cho A');
          arm(async () => { await bumpRevision(it); });
          const r = await BMS.cancelBookingItem(q.bookingId, it, 'QA T01', 'NONE'); disarm();
          check(r.success === false && r.error === RELOAD, 'quầy nhận "Đơn vừa thay đổi; tải lại rồi huỷ lại."', r.error || 'không báo lỗi');
          await expectUntouched(q.bookingId, it, [KTV.A], 'sau lỗi');
          check(await appShows('A', KTV.A, q.bookingId), 'app A vẫn thấy đơn (chưa bị gỡ nửa chừng)');
          const r2 = await httpCancel(q.bookingId, it, 'QA T01 huỷ lại');
          check(r2.success === true, 'tải lại rồi huỷ lại → thành công', r2.error || '');
          await expectCleanCancelled(q.bookingId, it, [KTV.A], 'huỷ lại');
          check(!(await appShows('A', KTV.A, q.bookingId)), 'app A không còn đơn'); }

        /* T02 */ flow('T02 Huỷ 1 dịch vụ đúng lúc KTV bấm Bắt đầu');
        { const q = await quickBooking('T02', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          await http('A', 'POST', '/api/ktv/accept-order', { staffId: KTV.A, bookingItemId: it });
          await ktvPatch('A', KTV.A, { bookingId: q.bookingId, status: 'READY' });
          let st: any = null;
          arm(async () => { st = await ktvPatch('A', KTV.A, { bookingId: q.bookingId, status: 'IN_PROGRESS', action: 'START_TIMER', startPhotoBase64: JPEG, guestSlipperPhotoBase64: JPEG }); });
          const r = await BMS.cancelBookingItem(q.bookingId, it, 'QA T02', 'NONE'); disarm();
          check(st?.success === true, 'A bắt đầu được', st?.error || '');
          note(`quầy nhận: ${r.success ? 'THÀNH CÔNG' : r.error}`);
          check(r.success === false, 'huỷ lần này bị chặn (A đã bắt đầu trước khi gỡ)', r.error || '');
          check(r.error === RELOAD, 'thông báo cho quầy là "tải lại rồi huỷ lại" (dễ hiểu)', r.error || '');
          const seg = (await liveSeg(it, KTV.A))[0];
          check(!!seg?.actualStartTime && (await itemRow(q.bookingId, it)).status === 'IN_PROGRESS', 'A vẫn đang làm, giờ bắt đầu giữ nguyên', { status: (await itemRow(q.bookingId, it)).status });
          check((await cleanTurn(q.bookingId, KTV.A)).length > 0, 'tua A còn nguyên');
          const r2 = await httpCancel(q.bookingId, it, 'QA T02 huỷ lại');
          check(r2.success === true, 'huỷ lại (A đã làm) → thành công', r2.error || '');
          const s2 = (await segOf(it, KTV.A))[0];
          check(s2?.voided === true && s2?.note === 'CANCELLED_NO_CREDIT' && !!s2?.actualEndTime, 'A bị tước không công, chốt giờ kết thúc', { voided: s2?.voided, note: s2?.note });
          check((await cleanTurn(q.bookingId, KTV.A)).length === 0, 'A không giữ tua sạch');
          const rl = await ktvPatch('A', KTV.A, { bookingId: q.bookingId, status: 'FEEDBACK', action: 'RELEASE_KTV', handoverItemIds: [it], photosBase64: [JPEG] });
          check(rl.success === true, 'A bàn giao phòng (đã bắt đầu thì vẫn phải bàn giao)', rl.error || '');
          await wait(800);
          const qa = await queue(KTV.A);
          check(qa?.status === 'waiting' && !qa?.current_order_id, 'A bàn giao xong → về rảnh (plan 10/10)', qa);
          check(!(await openAssign(q.bookingId, it, KTV.A)).length, 'phiếu phân công của A đã đóng sau bàn giao', await assigns(q.bookingId)); }

        /* T03 */ flow('T03 Hai máy quầy: máy kia huỷ xong trước, máy này bấm huỷ sau đó một nhịp');
        { const q = await quickBooking('T03', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.B], bed: BEDS[1] }]);
          let other: any = null;
          arm(async () => { other = await BMS.cancelBookingItem(q.bookingId, it, 'QA T03 máy kia', 'NONE'); });
          const r = await BMS.cancelBookingItem(q.bookingId, it, 'QA T03 máy này', 'NONE'); disarm();
          check(other?.success === true, 'máy kia huỷ thành công', other?.error || '');
          check(r.success === false && r.error === RELOAD, 'máy này nhận "tải lại"', r.error || 'không báo lỗi');
          await expectCleanCancelled(q.bookingId, it, [KTV.B], 'sau 2 máy');
          const l1 = JSON.stringify(await ledger(q.bookingId)); const a1 = JSON.stringify(await assigns(q.bookingId));
          const r2 = await httpCancel(q.bookingId, it, 'QA T03 bấm lại sau khi tải lại');
          note(`bấm huỷ lại trên dịch vụ đã huỷ: ${r2.success ? 'OK' : r2.error}`);
          check(JSON.stringify(await ledger(q.bookingId)) === l1 && JSON.stringify(await assigns(q.bookingId)) === a1, 'bấm lại không đổi tua / phân công');
          await expectCleanCancelled(q.bookingId, it, [KTV.B], 'bấm lại'); }

        /* T04 */ flow('T04 Hai máy quầy bấm huỷ CÙNG LÚC (thật, song song qua HTTP)');
        { const q = await quickBooking('T04', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          const [r1, r2] = await Promise.all([httpCancel(q.bookingId, it, 'QA T04 máy 1'), httpCancel(q.bookingId, it, 'QA T04 máy 2')]);
          note(`máy 1: ${r1.success ? 'OK' : r1.error} · máy 2: ${r2.success ? 'OK' : r2.error}`);
          check(r1.success === true || r2.success === true, 'ít nhất một máy huỷ được');
          check([r1, r2].every(r => r.success === true || r.error === RELOAD), 'máy còn lại (nếu lỗi) nhận đúng thông báo "tải lại"', [r1.error, r2.error]);
          check([r1, r2].every(r => r.status !== 500), 'không có lỗi 500');
          await expectCleanCancelled(q.bookingId, it, [KTV.A], 'song song'); }

        /* T05 */ flow('T05 Dịch vụ 2 KTV chưa bắt đầu: gỡ xong A thì máy khác lưu bản mới trước khi gỡ B');
        { const q = await quickBooking('T05', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          check((await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A, KTV.B], bed: BEDS[0] }])).success === true, 'gửi đơn cho A + B');
          arm(async (_a, n) => { if (n === 2) await bumpRevision(it); });
          const r = await BMS.cancelBookingItem(q.bookingId, it, 'QA T05', 'NONE'); disarm();
          check(r.success === false && r.error === RELOAD, 'quầy nhận "tải lại"', r.error || 'không báo lỗi');
          const row = await itemRow(q.bookingId, it);
          const aLive = (await liveSeg(it, KTV.A)).length, bLive = (await liveSeg(it, KTV.B)).length;
          note(`[TRẠNG THÁI NỬA CHỪNG] sau lỗi: dịch vụ ${row.status}, A còn chặng ${aLive}, B còn chặng ${bLive}, KTV trên thẻ ${JSON.stringify(row.technicianCodes)}`);
          check(row.status !== 'CANCELLED' && bLive === 1, 'dịch vụ chưa huỷ, B vẫn còn', { status: row.status, bLive });
          check(aLive === 0 ? (await cleanTurn(q.bookingId, KTV.A)).length === 0 && (await openAssign(q.bookingId, it, KTV.A)).length === 0 : true,
              'nếu A đã gỡ thì gỡ trọn (không tua, không phân công treo)');
          const r2 = await httpCancel(q.bookingId, it, 'QA T05 huỷ lại');
          check(r2.success === true, 'tải lại rồi huỷ lại → thành công', r2.error || '');
          await expectCleanCancelled(q.bookingId, it, [KTV.A, KTV.B], 'huỷ lại'); }

        /* T06 */ flow('T06 Huỷ CẢ ĐƠN 2 dịch vụ, máy khác lưu bản mới ở dịch vụ 2 đúng lúc');
        { const q = await quickBooking('T06', ['NHS0101', 'NHS0040']); const its = await items(q.bookingId);
          await dispatch(q.bookingId, [{ itemId: its[0].id, ktvs: [KTV.A], bed: BEDS[0] }, { itemId: its[1].id, ktvs: [KTV.B], bed: BEDS[1] }]);
          arm(async (a) => { if (a.p_item_id === its[1].id) await bumpRevision(its[1].id); });
          const r = await actions.cancelBooking(q.bookingId, DATE, 'NONE', 'QA T06'); disarm();
          check(r.success === false && r.error === RELOAD, 'quầy nhận "tải lại"', r.error || 'không báo lỗi');
          const b = await booking(q.bookingId);
          check(b.status !== 'CANCELLED', 'đơn CHƯA chuyển Đã huỷ', b.status);
          const i0 = await itemRow(q.bookingId, its[0].id), i1 = await itemRow(q.bookingId, its[1].id);
          note(`[TRẠNG THÁI NỬA CHỪNG] dịch vụ 1: ${i0.status}, KTV ${JSON.stringify(i0.technicianCodes)} · dịch vụ 2: ${i1.status}, KTV ${JSON.stringify(i1.technicianCodes)}`);
          await expectUntouched(q.bookingId, its[1].id, [KTV.B], 'dịch vụ 2');
          const r2 = await actions.cancelBooking(q.bookingId, DATE, 'NONE', 'QA T06 huỷ lại');
          check(r2.success === true, 'tải lại rồi huỷ lại cả đơn → thành công', r2.error || '');
          check((await booking(q.bookingId)).status === 'CANCELLED', 'đơn Đã huỷ');
          await expectCleanCancelled(q.bookingId, its[0].id, [KTV.A], 'dịch vụ 1');
          await expectCleanCancelled(q.bookingId, its[1].id, [KTV.B], 'dịch vụ 2'); }

        /* T07 */ flow('T07 Huỷ đúng lúc KTV bấm "Đã nhận đơn" (song song thật)');
        { const q = await quickBooking('T07', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.B], bed: BEDS[1] }]);
          const [acc, cx] = await Promise.all([http('B', 'POST', '/api/ktv/accept-order', { staffId: KTV.B, bookingItemId: it }), httpCancel(q.bookingId, it, 'QA T07')]);
          note(`B nhận đơn: ${acc.success ? 'OK' : acc.error} · quầy huỷ: ${cx.success ? 'OK' : cx.error}`);
          check(cx.success === true || cx.error === RELOAD, 'quầy: huỷ được hoặc nhận đúng "tải lại"', cx.error || '');
          if (!cx.success) { const r2 = await httpCancel(q.bookingId, it, 'QA T07 huỷ lại'); check(r2.success === true, 'huỷ lại → thành công', r2.error || ''); }
          await expectCleanCancelled(q.bookingId, it, [KTV.B], 'cuối');
          check(!(await appShows('B', KTV.B, q.bookingId)), 'app B không còn đơn'); }

        /* T08 */ flow('T08 Huỷ đúng lúc KTV bấm "Từ chối" (song song thật)');
        { const q = await quickBooking('T08', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.C], bed: BEDS[2] }]);
          const [rj, cx] = await Promise.all([http('C', 'POST', '/api/ktv/discipline/reject-order', { staffId: KTV.C, bookingItemId: it, reason: 'QA T08' }), httpCancel(q.bookingId, it, 'QA T08')]);
          note(`C từ chối: ${rj.success ? 'OK' : (rj.error || JSON.stringify(rj).slice(0, 120))} · quầy huỷ: ${cx.success ? 'OK' : cx.error}`);
          check(cx.success === true || cx.error === RELOAD, 'quầy: huỷ được hoặc nhận đúng "tải lại"', cx.error || '');
          if (!cx.success) { const r2 = await httpCancel(q.bookingId, it, 'QA T08 huỷ lại'); check(r2.success === true, 'huỷ lại → thành công', r2.error || ''); }
          const it2 = await itemRow(q.bookingId, it);
          check(it2.status === 'CANCELLED', 'dịch vụ CANCELLED', it2.status);
          check((await openAssign(q.bookingId, it, KTV.C)).length === 0, 'phân công C đã đóng', await assigns(q.bookingId));
          check((await liveSeg(it, KTV.C)).length === 0, 'C không còn chặng sống');
          check((await queue(KTV.C))?.current_order_id !== q.bookingId, 'C không bị giữ ở đơn');
          note(`tua C sau cùng: ${JSON.stringify(await ledger(q.bookingId))} (từ chối thắng trước thì giữ phạt như luật; huỷ thắng trước thì không tua)`); }

        /* T09 */ flow('T09 Huỷ dịch vụ Y trong hàng chờ của B ĐÚNG LÚC B bàn giao xong đơn X (song song thật)');
        { const qx = await quickBooking('T09X', ['NHS0101']); const ix = (await items(qx.bookingId))[0].id;
          await dispatch(qx.bookingId, [{ itemId: ix, ktvs: [KTV.B], bed: BEDS[1] }]);
          await ktvAcceptAndStart('B', KTV.B, qx.bookingId, ix);
          const qy = await quickBooking('T09Y', ['NHS0101']); const iy = (await items(qy.bookingId))[0].id;
          check((await dispatch(qy.bookingId, [{ itemId: iy, ktvs: [KTV.B], bed: BEDS[2], start: addMin(vnHHMM(), 65) }])).success === true, 'gửi Y cho B đang bận');
          note(`phân công Y trước: ${JSON.stringify(await assigns(qy.bookingId))}`);
          await ktvFinish('B', KTV.B, qx.bookingId);
          await http('B', 'POST', '/api/ktv/review', { bookingId: qx.bookingId, notes: 'QA', techCode: KTV.B });
          const [rl, cx] = await Promise.all([
              ktvPatch('B', KTV.B, { bookingId: qx.bookingId, status: 'FEEDBACK', action: 'RELEASE_KTV', handoverItemIds: [ix], photosBase64: [JPEG] }),
              httpCancel(qy.bookingId, iy, 'QA T09')]);
          note(`B bàn giao X: ${rl.success ? 'OK' : rl.error} · quầy huỷ Y: ${cx.success ? 'OK' : cx.error}`);
          check(rl.success === true, 'B bàn giao X được');
          check(cx.success === true || cx.error === RELOAD, 'quầy: huỷ được hoặc nhận đúng "tải lại"', cx.error || '');
          if (!cx.success) { const r2 = await httpCancel(qy.bookingId, iy, 'QA T09 huỷ lại'); check(r2.success === true, 'huỷ lại → thành công', r2.error || ''); }
          await wait(800);
          await expectCleanCancelled(qy.bookingId, iy, [KTV.B], 'Y');
          check(!(await appShows('B', KTV.B, qy.bookingId)), 'app B không hiện Y đã huỷ');
          note(`sổ tua B cuối: ${JSON.stringify(await queue(KTV.B))}`);
          await actions.submitCustomerRating(qx.bookingId, 5); }

        const releaseA = async (who: string, ktv: string, bookingId: string, itemIds: string[]) => {
            const rl = await ktvPatch(who, ktv, { bookingId, status: 'FEEDBACK', action: 'RELEASE_KTV', handoverItemIds: itemIds, photosBase64: [JPEG] });
            check(rl.success === true, `${ktv} bàn giao phòng`, rl.error || ''); await wait(800); };

        /* T11 */ flow('T11 Huỷ CÓ CÔNG 1 dịch vụ khi KTV đang làm → bàn giao → về rảnh');
        { const q = await quickBooking('T11', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it);
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q.bookingId, itemId: it, reason: 'QA T11', cancelCredit: 'WORKED' });
          check(cr.success === true, 'huỷ có công', cr.error || '');
          check((await queue(KTV.A))?.status === 'working', 'trước bàn giao: A vẫn bận (phải dọn phòng)', await queue(KTV.A));
          check((await cleanTurn(q.bookingId, KTV.A)).length === 1, 'A giữ tua (có công)', await ledger(q.bookingId));
          await releaseA('A', KTV.A, q.bookingId, [it]);
          const qa = await queue(KTV.A);
          check(qa?.status === 'waiting' && !qa?.current_order_id, 'sau bàn giao: A về rảnh', qa);
          check((await cleanTurn(q.bookingId, KTV.A)).length === 1, 'tua A vẫn giữ sau bàn giao'); }

        /* T12 */ flow('T12 A đang làm X, có đơn Y chờ sau; huỷ X (không công) → bàn giao → được kéo sang Y');
        { const qx = await quickBooking('T12X', ['NHS0101']); const ix = (await items(qx.bookingId))[0].id;
          await dispatch(qx.bookingId, [{ itemId: ix, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, qx.bookingId, ix);
          const qy = await quickBooking('T12Y', ['NHS0101']); const iy = (await items(qy.bookingId))[0].id;
          check((await dispatch(qy.bookingId, [{ itemId: iy, ktvs: [KTV.A], bed: BEDS[1], start: addMin(vnHHMM(), 65) }])).success === true, 'gửi Y cho A đang bận');
          check((await openAssign(qy.bookingId, iy, KTV.A))[0]?.status === 'QUEUED', 'Y nằm hàng chờ của A', await assigns(qy.bookingId));
          const cr = await httpCancel(qx.bookingId, ix, 'QA T12'); check(cr.success === true, 'huỷ X không công', cr.error || '');
          check((await openAssign(qy.bookingId, iy, KTV.A))[0]?.status === 'QUEUED', 'chưa bàn giao: Y vẫn chờ (A còn dọn phòng X)', await assigns(qy.bookingId));
          await releaseA('A', KTV.A, qx.bookingId, [ix]);
          const qa = await queue(KTV.A);
          check(qa?.current_order_id === qy.bookingId, 'bàn giao X xong → A chuyển sang Y', qa);
          check((await openAssign(qy.bookingId, iy, KTV.A))[0]?.status === 'ACTIVE', 'phiếu Y lên ACTIVE', await assigns(qy.bookingId));
          check(await appShows('A', KTV.A, qy.bookingId), 'app A thấy đơn Y');
          // Y is booked 65 min ahead, so starting it now would hit the early-start rule; free A by cancelling Y.
          const cy = await httpCancel(qy.bookingId, iy, 'QA T12 dọn Y'); check(cy.success === true, 'huỷ Y (chưa bắt đầu)', cy.error || '');
          const q2 = await queue(KTV.A); check(q2?.status === 'waiting' && !q2?.current_order_id, 'huỷ Y → A rảnh', q2); }

        /* T13 */ flow('T13 Dịch vụ 2 KTV: A đã bắt đầu, B chưa → huỷ dịch vụ: B rảnh ngay, A rảnh sau bàn giao');
        { const q = await quickBooking('T13', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A, KTV.B], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it);
          const cr = await httpCancel(q.bookingId, it, 'QA T13'); check(cr.success === true, 'huỷ dịch vụ', cr.error || '');
          const qb = await queue(KTV.B);
          check(qb?.status === 'waiting' && qb?.current_order_id !== q.bookingId, 'B (chưa bắt đầu) rảnh ngay', qb);
          check((await cleanTurn(q.bookingId, KTV.B)).length === 0, 'B không nhận tua');
          check((await queue(KTV.A))?.status === 'working', 'A còn bận dọn phòng', await queue(KTV.A));
          await releaseA('A', KTV.A, q.bookingId, [it]);
          const qa = await queue(KTV.A); check(qa?.status === 'waiting' && !qa?.current_order_id, 'A bàn giao xong → rảnh', qa); }

        /* T14 */ flow('T14 A có 2 dịch vụ trong đơn; huỷ dịch vụ 1 đã bắt đầu → bàn giao → vẫn làm dịch vụ 2 tới hết');
        { const q = await quickBooking('T14', ['NHS0101', 'NHS0040']); const its = await items(q.bookingId);
          const st = vnHHMM();
          check((await dispatch(q.bookingId, [{ itemId: its[0].id, ktvs: [KTV.A], bed: BEDS[0], start: st },
              { itemId: its[1].id, ktvs: [KTV.A], bed: BEDS[0], start: st }])).success === true, 'gửi 2 dịch vụ cùng giờ cho A (tránh luật bắt đầu sớm ban ngày)');
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, its[0].id, { targetSegmentId: `seg-${its[0].id}-${KTV.A}-0` });
          const cr = await httpCancel(q.bookingId, its[0].id, 'QA T14'); check(cr.success === true, 'huỷ dịch vụ 1', cr.error || '');
          check((await itemRow(q.bookingId, its[1].id)).status !== 'CANCELLED' && (await liveSeg(its[1].id, KTV.A)).length === 1, 'dịch vụ 2 còn nguyên A');
          check((await queue(KTV.A))?.current_order_id === q.bookingId, 'A vẫn ở đơn này', await queue(KTV.A));
          await releaseA('A', KTV.A, q.bookingId, [its[0].id]);
          const qa = await queue(KTV.A);
          check(qa?.current_order_id === q.bookingId, 'bàn giao dịch vụ 1 xong → A vẫn giữ đơn (còn dịch vụ 2)', qa);
          await http('A', 'POST', '/api/ktv/accept-order', { staffId: KTV.A, bookingItemId: its[1].id });
          await ktvPatch('A', KTV.A, { bookingId: q.bookingId, status: 'READY' });
          const s2 = await ktvPatch('A', KTV.A, { bookingId: q.bookingId, status: 'IN_PROGRESS', action: 'START_TIMER', startPhotoBase64: JPEG, guestSlipperPhotoBase64: JPEG, targetSegmentId: `seg-${its[1].id}-${KTV.A}-0` });
          check(s2.success === true, 'A bắt đầu dịch vụ 2', s2.error || '');
          check(!!(await liveSeg(its[1].id, KTV.A))[0]?.actualStartTime, 'chặng dịch vụ 2 đã chạy');
          await ktvFinish('A', KTV.A, q.bookingId);
          await ktvReviewRelease('A', KTV.A, q.bookingId, [its[1].id]);
          await actions.submitCustomerRating(q.bookingId, 5); await wait(1000);
          check((await itemRow(q.bookingId, its[1].id)).status === 'DONE', 'dịch vụ 2 DONE', (await itemRow(q.bookingId, its[1].id)).status);
          const q2 = await queue(KTV.A); check(q2?.status === 'waiting' && !q2?.current_order_id, 'xong hết → A rảnh', q2); }

        /* T15 */ flow('T15 Đối chứng: huỷ CẢ ĐƠN khi A đang làm → A rảnh ngay (không đổi)');
        { const q = await quickBooking('T15', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it);
          const cr = await actions.cancelBooking(q.bookingId, DATE, 'NONE', 'QA T15'); check(cr.success === true, 'huỷ cả đơn', cr.error || '');
          const qa = await queue(KTV.A); check(qa?.status === 'waiting' && !qa?.current_order_id, 'A rảnh ngay như trước', qa);
          check(!(await openAssign(q.bookingId, it, KTV.A)).length, 'phiếu A đã đóng'); }

        /* T10 */ flow('T10 Bấm "Huỷ cả đơn" 2 lần liền (double click) — dữ liệu cũ dạng chuỗi, A chờ + B chưa nhận');
        { const qx = await quickBooking('T10X', ['NHS0101']); const ix = (await items(qx.bookingId))[0].id;
          await dispatch(qx.bookingId, [{ itemId: ix, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, qx.bookingId, ix);
          const q = await quickBooking('T10', ['NHS0101', 'NHS0040']); const its = await items(q.bookingId);
          check((await dispatch(q.bookingId, [{ itemId: its[0].id, ktvs: [KTV.A], bed: BEDS[1], start: addMin(vnHHMM(), 65) }, { itemId: its[1].id, ktvs: [KTV.B], bed: BEDS[2] }])).success === true, 'gửi đơn: A (đang bận → chờ) + B');
          await makeLegacyString(its[0].id); await makeLegacyString(its[1].id);
          const [r1, r2] = await Promise.all([actions.cancelBooking(q.bookingId, DATE, 'NONE', 'QA T10 lần 1'), actions.cancelBooking(q.bookingId, DATE, 'NONE', 'QA T10 lần 2')]);
          note(`lần 1: ${r1.success ? 'OK' : r1.error} · lần 2: ${r2.success ? 'OK' : r2.error}`);
          check(r1.success === true || r2.success === true, 'ít nhất một lần huỷ được');
          check([r1, r2].every(r => r.success === true || r.error === RELOAD), 'lần còn lại (nếu lỗi) nhận đúng "tải lại"', [r1.error, r2.error]);
          check((await booking(q.bookingId)).status === 'CANCELLED', 'đơn Đã huỷ', (await booking(q.bookingId)).status);
          await expectCleanCancelled(q.bookingId, its[0].id, [KTV.A], 'dịch vụ của A');
          await expectCleanCancelled(q.bookingId, its[1].id, [KTV.B], 'dịch vụ của B');
          await expectSegArrays(q.bookingId);
          await ktvFinish('A', KTV.A, qx.bookingId);
          await ktvReviewRelease('A', KTV.A, qx.bookingId, [ix]);
          await wait(800);
          check((await queue(KTV.A))?.current_order_id !== q.bookingId, 'A xong X không bị kéo sang đơn đã huỷ', await queue(KTV.A));
          await actions.submitCustomerRating(qx.bookingId, 5); }
    } catch (e: any) {
        if (e?.message !== SKIP_REST) check(false, 'LỖI DỪNG GIỮA CHỪNG', e?.stack || String(e));
    } finally {
        flow('DỌN DỮ LIỆU THỬ');
        if (TRIGGER_OFF) {
            await c.query('ALTER TABLE "BookingItems" ENABLE TRIGGER aa_normalize_segments');
            const tg = (await c.query(`SELECT tgenabled FROM pg_trigger WHERE tgname='aa_normalize_segments'`)).rows[0]?.tgenabled;
            check(tg === 'O', 'đã BẬT LẠI trigger aa_normalize_segments', tg);
        }
        const out = await restore();
        console.log('  ' + out.join('\n  '));
        const left = (await c.query(`SELECT count(*)::int n FROM "Bookings" WHERE id = ANY($1)`, [createdBookings])).rows[0].n;
        check(left === 0, 'không còn đơn thử', String(left));
        await c.end();
    }

    console.log('\n=== TỔNG HỢP ===');
    console.table(report.map(r => ({ luong: r.flow, dat: r.ok, hong: r.fail })));
    report.filter(r => r.fail).forEach(r => console.log(`\n✗ ${r.flow}\n  - ${r.notes.join('\n  - ')}`));
    const fails = report.reduce((s, r) => s + r.fail, 0);
    console.log(`\n=== ${fails === 0 ? 'DAT' : 'HONG'} — ${fails} muc ===`);
    process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
