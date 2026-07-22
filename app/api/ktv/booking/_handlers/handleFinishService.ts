/**
 * ============================================================
 * ✅ HANDLER: CLEANING / FEEDBACK / DONE
 * ============================================================
 * 
 * Xử lý khi KTV hoàn thành dịch vụ (bấm "Xong").
 * 
 * 📋 LUỒNG:
 *   1. Gom TẤT CẢ segments của KTV này (cross-item nếu merged)
 *   2. Nếu isMerged: phân bổ thời gian theo duration ratio
 *      - Chặng cuối gánh hết thời gian dư (nếu finish trễ)
 *   3. Set actualEndTime + feedbackTime cho segments của KTV
 *   4. 🧠 SMART STATUS: Chỉ set item = CLEANING khi TẤT CẢ segments done
 *   5. 🧠 DUAL-CONDITION: Item = DONE chỉ khi allSegsDone + alreadyRated
 *   6. recomputeBookingStatus → set booking-level status
 * 
 * 🚫 KHÔNG ĐƯỢC:
 *   - Set actualEndTime cho segment của KTV KHÁC (each KTV finishes independently)
 *   - Bỏ qua Smart Status check (allSegsDone)
 *   - Force booking status thành DONE khi còn item chưa xong
 *   - Lùi item status đã DONE về CLEANING/FEEDBACK
 * 
 * ⚠️ EDGE CASES ĐÃ XỬ LÝ:
 *   - 2 KTV 1 DV: Ng 1 xong, item giữ IN_PROGRESS cho Ng 2
 *   - 1 KTV 2 DV (merged): Thời gian phân bổ theo duration ratio
 *   - Ca đêm: Cross-midnight time calculation
 *   - Khách rate trước KTV xong: alreadyRated check
 * 
 * 📊 DB OPERATIONS (tự xử lý):
 *   - UPDATE BookingItems.segments + status (per-item Smart Status)
 *   - SELECT BookingItems → recomputeBookingStatus
 * 
 * 📤 TRẢ VỀ:
 *   - bookingUpdatePayload: { status: bStatus }
 * 
 * 🔗 PHỤ THUỘC: lib/dispatch-status.ts (recomputeBookingStatus)
 * ============================================================
 */

import { HandlerContext, HandlerResult, ktvMatchesSeg } from '../_shared/utils';

