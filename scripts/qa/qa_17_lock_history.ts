/**
 * QA #17 — Lịch sử khoá / mở khoá tài khoản (đọc lại SecurityAuditLogs).
 *
 *   K1. Mỗi loại sự kiện ra đúng tiêu đề, người thao tác, lý do.
 *   K2. BẪY: khoá do từ chối tua — `details.reason` là câu KTV gõ, KHÔNG phải
 *       lý do khoá. Lý do phải là REJECT_LOCK_REASON.
 *   K3. Thiếu tên người thao tác → "Không rõ"; phí 0 → không có phí.
 *   K4. Không lộ IP, thiết bị, UUID người thao tác.
 *   K5. Con trỏ phân trang: đi-về khớp, chặn chuỗi tiêm vào bộ lọc.
 *   K6. listLockEvents: lọc đúng loại, "Xem thêm" đúng, tìm không ra KTV thì
 *       không đọc nhật ký.
 *
 * Mẫu `details` lấy đúng định dạng dữ liệu thật ngày 14/09/2026.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *       scripts/qa/qa_17_lock_history.ts
 * CHỈ ĐỌC — dữ liệu mock, không chạm Supabase.
 */
import {
    toLockEvent, listLockEvents, encodeCursor, decodeCursor, sanitizeQuery,
    LOCK_EVENT_TYPES, REJECT_LOCK_REASON,
} from '../../lib/services/StaffLockHistoryService';
import { finish } from './_exit';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACTOR_UUID = '8de3f0a8-1783-4fdd-8d06-cd8488eb0c1c';

const row = (n: number, event_type: string, details: any, employee_id = 'T079') => ({
    id: UUID(n),
    employee_id,
    employee_name: employee_id === 'T079' ? 'Huỳnh Ngọc Tuấn Hiếu (Test D)' : `NV ${employee_id}`,
    event_type,
    created_at: `2026-09-${String(10 + n).padStart(2, '0')}T17:00:19.215625+00:00`,
    details,
    // Cột nhạy cảm có trong bảng thật — không được lọt ra ngoài.
    ip_address: '127.0.0.1',
    user_agent: 'CRON',
});

const ROWS = {
    absence: row(1, 'AUTO_LOCK_ABSENCE',
        { reason: 'Không đăng ký lịch và không đi làm', source: 'CRON_MIDNIGHT', netHours: 1.07, violationDate: '2026-09-12' }),
    pendingApplied: row(2, 'AUTO_LOCK_ABSENCE',
        { reason: 'Đăng ký làm nhưng không đến và không báo', source: 'CRON_PENDING_LOCK', netHours: null, violationDate: '2026-09-11' }),
    reject: row(3, 'AUTO_LOCK_REJECT_NO_HOURS',
        { reason: 'okay ', source: 'REJECT_ORDER', minHours: 3, penaltyHours: 3.5, bookingItemId: UUID(99), availableHours: 0.37 }, 'T069'),
    pending: row(4, 'PENDING_LOCK',
        { source: 'CRON', violationDate: '2026-09-13', reason: 'Không đăng ký lịch và không đi làm', caseKey: 'NO_REGISTRATION', billCodes: ['WB-002-13092026'] }),
    manualLock: row(5, 'MANUAL_LOCK',
        { locked_by: 'Developer', locked_by_id: ACTOR_UUID, reason: 'Tạm nghỉ để kiểm tra thiết bị', source: 'FEATURES_TABLE' }),
    unlock: row(6, 'MANUAL_UNLOCK',
        { reason: 'KTV đã bổ sung lịch làm việc', unlocked_by: 'Developer', unlocked_by_id: ACTOR_UUID, reactivation_fee: 1000000 }, 'T001'),
    unlockNoName: row(7, 'MANUAL_UNLOCK', { reason: 'Mở lại', reactivation_fee: 0 }, 'T001'),
};

/**
 * Supabase giả: ghi lại bộ lọc, trả dữ liệu theo `in()` và `limit()` như thật.
 * Không phân tích chuỗi `or()` của con trỏ — chỉ lưu lại để kiểm cú pháp.
 */
