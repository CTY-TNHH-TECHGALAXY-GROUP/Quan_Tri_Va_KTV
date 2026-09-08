-- Chuẩn hoá Staff.status về đúng ba giá trị + khoá lại bằng CHECK
--
-- Cột này là text tự do, màn Thêm nhân viên ghi thẳng `formData.status` xuống
-- nên lọt vào 'active' / 'working'. Bốn dòng dính lỗi đều là tài khoản hệ thống
-- (ADMIN, dev, Developer, Quản Trị Viên mặc định).
--
-- KHÔNG đổi chúng thành 'ĐANG LÀM': mọi danh sách vận hành lọc theo giá trị đó,
-- làm vậy là đẩy ADMIN và dev vào bảng lương, báo cáo KTV, danh sách quầy và
-- cron ghi sổ hằng ngày. Cho hẳn một trạng thái riêng: 'HỆ THỐNG'.

-- 1. Biến thể lạc 'NGHỈ VIỆC' (TurnQueueBoard ghi ra, không nơi nào đọc) về
--    đúng 'ĐÃ NGHỈ'.
UPDATE public."Staff" SET status = 'ĐÃ NGHỈ' WHERE status = 'NGHỈ VIỆC';

-- 2. Mọi giá trị ngoài chuẩn đều là tài khoản hệ thống (KTV thật đã được đưa
--    về 'ĐANG LÀM' trước đó). NULL lấy mặc định của cột.
UPDATE public."Staff"
SET status = 'HỆ THỐNG'
WHERE status IS NOT NULL
  AND status NOT IN ('ĐANG LÀM', 'ĐÃ NGHỈ', 'KHÓA_TÀI_KHOẢN', 'HỆ THỐNG');

UPDATE public."Staff"
SET status = 'ĐANG LÀM'
WHERE status IS NULL;

-- 3. Khoá lại để giá trị lạ không quay lại lần nữa.
--    ⚠️ Phải có 'KHÓA_TÀI_KHOẢN': cron điểm danh và luồng từ chối tua ghi giá
--    trị này để khoá kỷ luật. Bỏ sót là hai chức năng đó ném lỗi ngay.
ALTER TABLE public."Staff"
    DROP CONSTRAINT IF EXISTS check_staff_status;

ALTER TABLE public."Staff"
    ADD CONSTRAINT check_staff_status
    CHECK (status IN ('ĐANG LÀM', 'ĐÃ NGHỈ', 'KHÓA_TÀI_KHOẢN', 'HỆ THỐNG'));

COMMENT ON COLUMN public."Staff".status IS
    'ĐANG LÀM = nhân sự thật, đang đi làm (chỉ giá trị này được tính vào lương/báo cáo/sổ tua). ĐÃ NGHỈ = đã nghỉ việc. KHÓA_TÀI_KHOẢN = khoá kỷ luật, vẫn là nhân sự. HỆ THỐNG = tài khoản admin/dev, đăng nhập được nhưng không phải nhân sự.';
