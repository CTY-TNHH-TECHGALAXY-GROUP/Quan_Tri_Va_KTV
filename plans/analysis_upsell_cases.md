# Phân Tích: Xử lý Luồng Khách Mua Thêm Dịch Vụ & Thêm Giờ

Tài liệu này phân tích 2 edge cases phổ biến trong vận hành Spa/KTV: Khách mua thêm dịch vụ giữa chừng và khách mua thêm giờ khi sắp hết thời gian.

---

## 1. Mua Thêm Dịch Vụ Cùng Đơn Hàng (Add-on Services)

**Ngữ cảnh:** Đơn hàng (Booking) đã tạo, KTV đang làm dịch vụ A (VD: Massage Body), khách muốn làm thêm dịch vụ B (VD: Gội đầu).

### Đề xuất Kỹ thuật:
- **Data Model:** Không tạo đơn mới, chỉ `INSERT` thêm một `BookingItem` vào Booking ID hiện tại.
- **Timeline Chaining:** Tận dụng logic *Sequential Timelines* (mình đang xử lý), dịch vụ B sẽ được nối tiếp tự động.
  - `scheduledStartTime` (Dịch vụ B) = `actualEndTime` (Dịch vụ A).
- **Giao việc (Dispatch):** Lễ tân có thể chọn KTV hiện tại làm tiếp hoặc điều 1 KTV mới. Nếu chọn KTV hiện tại, hệ thống tự động kéo dài chuỗi thời gian làm việc của KTV đó.

---

## 2. Gần Cuối Giờ Mua Thêm Thời Gian (Extend Time)

**Ngữ cảnh:** KTV báo khách muốn làm thêm 30 phút hoặc 60 phút.

### Phương án A: Tăng thời lượng (Duration) của dịch vụ hiện tại
- **Cách làm:** Update trực tiếp `endTime` và `duration` của `BookingItem` đang chạy.
- **Ưu điểm:** Khách không thấy chia thành 2 dòng trên màn hình app.
- **Nhược điểm:** 
  - Khó tách bạch doanh thu (khách hỏi sao massage giá này lại biến thành giá khác).
  - Rất khó tính hoa hồng/tua nếu công ty có chính sách riêng cho phần "thêm giờ".

### Phương án B (Đề xuất): Biến "Thêm Giờ" thành một "Dịch Vụ" độc lập
- **Cách làm:** Tạo các dịch vụ trong Menu (Services) như "Massage thêm 30p", "Massage thêm 60p".
- **Ưu điểm:**
  - Quy luôn về bài toán **Số 1** (Mua thêm dịch vụ). Hệ thống không cần viết thêm 1 logic cập nhật thời gian phức tạp nào cả.
  - Hóa đơn in ra minh bạch: 1 dòng Dịch vụ chính, 1 dòng Thêm giờ.
  - Hoa hồng, tua cho KTV được tính chuẩn xác như 1 dịch vụ bình thường.

---

## 3. NÚT THẮT CỐT LÕI (BOTTLENECK): Xung Đột Lịch KTV

Cả 2 vấn đề trên đều có chung 1 rủi ro vận hành: **Điều gì xảy ra nếu khách A mua thêm thời gian, nhưng KTV đó đã được Lễ tân xếp lịch cho khách B ngay sau đó?**

### Luồng xử lý đề xuất (Cần Lựa Chọn):
Khi Lễ tân ấn "Thêm dịch vụ / Thêm giờ" và chỉ định KTV hiện tại, hệ thống sẽ check lịch:

1. **Nếu KTV rảnh:** Cho phép thêm bình thường, update timeline.
2. **Nếu KTV bị cấn lịch khách B:** Sẽ hiện Popup chặn lại: *"KTV [NHxxx] đã được xếp cho khách B vào [HH:MM]. Vui lòng chọn cách xử lý:"*
   - **Lựa chọn 1:** Cắt phần "Thêm giờ/Dịch vụ" của khách A cho KTV khác làm.
   - **Lựa chọn 2:** Ưu tiên khách A -> Đẩy dịch vụ của khách B về trạng thái *"Chờ điều phối lại"* (Lễ tân phải đi xếp KTV khác cho khách B).
