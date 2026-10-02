/**
 * QA #19 · Báo cáo tài chính: KTV bị đổi ra = 0đ, KTV ngoài = Loại C
 *
 * Vì sao cần: các route `finance/reports/*` chia tiền/tip theo
 * `technicianCodes.length`. Cột đó cố ý giữ cả người bị đổi ra để truy vết,
 * nên người bị tước vẫn được chia đều — trong khi ví KTV (`KtvWalletService`)
 * đã loại họ bằng `isKtvVoidedOnItem`. Hai phía lệch nhau đúng số tiền đó.
 *
 * Sửa: `KtvCommissionService.activeTechs(item)` là danh sách duy nhất để chia.
 * File này chứng minh bằng mock — không chạm DB. Chạy thêm dưới TZ=UTC.
 *
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_19_report_voided_and_ext.ts
 */
import { KtvCommissionService } from '@/lib/services/KtvCommissionService';
import { isPlaceholderStaffId } from '@/lib/constants/staff.constants';

let fail = 0;
const check = (dat: boolean, ten: string, them = '') => {
    if (!dat) fail++;
    console.log(`  [${dat ? 'PASS' : 'FAIL'}] ${ten}${them ? ` — ${them}` : ''}`);
};

console.log('=== QA #19 · Bao cao: KTV bi doi ra = 0d, KTV ngoai = Loai C ===');
console.log(`TZ hien tai: ${process.env.TZ || '(he thong)'}`);

// Item đúng định dạng BookingItems: 2 KTV, T002 bị đổi ra (voided), không có
// actualStart/End → ép các route rơi vào nhánh dự phòng `fallback / số KTV`.
const ITEM_SWAP: any = {
    id: 'BI-1', serviceId: 'NHS60', quantity: 1, tip: 100_000, status: 'DONE',
    technicianCodes: ['T001', 'T002'],
    segments: [
        { ktvId: 'T001', duration: 60 },
        { ktvId: 'T002', duration: 60, voided: true, voidReason: 'CHANGED_KTV' },
    ],
};
const FALLBACK = 60;

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R1: activeTechs loai nguoi bi doi ra ---');
{
    const active = KtvCommissionService.activeTechs(ITEM_SWAP);
    check(active.length === 1 && active[0] === 'T001', 'activeTechs = [T001]', JSON.stringify(active));
    check(KtvCommissionService.isKtvVoidedOnItem(ITEM_SWAP, 'T002'), 'T002 bi tuoc (isKtvVoidedOnItem)');
    check(!KtvCommissionService.isKtvVoidedOnItem(ITEM_SWAP, 'T001'), 'T001 con quyen loi');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R2: phut tinh tien — cach CU (technicianCodes) vs cach MOI (activeTechs) ---');
{
    // Cách cũ trong finance/reports: actualMins > 0 ? actualMins : fallback / techs.length
    const oldShare = (code: string) => {
        const techs = ITEM_SWAP.technicianCodes as string[];
        const actual = KtvCommissionService.calculateItemDuration(ITEM_SWAP, code, FALLBACK);
        return actual > 0 ? actual : FALLBACK / techs.length;
    };
    const newShare = (code: string) => {
        const techs = KtvCommissionService.activeTechs(ITEM_SWAP);
        if (!techs.includes(code)) return 0;
        const actual = KtvCommissionService.calculateItemDuration(ITEM_SWAP, code, FALLBACK);
        return actual > 0 ? actual : FALLBACK / techs.length;
    };
    // Phía ví KTV (KtvWalletService): bị tước → 0, còn lại calculateItemDuration || 60
    const walletShare = (code: string) => {
        if (KtvCommissionService.isKtvVoidedOnItem(ITEM_SWAP, code)) return 0;
        const d = KtvCommissionService.calculateItemDuration(ITEM_SWAP, code, FALLBACK);
        return d <= 0 ? 60 : d;
    };

    console.log('  KTV  | vi KTV | bao cao CU | bao cao MOI');
    for (const code of ['T001', 'T002']) {
        console.log(`  ${code} | ${String(walletShare(code)).padStart(6)} | ${String(oldShare(code)).padStart(10)} | ${String(newShare(code)).padStart(11)}`);
    }
    check(oldShare('T002') > 0, 'Cach CU tra phut cho T002 (day la loi dang sua)', `${oldShare('T002')} phut`);
    check(newShare('T002') === 0, 'Cach MOI: T002 = 0 phut');
    check(newShare('T001') === walletShare('T001'), 'Cach MOI: T001 khop vi KTV', `${newShare('T001')} vs ${walletShare('T001')}`);
    check(newShare('T002') === walletShare('T002'), 'Cach MOI: T002 khop vi KTV (0)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R3: tip chia theo activeTechs ---');
{
    const tip = Number(ITEM_SWAP.tip);
    const oldTip = tip / ITEM_SWAP.technicianCodes.length;
    const active = KtvCommissionService.activeTechs(ITEM_SWAP);
    const newTip = tip / active.length;
    check(oldTip === 50_000, 'Cach CU: moi nguoi 50.000d (T002 van duoc tip)', `${oldTip}`);
    check(newTip === 100_000, 'Cach MOI: T001 nhan tron 100.000d, T002 = 0', `${newTip}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R4: item khong co segment (du lieu thieu) van chia deu nhu cu ---');
{
    const item: any = { id: 'BI-2', serviceId: 'NHS60', technicianCodes: ['T003', 'T004'], segments: [] };
    const active = KtvCommissionService.activeTechs(item);
    check(active.length === 2, 'Khong ai bi tuoc → giu ca 2', JSON.stringify(active));
    check(KtvCommissionService.calculateItemDuration(item, 'T003', FALLBACK) >= 0, 'calculateItemDuration khong nem loi');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R5: KTV ngoai EXT_* → work type TYPE_C trong map bao cao ---');
{
    const staffRows = [
        { id: 'EXT_abc123', full_name: 'Lisa', work_type: null, status: 'ĐANG LÀM' },
        { id: 'T001', full_name: 'Na', work_type: 'TYPE_B', status: 'ĐANG LÀM' },
    ];
    // Đúng biểu thức đang dùng ở finance/reports/route.ts và ktv-ranking/route.ts
    const map: Record<string, string> = {};
    staffRows.forEach(s => { map[s.id] = isPlaceholderStaffId(s.id) ? 'TYPE_C' : (s.work_type || 'TYPE_A'); });
    check(map['EXT_abc123'] === 'TYPE_C', 'EXT_abc123 → TYPE_C (truoc day: bi bo khoi map → TYPE_A)');
    check(map['T001'] === 'TYPE_B', 'KTV thuong giu nguyen work_type');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n--- R6: activeTechs chiu duoc segments dang chuoi JSON va ma trong ---');
{
    const item: any = {
        technicianCodes: ['T005', '', null, 'T006'],
        segments: JSON.stringify([{ ktvId: 'T006', duration: 30, voided: true }]),
    };
    const active = KtvCommissionService.activeTechs(item);
    check(active.length === 1 && active[0] === 'T005', 'Bo ma trong/null va T006 bi tuoc', JSON.stringify(active));
}

console.log(`\n=== KET QUA: ${fail === 0 ? 'PASS' : `FAIL (${fail})`} ===`);
process.exit(fail === 0 ? 0 : 1);
