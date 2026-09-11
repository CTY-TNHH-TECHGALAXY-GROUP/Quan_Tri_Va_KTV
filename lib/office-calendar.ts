/**
 * Lịch chọn "Ngày vi phạm" trên sheet trừ điểm Office — ngày nào BẤM ĐƯỢC, vì sao.
 *
 * Trước đây sheet dùng ô chọn ngày của trình duyệt: lịch trắng trơn, ngày nào cũng
 * bấm được như nhau. Admin chọn trúng một ngày KTV nghỉ, tích lỗi xong mới thấy
 * khung đỏ "không trừ điểm được". Lịch này làm giống lịch của KTV (ô xanh / đỏ /
 * xám), và KHOÁ SẴN những ngày không chọn được — sai ở đâu thì chặn ngay lúc
 * nhìn, không đợi tới lúc bấm gửi.
 *
 * Hàm thuần, không đụng DB: giao diện và kịch bản kiểm thử gọi CHUNG, để luật
 * trên màn hình không bao giờ lệch với luật trong test.
 */

export type DayTone =
    /** Sau hôm nay — chưa xảy ra thì chưa có gì để trừ. */
    | 'future'
    /** Lễ tân: cũ hơn hôm qua. */
    | 'locked'
    /** KTV không đi làm ngày này (không lịch, không điểm danh). */
    | 'off'
    /** Có đi làm, chưa bị trừ lỗi nào. */
    | 'clean'
    /** Có đi làm, đã có lỗi bị trừ. */
    | 'hit'
    /**
     * Đã có phiếu trừ (ghi TRƯỚC khi có luật "không đi làm thì không trừ") nhưng
     * ngày đó không có chấm công lẫn lịch. Tô ĐỎ như lịch KTV để hai lịch cùng
     * màu cho cùng một ngày, nhưng mờ và khoá — không cho trừ THÊM.
     */
    | 'hitOff';

export interface DayPick {
    pickable: boolean;
    tone: DayTone;
    /** Vì sao không bấm được — hiện khi rê chuột / nhấn giữ. null khi bấm được. */
    why: string | null;
}

/** 'YYYY-MM-DD' lùi/tiến `days` ngày. */
export function shiftIsoDay(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * Thứ tự xét quan trọng: tương lai → ngoài quyền → không đi làm → có/không lỗi.
 * Một ngày vừa ở tương lai vừa không có lịch thì lý do đúng là "tương lai".
 */
export function dayPickState(args: {
    date: string;
    /** Ngày làm việc hôm nay (mốc cắt 06:00) — do server trả về. */
    today: string;
    /** Quản lý chọn được mọi ngày cũ; lễ tân chỉ hôm nay + hôm qua. */
    canPickOld: boolean;
    /** Có bằng chứng đi làm (điểm danh HOẶC có lịch làm). */
    canDeduct: boolean;
    /** Số lỗi đã bị trừ trong ngày. */
    hitCount: number;
}): DayPick {
    const { date, today, canPickOld, canDeduct, hitCount } = args;

    if (date > today) {
        return { pickable: false, tone: 'future', why: 'Ngày ở tương lai' };
    }
    if (!canPickOld && date < shiftIsoDay(today, -1)) {
        return { pickable: false, tone: 'locked', why: 'Lễ tân chỉ trừ được hôm nay và hôm qua' };
    }
    if (!canDeduct) {
        return hitCount > 0
            ? { pickable: false, tone: 'hitOff', why: 'Ngày này đã có phiếu trừ từ trước, nhưng KTV không có lịch lẫn điểm danh — không trừ thêm được' }
            : { pickable: false, tone: 'off', why: 'KTV không đi làm ngày này — không lịch, không điểm danh' };
    }
    return { pickable: true, tone: hitCount > 0 ? 'hit' : 'clean', why: null };
}
