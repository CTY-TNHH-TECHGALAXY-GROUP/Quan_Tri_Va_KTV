/**
 * QA: đăng ký giờ về trong ngày được mở khoá (Loại D) — chỉ đọc, không đụng DB.
 *   npx tsx scripts/qa/qa_24_dang_ky_sau_mo_khoa.ts
 *   TZ=UTC npx tsx scripts/qa/qa_24_dang_ky_sau_mo_khoa.ts
 */
import { KtvTypeDDisciplineService } from '../../lib/services/KtvTypeDDisciplineService';
import { vnToday } from '../../lib/vn-time';
import { phutTrongNgayLamViec } from '../../lib/business-date';

let fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? '✅' : '❌'} ${name} → ${JSON.stringify(got)}${ok ? '' : `  (cần ${JSON.stringify(want)})`}`);
};

/** Mock SecurityAuditLogs: trả các dòng MANUAL_UNLOCK có created_at >= mốc query. */
const mockSb = (rows: { employee_id: string; created_at: string }[], fail = false) => {
    let since = ''; let who = '';
    const q: any = {
        select: () => q, eq: (c: string, v: string) => { if (c === 'employee_id') who = v; return q; },
        gte: (_c: string, v: string) => { since = v; return q; },
        limit: async () => fail
            ? { data: null, error: { message: 'boom' } }
            : { data: rows.filter(r => r.employee_id === who && r.created_at >= since), error: null },
    };
    return { from: () => q, get since() { return since; } } as any;
};

(async () => {
    const today = vnToday();
    const vnMidnightUtc = new Date(`${today}T00:00:00+07:00`).toISOString();
    const truocNuaDem = new Date(new Date(vnMidnightUtc).getTime() - 60_000).toISOString();
    const sauNuaDem = new Date(new Date(vnMidnightUtc).getTime() + 60_000).toISOString();

    console.log('── 1. Mốc "hôm nay" = 00:00 giờ VN ──');
    const sb = mockSb([]);
    await KtvTypeDDisciplineService.duocMoKhoaHomNay(sb, 'T018');
    check('Mốc query đúng 00:00 VN', sb.since, vnMidnightUtc);
    check('Mở khoá 00:01 VN hôm nay → true', await KtvTypeDDisciplineService.duocMoKhoaHomNay(mockSb([{ employee_id: 'T018', created_at: sauNuaDem }]), 'T018'), true);
    check('Mở khoá 23:59 VN hôm qua → false', await KtvTypeDDisciplineService.duocMoKhoaHomNay(mockSb([{ employee_id: 'T018', created_at: truocNuaDem }]), 'T018'), false);
    check('Người khác được mở khoá → false', await KtvTypeDDisciplineService.duocMoKhoaHomNay(mockSb([{ employee_id: 'T069', created_at: sauNuaDem }]), 'T018'), false);
    check('Lỗi đọc nhật ký → false (giữ hành vi cũ)', await KtvTypeDDisciplineService.duocMoKhoaHomNay(mockSb([], true), 'T018'), false);

    console.log('\n── 2. Giờ về phải sau giờ hiện tại (phút trong ngày làm việc, cutoff 07:00) ──');
    const hopLe = (den: string, ve: string) => {
        const a = phutTrongNgayLamViec(den, 7), b = phutTrongNgayLamViec(ve, 7);
        return a !== null && b !== null && b > a;
    };
    check('Đến 10:00, về 22:00', hopLe('10:00', '22:00'), true);
    check('Đến 10:00, về 09:00', hopLe('10:00', '09:00'), false);
    check('Đến 22:30, về 00:30 (qua nửa đêm)', hopLe('22:30', '00:30'), true);
    check('Đến 10:00, về 10:00', hopLe('10:00', '10:00'), false);

    console.log('\n── 3. Cron 00:00 chốt ngày được mở khoá ──');
    const v1 = KtvTypeDDisciplineService.xetChotSoDem({
        regNgayVuaQua: { status: 'REGISTERED', penalty_applied: null }, coRegNgayMoi: true, coDiLamNgayVuaQua: true,
    });
    check('Khai giờ về + đi làm → đóng sổ, không lỗi', { dongSo: v1.dongSoNgayVuaQua, loi: v1.loi.length }, { dongSo: true, loi: 0 });
    const v2 = KtvTypeDDisciplineService.xetChotSoDem({
        regNgayVuaQua: null, coRegNgayMoi: false, coDiLamNgayVuaQua: false,
    });
    check('Không đi làm, không khai (cron miễn qua vuaMoKhoa; luật ngày mới vẫn còn)', v2.loi.map(l => l.caseKey), ['NO_REGISTRATION', 'UNREGISTERED_NEXT_DAY']);

    console.log(`\nTZ=${process.env.TZ || '(máy)'} · ${fail === 0 ? 'TẤT CẢ ĐẠT' : `${fail} LỖI`}`);
    process.exit(fail ? 1 : 0);
})();
