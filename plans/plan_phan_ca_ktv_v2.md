# Kế Hoạch Cập Nhật Phân Ca KTV: Bổ Sung Ca Tự Do & Khách Yêu Cầu

Kế hoạch này nhằm đáp ứng yêu cầu:
1. Bổ sung 2 ca mới là "Ca tự do" (FREE) và "Làm khách yêu cầu" (REQUEST).
2. Tích hợp tính năng cho phép KTV **tự chọn ca làm** khi thực hiện điểm danh (Check-in).
3. Nếu KTV không chọn ca khác, hệ thống sẽ tự động dùng ca đã gán sẵn.

## ⚠️ User Review Required

1. **Khung Giờ Của Ca Mới**: 
   - Hiện tại Ca 1 (09:00 - 17:00), Ca 2 (11:00 - 19:00), Ca 3 (17:00 - 00:00) có quy định giờ giấc rõ ràng để tính lỗi đi trễ và giờ tan ca hợp lệ.
   - Với **Ca tự do** và **Làm khách yêu cầu**, tôi dự định sẽ thiết lập **không giới hạn giờ** (00:00 - 24:00), tức là KTV có thể điểm danh và tan ca bất cứ lúc nào không bị báo đi trễ. Bạn có đồng ý với logic này không?

## 📝 Proposed Changes

### 1. Backend & Validation Layers
#### [MODIFY] [app/api/ktv/shift/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/shift/route.ts)
- Bổ sung `FREE` và `REQUEST` vào danh sách `SHIFT_TYPES` hợp lệ.
- Cho phép nhận và lưu các ca này vào database `KTVShifts`.

#### [MODIFY] [app/api/ktv/attendance/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/attendance/route.ts)
- Nhận thêm trường dữ liệu `selectedShiftType` từ client truyền lên khi Check-in.
- **Logic mới**: Trước khi ghi nhận Check-in, hệ thống kiểm tra xem `selectedShiftType` có khác với ca đang gán hiện tại không. Nếu khác (KTV tự đổi ca lúc điểm danh), API sẽ tự động tạo một bản ghi `KTVShifts` mới trạng thái `ACTIVE` (giống như Lễ tân gán ca) và đánh dấu ca cũ là `REPLACED`.

### 2. Giao Diện Quản Lý Ca (Admin/Reception)
#### [MODIFY] [app/reception/ktv-hub/page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/ktv-hub/page.tsx)
- Cập nhật `SHIFT_LABELS_HUB` để bao gồm 2 ca mới với màu sắc riêng biệt (VD: `Ca tự do` màu Xanh Mòng Két, `Khách yêu cầu` màu Hồng).
- Cập nhật các menu chọn ca gán cho KTV để có đủ 5 lựa chọn (Ca 1, 2, 3, Tự do, Khách YC).

#### [MODIFY] [app/reception/leave-management/page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/leave-management/page.tsx)
- Tương tự Hub, cập nhật `SHIFT_LABELS` và các dropdown gán ca để bao gồm 2 lựa chọn mới.

#### [MODIFY] [app/reception/leave-management/LeaveManagement.i18n.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/leave-management/LeaveManagement.i18n.ts)
- Bổ sung text định dạng ngôn ngữ cho `FREE` và `REQUEST`.

### 3. Giao Diện KTV Điểm Danh (Frontend)
#### [MODIFY] [app/ktv/attendance/Attendance.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/attendance/Attendance.logic.ts)
- Cập nhật `SHIFT_START_TIMES` và `SHIFT_END_TIMES` để cấp phép giờ giấc cho 2 ca mới.
- Khai báo state mới `selectedShiftType` cho Modal điểm danh.
- Sửa đổi hàm `handleAttendance` để truyền `selectedShiftType` lên API.

#### [MODIFY] [app/ktv/attendance/page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/attendance/page.tsx)
- Thêm một Dropdown (Khung chọn) "Ca làm việc hôm nay" vào Modal `CHECK_IN`.
- Giao diện này sẽ mặc định chọn ca đã gán (nếu có). KTV có thể tự bấm vào để đổi sang ca khác (VD đổi sang Ca Tự Do) trước khi bấm nút Gửi.

---

## 🔍 Verification Plan
1. **Kiểm tra giao diện Admin**: Lễ tân/Quản lý có thể gán `Ca tự do` hoặc `Khách yêu cầu` cho KTV thành công, màu sắc hiển thị đúng.
2. **Kiểm tra KTV Check-in**: Khi KTV mở app điểm danh, họ sẽ thấy ô Chọn Ca. Khi tự chọn ca khác và điểm danh thành công, ca mới sẽ ngay lập tức được cập nhật thành `ACTIVE` (thay vì phải đợi admin duyệt) và phản ánh chính xác lên Bàn Điều Phối (KTV Hub).
