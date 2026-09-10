import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ================================================================
 * "Ngày đó KTV có đi làm không?" — cửa vào của việc trừ điểm Office
 * ================================================================
 * Không đi làm thì không có gì để chấm. Trừ điểm một ngày KTV nghỉ là trừ oan,
 * và nó còn kéo theo hai hậu quả âm thầm:
 *
 *   · `buildMonth` lấy `attendedDates ∪ ngày-có-phiếu` làm mẫu số điểm tháng,
 *     nên một phiếu trừ nhầm ngày nghỉ sẽ ĐẺ THÊM một "ngày đi làm" không có
 *     thật, kéo trung bình tháng xuống;
 *   · điểm tháng quyết định mức quỹ nội bộ phải đóng, nên sai ở đây là sai tiền.
 *
 * HAI NGUỒN BẰNG CHỨNG, XÉT CÙNG LÚC
 *
 * Không đủ nếu chỉ nhìn một cái:
 *
 *   · Chỉ nhìn LỊCH ĐĂNG KÝ → bỏ sót người đăng ký OFF nhưng hôm đó vẫn vào
 *     làm. Họ có đi làm thật, vi phạm thật, mà hệ thống lại không cho trừ.
 *   · Chỉ nhìn CHẤM CÔNG → bỏ sót người có lịch làm mà không tới. Chính sự
 *     vắng mặt đó là lỗi cần trừ (T4 "Chuyên cần", T1 "Bật app đúng giờ"),
 *     nhưng họ chưa hề điểm danh nên không có dòng chấm công nào.
 *
 * Nên quy tắc là HOẶC: có bằng chứng ĐÃ LÀM (điểm danh) **hoặc** CÓ LỊCH LÀM
 * thì được trừ. Chặn đúng trường hợp cả hai đều không: nghỉ có đăng ký và
 * cũng không tới — ngày đó họ không thuộc về ca nào cả.
 */

export interface WorkdayEvidence {
    /** Có dòng chấm công CHECK_IN / LATE_CHECKIN trong ngày. */
    attended: boolean;
    /** Có đăng ký ĐI LÀM (đăng ký tồn tại và không phải OFF_REGISTERED). */
    scheduled: boolean;
    /** Đã đăng ký NGHỈ cho ngày này. */
    registeredOff: boolean;
    /** Bảng đăng ký cũng ghi nhận mốc điểm danh — một bằng chứng đã làm nữa. */
    regCheckedIn: boolean;
    /** Có bằng chứng ĐÃ đi làm (điểm danh ở một trong hai bảng). */
    worked: boolean;
    /** Được phép trừ điểm cho ngày này không. */
    canDeduct: boolean;
    /** Vì sao không được — null khi được phép. */
    reason: string | null;
}

export async function workdayEvidence(
    supabase: SupabaseClient,
    staffId: string,
    workDate: string,
): Promise<WorkdayEvidence> {
    const [attRes, regRes] = await Promise.all([
        supabase
            .from('KTVAttendance')
            .select('id')
            .eq('employeeId', staffId)
            .eq('date', workDate)
            .in('checkType', ['CHECK_IN', 'LATE_CHECKIN'])
            .limit(1),
        supabase
            .from('KTVTypeDDailyRegistration')
            .select('status, check_in_at')
            .eq('staff_id', staffId)
            .eq('work_date', workDate)
            .maybeSingle(),
    ]);

    const attended = (attRes.data || []).length > 0;
    const reg = regRes.data as any;
    const registeredOff = reg?.status === 'OFF_REGISTERED';
    const scheduled = !!reg && !registeredOff;
    const regCheckedIn = !!reg?.check_in_at;

    const worked = attended || regCheckedIn;
    const canDeduct = worked || scheduled;

    return {
        attended, scheduled, registeredOff, regCheckedIn, worked, canDeduct,
        reason: canDeduct ? null : reasonFor(registeredOff),
    };
}

function reasonFor(registeredOff: boolean): string {
    return registeredOff
        ? 'Ngày này KTV đã đăng ký NGHỈ và không có điểm danh — không đi làm thì không trừ điểm được. Nếu thực tế họ vẫn vào làm, hãy cho điểm danh trước rồi chấm lại.'
        : 'Ngày này KTV không có lịch làm và cũng không điểm danh — không đi làm thì không trừ điểm được. Nếu thực tế họ vẫn vào làm, hãy cho điểm danh trước rồi chấm lại.';
}

/** Câu ngắn mô tả bằng chứng, để hiện trên sheet chấm điểm. */
export function evidenceLabel(e: WorkdayEvidence): string {
    if (e.attended && e.registeredOff) return 'Đăng ký nghỉ nhưng CÓ điểm danh — vẫn đi làm.';
    if (e.attended) return 'Đã điểm danh ngày này.';
    if (e.regCheckedIn) return 'Bảng đăng ký ghi nhận đã điểm danh.';
    if (e.scheduled) return 'Có lịch làm nhưng chưa điểm danh.';
    if (e.registeredOff) return 'Đã đăng ký nghỉ, không có điểm danh.';
    return 'Không có lịch làm, không có điểm danh.';
}
