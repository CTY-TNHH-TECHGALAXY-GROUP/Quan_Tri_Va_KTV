import type { SupabaseClient } from '@supabase/supabase-js';
import { applySequentialLifecycle, type SequentialRequest } from '@/lib/sequential-lifecycle';
import { currentCounterActor } from '@/lib/counter-action-log';
import { syncTurnsForDate } from '@/lib/turn-sync';
import { createNotification } from '@/lib/notification-helper';

export async function performSequentialLifecycle(supabase: SupabaseClient, itemId: string,
  request: SequentialRequest, expectedRevision?: number, bookingId?: string) {
  const { data: item, error } = await supabase.from('BookingItems')
    .select('id, bookingId, status, segments, options, pauseStart, timeEnd, technicianCodes').eq('id', itemId).single();
  if (error || !item) throw error || new Error('Không tìm thấy dịch vụ.');
  if (bookingId && item.bookingId !== bookingId) throw new Error('Dịch vụ không thuộc đơn.');
  const actor = await currentCounterActor();
  const patch = applySequentialLifecycle(item, request, undefined, actor);
  const { data, error: commitError } = await supabase.rpc('dispatch_sequential_lifecycle_atomic', {
    p_booking_id: item.bookingId, p_item_id: itemId, p_expected: item,
    p_patch: patch, p_action: request.action, p_actor: actor,
    p_expected_revision: expectedRevision ?? Number(patch.options.dispatchRevision) - 1,
  });
  if (commitError) throw commitError;
  if (!data?.success) throw new Error(data?.error || 'Không lưu được thao tác; tải lại đơn.');
  const warnings: string[] = [];
  if (request.action === 'CANCEL' || request.action === 'SWAP' || request.action === 'FINISH') {
    try {
      const { data: booking, error: dayError } = await supabase.from('Bookings').select('bookingDate').eq('id', item.bookingId).single();
      if (dayError || !booking?.bookingDate) throw dayError || new Error('Missing service day');
      await syncTurnsForDate(String(booking.bookingDate).slice(0, 10));
    } catch { warnings.push('Đã lưu thao tác; chưa đồng bộ được thứ tự sổ tua. Tải lại và kiểm tra sổ tua.'); }
  }
  if (request.action === 'SWAP' && request.newKtvId) {
    try {
      if (!await createNotification({ bookingId: item.bookingId, employeeId: request.newKtvId,
        type: 'KTV_NEW_ORDER', message: 'Bạn được phân công thay thế trong ca nối tiếp. Kiểm tra giờ và thời lượng mới.' }))
        warnings.push('Đã đổi nhân viên; chưa gửi được thông báo. Báo trực tiếp cho người thay thế.');
    } catch { warnings.push('Đã đổi nhân viên; chưa gửi được thông báo. Báo trực tiếp cho người thay thế.'); }
  }
  return { ...data, warnings };
}
