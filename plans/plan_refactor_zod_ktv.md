# Kế hoạch Refactor API bằng Zod (Giai đoạn 1: KTV)

Tiếp nối thành công của bản nháp đầu tiên, ở Giai đoạn 1 này chúng ta sẽ tập trung dọn dẹp và chuẩn hóa dữ liệu đầu vào cho nhóm API quan trọng nhất - **API dành cho Kỹ Thuật Viên (KTV)**. Đây là luồng chịu nhiều tương tác từ Mobile/Web nhất hàng ngày.

## Proposed Changes

---

### [NEW] `lib/schemas/ktv.schema.ts`
Tạo một file chung chứa toàn bộ Zod schema dành riêng cho các API KTV để dễ quản lý.
- **AttendanceSchema:** Kiểm tra `employeeId`, `checkType`, `latitude`, `longitude`, `photoBase64`, v.v.
- **ShiftRequestSchema:** Kiểm tra thao tác xin đổi ca / gán ca (`employeeId`, `shiftType`, `reason`).
- **ShiftPatchSchema:** Kiểm tra thao tác duyệt/từ chối ca của Admin (`shiftId`, `action`).
- **LeaveRequestSchema:** Kiểm tra thao tác xin nghỉ (`employeeId`, `reason`, `date`, `is_extension`).

---

### Refactor API Controllers
Thay thế toàn bộ các block `if/else` kiểm tra thủ công bằng `[Schema].safeParse(body)`.

#### [MODIFY] `app/api/ktv/attendance/route.ts`
- Áp dụng `AttendanceSchema` cho request POST.
- Loại bỏ các dòng `if (!employeeId)` cũ.

#### [MODIFY] `app/api/ktv/shift/route.ts`
- Áp dụng `ShiftRequestSchema` cho hàm POST.
- Áp dụng `ShiftPatchSchema` cho hàm PATCH.
- Xử lý mượt mà các check rườm rà như `if (!['APPROVE', 'REJECT'].includes(action))`.

#### [MODIFY] `app/api/ktv/leave/route.ts`
- Áp dụng `LeaveRequestSchema` cho thao tác POST xin nghỉ.
