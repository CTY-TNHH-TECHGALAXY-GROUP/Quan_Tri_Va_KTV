# Kế Hoạch: Nâng cấp thuật toán nhận diện "Khách Cũ" 

Nhiệm vụ: Mở rộng logic phát hiện khách cũ. Thay vì chỉ dựa vào Số điện thoại, hệ thống sẽ kiểm tra chéo dựa trên **Số điện thoại** HOẶC **Email** HOẶC **Tên khách hàng**.

> [!WARNING] Cảnh báo rủi ro (Edge Cases)
> Nếu khách hàng sử dụng những cái tên rất phổ biến (VD: "Anh Tú", "Chị Mai", "Nguyễn Văn A") mà KHÔNG nhập SĐT hoặc Email, hệ thống vẫn sẽ gộp chung họ thành "Khách cũ" vì trùng tên với một người khác trong quá khứ. Bạn có chắc chắn muốn áp dụng nhận diện theo Tên (Customer Name) không? Nếu đồng ý, tôi sẽ triển khai ngay.

## Proposed Changes

### 1. API Actions (Web Booking)

#### [MODIFY] [actions.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/web-booking/actions.ts)
Thay đổi thuật toán nhận diện trong hàm `getWebBookings`:
- Thay vì query hàng loạt `.in('customerPhone')`, tôi sẽ chuyển sang dùng `Promise.all` với các query `.or()` động.
- Mỗi đơn hàng sẽ tự động build chuỗi query: `customerPhone.eq.X,customerEmail.eq.Y,customerName.eq.Z`.
- Nếu 1 trong 3 trường này khớp với lịch sử (đơn đã DONE/COMPLETED/FEEDBACK) thì tính là Khách cũ.
- Việc dùng `Promise.all` vẫn đảm bảo tốc độ cực nhanh (Zero Bottleneck) vì danh sách Web Booking hiển thị một lúc (đơn NEW) rất ngắn (dưới 20 đơn).

### 2. UI Realtime (Web Booking)

#### [MODIFY] [page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/web-booking/page.tsx)
Cập nhật Toast Notification khi có luồng Realtime đẩy đơn mới về:
- Cập nhật hàm xử lý Realtime `postgres_changes`.
- Tương tự API, build mảng `orStrings` dựa trên Phone, Email, và Name của payload.
- Query kiểm tra lịch sử và popup lên Toast `📩 Đơn mới [Khách cũ]: ...` nếu điều kiện OR thỏa mãn.

## Verification Plan

### Automated Tests
- Chạy thử nghiệm bằng Node.js script để giả lập một đơn Web Booking có trùng Name nhưng khác SĐT, kiểm tra xem có cờ `isReturningCustomer` = true không.

### Manual Verification
- F5 tải lại trang Web Booking.
- Tạo một đơn mới từ Zalo/Website, cố ý điền 1 cái tên đã từng đến (ví dụ "Airy") nhưng để trống SĐT/Email, kiểm tra xem màn hình Lễ tân có popup Toast `[Khách cũ]` và gắn Badge xanh hay không.
