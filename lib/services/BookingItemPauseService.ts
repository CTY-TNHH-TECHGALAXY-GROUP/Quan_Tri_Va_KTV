import { SupabaseClient } from '@supabase/supabase-js';

export class BookingItemPauseService {
    /**
     * Tạm ngưng dịch vụ (Pause)
     */
    static async pauseItem(supabase: SupabaseClient, bookingItemId: string) {
        const now = new Date().toISOString();
        
        // 1. Lấy thông tin BookingItem để biết bookingId, KTV, và segments
        const { data: item } = await supabase
            .from('BookingItems')
            .select('id, bookingId, "technicianCodes", segments')
            .eq('id', bookingItemId)
            .single();

        if (!item) throw new Error('Không tìm thấy dịch vụ.');

        let itemIdsToPause = [bookingItemId];

        // Tìm các KTV đang thực sự chạy (actualStartTime có, actualEndTime null)
        let activeKtvIds: string[] = [];
        let segments = item.segments;
        if (typeof segments === 'string') {
            try { segments = JSON.parse(segments); } catch { segments = []; }
        }
        if (Array.isArray(segments)) {
            activeKtvIds = segments
                .filter((seg: any) => seg.actualStartTime && !seg.actualEndTime && seg.ktvId)
                .map((seg: any) => seg.ktvId);
        }
        if (activeKtvIds.length === 0 && Array.isArray(item.technicianCodes)) {
            activeKtvIds = item.technicianCodes;
        }

        // Tìm tất cả các item đang IN_PROGRESS của các KTV đang chạy trong cùng booking để pause chung (Merged services)
        if (activeKtvIds.length > 0) {
            const { data: siblingItems } = await supabase
                .from('BookingItems')
                .select('id, "technicianCodes"')
                .eq('bookingId', item.bookingId)
                .eq('status', 'IN_PROGRESS');
                
            if (siblingItems) {
                const siblingIds = siblingItems
                    .filter((s: any) => Array.isArray(s.technicianCodes) && s.technicianCodes.some((k: string) => activeKtvIds.includes(k)))
                    .map((s: any) => s.id);
                if (siblingIds.length > 0) {
                    itemIdsToPause = Array.from(new Set([...itemIdsToPause, ...siblingIds]));
                }
            }
        }
        
        // Cập nhật trạng thái và lưu thời gian pause
        const { error } = await supabase
            .from('BookingItems')
            .update({ 
                status: 'PAUSED',
                pauseStart: now
            })
            .in('id', itemIdsToPause);

        if (error) {
            console.error('Error pausing items:', error);
            throw new Error('Không thể tạm ngưng dịch vụ.');
        }

        return { success: true, pauseStart: now, pausedItemIds: itemIdsToPause };
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
            .select('id, pauseStart, bookingId, segments, "technicianCodes"')
            .eq('id', bookingItemId)
            .single();

        if (errItem || !item) {
            throw new Error('Không tìm thấy dịch vụ.');
        }

        let itemIdsToResume = [bookingItemId];

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

        // Tìm các KTV đang thực sự bị Pause
        let activeKtvIds: string[] = [];
        let segments = item.segments;
        if (typeof segments === 'string') {
            try { segments = JSON.parse(segments); } catch { segments = []; }
        }
        if (Array.isArray(segments)) {
            activeKtvIds = segments
                .filter((seg: any) => seg.actualStartTime && !seg.actualEndTime && seg.ktvId)
                .map((seg: any) => seg.ktvId);
        }
        if (activeKtvIds.length === 0 && Array.isArray(item.technicianCodes)) {
            activeKtvIds = item.technicianCodes;
        }

        // 3. Tìm tất cả các items đang PAUSED của các KTV này trong cùng booking (Merged services)
        let itemsToUpdate = [item];
        if (activeKtvIds.length > 0) {
            const { data: siblingItems } = await supabase
                .from('BookingItems')
                .select('id, bookingId, pauseStart, segments, "technicianCodes"')
                .eq('bookingId', item.bookingId)
                .eq('status', 'PAUSED');
                
            if (siblingItems) {
                const siblings = siblingItems.filter((s: any) => 
                    s.id !== bookingItemId && 
                    Array.isArray(s.technicianCodes) && 
                    s.technicianCodes.some((k: string) => activeKtvIds.includes(k))
                );
                itemsToUpdate = [...itemsToUpdate, ...siblings];
            }
        }

        // 4. Tịnh tiến thời gian của các chặng (segments) đang mở cho TẤT CẢ các items liên quan
        for (const updateItem of itemsToUpdate) {
            let updatedSegments = updateItem.segments;
            let isString = typeof updatedSegments === 'string';
            if (isString) {
                try {
                    updatedSegments = JSON.parse(updatedSegments);
                } catch {
                    updatedSegments = [];
                }
            }

            if (Array.isArray(updatedSegments)) {
                updatedSegments = updatedSegments.map((seg: any) => {
                    if (seg.actualStartTime && !seg.actualEndTime) {
                        const oldStartMs = new Date(seg.actualStartTime.replace(' ', 'T') + (seg.actualStartTime.includes('Z') ? '' : 'Z')).getTime();
                        const shiftedStartMs = oldStartMs + pauseDurationMs;
                        return {
                            ...seg,
                            actualStartTime: new Date(shiftedStartMs).toISOString()
                        };
                    }
                    return seg;
                });
            }
            
            if (isString) {
                updatedSegments = JSON.stringify(updatedSegments) as any;
            }

            await supabase
                .from('BookingItems')
                .update({ 
                    status: 'IN_PROGRESS',
                    pauseStart: null,
                    segments: updatedSegments
                })
                .eq('id', updateItem.id);
        }

        // Cập nhật Bookings timeStart
        await supabase
            .from('Bookings')
            .update({ timeStart: newTimeStartIso })
            .eq('id', booking.id);

        return { success: true, newTimeStart: newTimeStartIso, resumedItemIds: itemsToUpdate.map(i => i.id) };
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

        let parsedSegments = item.segments;
        let isSegString = typeof parsedSegments === 'string';
        if (isSegString) {
            try {
                parsedSegments = JSON.parse(parsedSegments);
            } catch {
                parsedSegments = [];
            }
        }
        let segments = Array.isArray(parsedSegments) ? [...parsedSegments] : [];
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
                segments: isSegString ? JSON.stringify(segments) as any : segments
            })
            .eq('id', bookingItemId);
            
        if (errUpdate) throw new Error('Lỗi khi cập nhật BookingItem.');

        return { success: true };
    }
}
