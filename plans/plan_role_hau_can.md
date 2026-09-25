# Kế hoạch triển khai Role: Hậu Cần (Logistics/Support)
**Đã phê duyệt bởi User**

## 1. Yêu cầu đã chốt
1. **Tên Role:** \SUPPORT\
2. **Điểm danh chụp ảnh (Không trừ phạt):** 
   - Vẫn dùng luồng điểm danh hiện tại của KTV.
   - Bỏ qua check \isLate\ (cảnh báo đi muộn trên UI) đối với \ole === 'SUPPORT'\.
   - Về phía backend (trừ tiền), hệ thống tự động trừ tiền dựa trên \eature_flags.laundry_deduction\ và \sudden_leave_penalty\. Do đó chỉ cần đảm bảo không bật các cờ này cho nhân viên Support.

*(Ghi chú: Các tính năng Checklist Công Việc và Chụp ảnh bàn giao phòng sẽ được làm ở pha sau theo yêu cầu của user).*

## 2. Các file đã sửa
1. **\supabase_types.ts\**: Thêm \SUPPORT\ vào enum \Role\.
2. **\pp/admin/roles/actions.ts\**: Cập nhật mapping \DB_ROLE_TO_LOCAL\ và \ROLE_ID_TO_DB\ cho role \SUPPORT\.
3. **\pp/admin/roles/Roles.logic.ts\**: Thêm template phân quyền mặc định cho \Hậu Cần / Support\.
4. **\pp/ktv/attendance/Attendance.logic.ts\**: Bỏ qua cảnh báo đi muộn (\isLate\) đối với \user.role === 'SUPPORT'\.
