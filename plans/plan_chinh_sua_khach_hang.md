# Kế hoạch: Bổ sung tính năng sửa thông tin Khách hàng & Tự động cập nhật email

## 1. Vấn đề hiện tại
1. **Trang báo cáo khách hàng (CRM)** hiện tại chỉ cho phép sửa ghi chú, giới tính, quốc tịch, và ngôn ngữ, chưa cho phép sửa trực tiếp Tên, SĐT, và Email.
2. Khi khách hàng có email ảo (nhập `aa`, `00` hoặc tự sinh) nhưng sau đó gửi đơn bằng Web Booking hoặc được tạo đơn với email thật, hệ thống vẫn giữ email ảo cũ mà không tự động ghi đè (update) bằng email thật mới.
3. Cần thay đổi format tự động sinh email khi khách để trống/nhập sai (từ `GUEST-xxx` thành có chứa ký tự `@guest...`).

## 2. Chi tiết các bước triển khai

### Bước 1: Mở rộng Schema và API cho phép cập nhật thông tin
- **File**: `lib/schemas/crm.schema.ts`
  - Thêm tuỳ chọn `fullName`, `phone`, `email` vào `CustomerPatchSchema`.
- **File**: `app/api/customers/route.ts`
  - Bổ sung logic trích xuất `fullName`, `phone`, `email` từ body và đưa vào payload update lên Supabase.

### Bước 2: Cập nhật giao diện CRM
- **File**: `app/reception/crm/page.tsx`
  - Trong component `CustomerRow`: Mở rộng form edit để chứa thêm input chỉnh sửa **Tên**, **SĐT**, và **Email**.
  - Đưa các trường này vào hàm `handleSave` khi call API PATCH.

### Bước 3: Tự động cập nhật email thật khi tạo/xác nhận đơn mới & Sinh email ảo có chữ @
- **File 1**: `lib/customer.logic.ts`
  - Cập nhật hàm `isDummyEmail` để nhận diện thêm các email có đuôi `@guest.com` (hoặc tương tự) là email ảo.
- **File 2**: `lib/services/BookingModificationService.ts` (Hàm `createQuickBooking`)
  - **Tạo mới**: Đổi logic tự sinh email ảo thành `guest[dãy số]@guest.com` (ví dụ: `guest1712345678@guest.com`).
  - **Ghi đè**: Khi map được với một `customerId` cũ, nếu phát hiện email cũ trong DB là email ảo (thông qua hàm `isDummyEmail`) mà email mới nhập vào là thật, thì chạy lệnh `update` đè email thật mới vào bảng `Customers`.
- **File 3**: `app/reception/web-booking/actions.ts` (Hàm `confirmWebBooking`)
  - Nếu khách đang dùng email ảo mà trên đơn Web Booking có email thật, tự động update email thật vào bảng `Customers`.
