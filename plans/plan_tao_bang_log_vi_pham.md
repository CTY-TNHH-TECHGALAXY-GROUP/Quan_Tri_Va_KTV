# Kế Hoạch Triển Khai: Bảng Security Audit Logs (Lịch sử bảo mật)

Mục tiêu: Tạo một bảng cơ sở dữ liệu mới để lưu trữ vĩnh viễn các sự kiện bảo mật như: đăng nhập sai tài khoản/mật khẩu, hoặc KTV cố tình điểm danh/tan ca bằng mạng lạ (không phải Wifi của Spa).

## User Review Required

> [!IMPORTANT]  
> Bạn vui lòng xem qua các trường thông tin của bảng `SecurityAuditLogs` và tên các sự kiện (`event_type`). Nếu bạn đồng ý, mình sẽ tiến hành tạo bảng và cập nhật code.

## Proposed Changes

### 1. Cơ sở dữ liệu (Supabase)

Tạo một bảng mới tên là `SecurityAuditLogs` với cấu trúc như sau:

- `id`: uuid (Khóa chính tự sinh)
- `employee_id`: text (Mã nhân viên / ID nhân viên nếu có, hoặc `unknown` nếu đăng nhập sai user)
- `employee_name`: text (Tên nhân viên hoặc username cố gắng đăng nhập)
- `event_type`: text (Phân loại sự kiện)
  - `INVALID_WIFI_IP`: Bị từ chối điểm danh/tan ca do dùng sai mạng Wifi.
  - `INVALID_LOGIN`: Đăng nhập thất bại (sai username hoặc mật khẩu).
- `ip_address`: text (Địa chỉ IP của thiết bị thực hiện)
- `user_agent`: text (Thông tin trình duyệt/ứng dụng)
- `details`: jsonb (Các thông tin thêm, ví dụ: loại điểm danh `CHECK_IN`, `CHECK_OUT`, hoặc lý do lỗi chi tiết)
- `created_at`: timestamptz (Thời gian xảy ra sự kiện, mặc định là hiện tại)

Tạo file migration SQL:
#### [NEW] [create_security_audit_logs.sql](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/supabase/migrations/create_security_audit_logs.sql)

Cập nhật tài liệu Schema:
#### [MODIFY] [TableInSupabase.md](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/TableInSupabase.md)
Thêm bảng `SecurityAuditLogs` vào nhóm **Auth & Push**.

---

### 2. Cập nhật Code Logic

#### [MODIFY] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/attendance/route.ts)
- Thay đổi logic khi KTV bị từ chối IP Wifi.
- Thay vì chỉ lưu đè vào `SystemConfigs` (`spa_wifi_last_rejected_ip`), hệ thống sẽ insert 1 record vào bảng `SecurityAuditLogs` với `event_type = 'INVALID_WIFI_IP'`.
- Lưu thêm thông tin `user_agent` từ headers.

#### [MODIFY] [actions.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/login/actions.ts)
- Bổ sung logic lấy IP (`x-forwarded-for`, `x-real-ip`) và `user-agent` từ `next/headers`.
- Khi người dùng đăng nhập sai (không tìm thấy user hoặc sai mật khẩu), tự động insert 1 record vào `SecurityAuditLogs` với `event_type = 'INVALID_LOGIN'`.

## Verification Plan

### Manual Verification
- Dùng một tài khoản bất kỳ để đăng nhập sai mật khẩu -> Kiểm tra bảng `SecurityAuditLogs` xem có record `INVALID_LOGIN` không.
- Thử điểm danh/tan ca bằng một thiết bị nằm ngoài mạng Wifi của Spa -> Kiểm tra bảng `SecurityAuditLogs` xem có record `INVALID_WIFI_IP` không.
