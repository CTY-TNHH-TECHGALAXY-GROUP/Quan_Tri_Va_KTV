import { isTwoSlotSequential } from './dispatch-status';

/** Item đã chọn nối tiếp chỉ đổi chặng qua RPC có khóa. */
export function liveDispatchConflict(dbSegments: any[], incomingSegments: any[], dbOptions?: any, incomingOptions?: any): string | null {
    if (isTwoSlotSequential(dbOptions)) {
        if (!isTwoSlotSequential(incomingOptions) || dbSegments.length !== incomingSegments.length || dbSegments.some(current => {
            const incoming = incomingSegments.find(s => s.id === current.id);
            return !incoming || ['ktvId', 'sequenceSlot', 'roomId', 'bedId', 'startTime', 'duration', 'endTime',
                'actualStartTime', 'actualEndTime', 'voided'].some(k => String(incoming[k] ?? '') !== String(current[k] ?? ''));
        })) return 'Ca nối tiếp đã thay đổi; tải lại đơn và dùng thao tác gán B riêng.';
        return null;
    }
    const running = dbSegments.filter(s => s?.actualStartTime && !s?.actualEndTime);
    if (!running.length) return null;
    for (const current of running) {
        const incoming = incomingSegments.find(s => s.ktvId === current.ktvId && s.id === current.id);
        if (!incoming || ['startTime', 'duration', 'endTime'].some(k => String(incoming[k]) !== String(current[k]))) {
            return `KTV ${current.ktvId} đang làm; không được sửa giờ hoặc thay chặng. Dùng bàn giao nối tiếp.`;
        }
    }
    if (incomingSegments.some(s => !dbSegments.some(d => d.id === s.id))) {
        return 'Dịch vụ đang chạy; thêm KTV qua thao tác bàn giao nối tiếp.';
    }
    return null;
}
