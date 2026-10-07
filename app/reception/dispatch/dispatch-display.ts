/**
 * Helper hiển thị dùng chung cho màn điều phối (page.tsx và các component con).
 */

/**
 * Tên khách để hiện trên thẻ đơn.
 *
 * Đơn đã tách nhiều khách thì phải kèm nhãn khách, nếu không quầy nhìn hai thẻ
 * cùng tên không biết thẻ nào của ai. Tên vốn đã kết thúc bằng "Khách A" thì
 * bọc ngoặc tại chỗ thay vì thêm nhãn lần nữa.
 */
export const getDisplayCustomerName = (subOrder: any) => {
    const order = subOrder.originalOrder;
    let name = order.customerName || order.customerEmail || 'Khách Vãng Lai';
    if (subOrder.services.length < order.services.length) {
        if (name.match(/Khách [A-Z]$/i)) {
            name = name.replace(/Khách ([A-Z])$/i, '[Khách $1]');
        } else {
            name = `[Khách ${subOrder.subSuffix || 'A'}] ${name}`;
        }
    }
    return name.toUpperCase();
};

// Segment 2+ waiting past its unlock time this many minutes → counter alert (red label + toast).
export const SEGMENT_START_ALERT_MIN = 10;

const sameKtv = (a: unknown, b: unknown) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isVoided = (seg: any) => seg?.voided === true || seg?.voided === 'true';

/**
 * A KTV's later segment in the same order that is waiting for the KTV to press Start:
 * the previous segment has ended and this one has no actual start yet. `lateMin` counts from the
 * unlock time = later of the admin-assigned start and the previous segment's end.
 * Returns null when this segment is the KTV's first, already started, or the previous is still running.
 */
export function waitingSegmentInfo(services: any[], ktvId: string, seg: any, nowMs: number): { index: number; lateMin: number } | null {
    if (!seg || seg.actualStartTime || isVoided(seg)) return null;
    const mine = (services || []).flatMap((s: any) => (s.staffList || [])
        .filter((row: any) => sameKtv(row.ktvId, ktvId))
        .flatMap((row: any) => (row.segments || []).filter((g: any) => !isVoided(g))))
        .sort((a: any, b: any) => String(a.startTime || '23:59').localeCompare(String(b.startTime || '23:59')));
    const index = mine.findIndex((g: any) => g.id === seg.id);
    const prev = index > 0 ? mine[index - 1] : null;
    const prevEnd = prev?.actualEndTime ? Date.parse(prev.actualEndTime) : NaN;
    if (!prev || !Number.isFinite(prevEnd)) return null;
    let planned = seg.plannedStartAt ? Date.parse(seg.plannedStartAt) : NaN;
    if (!Number.isFinite(planned) && /^\d{1,2}:\d{2}/.test(String(seg.startTime || ''))) {
        // HH:mm on the Vietnam calendar day of the previous segment's end (+1 day across midnight).
        const day = new Date(prevEnd + 7 * 3600e3).toISOString().slice(0, 10);
        planned = Date.parse(`${day}T${String(seg.startTime).slice(0, 5).padStart(5, '0')}:00+07:00`);
        if (planned < prevEnd - 12 * 3600e3) planned += 24 * 3600e3;
    }
    const unlockAt = Number.isFinite(planned) ? Math.max(planned, prevEnd) : prevEnd;
    return { index, lateMin: Math.max(0, Math.floor((nowMs - unlockAt) / 60000)) };
}
