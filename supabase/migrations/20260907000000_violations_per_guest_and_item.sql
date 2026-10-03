-- ================================================================
-- Lỗi khách tích khi đánh giá: lưu theo TỪNG KHÁCH và TỪNG DỊCH VỤ
-- ================================================================
-- VÌ SAO
--
-- Trước đây các ô "góp ý dịch vụ" khách tích ở màn kiosk chỉ được ghi vào
-- `Bookings.violations` — tức cấp BILL. Hai hậu quả:
--
--   1. MẤT DỮ LIỆU. Bill nhiều khách thì ai chấm sau ghi đè người chấm trước:
--        Khách 1 tích "đòi tip"  → violations = ["fa79…"]
--        Khách 2 không tích gì   → violations = []        ← xoá sạch tố cáo trên
--
--   2. KHÔNG BIẾT CỦA AI. Cột nằm ở cấp bill nên không truy được lỗi đó là của
--      khách nào, tố KTV nào. Bill 4 khách 4 KTV thì tố cáo thành vô danh.
--
-- Số sao thì không dính lỗi này vì đã có chỗ lưu riêng (`BookingGuests.rating`,
-- `BookingItems.itemRating`, `ktvRatings`) — chỉ `violations` là không có.
-- Nay việc tích lỗi đã kéo trần đánh giá xuống 3 sao, tức là ĐỘNG TỚI TIỀN, nên
-- bằng chứng bắt buộc phải truy được tới đúng KTV.
--
-- ĐỊNH DẠNG: mảng jsonb, mỗi phần tử là { id, text }
--   [{ "id": "fa79ee24-…", "text": "Kỹ thuật viên đã gợi ý hoặc yêu cầu tiền tip." }]
--
-- Lưu kèm `text` (chụp lại lúc khách bấm) thay vì chỉ `id`, vì:
--   - admin sửa/tắt câu hỏi sau này thì bản ghi cũ vẫn đọc được đúng nội dung
--     khách đã nhìn thấy;
--   - màn Kanban và lịch sử KTV khỏi phải join thêm bảng mỗi lần tải.
--   `id` vẫn giữ để thống kê theo loại lỗi.
-- ================================================================

ALTER TABLE "BookingGuests"
  ADD COLUMN IF NOT EXISTS "violations" jsonb;

ALTER TABLE "BookingItems"
  ADD COLUMN IF NOT EXISTS "violations" jsonb;

COMMENT ON COLUMN "BookingGuests"."violations" IS
  'Các ô góp ý khách này tích khi đánh giá: [{id, text}]. Ghi theo từng khách, không ghi đè lẫn nhau.';

COMMENT ON COLUMN "BookingItems"."violations" IS
  'Bản sao lỗi của khách sở hữu dịch vụ này — để truy được tố cáo tới đúng KTV qua technicianCodes.';

-- `Bookings.violations` giữ nguyên làm bản tổng hợp của cả bill, nhưng từ nay
-- được GỘP THÊM chứ không ghi đè (xem app/reception/feedback/_components/actions.ts).
