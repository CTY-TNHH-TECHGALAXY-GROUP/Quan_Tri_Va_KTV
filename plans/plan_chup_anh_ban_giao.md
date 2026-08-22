# Kế Hoạch Triển Khai: Chụp ảnh bàn giao phòng (Handover Photo)

## 1. Phân Tích Hiện Trạng
- **Frontend KTV:** Giao diện chụp ảnh bàn giao đã được thêm vào bước "Dọn phòng" (`CLEANING`) trong `app/ktv/dashboard/page.tsx` và logic xử lý đã có watermark (giờ, phòng).
- **Payload:** KTV bấm hoàn tất, chuỗi `handoverPhotoBase64` đã được gửi kèm lên API qua action `RELEASE_KTV`.
- **Backend:** File xử lý hiện tại `app/api/ktv/booking/_handlers/handleReleaseKTV.ts` **chưa** có code hứng chuỗi Base64 này để tải lên Supabase Storage và lưu vào Database.
- **Frontend Lễ Tân:** Bảng điều phối `DispatchStaffRow.tsx` hiện tại chỉ mới có nút xem `startPhotoUrl` (Ảnh bắt đầu ca), chưa có chỗ xem ảnh bàn giao.

## 2. Các Bước Thực Hiện

### Bước 1: Backend - Upload & Lưu DB
Tương tự như ảnh bắt đầu ca (`startPhotoUrl`), ảnh bàn giao (`handoverPhotoUrl`) sẽ phản ánh kết quả sau khi KTV hoàn thành đoạn segment của mình.
- Sửa file `handleReleaseKTV.ts`.
- Bổ sung logic giải mã chuỗi Base64 và upload lên Supabase Storage bucket `attendance` (thư mục `handover-photos/`).
- Sau khi có public URL, fetch `BookingItems` của đơn, tìm đúng segment của `technicianCode`.
- Gắn `handoverPhotoUrl` vào JSON `segments` và lưu (Update) lại vào `BookingItems`.

### Bước 2: Frontend - Hiển thị trên Bảng Điều Phối
- **Nút bấm mới:** Sửa `DispatchStaffRow.tsx`, bổ sung thêm một nút "Xem ảnh dọn phòng" màu xanh ngọc nằm ngay cạnh nút "Xem ảnh bắt đầu". Nút này chỉ hiện khi JSON có `handoverPhotoUrl`.
- **Modal hiển thị:** Sửa hàm `onViewPhoto` và giao diện Modal trong `app/reception/dispatch/page.tsx` để hỗ trợ tiêu đề động ("Ảnh bắt đầu ca" hay "Ảnh bàn giao phòng").

## 3. Quản Trị Rủi Ro
- Việc cập nhật JSON trong `BookingItems.segments` sẽ được làm thận trọng, bảo toàn các segment cũ, tránh ghi đè làm mất ảnh bắt đầu (startPhotoUrl). Dùng hàm helper `ktvMatchesSeg` có sẵn.
