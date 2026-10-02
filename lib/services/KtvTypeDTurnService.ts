import { isVoidedSegment, workedMsOf } from '../segment-time';
import { SupabaseClient } from '@supabase/supabase-js';
import { getDayCutoffHours, toBusinessDate } from '../business-date';
import { getRows, getPenalties, PenaltyRow } from './KtvDLedgerReader';

/** Giờ tích luỹ của một KTV trong một tháng, tách sẵn ba phần. */
export interface MonthlyHours {
    hours_earned: number;
    hours_penalty: number;
    /** = hours_earned − hours_penalty. ĐƯỢC PHÉP ÂM. */
    net_hours: number;
    penalties: PenaltyRow[];
}

export class KtvTypeDTurnService {

    /**
     * Calculate ACTUAL working minutes for a KTV in a booking item.
     *
     * Priority:
     * 1. customCommissionDuration (admin override)
     * 2. actualStartTime → actualEndTime (real time KTV worked)
     * 3. seg.duration (assigned duration, fallback)
     *
     * NOTE: This is DIFFERENT from KtvCommissionService.calculateItemDuration()
     * which always uses assigned time for commission (don't overpay slow workers).
     * This function uses ACTUAL time for RANKING to reflect real effort.
     */
    static calculateActualMinutes(item: any, techCode: string): number {
        let segs: any[] = [];
        try {
            segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []);
        } catch { }

        const mySegs = segs.filter((seg: any) =>
            seg.ktvId && seg.ktvId.toLowerCase().includes(techCode.toLowerCase())
        );

        if (mySegs.length === 0) return 0;

