# Kế Hoạch Triển Khai: Nâng Cấp Dispatch Multi-KTV (Team Sync & Smart Skip)

## Mục Tiêu
Giải quyết dứt điểm các lỗi kẹt đơn hàng và nhảy sai màn hình khi điều phối nhiều KTV vào cùng 1 đơn hàng (Multi-KTV).

## Các Tính Năng Đã Chốt & Triển Khai

### 1. Sửa Lỗi Cốt Lõi (Segment Matching)
- **Vấn đề:** Dùng hàm `includes()` khiến KTV có mã ngắn (NH01) vô tình cập nhật nhầm tiến trình của KTV mã dài (NH016).
- **Giải pháp:** Thay thế toàn bộ bằng so sánh tuyệt đối `===` trên toàn hệ thống (cả `route.ts` API và `KTVDashboard.logic.ts`).

### 2. Đại Diện Bấm (Team Sync)
- **Mô tả:** Trong cùng 1 dịch vụ (e.g. Massage 4 tay) hoặc 1 nhóm dịch vụ giống nhau (e.g. 5 Foot 45) -> 1 KTV bấm Bắt đầu/Hoàn tất thì cả team tự động chạy theo.
- **Điều kiện Kích Hoạt:** Các KTV phải cùng thuộc 1 Đơn (`bookingId`), cùng Phòng (`roomId`), và cùng Giờ Bắt Đầu theo lộ trình (`startTime`).

### 3. Tự Động Bỏ Qua (Smart Skip)
- **Mô tả:** Tối ưu hóa số lượng màn hình KTV phải bấm sau khi hoàn tất dịch vụ.
- **Smart Skip Đánh Giá (Review):** Nếu 2 KTV làm chung, KTV A đánh giá khách hàng xong thì KTV B tự động được bỏ qua bước Đánh giá.
- **Smart Skip Dọn Phòng (Handover):** Chỉ KTV ra trễ nhất phòng (có `endTime` muộn nhất) mới phải làm nhiệm vụ Dọn phòng. Ai ra sớm hơn được tự động bỏ qua. Nếu ra cùng lúc, ai bấm "Dọn xong" trước thì người kia tự động được bỏ qua.

## Trạng Thái:
🟢 Đã hoàn tất code. Chờ User kiểm tra lại thực tế trên App.
