/**
 * QA #16 — Phiếu Office bị THU HỒI: giữ trong lịch sử, không đụng vào điểm.
 *
 *   R1. Bật `withRevoked` KHÔNG làm đổi bất kỳ con số nào (điểm ngày, điểm
 *       tháng, lỗi lặp, ngày công, quỹ) — chỉ thêm mảng `revokedHits`.
 *   R2. Thu hồi 1 trong 3 phiếu cùng lỗi → hết phạt lỗi lặp, điểm ngày hoàn lại.
 *   R3. Phiếu thu hồi rơi vào ngày KTV KHÔNG đi làm vẫn còn trong lịch sử, mà
 *       không bị đếm thành ngày công (mẫu số điểm tháng).
 *   R4. Quyền bồi hoàn: chỉ ADMIN và DEV.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *       scripts/qa/qa_16_office_revoked_history.ts
 * CHỈ ĐỌC — dùng dữ liệu mock, không chạm Supabase.
 */
import { KtvOfficeScoreService, canRevokeOfficeLog } from '../../lib/services/KtvOfficeScoreService';
import { finish } from './_exit';

const STAFF = 'T999';
const MONTH = '2026-09';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

type LogRow = {
    id: string;
    work_date: string;
    criteria_id: string;
    criteria_label: string;
    points_deducted: number;
    revoked_at?: string | null;
    revoked_by_name?: string | null;
    revoke_reason?: string | null;
};

const row = (o: Partial<LogRow> & { id: string; work_date: string; criteria_id: string; points_deducted: number }): LogRow => ({
    criteria_label: o.criteria_id === 'A1' ? 'Đồng phục' : 'Bật app đúng giờ đã đăng ký',
    revoked_at: null, revoked_by_name: null, revoke_reason: null,
    ...o,
} as LogRow);

/**
 * Supabase giả: chỉ cần đủ cho `computeMonth`. Ghi lại các bộ lọc đã gọi rồi trả
 * dữ liệu tương ứng lúc được `await`, đúng kiểu builder thật.
 */
function fakeSupabase(logs: LogRow[], attendanceDates: string[]) {
    let queryCount = 0;
    const client = {
        get queries() { return queryCount; },
        from(table: string) {
            queryCount++;
            let wantRevoked: boolean | null = null;
            const builder: any = {
                select: () => builder,
                in: () => builder,
                gte: () => builder,
                lte: () => builder,
                eq: () => builder,
                order: () => builder,
                is: (col: string) => { if (col === 'revoked_at') wantRevoked = false; return builder; },
                not: (col: string) => { if (col === 'revoked_at') wantRevoked = true; return builder; },
                then: (resolve: any) => {
                    if (table === 'KTVAttendance') {
                        return resolve({
                            data: attendanceDates.map(d => ({ employeeId: STAFF, date: d })),
                            error: null,
                        });
                    }
                    const data = logs
                        .filter(l => (wantRevoked ? !!l.revoked_at : !l.revoked_at))
                        .map(l => ({
                            ...l,
                            staff_id: STAFF,
                            note: null,
                            photo_urls: [],
                            created_by_name: 'Quản Trị Viên (Mặc định)',
                            created_at: `${l.work_date}T16:33:00.000Z`,
                        }));
                    return resolve({ data, error: null });
                },
            };
            return builder;
        },
    };
    return client as any;
}

const run = (logs: LogRow[], dates: string[], withRevoked: boolean) =>
    KtvOfficeScoreService.computeMonth(fakeSupabase(logs, dates), [STAFF], MONTH,
        withRevoked ? { withRevoked: true } : undefined).then(m => m.get(STAFF)!);

/** Mọi con số dùng để tính tiền/điểm — phải y hệt nhau giữa hai chế độ. */
const numbers = (m: any) => JSON.stringify({
    workDays: m.workDays, cleanDays: m.cleanDays, avg: m.avg, final: m.final,
    repeatPenalty: m.repeatPenalty, exemptPct: m.exemptPct, fundDue: m.fundDue,
    repeats: m.repeats, hasData: m.hasData,
    days: m.days.map((d: any) => [d.workDate, d.dayScore, d.hits.length]),
});

