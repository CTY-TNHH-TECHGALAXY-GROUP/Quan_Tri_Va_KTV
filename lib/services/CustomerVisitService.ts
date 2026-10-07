/**
 * CustomerVisitService — MỘT công thức cho nhãn "Khách cũ / Đã từng tới / Khách mới" và tỉ lệ huỷ.
 *
 * Trước 06/10/2026 có 4 công thức khác nhau (CRM, Dispatch, Web Booking, Kiosk) nên cùng một khách
 * là "cũ" ở CRM mà "mới" trên thẻ điều phối. Mọi nơi phải gọi `computeCustomerVisit`; không tự đếm lại.
 *
 * Định nghĩa (user chốt 06/10/2026), KHÔNG tính lượt đang xem:
 *   - LƯỢT = nhóm đơn theo `parent_booking_id || id` (đơn cha + các đơn con tách ra là một lượt).
 *   - Lượt HOÀN TẤT: có ít nhất một đơn ở DONE / COMPLETED / FEEDBACK / CLEANING.
 *   - Lượt HUỶ: chưa hoàn tất và mọi đơn (trừ đơn cha SPLIT) đều CANCELLED.
 *   - Lượt CÓ MẶT: chưa huỷ, và khách thật sự đã tới:
 *       nguồn walk-in / menu → luôn tính; nguồn đặt trước (web / *_BOOKING) → chỉ khi đã qua NEW.
 *   - RETURNING  "Khách cũ"     ≥ 1 lượt hoàn tất.
 *   - VISITED    "Đã từng tới"  chưa hoàn tất lượt nào, nhưng có lượt có mặt, HOẶC hồ sơ tạo trước ngày đơn.
 *   - NEW        "Khách mới"    còn lại.
 *   - Tỉ lệ huỷ = lượt huỷ / (lượt huỷ + lượt hoàn tất); chưa có lượt kết thúc → null.
 *
 * Hàm thuần, không gọi DB — để mô phỏng được (scripts/qa/qa_21_customer_visit_status.ts).
 */
import { COMPLETED_STATUSES } from '@/lib/customer.logic';
import { toBusinessDate, DEFAULT_DAY_CUTOFF_HOURS } from '@/lib/business-date';

export type VisitStatus = 'RETURNING' | 'VISITED' | 'NEW';

export interface VisitBookingRow {
    id: string;
    status: string | null;
    source?: string | null;
    parent_booking_id?: string | null;
    bookingDate?: string | null;
    createdAt?: string | null;
}

export interface CustomerVisitSummary {
    status: VisitStatus;
    completedVisits: number;
    attendedVisits: number;
    cancelledVisits: number;
    /** Lượt đã kết thúc = hoàn tất + huỷ (mẫu số của tỉ lệ huỷ). */
    closedVisits: number;
    /** 0..1, hoặc null khi chưa có lượt nào kết thúc. */
    cancelRate: number | null;
}

export interface ComputeVisitOptions {
    /** Đơn đang xem: loại cả lượt chứa nó. */
    excludeBookingId?: string | null;
    /** Chỉ tính lượt bắt đầu TRƯỚC mốc này (ngày/giờ của đơn đang xem). Bỏ trống = tính hết (CRM). */
    before?: string | null;
    /** `Customers.createdAt` — hồ sơ có từ trước ngày đơn thì ít nhất là "Đã từng tới". */
    profileCreatedAt?: string | null;
}

const BOOKING_SOURCE = /BOOKING/i;

const dayOf = (value?: string | null): string => (value || '').slice(0, 10);
const timeOf = (row: VisitBookingRow): string => row.bookingDate || row.createdAt || '';

/** Lấy khoá lượt của một đơn. */
export const visitKeyOf = (row: Pick<VisitBookingRow, 'id' | 'parent_booking_id'>): string => row.parent_booking_id || row.id;

