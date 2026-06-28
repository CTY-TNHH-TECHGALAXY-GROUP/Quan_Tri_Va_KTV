/**
 * Tính toán lại thời gian kết thúc dự kiến (estimated_end_time) của tua
 * Dựa trên thời gian bắt đầu thực tế (actualStartTime) thay vì thời gian dự kiến.
 * @param originalStartTime Thời gian dự kiến bắt đầu (VD: "14:30" hoặc "14:30:00")
 * @param originalEndTime Thời gian dự kiến kết thúc (VD: "15:30" hoặc "15:30:00")
 * @param actualStartTime Thời gian KTV thực sự bắt đầu (VD: "14:45" hoặc "14:45:00")
 * @returns Thời gian kết thúc mới (VD: "15:45:00")
 */
export function recalculateEstimatedEndTime(
    originalStartTime: string,
    originalEndTime: string,
    actualStartTime: string
): string {
    try {
        const shParts = originalStartTime.split(':');
        const ehParts = originalEndTime.split(':');
        
        if (shParts.length < 2 || ehParts.length < 2) {
            return originalEndTime; // Không đủ dữ liệu
        }

        const sh = Number(shParts[0]);
        const sm = Number(shParts[1]);
        const eh = Number(ehParts[0]);
        const em = Number(ehParts[1]);

        if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) {
            return originalEndTime;
        }

        // Tính tổng thời lượng của dịch vụ
        let durationMins = (eh * 60 + em) - (sh * 60 + sm);
        if (durationMins <= 0) durationMins += 24 * 60; // Ca đêm (cross midnight)

        const ahParts = actualStartTime.split(':');
        if (ahParts.length < 2) return originalEndTime;

        const ah = Number(ahParts[0]);
        const am = Number(ahParts[1]);

        if (isNaN(ah) || isNaN(am)) return originalEndTime;

        // Tính thời gian kết thúc mới
        let endMins = ah * 60 + am + durationMins;
        const endH = Math.floor(endMins / 60) % 24;
        const endM = endMins % 60;

        return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
    } catch (e) {
        console.error("❌ [TimeHelper] Error recalculating time:", e);
        return originalEndTime;
    }
}
