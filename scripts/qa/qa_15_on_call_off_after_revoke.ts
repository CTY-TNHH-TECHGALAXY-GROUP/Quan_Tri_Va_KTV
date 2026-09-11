/**
 * QA #15 — Admin revokes `allow_on_call` while the KTV is still on call.
 *
 * Bug: both on-call routes returned 403 on `!allow_on_call` BEFORE reaching the
 * OFF branch. Once admin switched the flag off on the Features table, a KTV
 * with `feature_flags.is_on_call = true` could never turn on-call off, and
 * reception kept treating them as available for out-of-hours orders.
 *
 * Expected:
 *   - The permission gates turning ON only.
 *   - Turning OFF is accepted while the KTV is on call, even without the flag.
 *   - The OFF-branch guards (incomplete tasks) still apply.
 *   - OFF from a KTV who is neither permitted nor on call stays rejected
 *     (goOffline also closes the day's TurnQueue / KTVShifts).
 *
 * Calls the REAL route handlers. Only I/O is stubbed: Supabase client, online
 * services (DB writes), on-call notification, guest-arrival lock.
 *
 * Run: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_15_on_call_off_after_revoke.ts
 * DOES NOT touch the DB.
 */
import { finish, fatal } from './_exit';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

// ── Stubs ───────────────────────────────────────────────────────────────
type Call = { fn: string; args: any[] };
const calls: Call[] = [];
const record = (fn: string) => async (...args: any[]) => {
    calls.push({ fn, args });
    return { success: true };
};

interface FakeDb {
    staff: Record<string, any>;
    configs?: Record<string, any>;
    tasks?: any[];
}
let db: FakeDb = { staff: {} };
const staffWrites: any[] = [];

/** Chainable stand-in for the few query shapes the on-call routes use. */
function from(table: string) {
    let payload: any = null;
    const filters: Record<string, any> = {};
    const result = () => {
        if (payload) {
            if (table === 'Staff') staffWrites.push(payload);
            return { data: null, error: null };
        }
        if (table === 'Staff') return { data: db.staff, error: null };
        if (table === 'SystemConfigs') {
            const key = filters.key;
            return { data: db.configs && key in db.configs ? { value: db.configs[key] } : null, error: null };
        }
        if (table === 'Tasks') return { data: db.tasks || [], error: null };
        return { data: null, error: null };
    };
    const q: any = {
        select: () => q,
        eq: (col: string, val: any) => { filters[col] = val; return q; },
        gte: () => q, neq: () => q, is: () => q, in: () => q,
        update: (p: any) => { payload = p; return q; },
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return q;
}
const fakeSupabase = { from };

function stubModule(request: string, exports: any) {
    const filename = require.resolve(request);
    require.cache[filename] = { id: filename, filename, loaded: true, exports } as any;
}

stubModule('@/lib/supabaseAdmin', { getSupabaseAdmin: () => fakeSupabase });
stubModule('@/lib/services/KtvTypeDOnlineService', {
    KtvTypeDOnlineService: { goOffline: record('D.goOffline'), goOnline: record('D.goOnline') },
});
stubModule('@/lib/services/KtvOnlineService', {
    KtvOnlineService: { goOffline: record('B.goOffline'), goOnline: record('B.goOnline') },
});
stubModule('@/lib/ktv-on-call-notify', { notifyOnCallChange: record('notify') });
stubModule('@/lib/guest-arrival.logic', {
    isGuestArrivalEnabled: async () => false,
    hasPendingDispatch: async () => false,
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const typeDRoute = require('../../app/api/ktv/type-d/on-call/route');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const baseRoute = require('../../app/api/ktv/on-call/route');

// ── Harness ─────────────────────────────────────────────────────────────
const TECH = 'QA-ONCALL-15';

async function post(route: any, staff: Record<string, any>, isOnCall: boolean, extra: Partial<FakeDb> = {}) {
    db = { staff, ...extra };
    calls.length = 0;
    staffWrites.length = 0;
    const req = new Request('http://localhost/api/qa', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ techCode: TECH, is_on_call: isOnCall, travel_time_mins: 30 }),
    });
    const res = await route.POST(req as any);
    const body = await res.json().catch(() => ({}));
    return { status: res.status as number, body, called: calls.map(c => c.fn), staffWrites: [...staffWrites] };
}

const REVOKED_ON_CALL = { allow_on_call: false, is_on_call: true };

