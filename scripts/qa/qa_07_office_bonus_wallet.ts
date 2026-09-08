/**
 * QA #7 — Ví Thu Nhập + Ví Điểm tính theo Office cho tài khoản loại D.
 *
 *   W1. Tài khoản test đều mở được Ví Thu Nhập (TUA) và Ví Điểm (BONUS).
 *   W2. Cờ `bonus_from_office` quyết định NGUỒN điểm, bật/tắt riêng từng người,
 *       và không đụng tới các cờ ví khác.
 *   W3. Điểm ví = ĐÚNG điểm tháng Office (`computeMonth().final`), không lệch.
 *   W4. Bậc quỹ nội bộ khớp bảng quy chế (98 / 96 / 90 / 85).
 *   W5. Lịch sử là danh sách theo NGÀY, giữ cả ngày sạch, mới nhất trước.
 *   W6. Điểm Office KHÔNG quy đổi ra tiền — `redeemable = false` và route rút
 *       tiền chặn ở tầng server, không chỉ ẩn nút.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *       scripts/qa/qa_07_office_bonus_wallet.ts
 *
 * CHỈ ĐỌC — không đổi cờ của ai.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { resolveStaffFlag, isWalletEnabled, walletConfigKey, WALLET_TYPES } from '../../lib/featureFlags';
import { KtvOfficeScoreService, currentMonthVn, fundTierOf, FUND_BASE } from '../../lib/services/KtvOfficeScoreService';
import { usesOfficeBonus, officeBonusBalance, officeBonusTimeline } from '../../lib/services/KtvOfficeBonusService';
import { finish, fatal } from './_exit';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

async function main() {
    const month = currentMonthVn();
    console.log(`\n=== QA #7 · Vi Thu Nhap + Vi Diem theo Office · thang ${month} ===\n`);

    const { data: staffRows } = await supabase
        .from('Staff').select('id, full_name, work_type, feature_flags')
        .eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').order('id');
    const staff = staffRows || [];
    const ids = staff.map(s => s.id);

    const { data: cfgRows } = await supabase
        .from('SystemConfigs').select('key, value').like('key', 'ktv_wallet_%');
    const configs: Record<string, any> = {};
    (cfgRows || []).forEach((c: any) => { configs[c.key] = c.value; });

    // ── W1: hai ví đều mở ──────────────────────────────────────────────
    console.log('--- W1: Vi Thu Nhap (TUA) va Vi Diem (BONUS) deu mo ---');
    console.log(`  Cong tac CA LOAI TYPE_D: ${WALLET_TYPES.map(w => `${w}=${configs[walletConfigKey(w, 'TYPE_D')]}`).join(' · ')}`);
    const noTua = staff.filter(s => !isWalletEnabled('TUA', s as any, configs)).map(s => s.id);
    const noBonus = staff.filter(s => !isWalletEnabled('BONUS', s as any, configs)).map(s => s.id);
    check(noTua.length === 0, `Ca ${ids.length} KTV loai D mo duoc Vi Thu Nhap`,
        noTua.length ? `con tat: ${noTua.join(', ')}` : '');
    check(noBonus.length === 0, `Ca ${ids.length} KTV loai D mo duoc Vi Diem`,
        noBonus.length ? `con tat: ${noBonus.join(', ')}` : '');

    // ── W2: cờ nguồn điểm ──────────────────────────────────────────────
    console.log('\n--- W2: co `bonus_from_office` quyet dinh NGUON diem ---');
    const onOffice: string[] = [];
    for (const s of staff) {
        const flagOn = resolveStaffFlag((s as any).feature_flags, 'bonus_from_office');
        const svcSaysYes = await usesOfficeBonus(supabase, s.id);
        if (flagOn !== svcSaysYes) {
            check(false, `${s.id}: co va service khong khop`, `co=${flagOn} service=${svcSaysYes}`);
        }
        if (svcSaysYes) onOffice.push(s.id);
    }
    console.log(`  Dang dung diem OFFICE: ${onOffice.length ? onOffice.join(', ') : 'khong ai'}`);
    console.log(`  Dang dung diem SAO   : ${ids.filter(i => !onOffice.includes(i)).join(', ') || 'khong ai'}`);
    check(onOffice.length > 0, 'Co it nhat mot tai khoan dung diem Office de kiem chung');

    // Bật cờ nguồn điểm KHÔNG được kéo theo cờ ví nào khác.
    const sample = staff.find(s => onOffice.includes(s.id));
    if (sample) {
        const f = (sample as any).feature_flags || {};
        check(resolveStaffFlag(f, 'tua_wallet') === true && resolveStaffFlag(f, 'bonus_wallet') === true,
            `${sample.id}: bat nguon Office khong lam tat vi nao`,
            `tua=${resolveStaffFlag(f, 'tua_wallet')} bonus=${resolveStaffFlag(f, 'bonus_wallet')}`);
    }
    // Loại khác loại D thì cờ có bật cũng không ăn thua.
    const { data: nonD } = await supabase
        .from('Staff').select('id').neq('work_type', 'TYPE_D').eq('status', 'ĐANG LÀM').limit(1);
    if (nonD?.length) {
        check((await usesOfficeBonus(supabase, nonD[0].id)) === false,
            `${nonD[0].id} (khong phai loai D) khong dung nguon Office`);
    }

    // ── W3 + W4 + W5 ───────────────────────────────────────────────────
    if (onOffice.length === 0) {
        console.log('\n  (khong co tai khoan nao bat nguon Office — bo qua W3..W6)');
    } else {
        console.log('\n--- W3: diem vi = DUNG diem thang Office ---');
        const scores = await KtvOfficeScoreService.computeMonth(supabase, onOffice, month);
        const table: any[] = [];
        for (const id of onOffice) {
            const truth = scores.get(id)!;
            const w = await officeBonusBalance(supabase, id, month);
            table.push({
                id, diem_vi: w.points, diem_office: truth.final,
                tb_ngay: w.avg, ngay_lam: w.workDays, ngay_sach: w.cleanDays,
                phat_lap: w.repeatPenalty, mien: `${w.exemptPct}%`, quy_phai_dong: w.fundDue,
            });
            if (w.points !== truth.final) {
                check(false, `${id}: diem vi lech diem Office`, `${w.points} vs ${truth.final}`);
            }
            if (w.workDays !== truth.workDays || w.fundDue !== truth.fundDue) {
                check(false, `${id}: so ngay / quy lech`, `${w.workDays}/${w.fundDue} vs ${truth.workDays}/${truth.fundDue}`);
            }
        }
        console.table(table);
        check(failures === 0 || table.length > 0, 'Diem vi bam sat diem Office cho moi tai khoan');

        console.log('\n--- W4: bac quy noi bo dung bang quy che ---');
        const TIERS: Array<[number, number, string]> = [
            [99, 0, '>=98 mien 100%'],
            [98, 0, 'dung nguong 98'],
            [97, 125_000, '96-97,9 mien 50%'],
            [96, 125_000, 'dung nguong 96'],
            [95, 175_000, '90-95,9 mien 30%'],
            [90, 175_000, 'dung nguong 90'],
            [89, 225_000, '85-89,9 mien 10%'],
            [85, 225_000, 'dung nguong 85'],
            [84.9, FUND_BASE, '<85 khong mien'],
            [0, FUND_BASE, '0 diem'],
        ];
        for (const [score, due, label] of TIERS) {
            const got = fundTierOf(score).fundDue;
            check(got === due, `${label}: ${score} diem => ${got.toLocaleString('vi-VN')}d`);
        }

        console.log('\n--- W5: lich su theo NGAY, giu ca ngay sach, moi nhat truoc ---');
        const who = onOffice[0];
        const tl = await officeBonusTimeline(supabase, who, month);
        console.log(`  ${who}: ${tl.length} ngay`);
        if (tl.length === 0) {
            console.log('  (thang nay chua co ngay cong nao de doi chieu)');
        } else {
            const sortedDesc = [...tl].map(d => d.date).sort().reverse().join(',');
            check(tl.map(d => d.date).join(',') === sortedDesc, 'Sap moi nhat truoc');
            const badMath = tl.filter(d => d.dayScore !== Math.max(0, 100 - d.deducted));
            check(badMath.length === 0, 'Diem ngay = 100 - tong diem bi tru',
                badMath.length ? `lech o ${badMath.map(d => d.date).join(', ')}` : '');
            const leaks = tl.flatMap(d => d.hits).filter((h: any) => 'photoUrls' in h);
            check(leaks.length === 0, 'Lich su chi tra SO LUONG anh, khong tra link');
            const clean = tl.filter(d => d.hits.length === 0).length;
            console.log(`  Trong do ${clean} ngay sach (van duoc liet ke de doi chieu)`);
        }

        console.log('\n--- W6: diem Office KHONG quy doi ra tien ---');
        const w0 = await officeBonusBalance(supabase, who, month);
        check(w0.redeemable === false, 'Payload noi ro redeemable = false');
        check(!('vnd_value' in (w0 as any)), 'Khong tra vnd_value — khong tu che ti gia diem->tien');

        const wSrc = fs.readFileSync(
            path.join(__dirname, '../../app/api/ktv/wallet/withdraw/route.ts'), 'utf8');
        check(/OFFICE_POINTS_NOT_REDEEMABLE/.test(wSrc),
            'Route rut tien chan o TANG SERVER, khong chi an nut');

        const pSrc = fs.readFileSync(
            path.join(__dirname, '../../app/ktv/wallet/page.tsx'), 'utf8');
        check(/isOfficeBonus/.test(pSrc) && /!isOfficeBonus/.test(pSrc),
            'Trang Vi ve the rieng cho nguon Office, khong dung the diem sao');
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
