import type { KtvWorkType } from '@/lib/services/KtvRosterService';

/** Nhãn hiển thị của trang Thu Ngân KTV. */
export const t = {
    workTypeFilter: {
        all: 'Tất cả loại KTV',
        label: 'Loại KTV',
    },
    /** Tên loại KTV — giữ đúng chữ đang dùng ở màn Cấu hình hệ thống. */
    workTypeName: {
        TYPE_A: 'Loại A',
        TYPE_B: 'Loại B',
        TYPE_C: 'Loại C',
        TYPE_D: 'Loại D',
    } as Record<KtvWorkType, string>,
    bonusTab: {
        excludedTitle: 'Loại D không dùng ví điểm',
        excludedNote: 'Thưởng 4★ của KTV loại D được cộng thẳng vào tiền tua, xem ở tab Ví Tua.',
    },
    emptyByFilter: 'Không có KTV nào khớp bộ lọc đang chọn',
};

export const workTypeLabel = (workType?: string | null): string =>
    t.workTypeName[(workType || 'TYPE_A') as KtvWorkType] || String(workType);
