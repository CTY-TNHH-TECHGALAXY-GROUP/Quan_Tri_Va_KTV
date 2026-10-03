# 📚 Tài Liệu: Thuật Toán Tính Điểm Bonus & Hoa Hồng KTV (Version 1.6.31)

Tài liệu này đóng gói và tóm tắt toàn bộ logic tính **Tiền Tua (Commission)** và **Bonus Xuất Sắc** cho Kỹ Thuật Viên (KTV), đặc biệt xử lý các nghiệp vụ phức tạp như làm chung đơn, làm nhiều khách, và có mặt KTV Loại C.

## 1. Nguyên Tắc Cốt Lõi (Single Source of Truth)
- **Đơn con (Child Booking)** là nguồn dữ liệu gốc duy nhất để tính thời gian và chia Bonus cho KTV.
- **Đơn cha (Parent Booking - Status: `SPLIT`)** chỉ có tác dụng làm hóa đơn tổng để in Bill thanh toán cho khách ở Quầy Lễ Tân, không tham gia vào bất kỳ báo cáo doanh thu hay chia điểm thưởng nào để tránh lỗi nhân đôi doanh thu.

## 2. Luật Chia Điểm Thưởng (Bonus) Khi Làm Chung
Nếu có nhiều KTV cùng phục vụ trên một đơn hàng (Cùng 1 khách):
- **Đếm tất cả KTV tham gia:** Hệ thống luôn quét tổng số lượng KTV tham gia vào việc phục vụ (Ví dụ: 2 KTV).
- **Chia đều quỹ điểm:** Quỹ điểm thưởng của 1 khách (VD: 20 điểm) sẽ được **chia đều cho TỔNG số lượng KTV** (VD: Mỗi người 10 điểm).
- **Sự tham gia của KTV Loại C (hoặc KTV Ảo/Ngoài):** Kể cả khi 1 KTV chính thức làm chung với 1 KTV Loại C, quỹ điểm vẫn bắt buộc phải chia đều. KTV Loại C có thể không nhận được tiền thực tế (do tắt cờ tính thưởng), nhưng sự có mặt của KTV Loại C vẫn được tính để chia quỹ điểm, đảm bảo KTV chính thức không "hưởng trọn" 100% phần thưởng của cả đơn.

## 3. Luật Sàng Lọc KTV Dưới 60 Phút
Hệ thống KHÔNG cào bằng, mà sẽ đánh giá thời lượng làm việc ĐỘC LẬP của từng KTV:
- **Tách biệt thời lượng:** VD: Nếu KTV A làm 30 phút, KTV B làm 60 phút trong cùng 1 khách.
- **Trảm KTV dưới chuẩn:** KTV A (30p < 60p) sẽ bị tự động tước quyền nhận Bonus (0 điểm).
- **Chia thưởng cho KTV đạt chuẩn:** KTV B (60p >= 60p) sẽ lọt vào vòng chia Bonus, nhưng vì đơn này tổng cộng có 2 người cùng tham gia, KTV B vẫn sẽ bị chia quỹ điểm (VD: 1/2 quỹ điểm = 10 điểm).

## 4. Luật Chống Việc Lễ Tân Nhập Gộp Khách
Để chống lại sai sót khi Lễ tân nhập gộp nhiều khách vào 1 đơn hàng với thời lượng cực dài (VD: Nhập 1 khách nhưng kéo dài 90 phút thay vì 3 khách x 30 phút):
- **Công thức Trung Bình:** Hệ thống sử dụng công thức `Thời lượng trung bình = Tổng thời gian / Số lượng khách (guestCount)`.
- Nếu thời lượng trung bình **< 60 phút**, hệ thống tự động đánh trượt Bonus (0 điểm).
- VD: KTV làm 1 đơn hiển thị 90 phút nhưng Set `guestCount = 3` -> TB 30 phút/khách -> 0 điểm Bonus. 

## 5. Chặn Lỗi Thao Tác Của Lễ Tân
- Lễ tân **KHÔNG THỂ HỦY TÁCH ĐƠN (Undo Split)** nếu các KTV ở các đơn con đã nhấn Bắt đầu (`IN_PROGRESS`, `CLEANING`, `DONE`). Điều này đảm bảo an toàn tuyệt đối cho dữ liệu chấm công và tính tiền tua của KTV.

---
> 💡 *Tài liệu này được tạo ra nhằm lưu trữ kiến trúc hệ thống, giúp các Developer hoặc Quản lý Spa dễ dàng nắm bắt logic phân chia hoa hồng mà không cần phải review lại Source Code.*
