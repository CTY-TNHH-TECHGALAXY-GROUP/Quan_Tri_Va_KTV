import type { SupabaseClient } from '@supabase/supabase-js';
import { getBusinessToday } from '@/lib/business-date';
import { laNguoiBiDoiRaKhoiDon } from '@/lib/segment-time';
import { ktvMatchesSeg } from '@/lib/ktvUtils';

/**
 * Item statuses where the KTV still has something to do — serve, or clean and
 * hand over the room. FEEDBACK (waiting for the customer's rating), DONE and
 * CANCELLED need nothing more from the KTV. Legacy spellings kept because old
 * rows still carry them (see `canTransition` in lib/dispatch-status.ts).
 */
const STILL_NEEDS_KTV: Record<string, string> = {
    PREPARING: 'đang chuẩn bị',
    WAITING: 'đang chuẩn bị',
    READY: 'đang chuẩn bị',
    NEW: 'đang chuẩn bị',
    IN_PROGRESS: 'đang làm',
    PAUSED: 'đang làm',
    CLEANING: 'đang dọn phòng',
};

/**
 * Thêm các khúc KTV KHÔNG còn phải làm gì nhưng đơn vẫn CHƯA ĐÓNG: chờ khách
 * đánh giá và chờ quầy duyệt ảnh bàn giao (item chỉ lên DONE sau khi duyệt —
 * cron/ktv-auto-approve). Chỉ dùng khi HOÃN KHOÁ kỷ luật: khoá ở khúc này thì
 * quầy trả lại ảnh là KTV không vào app dọn lại được.
 * plans/plan_khoa_khi_chua_dang_ky_lich_loai_d.md §9.3
 */
const WAITING_FOR_CLOSE: Record<string, string> = {
    FEEDBACK: 'chờ đánh giá / duyệt bàn giao',
    COMPLETED: 'chờ duyệt bàn giao',
};

export interface UnfinishedWork {
    billCode: string;
    status: string;
    /** Vietnamese label for the admin message. */
    statusLabel: string;
}

/**
 * Orders the KTV really still has to work on TODAY.
 *
 * ⚠️ Do NOT trust `KtvAssignments.status` on its own. It is not reliably
 * closed: a KTV swapped out of an order keeps an ACTIVE row, an order that
 * reached FEEDBACK keeps ACTIVE rows, and the DB holds open rows back to March.
 * Trusting it blocked locking almost every KTV (T069 was "busy" with a test
 * order they had been swapped out of on 08/09 and a finished order from 10/09).
 *
 * So an order counts only if ALL hold:
 *   1. an assignment of TODAY's business date (night shift included) that is
 *      QUEUED / READY / ACTIVE;
 *   2. its item is in a status that still needs the KTV (above);
 *   3. the KTV is still on the item and was not swapped out of it — same
 *      helper the attendance screen uses for room debt.
 */
export async function findUnfinishedWorkToday(
    supabase: SupabaseClient,
    staffId: string,
    opts: {
        /** Tính cả khúc chờ đánh giá / chờ quầy duyệt bàn giao. Mặc định KHÔNG. */
        tinhCaChoDuyet?: boolean;
    } = {},
): Promise<UnfinishedWork[]> {
    const labels = opts.tinhCaChoDuyet ? { ...STILL_NEEDS_KTV, ...WAITING_FOR_CLOSE } : STILL_NEEDS_KTV;
    const today = await getBusinessToday(supabase);

    const { data: assignments } = await supabase
        .from('KtvAssignments')
        .select('booking_item_id')
        .eq('employee_id', staffId)
        .eq('business_date', today)
        .in('status', ['QUEUED', 'READY', 'ACTIVE']);

    const itemIds = Array.from(new Set((assignments || []).map((a: any) => a.booking_item_id).filter(Boolean)));
    if (itemIds.length === 0) return [];

    const { data: items } = await supabase
        .from('BookingItems')
        .select('id, bookingId, status, segments, technicianCodes')
        .in('id', itemIds);

    const me = staffId.toUpperCase();
    const stillMine = (items || []).filter((it: any) => {
        const status = String(it.status || '').toUpperCase();
        if (!labels[status]) return false;
        const onItem = (it.technicianCodes || []).some((c: any) => String(c).toUpperCase() === me);
        if (!onItem) return false;
        return !laNguoiBiDoiRaKhoiDon([it], staffId, ktvMatchesSeg);
    });
    if (stillMine.length === 0) return [];

    const bookingIds = Array.from(new Set(stillMine.map((it: any) => it.bookingId)));
    const { data: bookings } = await supabase
        .from('Bookings')
        .select('id, billCode')
        .in('id', bookingIds);
    const billOf = (id: string) => (bookings || []).find((b: any) => b.id === id)?.billCode || id;

    return stillMine.map((it: any) => {
        const status = String(it.status || '').toUpperCase();
        return { billCode: billOf(it.bookingId), status, statusLabel: labels[status] };
    });
}
