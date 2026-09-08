import type { SupabaseClient } from '@supabase/supabase-js';
import type { TurnRow } from './KtvDLedgerEngine';

/**
 * ================================================================
 * KtvDLedgerReader — CỬA ĐỌC DUY NHẤT của sổ cái tua loại D
 * ================================================================
 * Ví, lịch sử, giờ tích lũy, xếp tua, báo cáo admin — tất cả gọi vào đây
 * rồi tự cộng dồn. KHÔNG consumer nào được query `Bookings` để tính lại
 * tiền hay giờ nữa.
 *
 * Đó là cả điểm của kiến trúc này: trước đây cùng một con số được tính lại
 * ở 5 nơi với 5 công thức hơi khác nhau, nên ví và lịch sử không bao giờ
 * khớp. Giờ chỉ còn một nguồn.
 */

const PAGE = 1000;

export interface TurnRowDb extends TurnRow {
    id: string;
    locked_at: string | null;
    source: string | null;
    computed_at: string | null;
}

export interface PenaltyRow {
    staff_id: string;
    work_date: string;
    penalty_type: string;
    hours_penalty: number;
    money_penalty: number;
    note: string | null;
    /** Lúc ghi phiếu phạt. Dòng phạt không gắn với tua nào nên đây là mốc giờ duy nhất có. */
    created_at: string | null;
}

export interface GetRowsOptions {
    staffIds?: string[];
    /** 'YYYY-MM-DD' — theo NGÀY LÀM VIỆC, không phải ngày lịch. */
    from: string;
    to: string;
    /** Mặc định bỏ dòng VOID (đơn đã huỷ sau khi ghi). */
    includeVoid?: boolean;
}

const num = (v: any): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** PostgREST trả numeric có thể ra chuỗi — ép về số một lần tại cửa đọc. */
function normalize(r: any): TurnRowDb {
    return {
        ...r,
        assigned_minutes: num(r.assigned_minutes),
        actual_minutes: num(r.actual_minutes),
        paid_minutes: num(r.paid_minutes),
        custom_minutes: r.custom_minutes == null ? null : num(r.custom_minutes),
        rate_per_60m: num(r.rate_per_60m),
        rating_used: r.rating_used == null ? 0 : num(r.rating_used),
        deduction_rate: num(r.deduction_rate),
        commission_gross: num(r.commission_gross),
        commission_net: num(r.commission_net),
        bonus_amount: num(r.bonus_amount),
        tax_amount: num(r.tax_amount),
        tip: num(r.tip),
        co_workers: r.co_workers || [],
    };
}

/** Các dòng sổ cái của KTV trong khoảng ngày làm việc. */
export async function getRows(
    supabase: SupabaseClient,
    opts: GetRowsOptions
): Promise<TurnRowDb[]> {
    const out: TurnRowDb[] = [];

    for (let page = 0; ; page++) {
        let q = supabase
            .from('KTVDTurnLedger')
            .select('*')
            .gte('work_date', opts.from)
            .lte('work_date', opts.to)
            .order('work_date', { ascending: true })
            .order('booking_time_start', { ascending: true })
            .range(page * PAGE, (page + 1) * PAGE - 1);

        if (opts.staffIds && opts.staffIds.length > 0) q = q.in('staff_id', opts.staffIds);
        if (!opts.includeVoid) q = q.neq('entry_status', 'VOID');

        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;

        out.push(...data.map(normalize));
        if (data.length < PAGE) break;
    }

    return out;
}

/** Các dòng phạt / dấu mốc kỷ luật trong khoảng ngày làm việc. */
export async function getPenalties(
    supabase: SupabaseClient,
    opts: { staffIds?: string[]; from: string; to: string }
): Promise<PenaltyRow[]> {
    let q = supabase
        .from('KTVDPenaltyLedger')
        .select('staff_id, work_date, penalty_type, hours_penalty, money_penalty, note, created_at')
        .gte('work_date', opts.from)
        .lte('work_date', opts.to);

    if (opts.staffIds && opts.staffIds.length > 0) q = q.in('staff_id', opts.staffIds);

    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map((r: any) => ({
        ...r,
        hours_penalty: num(r.hours_penalty),
        money_penalty: num(r.money_penalty),
    }));
}

// ── Cộng dồn (hàm thuần — nhận rows, trả số) ───────────────────────

export interface StaffTotals {
    /** Tiền tua sau trừ sao, TRƯỚC thuế. */
    commission_net: number;
    /** Thưởng 4★ đã cộng vào tiền tua (xem KtvDLedgerEngine.applyBonusAndTax). */
    bonus_amount: number;
    /** Thuế TNCN — cộng từ cột tax_amount của từng dòng, nên ví và lịch sử
     *  không bao giờ lệch nhau vì làm tròn (lỗi L5 cũ). */
    tax_amount: number;
    /** Thực nhận = commission_net + bonus_amount − tax_amount. */
    take_home: number;
    tip: number;
    /** Giờ tích lũy (dùng actual_minutes, đã chặn tại giờ gán). */
    hours: number;
    turns: number;
}

const emptyTotals = (): StaffTotals => ({
    commission_net: 0, bonus_amount: 0, tax_amount: 0, take_home: 0, tip: 0, hours: 0, turns: 0,
});

