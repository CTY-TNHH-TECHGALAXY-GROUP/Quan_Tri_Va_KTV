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
import { recalculateEstimatedEndTime } from '@/lib/time-helper';

export async function handleStartTimer(ctx: HandlerContext): Promise<HandlerResult> {
    const { supabase, bookingId, technicianCode, action, turnForSync, allItemIdsForThisKTV, body } = ctx;
    const bookingUpdatePayload: Record<string, any> = {};

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
    const { data: currentBookingForTime } = await supabase.from('Bookings').select('timeStart').eq('id', bookingId).single();
    
    if (!currentBookingForTime?.timeStart && action !== 'RESUME_TIMER' && action !== 'NEXT_SEGMENT') {
        bookingUpdatePayload.timeStart = sharedTimeStart;
    }

    // ─── 3. SEGMENT actualStartTime LOGIC ───
    if (allItemIdsForThisKTV.length > 0) {
        const { data: currentItems } = await supabase.from('BookingItems').select('id, segments, timeStart').in('id', allItemIdsForThisKTV);
        const activeSegmentIndex = body.activeSegmentIndex || 0;
        let allGlobalSegs: any[] = [];
        let originalItemsData: Record<string, any[]> = {};
        
        for (const item of currentItems || []) {
            let segs = typeof item.segments === 'string' ? JSON.parse(item.segments) : (Array.isArray(item.segments) ? item.segments : []);
            originalItemsData[item.id] = [...segs]; // Backup the entire array
            segs.forEach((seg: any, idx: number) => {
                if (ktvMatchesSeg(seg.ktvId, technicianCode)) allGlobalSegs.push({ item, idx, seg });
            });
        }
        allGlobalSegs.sort((a: any, b: any) => (a.seg.startTime || '23:59').localeCompare(b.seg.startTime || '23:59'));

        // 📸 UPLOAD SELFIE BEFORE START (action: START_TIMER)
        let startPhotoUrl: string | null = null;
        if (action === 'START_TIMER' && body.photoBase64 && technicianCode) {
            try {
                const base64Str = body.photoBase64;
                const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                const fileExt = base64Str.match(/^data:image\/(\w+);base64,/)?.[1] || 'jpg';
                const fileName = `selfie_${bookingId}_${technicianCode}_${Date.now()}.${fileExt}`;
                
                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('attendance')
                    .upload(fileName, buffer, {
                        contentType: `image/${fileExt}`,
                        upsert: false
                    });
                
                if (uploadError) {
                    console.error('❌ [KTV API] Selfie upload error:', uploadError);
                } else if (uploadData?.path) {
                    const { data: publicUrlData } = supabase.storage.from('attendance').getPublicUrl(uploadData.path);
                    startPhotoUrl = publicUrlData.publicUrl;
                    console.log(`📸 [KTV API] Uploaded start photo for ${technicianCode}:`, startPhotoUrl);
                }
            } catch (err) {
                console.error('❌ [KTV API] Failed to upload start photo:', err);
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
                    
                    const isMergeAtStart = allGlobalSegs.length > 1 
                        && mergeItemIds.size === allGlobalSegs.length
                        && uniqueRoomIds.size === 1
                        && !hasFinishedSegment;
                        
                    if (isMergeAtStart) {
                        console.log(`🔒 [Merge Lock] Stamping actualStartTime on ${allGlobalSegs.length} segments for ${technicianCode}`);
                        allGlobalSegs.forEach((itemSeg: any, i: number) => {
                            if (i !== startIdx && !itemSeg.seg.actualStartTime) {
                                itemSeg.seg.actualStartTime = sharedTimeStart;
                            }
                        });
                    }
                }

                // Đồng bộ startPhotoUrl vào tất cả segment của KTV này trong đơn hàng này
                if (startPhotoUrl) {
                    allGlobalSegs.forEach((itemSeg: any) => {
                        if (itemSeg.seg.ktvId === technicianCode) {
                            itemSeg.seg.startPhotoUrl = startPhotoUrl;
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


        for (const item of currentItems || []) {
            await supabase.from('BookingItems').update({ segments: JSON.stringify(originalItemsData[item.id]) }).eq('id', item.id);
        }
    }

    // ─── 4. TURNQUEUE RECALCULATION ───
    // 🔥 CRITICAL: Recalculate TurnQueue.estimated_end_time when KTV actually starts
    if (action === 'START_TIMER' && technicianCode && turnForSync) {
        const nowVN = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
        const turnUpdatePayload: any = { status: 'working', start_time: nowVN };

        if (turnForSync.start_time) {
            try {
                // Calculate original duration from dispatch times
                const { data: freshTurn } = await supabase
                    .from('TurnQueue')
                    .select('estimated_end_time')
                    .eq('id', turnForSync.id)
                    .single();
                
                const estEnd = freshTurn?.estimated_end_time;
                if (estEnd) {
                    const newEnd = recalculateEstimatedEndTime(String(turnForSync.start_time), String(estEnd), nowVN);
                    if (newEnd !== estEnd) {
                        turnUpdatePayload.estimated_end_time = newEnd;
                        console.log(`🔄 [KTV API] ${technicianCode}: Recalculated end ${estEnd} → ${turnUpdatePayload.estimated_end_time} (actual start: ${nowVN})`);
                    }
                }
            } catch (calcErr) {
                console.error('❌ [KTV API] Failed to recalculate TurnQueue estimated end time:', calcErr);
            }
        }

        await supabase.from('TurnQueue').update(turnUpdatePayload).eq('id', turnForSync.id);
    }

    return { bookingUpdatePayload };
}

