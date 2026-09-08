import { SupabaseClient } from '@supabase/supabase-js';
import { getPenalties, getRows } from './KtvDLedgerReader';

/**
 * Điểm Office cho KTV Loại D.
 *
 * Hai thang đo song song, KHÔNG liên quan nhau:
 *  - Giờ tích lũy (KTVDTurnLedger + KTVDPenaltyLedger) → quyết định thứ tự nhận tua.
 *  - Điểm Office (bảng này)               → quyết định mức miễn quỹ nội bộ 250k/tháng.
 *
 * Quy chế: public/regulations/type-d.html — mục "Bảng tự chấm điểm cuối ca".
 *
 * CÁCH TÍNH:
 *  - Điểm NGÀY:  mỗi ngày đi làm bắt đầu từ 100, trừ dần theo lỗi CỦA NGÀY ĐÓ.
 *  - Điểm THÁNG: TRUNG BÌNH điểm các ngày đi làm trong tháng, rồi trừ phạt lỗi lặp.
 *                Không phải bộ đếm chạy từ 100 xuống — là trung bình cộng.
 *  - Phạm vi kỳ: chỉ đọc phiếu trừ trong khoảng [đầu tháng, cuối tháng], nên lỗi
 *                tháng trước không ảnh hưởng tháng sau. Phạt lỗi lặp cũng chỉ đếm
 *                trong phạm vi 1 tháng.
 * Không cần job reset định kỳ — kỳ được quyết bởi bộ lọc `month` khi đọc.
 */

/** Cùng 1 lỗi lặp từ ngần này lần trong tháng thì bị trừ thêm. */
export const REPEAT_THRESHOLD = 3;

/** Quỹ nội bộ gốc mỗi tháng (đồng). */
export const FUND_BASE = 250_000;

/** Bậc miễn quỹ theo điểm tháng. Duyệt từ trên xuống, lấy bậc đầu tiên khớp. */
export const FUND_TIERS = [
    { min: 98, exemptPct: 100 },
    { min: 96, exemptPct: 50 },
    { min: 90, exemptPct: 30 },
    { min: 85, exemptPct: 10 },
    { min: 0, exemptPct: 0 },
] as const;

export interface OfficeHit {
    criteriaId: string;
    label: string;
    points: number;
    note: string | null;
    photoUrls: string[];
    byName: string;
    at: string;
    logId: string;
}

export interface OfficeDay {
    workDate: string;
    dayScore: number;
    hits: OfficeHit[];
}

export interface RepeatPenalty {
    criteriaId: string;
    label: string;
    times: number;
    points: number;
}

export interface OfficeMonth {
    staffId: string;
    workDays: number;
    cleanDays: number;
    avg: number;
    repeats: RepeatPenalty[];
    repeatPenalty: number;
    final: number;
    exemptPct: number;
    fundDue: number;
    days: OfficeDay[];
}

export interface HoursAggregate {
    /** Giờ làm THỰC trong dịch vụ (đã loại dịch vụ tiện ích). */
    earned: number;
    /** Giờ bị trừ do kỷ luật (nghỉ không báo, từ chối tua…). */
    penalty: number;
    /** earned − penalty. Có thể ÂM khi phạt nhiều hơn giờ làm — không cắt về 0
     *  để người xem thấy đúng tình trạng thay vì tưởng là chưa làm gì. */
    net: number;
    /** Số tua có phát sinh giờ làm. */
    turns: number;
    /** Số ngày có ít nhất 1 tua. */
    days: number;
    /** Ngày có tua gần nhất. */
    lastDate: string | null;
}

/**
 * Ai được sửa quy chế, chấm điểm cho ngày cũ và thu hồi phiếu.
 * Lễ tân chỉ chấm điểm theo quy chế có sẵn, trong hôm nay + hôm qua.
 * Nhận `Staff.role` thô (chữ hoa như trong DB), không phải roleId đã chuẩn hoá.
 */
export function isOfficeManager(role?: string | null): boolean {
    return ['ADMIN', 'DEV', 'MANAGER'].includes(String(role || '').toUpperCase());
}