async function main() {
    // ── T1: Type D route ──────────────────────────────────────────────
    console.log('\n--- T1: /api/ktv/type-d/on-call — co bi thu hoi khi dang nhan don ---');
    {
        const staff = { work_type: 'TYPE_D', feature_flags: REVOKED_ON_CALL, online_status: 'ONLINE' };

        const off = await post(typeDRoute, staff, false);
        check(off.status === 200, 'Tat nhan don duoc chap nhan', `status=${off.status} ${off.body?.error || ''}`);
        check(off.called.includes('D.goOffline'), 'Goi KtvTypeDOnlineService.goOffline');
        check(off.staffWrites.some(w => w.feature_flags?.is_on_call === false), 'Ghi feature_flags.is_on_call = false');
        check(off.staffWrites.every(w => w.feature_flags?.allow_on_call === false), 'Khong tu bat lai allow_on_call');
        check(off.called.includes('notify'), 'Bao quay KTV da tat nhan don');

        const on = await post(typeDRoute, staff, true);
        check(on.status === 403, 'Bat nhan don bi tu choi', `status=${on.status}`);
        check(!on.called.includes('D.goOnline'), 'Khong goi goOnline');
        check(on.staffWrites.length === 0, 'Khong ghi Staff');
    }

    console.log('\n--- T2: /api/ktv/type-d/on-call — cac nhanh con lai ---');
    {
        // Stuck only via online_status (feature flag already false).
        const onlineOnly = await post(typeDRoute,
            { work_type: 'TYPE_D', feature_flags: { allow_on_call: false }, online_status: 'ONLINE' }, false);
        check(onlineOnly.status === 200, 'Ket ONLINE (co is_on_call da false) van tat duoc', `status=${onlineOnly.status}`);

        // Ghost flag left behind after cron reset online_status only.
        const ghost = await post(typeDRoute,
            { work_type: 'TYPE_D', feature_flags: REVOKED_ON_CALL, online_status: 'OFFLINE' }, false);
        check(ghost.status === 200, 'Co is_on_call con sot (OFFLINE) van tat duoc', `status=${ghost.status}`);

        // The off-branch guard still runs when the flag is revoked.
        const blocked = await post(typeDRoute,
            { work_type: 'TYPE_D', feature_flags: REVOKED_ON_CALL, online_status: 'ONLINE' }, false,
            { configs: { block_checkout_incomplete_tasks_TYPE_D: true }, tasks: [{ id: 't1' }] });
        check(blocked.status === 403 && /công việc/.test(blocked.body?.error || ''),
            'Van chan tat khi con cong viec chua nghiem thu', `status=${blocked.status}`);
        check(!blocked.called.includes('D.goOffline'), 'Bi chan thi khong goi goOffline');

        // Unchanged: no permission and not on call -> nothing to turn off.
        const idle = await post(typeDRoute,
            { work_type: 'TYPE_D', feature_flags: { allow_on_call: false, is_on_call: false }, online_status: 'OFFLINE' }, false);
        check(idle.status === 403 && !idle.called.includes('D.goOffline'),
            'Khong co quyen, khong dang nhan don -> van 403', `status=${idle.status}`);

        // Unchanged: this route stays Type D only.
        const typeA = await post(typeDRoute,
            { work_type: 'TYPE_A', feature_flags: REVOKED_ON_CALL, online_status: 'ONLINE' }, false);
        check(typeA.status === 403 && !typeA.called.includes('D.goOffline'),
            'KTV khong phai Loai D goi route Loai D -> 403', `status=${typeA.status}`);

        // Regression: permitted KTV can still turn on.
        const permitted = await post(typeDRoute,
            { work_type: 'TYPE_D', feature_flags: { allow_on_call: true, is_on_call: false }, online_status: 'OFFLINE' }, true);
        check(permitted.status === 200 && permitted.called.includes('D.goOnline'),
            'Co quyen -> bat nhan don binh thuong', `status=${permitted.status}`);
    }

    // ── T3: base route (Type A/B/C) ───────────────────────────────────
    console.log('\n--- T3: /api/ktv/on-call — cung loi thu tu kiem tra ---');
    {
        const staff = { work_type: 'TYPE_A', feature_flags: REVOKED_ON_CALL, online_status: 'ONLINE', is_active_vip_menu: false };

        const off = await post(baseRoute, staff, false);
        check(off.status === 200, 'Tat nhan don duoc chap nhan', `status=${off.status} ${off.body?.error || ''}`);
        check(off.called.includes('B.goOffline'), 'Goi KtvOnlineService.goOffline');
        check(off.staffWrites.some(w => w.feature_flags?.is_on_call === false), 'Ghi feature_flags.is_on_call = false');

        const on = await post(baseRoute, staff, true);
        check(on.status === 403, 'Bat nhan don bi tu choi', `status=${on.status}`);
        check(!on.called.includes('B.goOnline') && on.staffWrites.length === 0, 'Khong goi goOnline, khong ghi Staff');

        const idle = await post(baseRoute,
            { work_type: 'TYPE_A', feature_flags: { allow_on_call: false, is_on_call: false }, online_status: 'OFFLINE' }, false);
        check(idle.status === 403 && !idle.called.includes('B.goOffline'),
            'Khong co quyen, khong dang nhan don -> van 403', `status=${idle.status}`);

        const typeB = await post(baseRoute,
            { work_type: 'TYPE_B', feature_flags: {}, online_status: 'OFFLINE' }, true);
        check(typeB.status === 200 && typeB.called.includes('B.goOnline'),
            'Loai B (luon co quyen) -> bat nhan don binh thuong', `status=${typeB.status}`);
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
