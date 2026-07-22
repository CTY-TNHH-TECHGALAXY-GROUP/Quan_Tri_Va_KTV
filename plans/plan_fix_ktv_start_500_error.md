# Kế hoạch khắc phục: Sửa lỗi 500 khi bắt đầu dịch vụ và Đồng bộ ảnh Check-in

## 1. Phân tích nguyên nhân gốc rễ (Root Cause)

1. **Client chưa truyền `photoBase64` lên Server**:
   - Tại file [KTVDashboard.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan Ha/Quan_Tri_Va_KTV/app/ktv/dashboard/KTVDashboard.logic.ts), hàm `handleStartTimer` thực hiện gọi API PATCH `/api/ktv/booking` nhưng chưa đính kèm trường `photoBase64: startPhotoBase64` vào body JSON gửi lên. Do đó, API backend nhận được request nhưng không có ảnh chụp của KTV.
2. **Lỗi 500 Internal Server Error ở backend**:
   - Khi KTV bấm bắt đầu, backend xử lý tại file [handleStartTimer.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/booking/_handlers/handleStartTimer.ts) thực hiện cập nhật lại `estimated_end_time` trong bảng `TurnQueue` dựa trên công thức:
     `durationMins = (estimated_end_time - start_time)`
     `estimated_end_time = actual_start_time + durationMins`
   - Quá trình này sử dụng hàm `.split(':')` để tách giờ và phút từ `start_time` và `estimated_end_time` của `TurnQueue`. 
   - **Rủi ro**: Nếu các cột `start_time` hoặc `estimated_end_time` trong database bị rỗng, null, hoặc có định dạng đặc thù không chứa dấu `:`, việc phân tách sẽ tạo ra giá trị `NaN` (Not a Number).
   - Khi đó, biến `estimated_end_time` mới tính ra sẽ có dạng `"NaN:NaN:00"`. Khi cập nhật chuỗi không hợp lệ này vào trường có kiểu dữ liệu `TIME` trong database Postgres, Postgres sẽ từ chối và ném lỗi cú pháp, khiến API crash và phản hồi mã lỗi 500.

---

## 2. Giải pháp đề xuất (Proposed Changes)

### 📂 Client-side: [KTVDashboard.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/dashboard/KTVDashboard.logic.ts)

- **Cập nhật hàm `handleStartTimer`**:
  - Lấy biến state `startPhotoBase64` đính kèm vào payload gửi lên API PATCH `/api/ktv/booking` dưới trường `photoBase64`.
  - Khi API phản hồi thành công (`res.success === true`), gọi `setStartPhotoBase64(null)` để xóa ảnh preview và dọn dẹp bộ nhớ tạm (`localStorage`) nhằm chuẩn bị cho lần check-in tiếp theo.

### 📂 Backend-side: [handleStartTimer.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/booking/_handlers/handleStartTimer.ts)

- **Cải tiến logic tính thời gian `TurnQueue`**:
  - Bọc toàn bộ khối tính toán `TurnQueue.estimated_end_time` trong một block `try-catch` để đảm bảo nếu có lỗi tính toán, API vẫn hoàn thành việc chuyển trạng thái đơn hàng (an toàn tuyệt đối, tránh crash 500).
  - Thêm các bước kiểm tra an toàn dữ liệu đầu vào:
    - Kiểm tra `turnForSync.start_time` và `estEnd` có tồn tại và hợp lệ trước khi split.
    - Dùng `isNaN()` kiểm tra từng biến giờ/phút (`sh`, `sm`, `eh`, `em`, `nh`, `nm`) sau khi chuyển đổi sang kiểu số. Chỉ khi các phần tử đều hợp lệ mới tiến hành cập nhật thời gian.

---

## 3. Kế hoạch kiểm thử (Verification Plan)

### Kiểm thử Tự động (Mô phỏng qua Script)
- Viết/chạy script Node.js giả lập gọi PATCH API với đầy đủ các trường hợp:
  1. Gửi kèm `photoBase64` hợp lệ.
  2. Gửi KHÔNG có `photoBase64`.
  3. Kiểm tra trường hợp `start_time` của TurnQueue bị rỗng hoặc lỗi định dạng xem hệ thống có xử lý an toàn không.

### Kiểm thử Thủ công (User Test)
- Yêu cầu KTV App chụp ảnh check-in -> Nhấn nút **Bắt đầu phục vụ**.
- Xác nhận API `/api/ktv/booking` phản hồi thành công (status 200).
- Xác nhận ảnh check-in biến mất khỏi giao diện preview của KTV.
- Kiểm tra Dispatch Board trên giao diện Lễ tân xem ảnh check-in có hiển thị chính xác ở card KTV hay không.
