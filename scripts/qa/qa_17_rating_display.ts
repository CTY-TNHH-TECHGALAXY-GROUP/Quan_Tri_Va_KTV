/**
 * Mo phong: cung 1 tua -> Vi va Lich Su phai noi cung mot con so.
 *
 * Dung `groupForHistory` THAT (lib/services/KtvDLedgerReader) de dung nhom, roi
 * chay lai dung bieu thuc hien thi cua hai man hinh.
 */
import { groupForHistory } from '@/lib/services/KtvDLedgerReader';
import { ratingLabel } from '@/lib/rating-label';

const row = (o: any) => ({
    id: o.id, staff_id: 'NHT01', group_id: o.group_id, booking_id: 'bk1',
    bill_code: o.bill, bill_suffix: '', guest_id: 'g1', work_date: '2026-09-11',
    booking_time_start: '2026-09-11T10:00:00', service_name: 'Goi dau - Co vai gay (70p)',
    assigned_minutes: 70, actual_minutes: 69, paid_minutes: 69,
    rating_used: o.rating, deduction_rate: o.deduction_rate,
    commission_gross: o.gross, commission_net: o.net, bonus_amount: o.bonus,
    tax_amount: o.tax, tip: 0, is_provisional: false, handover_status: 'APPROVED',
    co_workers: [], has_other_type_coworker: !!o.mixed,
});

// gross = tien theo thoi gian lam; net = gross * (1 - deduction); bonus = thuong 4*
const CASES = [
    { name: '4* Xuat sac',            ...{ rating: 4, deduction_rate: 0,    gross: 168333, net: 168333, bonus: 20000, tax: 18833 } },
    { name: '4* nhung doi hon hop',   ...{ rating: 4, deduction_rate: 0,    gross: 168333, net: 168333, bonus: 0,     tax: 16833, mixed: true } },
    { name: '3* Tot',                 ...{ rating: 3, deduction_rate: 0.25, gross: 168333, net: 126250, bonus: 0,     tax: 12625 } },
    { name: '2* Binh thuong',         ...{ rating: 2, deduction_rate: 0.5,  gross: 168333, net: 84167,  bonus: 0,     tax: 8417 } },
    { name: '1* Te',                  ...{ rating: 1, deduction_rate: 0.75, gross: 168333, net: 42083,  bonus: 0,     tax: 4208 } },
];

/** Dong ghi chu cua Vi — copy dung bieu thuc trong app/api/ktv/wallet/timeline/route.ts */
const viNote = (g: any) => {
    const ten = ratingLabel(g.rating);
    let ketQua = '';
    if (ten) {
        if (g.bonus_amount > 0) {
            ketQua = ` · ${ten} +${Math.round(g.bonus_amount).toLocaleString('vi-VN')}đ`;
        } else if (g.deduction_rate > 0) {
            const truTien = Math.round(g.commission_gross - g.commission_net);
            const pct = Math.round(g.deduction_rate * 100);
            ketQua = ` · ${ten} −${pct}%` + (truTien > 0 ? ` (−${truTien.toLocaleString('vi-VN')}đ)` : '');
        }
    }
    return `${g.service_name} · ${Math.round(g.paid_minutes)} phút` + ketQua;
};

/** API Lich Su — copy dung bieu thuc trong app/api/ktv/history/route.ts */
const historyRecord = (g: any) => {
    const commission = Math.round(g.commission_net + g.bonus_amount);
    const commissionBeforeDeduction = Math.round(g.commission_gross);
    return {
        commission,
        commissionBeforeDeduction,
        ratingBonusAmount: Math.round(g.bonus_amount),
        ratingDeductionRate: g.deduction_rate,
        ratingDeductionAmount: Math.max(0, commissionBeforeDeduction - commission),
        grossIncome: commission,
        taxAmount: Math.round(g.tax_amount),
        netIncome: commission - Math.round(g.tax_amount),
    };
};

/** The tien canh muc danh gia — copy dung bieu thuc trong app/ktv/history/page.tsx */
const theDanhGia = (o: any) => {
    const bonus = Number(o.ratingBonusAmount) || 0;
    if (bonus > 0) return `+${bonus.toLocaleString('vi-VN')}đ`;
    const deduction = Number(o.ratingDeductionAmount) || 0;
    if (deduction > 0) {
        const pct = Math.round((Number(o.ratingDeductionRate) || 0) * 100);
        return `−${pct}% · −${deduction.toLocaleString('vi-VN')}đ`;
    }
    return '(khong co the tien)';
};

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
let loi = 0;

for (const c of CASES) {
    const g = groupForHistory([row({ ...c, group_id: c.name, bill: '004-11092026' }) as any])[0];
    const h = historyRecord(g);

    // Vi hien "Tien tua don" = commission_net + bonus_amount; Lich Su hien
    // "Tong thu nhap don" = grossIncome + ratingDeductionAmount. Hai con so nay
    // phai bang nhau, neu khong KTV doi chieu hai man se ra hai ket qua.
    const viTienTua = Math.round(g.commission_net + g.bonus_amount);
    const lsTongThuNhap = h.grossIncome + h.ratingDeductionAmount;
    const khop = viTienTua === h.commission && lsTongThuNhap === h.commissionBeforeDeduction + h.ratingBonusAmount;
    if (!khop) loi++;

    console.log('\n═══', c.name, '═══');
    console.log('  VÍ      | Tiền tua đơn:', vnd(viTienTua));
    console.log('          |', viNote(g));
    console.log('  LỊCH SỬ | Tiền tua:', vnd(h.commissionBeforeDeduction),
        '· Đánh giá:', ratingLabel(g.rating), theDanhGia(h));
    console.log('          | Tổng thu nhập đơn:', vnd(lsTongThuNhap),
        '→ thuế', vnd(h.taxAmount), '→ thực nhận', vnd(h.netIncome));
    console.log('  ĐỐI CHIẾU 2 PHÍA:', khop ? '✅ KHỚP' : '❌ LỆCH',
        `(ví ${vnd(viTienTua)} vs lịch sử ${vnd(h.commission)})`);
    console.log('  Tiền tua + thẻ đánh giá =', vnd(h.commissionBeforeDeduction + h.ratingBonusAmount - h.ratingDeductionAmount),
        '| thực trả trước thuế =', vnd(h.commission),
        h.commissionBeforeDeduction + h.ratingBonusAmount - h.ratingDeductionAmount === h.commission ? '✅' : '❌');
}

console.log(loi === 0 ? '\n✅ Tất cả trường hợp: ví và lịch sử khớp nhau.' : `\n❌ ${loi} trường hợp lệch.`);
