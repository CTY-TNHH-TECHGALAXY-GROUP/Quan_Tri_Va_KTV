# Kế hoạch khắc phục lỗi hiển thị Ca Tự Do bị đẩy vào Ca 1

## 1. Nguyên nhân gốc rễ (Root Cause)
Khi Quản lý (Admin) gán một KTV vào "Ca tự do", hệ thống ghi nhận `shiftType` là `FREE`. 
Tuy nhiên, trong API lấy danh sách ca làm việc (`app/api/ktv/shift/route.ts`), hệ thống đang có một cơ chế tự động dọn dẹp các ca "tạm thời" qua ngày:
```typescript
const isTempShift = shift.reason === 'Tự chọn ca lúc điểm danh' || shift.shiftType === 'FREE' || shift.shiftType === 'REQUEST';
```
Do có điều kiện `shift.shiftType === 'FREE'`, hệ thống tự động đánh đồng **tất cả** các "Ca tự do" (bao gồm cả ca cố định do Admin gán) là ca tạm thời. Hậu quả là qua ngày hôm sau, hệ thống tự động khôi phục các ca này về ca mặc định (thường là `SHIFT_1` - Ca 1).

## 2. Giải pháp thực hiện (Proposed Changes)
Chỉ cần chỉnh sửa lại điều kiện nhận diện ca tạm thời (`isTempShift`). Chúng ta sẽ loại bỏ việc kiểm tra cứng theo loại ca `FREE` hay `REQUEST`, mà chỉ dựa vào lý do sinh ra ca đó.

### [MODIFY] `app/api/ktv/shift/route.ts`
Sửa lại 3 chỗ định nghĩa biến `isTempShift`:
- **Từ:** `const isTempShift = shift.reason === 'Tự chọn ca lúc điểm danh' || shift.shiftType === 'FREE' || shift.shiftType === 'REQUEST';`
- **Thành:** `const isTempShift = shift.reason === 'Tự chọn ca lúc điểm danh';`

*Tương tự cho `activeShift` ở dòng 211.*

Với thay đổi này:
- Ca tự do được KTV tự chọn lúc điểm danh (có reason là `'Tự chọn ca lúc điểm danh'`) vẫn sẽ tự reset qua ngày.
- Ca tự do do Admin gán (có reason là `'Admin gán ca'` hoặc khác) sẽ được giữ nguyên vĩnh viễn và hiển thị đúng vào cột "Ca tự do" như mong đợi.
