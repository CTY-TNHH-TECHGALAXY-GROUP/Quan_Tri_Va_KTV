import { SupabaseClient } from '@supabase/supabase-js';
import { applyArrivalToTurnQueue } from '@/lib/services/TurnQueueRowService';

// 🔧 CONFIGURATION
const MAX_TRAVEL_MINUTES = 60;
const MIN_TRAVEL_MINUTES = 5;
const EXPIRED_BUFFER_MINUTES = 0;

export class KtvTypeDOnlineService {

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

        if (travelMinutes < MIN_TRAVEL_MINUTES || travelMinutes > MAX_TRAVEL_MINUTES) {
            return { success: false, error: `Thời gian di chuyển phải từ ${MIN_TRAVEL_MINUTES} đến ${MAX_TRAVEL_MINUTES} phút.` };
        }

        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!timeRegex.test(availableFrom) || !timeRegex.test(availableUntil)) {
            return { success: false, error: 'Định dạng giờ không hợp lệ. Sử dụng HH:mm.' };
        }

        try {
            const { data: staff, error: fetchErr } = await supabase
                .from('Staff')
                .select('work_type, feature_flags')
                .eq('id', staffId)
                .single();

            if (fetchErr || !staff) {
                return { success: false, error: 'Không tìm thấy nhân viên hợp lệ.' };
            }

            if (staff.work_type !== 'TYPE_D' || staff.feature_flags?.allow_on_call !== true) {
                return { success: false, error: 'Lỗ hổng bảo mật: KTV này chưa được cấp quyền nhận đơn ngoài giờ!' };
            }

            const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
            const { data: configCutoff } = await supabase.from('SystemConfigs').select('value').eq('key', 'spa_day_cutoff_hours').maybeSingle();
            const cutoffHours = (configCutoff?.value != null) ? Number(configCutoff.value) : 6;
            const businessNow = new Date(vnNow.getTime() - cutoffHours * 60 * 60 * 1000);
            const businessDateStr = businessNow.toISOString().slice(0, 10);

            // Registered OFF but wants to earn extra → allowed (business rule, 14/09/2026).
            // Turning on-call does NOT touch KTVTypeDDailyRegistration: the day stays
            // OFF_REGISTERED, so the absence cron neither penalises nor locks someone who
            // turned it on and never came. Only "Oria Xin chào" (attendance route) flips
            // OFF_REGISTERED -> REGISTERED. See plans/plan_ngay_off_bat_nhan_don_truoc.md.

            const { error } = await supabase
                .from('Staff')
                .update({
                    online_status: 'ONLINE',
                    travel_minutes: travelMinutes,
                    available_from: availableFrom,
                    available_until: availableUntil,
                })
                .eq('id', staffId);

            if (error) {
                console.error('KtvTypeDOnlineService.goOnline - Update failed:', error.message, error.code);
                return { success: false, error: 'Không thể cập nhật trạng thái. Vui lòng thử lại.' };
            }

            return { success: true };
        } catch (e: any) {
            console.error('KtvTypeDOnlineService.goOnline - Exception:', e);
            return { success: false, error: e.message };
        }
    }

    static async goOffline(
        supabase: SupabaseClient,
        staffId: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
            const { data: configCutoff } = await supabase.from('SystemConfigs').select('value').eq('key', 'spa_day_cutoff_hours').maybeSingle();
            const cutoffHours = (configCutoff?.value != null) ? Number(configCutoff.value) : 6;
            const businessNow = new Date(vnNow.getTime() - cutoffHours * 60 * 60 * 1000);
            const businessDateStr = businessNow.toISOString().slice(0, 10);

            // 1. Lấy thông tin user
            const { data: user, error: userError } = await supabase.from('Users').select('id').eq('code', staffId).maybeSingle();
            if (userError) {
                return { success: false, error: 'Database error fetching user: ' + userError.message };
            }
            if (!user) {
                console.error(`User mapping not found for staffId ${staffId} in goOffline`);
                return { success: false, error: 'User mapping not found for staff: ' + staffId };
            }

            // 2. Tắt TurnQueue
            await supabase
                .from('TurnQueue')
                .update({ status: 'off' })
                .eq('employee_id', staffId)
                .eq('date', businessDateStr);

            // 3. Đóng KTVShifts
            const { error: shiftError } = await supabase.from('KTVShifts')
                .update({ 
                    status: 'REPLACED'
                })
                .eq('employeeId', user.id)
                .eq('effectiveFrom', businessDateStr)
                .eq('reason', 'KTV Loại D tới tiệm')
                .eq('status', 'ACTIVE');
            
            if (shiftError) {
                console.error('[KtvTypeDOnlineService.goOffline] KTVShifts update failed:', shiftError.message, shiftError.code);
                return { success: false, error: 'Không thể đóng ca KTVShifts.' };
            }
            
            await supabase.from('Users').update({ isOnShift: false }).eq('id', user.id);

            // 4. Update Staff (Ghi nhận trạng thái là hành động cuối)
            const { error: staffError } = await supabase
                .from('Staff')
                .update({
                    online_status: 'OFFLINE',
                    travel_minutes: 0,
                    available_from: null,
                    available_until: null,
                })
                .eq('id', staffId);

            if (staffError) {
                console.error('KtvTypeDOnlineService.goOffline - Staff Update failed:', staffError.message, staffError.code);
                return { success: false, error: 'Không thể cập nhật trạng thái Staff.' };
            }

            return { success: true };
        } catch (e: any) {
            console.error('KtvTypeDOnlineService.goOffline - Exception:', e);
            return { success: false, error: e.message };
        }
    }

    static async arriveAtVenue(
        supabase: SupabaseClient,
        staffId: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const { data: staffData } = await supabase.from('Staff').select('id, full_name').eq('id', staffId).single();
            if (!staffData) return { success: false, error: 'Staff not found' };

            const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
            const { data: configCutoff } = await supabase.from('SystemConfigs').select('value').eq('key', 'spa_day_cutoff_hours').maybeSingle();
            const cutoffHours = (configCutoff?.value != null) ? Number(configCutoff.value) : 6;
            const businessNow = new Date(vnNow.getTime() - cutoffHours * 60 * 60 * 1000);
            const businessDateStr = businessNow.toISOString().slice(0, 10);

            // 1. Lấy user
            const { data: user, error: userError } = await supabase.from('Users').select('id, fullName').eq('code', staffId).maybeSingle();
            if (userError) {
                return { success: false, error: 'Database error fetching user: ' + userError.message };
            }
            if (!user) {
                console.error(`User mapping not found for staffId ${staffId} in arriveAtVenue`);
                return { success: false, error: 'User mapping not found for staff: ' + staffId };
            }

            // 2. Mở KTVShifts
            const { error: oldShiftError } = await supabase.from('KTVShifts')
                .update({ status: 'REPLACED' })
                .eq('employeeId', user.id)
                .eq('effectiveFrom', businessDateStr)
                .eq('reason', 'KTV Loại D tới tiệm')
                .eq('status', 'ACTIVE');
            
            if (oldShiftError) {
                console.error('[KtvTypeDOnlineService.arriveAtVenue] KTVShifts update old shift failed:', oldShiftError.message, oldShiftError.code);
            }

            const { error: newShiftError } = await supabase.from('KTVShifts').insert({
                employeeId: user.id,
                employeeName: user.fullName || staffData.full_name,
                shiftType: 'FREE', // TYPE_D dùng FREE
                effectiveFrom: businessDateStr,
                reason: 'KTV Loại D tới tiệm',
                status: 'ACTIVE',
                reviewedBy: 'SYSTEM',
                reviewedAt: new Date().toISOString()
            });

            if (newShiftError) {
                console.error('[KtvTypeDOnlineService.arriveAtVenue] KTVShifts insert failed:', newShiftError.message, newShiftError.code);
                return { success: false, error: 'Không thể tạo ca KTVShifts.' };
            }
            
            await supabase.from('Users').update({ isOnShift: true }).eq('id', user.id);

            // 3. Lên tua. ⚠️ Trước 14/09/2026 dòng đã có bị đặt `waiting` vô điều kiện —
            // KTV D được quầy phân đơn khi chưa điểm danh rồi mới bấm Oria xin chào là
            // đơn đang làm bị ghi đè. Nay dòng đang bận giữ nguyên; D giữ chỗ cũ trong hàng.
            await applyArrivalToTurnQueue(supabase, { staffId, businessDate: businessDateStr, moveToEndWhenIdle: false });

            // 4. Ghi check_in_at vào KTVTypeDDailyRegistration (phụ)
            try {
                const { vnToday } = await import('@/lib/vn-time');
                const todayStr = vnToday();
                const { data: currentReg } = await supabase.from('KTVTypeDDailyRegistration').select('check_in_at').eq('staff_id', staffId).eq('work_date', todayStr).maybeSingle();
                if (currentReg && !currentReg.check_in_at) {
                    await supabase.from('KTVTypeDDailyRegistration')
                        .update({ check_in_at: vnNow.toISOString() })
                        .eq('staff_id', staffId)
                        .eq('work_date', todayStr);
                }
            } catch (err) {
                console.error('KtvTypeDOnlineService.arriveAtVenue - Lỗi ghi check_in_at (phụ, bỏ qua):', err);
            }

            // 5. Update Staff (Hành động chốt cuối cùng)
            const { error: staffError } = await supabase
                .from('Staff')
                .update({ online_status: 'AT_VENUE' })
                .eq('id', staffId);

            if (staffError) return { success: false, error: staffError.message };

            return { success: true };
        } catch (e: any) {
            console.error('KtvTypeDOnlineService.arriveAtVenue - Exception:', e);
            return { success: false, error: e.message };
        }
    }
}
