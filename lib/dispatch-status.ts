export type RawStatus = 'PREPARING' | 'IN_PROGRESS' | 'CLEANING' | 'FEEDBACK' | 'DONE' | 'CANCELLED';

// Mảng này quy định thứ tự các bước làm dịch vụ (Flow chuẩn).
export const STATUS_FLOW: RawStatus[] = [
  'PREPARING',
  'IN_PROGRESS',
  'CLEANING',
  'FEEDBACK',
  'DONE'
];

/**
 * Kiểm tra xem có thể chuyển từ trạng thái hiện tại sang trạng thái mới hay không.
 * Rule:
 * - DONE là trạng thái khóa (Terminal state), không thể đi đâu nữa.
 * - CANCELLED là trạng thái khóa (Terminal state).
 * - Chỉ cho phép đi tiến theo luồng, không được lùi (backward).
 * - Có thể nhảy cóc (skip) nếu cần, miễn là đi tiến.
 */
export function canTransition(from: RawStatus | string | null | undefined, to: RawStatus | string): boolean {
    if (!from) return true; // Trạng thái mới, được phép nhảy đến bất kỳ đâu

    let normalizedFrom = from;
    if (from === 'done') normalizedFrom = 'DONE';
    else if (from === 'cancelled') normalizedFrom = 'CANCELLED';
    else if (from === 'waiting_rating' || from === 'feedback') normalizedFrom = 'FEEDBACK';
    else if (from === 'cleaning' || from === 'COMPLETED') normalizedFrom = 'CLEANING';
    else if (from === 'in_progress') normalizedFrom = 'IN_PROGRESS';
    else if (from === 'pending' || from === 'dispatched' || from === 'NEW' || from === 'WAITING' || from === 'READY') normalizedFrom = 'PREPARING';

    if (normalizedFrom === to) return true; // Giữ nguyên hoặc normalize về cùng bước thì hợp lệ
    
    // Đã hoàn tất hoặc đã hủy thì cấm chỉnh sửa
    if (normalizedFrom === 'DONE' || normalizedFrom === 'CANCELLED') return false;

    const fromIdx = STATUS_FLOW.indexOf(normalizedFrom as RawStatus);
    const toIdx = STATUS_FLOW.indexOf(to as RawStatus);

    // Nếu đích đến không hợp lệ, cấm
    if (toIdx === -1) return false;

    // Nếu không nằm trong flow dù đã normalize, chỉ cho phép đi đến flow chuẩn.
    if (fromIdx === -1) return true;

    // Chỉ cho phép đi về phía trước hoặc giữ nguyên bước (để bình thường hóa trạng thái cũ)
    return toIdx >= fromIdx;
}

/**
 * Lấy bước tiếp theo hợp lệ trong luồng mặc định
 */
export function getNextStatus(current: RawStatus | string): RawStatus | null {
    if (current === 'DONE' || current === 'CANCELLED') return null;
    const currentIdx = STATUS_FLOW.indexOf(current as RawStatus);
    if (currentIdx === -1 || currentIdx === STATUS_FLOW.length - 1) return null;
    return STATUS_FLOW[currentIdx + 1];
}

/**
 * Chuyển đổi trạng thái hiển thị nội bộ trên UI (dispatchStatus)
 * về đúng chuẩn rawStatus để giao tiếp với Backend
 */
export function mapDispatchToRawStatus(dispatchStatus: string): RawStatus {
    switch (dispatchStatus.toLowerCase()) {
        case 'dispatched':
        case 'preparing':
            return 'PREPARING';
        case 'in_progress':
            return 'IN_PROGRESS';
        case 'cleaning':
            return 'CLEANING';
        case 'waiting_rating':
        case 'feedback':
            return 'FEEDBACK';
        case 'completed':
            return 'CLEANING';
        case 'done':
            return 'DONE';
        default:
            return 'PREPARING';
    }
}

/**
 * Tính toán trạng thái tổng của Booking dựa trên trạng thái của các Items.
 */
export function recomputeBookingStatus(itemStatuses: string[]): string {
    if (!itemStatuses || itemStatuses.length === 0) return 'NEW';
    
    const hasWaitingItems = itemStatuses.some(s => ['PREPARING', 'WAITING', 'NEW'].includes(s));
    const hasProgressedItems = itemStatuses.some(s => ['IN_PROGRESS', 'COMPLETED', 'DONE', 'CANCELLED', 'FEEDBACK', 'CLEANING'].includes(s));

    if (itemStatuses.includes('IN_PROGRESS')) return 'IN_PROGRESS';
    if (hasWaitingItems && hasProgressedItems) return 'IN_PROGRESS';
    
    // Nếu có item đang Dọn phòng (hoặc vừa Xong và chờ dọn), cả Booking là đang Dọn phòng (Giữ phòng Bận)
    if (itemStatuses.some(s => ['CLEANING', 'COMPLETED'].includes(s))) return 'CLEANING';
    
    // Nếu có item chờ Đánh giá (và không còn ai dọn phòng), cả Booking là Chờ đánh giá (Giữ phòng Bận)
    if (itemStatuses.includes('FEEDBACK')) return 'FEEDBACK';
    
    // Chỉ khi TẤT CẢ đã hoàn thành hoàn toàn (DONE) thì Booking mới DONE (Giải phóng phòng)
    if (itemStatuses.every(s => ['DONE', 'CANCELLED'].includes(s))) return 'DONE';
    
    if (itemStatuses.includes('PREPARING')) return 'PREPARING';
    if (itemStatuses.includes('WAITING') || itemStatuses.includes('NEW')) return 'NEW';
    
    return 'NEW';
}
