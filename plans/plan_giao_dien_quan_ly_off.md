# Refactor Manager Leave Management Page

Mục tiêu: Đưa giao diện quản lý lịch OFF của Lễ tân/Quản lý sang dạng Lịch (Calendar) tương tự như giao diện của KTV, vì hiện tại lịch OFF đã được tự động duyệt, Quản lý chỉ cần xem trực quan trên lịch và có quyền xoá (huỷ) ngày OFF nếu cần.

## Đề xuất thay đổi

### 1. `app/reception/leave-management/LeaveManagement.logic.ts`
- **Xoá** các logic liên quan đến `viewMode` (Ngày, Tuần, Tháng) và `offset`.
- **Thêm** logic quản lý tháng hiện tại của lịch (`calendarMonth`) tương tự như bên KTV.
- **Sửa** hàm `fetchLeaveList` để lấy dữ liệu toàn bộ ngày OFF trong tháng hiện tại (từ mùng 1 đến cuối tháng).
- **Giữ lại** hàm `handleDelete` để Quản lý có thể huỷ lịch OFF. Các hàm `handleAction` (Duyệt/Từ chối) có thể ẩn hoặc bỏ đi vì KTV đăng ký đã tự động duyệt.

### 2. `app/reception/leave-management/page.tsx`
- **Thay thế** component `OffTab` cũ bằng một giao diện Lịch trực quan.
- **Trên Lịch:** 
  - Hiển thị các chấm màu (hoặc số lượng) biểu thị có bao nhiêu KTV đang OFF trong ngày đó.
  - Các ngày lễ bị khoá (30/4, 1/5...) cũng sẽ hiển thị màu xám.
- **Tương tác:**
  - Quản lý bấm vào một ngày bất kỳ trên lịch.
  - Bên dưới lịch sẽ hiển thị danh sách chi tiết các KTV đang OFF trong ngày đó.
  - Tại mỗi KTV trong danh sách, Quản lý có một nút 🗑️ **Xoá** để có thể huỷ lịch OFF của KTV đó nếu cần.

## User Review Required
- Với cơ chế tự động duyệt mới, Quản lý sẽ không còn thấy danh sách "Chờ duyệt" nữa, mà chỉ bấm vào lịch để xem "Hôm nay ai OFF" và xoá nếu cần. Bạn có đồng ý với luồng này không?
- Phần quản lý Ca làm (Shift Management) vẫn giữ nguyên tab kế bên chứ không thay đổi gì đúng không?

Vui lòng phản hồi để tôi tiến hành code ngay!
