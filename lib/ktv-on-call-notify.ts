import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notification-helper';

/**
 * ================================================================
 * BÁO QUẦY KHI KTV BẬT / TẮT NHẬN ĐƠN
 * ================================================================
 * Trước đây bật "Nhận Đơn" chỉ chạy đúng một lệnh UPDATE trên bảng `Staff`.
 * Màn điều phối không hề subscribe bảng `Staff`, nên KTV vừa bật xong quầy
 * không thấy gì cho tới khi có sự kiện khác tình cờ kích refresh — hoặc tới
 * khi quầy tự F5. Không chuông, không toast, không push.
 *
 * Nay mỗi lần đổi trạng thái đều ghi một dòng StaffNotifications. Ngoài việc
 * báo cho quầy, dòng này còn kích luôn realtime của bảng điều phối (nó đã
 * subscribe sẵn INSERT trên StaffNotifications), nên danh sách "KTV Đang
 * Online" tự cập nhật mà không phải đụng tới subscription của bảng `Staff`.
 *
 * BẬT thì kêu, TẮT thì im:
 *   - KTV_ON_CALL  → rule cho phép admin/reception/dev ⇒ có toast + push.
 *   - KTV_OFF_CALL → rule để allowed_roles rỗng ⇒ KHÔNG toast, KHÔNG push,
 *     nhưng dòng dữ liệu vẫn được ghi nên bảng điều phối vẫn tự làm mới và
 *     lịch sử thông báo của admin vẫn tra được.
 *
 * `employeeId` để trống (tin chung) vì đây là tin quầy cần, không phải tin
 * riêng của KTV — cùng khuôn với KTV_ACCEPT_ORDER / KTV_REJECT_ORDER.
 */

interface OnCallNotifyInput {
    staffId: string;
    isOnCall: boolean;
    travelMinutes?: number | null;
    availableFrom?: string | null;
    availableUntil?: string | null;
}

export async function notifyOnCallChange(supabase: SupabaseClient, input: OnCallNotifyInput) {
    const { staffId, isOnCall, travelMinutes, availableFrom, availableUntil } = input;

    // Thông báo hỏng thì KHÔNG được làm hỏng thao tác bật/tắt của KTV — trạng
    // thái đã ghi xong trước khi hàm này chạy, nên ở đây chỉ log rồi bỏ qua.
    try {
        const { data: staff } = await supabase
            .from('Staff')
            .select('full_name')
            .eq('id', staffId)
            .maybeSingle();

        const who = staff?.full_name ? `${staff.full_name} (${staffId})` : staffId;

        if (!isOnCall) {
            await createNotification({
                type: 'KTV_OFF_CALL',
                message: `⚪ KTV ${who} đã TẮT nhận đơn.`,
            });
            return;
        }

        const parts: string[] = [];
        if (travelMinutes) parts.push(`di chuyển ${travelMinutes} phút`);
        if (availableFrom) parts.push(`có mặt từ ${availableFrom}`);
        if (availableUntil) parts.push(`nhận đơn tới ${availableUntil}`);

        await createNotification({
            type: 'KTV_ON_CALL',
            message: `🔔 KTV ${who} đã BẬT nhận đơn${parts.length ? ' — ' + parts.join(', ') : ''}.`,
        });
    } catch (err) {
        console.error('❌ [OnCallNotify] Không tạo được thông báo bật/tắt nhận đơn:', err);
    }
}
