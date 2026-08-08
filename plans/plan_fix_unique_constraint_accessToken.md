# Lỗi Unique Constraint: Bookings_accessToken_key

## Nguyên nhân gốc rễ (Root Cause)

Lỗi `duplicate key value violates unique constraint "Bookings_accessToken_key"` xảy ra do cột `accessToken` trong bảng `Bookings` được thiết kế để lưu **mã truy cập ngẫu nhiên và duy nhất** cho trang theo dõi dịch vụ của khách (Journey Page - ví dụ: `/vi/journey/{accessToken}`). Vì vậy, Supabase được cấu hình ràng buộc `UNIQUE` trên cột này.

Tuy nhiên, trong commit hôm qua (*cấu hình accessToken bảo mật tĩnh cho đơn hàng gửi sang Web quản lý*), dường như ở Web Booking (Customer App - `nganha.vercel.app`), bạn đã chỉnh sửa để truyền một chuỗi token bảo mật cố định (static token) vào trường `accessToken` khi tạo đơn. 

Khi đơn hàng đầu tiên được tạo, chuỗi tĩnh này được lưu thành công. Nhưng khi tạo đơn hàng thứ 2, do chuỗi tĩnh đó bị trùng lặp, Supabase báo lỗi vi phạm `UNIQUE constraint` và từ chối tạo đơn.

## Đề xuất giải pháp (Implementation Plan)

Vì ứng dụng lỗi là Customer App (`nganha.vercel.app`) - nơi chứa endpoint `/api/orders`, bạn cần sửa mã nguồn ở phía ứng dụng đó. Đây là 2 hướng xử lý:

### Phương án 1 (Khuyên dùng): Dùng Header để bảo mật, không lưu vào DB
Trường `accessToken` cần được trả về đúng bản chất là mã sinh ngẫu nhiên (hoặc bỏ trống để dùng mã booking id).
- **Bên Customer App**: Xoá dòng gán `accessToken: "STATIC_SECRET"` trong payload gửi lên DB hoặc thay bằng `crypto.randomUUID()`. Việc xác thực (nếu cần gửi sang Web quản lý qua Webhook) thì Webhook đã dùng `x-webhook-secret` trong header, không cần ghi static token vào DB.

### Phương án 2: Xoá ràng buộc Unique của accessToken (Không khuyến khích)
Nếu bạn thực sự muốn dùng cột `accessToken` lưu chuỗi cố định.
- Chạy câu lệnh SQL trên Supabase để xoá ràng buộc: 
  `ALTER TABLE "Bookings" DROP CONSTRAINT IF EXISTS "Bookings_accessToken_key";`
- *Rủi ro*: Tính năng quét QR code cho khách xem lộ trình (Journey Page) có thể bị lỗi vì nhiều đơn trùng chung 1 accessToken.

Bạn muốn giải quyết theo hướng nào? Do app gây lỗi là Web Đặt lịch của Khách (`nganha.vercel.app`), nếu codebase đó nằm chung trong project này, tôi có thể sửa giúp bạn. Nếu nó nằm ở project khác, bạn cần mở project đó ra để sửa hoặc chọn **Phương án 2** để tôi xoá Ràng buộc DB từ project này.