        return mySegs.reduce((sum: number, seg: any) => {
            // Chặng bị tước quyền lợi → không tính giờ tích luỹ
            if (isVoidedSegment(seg)) return sum;

            const assigned = Number(seg.duration) || 0;

            // Priority 1: Admin override — số admin cố ý nhập, KHÔNG chặn
            // So với null chứ không dùng truthy — `0` là số hợp lệ, xem ghi chú
            // cùng vấn đề ở KtvCommissionService.calculateItemDuration.
            if (seg.customCommissionDuration != null) {
                return sum + Number(seg.customCommissionDuration);
            }

            // Priority 2: Actual time, CHẶN TRÊN tại giờ gán.
            // ⚠️ Trước 04/09/2026 chỗ này không có trần, nên một tua quên bấm
            // kết thúc đẻ ra 1441 phút = 24 giờ (bill 005-02092026-B). Vì thứ tự
            // nhận khách sort theo net_hours DESC, một lần quên bấm là đủ để một
            // KTV đứng đầu hàng suốt cả tháng. Máy treo hay lỗi ghi nhận thì
            // không thể tính thành giờ làm — chặn tại giờ gán, đúng như tiền
            // (KtvTypeDCommissionService cũng dùng min(thực, gán)).
            // Đã trừ các khoảng tạm dừng — xem lib/segment-time.ts
            const workedMs = workedMsOf(seg);
            if (workedMs !== null && workedMs > 0) {
                return sum + Math.min(Math.round(workedMs / 60000), assigned);
            }

            // Priority 3: Assigned duration (fallback)
            return sum + assigned;
        }, 0);
    }

    /**
     * Get today's business date string in Vietnam timezone (YYYY-MM-DD)
     * using the spa's cutoff hours config.
     */
    private static async getBusinessTodayStr(supabase: SupabaseClient): Promise<string> {
        const cutoffHours = await getDayCutoffHours(supabase);
        return toBusinessDate(new Date(), cutoffHours);
    }

    /**
     * ==========================================
     * GIỜ TÍCH LŨY RÒNG THÁNG — đọc từ sổ cái
     * ==========================================
     * "KTV loại D này đã làm bao nhiêu giờ ròng trong tháng?"
     *
     *   net_hours = Σ KTVDTurnLedger.actual_minutes / 60
     *             − Σ KTVDPenaltyLedger.hours_penalty
     *             , chặn dưới ở 0
     *
     * Chỉ CỘNG DỒN, không còn công thức nào ở đây. Trước kia hàm này tự quét
     * lại Bookings và trộn hai hệ ngày (lấy ngày theo cutoff nhưng lọc theo
     * mốc nửa đêm) nên tua ca đêm bị mất — xem plan §1.2.
     *
     * Cũng bỏ luôn nhánh "tháng hiện tại = sổ quá khứ + tính lại hôm nay":
     * trigger + hàng đợi (KTVDRecomputeQueue) đã giữ sổ cái bắt kịp dữ liệu,
     * kể cả hôm nay.
     *
     * Vẫn giữ: reset khi chuyển chế độ (work_type_effective_from), loại dịch
     * vụ tiện ích, dùng giờ THỰC (engine đã chặn tại giờ gán), chặn dưới 0.
     *
     * Gọi bởi: turns/route.ts, dispatch/actions.ts, getRankedQueue.
     * MỌI consumer phải dùng hàm này — không nơi nào được tự tính lại.
     */
    static async getMonthlyNetHours(
        supabase: SupabaseClient,
        staffIds: string[],
        month: number,
        year: number
    ): Promise<Record<string, number>> {
        const breakdown = await this.getMonthlyHoursBreakdown(supabase, staffIds, month, year);
        const out: Record<string, number> = {};
        for (const id of staffIds) out[id] = breakdown[id]?.net_hours ?? 0;
        return out;
    }

    /**
     * Cùng phép tính với `getMonthlyNetHours`, nhưng trả ra CẢ BA phần: giờ
     * làm, giờ bị phạt, và giờ ròng — kèm danh sách phiếu phạt.
     *
     * Tách ra để `/api/ktv/type-d/service-hours` (màn giờ tích luỹ + cron chốt
     * tháng) dùng chung, thay vì tự quét lại Bookings.
     *
     * ⚠️ Bản tự tính của route đó lệch ở BA chỗ, đo trên tháng 9/2026 ra tới
     * 9,16 giờ chênh cho T016:
     *   · lấy giờ GÁN (`calculateItemDuration`) thay vì giờ làm thật
     *   · đọc phạt từ `KTVServiceHoursLedger` — bảng chỉ còn 3 dòng test cũ;
     *     phạt thật nằm ở `KTVDPenaltyLedger`
     *   · kẹp sàn 0 nên phần phạt vượt ngưỡng bốc hơi
     */
    static async getMonthlyHoursBreakdown(
        supabase: SupabaseClient,
        staffIds: string[],
        month: number,
        year: number
    ): Promise<Record<string, MonthlyHours>> {
        if (staffIds.length === 0) return {};

        const result: Record<string, MonthlyHours> = {};
        for (const id of staffIds) {
            result[id] = { hours_earned: 0, hours_penalty: 0, net_hours: 0, penalties: [] };
        }

        // Reset khi KTV chuyển chế độ: chỉ tính từ ngày vào chế độ hiện tại.
        const { data: staffData } = await supabase
            .from('Staff')
            .select('id, work_type_effective_from')
            .in('id', staffIds);

        const effectiveDateMap: Record<string, string> = {};
        (staffData || []).forEach((s: any) => {
            effectiveDateMap[s.id] = s.work_type_effective_from || '2020-01-01';
        });

        const firstOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const lastOfMonth = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const [rows, penalties] = await Promise.all([
            getRows(supabase, { staffIds, from: firstOfMonth, to: lastOfMonth }),
            getPenalties(supabase, { staffIds, from: firstOfMonth, to: lastOfMonth }),
        ]);

        for (const r of rows) {
            if (r.work_date < (effectiveDateMap[r.staff_id] || '2020-01-01')) continue;
            const e = result[r.staff_id];
            if (e) e.hours_earned += r.actual_minutes / 60;
        }
        for (const p of penalties) {
            if (p.work_date < (effectiveDateMap[p.staff_id] || '2020-01-01')) continue;
            const e = result[p.staff_id];
            if (e) { e.hours_penalty += p.hours_penalty; e.penalties.push(p); }
        }

        // Giờ tích lũy ĐƯỢC PHÉP ÂM. Phạt từ chối tua trừ gấp 3 lần thời lượng gói
        // nên vượt quá số giờ đang có là bình thường. Trước đây ép về 0 khiến phần
        // phạt vượt ngưỡng bốc hơi: người bị trừ 2 giờ xếp ngang người chưa làm gì,
        // và dashboard hiện 0h trong khi sổ Office ghi số âm.
        const r2 = (n: number) => Math.round(n * 100) / 100;
        for (const id of staffIds) {
            const e = result[id];
            e.hours_earned = r2(e.hours_earned);
            e.hours_penalty = r2(e.hours_penalty);
            e.net_hours = r2(e.hours_earned - e.hours_penalty);
        }

        return result;
    }

    /**
     * Gets the TurnQueue for TYPE_D KTVs on a specific date,
     * sorted by monthly accumulated hours (DESC).
     *
     * Tie-break:
     *   1. net_hours       DESC (nhiều giờ đứng trước)
     *   2. check_in_order  ASC  (ai đến trước)
     *   3. employee_id     ASC  (chốt chặn, thứ tự không nhảy)
     */
    static async getTurnQueue(supabase: SupabaseClient, date: string) {
        const { data: queueData, error: queueError } = await supabase
            .from('TurnQueue')
            .select(`
                *,
                Staff!inner (
                    id,
                    work_type,
                    work_type_effective_from
                )
            `)
            .eq('date', date)
            .eq('Staff.work_type', 'TYPE_D');

        if (queueError) throw queueError;
        if (!queueData || queueData.length === 0) return [];

        const staffIds = queueData.map(q => q.employee_id);

        // Tháng/năm phải lấy theo NGÀY LÀM VIỆC, không phải ngày lịch.
        // Lúc 02:00 ngày 01/09 thì ngày làm việc vẫn là 31/08 → phải xếp hạng theo
        // giờ tích lũy tháng 8, nếu lấy theo lịch sẽ nhảy sang tháng 9 (rỗng) và
        // toàn bộ thứ tự tua rơi về check_in_order.
        const businessToday = await KtvTypeDTurnService.getBusinessTodayStr(supabase);
        const [year, month] = [Number(businessToday.slice(0, 4)), Number(businessToday.slice(5, 7))];

        const hoursMap = await KtvTypeDTurnService.getMonthlyNetHours(supabase, staffIds, month, year);

        const enrichedQueue = queueData.map(q => ({
            ...q,
            monthly_hours: hoursMap[q.employee_id] || 0
        }));

        // Sort: monthly_hours DESC → check_in_order ASC → employee_id ASC
        enrichedQueue.sort((a, b) => {
            if (b.monthly_hours !== a.monthly_hours) {
                return b.monthly_hours - a.monthly_hours;
            }
            if ((a.check_in_order || 0) !== (b.check_in_order || 0)) {
                return (a.check_in_order || 0) - (b.check_in_order || 0);
            }
            return a.employee_id.localeCompare(b.employee_id);
        });

        return enrichedQueue;
    }
}
