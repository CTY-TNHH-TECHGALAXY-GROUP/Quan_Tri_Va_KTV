-- Dọn công tắc ví tích luỹ sau khi gỡ tính năng
--
-- Bốn khoá này do migration 20260908090000 seed ra hồi còn ba loại ví. Ví Tích
-- Luỹ đã bị gỡ khỏi code (WalletType chỉ còn TUA | BONUS) nên không nơi nào đọc
-- chúng nữa — để lại chỉ tổ gây nhầm cho người đọc bảng cấu hình sau này.
--
-- Chỉ xoá CẤU HÌNH. Hai bảng KTVPiggyBank và KTVPiggyBankLedger — nơi ghi
-- 1.200.000đ tích luỹ của NH079 — giữ nguyên, đúng như đã chốt lúc gỡ tính năng.

DELETE FROM public."SystemConfigs"
WHERE key IN (
    'ktv_wallet_savings_enabled_TYPE_A',
    'ktv_wallet_savings_enabled_TYPE_B',
    'ktv_wallet_savings_enabled_TYPE_C',
    'ktv_wallet_savings_enabled_TYPE_D'
);
