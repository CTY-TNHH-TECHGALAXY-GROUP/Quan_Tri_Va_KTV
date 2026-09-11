/**
 * QA #14 — Lịch chọn "Ngày vi phạm" của admin: giống lịch KTV, khoá sẵn ngày sai.
 *
 *   L1. Luật từng ô (`dayPickState`): tương lai / ngoài quyền lễ tân / KTV không
 *       đi làm → KHÔNG bấm được; ngày đi làm → bấm được, tô xanh hoặc đỏ.
 *   L2. Bản CẢ THÁNG (`workdayEvidenceForMonth`) ra đúng từng ngày như bản
 *       MỘT NGÀY (`workdayEvidence`) — tức là lịch và cửa chặn của POST /deduct
 *       không bao giờ nói hai điều khác nhau về cùng một ngày.
 *   L3. Tình huống trong ảnh chụp: T069 ngày 09/09 là ngày KHÔNG đi làm → ô xám,
 *       không bấm được (trước đây bấm vào rồi mới hiện khung đỏ).
 *   L4. Màu ô trên lịch admin khớp màu lịch KTV cho cùng một ngày.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *       scripts/qa/qa_14_deduct_calendar.ts
 * CHỈ ĐỌC.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { dayPickState } from '../../lib/office-calendar';
import { workdayEvidence, workdayEvidenceForMonth } from '../../lib/services/KtvOfficeWorkdayService';
import { KtvOfficeScoreService, currentMonthVn } from '../../lib/services/KtvOfficeScoreService';
import { getBusinessToday } from '../../lib/business-date';
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
    console.log('\n=== QA #14 · Lich chon ngay vi pham cua admin ===\n');

    // ── L1: ma trận luật từng ô ────────────────────────────────────────
    console.log('--- L1: luat tung o lich ---');
    const T = '2026-09-11';
    const cases: Array<[string, Parameters<typeof dayPickState>[0], boolean, string]> = [
        ['Ngay mai',                         { date: '2026-09-12', today: T, canPickOld: true,  canDeduct: true,  hitCount: 0 }, false, 'future'],
        ['Hom nay, di lam, sach',            { date: T,            today: T, canPickOld: false, canDeduct: true,  hitCount: 0 }, true,  'clean'],
        ['Hom qua, di lam, co loi',          { date: '2026-09-10', today: T, canPickOld: false, canDeduct: true,  hitCount: 2 }, true,  'hit'],
        ['Le tan chon hom kia',              { date: '2026-09-09', today: T, canPickOld: false, canDeduct: true,  hitCount: 0 }, false, 'locked'],
        ['Quan ly chon hom kia',             { date: '2026-09-09', today: T, canPickOld: true,  canDeduct: true,  hitCount: 0 }, true,  'clean'],
        ['Quan ly chon ngay KTV nghi',       { date: '2026-09-09', today: T, canPickOld: true,  canDeduct: false, hitCount: 0 }, false, 'off'],
        ['Le tan: hom qua KTV nghi',         { date: '2026-09-10', today: T, canPickOld: false, canDeduct: false, hitCount: 0 }, false, 'off'],
        ['Phieu cu tren ngay KTV nghi',      { date: '2026-09-06', today: T, canPickOld: true,  canDeduct: false, hitCount: 5 }, false, 'hitOff'],
        // Thứ tự xét: tương lai phải thắng "không đi làm".
        ['Ngay mai va cung khong co lich',   { date: '2026-09-12', today: T, canPickOld: true,  canDeduct: false, hitCount: 0 }, false, 'future'],
    ];
    for (const [label, args, pickable, tone] of cases) {
        const r = dayPickState(args);
        check(r.pickable === pickable && r.tone === tone, label,
            `${r.pickable ? 'BAM DUOC' : 'KHOA'} · ${r.tone}${r.why ? ` · "${r.why}"` : ''}`);
    }

    // ── L2: bản cả tháng khớp bản một ngày ─────────────────────────────
    console.log('\n--- L2: lich ca thang khop cua chan tung ngay ---');
    const month = currentMonthVn();
    const { data: staffRows } = await supabase
        .from('Staff').select('id').eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').order('id');
    let lech = 0, soNgay = 0;
    for (const s of staffRows || []) {
        const monthMap = await workdayEvidenceForMonth(supabase, s.id, month);
        for (const [date, e] of monthMap) {
            soNgay++;
            const one = await workdayEvidence(supabase, s.id, date);
            if (one.canDeduct !== e.canDeduct || one.attended !== e.attended || one.scheduled !== e.scheduled) {
                lech++;
                if (lech <= 5) check(false, `${s.id} ${date} lech`, `thang=${e.canDeduct} ngay=${one.canDeduct}`);
            }
        }
    }
    check(lech === 0, `Lich ca thang va cua chan tung ngay khop nhau`,
        `${soNgay} o (${(staffRows || []).length} KTV × so ngay trong thang), ${lech} o lech`);

    // ── L3: đúng tình huống trong ảnh chụp ─────────────────────────────
    console.log('\n--- L3: tinh huong trong anh — T069 ngay 09/09 ---');
    const today = await getBusinessToday(supabase);
    const t069 = await workdayEvidenceForMonth(supabase, 'T069', '2026-09');
    const d0909 = t069.get('2026-09-09');
    if (!d0909) {
        console.log('  (khong co du lieu thang 09/2026 cho T069)');
    } else {
        const asManager = dayPickState({ date: '2026-09-09', today, canPickOld: true, canDeduct: d0909.canDeduct, hitCount: 0 });
        console.log(`  T069 09/09: di lam=${d0909.worked} · co lich=${d0909.scheduled} · tru duoc=${d0909.canDeduct}`);
        check(!asManager.pickable && asManager.tone === 'off',
            'O 09/09 cua T069 hien XAM va KHOA, ke ca voi Quan ly',
            asManager.why || '');
    }

    // ── L4: màu ô khớp lịch KTV ────────────────────────────────────────
    //
    // Lịch KTV tô theo `days` của computeMonth: có trong `days` + có lỗi = đỏ, có
    // trong `days` + không lỗi = xanh, không có = xám. Lịch admin thì tô theo
    // bằng chứng đi làm. Hai cái phải ra CÙNG màu cho mọi ngày KTV có đi làm.
    console.log('\n--- L4: mau o lich admin khop lich KTV (T069, thang 09) ---');
    const scores = await KtvOfficeScoreService.computeMonth(supabase, ['T069'], '2026-09');
    const ktvDays = new Map((scores.get('T069')?.days || []).map(d => [d.workDate, d]));
    let mauLech = 0;
    const bang: any[] = [];
    for (const [date, e] of t069) {
        if (date > today) continue;
        const kd = ktvDays.get(date);
        const ktvTone = !kd ? 'off' : (kd.hits.length > 0 ? 'hit' : 'clean');
        const adm = dayPickState({ date, today, canPickOld: true, canDeduct: e.canDeduct, hitCount: kd?.hits.length || 0 });
        // `hitOff` = đỏ mờ & khoá: CÙNG màu đỏ với lịch KTV, chỉ khác là không bấm
        // thêm được (phiếu cũ trên ngày không có chấm công/lịch).
        const mauAdmin = adm.tone === 'hitOff' ? 'hit' : adm.tone;
        const khop = mauAdmin === ktvTone;
        if (!khop) mauLech++;
        bang.push({ ngay: date.slice(5), lich_KTV: ktvTone, lich_admin: adm.tone, bam_duoc: adm.pickable ? 'co' : '-', khop: khop ? 'OK' : 'LECH' });
    }
    console.table(bang);
    check(mauLech === 0, 'Moi ngay co di lam: mau lich admin trung mau lich KTV',
        mauLech ? `${mauLech} ngay lech` : '');

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
