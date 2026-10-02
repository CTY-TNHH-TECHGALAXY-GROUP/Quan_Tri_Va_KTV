import { resolveStaffFlag } from '@/lib/featureFlags';

/**
 * "Yêu cầu rút tiền" lúc điểm danh — tín hiệu báo Thu ngân chuẩn bị tiền mặt
 * (`KTVWithdrawals` amount = 1, không phải số tiền).
 *
 * Bật / tắt theo từng KTV bằng cột "Rút tiền buổi sáng" ở bảng Tính năng
 * (`feature_flags.withdraw_morning_only`). Trước 14/09/2026 cờ này không được
 * đọc ở đâu cả — gạt OFF mà form vẫn hiện ô, server vẫn ghi yêu cầu.
 * Chưa có giá trị = TẮT (đúng như bảng Tính năng đang hiển thị).
 *
 * KHÁC với cấu hình hệ thống `ktv_type_d_withdraw_morning_only` (loại D chỉ rút
 * ở trang Ví trước 12:00) — không liên quan tới đây.
 */
export const WITHDRAW_INTENT_FLAG = 'withdraw_morning_only';

export const isWithdrawIntentAllowed = (flags: unknown): boolean =>
    resolveStaffFlag(flags, WITHDRAW_INTENT_FLAG);

/** Ô chỉ hiện ở lần điểm danh ĐẦU TIÊN trong ngày và khi cờ BẬT. */
export const canRequestWithdrawIntent = (input: { flags: unknown; alreadyCheckedInToday: boolean }): boolean =>
    !input.alreadyCheckedInToday && isWithdrawIntentAllowed(input.flags);
