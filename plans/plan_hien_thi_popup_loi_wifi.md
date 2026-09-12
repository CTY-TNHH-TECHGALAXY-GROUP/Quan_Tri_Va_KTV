# Kế hoạch: Hiển thị popup lỗi Wi-Fi cho KTV Dashboard

## Mục tiêu
Khắc phục lỗi trên iPhone không hiển thị popup thông báo lỗi khi nhân viên không kết nối đúng Wi-Fi Spa. Hiện tại chỉ hiển thị `Lỗi server (403)` thông qua `window.alert`.

## Chi tiết triển khai

### 1. `app/ktv/attendance/Attendance.logic.ts`
- Cập nhật hàm `handleAttendance`.
- Khi `!res.ok`, kiểm tra header `Content-Type` xem có phải JSON không.
- Nếu là JSON, parse `res.json()` và trích xuất trường `error` để lấy thông điệp trả về từ API (ví dụ: "Vui lòng kết nối vào mạng Wi-Fi của Spa...").
- Cập nhật state `errorMsg` với thông báo này.
- Loại bỏ `window.alert` mặc định của trình duyệt để xử lý UI bằng React Component.

### 2. `app/ktv/attendance/page.tsx`
- Bắt giá trị `errorMsg` từ hook `useKTVAttendance`.
- Xây dựng một Modal (Popup) hiển thị lỗi với giao diện rõ ràng (ví dụ: icon màu đỏ, text to rõ).
- Thêm nút "Đóng" để người dùng có thể tắt popup.

## Tình trạng
Đã được user duyệt, tiến hành code.
