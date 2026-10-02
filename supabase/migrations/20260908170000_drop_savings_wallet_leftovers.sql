-- Dọn nốt tàn dư của Ví Tích Luỹ
--
-- Tiếp theo 20260908160000. Hai thứ này cũng chỉ phục vụ tính năng đã gỡ:
--
-- 1. `ktv_piggy_bank_total_weeks` — trước chỉ được đọc bởi
--    /api/ktv/wallet/piggy-bank, route đó đã xoá cùng tính năng.
-- 2. Khoá `savings_wallet` / `enable_piggy_wallet` còn sót trong
--    `Staff.feature_flags`. Không code nào đọc nữa (WalletType chỉ còn
--    TUA | BONUS), để lại chỉ làm người đọc dữ liệu tưởng còn tính năng.
--
-- Vẫn KHÔNG đụng tới KTVPiggyBank và KTVPiggyBankLedger — 1.200.000đ tích luỹ
-- của NH079 giữ nguyên để tra cứu.

DELETE FROM public."SystemConfigs"
WHERE key = 'ktv_piggy_bank_total_weeks';

-- Toán tử `-` trên jsonb gỡ đúng khoá được nêu, các cờ khác trong cùng object
-- giữ nguyên. Chỉ đụng dòng thực sự còn khoá đó.
UPDATE public."Staff"
SET feature_flags = (feature_flags - 'savings_wallet') - 'enable_piggy_wallet'
WHERE feature_flags ? 'savings_wallet'
   OR feature_flags ? 'enable_piggy_wallet';
