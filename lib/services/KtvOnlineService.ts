import { SupabaseClient } from '@supabase/supabase-js';

// 🔧 CONFIGURATION
const MAX_TRAVEL_MINUTES = 60;
const MIN_TRAVEL_MINUTES = 5;
const EXPIRED_BUFFER_MINUTES = 60; // Cleanup only if expired > 1 hour

/**
 * KtvOnlineService
 * ─────────────────
 * Manages Online/Offline status for Type B (on-call) KTVs.
 * 
 * LAZY EVALUATION: The dispatch board filters out expired KTVs at query time.
 *   + checkAndAutoOffline() cleans DB when KTV opens their app.
 * CRON CLEANUP: Runs at shift change times to clean zombie records in DB.
 * 
 * DO NOT call this service from KTV Dashboard logic (KTVDashboard.logic.ts).
 * This service is strictly for API route consumption.
 */
export class KtvOnlineService {

    /**
     * KTV Type B registers as available to receive bookings from home.
     * Sets online_status = 'ONLINE', stores travel time and availability window.
     */
    static async goOnline(
        supabase: SupabaseClient,
        input: {
            staffId: string;
            travelMinutes: number;
            availableFrom: string;
            availableUntil: string;
        }
    ): Promise<{ success: boolean; error?: string }> {
        const { staffId, travelMinutes, availableFrom, availableUntil } = input;

        // Validate travel time range
        if (travelMinutes < MIN_TRAVEL_MINUTES || travelMinutes > MAX_TRAVEL_MINUTES) {
            return { success: false, error: `Thời gian di chuyển phải từ ${MIN_TRAVEL_MINUTES} đến ${MAX_TRAVEL_MINUTES} phút.` };
        }

        // Validate time format (HH:mm)
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!timeRegex.test(availableFrom) || !timeRegex.test(availableUntil)) {
            return { success: false, error: 'Định dạng giờ không hợp lệ. Sử dụng HH:mm.' };
        }

