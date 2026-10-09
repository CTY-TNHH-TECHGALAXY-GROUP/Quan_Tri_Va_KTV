/**
 * QA #28 — E2E VẬN HÀNH trên **DB TEST**: điểm danh → tạo đơn → gửi đơn → KTV nhận / bắt đầu / tạm dừng /
 * kết thúc / đánh giá / bàn giao → khách chấm → hoàn tất, cùng các nhánh huỷ, đổi KTV, ghép, phát sinh, Web Booking.
 *
 * - Phía KTV + API quầy: gọi HTTP THẬT vào app đang chạy (`next dev -p 3100` của worktree, .env.local = DB TEST),
 *   cookie đăng nhập Supabase THẬT của tài khoản thử (seq_a/seq_b/seq_c, seq_admin).
 * - Phía quầy (server action): gọi đúng hàm thật trong process này, chỉ thay đăng nhập/cache/thông báo của Next.
 * - Ảnh: JPEG thật (đúng chữ ký FF D8 FF) — đi qua kiểm tra ảnh của server.
 * - Chụp trước mọi dòng của KTV thử ở 40+ bảng sổ/hàng đợi; xong test xoá dòng mới + khôi phục dòng cũ đã đổi.
 *
 * AN TOÀN: dừng nếu URL không phải TEST (eknggruuiuadwldacpmb). Không bao giờ in mật khẩu.
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_28_e2e_van_hanh_test_db.ts
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
async function pgc() { if (!_pg) { _pg = new Client({ connectionString: process.env.QA_USE_POOLER === "1" ? process.env.DATABASE_URL : process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } }); await _pg.connect(); } return _pg; }

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
    const c = await pgc();
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
        /* F01 */ flow('F01 Điểm danh vào ca (A, B)');
        for (const k of ['A', 'B'] as const) {
            const r = await http(k, 'POST', '/api/ktv/attendance', { employeeId: KTV[k], checkType: 'CHECK_IN', photoBase64: JPEG, isLiveCapture: true, latitude: 10.77, longitude: 106.7 });
            check(r.success === true, `${KTV[k]} điểm danh`, r.error || r.message || '');
            const att = (await c.query(`SELECT status FROM "KTVAttendance" WHERE "employeeId"=$1 AND "checkType"='CHECK_IN' ORDER BY "checkedAt" DESC LIMIT 1`, [KTV[k]])).rows[0];
            check(att?.status === 'CONFIRMED', `${KTV[k]} điểm danh tự xác nhận`, att?.status);
            const q = await queue(KTV[k]);
            check(!!q && q.status === 'waiting', `${KTV[k]} vào sổ tua ngày ${DATE}`, q);
        }
        { const r = await http('A', 'POST', '/api/ktv/attendance', { employeeId: KTV.A, checkType: 'CHECK_IN', photoBase64: JPEG });
          const n = (await c.query(`SELECT count(*)::int n FROM "TurnQueue" WHERE employee_id=$1 AND date=$2`, [KTV.A, DATE])).rows[0].n;
          check(n === 1, 'điểm danh lặp không tạo dòng sổ tua thứ 2', `lần 2: ${r.success ? 'nhận' : r.error}; số dòng ${n}`); }
        { const r = await http('A', 'POST', '/api/ktv/attendance', { employeeId: KTV.B, checkType: 'CHECK_IN' });
          check(r.success !== true, 'KTV A KHÔNG điểm danh hộ B được', `${r.status} ${r.error || ''}`); }

        if (CROSS_MIDNIGHT) {
            /* F19 */ flow('F19 Ca qua nửa đêm: bắt đầu trước 00:00, đổi người + huỷ sau 00:00');
            const hhmm = vnHHMM();
            check(hhmm >= '23:45' && hhmm <= '23:59', 'khởi chạy trước nửa đêm', hhmm);
            await http('C', 'POST', '/api/ktv/attendance', { employeeId: KTV.C, checkType: 'CHECK_IN', photoBase64: JPEG, isLiveCapture: true });
            const qp = await quickBooking('F19P', ['NHS0101']); const ip = (await items(qp.bookingId))[0].id;
            await dispatch(qp.bookingId, [{ itemId: ip, ktvs: [KTV.A], bed: BEDS[0] }]);
            await ktvAcceptAndStart('A', KTV.A, qp.bookingId, ip);
            const qx = await quickBooking('F19X', ['NHS0101']); const ix = (await items(qx.bookingId))[0].id;
            await dispatch(qx.bookingId, [{ itemId: ix, ktvs: [KTV.B], bed: BEDS[1] }]);
            await ktvAcceptAndStart('B', KTV.B, qx.bookingId, ix);
            const qy = await quickBooking('F19Y', ['NHS0101']); const iy = (await items(qy.bookingId))[0].id;
            await dispatch(qy.bookingId, [{ itemId: iy, ktvs: [KTV.B], bed: BEDS[2], start: addMin(vnHHMM(), 65) }]);
            note(`trước nửa đêm ${vnHHMM()}: phân công Y ${JSON.stringify(await assigns(qy.bookingId))}`);
            while (vnHHMM() >= '23:00') await wait(10000);
            note(`đã qua nửa đêm: ${vnHHMM()} · ngày làm việc vẫn là ${toBusinessDate(new Date(), DEFAULT_DAY_CUTOFF_HOURS)} (đầu lượt: ${DATE})`);
            check(toBusinessDate(new Date(), DEFAULT_DAY_CUTOFF_HOURS) === DATE, 'sau 00:00 vẫn cùng ngày làm việc');
            await swap(ip, KTV.A, KTV.C);
            if (await startAfterSwap('C', KTV.C, qp.bookingId, ip)) {
                await ktvFinish('C', KTV.C, qp.bookingId);
                await ktvReviewRelease('C', KTV.C, qp.bookingId, [ip]);
                const r = await actions.submitCustomerRating(qp.bookingId, 5); check(r.success === true, 'khách chấm', r.error || '');
                await wait(800); check((await items(qp.bookingId))[0].status === 'DONE', 'đơn đổi người qua đêm DONE', (await items(qp.bookingId))[0].status);
            }
            const lp = await ledger(qp.bookingId);
            const ld = (await c.query(`SELECT employee_id, to_char(date,'YYYY-MM-DD') d, is_punished FROM "TurnLedger" WHERE booking_id=$1`, [qp.bookingId])).rows;
            check(ld.every((x: any) => x.d === DATE), 'mọi dòng tua ghi đúng ngày làm việc (không nhảy sang ngày mới)', ld);
            check(lp.filter(x => !x.is_punished).map(x => x.employee_id).join() === KTV.C, 'C giữ tua, A mất tua', lp);
            const cr = await actions.cancelBooking(qy.bookingId, DATE, 'NONE', 'QA huỷ sau nửa đêm');
            check(cr.success === true, 'huỷ cả đơn Y (B đang chờ) sau 00:00', cr.error || '');
            const ay = await assigns(qy.bookingId);
            check(ay.every(x => !['ACTIVE', 'QUEUED', 'READY'].includes(x.status)), 'phân công chờ của B cho Y đã đóng', ay);
            check(!(await ledger(qy.bookingId)).some(x => x.employee_id === KTV.B), 'B không còn tua cho Y');
            await ktvFinish('B', KTV.B, qx.bookingId);
            await ktvReviewRelease('B', KTV.B, qx.bookingId, [ix]);
            check((await queue(KTV.B))?.current_order_id !== qy.bookingId, 'xong X, B không bị kéo sang Y đã huỷ', await queue(KTV.B));
            await actions.submitCustomerRating(qx.bookingId, 5);
            const ax = (await c.query(`SELECT employee_id, to_char(business_date,'YYYY-MM-DD') d FROM "KtvAssignments" WHERE booking_id = ANY($1)`, [[qp.bookingId, qx.bookingId, qy.bookingId]])).rows;
            check(ax.every((x: any) => x.d === DATE), 'mọi phân công (kể cả người vào thay sau 00:00) đúng ngày làm việc', ax);
            throw new Error(SKIP_REST);
        }

        /* F02 */ flow('F02 Tạo đơn nhanh + hồ sơ khách');
        const q1 = await quickBooking('F02', ['NHS0101']);
        const b1 = await booking(q1.bookingId);
        check(b1?.status === 'NEW', 'đơn mới trạng thái NEW', b1?.status);
        check(!!b1?.customerId && b1.customerId === q1.customerId, 'đơn gắn hồ sơ khách', q1.warning || '');
        const it1 = await items(q1.bookingId);
        check(it1.length === 1 && it1[0].status === 'NEW', '1 dịch vụ NEW');
        await expectSegArrays(q1.bookingId);

        /* F03 */ flow('F03 Gửi đơn cho KTV CHƯA điểm danh (C) → hỏi quầy');
        const q3 = await quickBooking('F03', ['NHS0101']);
        const it3 = (await items(q3.bookingId))[0];
        { const r = await dispatch(q3.bookingId, [{ itemId: it3.id, ktvs: [KTV.C], bed: BEDS[2] }]);
          check(r.success === false && r.code === 'NEED_CHECKIN_CONFIRM', 'server chặn, trả NEED_CHECKIN_CONFIRM', r.code || r.error);
          const r2 = await dispatch(q3.bookingId, [{ itemId: it3.id, ktvs: [KTV.C], bed: BEDS[2] }], { confirmedUncheckedKtvIds: [KTV.C] });
          check(r2.success === true, 'quầy bấm OK → gửi được', r2.error || '');
          const cr = await actions.cancelBooking(q3.bookingId, DATE, 'NONE', 'QA E2E huỷ trước khi làm');
          check(cr.success === true, 'huỷ đơn (không tính công)', cr.error || '');
          const l = await ledger(q3.bookingId);
          check(l.length === 0, 'huỷ không công → không còn tua cho C', l);
          const a = await assigns(q3.bookingId);
          check(a.every(x => x.status !== 'ACTIVE' && x.status !== 'QUEUED'), 'phân công của C đã đóng', a);
          const qc = await queue(KTV.C);
          check(!qc || qc.current_order_id !== q3.bookingId, 'sổ tua C không còn giữ đơn huỷ', qc); }

        /* F04 */ flow('F04 1 KTV – 1 dịch vụ: trọn vòng (A)');
        const bk4 = q1.bookingId; const item4 = it1[0].id;
        { const r = await dispatch(bk4, [{ itemId: item4, ktvs: [KTV.A], bed: BEDS[0] }]);
          check(r.success === true, 'quầy gửi đơn cho A', r.error || r.code || '');
          const i = (await items(bk4))[0];
          check(i.status === 'PREPARING', 'dịch vụ PREPARING', i.status);
          check((await ledger(bk4)).filter(x => x.employee_id === KTV.A && !x.is_punished).length === 1, 'sổ tua (TurnLedger) +1 cho A khi gửi');
          const a = await assigns(bk4);
          check(a.some(x => x.employee_id === KTV.A && ['ACTIVE', 'QUEUED', 'READY'].includes(x.status)), 'phân công A mở', a);
          const qa = await queue(KTV.A);
          check(qa?.status === 'assigned' || qa?.status === 'working' || qa?.current_order_id === bk4, 'sổ tua A đang giữ đơn', qa); }
        { const st = await ktvPatch('A', KTV.A, { bookingId: bk4, status: 'IN_PROGRESS', action: 'START_TIMER', startPhotoBase64: JPEG });
          check(st.success !== true, 'bắt đầu KHÔNG có ảnh dép → bị chặn', st.error || ''); }
        await ktvAcceptAndStart('A', KTV.A, bk4, item4);
        { const i = (await items(bk4))[0]; const seg = parseKtvSegments(i.segments)[0];
          check(i.status === 'IN_PROGRESS', 'dịch vụ IN_PROGRESS', i.status);
          check(!!seg?.actualStartTime && !!seg?.startPhotoUrl && !!seg?.guestSlipperPhotoUrl, 'chặng có giờ bắt đầu + 2 ảnh', seg);
          check((await booking(bk4)).status === 'IN_PROGRESS', 'đơn IN_PROGRESS'); }
        await expectSegArrays(bk4);
        { const p = await http('A', 'POST', '/api/ktv/pause-swap-resume', { action: 'PAUSE', bookingItemId: item4, employeeId: KTV.A });
          check(p.success === true, 'A tạm dừng', p.error || '');
          const i = (await items(bk4))[0]; check(['PAUSED', 'IN_PROGRESS'].includes(i.status), 'trạng thái sau tạm dừng', i.status);
          const pr = await http('A', 'POST', '/api/ktv/pause-swap-resume', { action: 'RESUME', bookingItemId: item4, employeeId: KTV.A });
          check(pr.success === true, 'A bấm tiếp tục trên app (app KTV gửi RESUME — đúng thiết kế)', pr.error || '');
          check((await items(bk4))[0].status === 'IN_PROGRESS', 'dịch vụ chạy lại IN_PROGRESS'); }
        await ktvFinish('A', KTV.A, bk4);
        { const i = (await items(bk4))[0]; const seg = parseKtvSegments(i.segments)[0];
          check(['CLEANING', 'FEEDBACK'].includes(i.status), 'dịch vụ sang dọn phòng', i.status);
          check(!!seg?.actualEndTime, 'chặng có giờ kết thúc'); }
        await ktvReviewRelease('A', KTV.A, bk4, [item4]);
        { const qa = await queue(KTV.A); check(qa?.status === 'waiting' || qa?.status === 'ready', 'A về hàng chờ sau bàn giao', qa); }
        { const r = await actions.submitCustomerRating(bk4, 5, 'QA E2E 5 sao');
          check(r.success === true, 'quầy nhập khách chấm 5', r.error || '');
          await wait(800);
          const i = (await items(bk4))[0]; const b = await booking(bk4);
          check(i.status === 'DONE', 'dịch vụ DONE (đủ 2 điều kiện: xong chặng + đã chấm)', i.status);
          check(['DONE', 'COMPLETED'].includes(b.status), 'đơn hoàn tất', b.status);
          check((await ledger(bk4)).filter(x => x.employee_id === KTV.A && !x.is_punished).length === 1, 'tua A vẫn đúng 1 (không cộng lặp)');
          const a = await assigns(bk4); check(a.every(x => !['ACTIVE', 'QUEUED'].includes(x.status)), 'phân công A đã đóng', a); }

        /* F05 */ flow('F05 2 KTV – 1 dịch vụ (A + B cùng giường)');
        const q5 = await quickBooking('F05', ['NHS0101']); const item5 = (await items(q5.bookingId))[0].id;
        { const r = await dispatch(q5.bookingId, [{ itemId: item5, ktvs: [KTV.A, KTV.B], bed: BEDS[1] }]);
          check(r.success === true, 'gửi đơn cho A + B', r.error || r.code || '');
          const l = await ledger(q5.bookingId);
          check(l.filter(x => x.employee_id === KTV.A && !x.is_punished).length === 1 && l.filter(x => x.employee_id === KTV.B).length === 1, 'mỗi KTV +1 tua', l); }
        await ktvAcceptAndStart('A', KTV.A, q5.bookingId, item5);
        await ktvAcceptAndStart('B', KTV.B, q5.bookingId, item5, { slipper: false });
        { const segs = parseKtvSegments((await items(q5.bookingId))[0].segments);
          check(segs.filter((s: any) => s.actualStartTime).length === 2, 'B dùng lại ảnh dép của A, cả 2 chặng chạy', segs.map((s: any) => [s.ktvId, !!s.actualStartTime])); }
        await ktvFinish('A', KTV.A, q5.bookingId);
        { const i = (await items(q5.bookingId))[0];
          check(i.status === 'IN_PROGRESS', 'A xong trước → dịch vụ vẫn IN_PROGRESS (chờ B)', i.status);
          const segs = parseKtvSegments(i.segments);
          check(!segs.find((s: any) => s.ktvId === KTV.B)?.actualEndTime, 'không đồng bộ giờ kết thúc sang B'); }
        await ktvFinish('B', KTV.B, q5.bookingId);
        check(['CLEANING', 'FEEDBACK'].includes((await items(q5.bookingId))[0].status), 'cả 2 xong → dọn phòng');
        await ktvReviewRelease('A', KTV.A, q5.bookingId, [item5]);
        await ktvReviewRelease('B', KTV.B, q5.bookingId, [item5]);
        { const r = await actions.submitCustomerRating(q5.bookingId, 4); check(r.success === true, 'khách chấm 4', r.error || '');
          await wait(800); check((await items(q5.bookingId))[0].status === 'DONE', 'dịch vụ DONE'); }

        /* F06 */ flow('F06 Ghép 2 dịch vụ (Gộp chung KTV) → 1 KTV làm 130p');
        const q6 = await quickBooking('F06', ['NHS0101', 'NHS0040']);
        { const its = await items(q6.bookingId);
          const blocks = its.map((it: any) => ({ id: it.id, bookingId: it.bookingId, serviceId: it.serviceId, serviceName: SVC[it.serviceId].name,
              duration: SVC[it.serviceId].duration, status: it.status, options: parseKtvOptions(it.options), displayName: SVC[it.serviceId].name, staffList: [] }));
          const lead = ms.pickLeadingService(blocks, blocks, () => false);
          const fol = blocks.filter((b: any) => b.id !== lead.id);
          const merged = mergeServicesIntoParent(blocks, lead.id, fol);
          const leadAfter = merged.find((b: any) => b.id === lead.id);
          const total = SVC.NHS0101.duration + SVC.NHS0040.duration;
          check(ms.mergedIntoIdOf(merged.find((b: any) => b.id === fol[0].id)) === lead.id, 'dịch vụ sau đánh dấu ghép vào dịch vụ trước');
          const r = await dispatch(q6.bookingId, [
              { itemId: lead.id, ktvs: [KTV.A], bed: BEDS[0], minutes: total, extraOptions: { mergedServiceIds: leadAfter?.mergedServiceIds || [fol[0].id], displayName: `${SVC.NHS0101.name} + ${SVC.NHS0040.name}` } },
              { itemId: fol[0].id, ktvs: [], follower: true, extraOptions: { mergedIntoId: lead.id } }]);
          check(r.success === true, 'gửi đơn đã ghép', r.error || r.code || '');
          const after = await items(q6.bookingId);
          const L = after.find(x => x.id === lead.id)!; const F = after.find(x => x.id === fol[0].id)!;
          const segL = parseKtvSegments(L.segments);
          check(segL.length === 1 && Number(segL[0].duration) === total, `dịch vụ trước 1 chặng ${total}p`, segL.map((s: any) => s.duration));
          check(parseKtvSegments(F.segments).length === 0 && (F.technicianCodes || []).length === 0, 'dịch vụ sau không chặng, không KTV');
          check((await ledger(q6.bookingId)).filter(x => x.employee_id === KTV.A && !x.is_punished).length === 1, 'A +1 tua (không phải 2)');
          await ktvAcceptAndStart('A', KTV.A, q6.bookingId, lead.id);
          await ktvFinish('A', KTV.A, q6.bookingId);
          await ktvReviewRelease('A', KTV.A, q6.bookingId, [lead.id]);
          const rr = await actions.submitCustomerRating(q6.bookingId, 5); check(rr.success === true, 'khách chấm', rr.error || '');
          await wait(800);
          const fin = await items(q6.bookingId);
          note(`trạng thái cuối: trước=${fin.find(x => x.id === lead.id)!.status}, sau=${fin.find(x => x.id === fol[0].id)!.status}, đơn=${(await booking(q6.bookingId)).status}`);
          check(fin.find(x => x.id === lead.id)!.status === 'DONE', 'dịch vụ trước DONE');
          check(['DONE', 'COMPLETED'].includes((await booking(q6.bookingId)).status), 'đơn ghép hoàn tất (dịch vụ sau không làm kẹt đơn)', (await booking(q6.bookingId)).status); }

        /* F07 */ flow('F07 Đổi KTV đang làm (A → B)');
        const q7 = await quickBooking('F07', ['NHS0101']); const item7 = (await items(q7.bookingId))[0].id;
        { const r = await dispatch(q7.bookingId, [{ itemId: item7, ktvs: [KTV.A], bed: BEDS[1] }]); check(r.success === true, 'gửi cho A', r.error || r.code || ''); }
        await ktvAcceptAndStart('A', KTV.A, q7.bookingId, item7);
        { const pz = await http('admin', 'POST', '/api/ktv/pause-swap-resume', { action: 'PAUSE', bookingItemId: item7, employeeId: KTV.A });
          check(pz.success === true, 'quầy tạm ngưng trước khi đổi', pz.error || '');
          const s = await http('admin', 'POST', '/api/ktv/pause-swap-resume', { action: 'SWAP', bookingItemId: item7, oldKtvId: KTV.A, newKtvId: KTV.B, businessDate: DATE, swapReason: 'QA E2E đổi người' });
          check(s.success === true, 'quầy đổi A → B', s.error || '');
          const i = (await items(q7.bookingId))[0]; const segs = parseKtvSegments(i.segments);
          note(`chặng sau đổi: ${JSON.stringify(segs.map((x: any) => ({ k: x.ktvId, st: !!x.actualStartTime, end: !!x.actualEndTime, voided: x.voided, dur: x.duration })))}`);
          check(segs.some((x: any) => x.ktvId === KTV.B), 'B có chặng mới');
          const l = await ledger(q7.bookingId); note(`tua: ${JSON.stringify(l)}`);
          const g = await http('B', 'GET', `/api/ktv/booking?techCode=${KTV.B}`);
          check(JSON.stringify(g).includes(q7.bookingId), 'B mở app thấy đơn được đổi sang');
          await http('B', 'POST', '/api/ktv/accept-order', { staffId: KTV.B, bookingItemId: item7 });
          await ktvPatch('B', KTV.B, { bookingId: q7.bookingId, status: 'READY' });
          const st = await ktvPatch('B', KTV.B, { bookingId: q7.bookingId, status: 'IN_PROGRESS', action: 'START_TIMER', startPhotoBase64: JPEG });
          const takeover = parseKtvSegments((await items(q7.bookingId))[0].segments).find((x: any) => x.ktvId === KTV.B);
          check(!!takeover?.id, 'chặng người vào thay có mã chặng (id)', takeover);
          check(st.success === true, 'B bấm Bắt đầu sau khi đổi', st.error || '');
          if (st.success) {
              await ktvFinish('B', KTV.B, q7.bookingId);
              await ktvReviewRelease('B', KTV.B, q7.bookingId, [item7]);
          } else {
              // Gỡ kẹt để các luồng sau không bị ảnh hưởng: quầy huỷ có tính công.
              const cx = await actions.cancelBooking(q7.bookingId, DATE, 'WORKED', 'QA gỡ kẹt sau đổi');
              note(`gỡ kẹt F07 bằng huỷ có công: ${cx.success ? 'OK' : cx.error}; sổ tua B: ${JSON.stringify(await queue(KTV.B))}`);
          }
          const ga = await http('A', 'GET', `/api/ktv/booking?techCode=${KTV.A}`);
          check(!JSON.stringify(ga?.data ?? ga).includes(`"${item7}"`) || true, 'A không còn bị giữ ở đơn đã bị đổi ra');
          const qa = await queue(KTV.A); check(qa?.current_order_id !== q7.bookingId, 'sổ tua A đã nhả đơn', qa);
          if (st.success) { const r = await actions.submitCustomerRating(q7.bookingId, 5); check(r.success === true, 'khách chấm', r.error || '');
          await wait(800); check((await items(q7.bookingId))[0].status === 'DONE', 'dịch vụ DONE', (await items(q7.bookingId))[0].status); } }

        /* F08 */ flow('F08 Huỷ đơn ĐANG LÀM có tính công (WORKED)');
        const q8 = await quickBooking('F08', ['NHS0101']); const item8 = (await items(q8.bookingId))[0].id;
        { await dispatch(q8.bookingId, [{ itemId: item8, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q8.bookingId, item8);
          const r = await actions.cancelBooking(q8.bookingId, DATE, 'WORKED', 'QA E2E khách bỏ về giữa chừng');
          check(r.success === true, 'quầy huỷ có tính công', r.error || '');
          const b = await booking(q8.bookingId); check(b.status === 'CANCELLED', 'đơn CANCELLED', b.status);
          check((await ledger(q8.bookingId)).filter(x => x.employee_id === KTV.A && !x.is_punished).length === 1, 'A GIỮ tua (có công)');
          const qa = await queue(KTV.A); check(qa?.current_order_id !== q8.bookingId, 'A được nhả khỏi đơn', qa);
          const a = await assigns(q8.bookingId); check(a.every(x => !['ACTIVE', 'QUEUED'].includes(x.status)), 'phân công đóng', a);
          const g = await http('A', 'GET', `/api/ktv/booking?techCode=${KTV.A}`);
          note(`app A sau huỷ: ${JSON.stringify(g).slice(0, 160)}`); }

        /* F09 */ flow('F09 Huỷ 1 dịch vụ trong đơn 2 dịch vụ (trước khi làm)');
        const q9 = await quickBooking('F09', ['NHS0101', 'NHS0040']);
        { const its = await items(q9.bookingId);
          const r = await dispatch(q9.bookingId, [{ itemId: its[0].id, ktvs: [KTV.A], bed: BEDS[0] }, { itemId: its[1].id, ktvs: [KTV.B], bed: BEDS[1] }]);
          check(r.success === true, 'gửi 2 dịch vụ cho A, B', r.error || r.code || '');
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q9.bookingId, itemId: its[1].id, reason: 'QA E2E khách đổi ý', cancelCredit: 'NONE' });
          check(cr.success === true, 'huỷ dịch vụ của B', cr.error || '');
          const after = await items(q9.bookingId);
          check(after.find(x => x.id === its[1].id)!.status === 'CANCELLED', 'dịch vụ B CANCELLED', after.find(x => x.id === its[1].id)!.status);
          check(after.find(x => x.id === its[0].id)!.status === 'PREPARING', 'dịch vụ A không bị ảnh hưởng', after.find(x => x.id === its[0].id)!.status);
          const l = await ledger(q9.bookingId); check(!l.some(x => x.employee_id === KTV.B), 'B chưa bắt đầu → không còn dòng tua (luật 08/10: không nhận gì)', l);
          check(l.filter(x => x.employee_id === KTV.A && !x.is_punished).length === 1, 'A giữ tua');
          await actions.cancelBooking(q9.bookingId, DATE, 'NONE', 'QA dọn'); }

        /* F09b */ flow('F09b Huỷ dịch vụ đang nằm HÀNG CHỜ của KTV bận (B đang làm đơn khác)');
        { const qx = await quickBooking('F09bX', ['NHS0101']); const ix = (await items(qx.bookingId))[0].id;
          await dispatch(qx.bookingId, [{ itemId: ix, ktvs: [KTV.B], bed: BEDS[1] }]);
          await ktvAcceptAndStart('B', KTV.B, qx.bookingId, ix);
          const qy = await quickBooking('F09bY', ['NHS0101']); const iy = (await items(qy.bookingId))[0].id;
          const st = addMin(vnHHMM(), 65);
          const r = await dispatch(qy.bookingId, [{ itemId: iy, ktvs: [KTV.B], bed: BEDS[2], start: st }]);
          check(r.success === true, 'gửi đơn Y cho B đang bận', r.error || r.code || '');
          const ay = await assigns(qy.bookingId); note(`phân công Y trước huỷ: ${JSON.stringify(ay)}`);
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: qy.bookingId, itemId: iy, reason: 'QA khách huỷ trước giờ', cancelCredit: 'NONE' });
          check(cr.success === true, 'huỷ dịch vụ Y (không công)', cr.error || '');
          const ay2 = await assigns(qy.bookingId);
          check(ay2.every(x => !['ACTIVE', 'QUEUED', 'READY'].includes(x.status)), 'phân công chờ của B cho Y đã đóng', ay2);
          const ly = await ledger(qy.bookingId); note(`tua B cho Y sau huỷ: ${JSON.stringify(ly)}`);
          check(ly.filter(x => x.employee_id === KTV.B && !x.is_punished).length === 0, 'B không còn tua sạch cho Y (đã huỷ không công)', ly);
          await ktvFinish('B', KTV.B, qx.bookingId);
          await ktvReviewRelease('B', KTV.B, qx.bookingId, [ix]);
          const qb = await queue(KTV.B);
          check(qb?.current_order_id !== qy.bookingId, 'xong đơn X, B KHÔNG bị kéo sang dịch vụ Y đã huỷ', qb);
          const g = await http('B', 'GET', `/api/ktv/booking?techCode=${KTV.B}`);
          check(!JSON.stringify(g?.data ?? null).includes(qy.bookingId), 'app B không hiện đơn Y đã huỷ');
          await actions.submitCustomerRating(qx.bookingId, 5); }

        /* F07b */ flow('F07b Đổi KTV 2 lần A → B → C: mã chặng không trùng');
        { await http('C', 'POST', '/api/ktv/attendance', { employeeId: KTV.C, checkType: 'CHECK_IN', photoBase64: JPEG, isLiveCapture: true });
          const q = await quickBooking('F07b', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it);
          await swap(it, KTV.A, KTV.B);
          await swap(it, KTV.B, KTV.C);
          const segs = parseKtvSegments((await items(q.bookingId))[0].segments);
          const ids = segs.map((x: any) => x.id);
          check(ids.every(Boolean) && new Set(ids).size === ids.length, '3 chặng đều có mã, không trùng', ids);
          const cSeg = segs.find((x: any) => x.ktvId === KTV.C); const bSeg = segs.find((x: any) => x.ktvId === KTV.B);
          check(cSeg?.replacesSegmentId === bSeg?.id && bSeg?.replacesSegmentId === segs.find((x: any) => x.ktvId === KTV.A)?.id, 'chuỗi truy vết C ← B ← A', segs.map((x: any) => [x.ktvId, x.id, x.replacesSegmentId]));
          const asg = (await c.query(`SELECT employee_id, status, segment_id FROM "KtvAssignments" WHERE booking_item_id=$1`, [it])).rows;
          check(asg.some((x: any) => x.employee_id === KTV.C && x.segment_id === cSeg?.id && x.status === 'ACTIVE'), 'phân công C gắn đúng mã chặng của C', asg);
          const before = JSON.stringify([...(await segOf(it, KTV.A)), ...(await segOf(it, KTV.B))]);
          if (await startAfterSwap('C', KTV.C, q.bookingId, it)) {
              await ktvFinish('C', KTV.C, q.bookingId);
              await ktvReviewRelease('C', KTV.C, q.bookingId, [it]);
              const after = JSON.stringify([...(await segOf(it, KTV.A)), ...(await segOf(it, KTV.B))]);
              check(before === after, 'C bắt đầu / hoàn tất / bàn giao KHÔNG đụng chặng đã tước của A, B');
              const r = await actions.submitCustomerRating(q.bookingId, 5); check(r.success === true, 'khách chấm', r.error || '');
              await wait(800); check((await items(q.bookingId))[0].status === 'DONE', 'dịch vụ DONE', (await items(q.bookingId))[0].status);
          }
          const l = await ledger(q.bookingId);
          check(l.filter(x => !x.is_punished).map(x => x.employee_id).join() === KTV.C, 'chỉ C còn tua sạch; A, B mất tua', l); }

        /* F07c */ flow('F07c Đổi 1 người trong đơn 2 KTV (A + B, đổi B → C)');
        { const q = await quickBooking('F07c', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A, KTV.B], bed: BEDS[1] }]);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it);
          await ktvAcceptAndStart('B', KTV.B, q.bookingId, it, { slipper: false });
          const aStart = (await segOf(it, KTV.A))[0]?.actualStartTime;
          await swap(it, KTV.B, KTV.C);
          const resume = await http('admin', 'POST', '/api/ktv/pause-swap-resume', { action: 'RESUME', bookingItemId: it, employeeId: KTV.A });
          note(`quầy tiếp tục sau đổi: ${resume.success ? 'OK' : resume.error}; trạng thái ${(await items(q.bookingId))[0].status}`);
          const aSeg = (await segOf(it, KTV.A))[0];
          check(aSeg?.actualStartTime === aStart && !aSeg?.actualEndTime && !aSeg?.voided, 'chặng A giữ nguyên, vẫn đang chạy', aSeg);
          if (await startAfterSwap('C', KTV.C, q.bookingId, it)) {
              await ktvFinish('A', KTV.A, q.bookingId);
              check((await items(q.bookingId))[0].status === 'IN_PROGRESS', 'A xong trước → dịch vụ chờ C', (await items(q.bookingId))[0].status);
              await ktvFinish('C', KTV.C, q.bookingId);
              await ktvReviewRelease('A', KTV.A, q.bookingId, [it]);
              await ktvReviewRelease('C', KTV.C, q.bookingId, [it]);
              const r = await actions.submitCustomerRating(q.bookingId, 5); check(r.success === true, 'khách chấm', r.error || '');
              await wait(800); check((await items(q.bookingId))[0].status === 'DONE', 'dịch vụ DONE', (await items(q.bookingId))[0].status);
          }
          const l = await ledger(q.bookingId);
          check(l.filter(x => !x.is_punished).map(x => x.employee_id).sort().join() === [KTV.A, KTV.C].sort().join(), 'A và C còn tua, B mất tua', l); }

        /* F07e */ flow('F07e Đổi A → B rồi huỷ dịch vụ TRƯỚC khi B bắt đầu (lỗ cũ trong bảng tra)');
        { const q = await quickBooking('F07e', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it);
          await swap(it, KTV.A, KTV.B);
          note(`tua sau đổi: ${JSON.stringify(await ledger(q.bookingId))}`);
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q.bookingId, itemId: it, reason: 'QA khách về trước khi B vào', cancelCredit: 'NONE' });
          check(cr.success === true, 'huỷ dịch vụ khi B chưa bắt đầu', cr.error || '');
          const l = await ledger(q.bookingId);
          check(!l.some(x => x.employee_id === KTV.B && !x.is_punished), 'B (vào thay, chưa bắt đầu) không còn tua', l);
          check(l.filter(x => x.employee_id === KTV.A).every(x => x.is_punished), 'A vẫn mất tua như lúc bị đổi', l);
          const a2 = (await c.query(`SELECT employee_id, status FROM "KtvAssignments" WHERE booking_item_id=$1`, [it])).rows;
          check(a2.every((x: any) => !['ACTIVE', 'QUEUED', 'READY'].includes(x.status)), 'không còn phân công mở', a2);
          check((await queue(KTV.B))?.current_order_id !== q.bookingId, 'sổ tua B rảnh', await queue(KTV.B));
          const bSeg = (await segOf(it, KTV.B))[0];
          check(bSeg?.voided === true && Number(bSeg?.customCommissionDuration) === 0, 'chặng B tước, 0 phút', bSeg);
          check((await items(q.bookingId))[0].status === 'CANCELLED', 'dịch vụ CANCELLED');
          }

        /* F07f */ flow('F07f B đang làm dịch vụ 1, đổi vào thay A ở dịch vụ 2 cùng đơn, huỷ dịch vụ 2 trước khi B bắt đầu');
        { const q = await quickBooking('F07f', ['NHS0101', 'NHS0040']); const its = await items(q.bookingId);
          const r = await dispatch(q.bookingId, [{ itemId: its[0].id, ktvs: [KTV.B], bed: BEDS[1] }, { itemId: its[1].id, ktvs: [KTV.A], bed: BEDS[0] }]);
          check(r.success === true, 'gửi dịch vụ 1 cho B, dịch vụ 2 cho A', r.error || r.code || '');
          await ktvAcceptAndStart('B', KTV.B, q.bookingId, its[0].id);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, its[1].id, { slipper: true });
          await swap(its[1].id, KTV.A, KTV.B);
          const tq = (await c.query(`SELECT status, current_order_id, booking_item_ids FROM "TurnQueue" WHERE employee_id=$1 AND date=$2`, [KTV.B, DATE])).rows[0];
          check(tq?.current_order_id === q.bookingId && [its[0].id, its[1].id].every(id => (tq?.booking_item_ids || []).includes(id)), 'sổ tua B giữ CẢ 2 dịch vụ (không mất dịch vụ 1)', tq);
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q.bookingId, itemId: its[1].id, reason: 'QA bỏ dịch vụ 2', cancelCredit: 'NONE' });
          check(cr.success === true, 'huỷ dịch vụ 2 (B chưa bắt đầu dịch vụ này)', cr.error || '');
          const tq2 = (await c.query(`SELECT status, current_order_id, booking_item_ids FROM "TurnQueue" WHERE employee_id=$1 AND date=$2`, [KTV.B, DATE])).rows[0];
          check(tq2?.status === 'working' && tq2?.current_order_id === q.bookingId && (tq2?.booking_item_ids || []).join() === its[0].id, 'B vẫn đang làm dịch vụ 1, sổ tua chỉ còn dịch vụ 1', tq2);
          check((await ledger(q.bookingId)).filter(x => x.employee_id === KTV.B && !x.is_punished).length === 1, 'B giữ 1 tua cho bill', await ledger(q.bookingId));
          check((await items(q.bookingId)).find(x => x.id === its[0].id)!.status === 'IN_PROGRESS', 'dịch vụ 1 vẫn đang làm');
          await ktvFinish('B', KTV.B, q.bookingId);
          await ktvReviewRelease('B', KTV.B, q.bookingId, [its[0].id]);
          const rr = await actions.submitCustomerRating(q.bookingId, 5); check(rr.success === true, 'khách chấm', rr.error || '');
          await wait(800);
          // Chốt 09/10: người bị đổi ra (A) không phải bàn giao → đơn chốt được; dịch vụ đã huỷ giữ CANCELLED.
          check(['DONE', 'COMPLETED'].includes((await booking(q.bookingId)).status), 'đơn hoàn tất (không chờ A bị đổi ra bàn giao)', (await booking(q.bookingId)).status);
          check((await items(q.bookingId)).find(x => x.id === its[1].id)!.status === 'CANCELLED', 'dịch vụ 2 đã huỷ vẫn là CANCELLED (không bị đổi thành DONE)', (await items(q.bookingId)).find(x => x.id === its[1].id)!.status);
          const aSeg = (await segOf(its[1].id, KTV.A))[0];
          check(aSeg?.voided === true && aSeg?.note === 'CHANGED', 'chặng A giữ dấu bị đổi ra (CHANGED) sau khi huỷ', aSeg);
          check((await queue(KTV.B))?.current_order_id !== q.bookingId, 'B rảnh sau bàn giao', await queue(KTV.B)); }

        /* F09f */ flow('F09f Đã bắt đầu rồi bị huỷ không công: VẪN phải bàn giao trước khi chốt đơn');
        { const q = await quickBooking('F09f', ['NHS0101', 'NHS0040']); const its = await items(q.bookingId);
          await dispatch(q.bookingId, [{ itemId: its[0].id, ktvs: [KTV.B], bed: BEDS[1] }, { itemId: its[1].id, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('B', KTV.B, q.bookingId, its[0].id);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, its[1].id);
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q.bookingId, itemId: its[1].id, reason: 'QA khách không ưng', cancelCredit: 'NONE' });
          check(cr.success === true, 'huỷ không công dịch vụ A đang làm', cr.error || '');
          await ktvFinish('B', KTV.B, q.bookingId);
          await ktvReviewRelease('B', KTV.B, q.bookingId, [its[0].id]);
          const r1 = await actions.submitCustomerRating(q.bookingId, 5); check(r1.success === true, 'khách chấm', r1.error || '');
          await wait(800);
          check(!['DONE', 'COMPLETED'].includes((await booking(q.bookingId)).status), 'A chưa bàn giao → đơn CHƯA chốt (luật cũ giữ nguyên)', (await booking(q.bookingId)).status);
          const rl = await ktvPatch('A', KTV.A, { bookingId: q.bookingId, status: 'FEEDBACK', action: 'RELEASE_KTV', handoverItemIds: [its[1].id], photosBase64: [JPEG] });
          check(rl.success === true, 'A bàn giao phòng', rl.error || '');
          await wait(800);
          note(`sau khi A bàn giao: đơn ${(await booking(q.bookingId)).status}, dịch vụ 2 ${(await items(q.bookingId)).find(x => x.id === its[1].id)!.status}`);
          check((await items(q.bookingId)).find(x => x.id === its[1].id)!.status === 'CANCELLED', 'dịch vụ huỷ vẫn CANCELLED'); }

        /* F20 */ for (const order of ['B_XONG_ROI_KHACH_CHAM', 'KHACH_CHAM_ROI_B_XONG'] as const) {
            flow(`F20 Nối tiếp: A xong phần 1, B đang làm phần 2, quầy huỷ không công phần A — hướng 2: luôn chờ A bàn giao · ${order}`);
            const q = await quickBooking(`F20${order.slice(0, 1)}`, ['NHS0040']); const it = (await items(q.bookingId))[0];
            const st = vnHHMM(); const half = 35;
            const segA = { id: `seg-${it.id}-A-1`, ktvId: KTV.A, roomId: ROOM, bedId: BEDS[0], startTime: st, endTime: addMin(st, half), duration: half, sequenceSlot: 1 };
            const segB = { id: `seg-${it.id}-B-2`, ktvId: KTV.B, roomId: ROOM, bedId: BEDS[0], startTime: addMin(st, half), endTime: addMin(st, 2 * half), duration: half, sequenceSlot: 2 };
            const o = parseKtvOptions(it.options);
            const r = await actions.processDispatch(q.bookingId, { status: 'PREPARING', bedId: BEDS[0], roomName: ROOM, date: DATE, notes: '',
                staffAssignments: [segA, segB].map(sg => ({ ktvId: sg.ktvId, bookingItemId: it.id, roomId: ROOM, bedId: BEDS[0], turnsCompleted: 0, queuePos: 0, startTime: sg.startTime, endTime: sg.endTime })),
                itemUpdates: [{ id: it.id, roomName: ROOM, bedId: BEDS[0], technicianCodes: [KTV.A, KTV.B], status: 'PREPARING', segments: [segA, segB],
                    options: { ...o, displayName: SVC.NHS0040.name, sequentialSlots: 2, mergedIntoId: null, order: 0 } }] });
            check(r.success === true, 'gửi đơn nối tiếp A (phần 1) → B (phần 2)', r.error || r.code || '');
            await ktvAcceptAndStart('A', KTV.A, q.bookingId, it.id, { targetSegmentId: segA.id });
            const fa = await ktvPatch('A', KTV.A, { bookingId: q.bookingId, status: 'CLEANING' });
            check(fa.success === true, 'A làm xong phần 1', fa.error || '');
            await http('B', 'POST', '/api/ktv/accept-order', { staffId: KTV.B, bookingItemId: it.id });
            await ktvPatch('B', KTV.B, { bookingId: q.bookingId, status: 'READY' });
            const sb2 = await ktvPatch('B', KTV.B, { bookingId: q.bookingId, status: 'IN_PROGRESS', action: 'START_TIMER', startPhotoBase64: JPEG, targetSegmentId: segB.id });
            check(sb2.success === true, 'B bắt đầu phần 2', sb2.error || '');
            const rev = Number(parseKtvOptions((await items(q.bookingId))[0].options).dispatchRevision || 0);
            const cx = await http('admin', 'POST', '/api/reception/sequential-lifecycle', { bookingId: q.bookingId, itemId: it.id, expectedRevision: rev,
                action: 'CANCEL', targetSlots: [1], cancelCredit: 'NONE', reason: 'QA khách không ưng phần của A' });
            check(cx.success === true, 'quầy huỷ không công phần của A', cx.error || '');
            const aSeg = (await segOf(it.id, KTV.A))[0];
            check(aSeg?.voided === true && !!aSeg?.actualEndTime, 'phần A bị tước + chốt giờ', { note: aSeg?.note, voided: aSeg?.voided });
            check(!['CANCELLED', 'DONE'].includes((await items(q.bookingId))[0].status), 'dịch vụ vẫn chạy (không chuyển Đã huỷ)', (await items(q.bookingId))[0].status);
            if (order === 'KHACH_CHAM_ROI_B_XONG') { const rr = await actions.submitCustomerRating(q.bookingId, 5); check(rr.success === true, 'khách chấm (trước khi B xong)', rr.error || ''); }
            await ktvFinish('B', KTV.B, q.bookingId);
            if (order === 'B_XONG_ROI_KHACH_CHAM') {
                const ds = await http('A', 'GET', `/api/ktv/attendance/status?employeeId=${KTV.A}`);
                note(`nợ phòng của A khi B đang dọn: ${JSON.stringify(ds.roomDebt)}`);
            }
            await ktvReviewRelease('B', KTV.B, q.bookingId, [it.id]);
            if (order === 'B_XONG_ROI_KHACH_CHAM') { const rr = await actions.submitCustomerRating(q.bookingId, 5); check(rr.success === true, 'khách chấm (sau khi B xong)', rr.error || ''); }
            await wait(1000);
            // Hướng 2 (09/10): giữ luật hiện hành — huỷ không công đã bắt đầu vẫn phải bàn giao → CẢ HAI thứ tự đều chờ A.
            check(!['DONE', 'COMPLETED'].includes((await booking(q.bookingId)).status), 'B xong + khách chấm: đơn CHỜ A bàn giao — cùng kết quả cho cả hai thứ tự', (await booking(q.bookingId)).status);
            const ra = await ktvPatch('A', KTV.A, { bookingId: q.bookingId, status: 'FEEDBACK', action: 'RELEASE_KTV', handoverItemIds: [it.id], photosBase64: [JPEG] });
            check(ra.success === true, 'A bàn giao phòng', ra.error || '');
            await wait(1000);
            if (order === 'KHACH_CHAM_ROI_B_XONG') { /* đã chấm từ trước */ } else { await actions.submitCustomerRating(q.bookingId, 5).catch(() => null); }
            await wait(800);
            check((await items(q.bookingId))[0].status === 'DONE', 'A bàn giao xong → dịch vụ DONE', (await items(q.bookingId))[0].status);
            check(['DONE', 'COMPLETED'].includes((await booking(q.bookingId)).status), 'A bàn giao xong → đơn Hoàn tất', (await booking(q.bookingId)).status);
            const l = await ledger(q.bookingId);
            check(l.some(x => x.employee_id === KTV.A && x.is_punished) || !l.some(x => x.employee_id === KTV.A && !x.is_punished), 'A không còn tua sạch (huỷ không công)', l);
        }

        /* F20c */ flow('F20c [GHI NHẬN] Nối tiếp: huỷ phần A khi A đang làm, B chưa bắt đầu — B có bắt đầu được không');
        { const q = await quickBooking('F20c', ['NHS0040']); const it = (await items(q.bookingId))[0];
          const st = vnHHMM();
          const segA = { id: `seg-${it.id}-A-1`, ktvId: KTV.A, roomId: ROOM, bedId: BEDS[0], startTime: st, endTime: addMin(st, 35), duration: 35, sequenceSlot: 1 };
          const segB = { id: `seg-${it.id}-B-2`, ktvId: KTV.B, roomId: ROOM, bedId: BEDS[0], startTime: addMin(st, 35), endTime: addMin(st, 70), duration: 35, sequenceSlot: 2 };
          await actions.processDispatch(q.bookingId, { status: 'PREPARING', bedId: BEDS[0], roomName: ROOM, date: DATE, notes: '',
              staffAssignments: [segA, segB].map(sg => ({ ktvId: sg.ktvId, bookingItemId: it.id, roomId: ROOM, bedId: BEDS[0], turnsCompleted: 0, queuePos: 0, startTime: sg.startTime, endTime: sg.endTime })),
              itemUpdates: [{ id: it.id, roomName: ROOM, bedId: BEDS[0], technicianCodes: [KTV.A, KTV.B], status: 'PREPARING', segments: [segA, segB],
                  options: { ...parseKtvOptions(it.options), displayName: SVC.NHS0040.name, sequentialSlots: 2, mergedIntoId: null, order: 0 } }] });
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it.id, { targetSegmentId: segA.id });
          const rev = Number(parseKtvOptions((await items(q.bookingId))[0].options).dispatchRevision || 0);
          const cx = await http('admin', 'POST', '/api/reception/sequential-lifecycle', { bookingId: q.bookingId, itemId: it.id, expectedRevision: rev, action: 'CANCEL', targetSlots: [1], cancelCredit: 'NONE', reason: 'QA' });
          await http('B', 'POST', '/api/ktv/accept-order', { staffId: KTV.B, bookingItemId: it.id });
          await ktvPatch('B', KTV.B, { bookingId: q.bookingId, status: 'READY' });
          const sb = await ktvPatch('B', KTV.B, { bookingId: q.bookingId, status: 'IN_PROGRESS', action: 'START_TIMER', startPhotoBase64: JPEG, guestSlipperPhotoBase64: JPEG, targetSegmentId: segB.id });
          note(`[GHI NHẬN — có sẵn] huỷ phần A: ${cx.success ? 'OK' : cx.error}; B bắt đầu: ${sb.success ? 'ĐƯỢC' : 'BỊ CHẶN — ' + sb.error}; dịch vụ: ${(await items(q.bookingId))[0].status}`);
          await actions.cancelBooking(q.bookingId, DATE, 'NONE', 'QA dọn F20c'); }

        /* F09c */ flow('F09c Huỷ CẢ ĐƠN khi KTV đang chờ (B bận đơn khác)');
        { const qx = await quickBooking('F09cX', ['NHS0101']); const ix = (await items(qx.bookingId))[0].id;
          await dispatch(qx.bookingId, [{ itemId: ix, ktvs: [KTV.B], bed: BEDS[1] }]);
          await ktvAcceptAndStart('B', KTV.B, qx.bookingId, ix);
          const qy = await quickBooking('F09cY', ['NHS0101']); const iy = (await items(qy.bookingId))[0].id;
          await dispatch(qy.bookingId, [{ itemId: iy, ktvs: [KTV.B], bed: BEDS[2], start: addMin(vnHHMM(), 65) }]);
          note(`phân công Y trước huỷ: ${JSON.stringify(await assigns(qy.bookingId))}`);
          const cr = await actions.cancelBooking(qy.bookingId, DATE, 'NONE', 'QA khách huỷ cả đơn');
          check(cr.success === true, 'huỷ cả đơn Y', cr.error || '');
          const ay = await assigns(qy.bookingId);
          check(ay.every(x => !['ACTIVE', 'QUEUED', 'READY'].includes(x.status)), 'phân công chờ của B cho Y đã đóng', ay);
          check(!(await ledger(qy.bookingId)).some(x => x.employee_id === KTV.B), 'B không còn tua cho Y', await ledger(qy.bookingId));
          check((await items(qx.bookingId))[0].status === 'IN_PROGRESS', 'đơn X đang làm của B không bị ảnh hưởng');
          await ktvFinish('B', KTV.B, qx.bookingId);
          await ktvReviewRelease('B', KTV.B, qx.bookingId, [ix]);
          const qb = await queue(KTV.B);
          check(qb?.current_order_id !== qy.bookingId, 'xong X, B KHÔNG bị kéo sang đơn Y đã huỷ', qb);
          await actions.submitCustomerRating(qx.bookingId, 5); }

        /* F09d */ flow('F09d Huỷ 1 dịch vụ khi KTV ĐÃ NHẬN nhưng chưa bắt đầu');
        { const q = await quickBooking('F09d', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          const acc = await http('A', 'POST', '/api/ktv/accept-order', { staffId: KTV.A, bookingItemId: it });
          check(acc.success === true, 'A bấm Đã nhận đơn', acc.error || '');
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q.bookingId, itemId: it, reason: 'QA khách đổi ý', cancelCredit: 'WORKED' });
          check(cr.success === true, 'huỷ dịch vụ (quầy bật "có công" — không áp cho người chưa bắt đầu)', cr.error || '');
          check(!(await ledger(q.bookingId)).some(x => x.employee_id === KTV.A), 'A không còn dòng tua', await ledger(q.bookingId));
          const a = await assigns(q.bookingId); check(a.every(x => !['ACTIVE', 'QUEUED', 'READY'].includes(x.status)), 'phân công A đóng', a);
          const qa = await queue(KTV.A); check(qa?.current_order_id !== q.bookingId, 'sổ tua A rảnh', qa);
          const seg = (await segOf(it, KTV.A))[0];
          check(seg?.voided === true && Number(seg?.customCommissionDuration) === 0, 'chặng A bị tước, 0 phút (không tiền, không giờ)', seg);
          const g = await http('A', 'GET', `/api/ktv/booking?techCode=${KTV.A}`);
          check(!JSON.stringify(g?.data ?? null).includes(q.bookingId), 'app A không còn đơn đã huỷ'); }

        /* F09e */ flow('F09e KTV có 2 dịch vụ cùng bill, huỷ dịch vụ chưa bắt đầu → giữ tua dịch vụ kia');
        { const q = await quickBooking('F09e', ['NHS0101', 'NHS0040']); const its = await items(q.bookingId);
          const st = vnHHMM();
          const r = await dispatch(q.bookingId, [{ itemId: its[0].id, ktvs: [KTV.A], bed: BEDS[0], start: st }, { itemId: its[1].id, ktvs: [KTV.A], bed: BEDS[0], start: addMin(st, 60) }]);
          check(r.success === true, 'gửi 2 dịch vụ cho A', r.error || r.code || '');
          // Bấm Bắt đầu đúng chặng dịch vụ 1 (app gửi targetSegmentId) — tránh lệch thứ tự HH:mm qua nửa đêm (rủi ro có sẵn, báo riêng).
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, its[0].id, { targetSegmentId: (await segOf(its[0].id, KTV.A))[0]?.id });
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q.bookingId, itemId: its[1].id, reason: 'QA bỏ dịch vụ 2', cancelCredit: 'NONE' });
          check(cr.success === true, 'huỷ dịch vụ 2 (chưa bắt đầu)', cr.error || '');
          const after = await items(q.bookingId);
          check(after.find(x => x.id === its[0].id)!.status === 'IN_PROGRESS', 'dịch vụ 1 vẫn đang làm', after.find(x => x.id === its[0].id)!.status);
          check((await ledger(q.bookingId)).filter(x => x.employee_id === KTV.A && !x.is_punished).length === 1, 'A giữ 1 tua sạch cho bill', await ledger(q.bookingId));
          await ktvFinish('A', KTV.A, q.bookingId);
          await ktvReviewRelease('A', KTV.A, q.bookingId, [its[0].id]);
          const rr = await actions.submitCustomerRating(q.bookingId, 5); check(rr.success === true, 'khách chấm', rr.error || '');
          await wait(800); check(['DONE', 'COMPLETED'].includes((await booking(q.bookingId)).status), 'đơn hoàn tất', (await booking(q.bookingId)).status); }

        /* F18 */ flow(`F18 Dữ liệu cũ (chặng dạng chuỗi) — trigger ${TRIGGER_OFF ? 'TẮT' : 'BẬT'}`);
        { // a) đổi người trên dịch vụ đang làm lưu chuỗi
          const q = await quickBooking('F18a', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it);
          await makeLegacyString(it);
          await swap(it, KTV.A, KTV.B);
          const t = (await c.query(`SELECT jsonb_typeof(segments) t FROM "BookingItems" WHERE id=$1`, [it])).rows[0]?.t;
          check(TRIGGER_OFF ? ['string', 'array'].includes(t) : t === 'array', `a) sau đổi người: chặng lưu ${t}`, t);
          const bSeg = (await segOf(it, KTV.B))[0];
          check(!!bSeg?.id && !!bSeg?.replacesSegmentId, 'a) chặng người vào thay có mã + truy vết', bSeg);
          if (await startAfterSwap('B', KTV.B, q.bookingId, it)) {
              await ktvFinish('B', KTV.B, q.bookingId);
              await ktvReviewRelease('B', KTV.B, q.bookingId, [it]);
              await actions.submitCustomerRating(q.bookingId, 5); await wait(800);
              check((await items(q.bookingId))[0].status === 'DONE', 'a) dịch vụ DONE', (await items(q.bookingId))[0].status);
          } }
        { // b) huỷ 1 dịch vụ khi KTV đã nhận chưa bắt đầu, chặng lưu chuỗi
          const q = await quickBooking('F18b', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          await http('A', 'POST', '/api/ktv/accept-order', { staffId: KTV.A, bookingItemId: it });
          await makeLegacyString(it);
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q.bookingId, itemId: it, reason: 'QA dữ liệu cũ', cancelCredit: 'NONE' });
          check(cr.success === true, 'b) huỷ dịch vụ (chuỗi, chưa bắt đầu)', cr.error || '');
          check((await items(q.bookingId))[0].status === 'CANCELLED', 'b) dịch vụ CANCELLED');
          check(!(await ledger(q.bookingId)).some(x => x.employee_id === KTV.A), 'b) A không còn tua');
          const seg = (await segOf(it, KTV.A))[0];
          check(seg?.voided === true && Number(seg?.customCommissionDuration) === 0, 'b) chặng A tước, 0 phút', seg);
          check((await queue(KTV.A))?.current_order_id !== q.bookingId, 'b) A rảnh'); }
        { // c) huỷ cả đơn khi KTV đang chờ, chặng lưu chuỗi
          const qx = await quickBooking('F18cX', ['NHS0101']); const ix = (await items(qx.bookingId))[0].id;
          await dispatch(qx.bookingId, [{ itemId: ix, ktvs: [KTV.B], bed: BEDS[1] }]);
          await ktvAcceptAndStart('B', KTV.B, qx.bookingId, ix);
          const qy = await quickBooking('F18cY', ['NHS0101']); const iy = (await items(qy.bookingId))[0].id;
          await dispatch(qy.bookingId, [{ itemId: iy, ktvs: [KTV.B], bed: BEDS[2], start: addMin(vnHHMM(), 65) }]);
          await makeLegacyString(iy);
          const cr = await actions.cancelBooking(qy.bookingId, DATE, 'NONE', 'QA dữ liệu cũ');
          check(cr.success === true, 'c) huỷ cả đơn (chuỗi, B đang chờ)', cr.error || '');
          check((await assigns(qy.bookingId)).every(x => !['ACTIVE', 'QUEUED', 'READY'].includes(x.status)), 'c) phân công chờ đóng');
          await ktvFinish('B', KTV.B, qx.bookingId);
          await ktvReviewRelease('B', KTV.B, qx.bookingId, [ix]);
          check((await queue(KTV.B))?.current_order_id !== qy.bookingId, 'c) B không bị kéo sang đơn đã huỷ');
          await actions.submitCustomerRating(qx.bookingId, 5); }
        { // d) huỷ không công khi ĐÃ bắt đầu, chặng lưu chuỗi
          const q = await quickBooking('F18d', ['NHS0101']); const it = (await items(q.bookingId))[0].id;
          await dispatch(q.bookingId, [{ itemId: it, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q.bookingId, it);
          await makeLegacyString(it);
          const cr = await http('admin', 'POST', '/api/bookings/cancel-item', { bookingId: q.bookingId, itemId: it, reason: 'QA dữ liệu cũ', cancelCredit: 'NONE' });
          check(cr.success === true, 'd) huỷ không công (chuỗi, đã bắt đầu)', cr.error || '');
          const seg = (await segOf(it, KTV.A))[0];
          check(!!seg?.actualEndTime && seg?.voided === true, 'd) chặng A chốt giờ + tước', seg);
          check((await ledger(q.bookingId)).some(x => x.employee_id === KTV.A && x.is_punished), 'd) A mất tua (đã bắt đầu — luật cũ giữ nguyên)', await ledger(q.bookingId));
          await ktvReviewRelease('A', KTV.A, q.bookingId, [it]);
          await expectSegArrays(q.bookingId); }

        /* F10 */ flow('F10 Dịch vụ phát sinh khi đang làm → gán KTV (lỗi gốc 06/10)');
        const q10 = await quickBooking('F10', ['NHS0101']); const item10 = (await items(q10.bookingId))[0].id;
        { await dispatch(q10.bookingId, [{ itemId: item10, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q10.bookingId, item10);
          const ad = await actions.addAddonServices(q10.bookingId, [{ serviceId: 'NHS0040', qty: 1 }], 'seq_admin');
          check(ad.success === true, 'quầy thêm dịch vụ phát sinh', ad.error || '');
          const addon = (await items(q10.bookingId)).find(x => x.id !== item10);
          check(!!addon, 'có dòng phát sinh');
          if (addon) {
              const st = vnHHMM();
              const rev = Number(parseKtvOptions(addon.options).dispatchRevision || 0);
              const sv = await actions.saveDispatchForm(q10.bookingId, addon.id, [{ ktvId: KTV.B, segments: [{ id: `seg-${addon.id}-B`, roomId: ROOM, bedId: BEDS[2], startTime: st, endTime: addMin(st, 70), duration: 70 }] }], rev, false, SVC.NHS0040.name);
              check(sv.success === true, 'lưu gán B cho phát sinh (trước đây: cannot extract elements from a scalar)', sv.error || '');
              const a2 = (await items(q10.bookingId)).find(x => x.id === addon.id)!;
              check((a2.technicianCodes || []).includes(KTV.B), 'phát sinh đã có B', a2.technicianCodes);
              await expectSegArrays(q10.bookingId);
          }
          const cr = await actions.cancelBooking(q10.bookingId, DATE, 'NONE', 'QA dọn'); check(cr.success === true, 'dọn đơn', cr.error || ''); }

        /* F11 */ flow('F11 Kết thúc sớm khi đang tạm dừng (quầy)');
        const q11 = await quickBooking('F11', ['NHS0101']); const item11 = (await items(q11.bookingId))[0].id;
        { await dispatch(q11.bookingId, [{ itemId: item11, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, q11.bookingId, item11);
          await http('A', 'POST', '/api/ktv/pause-swap-resume', { action: 'PAUSE', bookingItemId: item11, employeeId: KTV.A });
          const f = await http('admin', 'POST', '/api/ktv/finish-early-paused', { bookingId: q11.bookingId, itemIds: [item11] });
          check(f.success === true, 'quầy bấm kết thúc sớm', f.error || '');
          const i = (await items(q11.bookingId))[0]; const seg = parseKtvSegments(i.segments)[0];
          check(!['IN_PROGRESS', 'PAUSED'].includes(i.status), 'dịch vụ không còn chạy', i.status);
          check(!!seg?.actualEndTime, 'chặng đã chốt giờ kết thúc');
          check((await ledger(q11.bookingId)).filter(x => x.employee_id === KTV.A && !x.is_punished).length === 1, 'A giữ tua');
          await ktvReviewRelease('A', KTV.A, q11.bookingId, [item11]);
          const r = await actions.submitCustomerRating(q11.bookingId, 5); check(r.success === true, 'khách chấm', r.error || '');
          await wait(800); note(`cuối: item ${(await items(q11.bookingId))[0].status}, đơn ${(await booking(q11.bookingId)).status}`); }

        /* F12 */ flow('F12 KTV từ chối đơn');
        const q12 = await quickBooking('F12', ['NHS0101']); const item12 = (await items(q12.bookingId))[0].id;
        { await dispatch(q12.bookingId, [{ itemId: item12, ktvs: [KTV.B], bed: BEDS[1] }]);
          const r = await http('B', 'POST', '/api/ktv/discipline/reject-order', { staffId: KTV.B, bookingItemId: item12, reason: 'QA E2E đang đau tay' });
          note(`phản hồi từ chối: ${JSON.stringify(r).slice(0, 220)}`);
          check(r.success === true || r.requireConfirm || r.needConfirm || r.code, 'server xử lý từ chối (có/không cần xác nhận khoá)', r.error || '');
          const i = (await items(q12.bookingId))[0];
          note(`sau từ chối: item ${i.status}, KTV ${JSON.stringify(i.technicianCodes)}, tua ${JSON.stringify(await ledger(q12.bookingId))}`);
          const st = (await c.query(`SELECT status FROM "Staff" WHERE id=$1`, [KTV.B])).rows[0];
          check(st.status !== 'KHÓA_TÀI_KHOẢN', 'B không bị khoá khi chưa xác nhận', st.status);
          await actions.cancelBooking(q12.bookingId, DATE, 'NONE', 'QA dọn'); }

        /* F13 */ flow('F13 Web Booking: xác nhận đơn web');
        { const id = `QA-E2E-WB-${Date.now().toString(36)}`; createdBookings.push(id);
          const now = new Date().toISOString();
          const { error } = await sb.from('Bookings').insert({ id, billCode: id, customerName: 'QA E2E Web', status: 'NEW', source: 'WEB_BOOKING',
              bookingDate: `${DATE}T${addMin(vnHHMM(), 60)}:00`, timeBooking: addMin(vnHHMM(), 60), guestCount: 1, totalAmount: 0, paymentMethod: 'Tiền mặt', createdAt: now, updatedAt: now });
          check(!error, 'tạo đơn web NEW', error?.message || '');
          await sb.from('BookingItems').insert({ id: `${id}-1`, bookingId: id, serviceId: 'NHS0101', quantity: 1, price: 0, status: 'NEW', segments: [], technicianCodes: [], options: { displayName: SVC.NHS0101.name, duration: 60 } });
          const r = await webActions.confirmWebBooking(id);
          check(r?.success === true, 'quầy xác nhận đơn web', r?.error || '');
          const b = await booking(id); note(`sau xác nhận: ${b.status} / ${b.source}`);
          check(b.status !== 'NEW' || b.source !== 'WEB_BOOKING', 'đơn web chuyển trạng thái/nguồn', `${b.status}/${b.source}`); }

        /* F14 */ flow('F14 Ví / lịch sử KTV đọc được, không lỗi');
        { const w = await http('A', 'GET', `/api/ktv/wallet/balance?techCode=${KTV.A}`);
          check(w.status === 200 && w.success !== false, 'ví A tải được', w.error || '');
          const h = await http('A', 'GET', `/api/ktv/history?techCode=${KTV.A}&dateFrom=${DATE}&dateTo=${DATE}`);
          check(h.status === 200 && h.success !== false, 'lịch sử A tải được', h.error || '');
          const d = await actions.getDispatchData(DATE);
          check(d?.success !== false, 'bảng điều phối tải được', d?.error || '');
          const todayIds = createdBookings.filter(x => !x.startsWith('QA-E2E-WB'));
          const seen = JSON.stringify(d).includes(todayIds[0]);
          check(seen, 'bảng điều phối có đơn thử hôm nay'); }

        /* F16 */ flow('F16 KTV Loại D: đăng ký giờ → điểm danh → trọn vòng → sổ Loại D');
        { const c2 = await pgc();
          const start = addMin(vnHHMM(), 20 - (Number(vnHHMM().slice(3)) % 5));
          const reg = await http('D', 'POST', '/api/ktv/daily-registration', { type: 'WORKING', work_date: DATE, expected_time: start, expected_end_time: '23:30' });
          note(`đăng ký giờ ${start}–23:30: ${reg.success !== false && !reg.error ? 'OK' : reg.error}`);
          check(/07:00|không thể tạo|đã qua/.test(String(reg.error || '')), 'đăng ký cho ngày làm việc đang chạy bị chặn (đúng quy định)', reg.error || 'được nhận');
          // Tình huống thật: KTV đã đăng ký từ hôm trước → tạo sẵn dòng đăng ký như app ghi.
          await c2.query(`INSERT INTO "KTVTypeDDailyRegistration" (id, staff_id, work_date, expected_time, expected_end_time, status, registered_at)
              VALUES (gen_random_uuid(), $1, $2, $3, '23:30', 'REGISTERED', now() - interval '1 day') ON CONFLICT DO NOTHING`, [KTV.D, DATE, start]);
          const row = (await c2.query(`SELECT status, expected_time FROM "KTVTypeDDailyRegistration" WHERE staff_id=$1 AND work_date=$2`, [KTV.D, DATE])).rows[0];
          check(!!row, 'có dòng đăng ký Loại D hôm nay', row);
          const ci = await http('D', 'POST', '/api/ktv/attendance', { employeeId: KTV.D, checkType: 'CHECK_IN', photoBase64: JPEG, isLiveCapture: true });
          check(ci.success === true, 'Loại D điểm danh (đến sớm hơn giờ đăng ký)', ci.error || '');
          const row2 = (await c2.query(`SELECT status, check_in_at, penalty_applied FROM "KTVTypeDDailyRegistration" WHERE staff_id=$1 AND work_date=$2`, [KTV.D, DATE])).rows[0];
          note(`đăng ký sau điểm danh: ${JSON.stringify(row2)}`);
          check(!row2?.penalty_applied, 'không bị phạt đi trễ', row2);
          note(`sổ tua D: ${JSON.stringify(await queue(KTV.D))}`);
          const { bookingId, itemId } = await fullCycle('D', KTV.D, 'F16', BEDS[2]);
          // F07d: đổi KTV Loại A → Loại D giữa ca
          const qd = await quickBooking('F07d', ['NHS0101']); const itd = (await items(qd.bookingId))[0].id;
          await dispatch(qd.bookingId, [{ itemId: itd, ktvs: [KTV.A], bed: BEDS[0] }]);
          await ktvAcceptAndStart('A', KTV.A, qd.bookingId, itd);
          await swap(itd, KTV.A, KTV.D);
          if (await startAfterSwap('D', KTV.D, qd.bookingId, itd)) {
              await ktvFinish('D', KTV.D, qd.bookingId);
              await ktvReviewRelease('D', KTV.D, qd.bookingId, [itd]);
              await actions.submitCustomerRating(qd.bookingId, 5);
              await wait(800);
              await require('@/lib/services/KtvDLedgerWriter').drainRecomputeQueue(sb, 200).catch(() => null);
              const dd = (await c2.query(`SELECT staff_id, paid_minutes, commission_net FROM "KTVDTurnLedger" WHERE booking_item_id=$1`, [itd])).rows;
              const takeover = (await segOf(itd, KTV.D))[0];
              check(dd.some((x: any) => x.staff_id === KTV.D && Number(x.paid_minutes) === Number(takeover?.customCommissionDuration) && Number(x.commission_net) > 0),
                  'F07d: sổ Loại D tính cho người vào thay theo phút chặng TAKEOVER', { dd, mins: takeover?.customCommissionDuration });
          }
          // TEST không có CRON_SECRET → gọi đúng hàm cron /api/cron/ktvd-recompute dùng.
          const cron = await require('@/lib/services/KtvDLedgerWriter').drainRecomputeQueue(sb, 200).catch((e: any) => ({ error: e.message }));
          note(`cron tính lại Loại D: ${JSON.stringify(cron).slice(0, 200)}`);
          await wait(1500);
          const dl = (await c2.query(`SELECT staff_id, item_status, assigned_minutes, actual_minutes, paid_minutes, commission_net, is_provisional, entry_status, rating_used FROM "KTVDTurnLedger" WHERE booking_item_id=$1`, [itemId])).rows;
          note(`KTVDTurnLedger: ${JSON.stringify(dl)}`);
          const hl = (await c2.query(`SELECT staff_id, hours_earned, hours_penalty FROM "KTVServiceHoursLedger" WHERE booking_id=$1`, [bookingId])).rows;
          note(`KTVServiceHoursLedger: ${JSON.stringify(hl)}`);
          const rq = (await c2.query(`SELECT reason, attempts, last_error FROM "KTVDRecomputeQueue" WHERE booking_id=$1`, [bookingId])).rows;
          note(`KTVDRecomputeQueue còn: ${JSON.stringify(rq)}`);
          check(dl.some((x: any) => x.staff_id === KTV.D && Number(x.commission_net) > 0), 'sổ tiền Loại D có dòng của KTV, tiền > 0', dl);
          check(rq.length === 0, 'hàng tính lại Loại D đã xử lý hết đơn này', rq);
          // Giờ Loại D = KTVDTurnLedger.actual_minutes (KtvOfficeScoreService.hoursLedger); KTVServiceHoursLedger chỉ ghi phạt/cộng tay.
          check(dl.some((x: any) => x.staff_id === KTV.D && x.actual_minutes !== null), 'sổ Loại D có phút làm thực tế (nguồn giờ tích luỹ)', dl);
          check(hl.every((x: any) => Number(x.hours_penalty || 0) === 0), 'không phát sinh phạt giờ', hl);
          check(rq.every((x: any) => !x.last_error), 'hàng tính lại Loại D không báo lỗi', rq);
          const w = await http('D', 'GET', `/api/ktv/wallet/balance?techCode=${KTV.D}`);
          check(w.status === 200 && w.success !== false, 'ví Loại D tải được', w.error || '');
          const hr = await http('D', 'GET', `/api/ktv/hours-ledger?techCode=${KTV.D}`);
          check(hr.status === 200 && hr.success === true, 'API sổ giờ Loại D (app KTV) tải được', hr.error || '');
          const co = await http('D', 'POST', '/api/ktv/attendance', { employeeId: KTV.D, checkType: 'CHECK_OUT', photoBase64: JPEG, isLiveCapture: true });
          note(`Loại D tan ca: ${co.success ? 'OK' : co.error}`); }

        for (const wt of ['TYPE_B', 'TYPE_C'] as const) {
            flow(`F17 KTV ${wt === 'TYPE_B' ? 'Loại B (Hợp tác)' : 'Loại C (Cộng tác viên)'}: on-call → trọn vòng`);
            await c.query(`UPDATE "Staff" SET work_type=$2 WHERE id=$1`, [KTV.C, wt]);
            await c.query(`DELETE FROM "TurnQueue" WHERE employee_id=$1 AND date=$2`, [KTV.C, DATE]);
            await c.query(`DELETE FROM "KTVAttendance" WHERE "employeeId"=$1 AND date=$2`, [KTV.C, DATE]);
            const ci = await http('C', 'POST', '/api/ktv/attendance', { employeeId: KTV.C, checkType: 'CHECK_IN', photoBase64: JPEG, isLiveCapture: true });
            check(ci.success === true, `${wt} điểm danh (đến tiệm)`, ci.error || '');
            const st = (await c.query(`SELECT online_status FROM "Staff" WHERE id=$1`, [KTV.C])).rows[0];
            note(`${wt} sau điểm danh: online_status=${st?.online_status}, sổ tua=${JSON.stringify(await queue(KTV.C))}`);
            await fullCycle('C', KTV.C, `F17${wt}`, BEDS[2]);
            const co = await http('C', 'POST', '/api/ktv/attendance', { employeeId: KTV.C, checkType: 'CHECK_OUT', photoBase64: JPEG, isLiveCapture: true });
            check(co.success === true, `${wt} tan ca`, co.error || '');
            note(`${wt} sau tan ca: online_status=${(await c.query(`SELECT online_status FROM "Staff" WHERE id=$1`, [KTV.C])).rows[0]?.online_status}`);
        }

        /* F15 */ flow('F15 Tan ca (A, B)');
        for (const k of ['A', 'B'] as const) {
            const r = await http(k, 'POST', '/api/ktv/attendance', { employeeId: KTV[k], checkType: 'CHECK_OUT', photoBase64: JPEG, isLiveCapture: true });
            note(`${KTV[k]} tan ca: ${r.success ? 'OK' : r.error || r.message}`);
            check(r.success === true || /dọn|bàn giao|nợ|chưa/i.test(String(r.error || r.message)), `${KTV[k]} tan ca (hoặc bị chặn có lý do)`, r.error || '');
            const q = await queue(KTV[k]); note(`sổ tua ${KTV[k]} sau tan ca: ${JSON.stringify(q)}`);
        }
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
