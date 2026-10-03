# Kế Hoạch Triển Khai: Chụp/Tải Lên Nhiều Ảnh Bàn Giao

## 1. Phân Tích Yêu Cầu
Yêu cầu nâng cấp: KTV có thể chụp hoặc chọn tải lên nhiều ảnh cùng lúc cho bước bàn giao phòng thay vì chỉ 1 ảnh.
Điều này đòi hỏi phải thay đổi luồng dữ liệu từ 1 chuỗi ảnh (String) sang một mảng ảnh (Array of Strings) xuyên suốt từ Frontend KTV → Database → Frontend Lễ tân.

## 2. Kế Hoạch Chỉnh Sửa Chi Tiết

### Bước 1: Giao Diện KTV (App KTV)
- **Cập nhật State:** Sửa đổi `handoverPhotoBase64` thành mảng `handoverPhotosBase64` trong `KTVDashboard.logic.ts`.
- **Thao tác Chọn ảnh:**
  - Nút **"Tải ảnh từ thư viện"**: Bổ sung thuộc tính `multiple` để KTV có thể bôi đen chọn nhiều ảnh cùng lúc. Hàm `handleFileUpload` sẽ lặp qua từng file, nén + đóng dấu watermark và đẩy vào mảng.
  - Nút **"Chụp ảnh"**: KTV có thể bấm chụp nhiều lần, mỗi lần chụp xong ảnh sẽ được append (thêm) vào danh sách.
- **Hiển thị danh sách ảnh (Preview):** Thay vì hiển thị 1 ảnh to chiếm chỗ, sẽ làm một giao diện lưới (Grid) hiển thị các ảnh thu nhỏ (Thumbnails). Mỗi ảnh thu nhỏ sẽ có nút `[X]` để KTV có thể xóa nếu lỡ chọn/chụp nhầm. Nút hoàn tất chỉ sáng lên khi có ít nhất 1 ảnh.

### Bước 2: API & Database (Backend)
- **Sửa API `handleReleaseKTV.ts`:**
  - Nhận mảng `photosBase64` thay vì 1 chuỗi.
  - Dùng vòng lặp (với `Promise.all`) để upload song song tất cả các ảnh lên bucket `attendance`.
  - Lấy về mảng các Public URLs.
- **Sửa Database:** Đổi tên trường dữ liệu lưu trữ trong `BookingItems.segments` từ `handoverPhotoUrl` thành mảng `handoverPhotoUrls` (lưu dạng mảng trong JSON).

### Bước 3: Giao Diện Lễ Tân (Dispatch Board)
- **Hiển thị nút xem ảnh (DispatchStaffRow / DispatchServiceBlock):**
  - Mặc dù có nhiều ảnh, nút bấm trên bảng sẽ chỉ lấy 1 ảnh đại diện (ảnh đầu tiên) để hiển thị nhằm tiết kiệm diện tích giao diện.
  - Sẽ có thêm một icon nhỏ đính kèm (Ví dụ: `+3`) nếu số lượng ảnh > 1 để Lễ tân nhận biết.
- **Popup/Modal Xem Ảnh (dispatch/page.tsx):**
  - Nâng cấp Modal xem ảnh. Nếu loại ảnh truyền vào là mảng (nhiều ảnh), Modal sẽ tự động biến thành giao diện **Gallery / Carousel** có nút Bấm sang Trái / Phải để Lễ tân lướt xem từng tấm ảnh một dễ dàng.

## 3. Đánh giá tác động
- Rủi ro về Data: Những đơn hàng cũ đã lưu dạng 1 ảnh (`handoverPhotoUrl` dạng string) cần được hỗ trợ tương thích ngược (fallback). Lễ tân vẫn xem được những ảnh cũ nếu hệ thống đọc thấy dạng string, và sẽ xem dạng mảng (Carousel) với các ảnh mới lưu sau này.
