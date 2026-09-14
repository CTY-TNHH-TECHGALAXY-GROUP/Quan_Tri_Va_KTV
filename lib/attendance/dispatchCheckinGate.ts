/**
 * Luật cổng điểm danh khi quầy gửi đơn (chốt 14/09/2026) — hàm THUẦN, không đụng
 * DB, để mô phỏng được mọi ca. Dùng ở `processDispatch`.
 *
 * Quầy được phân đơn cho KTV chưa điểm danh nếu bấm OK ở popup. Mỗi lần gửi đơn
 * đều hỏi lại cho tới khi KTV bấm "Oria xin chào": xác nhận chỉ sống trong đúng
 * một lần gửi (`confirmedIds`), không lưu ở đâu.
 *
 *   · Dòng TurnQueue hôm đó đang `off` (tắt nhận đơn / tan ca / quầy gạt tắt)
 *     → TURNED_OFF, kể cả khi đã điểm danh.
 *   · Chưa có bản ghi điểm danh hôm nay → NOT_CHECKED_IN.
 *   · KTV ngoài KHÔNG tài khoản (mã EXT_/C_) → không bao giờ hỏi: họ không có app
 *     để bấm Oria xin chào (chốt 15/09/2026). Loại C có tài khoản thật vẫn bị hỏi.
 */
import { isPlaceholderStaffId } from '@/lib/constants/staff.constants';

export type CheckinGateReason = 'NOT_CHECKED_IN' | 'TURNED_OFF';

export interface CheckinGateKtv {
    id: string;
    name: string;
    workType: string | null;
    reason: CheckinGateReason;
}

export const findKtvsNeedingCheckinConfirm = (input: {
    ktvIds: string[];
    staffById: Map<string, { full_name?: string | null; work_type?: string | null }>;
    checkedInIds: Set<string>;
    turnStatusById: Map<string, string>;
    confirmedIds?: string[] | null;
}): CheckinGateKtv[] => {
    const confirmed = new Set((input.confirmedIds || []).map(id => String(id).toUpperCase()));
    const result: CheckinGateKtv[] = [];

    for (const id of Array.from(new Set(input.ktvIds.filter(Boolean)))) {
        if (confirmed.has(String(id).toUpperCase())) continue;
        if (isPlaceholderStaffId(id)) continue;

        const reason: CheckinGateReason | null =
            input.turnStatusById.get(id) === 'off' ? 'TURNED_OFF'
            : !input.checkedInIds.has(id) ? 'NOT_CHECKED_IN'
            : null;
        if (!reason) continue;

        const staff = input.staffById.get(id);
        result.push({ id, name: staff?.full_name || id, workType: staff?.work_type ?? null, reason });
    }
    return result;
};

/**
 * Ô chọn KTV ở điều phối hiện ai (chốt 14/09/2026, sau khi thấy tua ảo on-call chưa
 * điểm danh lọt đầy danh sách):
 *   · đã điểm danh hôm nay → hiện;
 *   · chưa điểm danh nhưng hôm nay ĐÃ được phân đơn (đang được phân / đang làm / đã
 *     có tua) → hiện, kèm nhãn "Chưa điểm danh";
 *   · còn lại (tua ảo on-call, quầy bật tay ở Sổ tua mà chưa làm đơn nào) → ẨN.
 * Người bị ẩn vẫn chọn được bằng cách gõ ĐÚNG mã/tên; server hỏi xác nhận khi gửi.
 * `checked_in_today` chưa có (dòng mới vừa vào qua realtime) → hiện, tránh giấu nhầm.
 */
export const isVisibleInKtvPicker = (turn: {
    status?: string | null;
    checked_in_today?: boolean;
    turns_completed?: number | null;
}): boolean =>
    turn.status !== 'off' && (
        turn.checked_in_today !== false
        || turn.status === 'assigned'
        || turn.status === 'working'
        || (Number(turn.turns_completed) || 0) > 0
    );
