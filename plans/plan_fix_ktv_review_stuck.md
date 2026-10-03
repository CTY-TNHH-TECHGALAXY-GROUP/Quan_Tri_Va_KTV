# Kế hoạch & Kiến trúc: Fix KTV Stuck ở màn hình Review

## 1. Mô tả vấn đề (Problem Statement)
Toàn bộ KTV trong hệ thống gặp hiện tượng bị kẹt tại màn hình **Đánh giá khách hàng (REVIEW)**. Khi click "Lưu hồ sơ", KTV không thể thoát khỏi màn hình này, hoặc sau khi chuyển sang màn hình khác và bị refresh thì lại bị kéo ngược về màn hình REVIEW, dẫn đến việc không thể kích hoạt lệnh giải phóng (`RELEASE_KTV`) và không thể nhận đơn mới.

## 2. Nguyên nhân gốc rễ (Root Causes)
- **Thiếu `status` gây lỗi 400:** Route `PATCH /api/ktv/booking` dùng chung để nối note review và cập nhật trạng thái đã ép buộc phải truyền `status`. Nhưng frontend gọi thiếu payload `status`, gây ra lỗi 400 Bad Request. Mọi thao tác lưu đều thất bại.
- **Trạng thái ảo ở Frontend (Ephemeral State):** Biến `hasSubmittedReview` quản lý việc vượt qua màn hình REVIEW chỉ tồn tại tạm thời ở client. Nếu KTV refresh trang, state mất, và Engine kéo KTV về REVIEW do backend không hề ghi nhận KTV đã hoàn tất khâu này.
- **Dữ liệu mảng `segments` rỗng hoặc JSON lỗi:** Cơ chế phục hồi trạng thái Review nếu dựa vào `segments` sẽ sụp đổ hoàn toàn nếu mảng `segments` không chứa KTV đang hoạt động, dẫn tới hệ thống không có "nguồn sự thật bền vững".

## 3. Giải pháp triển khai (Implementation)
### 3.1. Tách biệt kiến trúc Route Review (Decoupling)
- Tạo mới file `app/api/ktv/review/route.ts` xử lý độc lập hoàn toàn nghiệp vụ "KTV Review". Không còn piggyback trên route cập nhật status.
- Route này chuyên biệt làm 2 việc: Nối `notes` vào bảng `Bookings` và cập nhật `reviewTime` vào bảng `BookingItems`.

### 3.2. Thiết kế Nguồn sự thật bền vững & Auto-Healing (Durable Source of Truth)
- Nếu backend parse JSON mảng `segments` thất bại, nó sẽ chủ động throw Error bảo vệ data chứ không ghi đè làm mất dữ liệu.
- **Cơ chế Auto-Heal:** Nếu mảng `segments` trống, hoặc KTV bị sót khỏi `segments`, backend tự động fallback tạo một segment phụ: `{ ktvId: techCode, reviewTime: now(), fallbackCreated: true }`. Điều này đảm bảo `reviewTime` luôn có chỗ để neo đậu.

### 3.3. Idempotent Retry (Eventual Consistency)
- Để tránh lỗi partial update khi không có Database Transaction, các lệnh `.update()` được thiết kế chuẩn Idempotent (Kháng lặp):
  - Chỉ nối `notes` nếu chuỗi `oldNotes` chưa chứa nội dung mới.
  - Chỉ gán `reviewTime` nếu `reviewTime` đang rỗng.
- Nếu ghi `notes` thành công nhưng ghi `segments` thất bại, KTV bấm Lưu lần 2 sẽ bỏ qua việc ghi `notes` và trực tiếp retry việc ghi `segments`, đưa DB về trạng thái nhất quán.

### 3.4. Quản lý lỗi nghiêm ngặt (Strict Error Handling)
- Route mới chỉ trả `success: true` khi thao tác ghi DB thành công.
- Notification (Lễ Tân popup) thất bại sẽ chỉ log lỗi thay vì throw, tránh block luồng nghiệp vụ chính của KTV.
- Frontend check chặt chẽ `if (!res.success) return`, chặn hoàn toàn việc KTV vượt qua vòng lặp bằng state ảo.

## 4. Technical Debt phát hiện & Đề xuất (Cảnh báo Security P0)
Trong quá trình rà soát kiến trúc route, đã phát hiện lỗ hổng P0 về bảo mật toàn hệ thống:
- Hệ thống hoàn toàn không có JWT token hay HttpOnly Cookie. Auth chỉ tồn tại ở dạng `localStorage` trên client.
- Tệ hơn: `password` của người dùng được lưu dạng plain-text ngay trong `localStorage`.
- Bất kỳ ai cũng có thể giả danh KTV hoặc Admin gọi API thay đổi trạng thái nếu đoán được ID.
- **Đề xuất:** Cần một đợt Refactor riêng biệt để tích hợp Supabase Auth hoặc NextAuth, xóa password khỏi LocalStorage và bảo vệ toàn bộ `app/api/*` bằng middleware verify token.
