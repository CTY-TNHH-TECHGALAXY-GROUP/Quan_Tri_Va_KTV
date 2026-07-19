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
