# Kế Hoạch Triển Khai: Chặn nhân viên tan ca khi chưa hoàn thành công việc

Tính năng này đảm bảo rằng nhân viên không thể bấm "Tan ca" (hoặc "Xin nghỉ đột xuất về sớm") nếu họ vẫn còn các công việc trong ngày chưa được Admin đánh giá là **PASSED** (Nghiệm thu đạt).

## Phân Tích Logic
- **Bảng `Tasks`**: Mỗi đầu việc của nhân viên được lưu tại đây. Trạng thái nghiệm thu được lưu ở cột `inspection_status`. Nếu chưa nghiệm thu hoặc bị yêu cầu làm lại, trạng thái này sẽ khác `PASSED`.
- **API `GET /api/ktv/attendance/status`**: Trả về trạng thái hiện tại của nhân viên để hiển thị UI. Ta sẽ thêm logic đếm số lượng công việc chưa `PASSED` của nhân viên trong ngày (`incompleteTasksCount`).
- **UI Giao Diện (`page.tsx`)**: 
  - Đọc `incompleteTasksCount` từ API.
  - Nếu `incompleteTasksCount > 0`, nút "Tan Ca" sẽ bị vô hiệu hoá (màu xám) và hiển thị cảnh báo: *"⚠️ Bạn còn X công việc chưa được Admin nghiệm thu (Passed)."*
- **API `POST /api/ktv/attendance`**: Chặn hoàn toàn ở phía Backend. Nếu nhân viên cố tình hack UI để gọi API Tan Ca, Backend vẫn quét bảng `Tasks`. Nếu còn việc chưa `PASSED`, Backend sẽ từ chối và trả về HTTP 403 Forbidden.

> [!IMPORTANT] 
> **Lưu ý quy trình:**
> - Nhân viên làm xong việc -> Chuyển trạng thái thành "Chờ nghiệm thu".
> - Nút Tan Ca lúc này **VẪN BỊ KHOÁ**.
> - Chỉ khi nào Admin bấm "Pass" (Đạt) tất cả các việc của nhân viên đó trong ngày, nút Tan Ca mới mở ra để nhân viên bấm.

## Các File Cần Chỉnh Sửa

### [MODIFY] `app/api/ktv/attendance/status/route.ts`
- Thêm đoạn truy vấn đếm số lượng công việc chưa đạt (khác `PASSED`) của nhân viên trong ngày.
- Trả về biến `incompleteTasksCount` cho Frontend.

### [MODIFY] `app/api/ktv/attendance/route.ts`
- Tại luồng xử lý `checkType === 'CHECK_OUT'` (bao gồm cả Tan Ca chuẩn và Xin về sớm), truy vấn database kiểm tra công việc.
- Nếu còn công việc chưa `PASSED`, chặn và trả về lỗi 403.

### [MODIFY] `app/ktv/attendance/Attendance.logic.ts`
- Nhận thêm biến `incompleteTasksCount` từ API Status và đưa vào State của trang.

### [MODIFY] `app/ktv/attendance/page.tsx`
- Đổi màu nút "Tan Ca" thành xám, disable nút nếu `incompleteTasksCount > 0`.
- Hiển thị Text cảnh báo giải thích lý do không thể tan ca.
- Áp dụng tương tự cho KTV Loại B (nếu họ cũng có Task).

## ❓ Câu Hỏi Mở (Cần Bạn Chốt)
1. **Xin về sớm đột xuất**: Nếu một nhân viên bị ốm đột xuất giữa ca và buộc phải xin về sớm. Lúc này họ chắc chắn không thể làm xong việc. Hệ thống hiện tại sẽ **chặn luôn** không cho bấm "Xin về sớm". Quản lý sẽ phải vào xoá bớt việc cho nhân viên đó thì họ mới bấm về sớm được. Bạn có đồng ý với quy trình khắt khe này không, hay muốn chừa một đường lui cho trường hợp "Xin nghỉ đột xuất"?

Xin vui lòng duyệt kế hoạch để tôi tiến hành hoàn thiện!
