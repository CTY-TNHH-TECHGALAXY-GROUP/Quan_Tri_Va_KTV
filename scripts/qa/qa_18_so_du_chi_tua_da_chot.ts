/**
 * QA #18 · Số dư luỹ kế CHỈ tính tua ĐÃ CHỐT
 *
 * Vì sao cần: `KtvWalletService.getBalance` bỏ tua chưa chốt ra khỏi số dư, còn
 * `attachRunningBalance` trước đây cộng cả vào → hai con số tiền trên CÙNG một
 * màn không bằng nhau (T069 lệch 10.500đ).
 *
 * Nhánh `HELD` của A/B/C không có dữ liệu thật nào chạm tới (xem R4), nên chỗ
 * duy nhất chứng minh được nó xử lý đúng là mock data.
 */
import { attachRunningBalance, countsTowardBalance } from '@/lib/services/KtvWalletBalanceRules';
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';

let fail = 0;
const check = (dat: boolean, ten: string, them = '') => {
    if (!dat) fail++;
    console.log(`  [${dat ? 'PASS' : 'FAIL'}] ${ten}${them ? ` — ${them}` : ''}`);
};
const d = (h: number) => `2026-09-11T${String(h).padStart(2, '0')}:00:00Z`;

console.log('=== QA #18 · So du luy ke chi tinh tua DA CHOT ===');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R1: tua A/B/C dang TAM GIU (HELD) khong duoc vao so du ---');
{
    const tl: any[] = [
        { type: 'COMMISSION', status: 'APPROVED', amount: 100000, created_at: d(10) },
        { type: 'COMMISSION', status: 'HELD',     amount: 250000, created_at: d(11) },
        { type: 'COMMISSION', status: 'APPROVED', amount: 50000,  created_at: d(12) },
    ];
    attachRunningBalance(tl);
    check(tl[0].running_balance === 100000, 'Dong chot dau: 100.000d', `${tl[0].running_balance}`);
    check(tl[1].running_balance === 100000, 'Dong HELD KHONG day so du len', `${tl[1].running_balance}`);
    check(tl[2].running_balance === 150000, 'Dong chot sau chi cong tua da chot', `${tl[2].running_balance}`);
    check(!countsTowardBalance(tl[1]), 'countsTowardBalance(HELD) = false');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R2: tua loai D TAM TINH va thue di kem deu bi bo ---');
{
    const tl: any[] = [
        { type: 'COMMISSION', status: 'APPROVED', amount: 25000,  created_at: d(10) },
        { type: 'ADJUSTMENT', status: 'APPROVED', amount: -2500,  created_at: d(10) },
        { type: 'COMMISSION', status: 'PENDING',  amount: 8333.33, created_at: d(11), is_provisional: true },
        { type: 'ADJUSTMENT', status: 'APPROVED', amount: -833.33, created_at: d(11), is_provisional: true },
    ];
    attachRunningBalance(tl);
    const cuoi = tl[3].running_balance;
    check(Math.abs(cuoi - 22500) < 0.001, 'So du dung lai o 22.500d (bo ca tua lan thue tam tinh)', `${cuoi}`);
    check(!countsTowardBalance(tl[2]) && !countsTowardBalance(tl[3]), 'Ca hai dong tam tinh deu bi bo');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R3: lenh rut PENDING VAN phai tru (bay de nhat cua bai nay) ---');
{
    const tl: any[] = [
        { type: 'COMMISSION', status: 'APPROVED', amount: 500000, created_at: d(10) },
        { type: 'WITHDRAWAL', status: 'PENDING',  amount: -200000, created_at: d(11) },
        { type: 'WITHDRAWAL', status: 'REJECTED', amount: -100000, created_at: d(12) },
        { type: 'TIP',        status: 'APPROVED', amount: 50000,  created_at: d(13) },
    ];
    attachRunningBalance(tl);
    check(countsTowardBalance(tl[1]), 'Lenh rut PENDING VAN tinh — o so du lon da tru total_pending');
    check(tl[1].running_balance === 300000, 'Tru lenh rut cho duyet', `${tl[1].running_balance}`);
    check(tl[2].running_balance === 300000, 'Lenh rut BI TU CHOI khong tru', `${tl[2].running_balance}`);
    check(tl[3].running_balance === 300000, 'TIP khong vao vi', `${tl[3].running_balance}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R4: nhanh HELD hien la nhanh NGU (chua bo quy che giam tien) ---');
{
    const item = { id: 'x', status: 'DONE', technicianCodes: ['NH016'], segments: [] };
    const { isPassed } = KtvCommissionService.checkIsItemPassed(item, { id: 'b' }, 'NH016');
    check(isPassed === true, 'checkIsItemPassed luon tra true (commit bddf3272 bo Hold Salary)');
    console.log('  => Vi vay heldCommission luon = 0 va khong dong HELD nao duoc sinh ra.');
    console.log('  => Nhanh HELD giu lai de quy che giam tien quay lai thi so du khong am tham sai.');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R5: tru tien coc chi tru MOT lan o moi dong ---');
{
    const tl: any[] = [
        { type: 'COMMISSION', status: 'APPROVED', amount: 1000000, created_at: d(10) },
        { type: 'COMMISSION', status: 'HELD',     amount: 500000,  created_at: d(11) },
    ];
    attachRunningBalance(tl, 300000);
    check(tl[0].running_balance === 700000, 'Dong 1: 1.000.000 - 300.000 coc', `${tl[0].running_balance}`);
    check(tl[1].running_balance === 700000, 'Dong HELD: van 700.000, khong cong 500.000', `${tl[1].running_balance}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R6: cung mot moc gio thi CONG truoc TRU sau ---');
{
    const tl: any[] = [
        { type: 'ADJUSTMENT', status: 'APPROVED', amount: -3333, created_at: d(10) },
        { type: 'COMMISSION', status: 'APPROVED', amount: 33333, created_at: d(10) },
    ];
    attachRunningBalance(tl);
    check(tl[1].running_balance === 33333, 'Dong cong mang so du 33.333d', `${tl[1].running_balance}`);
    check(tl[0].running_balance === 30000, 'Dong tru mang so du 30.000d', `${tl[0].running_balance}`);
}

console.log(fail === 0 ? '\n=== DAT ===' : `\n=== HONG: ${fail} kiem tra that bai ===`);
process.exit(fail === 0 ? 0 : 1);
