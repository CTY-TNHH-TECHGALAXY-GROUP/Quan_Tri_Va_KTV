import { SupabaseClient } from '@supabase/supabase-js';

export class BookingItemPauseService {
    /**
     * Tạm ngưng dịch vụ (Pause)
     */
    static async pauseItem(supabase: SupabaseClient, bookingItemId: string) {
        const now = new Date().toISOString();
        
        // Cập nhật trạng thái và lưu thời gian pause
        const { error } = await supabase
            .from('BookingItems')
            .update({ 
                status: 'PAUSED',
                pauseStart: now
            })
            .eq('id', bookingItemId);

        if (error) {
            console.error('Error pausing item:', error);
            throw new Error('Không thể tạm ngưng dịch vụ.');
        }

        return { success: true, pauseStart: now };
    }

    /**
     * Khôi phục dịch vụ sau khi Pause (Resume)
     * Hàm này tính toán khoảng thời gian đã bị Pause và cộng bù vào timeStart của Booking,
     * để timer trên màn hình KTV tiếp tục chạy mượt mà không bị hụt giờ.
     */
    static async resumeItem(supabase: SupabaseClient, bookingItemId: string) {
        // 1. Lấy thông tin BookingItem và Booking
        const { data: item, error: errItem } = await supabase
            .from('BookingItems')
            .select('id, pauseStart, bookingId')
            .eq('id', bookingItemId)
            .single();

        if (errItem || !item) {
            throw new Error('Không tìm thấy dịch vụ.');
        }

        if (!item.pauseStart) {
            // Nếu không có pauseStart, chỉ đổi status
            await supabase.from('BookingItems').update({ status: 'IN_PROGRESS' }).eq('id', bookingItemId);
            return { success: true };
        }

        const { data: booking, error: errBooking } = await supabase
            .from('Bookings')
            .select('id, timeStart')
            .eq('id', item.bookingId)
            .single();

        if (errBooking || !booking || !booking.timeStart) {
            // Fallback: Just resume
            await supabase.from('BookingItems').update({ status: 'IN_PROGRESS', pauseStart: null }).eq('id', bookingItemId);
            return { success: true };
        }

        // 2. Tính toán tịnh tiến thời gian
        const nowMs = Date.now();
        const pauseStartMs = new Date(item.pauseStart).getTime();
        const pauseDurationMs = nowMs - pauseStartMs;

        const originalTimeStartMs = new Date(booking.timeStart).getTime();
        const newTimeStartMs = originalTimeStartMs + pauseDurationMs;
        const newTimeStartIso = new Date(newTimeStartMs).toISOString();

        // 3. Cập nhật DB
        await supabase
            .from('Bookings')
            .update({ timeStart: newTimeStartIso })
            .eq('id', booking.id);

        await supabase
            .from('BookingItems')
            .update({ 
                status: 'IN_PROGRESS',
                pauseStart: null
            })
            .eq('id', bookingItemId);

        return { success: true, newTimeStart: newTimeStartIso };
    }

