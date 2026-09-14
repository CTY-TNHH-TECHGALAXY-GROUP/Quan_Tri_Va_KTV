/**
 * ================================================================
 * MÔ PHỎNG CHẾ TÀI KỶ LUẬT LOẠI D
 * ================================================================
 * Gọi THẲNG `KtvTypeDDisciplineService.applyCasePenalty` (hàm thật mà cron
 * dùng) với một Supabase giả, để kiểm: cùng một tình huống, đổi chế tài trong
 * Cài đặt thì kết quả có đổi theo không, và mốc "quỹ giờ không đủ" có đúng chỗ.
 *
 * Chạy:  npx ts-node -r tsconfig-paths/register -O "{\"module\":\"commonjs\"}" scripts/simulate_type_d_discipline_cases.ts
 *        (`tsconfig-paths` để mục 7 gọi được `lib/unfinished-work.ts` — file đó import `@/lib/...`)
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
    'UNREGISTERED_NEXT_DAY', 'NO_REGISTRATION', 'NO_SHOW_NO_NOTICE',
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

    console.log('\n═══ 5. KHÔNG ĐĂNG KÝ LỊCH → KHOÁ THẲNG (quyết định 14/09) ═══');
    // Đi đúng đường cron thật: xetChotSoDem → applyCasePenalty lần lượt, khoá thì dừng.
    const chotSoDem = async (rules: any, reg: any, coRegMoi: boolean, coDiLam: boolean) => {
        const { loi: dsLoi } = KtvTypeDDisciplineService.xetChotSoDem({
            regNgayVuaQua: reg, coRegNgayMoi: coRegMoi, coDiLamNgayVuaQua: coDiLam,
        });
        const sb = fakeSupabase(rules, 30 * 60, 0);
        const daXu: string[] = [];
        for (const l of dsLoi) {
            const r = await KtvTypeDDisciplineService.applyCasePenalty(
                sb, { staffId: 'T001', workDate: '2026-09-15', caseKey: l.caseKey, reason: l.lyDo }, true);
            if (r.ketQua !== 'NONE') daXu.push(`${l.caseKey}:${r.ketQua}${r.ketQua === 'DEDUCT' ? ` ${r.hours}h` : ''}`);
            if (r.ketQua === 'LOCK') break;
        }
        return daXu.join(', ') || '—';
    };

    const kichBan = [
        { ten: 'A. Chưa đăng ký ngày mới, đang làm dở đơn', reg: { status: 'REGISTERED' }, moi: false, diLam: true, mong: 'UNREGISTERED_NEXT_DAY:LOCK' },
        { ten: 'B. Đăng ký OFF ngày vừa qua, đã đăng ký ngày mới', reg: { status: 'OFF_REGISTERED' }, moi: true, diLam: false, mong: '—' },
        { ten: 'C. Được mở khoá, đăng ký bù hôm đó + ngày mới', reg: { status: 'REGISTERED' }, moi: true, diLam: true, mong: '—' },
        { ten: 'D. Được mở khoá, KHÔNG đăng ký bù, có đi làm', reg: null, moi: true, diLam: true, mong: 'NO_REGISTRATION:LOCK' },
        { ten: 'E. Đăng ký bù hôm đó, quên đăng ký ngày mới', reg: { status: 'REGISTERED' }, moi: false, diLam: true, mong: 'UNREGISTERED_NEXT_DAY:LOCK' },
        { ten: 'F. Không đăng ký cả hai ngày → khoá 1 lần', reg: null, moi: false, diLam: false, mong: 'NO_REGISTRATION:LOCK' },
        { ten: 'G. Đăng ký làm không đến, ngày mới đã đăng ký', reg: { status: 'REGISTERED' }, moi: true, diLam: false, mong: 'NO_SHOW_NO_NOTICE:DEDUCT 10h' },
        { ten: 'H. Đăng ký làm không đến + chưa đăng ký ngày mới', reg: { status: 'REGISTERED' }, moi: false, diLam: false, mong: 'UNREGISTERED_NEXT_DAY:LOCK' },
        { ten: 'I. Lượt trước đã phạt rồi', reg: { status: 'COMPLETED', penalty_applied: 'NO_SHOW_NO_NOTICE' }, moi: true, diLam: false, mong: '—' },
    ];
    for (const k of kichBan) {
        const ra = await chotSoDem(macDinh, k.reg, k.moi, k.diLam);
        const dung = ra === k.mong;
        if (!dung) loi++;
        console.log(`  ${k.ten.padEnd(52)} → ${ra.padEnd(30)} ${dung ? '✅' : `❌ đáng lẽ ${k.mong}`}`);
    }

    // Bẫy deploy: production còn lưu NONE / DEDUCT_OR_LOCK thì cấu hình thắng code.
    const cauHinhCu = { CASES: { UNREGISTERED_NEXT_DAY: { action: 'NONE', hours: 0 }, NO_REGISTRATION: { action: 'DEDUCT_OR_LOCK', hours: 10 } } };
    const raCu = await chotSoDem(cauHinhCu, null, false, true);
    const dungCu = raCu === 'NO_REGISTRATION:DEDUCT 10h';
    if (!dungCu) loi++;
    console.log(`  ${'J. Cấu hình production cũ còn lưu (bẫy mục 7)'.padEnd(52)} → ${raCu.padEnd(30)} ${dungCu ? '✅ (đúng là KHÔNG khoá — admin phải đổi)' : '❌'}`);

    console.log('\n═══ 6. TẠO / SỬA ĐĂNG KÝ THEO GIỜ HIỆN TẠI ═══');
    const { canCreateRegistration, canEditRegistration, vnToday, vnHour } = await import('../lib/vn-time');
    const homNay = vnToday();
    const lech = (n: number) => new Date(new Date(homNay + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
    console.log(`  (TZ=${process.env.TZ || 'máy'} · hôm nay VN ${homNay} · ${vnHour()} giờ)`);
    const kiemNgay = [
        { ten: 'Tạo dòng mới hôm qua', ra: canCreateRegistration(lech(-1)), mong: false },
        { ten: 'Tạo dòng mới HÔM NAY (mọi giờ)', ra: canCreateRegistration(homNay), mong: true },
        { ten: 'Tạo dòng mới ngày mai', ra: canCreateRegistration(lech(1)), mong: true },
        { ten: 'Sửa dòng có sẵn hôm nay', ra: canEditRegistration(homNay), mong: vnHour() < 7 },
        { ten: 'Sửa dòng có sẵn ngày mai', ra: canEditRegistration(lech(1)), mong: true },
    ];
    for (const k of kiemNgay) {
        const dung = k.ra === k.mong;
        if (!dung) loi++;
        console.log(`  ${k.ten.padEnd(34)} → ${String(k.ra).padEnd(5)} ${dung ? '✅' : `❌ đáng lẽ ${k.mong}`}`);
    }

    console.log('\n═══ 7. HOÃN KHOÁ KHI KTV CÒN ĐƠN (plan §9) ═══');
    // DB giả đúng dạng bảng thật: KtvAssignments → BookingItems (segments, technicianCodes) → Bookings.
    const donDb = (items: any[]) => ({
        from(table: string) {
            const rows = table === 'KtvAssignments' ? items.map(i => ({ booking_item_id: i.id }))
                : table === 'BookingItems' ? items
                : table === 'Bookings' ? items.map(i => ({ id: i.bookingId, billCode: `HD-${i.bookingId}` }))
                : [];
            const api: any = {
                select: () => api, eq: () => api, in: () => api, neq: () => api, not: () => api,
                gte: () => api, lte: () => api, order: () => api, limit: () => api,
                maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }),
                then: (r: any) => Promise.resolve({ data: rows }).then(r),
            };
            return api;
        },
    }) as any;
    const item = (status: string, segs: any[] = [{ ktvId: 'T020', duration: 60 }], tech = ['T020']) =>
        ({ id: `it-${status}`, bookingId: 'B1', status, segments: JSON.stringify(segs), technicianCodes: tech });

    const kbDon = [
        { ten: 'Đang làm (IN_PROGRESS)', it: item('IN_PROGRESS'), mong: true },
        { ten: 'Tạm dừng (PAUSED)', it: item('PAUSED'), mong: true },
        { ten: 'Đang dọn phòng (CLEANING)', it: item('CLEANING'), mong: true },
        { ten: 'Nộp ảnh, chờ quầy duyệt (FEEDBACK)', it: item('FEEDBACK'), mong: true },
        { ten: 'Chờ duyệt bàn giao (COMPLETED)', it: item('COMPLETED'), mong: true },
        { ten: 'Quầy đã duyệt (DONE)', it: item('DONE'), mong: false },
        { ten: 'Đơn huỷ (CANCELLED)', it: item('CANCELLED'), mong: false },
        { ten: 'Bị đổi ra khỏi đơn đang làm', it: item('IN_PROGRESS', [{ ktvId: 'T020', voided: true, note: 'CHANGED' }, { ktvId: 'T030' }], ['T020', 'T030']), mong: false },
        { ten: 'Làm song song "T020 - T030"', it: item('CLEANING', [{ ktvId: 'T020 - T030' }], ['T020', 'T030']), mong: true },
    ];
    for (const k of kbDon) {
        const don = await KtvTypeDDisciplineService.timDonDangLam(donDb([k.it]), 'T020');
        const dung = (don.length > 0) === k.mong;
        if (!dung) loi++;
        console.log(`  ${k.ten.padEnd(38)} → ${don.length > 0 ? `HOÃN (${don.join(', ')})` : 'khoá ngay'.padEnd(12)} ${dung ? '✅' : `❌ đáng lẽ ${k.mong ? 'HOÃN' : 'khoá ngay'}`}`);
    }

    // Nút tắt "Hoạt động" gọi KHÔNG có tham số → khúc chờ duyệt vẫn không tính như trước.
    const { findUnfinishedWorkToday } = await import('../lib/unfinished-work');
    const nutTat = await findUnfinishedWorkToday(donDb([item('FEEDBACK')]), 'T020');
    const dungNut = nutTat.length === 0;
    if (!dungNut) loi++;
    console.log(`  ${'Nút tắt "Hoạt động" với đơn FEEDBACK'.padEnd(38)} → ${nutTat.length === 0 ? 'cho tắt (như cũ)' : 'chặn'} ${dungNut ? '✅' : '❌'}`);

    // applyCasePenalty: chỉ hỏi đơn khi quyết KHOÁ; trừ giờ thì không hoãn.
    let daHoi = 0;
    const coDon = async () => { daHoi++; return ['HD-B1']; };
    const sbMacDinh = fakeSupabase(macDinh, 30 * 60, 0);
    const rKhoa = await KtvTypeDDisciplineService.applyCasePenalty(sbMacDinh,
        { staffId: 'T020', workDate: '2026-09-15', caseKey: 'UNREGISTERED_NEXT_DAY', reason: 'mô phỏng', timDonDangLam: coDon }, true);
    const rTru = await KtvTypeDDisciplineService.applyCasePenalty(sbMacDinh,
        { staffId: 'T020', workDate: '2026-09-15', caseKey: 'NO_SHOW_NO_NOTICE', reason: 'mô phỏng', timDonDangLam: coDon }, true);
    const rKhongDon = await KtvTypeDDisciplineService.applyCasePenalty(sbMacDinh,
        { staffId: 'T020', workDate: '2026-09-15', caseKey: 'UNREGISTERED_NEXT_DAY', reason: 'mô phỏng', timDonDangLam: async () => [] }, true);
    const kiemApply = [
        { ten: 'Khoá + còn đơn', ok: rKhoa.ketQua === 'LOCK' && rKhoa.hoan === true, ra: `${rKhoa.ketQua} hoãn=${rKhoa.hoan}` },
        { ten: 'Trừ giờ + còn đơn', ok: rTru.ketQua === 'DEDUCT' && rTru.hoan === false, ra: `${rTru.ketQua} hoãn=${rTru.hoan}` },
        { ten: 'Khoá + hết đơn', ok: rKhongDon.ketQua === 'LOCK' && rKhongDon.hoan === false, ra: `${rKhongDon.ketQua} hoãn=${rKhongDon.hoan}` },
        { ten: 'Chỉ hỏi đơn ở lượt khoá', ok: daHoi === 1, ra: `hỏi ${daHoi} lần` },
    ];
    for (const k of kiemApply) {
        if (!k.ok) loi++;
        console.log(`  ${k.ten.padEnd(38)} → ${k.ra.padEnd(22)} ${k.ok ? '✅' : '❌'}`);
    }

    console.log(loi === 0 ? '\n✅ Tất cả trường hợp đúng như cấu hình.\n' : `\n❌ ${loi} trường hợp sai.\n`);
    process.exit(loi === 0 ? 0 : 1);
})();
