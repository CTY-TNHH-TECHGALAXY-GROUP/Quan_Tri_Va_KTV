export type CheckStatus = 'IDLE' | 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CHECKED_OUT';

export function resolveAttendanceStatus(
    records: any[],
    workType: string
): { checkStatus: CheckStatus; record: any | null } {
    if (!records || records.length === 0) {
        return { checkStatus: 'IDLE', record: null };
    }

    if (workType === 'TYPE_D') {
        // Lấy record mới nhất không REJECTED (records sắp mới → cũ).
        //
        // SUDDEN_OFF ("Báo off đột xuất") = đã RỜI ca, không phải đang ở tiệm.
        // Trước đây nó trả 'CONFIRMED' và được ưu tiên tuyệt đối → màn KTV hiện
        // "ĐÃ TỚI TIỆM", và KTV báo off rồi quay lại điểm danh thì kẹt mãi ở
        // trạng thái cũ. Nay xét như CHECK_OUT, record mới hơn thắng.
        const latestValid = records.find(r => r.status !== 'REJECTED');
        if (!latestValid) return { checkStatus: 'IDLE', record: null };

        if (latestValid.checkType === 'CHECK_OUT' || latestValid.checkType === 'SUDDEN_OFF') {
            return { checkStatus: latestValid.status === 'CONFIRMED' ? 'CHECKED_OUT' : 'PENDING', record: latestValid };
        }
        
        if (['CHECK_IN', 'LATE_CHECKIN', 'OVERTIME'].includes(latestValid.checkType)) {
            return { checkStatus: latestValid.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING', record: latestValid };
        }

        return { checkStatus: 'IDLE', record: null };
    }

    // Default behavior for A/B/C
    const confirmedOff = records.find((r) => r.checkType === 'SUDDEN_OFF' && r.status === 'CONFIRMED');
    if (confirmedOff) return { checkStatus: 'CONFIRMED', record: confirmedOff };

    const pendingOff = records.find((r) => r.checkType === 'SUDDEN_OFF' && r.status === 'PENDING');
    if (pendingOff) return { checkStatus: 'PENDING', record: pendingOff };

    const confirmedCheckOut = records.find((r) => r.checkType === 'CHECK_OUT' && r.status === 'CONFIRMED');
    if (confirmedCheckOut) return { checkStatus: 'CHECKED_OUT', record: confirmedCheckOut };

    const pendingCheckOut = records.find((r) => r.checkType === 'CHECK_OUT' && r.status === 'PENDING');
    if (pendingCheckOut) return { checkStatus: 'PENDING', record: pendingCheckOut };

    const confirmedCheckIn = records.find((r) => (r.checkType === 'CHECK_IN' || r.checkType === 'LATE_CHECKIN' || r.checkType === 'OVERTIME') && r.status === 'CONFIRMED');
    if (confirmedCheckIn) return { checkStatus: 'CONFIRMED', record: confirmedCheckIn };

    const pendingCheckIn = records.find((r) => (r.checkType === 'CHECK_IN' || r.checkType === 'LATE_CHECKIN' || r.checkType === 'OVERTIME') && r.status === 'PENDING');
    if (pendingCheckIn) return { checkStatus: 'PENDING', record: pendingCheckIn };

    return { checkStatus: 'IDLE', record: null };
}
