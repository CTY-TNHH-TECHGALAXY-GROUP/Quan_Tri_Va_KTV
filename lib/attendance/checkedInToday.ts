import type { SupabaseClient } from '@supabase/supabase-js';
import { businessDayRange, getDayCutoffHours } from '@/lib/business-date';

/**
 * "Đã điểm danh hôm nay" — MỘT nguồn duy nhất cho cổng điều phối
 * (`processDispatch`), ô chọn KTV (`getDispatchData`) và Sổ tua (`/api/turns`).
 *
 * Đọc `KTVAttendance` (CHECK_IN / LATE_CHECKIN, CONFIRMED) trong khoảng NGÀY LÀM
 * VIỆC — bản ghi duy nhất sinh ra đúng lúc KTV bấm "Oria xin chào". Các nguồn
 * khác đều sai ở ít nhất một luồng (khảo sát 14/09/2026):
 *   · `TurnQueue.check_in_order` — quầy bật tay, "Lưu thứ tự", RPC điều phối đều ghi;
 *   · `Staff.online_status`, `Users.isOnShift` — không reset theo ngày;
 *   · `DailyAttendance` — chỉ màn KTV Hub ghi, theo ngày UTC.
 *
 * `KTVAttendance.employeeId` là `Users.id`. Tài khoản mới có `Users.id = Users.code
 * = Staff.id`, tài khoản cũ có thể lệch → map qua `Users.code`.
 *
 * Lỗi truy vấn → trả tập rỗng (coi như chưa ai điểm danh): quầy bị hỏi xác nhận
 * thừa, chứ không bao giờ lọt người chưa điểm danh.
 */
export async function checkedInStaffIds(
    supabase: SupabaseClient,
    staffIds: string[],
    businessDate: string
): Promise<Set<string>> {
    const ids = Array.from(new Set(staffIds.filter(Boolean)));
    if (ids.length === 0 || !businessDate) return new Set();

    try {
        const cutoffHours = await getDayCutoffHours(supabase);
        const { startIso, endIso } = businessDayRange(businessDate, cutoffHours);

        const { data: users } = await supabase.from('Users').select('id, code').in('code', ids);
        const staffIdByUserId = new Map<string, string>();
        ids.forEach(id => staffIdByUserId.set(id, id));
        (users || []).forEach((u: any) => {
            if (u?.id && u?.code) staffIdByUserId.set(String(u.id), String(u.code));
        });

        const { data: rows, error } = await supabase
            .from('KTVAttendance')
            .select('employeeId')
            .in('employeeId', Array.from(staffIdByUserId.keys()))
            .in('checkType', ['CHECK_IN', 'LATE_CHECKIN'])
            .eq('status', 'CONFIRMED')
            .gte('checkedAt', startIso)
            .lt('checkedAt', endIso);
        if (error) throw error;

        const result = new Set<string>();
        (rows || []).forEach((r: any) => {
            const staffId = staffIdByUserId.get(String(r.employeeId));
            if (staffId) result.add(staffId);
        });
        return result;
    } catch (err: any) {
        console.error('[checkedInStaffIds] không đọc được điểm danh:', err?.message || err);
        return new Set();
    }
}
