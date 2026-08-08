import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvInteractionSchema } from '@/lib/schemas/ktv.schema';
import { createNotification } from '@/lib/notification-helper';

/**
 * API Gửi tương tác từ KTV
 * POST /api/ktv/interaction
 * Body: { bookingId: string, type: 'WATER' | 'SUPPORT' | 'EMERGENCY' | 'BUY_MORE' | 'EARLY_EXIT' }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const parseResult = KtvInteractionSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        const { bookingId, type, techCode, message: customMessage } = parseResult.data;

        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 1. Lấy phòng chính xác: ưu tiên TurnQueue (phòng KTV đang ở), fallback Booking
        let roomName = '???';
        let bedId = '';
        
        if (techCode) {
            const today = new Date().toISOString().split('T')[0];
            const { data: turn } = await supabase
                .from('TurnQueue')
                .select('room_id, bed_id')
                .eq('employee_id', techCode)
                .eq('date', today)
                .eq('current_order_id', bookingId)
                .maybeSingle();
            
            if (turn?.room_id) {
                roomName = turn.room_id;
                bedId = turn.bed_id || '';
            }
        }
        
        // Fallback: lấy từ Booking nếu TurnQueue không có
        if (roomName === '???') {
            const { data: booking } = await supabase
                .from('Bookings')
                .select('roomName, bedId')
                .eq('id', bookingId)
                .single();
            roomName = booking?.roomName || '???';
            bedId = booking?.bedId || '';
        }

        const roomInfo = `phòng ${roomName}${bedId ? ` giường ${bedId}` : ''}`;
        const roomUpper = `Phòng ${roomName}${bedId ? ` giường ${bedId}` : ''}`;

        // 2. Map template tin nhắn theo yêu cầu của User
        const messageMap: Record<string, string> = {
            'EARLY_EXIT': `KH ${roomUpper} đang xuống cb đón khách nhé quầy`,
            'WATER': `Yêu cầu mang nước/trà lên ${roomInfo}`,
            'BUY_MORE': `Khách muốn làm thêm, cần lễ tân lên tư vấn ở ${roomInfo}`,
            'SUPPORT': `Báo các vấn đề kỹ thuật hoặc thiếu đồ dùng ở ${roomInfo}`,
            'EMERGENCY': `🚨 KHẨN CẤP: Sự cố lớn tại ${roomUpper}!`
        };

        // Ưu tiên custom message từ client (dùng cho Room Issue Report)
        const finalMessage = customMessage || messageMap[type] || `Yêu cầu (${type}) tại ${roomInfo}`;

        // 3. Lưu vào bảng StaffNotifications và tự động gửi Push
        console.log(`💾 [API KTV Interaction] Inserting notification:`, { bookingId, type, message: finalMessage });
        await createNotification({
            type,
            message: finalMessage,
            bookingId,
            employeeId: techCode || null
        });
        
        console.log(`✅ [API KTV Interaction] Notification stored & push handled successfully.`);
        console.log(`🔔 [API KTV Interaction] Booking ${bookingId} (${roomInfo}) sent ${type}: ${finalMessage}`);

        return NextResponse.json({ success: true, message: finalMessage });
    } catch (error: any) {
        console.error('API Error (POST /api/ktv/interaction):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

/**
 * API Xác nhận từ Quầy
 * PATCH /api/ktv/interaction
 * Body: { notificationId: string, note?: string }
 */
export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { KtvInteractionAckSchema } = await import('@/lib/schemas/ktv.schema');
        const parseResult = KtvInteractionAckSchema.safeParse(body);
        
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        
        const { notificationId, note } = parseResult.data;
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        // 1. Cập nhật StaffNotifications
        const now = new Date().toISOString();
        const finalNote = note || 'Đã xác nhận';
        const { data: updated, error: updateError } = await supabase
            .from('StaffNotifications')
            .update({
                acknowledgedAt: now,
                acknowledgedNote: finalNote,
                isRead: true
            })
            .eq('id', notificationId)
            .select()
            .single();

        if (updateError) throw updateError;
        if (!updated) throw new Error('Notification not found');

        // 2. Gửi phản hồi cho KTV
        if (updated.employeeId) {
            await createNotification({
                type: 'REQUEST_CONFIRMED',
                message: `✅ Quầy đã xử lý: ${finalNote}`,
                bookingId: updated.bookingId,
                employeeId: updated.employeeId
            });
            console.log(`✅ [API KTV Interaction] Gửi phản hồi REQUEST_CONFIRMED tới KTV ${updated.employeeId}`);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('API Error (PATCH /api/ktv/interaction):', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
