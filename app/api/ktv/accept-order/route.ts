import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ktvDisplayLabel } from '@/lib/constants/staff.constants';
import { requireActiveStaff } from '@/lib/auth-server';

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

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase init failed' }, { status: 500 });
        }

        // Chấp nhận cả hai loại id — màn hình KTV có chỗ truyền booking id.
        let itemId: string = bookingItemId;
        let bookingId: string | null = null;

        const { data: direct } = await supabase
            .from('BookingItems').select('id, bookingId').eq('id', bookingItemId).maybeSingle();
        if (direct) {
            bookingId = (direct as any).bookingId;
        } else {
            const { data: candidates } = await supabase
                .from('BookingItems').select('id, technicianCodes').eq('bookingId', bookingItemId);
            const mine = (candidates || []).find((i: any) =>
                (i.technicianCodes || []).some((t: string) => String(t).toLowerCase() === String(staffId).toLowerCase()));
            if (!mine) {
                return NextResponse.json(
                    { success: false, error: 'Không tìm thấy đơn đang gán cho bạn.' }, { status: 404 });
            }
            itemId = mine.id;
            bookingId = bookingItemId;
        }

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
        //
        // Mốc lưu THEO TỪNG KTV (`acceptedByStaff`), không phải một ô dùng chung.
        // Một BookingItem có thể gán 2 KTV (dịch vụ 2 người, hoặc 2 khách tách đơn
        // con); trước đây chỉ có một cặp acceptedAt/acceptedBy nên người bấm trước
        // vô tình xác nhận thay cả người sau — người thứ hai vào là đã "đã nhận".
        const { data: cur } = await supabase
            .from('BookingItems').select('options').eq('id', itemId).maybeSingle();
        const curOpts = typeof (cur as any)?.options === 'string'
            ? JSON.parse((cur as any).options || '{}')
            : ((cur as any)?.options || {});

        const key = String(staffId).toUpperCase();
        const acceptedByStaff = { ...(curOpts.acceptedByStaff || {}) };

        if (!acceptedByStaff[key]) {
            const now = new Date().toISOString();
            acceptedByStaff[key] = now;

            const nextOpts: Record<string, any> = { ...curOpts, acceptedByStaff };
            // Giữ acceptedAt/acceptedBy của người bấm ĐẦU TIÊN cho dữ liệu cũ và cho
            // những chỗ chỉ cần biết "đơn đã có người nhận chưa". Không ghi đè.
            if (!nextOpts.acceptedAt) {
                nextOpts.acceptedAt = now;
                nextOpts.acceptedBy = staffId;
            }

            const { error: upErr } = await supabase
                .from('BookingItems').update({ options: nextOpts }).eq('id', itemId);
            if (upErr) {
                console.error('[Accept Order] Không ghi được mốc nhận đơn:', upErr);
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

        console.log(`[Accept Order] ${staffId} nhận đơn ${bill} (item ${itemId})`);
        return NextResponse.json({ success: true, billCode: bill, bookingItemId: itemId });

    } catch (error: any) {
        console.error('Lỗi API accept order:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
