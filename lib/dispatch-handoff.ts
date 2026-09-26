import { workedMsOf } from './segment-time';

/** Phần gói chưa phân công, không thay đổi số phút đã nhập cho A. */
export function remainingHandoffMinutes(packageMinutes: number, assignedMinutes: number): number {
    return Math.max(0, Math.ceil(packageMinutes - assignedMinutes));
}

export function plannedHandoffStartAt(businessDate: string, segment: any): string {
    const end = segment.actualEndTime || segment.plannedEndAt;
    const ms = end ? Date.parse(end)
        : Date.parse(`${businessDate}T${String(segment.startTime || '').slice(0, 5)}:00+07:00`) + Number(segment.duration) * 60000;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/** Gợi ý tròn lên theo phút để khách luôn được đủ thời lượng gói. DB tính lại lúc xác nhận. */
export function suggestedHandoffMinutes(packageMinutes: number, activeSegment: any, now = Date.now()): number {
    const worked = (workedMsOf(activeSegment, activeSegment.actualEndTime || now) ?? 0) / 60000;
    return Math.max(0, Math.ceil(packageMinutes - worked));
}
