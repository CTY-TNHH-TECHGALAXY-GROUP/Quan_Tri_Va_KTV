import { PendingOrder } from './types';

// ==========================================
// 🕒 DISPATCH TIME CALCULATION LOGIC
// ==========================================

/**
 * Tính toán thời gian kết thúc dựa trên thời gian bắt đầu và số phút.
 * Hàm này dùng chung cho toàn bộ logic Dispatch (Tính toán nháp ở Frontend).
 */
export const calcEndTime = (startStr: string, addMins: number): string => {
  if (!startStr) return '';
  const [h, m] = startStr.split(':').map(Number);
  let totalMins = h * 60 + m + addMins;
  const nextH = Math.floor(totalMins / 60) % 24;
  const nextM = totalMins % 60;
  return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
};

/**
 * Tính toán lại thời gian chạy nối tiếp cho tất cả các dịch vụ của KTV.
 * Đảm bảo 1 KTV làm 2 dịch vụ thì dịch vụ 2 sẽ nối tiếp ngay sau dịch vụ 1.
 */
export const recalculateAllTimes = (order: PendingOrder, roomTransitionTime: number = 0): PendingOrder => {
  const cloned = JSON.parse(JSON.stringify(order)) as PendingOrder;
  let ktvEndTimes: Record<string, { time: string, roomId: string }> = {};
  
  cloned.services.forEach(svc => {
    svc.staffList.forEach(r => {
      if (!r.ktvId || r.segments.length === 0) return;
      
      if (ktvEndTimes[r.ktvId]) {
        const last = ktvEndTimes[r.ktvId];
        const firstSeg = r.segments[0];
        
        // Theo quy định của Spa, transition time = 0 (bỏ thời gian chuyển phòng)
        const gap = 0; 
        
        const start = calcEndTime(last.time, gap);
        firstSeg.startTime = start;
        firstSeg.endTime = calcEndTime(start, firstSeg.duration);
        
        for(let i = 1; i < r.segments.length; i++) {
           const p = r.segments[i-1];
           const c = r.segments[i];
           const g = 0; // Transition time = 0
           c.startTime = calcEndTime(p.endTime, g);
           c.endTime = calcEndTime(c.startTime, c.duration);
        }
      }
      
      const lastSeg = r.segments[r.segments.length - 1];
      if (lastSeg && lastSeg.endTime) {
        ktvEndTimes[r.ktvId] = { time: lastSeg.endTime, roomId: lastSeg.roomId || '' };
      }
    });
  });
  
  return cloned;
};
