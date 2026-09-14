import type { WalletType } from '@/lib/featureFlags';

type WorkTypeTab = 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';

export const t = {
    typeLabel: {
        TYPE_A: 'Loại A',
        TYPE_B: 'Loại B',
        TYPE_C: 'Loại C',
        TYPE_D: 'Loại D',
    } as Record<WorkTypeTab, string>,
    walletHint: {
        TUA: 'Số dư tua, hoa hồng và lệnh rút tiền',
        BONUS: 'Điểm thưởng ca / tua và đổi điểm',
    } as Record<WalletType, string>,
    title: (typeLabel: string) => `Công tắc ví — cả ${typeLabel}`,
    subtitle: (typeLabel: string) =>
        `Tắt ở đây là mọi KTV ${typeLabel} thấy "Tính năng của bạn đang bảo trì" ở ví đó, không cần bấm từng người. Loại khác giữ nguyên.`,
    rule: 'Ví chỉ mở khi công tắc loại BẬT và cờ cá nhân của KTV đó BẬT. Tiền tua và điểm vẫn ghi sổ bình thường. KTV nhận thay đổi ở lần mở trang Ví kế tiếp — không ai bị đăng xuất.',
    offForType: 'Đang tắt cho cả loại',
    saved: 'Đã lưu',
    confirm: (turnOn: boolean, walletName: string, typeLabel: string) =>
        `${turnOn ? 'BẬT' : 'TẮT'} "${walletName}" cho TOÀN BỘ KTV ${typeLabel}.\n\n`
        + (turnOn
            ? 'KTV sẽ xem lại được ví này (trừ người bị tắt riêng).\n'
            : 'KTV sẽ thấy "Tính năng của bạn đang bảo trì", không rút / quy đổi được trên app.\n')
        + 'Tiền tua và điểm vẫn ghi sổ bình thường. Các loại KTV khác không bị ảnh hưởng.\n\nTiếp tục?',
};
