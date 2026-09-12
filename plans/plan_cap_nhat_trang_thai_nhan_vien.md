# Kế Hoạch Triển Khai: Cập nhật trạng thái nhân viên Đã Nghỉ (Inactive Staff)

## 1. Mô Tả Yêu Cầu
Khi admin cập nhật trạng thái làm việc của nhân viên thành **"Đã nghỉ" / "Không hoạt động"**, hệ thống cần đảm bảo:
- Không trừ tiền bảo trì KTV app. *(Đã đáp ứng sẵn trong cron job)*
- Không tính lỗi phạt "Nghỉ đột xuất" (Sudden Off).
- Không hiển thị KTV đó trong **Lịch ca làm việc (Shift Schedule / KTV Hub)**.
- Không hiển thị KTV đó trên menu đặt lịch của khách hàng VIP/Trị liệu.

## 2. Các Thay Đổi Cần Thực Hiện

### 2.1. Thêm tính năng đổi trạng thái ở Modal Nhân Viên
- **File:** `components/EmployeeDetailModal.tsx`
- **Thay đổi:** Ở trạng thái `isEditing = true`, cho phép admin chọn trạng thái nhân viên là **Đang hoạt động** hoặc **Đã nghỉ** (thay vì chỉ hiển thị badge cứng như hiện tại).

### 2.2. Xử lý Logic Backend khi cập nhật trạng thái
- **File:** `app/admin/employees/actions.ts` (Hàm `updateStaffMember`)
- **Thay đổi:** Khi nhận được yêu cầu cập nhật trạng thái thành `"Đã nghỉ"` (`inactive`):
  - Tự động gán `is_active_vip_menu = false` và `is_home_spa = false` (đáp ứng "không hiển thị menu vi").
  - Xoá nhân viên khỏi **TurnQueue** hiện tại để không vô tình nhận tua.

### 2.3. Lọc nhân viên Đã nghỉ khỏi Màn hình KTV Hub & Phân Ca
- **File:** `app/reception/ktv-hub/page.tsx`
- **Thay đổi:** Trong hàm fetch dữ liệu `getStaffList()`, lọc và chỉ hiển thị những nhân viên có `status === 'ĐANG LÀM'`. Việc này sẽ ẩn KTV khỏi:
  - Danh sách KTV chưa gán ca.
  - Sổ tua (Turn Queue Board).
  - Lịch gán ca (Assign Modal).

### 2.4. Ngăn chặn tính lỗi phạt Nghỉ đột xuất
- **Phân tích:** Các lỗi phạt nghỉ đột xuất thường sinh ra do admin duyệt yêu cầu hoặc KTV vắng mặt so với lịch ca đã xếp. Bằng việc ẩn hoàn toàn KTV khỏi ca làm việc và KTV Hub ở bước trên, hệ thống sẽ **tự động không tính** phạt nghỉ đột xuất nữa vì không ai điểm danh hay xếp ca cho người đã nghỉ.
