/**
 * ================================================================
 * MÔ PHỎNG CHẾ TÀI KỶ LUẬT LOẠI D
 * ================================================================
 * Gọi THẲNG `KtvTypeDDisciplineService.applyCasePenalty` (hàm thật mà cron
 * dùng) với một Supabase giả, để kiểm: cùng một tình huống, đổi chế tài trong
 * Cài đặt thì kết quả có đổi theo không, và mốc "quỹ giờ không đủ" có đúng chỗ.
 *
 * Chạy:  npx ts-node -O "{\"module\":\"commonjs\"}" scripts/simulate_type_d_discipline_cases.ts
 */
import { KtvTypeDDisciplineService } from '../lib/services/KtvTypeDDisciplineService';
import { TYPE_D_DISCIPLINE_CASES, type TypeDDisciplineCaseKey } from '../lib/constants/staff.constants';

/** Supabase giả: chỉ đủ cho `readRules`, `isEnabled` và `quyGioThang`. */
function fakeSupabase(rules: any, gioLamPhut: number, gioPhat: number) {
    const ket = (rows: any[], single?: any) => {
        const api: any = {
            select: () => api, eq: () => api, gte: () => api, lte: () => api,
            neq: () => api, in: () => api, order: () => api, limit: () => api,
            maybeSingle: async () => ({ data: single ?? null }),
            then: (r: any) => Promise.resolve({ data: rows }).then(r),
        };
        return api;
    };
    return {
        from(table: string) {
            if (table === 'SystemConfigs') {
                // isEnabled và readRules cùng hỏi bảng này; phân biệt bằng .eq(key)
                let key = '';
                const api: any = {
                    select: () => api,
                    eq: (_c: string, v: string) => { key = v; return api; },
                    maybeSingle: async () => ({
                        data: { value: key === 'ktv_type_d_discipline_enabled' ? true : rules },
                    }),
                };
                return api;
            }
            if (table === 'KTVDTurnLedger') return ket([{ actual_minutes: gioLamPhut }]);
            if (table === 'KTVDPenaltyLedger') return ket([{ hours_penalty: gioPhat }]);
            return ket([]);
        },
    } as any;
}

const CASES: TypeDDisciplineCaseKey[] = [
    'NO_REGISTRATION', 'NO_SHOW_NO_NOTICE',
    'LATE_REPORTED_NO_SHOW', 'ABSENT_REPORTED_NO_SHOW',
];

const QUY_GIO = [
    { ten: 'quỹ 30h', phut: 30 * 60, phat: 0 },
    { ten: 'quỹ 10h', phut: 10 * 60, phat: 0 },   // đúng bằng mức phạt 10h
    { ten: 'quỹ 6h', phut: 6 * 60, phat: 0 },
    { ten: 'quỹ 0h', phut: 0, phat: 0 },
];

(async () => {
    let loi = 0;

    console.log('\n═══ 1. MẶC ĐỊNH QUY CHẾ (trừ giờ, không đủ thì khoá) ═══');
    const macDinh = {
        CASES: Object.fromEntries(Object.entries(TYPE_D_DISCIPLINE_CASES)
            .map(([k, v]) => [k, { action: v.action, hours: v.hours }])),
    };

    for (const q of QUY_GIO) {
        const sb = fakeSupabase(macDinh, q.phut, q.phat);
        const dong: string[] = [];
        for (const c of CASES) {
            const r = await KtvTypeDDisciplineService.applyCasePenalty(
                sb, { staffId: 'T001', workDate: '2026-09-12', caseKey: c, reason: 'mô phỏng' }, true);
            dong.push(`${c.padEnd(24)} → ${r.ketQua === 'DEDUCT' ? `trừ ${r.hours}h` : r.ketQua === 'LOCK' ? 'KHOÁ' : '—'}`);
        }
        console.log(`\n  ${q.ten}:`);
        dong.forEach(d => console.log('    ' + d));
    }

    console.log('\n═══ 2. MỐC "KHÔNG ĐỦ GIỜ" (phạt 10h) ═══');
    for (const q of QUY_GIO) {
        const sb = fakeSupabase(macDinh, q.phut, q.phat);
        const r = await KtvTypeDDisciplineService.applyCasePenalty(
            sb, { staffId: 'T001', workDate: '2026-09-12', caseKey: 'NO_SHOW_NO_NOTICE', reason: 'mô phỏng' }, true);
        const mongDoi = (q.phut / 60 - q.phat) < 10 ? 'LOCK' : 'DEDUCT';
        const dung = r.ketQua === mongDoi;
        if (!dung) loi++;
        console.log(`  ${q.ten.padEnd(10)} (còn ${r.netHours}h) → ${r.ketQua.padEnd(7)} ${dung ? '✅' : `❌ đáng lẽ ${mongDoi}`}`);
    }

    console.log('\n═══ 3. ĐỔI CHẾ TÀI TRONG CÀI ĐẶT — kết quả phải đổi theo ═══');
    const thuNghiem = [
        { action: 'DEDUCT', hours: 8, mong: 'DEDUCT', ghi: 'trừ 8h dù quỹ chỉ còn 6h' },
        { action: 'LOCK', hours: 10, mong: 'LOCK', ghi: 'khoá thẳng, không xét quỹ' },
        { action: 'DEDUCT_OR_LOCK', hours: 10, mong: 'LOCK', ghi: 'quỹ 6h < 10h → khoá' },
        { action: 'DEDUCT_OR_LOCK', hours: 5, mong: 'DEDUCT', ghi: 'quỹ 6h ≥ 5h → trừ' },
        { action: 'DEDUCT', hours: 0, mong: 'NONE', ghi: '0 giờ = tắt riêng lỗi này' },
    ];
    for (const t of thuNghiem) {
        const sb = fakeSupabase({ CASES: { NO_SHOW_NO_NOTICE: { action: t.action, hours: t.hours } } }, 6 * 60, 0);
        const r = await KtvTypeDDisciplineService.applyCasePenalty(
            sb, { staffId: 'T001', workDate: '2026-09-12', caseKey: 'NO_SHOW_NO_NOTICE', reason: 'mô phỏng' }, true);
        const dung = r.ketQua === t.mong;
        if (!dung) loi++;
        console.log(`  ${t.action.padEnd(15)} ${String(t.hours).padStart(2)}h → ${r.ketQua.padEnd(7)} ${dung ? '✅' : `❌ đáng lẽ ${t.mong}`}  (${t.ghi})`);
    }

    console.log('\n═══ 4. CẤU HÌNH RÁC — phải lùi về mặc định, không được sập ═══');
    for (const rac of [{}, { CASES: null }, { CASES: { NO_SHOW_NO_NOTICE: { action: 'XYZ', hours: 'abc' } } }]) {
        const sb = fakeSupabase(rac, 30 * 60, 0);
        const r = await KtvTypeDDisciplineService.applyCasePenalty(
            sb, { staffId: 'T001', workDate: '2026-09-12', caseKey: 'NO_SHOW_NO_NOTICE', reason: 'mô phỏng' }, true);
        const dung = r.ketQua === 'DEDUCT' && r.hours === 10;
        if (!dung) loi++;
        console.log(`  ${JSON.stringify(rac).padEnd(58)} → ${r.ketQua} ${r.hours}h ${dung ? '✅' : '❌'}`);
    }

    console.log(loi === 0 ? '\n✅ Tất cả trường hợp đúng như cấu hình.\n' : `\n❌ ${loi} trường hợp sai.\n`);
    process.exit(loi === 0 ? 0 : 1);
})();