        try {
            const { error } = await supabase
                .from('Staff')
                .update({
                    online_status: 'ONLINE',
                    travel_minutes: travelMinutes,
                    available_from: availableFrom,
                    available_until: availableUntil,
                })
                .eq('id', staffId)
                .eq('work_type', 'TYPE_B');

            if (error) {
                console.error('KtvOnlineService.goOnline - Update failed:', error.message, error.code);
                return { success: false, error: 'Không thể cập nhật trạng thái. Vui lòng thử lại.' };
            }

            return { success: true };
        } catch (e: any) {
            console.error('KtvOnlineService.goOnline - Exception:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * KTV Type B confirms arrival at the venue.
     * Sets online_status = 'AT_VENUE', resets travel_minutes to 0.
     */
    static async arriveAtVenue(
        supabase: SupabaseClient,
        staffId: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const { data: staff } = await supabase
                .from('Staff')
                .select('id, online_status')
                .eq('id', staffId)
                .single();

            if (!staff) {
                return { success: false, error: 'Không tìm thấy nhân viên.' };
            }

            if (staff.online_status !== 'ONLINE') {
                return { success: false, error: 'Bạn chưa đăng ký nhận đơn. Vui lòng bấm "Bắt đầu nhận đơn" trước.' };
            }

            const { error } = await supabase
                .from('Staff')
                .update({
                    online_status: 'AT_VENUE',
                    travel_minutes: 0,
                })
                .eq('id', staffId)
                .eq('work_type', 'TYPE_B');

            if (error) {
                console.error('KtvOnlineService.arriveAtVenue - Update failed:', error.message, error.code);
                return { success: false, error: 'Không thể cập nhật trạng thái.' };
            }

            return { success: true };
        } catch (e: any) {
            console.error('KtvOnlineService.arriveAtVenue - Exception:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * KTV Type B manually goes offline.
     * Sets online_status = 'OFFLINE', clears availability window.
     */
    static async goOffline(
        supabase: SupabaseClient,
        staffId: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const { error } = await supabase
                .from('Staff')
                .update({
                    online_status: 'OFFLINE',
                    travel_minutes: 0,
                    available_from: null,
                    available_until: null,
                })
                .eq('id', staffId);

            if (error) {
                console.error('KtvOnlineService.goOffline - Update failed:', error.message, error.code);
                return { success: false, error: 'Không thể cập nhật trạng thái.' };
            }

            return { success: true };
        } catch (e: any) {
            console.error('KtvOnlineService.goOffline - Exception:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * LAZY EVALUATION: Check and auto-offline a single KTV.
     * Called when KTV opens their dashboard — if past available_until, auto set OFFLINE.
     * Returns true if the KTV was auto-offlined.
     */
    static async checkAndAutoOffline(
        supabase: SupabaseClient,
        staffId: string
    ): Promise<boolean> {
        try {
            const { data: staff } = await supabase
                .from('Staff')
                .select('id, online_status, available_until')
                .eq('id', staffId)
                .single();

            if (!staff || staff.online_status === 'OFFLINE') return false;
            if (!staff.available_until) return false;

            if (this.isTimeExpired(staff.available_until, 0)) {
                await this.goOffline(supabase, staffId);
                return true;
            }

            return false;
        } catch (e: any) {
            console.error('KtvOnlineService.checkAndAutoOffline - Exception:', e);
            return false;
        }
    }

    /**
     * CRON CLEANUP: Batch cleanup all expired online KTVs.
     * Called by Vercel Cron at shift-change times:
     * 09:00, 11:00, 15:00, 17:00, 19:00, 21:00, 00:00 VN time.
     * 
     * Only cleans KTVs whose available_until has passed by at least 1 hour,
     * AND who don't have an active booking (working/assigned in TurnQueue).
     */
    static async cleanupExpiredOnline(
        supabase: SupabaseClient
    ): Promise<{ success: boolean; offlinedCount: number; offlinedIds: string[]; error?: string }> {
        try {
            // 1. Find all online/at_venue KTVs (Type B only)
            const { data: onlineStaff, error: fetchErr } = await supabase
                .from('Staff')
                .select('id, available_until')
                .in('online_status', ['ONLINE', 'AT_VENUE'])
                .eq('work_type', 'TYPE_B');

            if (fetchErr) {
                console.error('KtvOnlineService.cleanupExpiredOnline - Fetch error:', fetchErr.message);
                return { success: false, offlinedCount: 0, offlinedIds: [], error: fetchErr.message };
            }

            if (!onlineStaff || onlineStaff.length === 0) {
                return { success: true, offlinedCount: 0, offlinedIds: [] };
            }

            // 2. Filter expired (with 1 hour buffer)
            const expiredIds: string[] = [];
            for (const staff of onlineStaff) {
                if (!staff.available_until) {
                    // No end time set → zombie → cleanup
                    expiredIds.push(staff.id);
                    continue;
                }

                if (this.isTimeExpired(staff.available_until, EXPIRED_BUFFER_MINUTES)) {
                    expiredIds.push(staff.id);
                }
            }

            if (expiredIds.length === 0) {
                return { success: true, offlinedCount: 0, offlinedIds: [] };
            }

            // 3. Check if any of these KTVs have active turns (working/assigned)
            const { data: activeTurns } = await supabase
                .from('TurnQueue')
                .select('employee_id')
                .in('employee_id', expiredIds)
                .in('status', ['working', 'assigned']);

            const busyIds = new Set((activeTurns || []).map(t => t.employee_id));
            const safeToOfflineIds = expiredIds.filter(id => !busyIds.has(id));

            if (safeToOfflineIds.length === 0) {
                return { success: true, offlinedCount: 0, offlinedIds: [] };
            }

            // 4. Batch update
            const { error: updateErr } = await supabase
                .from('Staff')
                .update({
                    online_status: 'OFFLINE',
                    travel_minutes: 0,
                    available_from: null,
                    available_until: null,
                })
                .in('id', safeToOfflineIds);

            if (updateErr) {
                console.error('KtvOnlineService.cleanupExpiredOnline - Batch update failed:', updateErr.message, updateErr.code);
                return { success: false, offlinedCount: 0, offlinedIds: [], error: updateErr.message };
            }

            console.log(`[CRON] Cleaned up ${safeToOfflineIds.length} expired online KTVs:`, safeToOfflineIds);
            return { success: true, offlinedCount: safeToOfflineIds.length, offlinedIds: safeToOfflineIds };
        } catch (e: any) {
            console.error('KtvOnlineService.cleanupExpiredOnline - Exception:', e);
            return { success: false, offlinedCount: 0, offlinedIds: [], error: e.message };
        }
    }

    // ─── PRIVATE HELPERS ────────────────────────────────────────────

    /**
     * Compare a TIME string (HH:mm or HH:mm:ss) against current VN time.
     * Returns true if the time has expired (now > time + bufferMinutes).
     * Handles cross-midnight correctly (e.g., available_until = 01:00).
     */
    private static isTimeExpired(timeStr: string, bufferMinutes: number): boolean {
        const parts = String(timeStr).split(':').map(Number);
        const h = parts[0];
        const m = parts[1] || 0;
        if (isNaN(h) || isNaN(m)) return false;

        const nowVn = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const nowMinutes = nowVn.getUTCHours() * 60 + nowVn.getUTCMinutes();
        const untilMinutes = h * 60 + m + bufferMinutes;

        // Cross-midnight handling: if until < 06:00, it means early morning (next day)
        const isCrossMidnight = (h * 60 + m) < 360; // before 6:00 AM

        if (isCrossMidnight) {
            // e.g., available_until = 02:00 + buffer 60 = 03:00
            // Expired if now is between 03:00 and 12:00 (noon)
            return nowMinutes >= untilMinutes && nowMinutes < 720;
        }

        return nowMinutes > untilMinutes;
    }
}
