/**
 * QA #10 — Thưởng 4★ của KTV loại D nằm TRONG tiền tua.
 *
 * Trước đây thưởng nằm ở ví bonus riêng, tính bởi `KtvTypeDWalletService`, và
 * lịch sử tua không hề hiện nó. Nay nó là một phần tiền tua:
 *
 *     thực nhận = commission_net + bonus_amount − tax_amount
 *     tax_amount = (commission_net + bonus_amount) × 10%
 *
 * Hai nhóm kiểm tra:
 *   B1. Luật tính thưởng (chạy thẳng trên engine, KHÔNG đụng DB).
 *   B2. Không trả hai lần — sổ cái tua có thưởng thì ví bonus phải hết
 *       (chỉ đọc DB thật).
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_10_bonus_in_turn.ts
 * CHỈ ĐỌC DB.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { applyBonusAndTax, TurnRow, TypeDConfigs } from '@/lib/services/KtvDLedgerEngine';
import { finish, fatal } from './_exit';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

let failures = 0;

function check(ten: string, thuc: number, mongDoi: number): void {
    const ok = Math.abs(thuc - mongDoi) < 0.01;
    if (!ok) failures++;
    console.log(`  ${ok ? 'DAT ' : 'HONG'} | ${ten}: ${Math.round(thuc)} (mong doi ${Math.round(mongDoi)})`);
}

const CFG: TypeDConfigs = {
    rateVIP: 180000,
    ratePT: 100000,
    ratingDeductions: { '0': 0, '1': 0.75, '2': 0.5, '3': 0.25, '4': 0 },
    cutoffHours: 6,
    taxRate: 0.1,
    taxEffectiveFrom: '2026-09-01',
    bonusEnabled: true,
    bonusPerGuest: 20000,
};

/** Dòng sổ cái tối giản — chỉ những trường mà `applyBonusAndTax` đọc tới. */
function row(staff: string, group: string, rating: number, net: number): TurnRow {
    return {
        staff_id: staff,
        group_id: group,
        rating_used: rating,
        commission_net: net,
        bonus_amount: 0,
        tax_amount: 0,
    } as unknown as TurnRow;
}

const tongThuong = (rows: TurnRow[]) => rows.reduce((s, r) => s + r.bonus_amount, 0);

function b1_luatTinhThuong(): void {
    console.log('\nB1. Luat tinh thuong');

    // Thưởng tính THEO KHÁCH: khách làm mấy dịch vụ cũng chỉ một suất.
    let rows = [row('T1', 'gA', 4, 100000), row('T1', 'gA', 4, 50000), row('T1', 'gA', 4, 30000)];
    applyBonusAndTax(rows, false, '2026-09-08', CFG);
    check('1 khach / 3 dich vu -> 1 suat', tongThuong(rows), 20000);

    // Nhiều KTV loại D cùng phục vụ một khách thì chia đều suất đó.
    rows = [row('T1', 'gA', 4, 100000), row('T2', 'gA', 4, 100000)];
    applyBonusAndTax(rows, false, '2026-09-08', CFG);
    check('2 KTV / 1 khach -> moi nguoi mot nua', rows[0].bonus_amount, 10000);
    check('2 KTV / 1 khach -> tong van 1 suat', tongThuong(rows), 20000);

    rows = [row('T1', 'gA', 4, 100000), row('T1', 'gB', 4, 100000)];
    applyBonusAndTax(rows, false, '2026-09-08', CFG);
    check('2 khach -> 2 suat', tongThuong(rows), 40000);

    rows = [row('T1', 'gA', 3, 100000)];
    applyBonusAndTax(rows, false, '2026-09-08', CFG);
    check('3 sao -> khong thuong', rows[0].bonus_amount, 0);

    // Luật loại trừ sẵn có: bill lẫn KTV khác chế độ thì cả bill mất thưởng.
    rows = [row('T1', 'gA', 4, 100000)];
    applyBonusAndTax(rows, true, '2026-09-08', CFG);
    check('bill co KTV khac loai -> mat thuong', rows[0].bonus_amount, 0);

    rows = [row('T1', 'gA', 4, 100000)];
    applyBonusAndTax(rows, false, '2026-09-08', { ...CFG, bonusEnabled: false });
    check('tat enable_ktv_bonus_TYPE_D -> khong thuong', rows[0].bonus_amount, 0);

    // Thưởng nằm TRONG cơ sở tính thuế.
    rows = [row('T1', 'gA', 4, 100000)];
    applyBonusAndTax(rows, false, '2026-09-08', CFG);
    check('thue = (tua + thuong) x 10%', rows[0].tax_amount, 12000);

    rows = [row('T1', 'gA', 4, 100000)];
    applyBonusAndTax(rows, false, '2026-08-31', CFG);
    check('truoc moc thue -> thue 0', rows[0].tax_amount, 0);
    check('truoc moc thue -> van co thuong', rows[0].bonus_amount, 20000);
}

async function b2_khongTraHaiLan(): Promise<void> {
    console.log('\nB2. Khong tra hai lan');

    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string
    );

    // Sổ cái tua đã mang thưởng...
    const { data: led } = await sb
        .from('KTVDTurnLedger')
        .select('staff_id, bonus_amount')
        .gt('bonus_amount', 0);

    const staffCoThuong = [...new Set((led || []).map((r: any) => r.staff_id))];
    console.log(`  (${staffCoThuong.length} KTV co thuong trong so cai tua)`);

    // ...thì KTVDailyLedger KHÔNG được mang điểm thưởng nữa cho loại D.
    const { data: daily } = await sb
        .from('KTVDailyLedger')
        .select('staff_id, date, total_bonus')
        .eq('work_type_snapshot', 'TYPE_D')
        .gt('total_bonus', 0)
        .gte('date', '2026-09-01');

    const trung = (daily || []).length;
    if (trung > 0) {
        failures++;
        console.log(`  HONG | KTVDailyLedger con ${trung} dong total_bonus > 0 cho loai D`
            + ` -> vi bonus se tra lan hai. Vi du: ${JSON.stringify((daily || [])[0])}`);
    } else {
        console.log('  DAT  | KTVDailyLedger khong con diem thuong cho loai D');
    }

    // Cơ sở tính thuế của mọi dòng phải là (tua + thưởng).
    const { data: rows } = await sb
        .from('KTVDTurnLedger')
        .select('commission_net, bonus_amount, tax_amount, work_date')
        .gte('work_date', '2026-09-01')
        .gt('tax_amount', 0);

    let lech = 0;
    for (const r of rows || []) {
        const mongDoi = (Number(r.commission_net) + Number(r.bonus_amount)) * 0.1;
        if (Math.abs(Number(r.tax_amount) - mongDoi) > 0.01) lech++;
    }
    if (lech > 0) {
        failures++;
        console.log(`  HONG | ${lech}/${(rows || []).length} dong co thue KHONG bang (tua + thuong) x 10%`);
    } else {
        console.log(`  DAT  | ${(rows || []).length} dong: thue = (tua + thuong) x 10%`);
    }
}

async function main(): Promise<void> {
    console.log('QA #10 — Thuong 4 sao nam trong tien tua');
    b1_luatTinhThuong();
    await b2_khongTraHaiLan();
    console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG (' + failures + ')'} ===`);
    finish(failures);
}

main().catch(fatal);