/** 'YYYY-MM' của tháng hiện tại theo giờ VN. */
export function currentMonthVn(): string {
    const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Khoảng ngày [đầu tháng, cuối tháng] của chuỗi 'YYYY-MM'. */
export function monthRange(month: string): { from: string; to: string } {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

export function fundTierOf(score: number) {
    const tier = FUND_TIERS.find(t => score >= t.min) || FUND_TIERS[FUND_TIERS.length - 1];
    return {
        exemptPct: tier.exemptPct,
        // Số tiền KTV CÒN PHẢI ĐÓNG (không phải số được miễn).
        fundDue: Math.round(FUND_BASE * (100 - tier.exemptPct) / 100),
    };
}

/**
 * Ngày KTV bắt đầu thuộc chế độ hiện tại. Sổ cái tua giữ lại cả dòng của thời
 * gian trước khi chuyển chế độ, nhưng quỹ giờ tích lũy thì tính lại từ đầu.
 *
 * ⚠️ `KtvTypeDTurnService.getMonthlyNetHours` — hàm quyết định THỨ TỰ NHẬN TUA
 * thật — đã lọc theo mốc này từ lâu. Hai hàm giờ tích lũy ở dưới thì chưa, nên
 * người vừa chuyển sang loại D giữa tháng hiện dư giờ trên bảng Chấm điểm và
 * bảng Giờ tích lũy so với thứ tự tua thật: kịch bản QA #3 dựng lại được cảnh
 * điều phối tính 1h còn bảng Office tính 3h. Xếp hạng lệch thì không ai giải
 * thích nổi vì sao người nhiều giờ hơn lại nhận tua sau.
 */
async function effectiveFromOf(
    supabase: SupabaseClient,
    staffIds: string[]
): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (staffIds.length === 0) return out;
    const { data } = await supabase
        .from('Staff').select('id, work_type_effective_from').in('id', staffIds);
    for (const id of staffIds) out.set(id, '2020-01-01');
    (data || []).forEach((s: any) => {
        out.set(s.id, s.work_type_effective_from || '2020-01-01');
    });
    return out;
}

export class KtvOfficeScoreService {
    /**
     * Tính điểm Office tháng cho nhiều KTV cùng lúc.
     * Gom hết vào 2 query để tránh N+1 khi bảng danh sách có vài chục KTV.
     */
    static async computeMonth(
        supabase: SupabaseClient,
        staffIds: string[],
        month: string
    ): Promise<Map<string, OfficeMonth>> {
        const out = new Map<string, OfficeMonth>();
        if (staffIds.length === 0) return out;

        const { from, to } = monthRange(month);

        // 1. Các phiếu trừ điểm chưa bị thu hồi.
        const { data: logs, error: logErr } = await supabase
            .from('KTVOfficeScoreLog')
            .select('id, staff_id, work_date, criteria_id, criteria_label, points_deducted, note, photo_urls, created_by_name, created_at')
            .in('staff_id', staffIds)
            .gte('work_date', from)
            .lte('work_date', to)
            .is('revoked_at', null)
            .order('work_date', { ascending: false });
        if (logErr) throw logErr;

        // 2. Số ngày ĐI LÀM THỰC TẾ — mẫu số của điểm tháng. Ngày OFF không tính.
        const { data: att, error: attErr } = await supabase
            .from('KTVAttendance')
            .select('employeeId, date')
            .in('employeeId', staffIds)
            .gte('date', from)
            .lte('date', to)
            .in('checkType', ['CHECK_IN', 'LATE_CHECKIN']);
        if (attErr) throw attErr;

        const workDaysOf = new Map<string, Set<string>>();
        (att || []).forEach((a: any) => {
            if (!workDaysOf.has(a.employeeId)) workDaysOf.set(a.employeeId, new Set());
            workDaysOf.get(a.employeeId)!.add(a.date);
        });

        const logsOf = new Map<string, any[]>();
        (logs || []).forEach((l: any) => {
            if (!logsOf.has(l.staff_id)) logsOf.set(l.staff_id, []);
            logsOf.get(l.staff_id)!.push(l);
        });

        for (const staffId of staffIds) {
            out.set(staffId, this.buildMonth(staffId, logsOf.get(staffId) || [], workDaysOf.get(staffId) || new Set()));
        }
        return out;
    }

    /** Gộp các phiếu trừ của 1 KTV thành kết quả tháng. */
    private static buildMonth(staffId: string, logs: any[], attendedDates: Set<string>): OfficeMonth {
        // Gom phiếu theo ngày vi phạm.
        const byDate = new Map<string, OfficeHit[]>();
        for (const l of logs) {
            const hit: OfficeHit = {
                criteriaId: l.criteria_id,
                label: l.criteria_label,
                points: Number(l.points_deducted) || 0,
                note: l.note,
                photoUrls: Array.isArray(l.photo_urls) ? l.photo_urls : [],
                byName: l.created_by_name,
                at: l.created_at,
                logId: l.id,
            };
            if (!byDate.has(l.work_date)) byDate.set(l.work_date, []);
            byDate.get(l.work_date)!.push(hit);
        }

        // Mẫu số: ngày đi làm thực tế. Nếu chấm công thiếu mà vẫn có phiếu trừ,
        // vẫn phải đếm ngày đó, nếu không trung bình sẽ sai lệch có lợi cho KTV.
        const allDays = new Set<string>([...attendedDates, ...byDate.keys()]);

        // Mỗi ngày đi làm bắt đầu từ 100đ rồi trừ dần. Ngày sạch vẫn nằm trong danh
        // sách với 100đ để người xem đối chiếu được từng ngày, không chỉ ngày có lỗi.
        const days: OfficeDay[] = [...allDays]
            .map(workDate => {
                const hits = byDate.get(workDate) || [];
                return {
                    workDate,
                    dayScore: Math.max(0, 100 - hits.reduce((a, h) => a + h.points, 0)),
                    hits,
                };
            })
            .sort((a, b) => b.workDate.localeCompare(a.workDate));

        const workDays = days.length;
        const cleanDays = days.filter(d => d.hits.length === 0).length;

        const sum = days.reduce((a, d) => a + d.dayScore, 0);
        const avg = workDays > 0 ? sum / workDays : 100;

        // Phạt lỗi lặp — phương án A: cùng 1 lỗi từ 3 lần/tháng (rải rác bất kỳ,
        // không cần liên tiếp) thì trừ thêm ĐÚNG 1 LẦN điểm lỗi đó, dù lặp 3 hay 10 lần.
        const tally = new Map<string, { label: string; points: number; times: number }>();
        for (const l of logs) {
            const cur = tally.get(l.criteria_id);
            if (cur) cur.times++;
            else tally.set(l.criteria_id, { label: l.criteria_label, points: Number(l.points_deducted) || 0, times: 1 });
        }
        const repeats: RepeatPenalty[] = [...tally.entries()]
            .filter(([, v]) => v.times >= REPEAT_THRESHOLD)
            .map(([criteriaId, v]) => ({ criteriaId, label: v.label, times: v.times, points: v.points }));
        const repeatPenalty = repeats.reduce((a, r) => a + r.points, 0);

        const final = Math.max(0, avg - repeatPenalty);
        const { exemptPct, fundDue } = fundTierOf(final);

        return {
            staffId, workDays, cleanDays,
            avg: Math.round(avg * 100) / 100,
            repeats, repeatPenalty,
            final: Math.round(final * 10) / 10,
            exemptPct, fundDue,
            days,
        };
    }

    /**
     * Sổ cái giờ tích lũy của 1 KTV trong tháng, kèm số dư lũy kế theo thứ tự thời gian.
     *
     * Ghép hai nguồn của thứ tự tua: KTVDTurnLedger (mỗi dòng là một tua đã làm)
     * và KTVDPenaltyLedger (giờ bị trừ). Trả về mới-nhất-trước để admin mở ra là
     * thấy ngay hôm nay, nhưng số dư vẫn cộng theo chiều thời gian.
     */
    static async hoursLedger(supabase: SupabaseClient, staffId: string, month: string) {
        const { from, to } = monthRange(month);
        const [turns, penalties] = await Promise.all([
            getRows(supabase, { staffIds: [staffId], from, to }),
            getPenalties(supabase, { staffIds: [staffId], from, to }),
        ]);

        type Entry = {
            id: string; date: string; earned: number; penalty: number;
            penaltyType: string | null; bookingId: string | null; note: string | null;
            /**
             * Mốc giờ để hiện trên lịch sử. Tua lấy giờ bắt đầu đơn, phiếu phạt lấy
             * lúc ghi phiếu. Có thể null với dữ liệu cũ — UI phải chịu được.
             *
             * ⚠️ CHỈ để hiển thị. Thứ tự cộng số dư vẫn theo quy tắc "cùng ngày thì
             * giờ làm trước, phạt sau", không sắp lại theo mốc này.
             */
            at: string | null;
        };

        const entries: Entry[] = [
            ...turns.map((r, i) => ({
                id: r.id || `turn-${i}`,
                date: r.work_date,
                earned: r.actual_minutes / 60,
                penalty: 0,
                penaltyType: null,
                // Mã bill đọc được thì ưu tiên hơn UUID — admin tra đơn bằng mã, không bằng id.
                bookingId: r.bill_code || r.booking_id || null,
                note: r.service_name,
                at: r.booking_time_start || null,
            })),
            // Khoản chỉ trừ TIỀN (phí kích hoạt lại) không thuộc sổ giờ — để lại
            // sẽ thành một dòng '0 giờ' vô nghĩa giữa các tua.
            ...penalties.filter(p => Number(p.hours_penalty) > 0 || !Number(p.money_penalty)).map((p, i) => ({
                id: `pen-${p.work_date}-${p.penalty_type}-${i}`,
                date: p.work_date,
                earned: 0,
                penalty: Number(p.hours_penalty) || 0,
                penaltyType: p.penalty_type,
                bookingId: null,
                note: p.note,
                at: p.created_at || null,
            })),
        ];

        // Thứ tự cộng số dư:
        //   1. Theo NGÀY LÀM VIỆC.
        //   2. Cùng ngày: giờ làm trước, phạt sau — số dư đọc mới xuôi.
        //   3. Trong cùng nhóm: theo MỐC GIỜ THẬT.
        //
        // Bước 3 trước đây không có, nên các tua cùng một ngày làm việc nằm theo thứ
        // tự DB trả về. Từ khi lịch sử hiện thêm giờ thì lệch lộ ra: ngày làm việc
        // 03/09 có tua 18:57 rồi 00:54, 00:57, 01:01 (rạng sáng 04/09 — ngày làm việc
        // chốt lúc 6h sáng), mà bảng lại xếp 00:54 trên 01:01 nên cột "Còn lại" chạy
        // ngược: dòng dưới giờ muộn hơn mà số dư nhỏ hơn.
        entries.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            const aPen = a.penalty > 0 ? 1 : 0;
            const bPen = b.penalty > 0 ? 1 : 0;
            if (aPen !== bPen) return aPen - bPen;
            return String(a.at || '').localeCompare(String(b.at || ''));
        });

        let balance = 0;
        let earnedTotal = 0;
        let penaltyTotal = 0;
        const rows = entries.map(e => {
            balance += e.earned - e.penalty;
            earnedTotal += e.earned;
            penaltyTotal += e.penalty;
            return {
                ...e,
                earned: Math.round(e.earned * 100) / 100,
                penalty: Math.round(e.penalty * 100) / 100,
                balance: Math.round(balance * 100) / 100,
            };
        });

        // ⚠️ Tổng phải cộng từ số GỐC rồi mới làm tròn MỘT lần. Cộng các dòng đã làm
        // tròn sẵn thì sai số dồn lại: mỗi tua 1 phút = 0.0167h, mười tua là lệch tới
        // 0.01h — đủ để ô "Thực nhận" và số dư của dòng mới nhất đá nhau ngay trên
        // cùng một màn hình, và quầy thì không biết tin số nào.
        const r2 = (n: number) => Math.round(n * 100) / 100;
        return {
            rows: rows.reverse(),
            total: r2(balance),
            earnedTotal: r2(earnedTotal),
            penaltyTotal: r2(penaltyTotal),
        };
    }

    /**
     * Tổng giờ tích lũy trong tháng cho nhiều KTV — dùng cho bảng xếp hạng.
     *
     * Nguồn là KTVDTurnLedger + KTVDPenaltyLedger, ĐÚNG hai bảng mà thứ tự nhận tua
     * (`KtvTypeDTurnService.getMonthlyNetHours`) đang đọc. Trước đây hàm này đọc
     * `KTVServiceHoursLedger` — sổ cũ nay chỉ còn ghi phần PHẠT, không còn ghi giờ
     * làm — nên màn Chấm điểm hiện 0h trong khi thứ tự tua hiện đủ giờ.
     */
    static async hoursTotals(supabase: SupabaseClient, staffIds: string[], month: string): Promise<Map<string, number>> {
        const out = new Map<string, number>();
        staffIds.forEach(id => out.set(id, 0));
        if (staffIds.length === 0) return out;

        const { from, to } = monthRange(month);
        const [rows, penalties, effFrom] = await Promise.all([
            getRows(supabase, { staffIds, from, to }),
            getPenalties(supabase, { staffIds, from, to }),
            effectiveFromOf(supabase, staffIds),
        ]);

        for (const r of rows) {
            if (r.work_date < (effFrom.get(r.staff_id) || '2020-01-01')) continue;
            out.set(r.staff_id, (out.get(r.staff_id) || 0) + r.actual_minutes / 60);
        }
        for (const p of penalties) {
            if (p.work_date < (effFrom.get(p.staff_id) || '2020-01-01')) continue;
            out.set(p.staff_id, (out.get(p.staff_id) || 0) - p.hours_penalty);
        }
        for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100);
        return out;
    }

    /**
     * Giờ tích lũy CHI TIẾT của nhiều KTV — dùng cho bảng xếp hạng giờ làm.
     *
     * `range` bỏ trống = lũy kế toàn bộ lịch sử.
     *
     * Nguồn: KTVDTurnLedger (giờ làm) + KTVDPenaltyLedger (giờ phạt) — ĐÚNG hai
     * bảng mà thứ tự nhận tua đang đọc, nên bảng xếp hạng, màn Chấm điểm và ô
     * "Thời gian" trên dashboard KTV không còn lệch nhau.
     *
     * `getRows` đã tự phân trang và tự bỏ dòng VOID (đơn huỷ sau khi ghi).
     */
    static async hoursBreakdown(
        supabase: SupabaseClient,
        staffIds: string[],
        range: { from?: string; to?: string } = {}
    ): Promise<Map<string, HoursAggregate>> {
        const out = new Map<string, HoursAggregate>();
        staffIds.forEach(id =>
            out.set(id, { earned: 0, penalty: 0, net: 0, turns: 0, days: 0, lastDate: null }));
        if (staffIds.length === 0) return out;

        // Lũy kế toàn bộ lịch sử thì mở biên thật rộng — reader bắt buộc có from/to.
        const from = range.from || '2020-01-01';
        const to = range.to || '2099-12-31';

        const [rows, penalties, effFrom] = await Promise.all([
            getRows(supabase, { staffIds, from, to }),
            getPenalties(supabase, { staffIds, from, to }),
            effectiveFromOf(supabase, staffIds),
        ]);

        const daysOf = new Map<string, Set<string>>();

        for (const r of rows) {
            const agg = out.get(r.staff_id);
            if (!agg) continue;
            if (r.work_date < (effFrom.get(r.staff_id) || '2020-01-01')) continue;
            const earned = r.actual_minutes / 60;
            agg.earned += earned;
            // Mỗi dòng sổ cái là một tua đã làm; tua 0 phút không tính vào ngày công.
            if (earned > 0) {
                agg.turns++;
                if (!daysOf.has(r.staff_id)) daysOf.set(r.staff_id, new Set());
                daysOf.get(r.staff_id)!.add(r.work_date);
                if (!agg.lastDate || r.work_date > agg.lastDate) agg.lastDate = r.work_date;
            }
        }

        for (const p of penalties) {
            const agg = out.get(p.staff_id);
            if (!agg) continue;
            if (p.work_date < (effFrom.get(p.staff_id) || '2020-01-01')) continue;
            agg.penalty += Number(p.hours_penalty) || 0;
        }

        const round2 = (n: number) => Math.round(n * 100) / 100;
        for (const [id, agg] of out) {
            agg.earned = round2(agg.earned);
            agg.penalty = round2(agg.penalty);
            agg.net = round2(agg.earned - agg.penalty);
            agg.days = daysOf.get(id)?.size ?? 0;
        }
        return out;
    }
}

/** Dịch mã phạt giờ sang tiếng Việt để lễ tân/KTV đọc được. */
export const HOURS_PENALTY_VI: Record<string, string> = {
    ABSENT_NO_NOTICE: 'Nghỉ đột xuất không báo',
    ABSENT_EARLY_NOTICE: 'Báo vắng trước 07:00',
    LATE_NO_UPDATE: 'Đến muộn hơn giờ đã báo',
    ORDER_REJECT: 'Từ chối tua đã gán',
    // Dấu mốc, không phải khoản phạt: hours_penalty = 0.
    ACCOUNT_LOCK: 'Khoá tài khoản',
};
