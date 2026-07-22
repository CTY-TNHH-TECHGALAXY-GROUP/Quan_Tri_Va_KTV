# Kế hoạch Đơn giản hoá Phân loại Tay nghề KTV & Cập nhật danh sách

Yêu cầu: 
1. Không phân loại tay nghề KTV thành nhiều cấp độ (chuyên, cơ bản, đào tạo...) nữa, chỉ giữ lại 2 trạng thái: **Có tay nghề** hoặc **Không có**.
2. **Cập nhật danh sách tay nghề**: Xoá mục "Manicure + Pedicure", bổ sung thêm "Nail Combo" và "Nail Chuyên".

## User Review Required

> [!WARNING]
> Việc chuyển đổi này sẽ biến toàn bộ dữ liệu tay nghề dạng text (ví dụ: `"expert"`, `"basic"`, `"none"`) thành dạng `boolean` (`true`/`false`). Hệ thống sẽ tự động convert dữ liệu cũ trên giao diện, và ghi đè thành `boolean` khi bạn lưu hồ sơ nhân viên. Khách hàng xem qua app sẽ không còn thấy đánh dấu "Chuyên gia" nữa. Bạn có đồng ý với sự thay đổi này không?

## Proposed Changes

### 1. `lib/types.ts`
Cập nhật lại kiểu dữ liệu của `SkillLevel` thành `boolean` và thay đổi danh sách kỹ năng trong interface `EmployeeSkills`.
#### [MODIFY] [types.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/lib/types.ts)
- Đổi `export type SkillLevel = 'none' | 'basic' | 'expert' | 'training';` thành `export type SkillLevel = boolean;`
- Trong `EmployeeSkills`: 
  - Xoá `maniPedi: SkillLevel;`
  - Thêm `nailCombo: SkillLevel;` và `nailChuyen: SkillLevel;`

---

### 2. `app/admin/employees/Employees.logic.ts`
Chuyển đổi dữ liệu cũ từ Supabase thành dạng boolean để Frontend có thể hiển thị mượt mà, đồng thời cập nhật danh sách mặc định.
#### [MODIFY] [Employees.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/admin/employees/Employees.logic.ts)
- Thay đổi `DEFAULT_SKILLS` thành các giá trị `true`/`false`. Xoá `maniPedi`, thêm `nailCombo: false` và `nailChuyen: false`.
- Trong hàm `fetchEmployees`, thêm bước map dữ liệu lấy từ Database: nếu skill cũ có dạng `'basic'`, `'expert'`, `'training'` hoặc `true` thì quy đổi thành `true`. Các trường hợp khác (`'none'`, `false`, `undefined`) thành `false`.

---

### 3. Các Modal Thêm/Sửa Nhân Viên
Sửa giao diện từ việc "bấm nhiều lần để nhảy qua các cấp độ" thành "bấm để bật/tắt (toggle) tay nghề". Cập nhật nhãn (label) hiển thị.
#### [MODIFY] [AddEmployeeModal.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/components/AddEmployeeModal.tsx)
- Xoá `maniPedi: 'Manicure + Pedicure'` khỏi `skillLabels`.
- Thêm `nailCombo: 'Nail Combo'` và `nailChuyen: 'Nail Chuyên'` vào `skillLabels`.
- Định nghĩa lại `levelInfo` thành dạng Map cho `true` ("Có tay nghề") và `false` ("Chưa có").
- Chỉnh sửa hàm `toggleSkill` thành logic đảo ngược giá trị boolean: `!currentValue`.
- Đổi các giá trị trong `DEFAULT_SKILLS` sang `false`.

#### [MODIFY] [EmployeeDetailModal.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/components/EmployeeDetailModal.tsx)
- Cập nhật danh sách `skillLabels` giống với `AddEmployeeModal.tsx` (Xoá maniPedi, thêm Nail Combo, Nail Chuyên).
- Áp dụng các thay đổi tương tự `AddEmployeeModal.tsx` để UI thống nhất.
- Bỏ các màu sắc của "chuyên/đào tạo", dùng màu mặc định (`emerald` cho Có và `gray` cho Chưa có).

---

### 4. Màn hình Phân Tua (Dispatch)
Giao diện phân tua KTV sẽ không còn huy hiệu "Chuyên gia" màu vàng nữa, thay vào đó chỉ kiểm tra KTV có tay nghề làm dịch vụ đó hay không.
#### [MODIFY] [DispatchStaffRow.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/dispatch/_components/DispatchStaffRow.tsx)
- Cập nhật logic biến `hasSkill` thành kiểm tra `turn.staff?.skills?.[targetSkill] === true`.
- Gỡ bỏ hoàn toàn logic và giao diện hiển thị sao vàng `isExpert` / "Chuyên gia".
- Chỉ giữ lại huy hiệu "Đạt yêu cầu" (màu xanh lá) đối với những KTV có tay nghề được chọn.

## Verification Plan

### Manual Verification
- Mở danh sách nhân viên, bấm vào xem chi tiết: Kiểm tra xem mục `Manicure + Pedicure` đã biến mất và được thay thế bằng `Nail Combo` và `Nail Chuyên` hay chưa.
- Thử thêm mới / chỉnh sửa kỹ năng của 1 nhân viên: Chỉ cần click 1 lần là đổi qua lại giữa Có/Không. Các kỹ năng lúc trước là "Chuyên", "Cơ bản", "Đào tạo" phải hiển thị là "Có tay nghề". Các kỹ năng "Chưa có" sẽ hiển thị "Chưa có". Lưu lại và reload page xem dữ liệu boolean lưu vào Supabase thành công chưa.
- Mở màn hình Phân tua: Kiểm tra lúc gõ tìm KTV xem danh sách gợi ý còn hiện icon sao vàng "Chuyên gia" không, thay vào đó tất cả nhân viên có kỹ năng chỉ cần đánh dấu là đạt chuẩn.
