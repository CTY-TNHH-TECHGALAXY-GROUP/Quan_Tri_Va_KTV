# Kế hoạch triển khai: Tính năng Chỉnh sửa Điểm Danh Thủ Công

Tính năng này cho phép Lễ tân hoặc Admin điều chỉnh trạng thái điểm danh (Vắng, Nghỉ phép, Nghỉ đột xuất) của KTV trực tiếp trên giao diện Bảng Lương (Payroll), nhằm khắc phục các sự cố quên Check-out hoặc sai lệch dữ liệu.

## User Review Required
> [!IMPORTANT]
> - Tính năng chỉnh sửa này sẽ can thiệp trực tiếp vào 2 bảng `KTVAttendance` và `KTVLeaveRequests`. 
> - Nếu chọn chuyển thành **"Nghỉ phép"** hoặc **"Nghỉ đột xuất"**, hệ thống sẽ tạo một bản ghi `APPROVED` trong `KTVLeaveRequests` để ghi đè (override) dữ liệu chấm công ngày hôm đó.
> - Nếu chọn chuyển thành **"Vắng mặt"**, hệ thống sẽ xoá các dữ liệu điểm danh và nghỉ phép của ngày đó.

## Open Questions
> [!WARNING]
> - Bạn có muốn giữ lại log thao tác (Ai là người đã sửa) không? (Hiện tại Admin Supabase có thể thực hiện thẳng, nhưng nếu cần truy vết, ta sẽ lưu `reviewedBy` vào `KTVLeaveRequests`).
> - Có cần tính năng sửa lại giờ Check-in / Check-out không, hay chỉ cần sửa Trạng thái (Vắng/OFF)? Trong kế hoạch này, tôi đề xuất chỉ làm tính năng thay đổi Trạng thái trước cho đơn giản và an toàn.

## Proposed Changes

---
### 1. Giao diện (UI) - Trang Payroll
#### [MODIFY] [Payroll.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/finance/payroll/Payroll.tsx)
- Thêm cột "Thao tác" (hoặc nút Edit nhỏ ở cuối mỗi dòng) trong bảng chi tiết chấm công.
- Tạo một Modal (Hộp thoại) `AttendanceEditModal` chứa Form chỉnh sửa:
  - Hiển thị ngày và tên KTV.
  - Dropdown chọn trạng thái mới: "Vắng mặt", "Nghỉ phép (Có phép)", "Nghỉ đột xuất".
- Tích hợp hàm `handleSaveOverride` gọi API.

#### [MODIFY] [Payroll.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/finance/payroll/Payroll.logic.ts)
- Thêm state quản lý `editingRecord` (bản ghi đang được chọn để sửa).
- Cập nhật hàm refresh để tải lại dữ liệu sau khi chỉnh sửa thành công.

---
### 2. Xử lý Logic (Backend API)
#### [NEW] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/finance/payroll/override/route.ts)
- Tạo API Endpoint: `POST /api/finance/payroll/override`.
- Xử lý các logic:
  - Nếu chuyển sang **"Vắng mặt"**: Xoá bản ghi trong `KTVLeaveRequests` (nếu có) và xoá các bản ghi `KTVAttendance` của ngày hôm đó để bảng lương ghi nhận là Absent.
  - Nếu chuyển sang **"Nghỉ phép / Nghỉ đột xuất"**: 
    - Thêm (hoặc cập nhật) 1 bản ghi vào bảng `KTVLeaveRequests` với `status: 'APPROVED'` và `is_sudden_off` tương ứng.
    - Xoá bản ghi `KTVAttendance` của ngày đó (nếu có) để tránh xung đột dữ liệu.

## Verification Plan

### Manual Verification
1. Mở trang Bảng Lương, tìm dòng của KTV NH025 vào ngày 18/05 (bị Quên Check-out).
2. Bấm nút Chỉnh sửa -> Chọn "Nghỉ phép".
3. Xác nhận và đợi bảng dữ liệu tải lại.
4. Kiểm tra dòng ngày 18/05 của NH025 đã chuyển thành "Nghỉ phép" (Màu xám) và bảng thống kê tổng số ngày OFF đã tăng lên.
