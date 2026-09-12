/**
 * ============================================================
 * 🔧 KTV BOOKING API — SHARED UTILITIES
 * ============================================================
 * 
 * Shared types and utility functions used by all handlers.
 * 
 * ⚠️ Khi thêm field mới vào HandlerContext:
 *   - Phải update orchestrator (route.ts) để query/populate field đó
 *   - Phải update TẤT CẢ handlers nếu field là required
 * ============================================================
 */

import { NextResponse } from 'next/server';
// Re-export từ lib/ktvUtils (client-safe) để API handlers dùng cùng logic
export { ktvMatchesSeg } from '@/lib/ktvUtils';


/**
 * Get business date in Vietnam timezone (VN = UTC+7).
 * Business day changes at 6:00 AM VN time.
 * Before 6 AM → still counts as previous day.
 */
export function getBusinessDate(): string {
    const nowUtc = new Date();
    const vnOffsetMs = 7 * 60 * 60 * 1000;
    const vnTime = new Date(nowUtc.getTime() + vnOffsetMs);
    
    if (vnTime.getUTCHours() < 6) {
        vnTime.setUTCDate(vnTime.getUTCDate() - 1);
    }
    return vnTime.toISOString().split('T')[0];
}

export interface TurnQueueRow {
    id: string;
    booking_item_id: string | null;
    booking_item_ids: string[] | null;
    last_served_at: string | null;
    start_time: string | null;
    turns_completed: number | null;
    status: string | null;
    room_id: string | null;
}

export interface HandlerContext {
    supabase: any; // SupabaseClient — using any to avoid import complexity
    bookingId: string;
    technicianCode: string;
    today: string;                      // business date (YYYY-MM-DD)
    action: string;                     // 'START_TIMER' | 'NEXT_SEGMENT' | 'RELEASE_KTV' | ...
    status: string;                     // normalized status ('CLEANING', not 'COMPLETED')
    turnForSync: TurnQueueRow | null;   // shared TurnQueue data
    allItemIdsForThisKTV: string[];     // all BookingItem IDs assigned to this KTV
    body: Record<string, any>;          // raw request body (for activeSegmentIndex, etc.)
}

export interface HandlerResult {
    bookingUpdatePayload: Record<string, any>;  // → merge vào Bookings.update()
    earlyResponse?: NextResponse;               // → 403/400 response (bypass normal flow)
    // NOTE: Handlers tự xử lý BookingItems/TurnQueue/KtvAssignments DB ops bên trong
    // Chỉ trả bookingUpdatePayload cho orchestrator apply vào Bookings table
}
