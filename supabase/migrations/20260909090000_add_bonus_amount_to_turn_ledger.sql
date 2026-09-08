-- Bonus 4★ chuyển vào tiền tua
--
-- Trước đây thưởng 4★ của KTV loại D nằm ở VÍ BONUS riêng, tính bởi
-- KtvTypeDWalletService, và lịch sử tua không hề hiện nó. Nay nó là một phần
-- của tiền tua:
--
--   thực nhận = commission_net + bonus_amount − tax_amount
--   tax_amount = (commission_net + bonus_amount) × 10%
--
-- Để RIÊNG một cột thay vì cộng thẳng vào `commission_net`: giữ nguyên ý nghĩa
-- "tiền theo thời gian làm" của cột đó, và để lịch sử tách được hai dòng cho
-- KTV nhìn ra 20k thưởng đến từ đâu.

ALTER TABLE public."KTVDTurnLedger"
    ADD COLUMN IF NOT EXISTS bonus_amount numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public."KTVDTurnLedger".bonus_amount IS
    'Thưởng 4 sao cộng vào tiền tua. Một suất cho mỗi KHÁCH, chia đều nếu nhiều KTV loại D cùng phục vụ khách đó; ghi trên ĐÚNG MỘT dòng của khách để tổng ở mọi cấp không bị nhân lên. Nằm trong cơ sở tính thuế TNCN.';
