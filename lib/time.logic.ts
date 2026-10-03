/**
 * ⏱️ SHARED TIME LOGIC
 * Chứa toàn bộ các tiện ích liên quan đến thời gian.
 * Sửa đổi ở đây sẽ áp dụng trên toàn bộ hệ thống.
 */

// =============================================
// 🔧 SHARED CONSTANTS
// =============================================

export const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DAY_CUTOFF_HOUR = 8; // Mặc định cắt ngày lúc 08:00 sáng

// =============================================
// 🛠 SHARED UTILITIES
// =============================================

/**
 * Lấy đối tượng Date hiện tại theo múi giờ Việt Nam.
 */
export const getVnNow = (): Date => {
  const nowUtc = new Date();
  return new Date(nowUtc.getTime() + VN_OFFSET_MS);
};

/**
 * Lấy chuỗi ngày YYYY-MM-DD theo múi giờ Việt Nam.
 */
export const getVnDateStr = (date?: Date): string => {
  const target = date || getVnNow();
  return target.toISOString().split('T')[0];
};

/**
 * Lấy chuỗi giờ HH:mm:ss theo múi giờ Việt Nam.
 */
export const getVnTimeStr = (date?: Date): string => {
  const target = date || getVnNow();
  return target.toISOString().split('T')[1].substring(0, 8);
};

/**
 * Lấy chuỗi DateTime YYYY-MM-DDTHH:mm:ss+07:00
 */
export const getVnIsoStr = (date?: Date): string => {
  const target = date || getVnNow();
  return `${target.toISOString().split('.')[0]}+07:00`;
};

/**
 * Tính toán ngày kinh doanh (Business Date) có xét điểm cắt giờ (Cut-off hour).
 * Ví dụ: cắt ngày lúc 08:00 sáng.
 * Đơn hàng lúc 07:30 sáng ngày 02/09 sẽ được tính vào ngày kinh doanh 01/09.
 */
export const getBusinessDate = (date?: Date, cutoffHour = DAY_CUTOFF_HOUR): string => {
  const target = date || getVnNow();
  const targetHours = target.getUTCHours(); // getUTCHours of VN date actually returns the VN hour (because VN_OFFSET_MS is added)
  
  // Actually, wait: `target` is a shifted Date object, so `.getUTCHours()` gets the VN hours
  const businessDate = new Date(target.getTime() - cutoffHour * 60 * 60 * 1000);
  return businessDate.toISOString().split('T')[0];
};

/**
 * Tính toán lại thời gian kết thúc dự kiến (estimated_end_time) của tua
 * Dựa trên thời gian bắt đầu thực tế (actualStartTime) thay vì thời gian dự kiến.
 */
export function recalculateEstimatedEndTime(
    originalStartTime: string,
    originalEndTime: string,
    actualStartTime: string
): string {
    try {
        const shParts = originalStartTime.split(':');
        const ehParts = originalEndTime.split(':');
        
        if (shParts.length < 2 || ehParts.length < 2) return originalEndTime;

        const sh = Number(shParts[0]);
        const sm = Number(shParts[1]);
        const eh = Number(ehParts[0]);
        const em = Number(ehParts[1]);

        if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return originalEndTime;

        let durationMins = (eh * 60 + em) - (sh * 60 + sm);
        if (durationMins <= 0) durationMins += 24 * 60; // Ca đêm

        const ahParts = actualStartTime.split(':');
        if (ahParts.length < 2) return originalEndTime;

        const ah = Number(ahParts[0]);
        const am = Number(ahParts[1]);

        if (isNaN(ah) || isNaN(am)) return originalEndTime;

        let endMins = ah * 60 + am + durationMins;
        const endH = Math.floor(endMins / 60) % 24;
        const endM = endMins % 60;

        return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
    } catch (e) {
        console.error("❌ [TimeHelper] Error recalculating time:", e);
        return originalEndTime;
    }
}

/**
 * Tính toán thời gian kết thúc chính xác nhất dựa trên tổng thời lượng (duration) của tất cả các chặng (segments).
 * Hàm này dùng chung cho toàn hệ thống để đảm bảo Sổ Tua (TurnQueue) và Kanban luôn đồng bộ.
 * @param allSegments Mảng các segment KTV đang thực hiện (hỗ trợ cả dạng [{seg: {...}}] hoặc mảng segment trực tiếp)
 * @param actualStartTime Thời gian bắt đầu thực tế (HH:mm:ss)
 * @returns Chuỗi thời gian kết thúc (HH:mm:ss)
 */
export function calculateAccurateEndTimeFromSegments(allSegments: any[], actualStartTime: string): string {
    if (!allSegments || allSegments.length === 0) return actualStartTime;
    
    let totalMins = 0;
    let earliestStartMins = Number.MAX_SAFE_INTEGER;
    let latestEndMins = 0;
    let hasValidStartEnd = false;

    // Quét toàn bộ segment để thử tìm thời gian bao phủ (từ st đến en)
    allSegments.forEach((s: any) => {
        const seg = s.seg ? s.seg : s;
        const st = seg.startTime;
        const en = seg.endTime;
        if (st && en) {
            const shParts = String(st).split(':').map(Number);
            const ehParts = String(en).split(':').map(Number);
            if (shParts.length >= 2 && ehParts.length >= 2 && !isNaN(shParts[0]) && !isNaN(ehParts[0])) {
                const smins = shParts[0] * 60 + shParts[1];
                let emins = ehParts[0] * 60 + ehParts[1];
                if (emins < smins) emins += 24 * 60; // Qua đêm
                earliestStartMins = Math.min(earliestStartMins, smins);
                latestEndMins = Math.max(latestEndMins, emins);
                hasValidStartEnd = true;
            }
        }
    });

    if (hasValidStartEnd && earliestStartMins < Number.MAX_SAFE_INTEGER && latestEndMins > 0) {
        totalMins = latestEndMins - earliestStartMins;
    } else {
        // Fallback: cộng dồn duration
        allSegments.forEach((s: any) => {
            const seg = s.seg ? s.seg : s;
            const d = Number(seg.duration);
            if (!isNaN(d)) totalMins += d;
        });
    }

    if (totalMins <= 0) return actualStartTime;

    const ahParts = actualStartTime.split(':').map(Number);
    if (ahParts.length < 2 || isNaN(ahParts[0])) return actualStartTime;

    const ah = ahParts[0];
    const am = ahParts[1];

    let endMins = ah * 60 + am + totalMins;
    const endH = Math.floor(endMins / 60) % 24;
    const endM = endMins % 60;

    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
}
