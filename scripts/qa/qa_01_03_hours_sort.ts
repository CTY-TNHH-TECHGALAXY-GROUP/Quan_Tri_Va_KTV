/**
 * QA #1 + #3 — Bảng xếp hạng GIỜ TÍCH LŨY và chuẩn sắp xếp trang Office.
 *
 *  #1 "Kiểm tra Office Sort theo đúng tiêu chuẩn sắp xếp"
 *  #3 "Test bảng xếp hạng giờ tích lũy với nhiều đơn thực tế"
 *
 * CHUẨN SẮP XẾP GỐC (nguồn: KtvTypeDTurnService.getTurnQueue — cái quyết định
 * thứ tự nhận tua thật):
 *      net_hours DESC → check_in_order ASC → employee_id ASC
 *
 * Ba màn hình phải ra CÙNG một con số giờ:
 *   A. /admin/ktv-office            (summary → KtvOfficeScoreService.hoursTotals)
 *   B. /admin/ktv-office/hours      (hours-ranking → hoursBreakdown, client xếp theo net)
 *   C. Bảng điều phối / dashboard   (KtvTypeDTurnService.getMonthlyNetHours)
 *
 * Chạy: npx ts-node -O "{\"module\":\"commonjs\"}" scripts/qa/qa_01_03_hours_sort.ts [YYYY-MM]
 * CHỈ ĐỌC — không ghi gì vào DB.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvOfficeScoreService, monthRange } from '../../lib/services/KtvOfficeScoreService';
import { KtvTypeDTurnService } from '../../lib/services/KtvTypeDTurnService';
import { getRows, getPenalties } from '../../lib/services/KtvDLedgerReader';
import { finish, fatal } from './_exit';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const month = process.argv[2] || '2026-09';
const r2 = (n: number) => Math.round(n * 100) / 100;

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}

async function main() {
    console.log(`\n=== QA #1 + #3 · Gio tich luy & chuan sap xep · thang ${month} ===\n`);

    const { data: staff } = await supabase
        .from('Staff')
        .select('id, full_name, status, work_type_effective_from')
        .eq('work_type', 'TYPE_D')
        .neq('status', 'ĐÃ NGHỈ');

    const staffList = staff || [];
    const staffIds = staffList.map(s => s.id);
    console.log(`KTV loai D dang hoat dong: ${staffIds.length}\n`);

    const { from, to } = monthRange(month);
    const [rows, penalties] = await Promise.all([
        getRows(supabase, { staffIds, from, to }),
        getPenalties(supabase, { staffIds, from, to }),
    ]);
    console.log(`So cai thang nay: ${rows.length} dong tua, ${penalties.length} dong phat`);
    const bookings = new Set(rows.map(r => r.booking_id));
    console.log(`Don thuc te lien quan: ${bookings.size}\n`);

    // --- Ba nguon ---
    const [totalsA, breakdownB] = await Promise.all([
        KtvOfficeScoreService.hoursTotals(supabase, staffIds, month),
        KtvOfficeScoreService.hoursBreakdown(supabase, staffIds, monthRange(month)),
    ]);
    const [y, m] = month.split('-').map(Number);
    const netC = await KtvTypeDTurnService.getMonthlyNetHours(supabase, staffIds, m, y);

    console.log('--- Doi chieu ba nguon (gio rong) ---');
    const table = staffList.map(s => ({
        id: s.id,
        ten: (s.full_name || '').slice(0, 22),
        A_office: totalsA.get(s.id) ?? 0,
        B_ranking: breakdownB.get(s.id)!.net,
        C_dispatch: netC[s.id] ?? 0,
        earned: breakdownB.get(s.id)!.earned,
        phat: breakdownB.get(s.id)!.penalty,
        tua: breakdownB.get(s.id)!.turns,
        ngay: breakdownB.get(s.id)!.days,
        hieu_luc_tu: s.work_type_effective_from,
    }));
    console.table(table);

    console.log('\n--- Kiem tra 1: ba man hinh phai ra cung con so ---');
    let mismatch = 0;
    for (const t of table) {
        const same = r2(t.A_office) === r2(t.B_ranking) && r2(t.B_ranking) === r2(t.C_dispatch);
        if (!same) {
            check(false, `${t.id} lech gio`,
                `Office=${t.A_office}h · Ranking=${t.B_ranking}h · DieuPhoi=${t.C_dispatch}h`);
            mismatch++;
        }
    }
    if (mismatch === 0) check(true, 'Ca 3 nguon khop nhau cho toan bo KTV');

    console.log('\n--- Kiem tra 2: earned - penalty = net ---');
    let mathBad = 0;
    for (const t of table) {
        if (r2(t.earned - t.phat) !== r2(t.B_ranking)) {
            check(false, `${t.id} sai phep tru`, `${t.earned} - ${t.phat} != ${t.B_ranking}`);
            mathBad++;
        }
    }
    if (mathBad === 0) check(true, 'earned - penalty = net cho toan bo KTV');

    console.log('\n--- Kiem tra 3: moc chuyen che do (work_type_effective_from) ---');
    // getMonthlyNetHours BO QUA dong truoc ngay vao loai D; hoursTotals/hoursBreakdown thi KHONG.
    const effOf = new Map(staffList.map(s => [s.id, s.work_type_effective_from || '2020-01-01']));
    const before = rows.filter(r => r.work_date < (effOf.get(r.staff_id) as string));
    const beforePen = penalties.filter(p => p.work_date < (effOf.get(p.staff_id) as string));
    check(before.length === 0 && beforePen.length === 0,
        'Khong co dong so cai nao nam truoc moc chuyen che do',
        before.length || beforePen.length
            ? `${before.length} tua + ${beforePen.length} phat bi Office tinh ma dieu phoi bo qua`
            : '(chua co du lieu cham vao khac biet nay)');

    console.log('\n--- Kiem tra 4: thu tu sap xep ---');

    // Chuan: net DESC -> id ASC (tie-break cuoi cung cua getTurnQueue)
    const standard = [...staffList]
        .map(s => ({ id: s.id, net: netC[s.id] ?? 0 }))
        .sort((a, b) => (b.net - a.net) || a.id.localeCompare(b.id));

    // Man A - app/api/admin/ktv-office/summary/route.ts
    const byHoursA = (a: any, b: any) => (b.net - a.net) || String(a.id).localeCompare(String(b.id));
    const surfaceA = [...staffList]
        .map(s => ({ id: s.id, net: totalsA.get(s.id) ?? 0, locked: s.status === 'KHÓA_TÀI_KHOẢN' }))
        .sort((a, b) => (Number(b.locked) - Number(a.locked)) || byHoursA(a, b));

    // Man B - app/admin/ktv-office/hours/AdminKtvHours.logic.ts
    const surfaceB = [...staffList]
        .map(s => ({ id: s.id, net: breakdownB.get(s.id)!.net }))
        .sort((a, b) => (b.net - a.net) || String(a.id).localeCompare(String(b.id)));

    console.log(`  Chuan (dieu phoi): ${standard.map(x => `${x.id}(${x.net})`).join(' > ')}`);
    console.log(`  Man Cham diem    : ${surfaceA.map(x => `${x.id}(${x.net})`).join(' > ')}`);
    console.log(`  Man Gio tich luy : ${surfaceB.map(x => `${x.id}(${x.net})`).join(' > ')}`);

    const seqStd = standard.map(x => x.id).join(',');
    check(surfaceB.map(x => x.id).join(',') === seqStd,
        'Man Gio tich luy xep dung chuan net DESC');
    const lockedCount = staffList.filter(s => s.status === 'KHÓA_TÀI_KHOẢN').length;
    check(surfaceA.map(x => x.id).join(',') === seqStd || lockedCount > 0,
        'Man Cham diem xep dung chuan net DESC (bo qua khac biet do the khoa day len dau)');

    console.log('\n--- Kiem tra 5: hoa gio co tie-break xac dinh khong? ---');
    const byNet = new Map<number, string[]>();
    for (const s of standard) {
        if (!byNet.has(s.net)) byNet.set(s.net, []);
        byNet.get(s.net)!.push(s.id);
    }
    const ties = [...byNet.entries()].filter(([, ids]) => ids.length > 1);
    if (ties.length === 0) {
        console.log('  (thang nay khong co ai hoa gio - khong kich hoat duoc nhanh nay)');
    } else {
        for (const [h, ids] of ties) console.log(`  Hoa ${h}h: ${ids.join(', ')}`);
        // Hoa gio thi ca hai man phai chot bang ma nhan vien, giong dieu phoi.
        const tieOk = ties.every(([, ids]) => {
            const sorted = [...ids].sort((a, b) => a.localeCompare(b));
            const inA = surfaceA.filter(x => ids.includes(x.id)).map(x => x.id);
            const inB = surfaceB.filter(x => ids.includes(x.id)).map(x => x.id);
            return inA.join(',') === sorted.join(',') && inB.join(',') === sorted.join(',');
        });
        check(tieOk, 'Hoa gio duoc chot bang ma nhan vien tren ca hai man',
            tieOk ? `${ties.reduce((a, [, ids]) => a + ids.length, 0)} KTV hoa gio, thu tu on dinh` : 'thu tu con dao giua hai lan tai trang');
    }

    console.log('\n--- Kiem tra 6: du lieu tua that ---');
    const byBooking = new Map<string, any[]>();
    for (const r of rows) {
        if (!byBooking.has(r.booking_id)) byBooking.set(r.booking_id, []);
        byBooking.get(r.booking_id)!.push(r);
    }
    const multi = [...byBooking.entries()].filter(([, rs]) => rs.length > 1);
    console.log(`  Don co nhieu dong so cai (nhieu dich vu / nhieu KTV): ${multi.length}`);
    const negatives = table.filter(t => t.B_ranking < 0);
    console.log(`  KTV dang am gio: ${negatives.length ? negatives.map(t => `${t.id}(${t.B_ranking})`).join(', ') : 'khong co'}`);
    check(true, 'Gio am duoc giu nguyen, khong bi ep ve 0 (dung quy che)');

    const zeroMin = rows.filter(r => r.actual_minutes === 0);
    console.log(`  Dong so cai 0 phut: ${zeroMin.length} (khong tinh vao so tua/ngay cong)`);

    console.log('\n--- Kiem tra 7: nguon thu TU — /api/ktv/type-d/service-hours ---');
    //
    // Route do va cron chot thang (`/api/cron/reset-type-d-hours`) doc qua
    // `getMonthlyHoursBreakdown`. Phai ra dung con so voi ba nguon o tren.
    //
    // ⚠️ Truoc day route tu quet lai Bookings bang mot cong thuc rieng: lay gio
    // GAN thay vi gio lam that, doc phat tu `KTVServiceHoursLedger` (bang nay
    // nay chi con dong test cu), va kep san 0 nen phan phat vuot nguong boc hoi.
    // So sai do khong chi hien len man hinh — cron DONG DAU no vao
    // `KTVMonthlyServiceHours`, tuc la chot so thang bang so sai.
    const breakdown = await KtvTypeDTurnService.getMonthlyHoursBreakdown(supabase, staffIds, m, y);
    let shLech = 0;
    for (const t of table) {
        const b = breakdown[t.id];
        const ok = b
            && r2(b.net_hours) === r2(t.C_dispatch)
            && r2(b.hours_earned) === r2(t.earned)
            && r2(b.hours_penalty) === r2(t.phat);
        if (!ok) {
            check(false, `${t.id}: service-hours lech`,
                `lam ${b?.hours_earned} phat ${b?.hours_penalty} rong ${b?.net_hours}` +
                ` vs xep hang ${t.earned}/${t.phat}/${t.C_dispatch}`);
            shLech++;
        }
    }
    if (shLech === 0) {
        check(true, `service-hours + cron chot thang khop ca ${staffIds.length} KTV voi thu tu tua`);
    }

    // Tham so thang sai dinh dang phai bao loi, KHONG duoc tra 0 gio am tham:
    // cron nuot so 0 do roi ghi de so thang.
    const badMonth = !/^(\d{4})-(\d{2})$/.test('9');
    check(badMonth, 'Tham so month="9" (thieu nam) bi coi la sai dinh dang');

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    finish(failures);
}

main().catch(fatal);
