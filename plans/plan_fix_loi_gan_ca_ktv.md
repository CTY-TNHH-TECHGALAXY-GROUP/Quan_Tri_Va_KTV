# Kế hoạch Khắc Phục Lỗi Gán Ca & Font Chữ KTV Hub

Kế hoạch này nhằm giải quyết 3 vấn đề bạn vừa báo cáo:
1. Bị lỗi font chữ hiển thị "Làm khách yêu cầu"
2. Lỗi không gán được ca tự do (Database Constraint Error)
3. Không gán được ca tự do cho nhân viên đang OFF (NH016)

## 🔍 Nguyên nhân gốc rễ (Root Cause)

1. **Lỗi font chữ:** Trong file `app/reception/ktv-hub/page.tsx` ở dòng 1034, chuỗi text bị lỗi encoding thành `'Lm khch yu c?u'`. Điều này làm UI hiển thị sai.
2. **Lỗi không gán được ca:** Database table `KTVShifts` hiện tại đang có quy tắc chặn (`CHECK CONSTRAINT` tên là `KTVShifts_shiftType_check`). Nó chỉ cho phép lưu giá trị là `SHIFT_1`, `SHIFT_2` và `SHIFT_3`. Do đó khi chọn "Ca tự do" (`FREE`) hoặc "Làm khách yêu cầu" (`REQUEST`), database ngay lập tức từ chối, văng ra lỗi đỏ như trong hình.
3. **Lỗi NH016 đang OFF không gán được:** Thực chất đây **không phải** do lỗi logic chặn nhân viên OFF. Việc không gán được là **hệ quả của lỗi số 2** (Database từ chối nhận). Khi bạn gán "Ca tự do", thao tác bị sụp (crash) ở tầng DB nên UI không thể lưu thành công.

## 🛠️ Proposed Changes

### UI & Frontend 
Thay thế chuỗi bị lỗi encoding thành tiếng Việt chuẩn.

#### [MODIFY] page.tsx
- Tìm biến `SHIFT_LABELS_HUB`.
- Thay dòng `REQUEST: 'Lm khch yu c?u',` thành `REQUEST: 'Làm khách yêu cầu',`.

### Database Schema (Supabase)
Tạo script mở rộng Check Constraint để cho phép 2 loại ca mới. User sẽ tự chạy script này trên SQL Editor của Supabase.

#### [NEW] migration sql
```sql
-- Gỡ bỏ constraint cũ
ALTER TABLE public."KTVShifts" DROP CONSTRAINT IF EXISTS "KTVShifts_shiftType_check";

-- Thêm constraint mới hỗ trợ FREE và REQUEST
ALTER TABLE public."KTVShifts" ADD CONSTRAINT "KTVShifts_shiftType_check" 
CHECK ("shiftType" IN ('SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'FREE', 'REQUEST'));
```