    /**
     * Đổi KTV B cho một dịch vụ đang bị Tạm ngưng, và phạt KTV A
     */
    static async swapKtvOnPausedItem(
        supabase: SupabaseClient, 
        bookingItemId: string, 
        oldKtvId: string, 
        newKtvId?: string, 
        extraTimeMins: number = 0,
        businessDate?: string,
        keepTurnForOldKtv: boolean = false
    ) {
        // 1. Fetch Item & Booking & Service
        const { data: item, error: errItem } = await supabase
            .from('BookingItems')
            .select(`
                id, 
                bookingId, 
                technicianCodes, 
                segments, 
                pauseStart,
                serviceId,
                status,
                Bookings!fk_bookingitems_booking ( id, timeStart ),
                Services ( duration )
            `)
            .eq('id', bookingItemId)
            .single();

        if (errItem || !item) throw new Error('Không tìm thấy dịch vụ.');
        if (!item.pauseStart && item.status !== 'PAUSED') {
             throw new Error('Dịch vụ chưa được Tạm ngưng. Vui lòng Tạm ngưng trước khi rút/đổi KTV.');
        }

        const booking = (item.Bookings as any);
        let originalDuration = (item.Services as any)?.duration || 60;
        
        if (extraTimeMins > originalDuration) {
            throw new Error(`Thời gian bù thêm không được vượt quá thời gian của dịch vụ (${originalDuration} phút).`);
        }

        // --- XỬ LÝ LƯƠNG & TUA KTV CŨ ---
        if (businessDate) {
            if (keepTurnForOldKtv) {
                // Đánh dấu phạt (giữ tua) trong TurnLedger
                await supabase
                    .from('TurnLedger')
                    .update({ is_punished: true })
                    .eq('date', businessDate)
                    .eq('booking_id', item.bookingId)
                    .eq('employee_id', oldKtvId);
            } else {
                // Xóa hẳn TurnLedger -> Hủy tua
                await supabase
                    .from('TurnLedger')
                    .delete()
                    .eq('date', businessDate)
                    .eq('booking_id', item.bookingId)
                    .eq('employee_id', oldKtvId);
            }
        }

        // Hạ KTV cũ xuống waiting (nếu đang ở working với đơn này)
        if (businessDate) {
            await supabase
                .from('TurnQueue')
                .update({ status: 'waiting', current_order_id: null, booking_item_id: null, booking_item_ids: [] })
                .eq('employee_id', oldKtvId)
                .eq('date', businessDate);
        }

        // --- NẾU CÓ KTV MỚI VÀO THAY ---
        let customCommissionDuration = 0;
        if (newKtvId) {
            // Tính số phút KTV B làm (Trọn lương gốc + bù thêm)
            customCommissionDuration = originalDuration + extraTimeMins;

            if (businessDate) {
                // Thêm tua cho KTV B
                await supabase
                    .from('TurnLedger')
                    .insert({
                        date: businessDate,
                        employee_id: newKtvId,
                        booking_id: item.bookingId,
                        counted_at: new Date().toISOString()
                    });
                    
                // Kéo KTV B lên working
                await supabase
                    .from('TurnQueue')
                    .update({ status: 'working', current_order_id: item.bookingId, booking_item_id: item.id })
                    .eq('employee_id', newKtvId)
                    .eq('date', businessDate);
            }
        }

        // --- CẬP NHẬT TECHNICIAN CODES VÀ SEGMENTS ---
        let newTechCodes = Array.isArray(item.technicianCodes) ? [...item.technicianCodes] : [];
        newTechCodes = newTechCodes.filter(id => id !== oldKtvId);
        
        if (newKtvId && !newTechCodes.includes(newKtvId)) {
            newTechCodes.push(newKtvId);
        }

        let segments = Array.isArray(item.segments) ? [...item.segments] : [];
        // Chốt segment cũ
        const aIndex = segments.findIndex(seg => seg.ktvId === oldKtvId && !seg.endTime);
        const pauseTime = item.pauseStart || new Date().toISOString();
        if (aIndex !== -1) {
            segments[aIndex].endTime = pauseTime;
            segments[aIndex].note = newKtvId ? 'Bị đổi người (Phạt)' : 'Rút ra làm dịch vụ khác';
        }

        // Thêm segment mới nếu có KTV mới
        if (newKtvId) {
            segments.push({
                ktvId: newKtvId,
                startTime: new Date().toISOString(), // Sẽ chạy tiếp từ lúc Resume
                endTime: null,
                customCommissionDuration: customCommissionDuration > 0 ? customCommissionDuration : undefined,
                note: 'Vào cứu bộ'
            });
        }

        const { error: errUpdate } = await supabase
            .from('BookingItems')
            .update({
                technicianCodes: newTechCodes,
                segments: segments
            })
            .eq('id', bookingItemId);
            
        if (errUpdate) throw new Error('Lỗi khi cập nhật BookingItem.');

        return { success: true };
    }
}
