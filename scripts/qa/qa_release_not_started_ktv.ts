/**
 * ================================================================
 * MÔ PHỎNG: nhả KTV chưa bắt đầu khi khách về sớm (releaseNotStartedKtvFromItem)
 * ================================================================
 * Chạy hàm THẬT trên một Supabase client giả (ghi lại mọi lệnh, không đụng DB).
 * Kiểm: hàng đợi về chờ / chỉ bỏ dịch vụ này, phiếu phân công huỷ + kéo đơn kế
 * tiếp, trừ tua loại A/B/C, KHÔNG trừ tua loại D, không trừ khi KTV còn việc
 * khác chưa tước trong bill.
 *
 * Chạy:
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_release_not_started_ktv.ts
 */
import { releaseNotStartedKtvFromItem } from '@/lib/services/KtvReleaseService';

type Op = { table?: string; op: 'select' | 'update' | 'rpc'; filters: any[]; payload?: any; fn?: string; args?: any };

/** Minimal chainable client: select results come from `fixtures(table, filters)`. */
function fakeSupabase(fixtures: (table: string, filters: any[], single: boolean) => any) {
    const log: Op[] = [];
    const from = (table: string) => {
        const q: Op = { table, op: 'select', filters: [] };
        const run = (single: boolean) => {
            log.push(q);
            const data = q.op === 'select' ? fixtures(table, q.filters, single) : null;
            return Promise.resolve({ data, error: null });
        };
        const api: any = {
            select: () => api,
            eq: (c: string, v: any) => { q.filters.push(['eq', c, v]); return api; },
            in: (c: string, v: any) => { q.filters.push(['in', c, v]); return api; },
            contains: (c: string, v: any) => { q.filters.push(['contains', c, v]); return api; },
            update: (p: any) => { q.op = 'update'; q.payload = p; return api; },
            maybeSingle: () => run(true),
            then: (res: any, rej: any) => run(false).then(res, rej),
        };
        return api;
    };
    const rpc = (fn: string, args: any) => { log.push({ op: 'rpc', fn, args, filters: [] }); return Promise.resolve({ data: null, error: null }); };
    return { client: { from, rpc } as any, log };
}

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${ok ? '' : ' ' + detail}`); };
const eqF = (op: Op, c: string, v: any) => op.filters.some(f => f[0] === 'eq' && f[1] === c && f[2] === v);

const BOOKING = 'BK-CHILD-B', PARENT = 'BK-PARENT', ITEM = 'BK-CHILD-B-item2', DATE = '2026-09-14';
const mySeg = (voided: boolean) => [{ ktvId: 'T014', voided, note: voided ? 'EARLY_LEAVE_NOT_STARTED' : undefined }];

async function scenario(name: string, opts: { workType: string; turnItems: string[]; otherLiveItem: boolean }) {
    console.log(`\n${name}`);
    const { client, log } = fakeSupabase((table, filters, single) => {
        if (table === 'TurnQueue') return [{ id: 'tq1', status: 'assigned', booking_item_ids: opts.turnItems }];
        if (table === 'Staff') return { work_type: opts.workType };
        if (table === 'Bookings' && single) return { parent_booking_id: PARENT };
        if (table === 'Bookings') return [{ id: BOOKING }];
        if (table === 'BookingItems') {
            const rows = [{ id: ITEM, status: 'CLEANING', segments: mySeg(true) }];
            if (opts.otherLiveItem) rows.push({ id: 'BK-CHILD-B-item3', status: 'IN_PROGRESS', segments: mySeg(false) });
            return rows;
        }
        return [];
    });

    const res = await releaseNotStartedKtvFromItem(client, { bookingId: BOOKING, itemId: ITEM, employeeId: 'T014', businessDate: DATE });

    const tqUpdate = log.find(o => o.table === 'TurnQueue' && o.op === 'update');
    const asgUpdate = log.find(o => o.table === 'KtvAssignments' && o.op === 'update');
    const promote = log.find(o => o.op === 'rpc' && o.fn === 'promote_next_assignment');
    const ledger = log.find(o => o.table === 'TurnLedger' && o.op === 'update');
    return { res, tqUpdate, asgUpdate, promote, ledger };
}

(async () => {
    {
        const r = await scenario('Loại A, chỉ có dịch vụ này', { workType: 'TYPE_A', turnItems: [ITEM], otherLiveItem: false });
        check('hàng đợi về chờ, xoá đơn đang ôm', r.tqUpdate?.payload?.status === 'waiting' && r.tqUpdate?.payload?.current_order_id === null, JSON.stringify(r.tqUpdate?.payload));
        check('phiếu phân công đúng dịch vụ → CANCELLED', r.asgUpdate?.payload?.status === 'CANCELLED' && eqF(r.asgUpdate!, 'booking_item_id', ITEM));
        check('kéo đơn kế tiếp lên (promote_next_assignment)', r.promote?.args?.p_employee_id === 'T014' && r.promote?.args?.p_business_date === DATE);
        check('TRỪ TUA: TurnLedger.is_punished = true theo mã ĐƠN CHA', r.ledger?.payload?.is_punished === true && eqF(r.ledger!, 'booking_id', PARENT));
        check('trả về turnPunished = true', r.res.turnPunished === true);
    }
    {
        const r = await scenario('Loại D, chỉ có dịch vụ này', { workType: 'TYPE_D', turnItems: [ITEM], otherLiveItem: false });
        check('vẫn nhả hàng đợi + huỷ phiếu', r.tqUpdate?.payload?.status === 'waiting' && r.asgUpdate?.payload?.status === 'CANCELLED');
        check('KHÔNG trừ tua (loại D xếp theo giờ)', !r.ledger && r.res.turnPunished === false);
    }
    {
        const r = await scenario('Loại A, còn dịch vụ khác đang làm trong bill', { workType: 'TYPE_A', turnItems: [ITEM, 'BK-CHILD-B-item3'], otherLiveItem: true });
        check('hàng đợi chỉ bỏ dịch vụ này, giữ dịch vụ còn lại', JSON.stringify(r.tqUpdate?.payload?.booking_item_ids) === JSON.stringify(['BK-CHILD-B-item3']) && r.tqUpdate?.payload?.status === undefined, JSON.stringify(r.tqUpdate?.payload));
        check('không trừ tua vì còn việc thật trong bill', !r.ledger && r.res.turnPunished === false);
    }

    console.log(`\n${pass} đạt · ${fail} hỏng`);
    process.exit(fail ? 1 : 0);
})();
