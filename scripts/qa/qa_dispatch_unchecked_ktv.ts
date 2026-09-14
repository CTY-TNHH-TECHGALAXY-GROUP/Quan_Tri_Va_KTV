/**
 * ================================================================
 * QA: ĐIỀU PHỐI KTV CHƯA ĐIỂM DANH (14/09/2026)
 * ================================================================
 * Plan: plans/plan_dieu_phoi_ktv_chua_diem_danh.md
 *
 * Phần 1 — hàm THUẦN: luật cổng `findKtvsNeedingCheckinConfirm` + nội dung popup.
 * Phần 2 — GHI THẬT DB ở ngày cũ 15/01/2026, tài khoản test T011/T014/T016/T079:
 *   · `checkedInStaffIds` — khoảng NGÀY LÀM VIỆC (qua 0h, trước mốc cắt ca, PENDING, CHECK_OUT);
 *   · `applyArrivalToTurnQueue` — "Oria xin chào" KHÔNG đè đơn đang làm, dòng mới ở cuối hàng, race;
 *   · `ensureTurnRowsAtEnd` — quầy phân đơn cho người chưa có dòng → cuối hàng, không chen #1.
 * Tự dọn ở `finally`, và DỪNG (không ghi gì) nếu ngày thử đã có dữ liệu.
 *
 * Chạy:
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_dispatch_unchecked_ktv.ts
 *   TZ=UTC npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_dispatch_unchecked_ktv.ts
 *
 * ⚠️ Không gắn vào `npm run test:qa` — ghi thật vào DB đang chạy.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { findKtvsNeedingCheckinConfirm } from '@/lib/attendance/dispatchCheckinGate';
import { buildCheckinConfirmMessage } from '@/app/reception/dispatch/CheckinConfirm.i18n';
import { checkedInStaffIds } from '@/lib/attendance/checkedInToday';
import { applyArrivalToTurnQueue, ensureTurnRowsAtEnd } from '@/lib/services/TurnQueueRowService';
import { businessDayRange, getDayCutoffHours } from '@/lib/business-date';

const env = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
let url = '', key = '';
env.split('\n').forEach(l => {
    if (l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = l.split('=')[1].trim();
    if (l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) key = l.split('=')[1].trim();
});
const sb = createClient(url, key);

const TEST_DATE = '2026-01-15';
const ACCOUNTS = ['T011', 'T014', 'T016', 'T079'];
const HOUR_MS = 3600_000;
const QA_REASON = 'QA qa_dispatch_unchecked_ktv';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
    if (ok) { pass++; console.log(`  OK   ${name}${detail ? '  ' + detail : ''}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}

function part1() {
    console.log('\n═══ Phần 1: luật cổng điểm danh (hàm thuần) ═══');
    const staffById = new Map<string, { full_name: string; work_type: string }>([
        ['KTV01', { full_name: 'LISA', work_type: 'TYPE_C' }],
        ['T016', { full_name: 'Tieu Kim Nghi', work_type: 'TYPE_D' }],
        ['NH07', { full_name: 'NGUYEN ANH', work_type: 'TYPE_A' }],
    ]);
    const gate = (ktvIds: string[], checkedIn: string[], turns: Record<string, string>, confirmed?: string[]) =>
        findKtvsNeedingCheckinConfirm({
            ktvIds, staffById,
            checkedInIds: new Set(checkedIn),
            turnStatusById: new Map(Object.entries(turns)),
            confirmedIds: confirmed,
        });

    let r = gate(['KTV01'], [], {});
    check('C chưa điểm danh, chưa xác nhận → hỏi', r.length === 1 && r[0].reason === 'NOT_CHECKED_IN' && r[0].name === 'LISA', JSON.stringify(r));
    r = gate(['KTV01'], [], {}, ['ktv01']);
    check('C chưa điểm danh, đã xác nhận (không phân biệt hoa thường) → qua', r.length === 0);
    r = gate(['KTV01'], ['KTV01'], { KTV01: 'waiting' });
    check('C đã Oria xin chào → qua, không hỏi', r.length === 0);
    r = gate(['KTV01'], ['KTV01'], { KTV01: 'off' });
    check('C đã điểm danh nhưng tắt nhận đơn → TURNED_OFF', r.length === 1 && r[0].reason === 'TURNED_OFF');
    r = gate(['T016'], [], {});
    check('D chưa điểm danh → hỏi, mang loại D', r.length === 1 && r[0].workType === 'TYPE_D');
    r = gate(['T016'], [], {}, ['T016']);
    check('D chưa điểm danh, đã xác nhận → qua', r.length === 0);
    r = gate(['KTV01', 'NH07'], ['NH07'], { NH07: 'waiting' });
    check('2KTV-1DV: C chưa + A đã → chỉ hỏi C', r.length === 1 && r[0].id === 'KTV01');
    r = gate(['T016', 'T016'], [], {});
    check('1KTV-2DV (gộp, mã lặp) → hỏi 1 lần', r.length === 1);
    r = gate(['T016'], [], { T016: 'waiting' });
    check('Đơn thứ 2 trong ngày: dòng đã waiting mà vẫn chưa điểm danh → VẪN hỏi', r.length === 1 && r[0].reason === 'NOT_CHECKED_IN');
    r = gate(['KTV01'], [], {}, ['T016']);
    check('Xác nhận người khác không áp sang C', r.length === 1);
    r = gate(['ZZ99'], [], {});
    check('Không có trong danh sách KTV → tên dự phòng = mã', r[0]?.name === 'ZZ99' && r[0]?.workType === null);

    console.log('\n═══ Phần 1b: nội dung popup ═══');
    const msgD = buildCheckinConfirmMessage([
        { id: 'KTV01', name: 'LISA', workType: 'TYPE_C', reason: 'NOT_CHECKED_IN' },
        { id: 'T016', name: 'Tieu Kim Nghi', workType: 'TYPE_D', reason: 'TURNED_OFF' },
    ]);
    console.log(msgD.split('\n').map(l => '     │ ' + l).join('\n'));
    check('popup: có "NV KTV01 – LISA"', msgD.includes('NV KTV01 – LISA'));
    check('popup: lý do chưa điểm danh', msgD.includes('chưa bấm Oria xin chào'));
    check('popup: lý do tắt nhận đơn', msgD.includes('đang tắt nhận đơn'));
    check('popup: có câu phạt khi có loại D', msgD.includes('Loại D'));
    check('popup: kết thúc bằng câu hỏi', msgD.trim().endsWith('OK để tiếp tục gửi đơn?'));
    const msgC = buildCheckinConfirmMessage([{ id: 'KTV01', name: 'LISA', workType: 'TYPE_C', reason: 'NOT_CHECKED_IN' }]);
    check('popup: chỉ có C thì KHÔNG có câu phạt loại D', !msgC.includes('Loại D'));
}

async function part2() {
    console.log(`\n═══ Phần 2: DB thật, ngày ${TEST_DATE}, tài khoản ${ACCOUNTS.join(', ')} ═══`);
    const cutoff = await getDayCutoffHours(sb as any);
    const { startIso } = businessDayRange(TEST_DATE, cutoff);
    const start = new Date(startIso).getTime();
    console.log(`  mốc cắt ca = ${cutoff}h → ngày làm việc ${TEST_DATE} bắt đầu ${startIso}`);

    const { count: attBefore } = await sb.from('KTVAttendance').select('*', { count: 'exact', head: true })
        .in('employeeId', ACCOUNTS)
        .gte('checkedAt', new Date(start - 36 * HOUR_MS).toISOString())
        .lt('checkedAt', new Date(start + 36 * HOUR_MS).toISOString());
    const { count: tqBefore } = await sb.from('TurnQueue').select('*', { count: 'exact', head: true }).eq('date', TEST_DATE);
    if ((attBefore || 0) > 0 || (tqBefore || 0) > 0) {
        throw new Error(`Ngày thử ${TEST_DATE} đã có dữ liệu (KTVAttendance=${attBefore}, TurnQueue=${tqBefore}) — DỪNG, không ghi gì.`);
    }

    const insertedAttendance: string[] = [];
    try {
        // ── checkedInStaffIds ──
        const seeds = [
            { employeeId: 'T011', checkType: 'CHECK_IN', status: 'CONFIRMED', at: start + 17.5 * HOUR_MS },
            { employeeId: 'T014', checkType: 'CHECK_IN', status: 'CONFIRMED', at: start + 18.5 * HOUR_MS },
            { employeeId: 'T016', checkType: 'CHECK_IN', status: 'CONFIRMED', at: start - 10 * 60_000 },
            { employeeId: 'T016', checkType: 'CHECK_OUT', status: 'CONFIRMED', at: start + 4 * HOUR_MS },
            { employeeId: 'T079', checkType: 'CHECK_IN', status: 'PENDING', at: start + 4 * HOUR_MS },
        ];
        for (const r of seeds) {
            const { data, error } = await sb.from('KTVAttendance').insert({
                employeeId: r.employeeId, employeeName: `QA ${r.employeeId}`,
                checkType: r.checkType, status: r.status,
                checkedAt: new Date(r.at).toISOString(), date: TEST_DATE, reason: QA_REASON,
            }).select('id').single();
            if (error) throw new Error('insert KTVAttendance: ' + error.message);
            insertedAttendance.push((data as any).id);
        }
        const { count: tqAfterAtt } = await sb.from('TurnQueue').select('*', { count: 'exact', head: true }).eq('date', TEST_DATE);
        check('ghi KTVAttendance không tự đẻ dòng TurnQueue (không trigger ẩn)', (tqAfterAtt || 0) === 0, `= ${tqAfterAtt}`);

        const got = await checkedInStaffIds(sb as any, ACCOUNTS, TEST_DATE);
        check('điểm danh cuối ngày (≈23:30) → đã điểm danh', got.has('T011'));
        check('điểm danh qua 0h, trước mốc cắt ca → cùng ngày làm việc', got.has('T014'));
        check('điểm danh 10 phút trước mốc cắt ca → KHÔNG tính cho ngày này', !got.has('T016'));
        check('bản ghi PENDING → KHÔNG tính', !got.has('T079'));
        check('đúng 2 người', got.size === 2, JSON.stringify(Array.from(got)));
        const prevDay = new Date(new Date(`${TEST_DATE}T00:00:00Z`).getTime() - 24 * HOUR_MS).toISOString().slice(0, 10);
        const gotPrev = await checkedInStaffIds(sb as any, ['T016'], prevDay);
        check('bản ghi trước mốc cắt thuộc NGÀY LÀM VIỆC HÔM TRƯỚC', gotPrev.has('T016'), prevDay);

        // ── applyArrivalToTurnQueue ──
        const row = async (id: string) => (await sb.from('TurnQueue')
            .select('status, check_in_order, queue_position, turns_completed, current_order_id')
            .eq('date', TEST_DATE).eq('employee_id', id).maybeSingle()).data as any;

        const { error: seedErr } = await sb.from('TurnQueue').insert([
            { employee_id: 'T016', date: TEST_DATE, status: 'waiting', check_in_order: 7, queue_position: 7, turns_completed: 0 },
            { employee_id: 'T014', date: TEST_DATE, status: 'assigned', check_in_order: 3, queue_position: 3, turns_completed: 3, current_order_id: 'QA-ORDER-1' },
            { employee_id: 'T079', date: TEST_DATE, status: 'working', check_in_order: 4, queue_position: 4, turns_completed: 1, current_order_id: 'QA-ORDER-2' },
        ]);
        if (seedErr) throw new Error('seed TurnQueue: ' + seedErr.message);

        let res = await applyArrivalToTurnQueue(sb as any, { staffId: 'T011', businessDate: TEST_DATE, moveToEndWhenIdle: true });
        let r = await row('T011');
        check('Oria xin chào, chưa có dòng → tạo waiting', res === 'inserted' && r?.status === 'waiting', `${res} ${r?.status}`);
        check('dòng mới ở CUỐI hàng (không phải #1)', r?.check_in_order === 8 && r?.queue_position === 8, `#${r?.check_in_order} / vị trí ${r?.queue_position}`);

        res = await applyArrivalToTurnQueue(sb as any, { staffId: 'T014', businessDate: TEST_DATE, moveToEndWhenIdle: true });
        r = await row('T014');
        check('C/B: bấm Oria xin chào khi ĐANG ĐƯỢC PHÂN ĐƠN → giữ nguyên đơn', res === 'kept_busy' && r?.status === 'assigned' && r?.current_order_id === 'QA-ORDER-1', `${res} ${r?.status} ${r?.current_order_id}`);
        check('C/B: không reset số tua, không đổi thứ tự', r?.turns_completed === 3 && r?.check_in_order === 3, `tua=${r?.turns_completed} #${r?.check_in_order}`);

        res = await applyArrivalToTurnQueue(sb as any, { staffId: 'T079', businessDate: TEST_DATE, moveToEndWhenIdle: false });
        r = await row('T079');
        check('D: bấm Oria xin chào khi ĐANG LÀM → giữ nguyên đơn', res === 'kept_busy' && r?.status === 'working' && r?.current_order_id === 'QA-ORDER-2', `${res} ${r?.status}`);

        await sb.from('TurnQueue').update({ status: 'off' }).eq('date', TEST_DATE).eq('employee_id', 'T016');
        res = await applyArrivalToTurnQueue(sb as any, { staffId: 'T016', businessDate: TEST_DATE, moveToEndWhenIdle: false });
        r = await row('T016');
        check('D: dòng off → waiting, GIỮ chỗ cũ', res === 'reopened' && r?.status === 'waiting' && r?.check_in_order === 7, `${res} ${r?.status} #${r?.check_in_order}`);

        await sb.from('TurnQueue').update({ status: 'off' }).eq('date', TEST_DATE).eq('employee_id', 'T016');
        res = await applyArrivalToTurnQueue(sb as any, { staffId: 'T016', businessDate: TEST_DATE, moveToEndWhenIdle: true });
        r = await row('T016');
        check('C/B: dòng off → waiting, dời CUỐI hàng (giữ hành vi cũ của B)', res === 'reopened' && r?.status === 'waiting' && r?.check_in_order === 9, `${res} #${r?.check_in_order}`);

        await sb.from('TurnQueue').delete().eq('date', TEST_DATE).eq('employee_id', 'T011');
        const race = await Promise.all([1, 2].map(() =>
            applyArrivalToTurnQueue(sb as any, { staffId: 'T011', businessDate: TEST_DATE, moveToEndWhenIdle: true })));
        const { data: raceRows } = await sb.from('TurnQueue').select('id').eq('date', TEST_DATE).eq('employee_id', 'T011');
        check('bấm Oria xin chào 2 lần cùng lúc → chỉ 1 dòng', (raceRows || []).length === 1, `${(raceRows || []).length} dòng, ${JSON.stringify(race)}`);

        // ── ensureTurnRowsAtEnd ──
        await sb.from('TurnQueue').delete().eq('date', TEST_DATE).in('employee_id', ['T014', 'T079']);
        const { data: before } = await sb.from('TurnQueue').select('check_in_order').eq('date', TEST_DATE);
        const maxBefore = Math.max(0, ...(before || []).map((x: any) => Number(x.check_in_order) || 0));
        const t016Before = await row('T016');
        await ensureTurnRowsAtEnd(sb as any, ['T014', 'T079', 'T016'], TEST_DATE);
        const a = await row('T014'), b = await row('T079'), c = await row('T016');
        check('phân đơn cho người chưa có dòng → tạo ở CUỐI hàng', a?.check_in_order > maxBefore && b?.check_in_order > maxBefore && a?.check_in_order !== b?.check_in_order,
            `max trước=${maxBefore}, T014 #${a?.check_in_order}, T079 #${b?.check_in_order}`);
        check('dòng tạo sẵn là waiting (RPC sẽ nâng lên assigned)', a?.status === 'waiting' && b?.status === 'waiting');
        check('người đã có dòng → không bị đụng', c?.check_in_order === t016Before?.check_in_order && c?.status === t016Before?.status,
            `#${t016Before?.check_in_order}→#${c?.check_in_order}`);
    } finally {
        await sb.from('TurnQueue').delete().eq('date', TEST_DATE).in('employee_id', ACCOUNTS);
        if (insertedAttendance.length) await sb.from('KTVAttendance').delete().in('id', insertedAttendance);
        const { count: leftQ } = await sb.from('TurnQueue').select('*', { count: 'exact', head: true }).eq('date', TEST_DATE);
        const { count: leftA } = await sb.from('KTVAttendance').select('*', { count: 'exact', head: true }).eq('reason', QA_REASON);
        console.log(`\n  Dọn: TurnQueue ${TEST_DATE} còn ${leftQ} dòng, KTVAttendance QA còn ${leftA} dòng`);
    }
}

(async () => {
    part1();
    await part2();
    console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass}/${pass + fail} phép thử đạt.`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
