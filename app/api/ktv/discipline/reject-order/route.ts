import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvDisciplineService } from '@/lib/services/KtvDisciplineService';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { staffId, bookingItemId, reason } = body;

        if (!staffId || !bookingItemId || !reason) {
            return NextResponse.json({ success: false, error: 'Thiếu thông tin bắt buộc (staffId, bookingItemId, reason)' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        if (!supabase) {
            return NextResponse.json({ success: false, error: 'Supabase init failed' }, { status: 500 });
        }

        // 1. Lấy thông tin KTV
        const { data: staffData } = await supabase.from('Staff').select('full_name').eq('id', staffId).single();
        const staffName = staffData?.full_name || staffId;

        // 2. Tính thời gian làm việc liên tục
        const { totalMins } = await KtvDisciplineService.calculateContinuousWorkMins(supabase, staffId);
        
        // 3. Lấy cấu hình miễn phạt
        const { data: exemptData } = await supabase.from('SystemConfigs').select('value').eq('key', 'ktv_continuous_work_exempt_hours').single();
        const exemptHours = exemptData?.value ? Number(exemptData.value) : 4;
        
        const isExempted = totalMins >= (exemptHours * 60);

        // 4. Thực hiện phạt (hoặc miễn phạt nếu đạt)
        const disciplineResult = await KtvDisciplineService.deductPoints(
            supabase, 
            staffId, 
            'ORDER_REJECT', 
            `Từ chối nhận đơn ${bookingItemId} - Lý do: ${reason}`, 
            isExempted
        );

        // 5. Gỡ KTV khỏi BookingItem và TurnQueue
        // Lấy BookingItem hiện tại
        const { data: itemData } = await supabase.from('BookingItems').select('technicianCodes, status').eq('id', bookingItemId).single();
        if (itemData && itemData.technicianCodes) {
            const newTechCodes = itemData.technicianCodes.filter((id: string) => id !== staffId);
            // Nếu không còn KTV nào thì đưa về PREPARING để Lễ tân điều phối lại
            const newStatus = newTechCodes.length === 0 ? 'PREPARING' : itemData.status;

            await supabase.from('BookingItems').update({ 
                technicianCodes: newTechCodes,
                status: newStatus
            }).eq('id', bookingItemId);
        }

        // Cập nhật TurnQueue của KTV này (gỡ đơn đang làm)
        const dateStr = new Date().toISOString().split('T')[0];
        const { data: turnData } = await supabase.from('TurnQueue')
            .select('id, booking_item_ids')
            .eq('employee_id', staffId)
            .eq('date', dateStr)
            .single();

        if (turnData) {
            let newBookingItemIds = turnData.booking_item_ids || [];
            if (newBookingItemIds.includes(bookingItemId)) {
                newBookingItemIds = newBookingItemIds.filter((id: string) => id !== bookingItemId);
            }
            
            await supabase.from('TurnQueue').update({
                current_order_id: newBookingItemIds.length > 0 ? newBookingItemIds[0] : null,
                booking_item_ids: newBookingItemIds,
                status: newBookingItemIds.length > 0 ? 'assigned' : 'waiting'
            }).eq('id', turnData.id);
        }

        // 6. Gửi thông báo cho Lễ tân
        await supabase.from('StaffNotifications').insert({
            employeeId: null, // Gửi chung
            type: 'WARNING',
            message: `KTV ${staffName} vừa từ chối phục vụ đơn ${bookingItemId}. Lý do: ${reason}`
        });

        return NextResponse.json({ 
            success: true, 
            isExempted,
            penaltyPoints: disciplineResult.penaltyPoints,
            newTotal: disciplineResult.newTotal,
            totalMins
        });

    } catch (error: any) {
        console.error('Lỗi API reject order:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