function fakeSupabase(auditRows: any[], staff: Array<{ id: string; full_name: string }>) {
    const log = { auditQueries: 0, staffQueries: 0, ors: [] as string[], eventTypes: [] as string[][] };
    const client = {
        log,
        from(table: string) {
            const st = { ins: {} as Record<string, string[]>, limit: Infinity, or: '' };
            const b: any = {
                select: () => b,
                order: () => b,
                in: (col: string, vals: string[]) => { st.ins[col] = vals; if (col === 'event_type') log.eventTypes.push(vals); return b; },
                or: (s: string) => { st.or = s; log.ors.push(s); return b; },
                limit: (n: number) => { st.limit = n; return b; },
                then: (resolve: any) => {
                    if (table === 'Staff') {
                        log.staffQueries++;
                        const m = st.or.match(/ilike\.%(.*?)%/);
                        const needle = (m?.[1] || '').toLowerCase();
                        const data = staff.filter(s => s.id.toLowerCase().includes(needle) || s.full_name.toLowerCase().includes(needle));
                        return resolve({ data: data.map(s => ({ id: s.id })), error: null });
                    }
                    log.auditQueries++;
                    let data = auditRows.filter(r =>
                        (!st.ins.event_type || st.ins.event_type.includes(r.event_type)) &&
                        (!st.ins.employee_id || st.ins.employee_id.includes(r.employee_id)));
                    data = data.sort((a, b2) => b2.created_at.localeCompare(a.created_at) || b2.id.localeCompare(a.id));
                    return resolve({ data: data.slice(0, st.limit), error: null });
                },
            };
            return b;
        },
    };
    return client as any;
}

