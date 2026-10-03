-- Lưu vết số thuế TNCN đã trừ của từng ngày, phục vụ đối chiếu bảng lương.
--
-- ⚠️ CỘT NÀY CHỈ ĐỂ GHI NHẬN, KHÔNG PHẢI ĐỂ TRỪ.
-- total_commission và total_bonus vẫn lưu số GỘP (trước thuế) như cũ.
-- Nơi DUY NHẤT thực hiện phép trừ 10% vẫn là KtvTypeDWalletService khi dựng ví.
-- Nếu sau này đổi sang lưu số đã trừ thuế vào total_commission thì PHẢI bỏ phép trừ
-- trong KtvTypeDWalletService trong CÙNG một lần sửa, nếu không KTV bị trừ thuế hai lần.
ALTER TABLE "KTVDailyLedger"
  ADD COLUMN IF NOT EXISTS total_tax NUMERIC DEFAULT 0;

COMMENT ON COLUMN "KTVDailyLedger".total_tax IS
  'Thue TNCN da tru cua ngay (VND). Chi de luu vet doi chieu - KHONG dung de tru lai.';

COMMENT ON COLUMN "KTVDailyLedger".work_type_snapshot IS
  'Loai KTV TAI THOI DIEM chot so. Giu nguyen ke ca sau nay KTV doi loai.';

COMMENT ON COLUMN "KTVDailyLedger".total_bonus IS
  'Thuong tinh bang DIEM (khong phai VND). Nhan ktv_bonus_rate_<work_type> moi ra tien.';