async function main() {
    console.log('\n=== QA #16 · Phieu Office bi thu hoi ===\n');

    const DATES = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

    // 3 phiếu A1 (3đ) rải 3 ngày + 1 phiếu T1 (7.5đ).
    const truoc: LogRow[] = [
        row({ id: 'l1', work_date: '2026-09-01', criteria_id: 'A1', points_deducted: 3 }),
        row({ id: 'l2', work_date: '2026-09-02', criteria_id: 'A1', points_deducted: 3 }),
        row({ id: 'l3', work_date: '2026-09-03', criteria_id: 'A1', points_deducted: 3 }),
        row({ id: 'l4', work_date: '2026-09-04', criteria_id: 'T1', points_deducted: 7.5 }),
    ];
    // Y hệt, nhưng phiếu l3 đã được hoàn.
    const sau: LogRow[] = truoc.map(l => l.id === 'l3'
        ? { ...l, revoked_at: '2026-09-05T02:10:00.000Z', revoked_by_name: 'Nguyễn Văn A', revoke_reason: 'Chấm nhầm KTV, đã xác minh lại với quản ca.' }
        : l);

    console.log('--- R1: bat withRevoked khong lam doi con so nao ---');
    for (const [label, logs] of [['chua thu hoi', truoc], ['da thu hoi 1 phieu', sau]] as const) {
        const off = await run(logs as LogRow[], DATES, false);
        const on = await run(logs as LogRow[], DATES, true);
        check(numbers(off) === numbers(on), `${label}: moi con so giong het`,
            numbers(off) === numbers(on) ? `diem thang ${on.final}` : `OFF ${numbers(off)} | ON ${numbers(on)}`);
        check(off.revokedHits.length === 0, `${label}: khong hoi thi khong tra phieu thu hoi`);
    }

    console.log('\n--- R2: thu hoi 1 trong 3 phieu cung loi ---');
    const a = await run(truoc, DATES, true);
    const b = await run(sau, DATES, true);
    check(a.repeats.length === 1 && a.repeatPenalty === 3, 'Truoc: 3 lan A1 => phat loi lap 3d',
        `${a.repeats.length} loi lap, −${a.repeatPenalty}d`);
    check(b.repeats.length === 0 && b.repeatPenalty === 0, 'Sau: con 2 lan => HET phat loi lap',
        `${b.repeats.length} loi lap, −${b.repeatPenalty}d`);

    const d3a = a.days.find(d => d.workDate === '2026-09-03')!;
    const d3b = b.days.find(d => d.workDate === '2026-09-03')!;
    check(d3a.dayScore === 97 && d3b.dayScore === 100, 'Diem ngay 03/09 hoan tu 97 ve 100',
        `${d3a.dayScore} -> ${d3b.dayScore}`);
    check(d3b.hits.length === 0, 'Ngay 03/09 khong con loi dang tinh diem');
    check(b.revokedHits.length === 1 && b.revokedHits[0].logId === 'l3', 'Phieu thu hoi VAN nam trong lich su');
    check(b.revokedHits[0].revokedByName === 'Nguyễn Văn A'
        && !!b.revokedHits[0].revokeReason
        && b.revokedHits[0].byName === 'Quản Trị Viên (Mặc định)',
        'Lich su hien du: nguoi tru, nguoi hoan, ly do',
        `${b.revokedHits[0].byName} -> ${b.revokedHits[0].revokedByName}`);
    check(b.final > a.final, 'Diem thang tang len sau khi hoan', `${a.final} -> ${b.final}`);

    console.log('\n--- R3: phieu thu hoi o ngay KTV KHONG di lam ---');
    const nhamNgay: LogRow[] = [
        ...sau,
        row({
            id: 'l5', work_date: '2026-09-20', criteria_id: 'A1', points_deducted: 3,
            revoked_at: '2026-09-21T02:00:00.000Z', revoked_by_name: 'Nguyễn Văn A', revoke_reason: 'Cham nham ngay.',
        }),
    ];
    const c = await run(nhamNgay, DATES, true);
    check(c.workDays === b.workDays, 'Ngay khong di lam KHONG bi dem vao ngay cong',
        `${c.workDays} ngay`);
    check(c.final === b.final && c.fundDue === b.fundDue, 'Diem thang va quy khong doi',
        `${c.final}d · ${c.fundDue.toLocaleString('vi-VN')}d`);
    check(!c.days.some(d => d.workDate === '2026-09-20'), 'Ngay do khong chui vao bang ngay cong');
    check(c.revokedHits.some(h => h.workDate === '2026-09-20'), 'Nhung van con trong lich su de tra dau vet');

    console.log('\n--- R4: quyen boi hoan chi ADMIN/DEV ---');
    const ROLES: Array<[string | null, boolean]> = [
        ['ADMIN', true], ['DEV', true], ['MANAGER', false],
        ['RECEPTIONIST', false], ['TECHNICIAN', false], [null, false],
    ];
    for (const [role, want] of ROLES) {
        const got = canRevokeOfficeLog(role);
        check(got === want, `${role ?? '(khong co role)'} => ${got ? 'duoc' : 'khong duoc'} thu hoi`);
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main();
