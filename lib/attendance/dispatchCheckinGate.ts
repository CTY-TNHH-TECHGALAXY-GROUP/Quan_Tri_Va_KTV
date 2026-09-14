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
 */
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
