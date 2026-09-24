/**
 * ============================================================
 * ⏱️ HANDLER: START_TIMER / NEXT_SEGMENT
 * ============================================================
 * 
 * Xử lý khi KTV bấm BẮT ĐẦU hoặc chuyển sang chặng tiếp theo.
 * 
 * 📋 LUỒNG:
 *   1. Validate thời gian (không cho bắt đầu sớm hơn giờ dispatch)
 *      → Trả earlyResponse 403 nếu chưa đến giờ
 *   2. Set Bookings.timeStart nếu chưa có (chỉ lần đầu)
 *   3. Set actualStartTime cho segment hiện tại (BookingItems.segments)
 *   4. Nếu NEXT_SEGMENT: set actualEndTime cho segment trước
 *   5. Recalculate TurnQueue.estimated_end_time (dựa trên actual start)
 * 
 * 🚫 KHÔNG ĐƯỢC:
 *   - Set actualStartTime cho segment của KTV KHÁC (Parallel Sync đã bị xóa)
 *   - Thay đổi status của BookingItem ở bước này
 *   - Gọi recomputeBookingStatus ở bước này
 * 
 * 📊 DB OPERATIONS (tự xử lý):
 *   - UPDATE BookingItems.segments (set actualStartTime/actualEndTime)
 *   - UPDATE TurnQueue (status, start_time, estimated_end_time)
 * 
 * 📤 TRẢ VỀ:
 *   - bookingUpdatePayload: { timeStart } (nếu lần đầu) hoặc {}
 *   - earlyResponse: 403 nếu chưa đến giờ
 * 
 * 🔗 PHỤ THUỘC: _shared/utils.ts (HandlerContext)
 * ============================================================
 */

