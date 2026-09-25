import { workedMsOf } from './segment-time';

/** Gợi ý tròn lên theo phút để khách luôn được đủ thời lượng gói. DB tính lại lúc xác nhận. */
export function suggestedHandoffMinutes(packageMinutes: number, activeSegment: any, now = Date.now()): number {
    const worked = (workedMsOf(activeSegment, now) ?? 0) / 60000;
    return Math.max(0, Math.ceil(packageMinutes - worked));
}
