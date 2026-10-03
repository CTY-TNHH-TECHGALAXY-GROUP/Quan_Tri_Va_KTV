import { SupabaseClient } from '@supabase/supabase-js';
import { vnToday } from './vn-time';

/**
 * Đọc cờ bật/tắt tính năng Báo Khách (khóa tan ca) từ SystemConfigs.
 *
 * ⚠️ Giá trị trong SystemConfigs KHÔNG phải lúc nào cũng là chuỗi 'true' trần —
 * tùy nơi ghi mà có thể ra '"true"' (kèm nháy) hoặc 'TRUE'. So sánh === 'true'
 * trực tiếp sẽ ra false và tắt âm thầm cả tính năng. Xem tiền lệ đã xử lý ở
 * KtvCommissionService.ts (isBonusWalletEnabled) — cùng một kiểu dữ liệu.
 *
 * Mặc định khi KHÔNG có dòng cấu hình: BẬT. Muốn tắt thì phải set 'false' tường minh.
 */
export async function isGuestArrivalEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data: config, error } = await supabase
    .from('SystemConfigs')
    .select('value')
    .eq('key', 'guest_arrival_lock_enabled')
    .maybeSingle();

  if (error) {
    console.warn('[GuestArrival] Không đọc được cờ guest_arrival_lock_enabled, mặc định BẬT:', error.message);
    return true;
  }

  if (!config || config.value === null || config.value === undefined) return true;

  const raw = String(config.value).replace(/"/g, '').trim().toLowerCase();
  const enabled = raw !== 'false';

  if (!enabled) {
    console.warn(`[GuestArrival] Tính năng đang TẮT theo cấu hình (raw value: ${JSON.stringify(config.value)})`);
  }

  return enabled;
}

/** Item đã có KTV nhận chưa? Xét cả technicianCodes lẫn segments (mỗi segment mang ktvId). */
function hasAssignedKtv(item: any): boolean {
  const codes = item?.technicianCodes;
  if (Array.isArray(codes) ? codes.length > 0 : !!codes) return true;

  const segs = item?.segments;
  if (Array.isArray(segs) && segs.some((s: any) => s?.ktvId)) return true;

  return false;
}

/**
 * Còn đơn chờ điều phối hôm nay không?
 *
 * Định nghĩa (đã chốt): còn chờ ⟺ tồn tại ít nhất 1 dịch vụ thỏa MỌI điều kiện:
 *   • thuộc booking của HÔM NAY (cha hoặc con), booking chưa DONE/CANCELLED
 *   • bản thân dịch vụ chưa DONE/CANCELLED
 *   • CHƯA có KTV nào nhận (kể cả dịch vụ phát sinh thêm giữa chừng)
 *   • KHÔNG phải tiện ích (phòng riêng…) — tiện ích không cần KTV nên không giữ khóa
 *
 * ⚠️ Không dùng dispatchStatus === 'pending': dịch vụ addon trên đơn đang chạy được
 * gán 'PREPARING' nên sẽ bị bỏ sót. Phải xét ở cấp từng dịch vụ.
 *
 * Lỗi truy vấn → trả TRUE (giữ khóa) + log. Thà khóa thừa và thấy được, còn hơn tự nhả
 * âm thầm làm tính năng mất tác dụng mà không ai biết.
 */
export async function hasPendingDispatch(supabase: SupabaseClient): Promise<boolean> {
  const today = vnToday();

  // ⚠️ Cột ngày của Bookings là "bookingDate" (KHÔNG phải "date").
  const { data: bookings, error: bookingErr } = await supabase
    .from('Bookings')
    .select('id')
    .eq('bookingDate', today)
    .not('status', 'in', '("DONE","CANCELLED")');

  if (bookingErr) {
    console.error('[GuestArrival] Lỗi đọc Bookings, giữ nguyên khóa:', bookingErr.message);
    return true;
  }
  if (!bookings || bookings.length === 0) return false;

  // ⚠️ BookingItems KHÔNG có cột staffList/name. KTV nhận việc nằm ở technicianCodes + segments.
  const { data: items, error: itemErr } = await supabase
    .from('BookingItems')
    .select('id, serviceId, status, technicianCodes, segments')
    .in('bookingId', bookings.map(b => b.id))
    .not('status', 'in', '("DONE","CANCELLED")');

  if (itemErr) {
    console.error('[GuestArrival] Lỗi đọc BookingItems, giữ nguyên khóa:', itemErr.message);
    return true;
  }
  if (!items || items.length === 0) return false;

  // Danh sách dịch vụ tiện ích (phòng riêng…) — không cần KTV nên không tính là đơn chờ.
  const utilityIds = new Set<string>(['NHS0900']);
  const { data: utilities } = await supabase
    .from('Services')
    .select('id')
    .eq('is_utility', true);
  (utilities || []).forEach(u => utilityIds.add(String(u.id)));

  return items.some(item => !utilityIds.has(String(item.serviceId)) && !hasAssignedKtv(item));
}

/**
 * Xử lý tự nhả khóa — ƯU TIÊN THAO TÁC THỦ CÔNG.
 *
 * Quầy bật Báo Khách đúng lúc "khách đang xếp hàng nhưng CHƯA nhập đơn", nên ngay sau khi bật
 * thường KHÔNG có đơn chờ nào. Nếu cứ hễ thấy 0 đơn là nhả thì khóa tắt ngay lập tức,
 * bật thủ công thành vô nghĩa.
 *
 * Quy tắc: chỉ tự nhả khi khóa ĐÃ TỪNG thấy có đơn chờ rồi số đơn đó về 0
 * (cột `has_seen_pending` đóng vai trò "đã từng có đơn").
 *
 * Nếu cột chưa tồn tại trong DB → `has_seen_pending` là undefined → KHÔNG BAO GIỜ tự nhả,
 * khóa chỉ tắt bằng tay. Chạy migration 20260902200000 để bật lại cơ chế tự tắt.
 *
 * @returns true nếu vừa nhả khóa
 */
export async function maybeAutoRelease(supabase: SupabaseClient, lock: any): Promise<boolean> {
  if (!lock?.id) return false;

  const pending = await hasPendingDispatch(supabase);

  if (pending) {
    // Ghi nhận "đã từng có đơn chờ" để lần sau hết đơn thì được phép tự tắt.
    if (lock.has_seen_pending === false) {
      const { error } = await supabase
        .from('GuestArrivalEvents')
        .update({ has_seen_pending: true })
        .eq('id', lock.id);
      if (error) console.warn('[GuestArrival] Không ghi được has_seen_pending:', error.message);
    }
    return false;
  }

  // Chưa từng có đơn chờ (hoặc DB chưa có cột) → giữ khóa, chờ quầy tắt tay.
  if (lock.has_seen_pending !== true) return false;

  const { error } = await supabase
    .from('GuestArrivalEvents')
    .update({ released_at: new Date().toISOString(), released_by: 'AUTO' })
    .eq('id', lock.id);

  if (error) {
    console.error('[GuestArrival] Nhả khóa thất bại:', error.message);
    return false;
  }
  return true;
}
