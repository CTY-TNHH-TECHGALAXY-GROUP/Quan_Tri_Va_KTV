/**
 * QA — Cộng giờ tích luỹ thủ công (HOURS_GRANT = hours_penalty ÂM trong KTVDPenaltyLedger).
 *
 *   A. Thuần: netHoursByStaff cộng đúng khi hours_penalty âm (không đụng DB).
 *   B. Đối chiếu 2 phía trên DB THẬT (chỉ đọc): với mọi KTV loại D tháng hiện tại,
 *      net của bảng xếp hạng admin (hoursBreakdown) == net của thứ tự tua (netHoursByStaff)
 *      == earned − penalty + granted.
 *
 * Chạy: npx tsx --env-file=.env.local scripts/qa/qa_hours_grant.ts
 */
import { createClient } from '@supabase/supabase-js';
import { netHoursByStaff, getRows, getPenalties, type TurnRow, type PenaltyRow } from '@/lib/services/KtvDLedgerReader';
import { KtvOfficeScoreService, monthRange, currentMonthVn } from '@/lib/services/KtvOfficeScoreService';

let failures = 0;
const check = (ten: string, ok: boolean, extra = '') => {
    if (!ok) failures++;
    console.log(`  ${ok ? 'DAT ' : 'HONG'} | ${ten}${extra ? ': ' + extra : ''}`);
};
const turn = (staff: string, minutes: number) => ({ staff_id: staff, actual_minutes: minutes } as unknown as TurnRow);
const pen = (staff: string, hours: number) => ({ staff_id: staff, hours_penalty: hours } as unknown as PenaltyRow);

console.log('\nA. netHoursByStaff voi gio am');
let out = netHoursByStaff([turn('T1', 600)], [pen('T1', -5)], ['T1']);
check('10h lam + cong 5h = 15h', out.T1 === 15, String(out.T1));
out = netHoursByStaff([turn('T1', 600)], [pen('T1', 10), pen('T1', -5)], ['T1']);
check('10h lam - phat 10h + cong 5h = 5h', out.T1 === 5, String(out.T1));
out = netHoursByStaff([], [pen('T1', -2.5)], ['T1']);
check('chua lam gi, cong 2.5h = 2.5h', out.T1 === 2.5, String(out.T1));
out = netHoursByStaff([turn('T1', 60)], [pen('T2', -5)], ['T1', 'T2']);
check('cong cho T2 khong lan sang T1', out.T1 === 1 && out.T2 === 5, JSON.stringify(out));

(async () => {
    console.log('\nB. Doi chieu 2 phia tren DB that (chi doc)');
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
    const { data: staff } = await sb.from('Staff').select('id').eq('work_type', 'TYPE_D');
    const ids = (staff || []).map((s: any) => s.id);
    const month = currentMonthVn();
    const { from, to } = monthRange(month);
    const [agg, rows, pens] = await Promise.all([
        KtvOfficeScoreService.hoursBreakdown(sb as any, ids, { from, to }),
        getRows(sb as any, { staffIds: ids, from, to }),
        getPenalties(sb as any, { staffIds: ids, from, to }),
    ]);
    const net = netHoursByStaff(rows, pens, ids);
    let lech = 0;
    for (const id of ids) {
        const a = agg.get(id)!;
        const viaParts = Math.round((a.earned - a.penalty + a.granted) * 100) / 100;
        if (Math.abs(a.net - net[id]) > 0.011 || Math.abs(a.net - viaParts) > 0.011) {
            lech++; console.log(`  LECH ${id}: breakdown=${a.net} netHours=${net[id]} parts=${viaParts}`);
        }
    }
    check(`${ids.length} KTV loai D thang ${month}: xep hang == thu tu tua == earned-penalty+granted`, lech === 0);
    const granted = [...agg.values()].reduce((s, a) => s + a.granted, 0);
    console.log(`  (tong gio da cong thu cong thang nay: ${granted}h — truoc khi deploy phai la 0)`);
    console.log(`\n=== ${failures === 0 ? 'DAT' : 'HONG (' + failures + ')'} ===`);
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
