/**
 * QA #3 (mở rộng) — Bảng xếp hạng giờ tích lũy với NHIỀU ĐƠN THỰC TẾ.
 *
 * `qa_01_03_hours_sort.ts` chạy trên dữ liệu tháng hiện tại: đúng nhưng mỏng
 * (mỗi đơn một dịch vụ, không ai âm giờ nhiều, không có dòng huỷ). Kịch bản này
 * DỰNG một tháng đầy đủ tình huống rồi kiểm tra bảng xếp hạng:
 *
 *   · KTV nhiều tua trong cùng một ngày, và một đơn có NHIỀU DỊCH VỤ
 *     (nhiều dòng sổ cái cùng `group_id`) → phải cộng dồn, không đếm trùng ngày.
 *   · Tua bị huỷ sau khi đã ghi sổ (`entry_status = 'VOID'`) → KHÔNG được tính.
 *   · Tua 0 phút → không tính vào số tua và số ngày công.
 *   · Phạt nặng hơn giờ làm → giờ ròng ÂM, giữ nguyên chứ không ép về 0.
 *   · Người chuyển sang loại D giữa tháng → chỉ tính từ ngày chuyển.
 *   · Hoà giờ → thứ hạng chốt bằng mã nhân viên, không đảo giữa hai lần tải.
 *
 * Chạy: npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register \
 *       scripts/qa/qa_03_ranking_scenario.ts
 *
 * CÓ GHI DB — mọi dòng nằm trong tháng 2019-05 (trước khi hệ thống tồn tại) và
 * mang `booking_id` tiền tố QA-R3, xoá sạch ở finally.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { KtvOfficeScoreService, monthRange } from '../../lib/services/KtvOfficeScoreService';
import { KtvTypeDTurnService } from '../../lib/services/KtvTypeDTurnService';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MONTH = '2019-05';
const TAG = 'QA-R3';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`${ok ? '  [PASS]' : '  [FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

async function cleanup(ids: string[]) {
    const { from, to } = monthRange(MONTH);
    await supabase.from('KTVDTurnLedger').delete().in('staff_id', ids).gte('work_date', from).lte('work_date', to);
    await supabase.from('KTVDPenaltyLedger').delete().in('staff_id', ids).gte('work_date', from).lte('work_date', to);
}

async function main() {
    console.log(`\n=== QA #3 · Bang xep hang gio tich luy voi nhieu don · thang ${MONTH} ===\n`);

    const { data: staffRows } = await supabase
        .from('Staff').select('id, full_name, work_type_effective_from')
        .eq('work_type', 'TYPE_D').neq('status', 'ĐÃ NGHỈ').order('id').limit(5);
    const staff = staffRows || [];
    if (staff.length < 5) {
        console.log('  (can it nhat 5 KTV loai D)');
        process.exit(1);
    }
    const [A, B, C, D, E] = staff.map(s => s.id);
    const ids = [A, B, C, D, E];
    console.log(`KTV: A=${A} B=${B} C=${C} D=${D} E=${E}\n`);

    // Quỹ giờ chỉ tính từ ngày vào chế độ hiện tại, nên tháng dựng (2019-05)
    // phải nằm SAU mốc đó thì dữ liệu mới được tính. Lưu mốc thật để trả lại.
    const originalFrom = new Map(staff.map(s => [s.id, s.work_type_effective_from]));
    const E_SWITCH = '2019-05-15';   // E chuyen sang loai D GIUA thang

    let turnSeq = 0;
    const turn = (staffId: string, date: string, minutes: number, opts: { group?: string; status?: string } = {}) => ({
        staff_id: staffId,
        booking_item_id: `${TAG}-IT-${++turnSeq}`,
        booking_id: `${TAG}-BK-${opts.group || turnSeq}`,
        group_id: opts.group || `${TAG}-G-${turnSeq}`,
        work_date: date,
        actual_minutes: minutes,
        rate_per_60m: 0,
        entry_status: opts.status || 'OPEN',
    });

    try {
        await cleanup(ids);

        // A..D vào loại D từ trước tháng dựng; E vào giữa tháng.
        for (const id of [A, B, C, D]) {
            await supabase.from('Staff').update({ work_type_effective_from: '2019-01-01' }).eq('id', id);
        }
        await supabase.from('Staff').update({ work_type_effective_from: E_SWITCH }).eq('id', E);

        const rows = [
            // A — 3 ngày, ngày 02 có MỘT ĐƠN HAI DỊCH VỤ (cùng group_id).
            turn(A, '2019-05-01', 60),
            turn(A, '2019-05-02', 60, { group: `${TAG}-G-A2` }),
            turn(A, '2019-05-02', 30, { group: `${TAG}-G-A2` }),
            turn(A, '2019-05-03', 90),
            //   → 240 phút = 4h, 4 tua, 3 ngày

            // B — nhiều tua một ngày + một tua BỊ HUỶ sau khi ghi sổ.
            turn(B, '2019-05-04', 45),
            turn(B, '2019-05-04', 45),
            turn(B, '2019-05-04', 30),
            turn(B, '2019-05-05', 120, { status: 'VOID' }),   // don huy — khong duoc tinh
            //   → 120 phút = 2h, 3 tua, 1 ngày

            // C — có tua 0 phút (KTV vào phòng rồi khách đổi ý).
            turn(C, '2019-05-06', 0),
            turn(C, '2019-05-06', 120),
            turn(C, '2019-05-07', 0),
            //   → 120 phút = 2h, 1 tua, 1 ngày

            // D — làm ít mà bị phạt nặng → giờ ròng ÂM.
            turn(D, '2019-05-08', 60),

            // E — có tua TRƯỚC và SAU ngày chuyển sang loại D.
            turn(E, '2019-05-10', 120),   // truoc moc chuyen
            turn(E, '2019-05-20', 60),    // sau moc chuyen
        ];
        const { error: tErr } = await supabase.from('KTVDTurnLedger').insert(rows);
        if (tErr) throw new Error(`Khong ghi duoc KTVDTurnLedger: ${tErr.message}`);

        const { error: pErr } = await supabase.from('KTVDPenaltyLedger').insert([
            // D: tu choi tua goi 90 phut → 3 x 1.5h = 4.5h
            { staff_id: D, work_date: '2019-05-08', penalty_type: 'ORDER_REJECT', hours_penalty: 4.5 },
            // A: nghi dot xuat khong bao
            { staff_id: A, work_date: '2019-05-03', penalty_type: 'ABSENT_NO_NOTICE', hours_penalty: 1 },
            // Dau moc khoa tai khoan: 0 gio, khong duoc lam lech tong
            { staff_id: B, work_date: '2019-05-05', penalty_type: 'ACCOUNT_LOCK', hours_penalty: 0 },
        ]);
        if (pErr) throw new Error(`Khong ghi duoc KTVDPenaltyLedger: ${pErr.message}`);

        console.log(`Da dung ${rows.length} dong so cai + 3 dong phat\n`);

        const breakdown = await KtvOfficeScoreService.hoursBreakdown(supabase, ids, monthRange(MONTH));
        console.table(ids.map(id => {
            const h = breakdown.get(id)!;
            return { id, earned: h.earned, phat: h.penalty, net: h.net, tua: h.turns, ngay: h.days, ngay_cuoi: h.lastDate };
        }));

        console.log('--- R1: cong don nhieu tua / nhieu dich vu trong mot don ---');
        const a = breakdown.get(A)!;
        check(r2(a.earned) === 4 && a.turns === 4 && a.days === 3,
            'A: 4 tua trong 3 ngay = 4h (don ngay 02 co 2 dich vu tinh ca hai)',
            `earned=${a.earned} tua=${a.turns} ngay=${a.days}`);
        check(r2(a.net) === 3, 'A: tru 1h phat nghi dot xuat => con 3h', `net=${a.net}`);

        console.log('\n--- R2: don da huy (VOID) khong duoc tinh ---');
        const b = breakdown.get(B)!;
        check(r2(b.earned) === 2 && b.turns === 3 && b.days === 1,
            'B: chi 3 tua ngay 04 duoc tinh, tua VOID ngay 05 bi bo',
            `earned=${b.earned} tua=${b.turns} ngay=${b.days}`);
        check(r2(b.net) === 2, 'B: dau moc ACCOUNT_LOCK 0 gio khong lam lech tong', `net=${b.net}`);

        console.log('\n--- R3: tua 0 phut khong tinh vao so tua / ngay cong ---');
        const c = breakdown.get(C)!;
        check(r2(c.earned) === 2 && c.turns === 1 && c.days === 1,
            'C: 3 dong nhung chi 1 tua co gio => 1 tua, 1 ngay',
            `earned=${c.earned} tua=${c.turns} ngay=${c.days}`);
        check(c.lastDate === '2019-05-06',
            'C: ngay co tua gan nhat bo qua ngay chi co tua 0 phut', `${c.lastDate}`);

        console.log('\n--- R4: gio rong AM duoc giu nguyen ---');
        const d = breakdown.get(D)!;
        check(r2(d.net) === -3.5, 'D: 1h lam - 4.5h phat = -3.5h, khong bi ep ve 0', `net=${d.net}`);

        console.log('\n--- R5: thu tu xep hang theo chuan net DESC -> ma NV ASC ---');
        const ranked = ids
            .map(id => ({ id, net: breakdown.get(id)!.net }))
            .sort((x, y) => (y.net - x.net) || x.id.localeCompare(y.id));
        console.log(`  ${ranked.map(x => `${x.id}(${x.net}h)`).join(' > ')}`);
        check(ranked[0].id === A && ranked[ranked.length - 1].id === D,
            'A dung dau (3h), D dung cuoi (-3.5h)',
            `${ranked[0].id} ... ${ranked[ranked.length - 1].id}`);

        console.log('\n--- R6: hoa gio thi chot bang ma nhan vien ---');
        // B và C cùng 2h — thứ tự phải theo mã, và ổn định giữa hai lần xếp.
        const tied = ranked.filter(x => r2(x.net) === 2).map(x => x.id);
        check(tied.length === 2 && tied.join(',') === [B, C].sort().join(','),
            'B va C hoa 2h, xep theo ma nhan vien tang dan', tied.join(' > '));
        const again = ids
            .map(id => ({ id, net: breakdown.get(id)!.net }))
            .sort((x, y) => (y.net - x.net) || x.id.localeCompare(y.id))
            .map(x => x.id).join(',');
        check(again === ranked.map(x => x.id).join(','), 'Xep lai lan hai ra dung thu tu cu');

        console.log('\n--- R7: nguoi chuyen sang loai D giua thang ---');
        // Cả hai bên đều phải chặn theo work_type_effective_from thì thứ hạng
        // mới khớp thứ tự nhận tua thật.
        const netDispatch = await KtvTypeDTurnService.getMonthlyNetHours(supabase, ids, 5, 2019);
        const officeE = (await KtvOfficeScoreService.hoursTotals(supabase, ids, MONTH)).get(E) ?? 0;
        console.log(`  E vao loai D tu ${E_SWITCH}; co tua 10/05 (2h) va 20/05 (1h)`);
        console.log(`  Dieu phoi tinh: ${netDispatch[E]}h   ·   Bang Office tinh: ${officeE}h`);
        check(r2(netDispatch[E]) === 1,
            'Dieu phoi chi tinh tua SAU ngay chuyen che do', `${netDispatch[E]}h`);
        check(r2(officeE) === r2(netDispatch[E]),
            'Bang xep hang Office ra CUNG con so voi dieu phoi',
            officeE !== netDispatch[E]
                ? `LECH ${r2(officeE - netDispatch[E])}h — Office dang tinh ca tua truoc ngay vao loai D, nen thu hang khong khop thu tu nhan tua that`
                : '');

    } finally {
        await cleanup(ids);
        for (const [id, from] of originalFrom) {
            await supabase.from('Staff').update({ work_type_effective_from: from }).eq('id', id);
        }
        console.log('\n  (da don du lieu QA va tra lai moc chuyen che do cho ca 5 KTV)');
    }

    console.log(`\n=== ${failures === 0 ? 'DAT' : `${failures} MUC KHONG DAT`} ===\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
