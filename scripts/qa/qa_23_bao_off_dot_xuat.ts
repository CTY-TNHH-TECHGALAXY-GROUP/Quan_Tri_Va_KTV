/**
 * QA: "Báo off đột xuất" Loại D — chỉ đọc, không đụng DB.
 *   npx tsx scripts/qa/qa_23_bao_off_dot_xuat.ts
 *   TZ=UTC npx tsx scripts/qa/qa_23_bao_off_dot_xuat.ts
 *
 * Kiểm: cron chốt sổ (xetChotSoDem), chế tài (getCasePolicy — không bao giờ
 * khoá kể cả cấu hình sai), trạng thái màn KTV (resolveAttendanceStatus).
 */
import { KtvTypeDDisciplineService } from '../../lib/services/KtvTypeDDisciplineService';
import { resolveAttendanceStatus } from '../../lib/attendance/resolveAttendanceStatus';

let fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}\n     got:  ${JSON.stringify(got)}${ok ? '' : `\n     want: ${JSON.stringify(want)}`}`);
};

const reg = (status: string, extra: Record<string, any> = {}) =>
    ({ id: 'r1', staff_id: 'NH021', work_date: '2026-10-07', status, absent_reported_at: null, penalty_applied: null, ...extra });

const verdict = (r: any, coDiLam = false, coBaoOff = false) => {
    const v = KtvTypeDDisciplineService.xetChotSoDem({
        regNgayVuaQua: r, coRegNgayMoi: true, coDiLamNgayVuaQua: coDiLam, coBaoOffDotXuat: coBaoOff,
    });
    return { dongSo: v.dongSoNgayVuaQua, loi: v.loi.map(l => l.caseKey) };
};

console.log('── 1. Cron chốt sổ 00:00 ──');
check('Đăng ký làm, không báo, không đến', verdict(reg('REGISTERED')), { dongSo: false, loi: ['NO_SHOW_NO_NOTICE'] });
check('Báo off (đã trừ lúc bấm) → chỉ đóng sổ', verdict(reg('REGISTERED', { penalty_applied: 'SUDDEN_OFF_REPORTED' }), false, true), { dongSo: true, loi: [] });
check('Báo off nhưng ghi phạt lúc bấm lỗi → dự phòng SUDDEN_OFF_REPORTED', verdict(reg('REGISTERED'), false, true), { dongSo: false, loi: ['SUDDEN_OFF_REPORTED'] });
check('Báo trễ rồi báo off (đã đánh dấu)', verdict(reg('LATE_REPORTED', { penalty_applied: 'SUDDEN_OFF_REPORTED' }), false, true), { dongSo: true, loi: [] });
check('Báo trễ rồi báo off (chưa đánh dấu) → không xử LATE_REPORTED_NO_SHOW', verdict(reg('LATE_REPORTED'), false, true), { dongSo: false, loi: ['SUDDEN_OFF_REPORTED'] });
check('Báo off rồi vẫn đến làm', verdict(reg('REGISTERED', { penalty_applied: 'SUDDEN_OFF_REPORTED' }), true, true), { dongSo: true, loi: [] });
check('Lịch OFF', verdict(reg('OFF_REGISTERED')), { dongSo: true, loi: [] });
check('Báo vắng trước 07:00, không đến', verdict(reg('ABSENT_REPORTED', { absent_reported_at: '2026-10-07T05:00:00Z' })), { dongSo: false, loi: ['ABSENT_REPORTED_NO_SHOW'] });
check('Không đăng ký → vẫn khoá như cũ', verdict(null), { dongSo: false, loi: ['NO_REGISTRATION'] });

console.log('\n── 2. Chế tài SUDDEN_OFF_REPORTED (mock SystemConfigs) ──');
const mockSb = (rules: any) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: rules } }) }) }) }),
}) as any;
const policy = (rules: any) => KtvTypeDDisciplineService.getCasePolicy(mockSb(rules), 'SUDDEN_OFF_REPORTED');
(async () => {
    check('Cấu hình DB hiện tại (chưa có case) → mặc định', await policy({ CASES: { NO_SHOW_NO_NOTICE: { action: 'DEDUCT_OR_LOCK', hours: 10 } } }), { action: 'DEDUCT', hours: 10 });
    check('Ai đó đặt LOCK → ép về DEDUCT', await policy({ CASES: { SUDDEN_OFF_REPORTED: { action: 'LOCK', hours: 10 } } }), { action: 'DEDUCT', hours: 10 });
    check('Đặt DEDUCT_OR_LOCK 8h → DEDUCT 8h', await policy({ CASES: { SUDDEN_OFF_REPORTED: { action: 'DEDUCT_OR_LOCK', hours: 8 } } }), { action: 'DEDUCT', hours: 8 });
    check('Đặt NONE → tắt', await policy({ CASES: { SUDDEN_OFF_REPORTED: { action: 'NONE', hours: 10 } } }), { action: 'NONE', hours: 10 });
    check('NO_SHOW_NO_NOTICE vẫn được khoá', await KtvTypeDDisciplineService.getCasePolicy(mockSb({}), 'NO_SHOW_NO_NOTICE'), { action: 'DEDUCT_OR_LOCK', hours: 10 });

    // Quỹ giờ âm vẫn chỉ trừ, không khoá (dry run, không ghi).
    const r = await KtvTypeDDisciplineService.applyCasePenalty(mockSb({}), {
        staffId: 'NH021', workDate: '2026-10-07', caseKey: 'SUDDEN_OFF_REPORTED', reason: 'Báo off đột xuất',
        timDonDangLam: async () => [],
    }, true);
    check('applyCasePenalty dry → DEDUCT 10h, không khoá', { ketQua: r.ketQua, hours: r.hours }, { ketQua: 'DEDUCT', hours: 10 });

    console.log('\n── 3. Trạng thái màn KTV Loại D (records mới → cũ) ──');
    const at = (checkType: string, status = 'CONFIRMED') => ({ checkType, status });
    check('Chỉ có báo off → CHECKED_OUT (không còn "ĐÃ TỚI TIỆM")', resolveAttendanceStatus([at('SUDDEN_OFF')], 'TYPE_D').checkStatus, 'CHECKED_OUT');
    check('Báo off rồi vào ca → CONFIRMED', resolveAttendanceStatus([at('CHECK_IN'), at('SUDDEN_OFF')], 'TYPE_D').checkStatus, 'CONFIRMED');
    check('Báo off, vào ca, tan ca → CHECKED_OUT', resolveAttendanceStatus([at('CHECK_OUT'), at('CHECK_IN'), at('SUDDEN_OFF')], 'TYPE_D').checkStatus, 'CHECKED_OUT');
    check('Loại A không đổi: SUDDEN_OFF → CONFIRMED', resolveAttendanceStatus([at('SUDDEN_OFF')], 'TYPE_A').checkStatus, 'CONFIRMED');

    console.log(`\nTZ=${process.env.TZ || '(máy)'} · ${fail === 0 ? 'TẤT CẢ ĐẠT' : `${fail} LỖI`}`);
    process.exit(fail ? 1 : 0);
})();
