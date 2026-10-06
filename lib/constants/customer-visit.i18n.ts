// Chữ hiển thị cho nhãn khách & tỉ lệ huỷ — dùng chung CRM, bảng điều phối, Web Booking, báo cáo.
import type { VisitStatus } from '@/lib/services/CustomerVisitService';

export const VISIT_LABEL: Record<VisitStatus, string> = {
    RETURNING: 'Khách cũ',
    VISITED: 'Đã từng tới',
    NEW: 'Khách mới',
};

/** Tailwind class cho badge — giữ màu cũ của bảng điều phối: "Khách cũ" tím, "Khách mới" xanh lá. CRM dùng chung. */
export const VISIT_BADGE_CLASS: Record<VisitStatus, string> = {
    RETURNING: 'bg-purple-50 text-purple-600 border-purple-100',
    VISITED: 'bg-amber-50 text-amber-700 border-amber-100',
    NEW: 'bg-emerald-50 text-emerald-600 border-emerald-100',
};

export const tVisit = {
    cancelRate: 'Tỉ lệ huỷ',
    cancelRateHint: 'Lượt huỷ / lượt đã kết thúc (huỷ + hoàn tất) trong kỳ',
    filterVisited: 'Phân loại: Đã từng tới',
    tooltip: (completed: number, cancelled: number) =>
        `Đã hoàn tất ${completed} lần · Huỷ ${cancelled} lần`,
    visitedHint: 'Đã có hồ sơ hoặc đã tới nhưng chưa hoàn tất lượt nào',
};