async function main() {
    console.log('\n=== QA #17 · Lich su khoa / mo khoa ===\n');

    console.log('--- K1: tung loai su kien ---');
    const abs = toLockEvent(ROWS.absence)!;
    check(abs.kind === 'LOCK' && abs.title === 'Bị khoá tự động' && abs.actor === 'Hệ thống',
        'Cron 00:00 => Bi khoa tu dong, boi He thong');
    check(abs.reason === 'Không đăng ký lịch và không đi làm', 'Ly do khoa dung', String(abs.reason));
    check(abs.details.includes('Ngày vi phạm 12/09') && abs.details.includes('Chốt sổ 00:00'),
        'Dong phu: ngay vi pham + nguon', abs.details.join(' | '));

    const applied = toLockEvent(ROWS.pendingApplied)!;
    check(applied.kind === 'LOCK' && applied.details.includes('Áp khoá sau khi xong đơn'),
        'Khoa hoan duoc ap => ghi ro "Ap khoa sau khi xong don"', applied.details.join(' | '));

    const pen = toLockEvent(ROWS.pending)!;
    check(pen.kind === 'PENDING' && pen.title === 'Chờ khoá', 'PENDING_LOCK => Cho khoa');
    check(pen.details.some(l => l.includes('WB-002-13092026')), 'Cho khoa hien ma don dang lam', pen.details.join(' | '));

    const ml = toLockEvent(ROWS.manualLock)!;
    check(ml.kind === 'LOCK' && ml.title === 'Admin tắt hoạt động' && ml.actor === 'Developer',
        'Cong tac Hoat dong => Admin tat hoat dong, boi Developer');

    const ul = toLockEvent(ROWS.unlock)!;
    check(ul.kind === 'UNLOCK' && ul.actor === 'Developer' && ul.reason === 'KTV đã bổ sung lịch làm việc',
        'Mo khoa: AI mo + LY DO mo', `${ul.actor} · ${ul.reason}`);
    check(ul.fee === 1000000, 'Mo khoa co phi => hien phi', String(ul.fee));

    check(toLockEvent({ ...ROWS.absence, event_type: 'INVALID_WIFI_IP' } as any) === null,
        'Su kien khong phai khoa (VD vi pham Wifi) => bo qua');

    console.log('\n--- K2: BAY ly do khoa do tu choi tua ---');
    const rj = toLockEvent(ROWS.reject)!;
    check(rj.reason === REJECT_LOCK_REASON, 'Ly do khoa = hang so, KHONG phai cau KTV go', String(rj.reason));
    check(rj.reason !== 'okay' && rj.reason !== 'okay ', 'Khong hien "Bi khoa — ly do: okay"');
    check(rj.details.includes('KTV ghi khi từ chối: "okay"'), 'Cau KTV go tach ra dong phu, da cat khoang trang',
        rj.details.join(' | '));
    check(rj.details.includes('Còn 0.37h, cần hơn 3h') && rj.details.includes('Bị trừ 3.5h'),
        'Hien gio con / gio can / gio bi tru');

    console.log('\n--- K3: du lieu thieu ---');
    const noName = toLockEvent(ROWS.unlockNoName)!;
    check(noName.actor === 'Không rõ', 'Thieu ten nguoi mo => "Khong ro"', noName.actor);
    check(noName.fee === null, 'Phi 0 => khong hien phi');
    const empty = toLockEvent({ ...ROWS.absence, details: null } as any)!;
    check(!!empty && empty.reason === null && Array.isArray(empty.details), 'details null => khong vo');

    console.log('\n--- K4: khong lo du lieu noi bo ---');
    const all = Object.values(ROWS).map(r => toLockEvent(r as any));
    const json = JSON.stringify(all);
    check(!json.includes('127.0.0.1') && !json.includes('user_agent') && !json.includes('ip_address'),
        'Khong co IP / thiet bi');
    check(!json.includes(ACTOR_UUID), 'Khong co UUID nguoi thao tac');
    check(!json.includes(UUID(99)), 'Khong lo bookingItemId noi bo');

    console.log('\n--- K5: con tro phan trang ---');
    const cur = encodeCursor({ at: ROWS.absence.created_at, id: ROWS.absence.id });
    const back = decodeCursor(cur);
    check(back?.at === ROWS.absence.created_at && back?.id === ROWS.absence.id, 'Ma hoa -> giai ma khop');
    const INJECTIONS = [
        `2026-09-01")|${UUID(1)}`,
        `2026-09-01T00:00:00Z|not-a-uuid`,
        `2026-09-01T00:00:00Z,id.gt.0|${UUID(1)}`,
        `x|${UUID(1)}`, '', '|',
    ];
    check(INJECTIONS.every(s => decodeCursor(s) === null), 'Chan moi chuoi con tro la / tiem bo loc');
    check(!/[%,()"]/.test(sanitizeQuery('T0%79,(x)"')), 'O tim bo ky tu cu phap bo loc', sanitizeQuery('T0%79,(x)"'));

    console.log('\n--- K6: listLockEvents ---');
    const rows = Object.values(ROWS);
    const staff = [
        { id: 'T079', full_name: 'Huỳnh Ngọc Tuấn Hiếu (Test D)' },
        { id: 'T069', full_name: 'NV T069' },
        { id: 'T001', full_name: 'NV T001' },
    ];

    const sb1 = fakeSupabase(rows, staff);
    const lockOnly = await listLockEvents(sb1, { filter: 'LOCK' });
    check(lockOnly.events.every(e => e.kind !== 'UNLOCK') && lockOnly.events.length === 5,
        'Loc "Bi khoa": khong co dong mo khoa, gom ca Cho khoa', `${lockOnly.events.length} dong`);
    check(JSON.stringify(sb1.log.eventTypes[0]) === JSON.stringify(LOCK_EVENT_TYPES.LOCK),
        'Loc o SERVER (in event_type), khong loc sau khi tai');

    const sb2 = fakeSupabase(rows, staff);
    const unl = await listLockEvents(sb2, { filter: 'UNLOCK' });
    check(unl.events.length === 2 && unl.events.every(e => e.kind === 'UNLOCK'), 'Loc "Mo khoa"', `${unl.events.length} dong`);

    const sb3 = fakeSupabase(rows, staff);
    const p1 = await listLockEvents(sb3, { limit: 3 });
    check(p1.events.length === 3 && !!p1.nextBefore, 'Trang 1: dung 3 dong + co "Xem them"');
    check(p1.events[0].at >= p1.events[1].at && p1.events[1].at >= p1.events[2].at, 'Moi nhat truoc');
    const expectCursor = encodeCursor({ at: p1.events[2].at, id: p1.events[2].id });
    check(p1.nextBefore === expectCursor, 'Con tro = dong CUOI cua trang');

    const sb4 = fakeSupabase(rows, staff);
    await listLockEvents(sb4, { limit: 3, before: p1.nextBefore });
    const orStr = sb4.log.ors[0] || '';
    check(orStr.includes(`created_at.lt."${p1.events[2].at}"`) && orStr.includes(`id.lt.${p1.events[2].id}`),
        'Trang sau: loc < moc, hoa moc thi so id (khong sot dong trung gio)', orStr);

    const sb5 = fakeSupabase(rows, staff);
    const pLast = await listLockEvents(sb5, { limit: 50 });
    check(pLast.events.length === rows.length && pLast.nextBefore === null, 'Het du lieu => khong con "Xem them"');

    const sb6 = fakeSupabase(rows, staff);
    const byName = await listLockEvents(sb6, { q: 'Tuấn Hiếu' });
    check(byName.events.length > 0 && byName.events.every(e => e.staffId === 'T079'), 'Tim theo ten => chi dong cua KTV do',
        `${byName.events.length} dong`);

    const sb7 = fakeSupabase(rows, staff);
    const none = await listLockEvents(sb7, { q: 'KHONG-CO-AI' });
    check(none.events.length === 0 && sb7.log.auditQueries === 0, 'Tim khong ra KTV => khong doc nhat ky');

    const sb8 = fakeSupabase(rows, staff);
    await listLockEvents(sb8, { filter: 'BAD' as any, limit: 9999, before: 'rac' });
    check(JSON.stringify(sb8.log.eventTypes[0]) === JSON.stringify(LOCK_EVENT_TYPES.ALL) && sb8.log.ors.length === 0,
        'Tham so rac => ve mac dinh, bo con tro hong');

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main();
