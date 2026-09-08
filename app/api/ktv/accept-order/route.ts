import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ktvDisplayLabel } from '@/lib/constants/staff.constants';
import { requireActiveStaff, requireStaffMatches } from '@/lib/auth-server';
import { resolveMyItems, markAccepted } from '@/lib/services/KtvOrderTargetService';

export const dynamic = 'force-dynamic';

/**
 * KTV bấm "Báo quầy nhận đơn" — báo cho quầy biết đã nhận tua được điều phối.
 *
 * KHÔNG đổi trạng thái đơn, KHÔNG bắt đầu tính giờ. Chỉ là tín hiệu để lễ tân
 * biết KTV đã thấy đơn và đang tới. Việc bắt đầu tua vẫn theo luồng cũ.
 *
 * Cặp với `/api/ktv/discipline/reject-order` — hai lựa chọn khi có đơn mới.
 *
 * Body: { staffId, bookingItemId }
 *   `bookingItemId` nhận cả id của BookingItem lẫn của Booking.
 */
export async function POST(request: Request) {
    try {
        // Tài khoản bị khoá thì không thao tác được nữa, kể cả khi phiên
        // đăng nhập đã cấp từ trước lúc khoá.
        const lockedError = await requireActiveStaff();
        if (lockedError) return lockedError;

        const { staffId, bookingItemId } = await request.json();
        if (!staffId || !bookingItemId) {
            return NextResponse.json(
                { success: false, error: 'Thiếu staffId hoặc bookingItemId' }, { status: 400 });
        }

        // Không cho nhận đơn hộ người khác — mốc "đã nhận" là bằng chứng KTV đã
        // thấy đơn và đang tới phòng.
        const wrongStaff = await requireStaffMatches(staffId);
        if (wrongStaff) return wrongStaff;

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase init failed' }, { status: 500 });
        }

        // Chấp nhận cả hai loại id — màn hình KTV có chỗ truyền booking id.
        //
        // Một đơn có thể gồm NHIỀU dịch vụ cùng gán cho một KTV. "Báo quầy nhận
        // đơn" là nhận cả phần việc của mình trong đơn đó, nên đánh dấu HẾT.
        // Trước đây chỗ này `.find` lấy đúng một dịch vụ, hai dịch vụ còn lại
        // vẫn treo ở bước chờ xác nhận và KTV không có nút nào để nhận chúng.
        const resolved = await resolveMyItems(supabase, staffId, bookingItemId);
        if (resolved.items.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Không tìm thấy đơn đang gán cho bạn.' }, { status: 404 });
        }
        const bookingId: string | null = resolved.bookingId;
        const itemId: string = resolved.items[0].id;

        const [{ data: staff }, { data: booking }] = await Promise.all([
            supabase.from('Staff').select('full_name, work_type').eq('id', staffId).maybeSingle(),
            bookingId
                ? supabase.from('Bookings').select('billCode').eq('id', bookingId).maybeSingle()
                : Promise.resolve({ data: null }),
        ]);

        // Loại A/B/D hiện MÃ để khớp bảng điều phối; loại C ("Nhập tay") mới hiện tên.
        const staffName = ktvDisplayLabel((staff as any)?.work_type, staffId, (staff as any)?.full_name);
        const bill = (booking as any)?.billCode || itemId;

        // Ghi mốc đã nhận vào options — màn KTV dựa vào đây để biết đơn đã qua bước
        // xác nhận hay chưa. Không có mốc này thì reload trang là mất trạng thái.
        // Mốc lưu THEO TỪNG KTV, xem KtvOrderTargetService.markAccepted.
        for (const item of resolved.items) {
            const marked = await markAccepted(supabase, item, staffId);
            if (marked.error) {
                console.error('[Accept Order] Không ghi được mốc nhận đơn:', marked.error);
                return NextResponse.json(
                    { success: false, error: 'Không lưu được xác nhận. Vui lòng thử lại.' }, { status: 500 });
            }
        }

        // Type phải có rule trong SystemConfigs.notification_rules, nếu không
        // NotificationProvider sẽ bỏ qua mọi bộ lọc và phát cho TẤT CẢ vai trò —
        // quầy nhận được nhưng mọi KTV khác cũng nhận, thành nhiễu.
        await supabase.from('StaffNotifications').insert({
            employeeId: null,           // không nhắm riêng ai — lọc theo vai trò
            type: 'KTV_ACCEPT_ORDER',
            message: `✅ KTV ${staffName} đã NHẬN đơn ${bill} và đang tới phòng.`,
            bookingId: bookingId,
        });

        console.log(`[Accept Order] ${staffId} nhận đơn ${bill} (${resolved.items.length} dịch vụ: ${resolved.items.map(i => i.id).join(', ')})`);
        return NextResponse.json({
            success: true,
            billCode: bill,
            bookingItemId: itemId,
            bookingItemIds: resolved.items.map(i => i.id),
        });

    } catch (error: any) {
        console.error('Lỗi API accept order:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
