-- Cho phép nút Báo Khách tự tắt ĐÚNG LÚC, mà không phá thao tác bật thủ công.
--
-- Quầy thường bật khi khách đang xếp hàng nhưng chưa kịp nhập đơn → lúc đó có 0 đơn chờ.
-- Nếu cứ thấy 0 đơn là tắt thì bật tay xong tắt ngay. Cột này đánh dấu "khóa đã từng thấy
-- có đơn chờ", để chỉ tự tắt khi số đơn chờ đã từng > 0 rồi mới về 0.
ALTER TABLE "GuestArrivalEvents"
  ADD COLUMN IF NOT EXISTS has_seen_pending BOOLEAN DEFAULT FALSE;
