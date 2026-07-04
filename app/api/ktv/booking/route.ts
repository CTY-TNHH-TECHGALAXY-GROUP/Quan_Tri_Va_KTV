/**
 * ============================================================
 * 🔧 KTV BOOKING API — ORCHESTRATOR
 * ============================================================
 * 
 * ⚠️ CRITICAL FILE — DO NOT MODIFY WITHOUT READING THIS HEADER
 * 
 * File này là router chính. Logic nghiệp vụ nằm trong _handlers/.
 * Khi sửa logic:
 *   - GET (fetch booking)        → sửa _handlers/handleGetBooking.ts
 *   - START_TIMER / NEXT_SEGMENT → sửa _handlers/handleStartTimer.ts
 *   - CLEANING / FEEDBACK / DONE → sửa _handlers/handleFinishService.ts
 *   - RELEASE_KTV               → sửa _handlers/handleReleaseKTV.ts
 * 
 * 🚫 TUYỆT ĐỐI KHÔNG:
 *   1. Inline logic nghiệp vụ vào file này
 *   2. Re-add Parallel Sync (KTV phải độc lập)
 *   3. Sửa đồng thời nhiều handler trong 1 commit
 * 
 * 📋 ORCHESTRATOR RESPONSIBILITIES:
 *   - Parse request (params, body)
 *   - Query shared state (turnForSync, allItemIdsForThisKTV)
 *   - Route đến đúng handler dựa trên action/status
 *   - Apply bookingUpdatePayload trả về từ handler
 *   - Return response
 * 
 * 📚 Context: Xem plans/plan_tach_dispatch_flow.md
 * ============================================================
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { KtvBookingPatchSchema } from '@/lib/schemas/ktv.schema';
import { getBusinessDate, HandlerContext, HandlerResult } from './_shared/utils';
import { handleGetBooking } from './_handlers/handleGetBooking';
import { handleStartTimer } from './_handlers/handleStartTimer';
import { handleFinishService } from './_handlers/handleFinishService';
import { handleReleaseKTV } from './_handlers/handleReleaseKTV';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ktv/booking?techCode=NH001
 * Delegates entirely to handleGetBooking
 */
export async function GET(request: Request) {
    return handleGetBooking(request);
}

/**
 * PATCH /api/ktv/booking
 * Orchestrator: parse → shared state → route handler → apply update → respond
 */
export async function PATCH(request: Request) {
    try {
        // ─── 1. PARSE REQUEST ───
        const { searchParams } = new URL(request.url);
        const techCodeFromQuery = searchParams.get('techCode');
        const body = await request.json();
        const parseResult = KtvBookingPatchSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
        }
        const { bookingId, status: rawStatus, action, techCode: techCodeFromBody } = parseResult.data;
        
        let status = rawStatus;
        const technicianCode = techCodeFromQuery || techCodeFromBody || '';

        if (status === 'COMPLETED') status = 'CLEANING';

        // ─── 2. QUERY SHARED STATE ───
        const supabase = getSupabaseAdmin();
        if (!supabase) throw new Error('Supabase admin not initialized');

        const today = getBusinessDate();
        const { data: turnForSync } = await supabase
            .from('TurnQueue')
            .select('id, booking_item_id, booking_item_ids, last_served_at, start_time, turns_completed, status, room_id')
            .eq('employee_id', technicianCode)
            .eq('date', today)
            .eq('current_order_id', bookingId)
            .maybeSingle();

        const updatePayload: any = { updatedAt: new Date().toISOString() };
        
        let targetBookingItemId = turnForSync?.booking_item_id;
        let allItemIdsForThisKTV: string[] = [];

        if (technicianCode) {
            const { data: ktvItems } = await supabase.from('BookingItems').select('id, "technicianCodes"').eq('bookingId', bookingId);
            allItemIdsForThisKTV = (ktvItems || []).filter((item: any) => Array.isArray(item.technicianCodes) && item.technicianCodes.includes(technicianCode)).map((item: any) => item.id);
        }

        if (allItemIdsForThisKTV.length === 0 && targetBookingItemId) allItemIdsForThisKTV = [targetBookingItemId];

        // ─── 3. BUILD HANDLER CONTEXT ───
        const ctx: HandlerContext = {
            supabase, bookingId, technicianCode, today,
            action: action || '',
            status,
            turnForSync,
            allItemIdsForThisKTV,
            body
        };

        // ─── 4. ROUTE TO HANDLER ───
        let result: HandlerResult = { bookingUpdatePayload: {} };

        if (status === 'IN_PROGRESS' || action === 'NEXT_SEGMENT_PREPARE') {
            result = await handleStartTimer(ctx);
        } else if (status === 'CLEANING' || status === 'DONE' || status === 'FEEDBACK') {
            result = await handleFinishService(ctx);
        }

        // ─── 5. CHECK EARLY RESPONSE ───
        if (result.earlyResponse) return result.earlyResponse;

        // ─── 6. MERGE & APPLY BOOKING UPDATE ───
        Object.assign(updatePayload, result.bookingUpdatePayload);

        let data = null;
        if (Object.keys(updatePayload).length > 0) {
            const res = await supabase.from('Bookings').update(updatePayload).eq('id', bookingId).select().maybeSingle();
            data = res.data;
        } else {
            const res = await supabase.from('Bookings').select().eq('id', bookingId).maybeSingle();
            data = res.data;
        }

        // ─── 7. RELEASE_KTV (runs after booking update, independent) ───
        if (action === 'RELEASE_KTV' && technicianCode) {
            await handleReleaseKTV(ctx);
        }

        // Removed destructive syncOrderTimelineToDb

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error('❌ [KTV API] PATCH error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
