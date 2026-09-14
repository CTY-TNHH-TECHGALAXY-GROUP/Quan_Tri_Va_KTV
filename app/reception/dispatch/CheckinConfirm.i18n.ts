import type { CheckinGateKtv } from '@/lib/attendance/dispatchCheckinGate';

/**
 * Chữ cho luồng phân đơn cho KTV chưa điểm danh (chốt 14/09/2026).
 */
export const t = {
    notCheckedInTag: 'Chưa điểm danh',
    pickerMissHint: 'Không thấy trong danh sách đã điểm danh. Gõ ĐÚNG mã hoặc ĐÚNG tên rồi Enter để chọn KTV chưa điểm danh.',
    reasonNotCheckedIn: 'chưa điểm danh (chưa bấm Oria xin chào)',
    reasonTurnedOff: 'đang tắt nhận đơn / đã tan ca',
    typeDPenaltyNote: 'Loại D: không điểm danh trong ngày vẫn bị phạt vắng theo quy định.',
    confirmQuestion: 'OK để tiếp tục gửi đơn?',
};

/** Nội dung popup xác nhận, mỗi KTV một dòng. */
export const buildCheckinConfirmMessage = (ktvs: CheckinGateKtv[]): string => {
    const lines = ktvs.map(k => {
        const who = k.name && k.name !== k.id ? `NV ${k.id} – ${k.name}` : `NV ${k.id}`;
        return `• ${who}: ${k.reason === 'TURNED_OFF' ? t.reasonTurnedOff : t.reasonNotCheckedIn}`;
    });
    const parts = [...lines, ''];
    if (ktvs.some(k => k.workType === 'TYPE_D')) parts.push(t.typeDPenaltyNote);
    parts.push(t.confirmQuestion);
    return parts.join('\n');
};
