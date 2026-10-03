# Kế Hoạch Triển Khai: Hiển Thị Lịch Sử Gia Hạn & Nghỉ Đột Xuất (OFF)

**1. Cập nhật Interface (`app/reception/leave-management/LeaveManagement.logic.ts`)**
- Bổ sung trường `is_extension?: boolean` và `is_sudden_off?: boolean` vào interface `LeaveRequest` để TypeScript nhận diện các dữ liệu mở rộng trả về từ API.

**2. Gắn nhãn (Badge) lên UI (`app/reception/ktv-hub/page.tsx` & `app/reception/leave-management/page.tsx`)**
- Thêm điều kiện hiển thị badge kế bên mã KTV trong danh sách "Nhân sự OFF":
  - Nếu `leave.is_sudden_off === true`: Gắn badge màu đỏ với dòng chữ **ĐỘT XUẤT**.
  - Nếu `leave.is_extension === true` và không phải đột xuất: Gắn badge màu tím với dòng chữ **GIA HẠN**.
  - Định dạng hiển thị giúp quản lý và lễ tân dễ dàng nhận diện ngay khi xem danh sách.

**3. Hiển thị ngày giờ đăng ký**
- (Đã thực hiện ở bước trước) Tiếp tục duy trì dòng chữ nhỏ thể hiện `createdAt` để biết chính xác thời gian yêu cầu được tạo.

*Plan này đã được user đồng ý triển khai.*
