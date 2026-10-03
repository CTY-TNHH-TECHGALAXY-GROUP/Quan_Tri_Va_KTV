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
import { toBusinessDate, getDayCutoffHours, DEFAULT_DAY_CUTOFF_HOURS } from '@/lib/business-date';
// Re-export từ lib/ktvUtils (client-safe) để API handlers dùng cùng logic
export { ktvMatchesSeg } from '@/lib/ktvUtils';


/**
 * Ngày làm việc hiện tại.
 *
 * ⚠️ Trước đây hàm này tự tính với mốc 6h VIẾT CỨNG, trong khi phần còn lại của
 * hệ thống đọc `spa_day_cutoff_hours`. Đổi cấu hình thì điều phối không đi theo.
 * Nay chỉ còn một công thức duy nhất ở `lib/business-date.ts`.
 *
 * Nơi nào có `supabase` thì dùng `getBusinessDateFromConfig` để lấy đúng mốc
 * đang cấu hình; bản đồng bộ này chỉ dùng mốc mặc định.
 */
export function getBusinessDate(cutoffHours: number = DEFAULT_DAY_CUTOFF_HOURS): string {
    return toBusinessDate(new Date(), cutoffHours);
}

/** Ngày làm việc hiện tại theo mốc cắt đang cấu hình. */
export async function getBusinessDateFromConfig(supabase: any): Promise<string> {
    return getBusinessDate(await getDayCutoffHours(supabase));
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
