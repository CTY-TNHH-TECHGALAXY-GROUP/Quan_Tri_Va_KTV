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
        newKtvId: string, 
        extraTimeMins: number = 0,
        businessDate: string,
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
                Bookings!fk_bookingitems_booking ( id, timeStart ),
                Services ( duration )
            `)
            .eq('id', bookingItemId)
            .single();

        if (errItem || !item) throw new Error('Không tìm thấy dịch vụ.');
        if (!item.pauseStart) throw new Error('Dịch vụ chưa được Tạm ngưng. Vui lòng Tạm ngưng trước khi đổi KTV.');

        const booking = (item.Bookings as any);
        let originalDuration = (item.Services as any)?.duration || 60;
        
        if (extraTimeMins > originalDuration) {
            throw new Error(`Thời gian bù thêm không được vượt quá thời gian của dịch vụ (${originalDuration} phút).`);
        }

        let segments: any[] = Array.isArray(item.segments) ? [...item.segments] : [];
        
        // Find assigned duration from A's segment
        const aIndex = segments.findLastIndex((s: any) => s.ktvId === oldKtvId && !s.endTime);
        if (aIndex !== -1 && segments[aIndex].duration) {
            originalDuration = Number(segments[aIndex].duration);
        }
        
        // 2. Calculate Times
        const originalTimeStartMs = new Date(booking.timeStart).getTime();
        const pauseStartMs = new Date(item.pauseStart).getTime();
        const timeAWorkedMs = pauseStartMs - originalTimeStartMs;
        const timeAWorkedMins = Math.floor(timeAWorkedMs / 60000);
        
        const remainingMins = Math.max(0, originalDuration - timeAWorkedMins);
        const timeBToWorkMins = remainingMins + extraTimeMins;
        
        // MỚI NHẤT: Quản lý quyết định KHÔNG BAO GIỜ bù lố giờ. 
        // KTV B luôn luôn được hưởng đúng bằng thời gian tua gốc (originalDuration)
        let customCommissionDuration = originalDuration;

        // 3. Xử lý KTV A (Bị thay ra)
        if (keepTurnForOldKtv) {
            // Vẫn tính tua cho KTV cũ, nhưng ghi nhận phạt lỗi
            const { error: errPunish } = await supabase
                .from('TurnLedger')
                .update({ is_punished: true })
                .eq('booking_id', item.bookingId)
                .eq('employee_id', oldKtvId)
                .eq('date', businessDate);
            if (errPunish) console.error('Lỗi phạt KTV A:', errPunish);
        } else {
            // Mặc định: Hủy tua hoàn toàn, xóa bản ghi
            const { error: errDelete } = await supabase
                .from('TurnLedger')
                .delete()
                .eq('booking_id', item.bookingId)
                .eq('employee_id', oldKtvId)
                .eq('date', businessDate);
            if (errDelete) console.error('Lỗi xóa tua KTV A:', errDelete);
        }

        // Đá KTV A về waiting trong TurnQueue
        await supabase
            .from('TurnQueue')
            .update({ status: 'waiting', current_order_id: null, booking_item_id: null })
            .eq('employee_id', oldKtvId)
            .eq('date', businessDate);

        // 4. Sinh Tua mới cho KTV B
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

        // 5. Cập nhật technicianCodes và segments
        let newTechCodes = Array.isArray(item.technicianCodes) ? [...item.technicianCodes] : [];
        newTechCodes = newTechCodes.filter(id => id !== oldKtvId);
        if (!newTechCodes.includes(newKtvId)) newTechCodes.push(newKtvId);

        if (aIndex !== -1) {
            segments[aIndex].endTime = item.pauseStart;
            segments[aIndex].note = 'Bị đổi người (Phạt)';
        }

        // Add B's segment
        segments.push({
            ktvId: newKtvId,
            startTime: new Date().toISOString(), // Lúc bấm resume sẽ chạy từ lúc này
            endTime: null,
            customCommissionDuration: customCommissionDuration > 0 ? customCommissionDuration : undefined,
            note: 'Vào cứu bồ'
        });

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
