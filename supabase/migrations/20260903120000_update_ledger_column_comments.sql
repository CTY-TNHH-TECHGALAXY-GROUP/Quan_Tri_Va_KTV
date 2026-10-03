-- Cap nhat mo ta cot KTVDailyLedger cho khop y nghia MOI cua Loai D.
-- Tu 03/09: total_commission cua TYPE_D la SO THUC NHAN (da gop bonus, da tru thue).
-- Cac loai KTV khac giu nguyen: total_commission van la hoa hong gop truoc thue.
--
-- Ghi chu nay quan trong: chinh viec thieu mo ta don vi da tung gay loi lech 1000 lan
-- (total_bonus luu DIEM nhung bi cong nhu VND).

ALTER TABLE "KTVDailyLedger" ADD COLUMN IF NOT EXISTS total_tax NUMERIC DEFAULT 0;

COMMENT ON COLUMN "KTVDailyLedger".total_commission IS
  'TYPE_D: SO THUC NHAN = hoa hong (da tru theo sao) + bonus quy VND - thue TNCN. Loai khac: hoa hong gop truoc thue.';

COMMENT ON COLUMN "KTVDailyLedger".total_tax IS
  'Thue TNCN da tru (VND). Voi TYPE_D so nay DA duoc tru khoi total_commission - KHONG duoc tru lai o vi.';

COMMENT ON COLUMN "KTVDailyLedger".total_bonus IS
  'Thuong tinh bang DIEM (khong phai VND). Voi TYPE_D chi de tra cuu: tien thuong DA nam trong total_commission, KHONG duoc cong lai.';

COMMENT ON COLUMN "KTVDailyLedger".work_type_snapshot IS
  'Loai KTV TAI THOI DIEM chot so. Giu nguyen ke ca sau nay KTV doi loai.';

COMMENT ON COLUMN "KTVDailyLedger".rating_deduction IS
  'Ti le tru theo sao da ap dung (0 / 0.25 / 0.5 / 0.75).';

COMMENT ON COLUMN "KTVDailyLedger".commission_breakdown IS
  'Chi tiet tung don: hoa hong gop, muc tru theo sao, bonus, thue, thuc nhan. La NOI DUY NHAT con giu so truoc thue sau khi total_commission chuyen sang so rong.';