function add(t: StaffTotals, r: TurnRow): void {
    t.commission_net += r.commission_net;
    t.bonus_amount += r.bonus_amount;
    t.tax_amount += r.tax_amount;
    t.take_home += r.commission_net + r.bonus_amount - r.tax_amount;
    t.tip += r.tip;
    t.hours += r.actual_minutes / 60;
    t.turns += 1;
}

export function sumByStaff(rows: TurnRow[]): Record<string, StaffTotals> {
    const out: Record<string, StaffTotals> = {};
    for (const r of rows) add((out[r.staff_id] ||= emptyTotals()), r);
    return out;
}

export function sumByDate(rows: TurnRow[]): Record<string, StaffTotals> {
    const out: Record<string, StaffTotals> = {};
    for (const r of rows) add((out[r.work_date] ||= emptyTotals()), r);
    return out;
}

export function sumByStaffDate(rows: TurnRow[]): Record<string, StaffTotals> {
    const out: Record<string, StaffTotals> = {};
    for (const r of rows) add((out[`${r.staff_id}|${r.work_date}`] ||= emptyTotals()), r);
    return out;
}

/**
 * Giờ tích lũy ròng = Σ giờ làm − Σ giờ phạt, chặn dưới ở 0.
 *
 * Thay cho `KtvTypeDTurnService.getMonthlyNetHours` — công thức giống hệt
 * nhưng đọc từ sổ cái thay vì quét lại Bookings.
 */
export function netHoursByStaff(
    rows: TurnRow[],
    penalties: PenaltyRow[],
    staffIds?: string[]
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of staffIds || []) out[id] = 0;

    for (const r of rows) out[r.staff_id] = (out[r.staff_id] || 0) + r.actual_minutes / 60;
    for (const p of penalties) out[p.staff_id] = (out[p.staff_id] || 0) - p.hours_penalty;

    // KHÔNG ép về 0. Giờ tích lũy âm là chuyện có thật: phạt từ chối tua trừ gấp
    // 3 lần thời lượng gói nên rất dễ vượt quá số giờ đang có. Ép về 0 thì:
    //   · KTV nhìn dashboard thấy 0h, tưởng mình hoà, trong khi sổ Office ghi −0h14
    //   · phần phạt vượt quá 0 mất tác dụng với thứ tự nhận tua — người bị phạt
    //     nặng xếp ngang người chưa làm gì
    for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
    return out;
}

/**
 * Gom dòng thành "đơn con" để hiển thị lịch sử.
 *
 * Một khách (`group_id`) có thể gồm nhiều dịch vụ; màn hình lịch sử hiện
 * mỗi khách một dòng với tên dịch vụ ghép lại — giữ đúng cách đang hiển thị.
 */
export interface HistoryGroup {
    key: string;
    work_date: string;
    bill: string;
    booking_id: string;
    guest_id: string | null;
    service_name: string;
    assigned_minutes: number;
    actual_minutes: number;
    paid_minutes: number;
    rating: number;
    deduction_rate: number;
    commission_gross: number;
    commission_net: number;
    bonus_amount: number;
    tax_amount: number;
    take_home: number;
    tip: number;
    is_provisional: boolean;
    handover_status: string | null;
    co_workers: string[];
    rows: TurnRow[];
}

export function groupForHistory(rows: TurnRow[]): HistoryGroup[] {
    const map = new Map<string, HistoryGroup>();

    for (const r of rows) {
        const key = `${r.staff_id}|${r.group_id}`;
        let g = map.get(key);
        if (!g) {
            g = {
                key,
                work_date: r.work_date,
                bill: `${r.bill_code ?? ''}${r.bill_suffix ?? ''}`,
                booking_id: r.booking_id,
                guest_id: r.guest_id,
                service_name: '',
                assigned_minutes: 0, actual_minutes: 0, paid_minutes: 0,
                rating: r.rating_used,
                deduction_rate: r.deduction_rate,
                commission_gross: 0, commission_net: 0, bonus_amount: 0, tax_amount: 0, take_home: 0, tip: 0,
                is_provisional: false,
                handover_status: r.handover_status,
                co_workers: [],
                rows: [],
            };
            map.set(key, g);
        }

        g.assigned_minutes += r.assigned_minutes;
        g.actual_minutes += r.actual_minutes;
        g.paid_minutes += r.paid_minutes;
        g.commission_gross += r.commission_gross;
        g.commission_net += r.commission_net;
        g.bonus_amount += r.bonus_amount;
        g.tax_amount += r.tax_amount;
        g.take_home += r.commission_net + r.bonus_amount - r.tax_amount;
        g.tip += r.tip;
        // Cả nhóm chỉ cần một dòng chưa chốt là cả nhóm tạm tính.
        g.is_provisional = g.is_provisional || r.is_provisional;
        for (const c of r.co_workers) if (!g.co_workers.includes(c)) g.co_workers.push(c);
        g.rows.push(r);
    }

    for (const g of map.values()) {
        g.service_name = g.rows
            .map(r => r.service_name)
            .filter((v, i, a) => v && a.indexOf(v) === i)
            .join(' + ') || '—';
    }

    return [...map.values()].sort((a, b) =>
        b.work_date.localeCompare(a.work_date) || a.bill.localeCompare(b.bill));
}