import { NextResponse } from 'next/server';
import { HandlerContext, HandlerResult, ktvMatchesSeg } from '../_shared/utils';
import { calculateAccurateEndTimeFromSegments } from '@/lib/time-helper';
export async function handleStartTimer(ctx: HandlerContext): Promise<HandlerResult> {
    const { supabase, bookingId, technicianCode, action, turnForSync, allItemIdsForThisKTV, body } = ctx;
    const bookingUpdatePayload: Record<string, any> = {};

    const fail = (error: string, status = 400): HandlerResult => ({
        bookingUpdatePayload: {},
        earlyResponse: NextResponse.json({ success: false, error }, { status })
    });

    const uploadedPaths: string[] = [];

    const cleanupUploadedProofs = async () => {
        if (uploadedPaths.length === 0) return;

        const paths = [...uploadedPaths];
        const { error } = await supabase.storage
            .from('attendance')
            .remove(paths);

        if (error) {
            console.error('Proof cleanup failed:', { paths, error });
        }
    };

    if (action === 'START_TIMER' && (!technicianCode || allItemIdsForThisKTV.length === 0)) {
        return fail('Không tìm thấy KTV hoặc chặng làm việc hợp lệ');
    }

    const activeSegmentIndex = body.activeSegmentIndex ?? 0;
    if (action === 'START_TIMER' && (!Number.isInteger(activeSegmentIndex) || activeSegmentIndex < 0)) {
        return fail('Chặng làm việc không hợp lệ');
    }

    // ─── 1. TIME VALIDATION (chờ đúng giờ) ───
    if (turnForSync && action !== 'NEXT_SEGMENT_PREPARE') {
        let allowed: Date | null = null;
        if (turnForSync.start_time) {
            const [h, m] = String(turnForSync.start_time).split(':').map(Number);
            const nowUtc = new Date();
            const vnOffsetMs = 7 * 60 * 60 * 1000;
            const nowVn = new Date(nowUtc.getTime() + vnOffsetMs);
            let allowedUtc = new Date(Date.UTC(nowVn.getUTCFullYear(), nowVn.getUTCMonth(), nowVn.getUTCDate(), h, m, 0) - vnOffsetMs);
            
            // 🌙 FIX CA ĐÊM: Nếu start_time chiều (VD: 17:29) nhưng hiện tại đã qua 0:00
            // → allowed bị tính vào ngày hôm sau → lùi 1 ngày
            if (allowedUtc.getTime() - nowUtc.getTime() > 12 * 60 * 60 * 1000) {
                allowedUtc = new Date(allowedUtc.getTime() - 24 * 60 * 60 * 1000);
            }
            
            allowed = allowedUtc;
        }
        if (allowed && new Date().getTime() < (allowed.getTime() - 5000)) {
            const vnOffsetMs = 7 * 60 * 60 * 1000;
            const allowedVn = new Date(allowed.getTime() + vnOffsetMs);
            return {
                bookingUpdatePayload: {},
                earlyResponse: NextResponse.json(
                    { success: false, error: `Chưa đến giờ được phép bắt đầu! Vui lòng đợi đến ${String(allowedVn.getUTCHours()).padStart(2, '0')}:${String(allowedVn.getUTCMinutes()).padStart(2, '0')}` },
                    { status: 403 }
                )
            };
        }
    }

    // ─── 2. SET BOOKING timeStart (chỉ lần đầu) ───
    const sharedTimeStart = new Date().toISOString();
    const { data: currentBookingForTime } = await supabase.from('Bookings').select('timeStart, status').eq('id', bookingId).single();
    
    if (!currentBookingForTime?.timeStart && action !== 'RESUME_TIMER' && action !== 'NEXT_SEGMENT') {
        bookingUpdatePayload.timeStart = sharedTimeStart;
    }
    
    if ((action === 'START_TIMER' || action === 'NEXT_SEGMENT') && currentBookingForTime?.status !== 'IN_PROGRESS') {
        bookingUpdatePayload.status = 'IN_PROGRESS';
    }

    // ─── 3. SEGMENT actualStartTime LOGIC ───
    let allGlobalSegs: any[] = [];
    if (allItemIdsForThisKTV.length > 0) {
        const { data: currentItems } = await supabase.from('BookingItems').select('id, segments, timeStart').in('id', allItemIdsForThisKTV);
        const activeSegmentIndex = body.activeSegmentIndex || 0;
        let originalItemsData: Record<string, any[]> = {};
        
        for (const item of currentItems || []) {
            let segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []);
            originalItemsData[item.id] = [...segs]; // Backup the entire array
            segs.forEach((seg: any, idx: number) => {
                if (ktvMatchesSeg(seg.ktvId, technicianCode)) allGlobalSegs.push({ item, idx, seg });
            });
        }
        allGlobalSegs.sort((a: any, b: any) => (a.seg.startTime || '23:59').localeCompare(b.seg.startTime || '23:59'));

        const target = allGlobalSegs[activeSegmentIndex];

        if (action === 'START_TIMER' &&
            (!target ||
             !ktvMatchesSeg(target.seg.ktvId, technicianCode) ||
             target.seg.actualEndTime)) {
            return fail('Không tìm thấy chặng đang xử lý hoặc chặng đã hoàn tất', 409);
        }

        const parseProof = (value: unknown) => {
            const match = typeof value === 'string'
                ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value)
                : null;

            if (!match) throw new Error('Ảnh phải là JPEG, PNG hoặc WEBP');

            const mime = match[1].toLowerCase();
            const encoded = match[2];
            const buffer = Buffer.from(encoded, 'base64');

            if (
                buffer.length === 0 ||
                buffer.length > 5 * 1024 * 1024 ||
                buffer.toString('base64') !== encoded
            ) {
                throw new Error('Ảnh không hợp lệ hoặc vượt quá 5MB');
            }

            const validSignature = mime === 'jpeg'
                ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
                : mime === 'png'
                    ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                    : buffer.length >= 12 &&
                      buffer.toString('ascii', 0, 4) === 'RIFF' &&
                      buffer.toString('ascii', 8, 12) === 'WEBP';

            if (!validSignature) throw new Error('Nội dung ảnh không khớp định dạng');

            return {
                buffer,
                contentType: `image/${mime}`,
                extension: mime === 'jpeg' ? 'jpg' : mime
            };
        };

        let startPhotoUrl: string | null = null;
        let guestSlipperPhotoUrl: string | null = null;

        const startInput = body.startPhotoBase64 || body.photoBase64;
        if (action === 'START_TIMER') {
            if (!body.guestSlipperPhotoBase64 || !startInput) {
                return fail('Bắt buộc có ảnh dép khách và ảnh bắt đầu dịch vụ');
            }

            let slipperProof: ReturnType<typeof parseProof>;
            let startProof: ReturnType<typeof parseProof>;

            try {
                slipperProof = parseProof(body.guestSlipperPhotoBase64);
                startProof = parseProof(startInput);
            } catch (error: any) {
                return fail(error?.message || 'Ảnh không hợp lệ', 400);
            }

            const uploadProof = async (prefix: string, proof: ReturnType<typeof parseProof>) => {
                const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${proof.extension}`;

                const { data, error } = await supabase.storage
                    .from('attendance')
                    .upload(fileName, proof.buffer, {
                        contentType: proof.contentType,
                        upsert: false
                    });

                if (error || !data?.path) throw error || new Error('Upload ảnh thất bại');

                uploadedPaths.push(data.path);

                const { data: publicData } = supabase.storage
                    .from('attendance')
                    .getPublicUrl(data.path);

                if (!publicData?.publicUrl) throw new Error('Không tạo được URL ảnh');

                return { path: data.path, url: publicData.publicUrl };
            };

            try {
                const slipperUpload = await uploadProof('slipper', slipperProof);
                const startUpload = await uploadProof('start', startProof);

                guestSlipperPhotoUrl = slipperUpload.url;
                startPhotoUrl = startUpload.url;
            } catch (error: any) {
                await cleanupUploadedProofs();
                console.error('❌ [KTV API] Upload proofs error:', error);
                return fail('Tải ảnh minh chứng lên máy chủ thất bại', 500);
            }
        }

        if (action === 'START_TIMER' || action === 'NEXT_SEGMENT') {
            const startIdx = activeSegmentIndex; // Use activeSegmentIndex from client or logic
            if (allGlobalSegs[startIdx]) {
                const myStartTime = allGlobalSegs[startIdx].seg.startTime;
                if (action === 'NEXT_SEGMENT' && startIdx > 0) {
                    if (!allGlobalSegs[startIdx - 1].seg.actualEndTime) {
                        allGlobalSegs[startIdx - 1].seg.actualEndTime = sharedTimeStart;
                    }
                }
                
                allGlobalSegs[startIdx].seg.actualStartTime = sharedTimeStart;
                
                // 🔒 MERGE LOCK: Khi START_TIMER với nhiều DV (merge scenario),
                // đóng dấu actualStartTime lên TẤT CẢ segments của KTV này.
                // Mục đích: Nếu Quầy gán thêm DV sau khi KTV đã bắt đầu,
                // segment mới sẽ KHÔNG có actualStartTime → server biết nó là thẻ riêng,
                // không gộp vào nhóm hiện tại khi hoàn tất.
                if (action === 'START_TIMER' && allGlobalSegs.length > 1) {
                    const mergeItemIds = new Set(allGlobalSegs.map((s: any) => s.item?.id));
                    const uniqueRoomIds = new Set(allGlobalSegs.map((s: any) => s.seg.roomId).filter(Boolean));
                    const hasFinishedSegment = allGlobalSegs.some((s: any) => s.item.status === 'DONE' || (s.seg.actualEndTime && s.item.status !== 'IN_PROGRESS'));
                    
                    const isMergeAtStart = body.shouldMerge === true;
                        
                    if (isMergeAtStart) {
                        console.log(`🔒 [Merge Lock] Stamping actualStartTime on ${allGlobalSegs.length} segments for ${technicianCode}`);
                        allGlobalSegs.forEach((itemSeg: any, i: number) => {
                            // Gắn cờ Gộp để Frontend không bị tách chặng kể cả khi hoàn thành
                            itemSeg.seg.isMergedRun = true;
                            if (i !== startIdx && !itemSeg.seg.actualStartTime) {
                                itemSeg.seg.actualStartTime = sharedTimeStart;
                            }
                            // BẮT BUỘC lưu lại vào originalItemsData
                            originalItemsData[itemSeg.item.id][itemSeg.idx] = itemSeg.seg;
                        });
                    }
                }

                // Ghi nhận ảnh vào đúng chặng đang thực hiện (không đè chặng đã xong)
                if (action === 'START_TIMER' && startPhotoUrl && guestSlipperPhotoUrl) {
                    allGlobalSegs.forEach((itemSeg: any, i: number) => {
                        const belongsToRun =
                            i === activeSegmentIndex ||
                            (body.shouldMerge === true && itemSeg.seg.isMergedRun);

                        if (
                            belongsToRun &&
                            !itemSeg.seg.actualEndTime &&
                            ktvMatchesSeg(itemSeg.seg.ktvId, technicianCode)
                        ) {
                            itemSeg.seg.startPhotoUrl = startPhotoUrl;
                            itemSeg.seg.guestSlipperPhotoUrl = guestSlipperPhotoUrl;
                            originalItemsData[itemSeg.item.id][itemSeg.idx] = itemSeg.seg;
                        }
                    });
                }
                
                const target = allGlobalSegs[startIdx];
                originalItemsData[target.item.id][target.idx] = target.seg;
                
                if (action === 'NEXT_SEGMENT' && startIdx > 0) {
                    const prevTarget = allGlobalSegs[startIdx - 1];
                    originalItemsData[prevTarget.item.id][prevTarget.idx] = prevTarget.seg;
                }

                // 🤝 PARALLEL START SYNC: Removed to allow independent starts for KTVs entering at different times
            }
        }


        const itemsToUpdate = currentItems || [];
        let persistedItemCount = 0;

        for (let itemIdx = 0; itemIdx < itemsToUpdate.length; itemIdx++) {
            const item = itemsToUpdate[itemIdx];
            const updatePayload: any = { segments: JSON.stringify(originalItemsData[item.id]) };
            if (action === 'START_TIMER' || action === 'NEXT_SEGMENT') {
                updatePayload.status = 'IN_PROGRESS';
            }
            const { error: itemUpdateError } = await supabase.from('BookingItems').update(updatePayload).eq('id', item.id);
            if (itemUpdateError) {
                console.error('❌ [handleStartTimer] Failed to update BookingItem:', item.id, itemUpdateError);
                if (persistedItemCount === 0) {
                    await cleanupUploadedProofs();
                }

                const partialWarning = persistedItemCount > 0
                    ? ` (Lưu ý: Đã cập nhật dở ${persistedItemCount}/${itemsToUpdate.length} item trước đó do chưa hỗ trợ database transaction)`
                    : '';
                return fail(`Lỗi cập nhật chặng dịch vụ (${item.id})${partialWarning}: ${itemUpdateError.message}`, 500);
            }
            persistedItemCount++;
        }
    }
    
    // ─── 3.5 🔄 SYNC CHILD ITEMS ───
    if (action === 'START_TIMER' || action === 'NEXT_SEGMENT') {
        const { data: bookingItemsToSync } = await supabase.from('BookingItems').select('id, status, options').eq('bookingId', bookingId);
        if (bookingItemsToSync) {
            const updates = [];
            for (const item of bookingItemsToSync) {
                let opts: any = {};
                try { opts = typeof item.options === 'string' ? JSON.parse(item.options) : (item.options || {}); } catch {}
                if (opts.mergedIntoId) {
                    const parent = bookingItemsToSync.find((p: any) => p.id === opts.mergedIntoId);
                    if (parent && parent.status && parent.status !== item.status) {
                        updates.push({ id: item.id, status: parent.status });
                    }
                }
            }
            if (updates.length > 0) {
                for (const upd of updates) {
                    await supabase.from('BookingItems').update({ status: upd.status }).eq('id', upd.id);
                }
            }
        }
    }

    // ─── 4. TURNQUEUE RECALCULATION ───
    // 🔥 CRITICAL: Recalculate TurnQueue.estimated_end_time when KTV actually starts
    if (action === 'START_TIMER' && technicianCode && turnForSync) {
        const nowVN = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
        const turnUpdatePayload: any = { 
            status: 'working', 
            start_time: nowVN,
            current_order_id: bookingId
        };
        
        // Tự động self-heal dữ liệu sổ tua nếu KTV được gán vào từ Draft Mode
        if (allGlobalSegs && allGlobalSegs.length > 0) {
            turnUpdatePayload.room_id = allGlobalSegs[0].seg.roomId || turnForSync.room_id || null;
            turnUpdatePayload.bed_id = allGlobalSegs[0].seg.bedId || null;
            turnUpdatePayload.booking_item_ids = Array.from(new Set(allGlobalSegs.map((s: any) => s.item.id)));
            turnUpdatePayload.booking_item_id = turnUpdatePayload.booking_item_ids[0];
        }

        try {
            if (allGlobalSegs && allGlobalSegs.length > 0) {
                const newEnd = calculateAccurateEndTimeFromSegments(allGlobalSegs, nowVN);
                turnUpdatePayload.estimated_end_time = newEnd;
                console.log(`🔄 [KTV API] ${technicianCode}: Accurately calculated end from segments → ${turnUpdatePayload.estimated_end_time} (actual start: ${nowVN})`);
            }
        } catch (calcErr) {
            console.error('❌ [KTV API] Failed to calculate TurnQueue estimated end time:', calcErr);
        }

        await supabase.from('TurnQueue').update(turnUpdatePayload).eq('id', turnForSync.id);
    }

    return { bookingUpdatePayload };
}

