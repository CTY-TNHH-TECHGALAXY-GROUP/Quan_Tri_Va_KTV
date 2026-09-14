# Kế hoạch triển khai: Chụp ảnh xác nhận khách bằng cam sau trước khi bắt đầu dịch vụ

## 📌 Mục tiêu
Cải tiến luồng UI/UX trên KTV App để bắt buộc KTV chụp ảnh xác nhận khách bằng camera sau trước khi kích hoạt dịch vụ:
1. **Bước 1**: Khi hết thời gian chuẩn bị, nút hành động chính sẽ là **"Chụp ảnh để bắt đầu"** (Awaiting Photo).
2. **Bước 2**: KTV bấm nút để chụp ảnh. Camera sau (`facingMode: 'environment'`) sẽ tự động được kích hoạt để KTV chụp ảnh khách nằm trên giường/phòng. Chụp xong, ảnh preview hiển thị trực tiếp trên giao diện chính để KTV kiểm tra lại chất lượng. KTV có thể chọn chụp lại nếu chưa ưng ý.
3. **Bước 3**: Sau khi đã có ảnh chụp tạm thời, nút hành động chính chuyển thành **"Bắt đầu"** (Ready to Start). KTV bấm nút này để gọi API kích hoạt dịch vụ thực tế và bắt đầu đếm ngược giờ làm.

---

## 🛠️ Chi tiết các thay đổi đề xuất

### 1. KTV App Logic: [KTVDashboard.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/dashboard/KTVDashboard.logic.ts)
- Bổ sung state `startPhotoBase64` để lưu trữ ảnh chụp tạm thời (dưới dạng base64 đã nén).
- **Cơ chế tự phục hồi (Anti-loss)**: Tự động lưu ảnh chụp tạm thời vào `localStorage` kèm theo `bookingId` và `activeSegmentIndex`. Nếu KTV lỡ reload app hoặc tắt trình duyệt sau khi chụp, ảnh sẽ được khôi phục lại để tránh việc KTV phải chụp lại lần nữa.
- Cập nhật hàm `handleStartTimer` để lấy `startPhotoBase64` từ state (hoặc localStorage) gửi lên API `/api/ktv/booking` với payload `photoBase64` và action `START_TIMER`. Sau khi bắt đầu thành công, xóa ảnh tạm này khỏi localStorage.

### 2. KTV App UI: [page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/dashboard/page.tsx)
- Khi `booking.status === 'READY'` hoặc đủ điều kiện bắt đầu dịch vụ:
  - Nếu **chưa có** `startPhotoBase64`: hiển thị nút **"Chụp ảnh để bắt đầu"** kèm theo icon Camera. Bấm nút này sẽ mở camera overlay WebRTC (hoặc nút tải file dự phòng). Mặc định kích hoạt camera sau (`environment`).
  - Nếu **đã có** `startPhotoBase64`: hiển thị thumbnail ảnh preview nhỏ bên dưới, cung cấp một nút nhỏ "Chụp lại" (nếu muốn thay đổi ảnh), và nút hành động chính chuyển thành **"Bắt đầu"** màu xanh ngọc/emerald nổi bật.
- Cập nhật WebRTC Camera Overlay:
  - Mặc định state `facingMode` là `'environment'` (camera sau).
  - Đổi nhãn từ `SELFIE KTV` thành `CHỤP ẢNH XÁC NHẬN`.
  - Cập nhật dòng cảnh báo: *"⚠️ Vui lòng chụp ảnh khách của bạn để xác nhận bắt đầu làm việc."*
  - Hỗ trợ vẽ watermark ngày giờ và tên phòng trực tiếp lên ảnh, nén chất lượng JPEG xuống `0.5` với chiều rộng tối đa `600px` để giảm kích thước payload gửi lên API (< 50KB).

### 3. API: [handleStartTimer.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/booking/_handlers/handleStartTimer.ts)
- Nhận payload `photoBase64` từ body request.
- Nếu có, convert sang Buffer và upload lên Supabase Storage bucket `'attendance'`.
- Lấy link URL public và ghi vào thuộc tính `startPhotoUrl` trong object segment tương ứng của KTV này trong trường `BookingItems.segments`.

### 4. Admin Dispatch Board UI: [KanbanBoard.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/dispatch/_components/KanbanBoard.tsx)
- Tại card dịch vụ đang làm việc (`IN_PROGRESS`) của KTV trên Kanban Board, hiển thị thumbnail tròn nhỏ kế bên mã KTV nếu có `startPhotoUrl` trong segment.
- Khi Lễ tân click vào thumbnail sẽ mở một Modal hiển thị ảnh đã chụp bắt đầu chặng của KTV này kèm thời gian bắt đầu thực tế để đối chiếu thực tế.

---

## 🧪 Kế hoạch kiểm thử (Verification Plan)

1. **Trên KTV App**:
   - Đợi hết đếm ngược chuẩn bị -> Xác nhận nút hiển thị là **"Chụp ảnh để bắt đầu"**.
   - Bấm nút, thực hiện chụp ảnh hoặc tải file -> Xác nhận camera sau mở lên mặc định, nhãn hiển thị là **"CHỤP ẢNH XÁC NHẬN"**, dòng chữ cảnh báo là **"⚠️ Vui lòng chụp ảnh khách của bạn để xác nhận bắt đầu làm việc."**.
   - Chụp thử -> Xác nhận ảnh preview hiển thị trên UI chính và nút đổi thành **"Bắt đầu"**.
   - Thử F5/Reload trang -> Xác nhận ảnh preview và trạng thái nút **"Bắt đầu"** vẫn được giữ nguyên nhờ localStorage.
   - Bấm nút **"Bắt đầu"** -> Xác nhận timer bắt đầu chạy và ảnh tạm trong localStorage được dọn dẹp sạch sẽ.
2. **Kiểm tra Database**:
   - Xác nhận cột `segments` của `BookingItems` được cập nhật chính xác URL ảnh tại trường `startPhotoUrl` của chặng KTV tương ứng.
3. **Trên Dispatch Board**:
   - Mở màn hình điều phối của Lễ tân, tìm card của booking vừa bắt đầu.
   - Xác nhận có ảnh nhỏ cạnh tên KTV. Click vào xem được ảnh phòng/khách phóng to chi tiết cùng thời gian chụp.