export function computeCustomerVisit(rows: VisitBookingRow[], opts: ComputeVisitOptions = {}): CustomerVisitSummary {
    const excludedKey = opts.excludeBookingId
        ? visitKeyOf(rows.find(r => r.id === opts.excludeBookingId) || { id: opts.excludeBookingId, parent_booking_id: null })
        : null;

    const visits = new Map<string, VisitBookingRow[]>();
    for (const row of rows) {
        const key = visitKeyOf(row);
        if (key === excludedKey) continue;
        if (!visits.has(key)) visits.set(key, []);
        visits.get(key)!.push(row);
    }

    let completed = 0, cancelled = 0, attended = 0;
    for (const members of visits.values()) {
        const start = members.map(timeOf).filter(Boolean).sort()[0] || '';
        if (opts.before && start && start >= opts.before) continue;
        // Đơn cha SPLIT chỉ là vỏ chứa — trạng thái thật nằm ở đơn con.
        const real = members.filter(m => m.status !== 'SPLIT');
        const scoped = real.length ? real : members;
        if (scoped.some(m => COMPLETED_STATUSES.includes(String(m.status)))) { completed++; continue; }
        if (scoped.every(m => m.status === 'CANCELLED')) { cancelled++; continue; }
        const present = scoped.some(m => m.status !== 'CANCELLED'
            && (!BOOKING_SOURCE.test(String(m.source || '')) || m.status !== 'NEW'));
        if (present) attended++;
    }

    const profileBefore = !!opts.profileCreatedAt
        && (!opts.before || dayOf(opts.profileCreatedAt) < dayOf(opts.before));

    const status: VisitStatus = completed > 0 ? 'RETURNING' : (attended > 0 || profileBefore ? 'VISITED' : 'NEW');
    const closed = completed + cancelled;
    return {
        status,
        completedVisits: completed,
        attendedVisits: attended,
        cancelledVisits: cancelled,
        closedVisits: closed,
        cancelRate: closed > 0 ? cancelled / closed : null,
    };
}

/**
 * Mốc "đầu NGÀY LÀM VIỆC hiện tại", dạng `YYYY-MM-DDT00:00:00` (so chuỗi với bookingDate).
 * Dùng ĐÚNG công thức ngày làm việc của bảng điều phối (`toBusinessDate`, cắt ngày lúc DEFAULT_DAY_CUTOFF_HOURS giờ VN):
 * ca đêm 04:22 sáng 07/10 vẫn thuộc ngày làm việc 06/10, đơn của nó lưu bookingDate 06/10.
 * Trước 07/10/2026 dùng nửa đêm lịch → đơn ca đêm bị CRM coi là "lượt hôm trước" (CRM "Đã từng tới",
 * thẻ điều phối "Khách mới"). CRM và kiosk gắn nhãn theo mốc này để khớp thẻ điều phối.
 */
export function startOfTodayVN(now: Date = new Date()): string {
    return `${toBusinessDate(now, DEFAULT_DAY_CUTOFF_HOURS)}T00:00:00`;
}

/**
 * Nhãn + số liệu cho HỒ SƠ khách (CRM, kiosk): nhãn theo đầu ngày hôm nay, số lượt & tỉ lệ huỷ tính trên toàn bộ.
 */
export function computeProfileVisit(rows: VisitBookingRow[], profileCreatedAt?: string | null, now: Date = new Date()): CustomerVisitSummary {
    const all = computeCustomerVisit(rows);
    const label = computeCustomerVisit(rows, { before: startOfTodayVN(now), profileCreatedAt }).status;
    return { ...all, status: label };
}

/** "2/7 · 29%" — dùng chung cho CRM, thẻ điều phối, báo cáo. */
export function formatCancelRate(summary: Pick<CustomerVisitSummary, 'cancelledVisits' | 'closedVisits' | 'cancelRate'>): string {
    if (summary.cancelRate === null || !summary.closedVisits) return '—';
    return `${summary.cancelledVisits}/${summary.closedVisits} · ${Math.round(summary.cancelRate * 100)}%`;
}