export async function handleFinishService(ctx: HandlerContext): Promise<HandlerResult> {
    const { supabase, bookingId, technicianCode, status, allItemIdsForThisKTV } = ctx;
    const bookingUpdatePayload: Record<string, any> = {};
    const isFeedback = status === 'FEEDBACK';
    const nowISO = new Date().toISOString();

    // ─── 1. GOM SEGMENTS CỦA KTV NÀY ───
    const { data: items } = await supabase.from('BookingItems').select('id, segments, status, itemRating').in('id', allItemIdsForThisKTV);
    
    let allGlobalSegs: any[] = [];
    let originalItemsData: Record<string, any[]> = {};
    for (const item of items || []) {
        let segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []);
        originalItemsData[item.id] = [...segs];
        segs.forEach((seg: any, idx: number) => {
            if (ktvMatchesSeg(seg.ktvId, technicianCode)) {
                allGlobalSegs.push({ item, idx, seg, _itemId: item.id });
            }
        });
    }
    allGlobalSegs.sort((a: any, b: any) => (a.seg.startTime || '23:59').localeCompare(b.seg.startTime || '23:59'));
    const uniqueItemIds = new Set(allGlobalSegs.map((s: any) => s._itemId));
    const uniqueRoomIds = new Set(allGlobalSegs.map((s: any) => s.seg.roomId).filter(Boolean));

    // 📸 UPLOAD HANDOVER PHOTO (if provided)
    let handoverPhotoUrl: string | null = null;
    if (ctx.body?.photoBase64 && technicianCode) {
        try {
            const base64Str = ctx.body.photoBase64;
            const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const fileExt = base64Str.match(/^data:image\/(\w+);base64,/)?.[1] || 'jpg';
            const fileName = `handover_${bookingId}_${technicianCode}_${Date.now()}.${fileExt}`;
            
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('attendance')
                .upload(fileName, buffer, {
                    contentType: `image/${fileExt}`,
                    upsert: false
                });
            
            if (uploadError) {
                console.error('❌ [KTV API] Handover photo upload error:', uploadError);
            } else if (uploadData?.path) {
                const { data: publicUrlData } = supabase.storage.from('attendance').getPublicUrl(uploadData.path);
                handoverPhotoUrl = publicUrlData.publicUrl;
                console.log(`📸 [KTV API] Uploaded handover photo for ${technicianCode}:`, handoverPhotoUrl);
            }
        } catch (err) {
            console.error('❌ [KTV API] Failed to upload handover photo:', err);
        }
    }
    
    // Đồng bộ handoverPhotoUrl vào tất cả segment của KTV này trong đơn hàng này
    if (handoverPhotoUrl) {
        allGlobalSegs.forEach((itemSeg: any) => {
            if (itemSeg.seg.ktvId === technicianCode) {
                itemSeg.seg.handoverPhotoUrl = handoverPhotoUrl;
                originalItemsData[itemSeg.item.id][itemSeg.idx] = itemSeg.seg;
            }
        });
    }
    
    // Không gộp nếu đã có chặng kết thúc (tránh đè thời gian khi thêm dịch vụ sau khi chặng 1 đã xong)
    const hasFinishedSegment = allGlobalSegs.some((s: any) => 
        s.item.status === 'DONE' || 
        (s.seg.actualEndTime && s.item.status !== 'IN_PROGRESS')
    );

    // 🧠 SMART MERGE: Nếu KTV có nhiều chặng trong cùng 1 Booking,
    // tự động gộp và phân bổ thời gian liên tục (kể cả DV gán thêm lúc đang làm).
    const isMerged = allGlobalSegs.length > 1 
        && uniqueItemIds.size === allGlobalSegs.length
        && uniqueRoomIds.size === 1
        && !hasFinishedSegment;

    // ─── 2. isMerged TIME ALLOCATION ───
    if (isMerged && (status === 'CLEANING' || isFeedback)) {
        // Forwards padding to prevent negative duration if KTV finishes early
        const firstStartTime = allGlobalSegs[0].seg.actualStartTime || nowISO;
        let actualTimeSpentMs = new Date(nowISO).getTime() - new Date(firstStartTime).getTime();
        if (actualTimeSpentMs < 0) actualTimeSpentMs = 0; // Guard against negative time

        let currentStartTimeMs = new Date(firstStartTime).getTime();
        
        // ⚖️ PROPORTIONAL ALLOCATION (Chia thời gian theo tỉ lệ duration)
        const totalDurationMs = allGlobalSegs.reduce((sum: number, s: any) => sum + ((Number(s.seg.duration) || 60) * 60000), 0);

        for (let i = 0; i < allGlobalSegs.length; i++) {
            const target = allGlobalSegs[i];
            const segDurationMs = (Number(target.seg.duration) || 60) * 60000;
            
            target.seg.actualStartTime = new Date(currentStartTimeMs).toISOString();
            
            // Chia tỉ lệ: (Thời gian tiêu chuẩn của DV / Tổng thời gian tiêu chuẩn) * Tổng thời gian thực tế
            let allocatedMs = Math.floor((segDurationMs / (totalDurationMs || 1)) * actualTimeSpentMs);
            
            // Chặng cuối ôm trọn số phút còn lại (tránh sai số làm tròn hoặc finish trễ)
            if (i === allGlobalSegs.length - 1) {
                allocatedMs = new Date(nowISO).getTime() - currentStartTimeMs;
            }
            
            currentStartTimeMs += allocatedMs;
            
            target.seg.actualEndTime = new Date(currentStartTimeMs).toISOString();
            if (isFeedback) target.seg.feedbackTime = nowISO;
            
            // Đánh dấu lại cờ isMergedRun để UI luôn biết đây là phiên gộp
            target.seg.isMergedRun = true;
            
            originalItemsData[target.item.id][target.idx] = target.seg;
        }
        
    } else {
        // Logic cũ (non-merged) — CHỈ hoàn tất segments đã có actualStartTime
        allGlobalSegs.forEach((target: any) => {
            // 🛡️ GUARD: Bỏ qua segments chưa bắt đầu (DV gán sau khi KTV đã làm)
            // Segments này sẽ chờ KTV bắt đầu riêng trong phiên tiếp theo
            if (!target.seg.actualStartTime) {
                console.log(`⏭️ [FinishService] Skipping segment ${target.seg.id || target._itemId} — no actualStartTime (added after KTV started)`);
                return;
            }
            if (status === 'CLEANING' || isFeedback) {
                if (!target.seg.actualEndTime) target.seg.actualEndTime = nowISO;
                if (isFeedback && !target.seg.feedbackTime) target.seg.feedbackTime = nowISO;
            }
            originalItemsData[target.item.id][target.idx] = target.seg;
        });
    }

    // ─── 3. 🧠 SMART STATUS PER-ITEM ───
    for (const item of items || []) {
        let segs = originalItemsData[item.id];
        
        // (Removed Parallel Sync for actualEndTime so KTVs finish independently)

        // 🧠 SMART STATUS: Only set CLEANING when ALL segments in item have actualEndTime
        //    Prevents sequential bug (KTV1 done but KTV2 not started yet)
        //    Bỏ qua segments chưa bắt đầu (không có actualStartTime) khi tính allSegsDone
        const startedSegs = segs.filter((s: any) => !!s.actualStartTime);
        const allSegsDone = startedSegs.length > 0 && startedSegs.every((s: any) => !!s.actualEndTime);
        const hasUnstartedSegs = segs.some((s: any) => !s.actualStartTime && s.ktvId);
        const alreadyRated = (item as any).itemRating !== null && (item as any).itemRating !== undefined;

        // 🧠 DUAL-CONDITION COMPLETION:
        // Booking chỉ DONE khi CẢ HAI điều kiện: KTV xong + Khách đã rate
        // Xử lý cả 2 thứ tự: KTV xong trước hoặc Khách rate trước
        // 🛡️ Nếu còn segments chưa bắt đầu (DV gán muộn), giữ IN_PROGRESS cho item đó
        const newItemStatus = (item.status === 'DONE')
            ? 'DONE'                          // 🛡️ Đã DONE → không lùi
            : hasUnstartedSegs
                ? 'IN_PROGRESS'               // 🔒 Còn DV chưa bắt đầu → giữ IN_PROGRESS
                : (alreadyRated && allSegsDone)
                    ? 'DONE'                  // 🧠 Khách đã rate + KTV xong → hoàn tất
                    : allSegsDone
                        ? (isFeedback ? 'FEEDBACK' : 'CLEANING')
                        : 'IN_PROGRESS';
        
        await supabase.from('BookingItems').update({ segments: JSON.stringify(segs), status: newItemStatus }).eq('id', item.id);
        console.log(`🧠 [Smart Status] Item ${item.id}: allSegsDone=${allSegsDone}, alreadyRated=${alreadyRated} → ${newItemStatus}`);
    }
    
    // ─── 4. 🔄 RECOMPUTE BOOKING STATUS ───
    const { data: allItems } = await supabase
        .from('BookingItems')
        .select('status, serviceId, Services!BookingItems_serviceId_fkey(nameVN, is_utility)')
        .eq('bookingId', bookingId);
    if (allItems && allItems.length > 0) {
        const validItems = allItems.filter((i: any) => {
            const name = i.Services?.nameVN || '';
            return i.Services?.is_utility !== true 
                && i.serviceId !== 'NHS0900'  // Legacy fallback
                && !name.toLowerCase().includes('phòng riêng')
                && !name.toLowerCase().includes('phong rieng');
        });
        const finalItems = validItems.length > 0 ? validItems : allItems;
        const statuses = finalItems.map((i: any) => i.status);
        const { recomputeBookingStatus } = await import('@/lib/dispatch-status');
        const bStatus = recomputeBookingStatus(statuses);
        bookingUpdatePayload.status = bStatus;
    }

    return { bookingUpdatePayload };
}
