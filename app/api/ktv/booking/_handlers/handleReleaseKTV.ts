/**
 * ============================================================
 * 🔓 HANDLER: RELEASE_KTV
 * ============================================================
 * 
 * Giải phóng KTV khỏi đơn hàng sau khi hoàn tất handover.
 * 
 * 📋 LUỒNG:
 *   1. Set KtvAssignments.status = 'COMPLETED'
 *   2. Gọi RPC promote_next_assignment() để KTV nhận đơn tiếp theo
 * 
 * 🚫 KHÔNG ĐƯỢC:
 *   - Thay đổi Booking status ở bước này (đã xử lý ở orchestrator)
 *   - Clear TurnQueue (promote_next_assignment tự xử lý)
 * 
 * 📊 DB OPERATIONS (tự xử lý):
 *   - UPDATE KtvAssignments (status → COMPLETED)
 *   - RPC promote_next_assignment
 * 
 * 📤 TRẢ VỀ: void (fire-and-forget, chạy sau booking update)
 * 
 * 💡 NOTE: File này chỉ ~25 dòng nhưng tách riêng để:
 *   - Giữ consistency với convention _handlers/
 *   - Extensible cho tương lai (audit log, notification, etc.)
 * ============================================================
 */

import { HandlerContext, ktvMatchesSeg } from '../_shared/utils';

export async function handleReleaseKTV(ctx: HandlerContext): Promise<void> {
    const { supabase, technicianCode, today, bookingId, body } = ctx;

    // ─── 0. UPLOAD HANDOVER PHOTOS (IF ANY) ───
    let handoverPhotoUrls: string[] = [];
    if (body.photosBase64 && Array.isArray(body.photosBase64) && technicianCode) {
        // Run uploads in parallel
        const uploadPromises = body.photosBase64.map(async (base64Str: string, index: number) => {
            try {
                const buffer = Buffer.from(base64Str.split(',')[1] || base64Str, 'base64');
                const filename = `handover_photo_${technicianCode}_${bookingId}_${Date.now()}_${index}.webp`;
                
                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('attendance')
                    .upload(`handover-photos/${filename}`, buffer, {
                        contentType: 'image/webp',
                        upsert: true
                    });
                
                if (!uploadError && uploadData) {
                    const { data: publicUrlData } = supabase.storage.from('attendance').getPublicUrl(uploadData.path);
                    return publicUrlData.publicUrl;
                }
            } catch (err) { 
                console.error('Upload handover photo failed:', err); 
            }
            return null;
        });

        const results = await Promise.all(uploadPromises);
        handoverPhotoUrls = results.filter(Boolean) as string[];
    }

    // ─── 1. CẬP NHẬT ẢNH VÀ THỜI GIAN BÀN GIAO VÀO BookingItems.segments ───
    // Lấy tất cả items của booking để cập nhật handoverTime cho KTV này
    const { data: currentItems } = await supabase.from('BookingItems').select('id, segments').eq('bookingId', bookingId);
    let finishedItemIds: string[] = [];
    if (currentItems && currentItems.length > 0) {
        for (const item of currentItems) {
            let segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []);
            let isModified = false;
            let hasCompletedSeg = false;
            segs.forEach((seg: any) => {
                if (ktvMatchesSeg(seg.ktvId, technicianCode)) {
                    if (handoverPhotoUrls.length > 0) {
                        seg.handoverPhotoUrls = handoverPhotoUrls;
                    }
                    // LUÔN GÁN handoverTime kể cả khi không có ảnh
                    seg.handoverTime = new Date().toISOString();
                    isModified = true;
                    if (seg.actualEndTime) {
                        hasCompletedSeg = true;
                    }
                }
            });
            
            if (hasCompletedSeg) {
                finishedItemIds.push(item.id);
            }
            
            if (isModified) {
                const updatePayload: any = { segments: JSON.stringify(segs) };
                
                if (handoverPhotoUrls.length > 0) {
                    const handoverObj = handoverPhotoUrls.reduce((acc, url, idx) => {
                        acc[`Ảnh ${idx + 1}`] = url;
                        return acc;
                    }, {} as Record<string, string>);
                    updatePayload.handover_images = handoverObj;
                    updatePayload.handover_status = 'PENDING';
                    // Phải hạ cờ này cùng lúc. Đây là đường nộp bàn giao mà màn KTV
                    // thực sự dùng, còn HandoverService.submitHandover (đường /handover/submit)
                    // đã hạ sẵn. Để sót thì item nộp qua đây mang PENDING + skipped=true,
                    // trong khi cron autoApproveExpired lọc .eq(handover_skipped, false)
                    // → không bao giờ được duyệt, treo PENDING vĩnh viễn dù KTV đã nộp đủ ảnh.
                    updatePayload.handover_skipped = false;
                    // Mốc để cron tính hạn auto-duyệt. KHÔNG dùng handover_status
                    // làm căn cứ vì cột đó mặc định là 'PENDING' cho cả item chưa
                    // từng bàn giao — lấy nhầm là duyệt sạch mấy nghìn đơn.
                    updatePayload.handover_submitted_at = new Date().toISOString();
                }
                
                await supabase.from('BookingItems').update(updatePayload).eq('id', item.id);
            }
        }
    }

    // ─── 2. CẬP NHẬT KtvAssignments ───
    // CHỈ hoàn tất các KtvAssignments của những BookingItems mà KTV đã thực sự làm xong (có actualEndTime)
    // Các item khác (như QUEUED chờ làm sau) sẽ không bị đánh dấu COMPLETED, tránh lỗi treo đơn.
    if (finishedItemIds.length > 0) {
        await supabase
            .from('KtvAssignments')
            .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
            .eq('employee_id', technicianCode)
            .eq('business_date', today)
            .eq('booking_id', bookingId)
            .in('booking_item_id', finishedItemIds)
            .in('status', ['ACTIVE', 'QUEUED', 'READY']);
    } else {
        // Fallback an toàn nếu không tìm thấy ID
        await supabase
            .from('KtvAssignments')
            .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
            .eq('employee_id', technicianCode)
            .eq('business_date', today)
            .eq('booking_id', bookingId)
            .eq('status', 'ACTIVE');
    }

    // ─── 3. PROMPT NEXT ASSIGNMENT ───
    await supabase.rpc('promote_next_assignment', {
        p_employee_id: technicianCode,
        p_business_date: today
    });
}
