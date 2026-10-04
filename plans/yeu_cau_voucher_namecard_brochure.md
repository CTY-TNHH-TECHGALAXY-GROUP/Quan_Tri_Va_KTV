# Yêu cầu — E-voucher dạng namecard / brochure → mở Web Booking có giảm giá

> Ghi nhận ngày 05/10/2026. Trạng thái: **chưa phân tích, chưa plan**.
> Chờ user `/add-dir` repo `NganHa-WebBooking` để khảo sát code của `origin/master`.

## Yêu cầu của user

- Thẻ e-voucher hiện tại dùng được như **namecard / brochure**: in sẵn hoặc phát rộng, **không gắn với một khách cụ thể**.
- Khi quét QR:
  - **Khách** (không phải tài khoản admin hay quầy) → mở **Web Booking** để tự đặt lịch.
  - Nếu làm được thì hiện **giảm giá**, ví dụ 10%.
  - **Admin / quầy** quét: hành vi riêng, chưa chốt.
- Là **chương trình cấu hình được** trong admin (mức giảm, thời hạn, điều kiện…), **không hard-code**.
- User cần: **phân tích + plan**. Đây là Mức 2 vì chạm giá tiền và 2 app (admin + WebBooking).

## Đã biết (khảo sát sơ bộ, chưa đọc nội dung file)

- WebBooking **chưa có mã giảm giá**:
  - `src/components/Promotions/Promotions.tsx` mới là file trống.
  - Có sẵn kiểu `Promotion { discountPercent }`, chưa thấy nơi dùng.
- WebBooking **đã ghi nguồn khách theo `utm_campaign`**:
  - Đọc từ URL ở `src/lib/analytics/client.ts`, gửi qua header `X-Analytics-Campaign`.
  - API tạo booking đọc header này ở `src/app/api/bookings/route.ts` (khoảng dòng 332–372).
  - Campaign bắt đầu bằng `TEST` bị đánh dấu là booking test.
- Có endpoint **tính lại giá** `src/app/api/bookings/reprice` và `src/lib/bookingQuote.ts`. Cần xác nhận giá có được tính ở server không.
- Repo WebBooking ở máy đang ở nhánh `feat/oria-care`, có thay đổi chưa commit. **Khảo sát theo `origin/master`**, không đụng nhánh đang làm.

## Câu hỏi sẽ trả lời trong plan

1. Giảm giá áp ở đâu: lúc đặt trên web (giá hiển thị và lưu ở `Bookings`), hay lúc quầy thanh toán (engine áp voucher vào đơn)?
2. Chống lạm dụng: giới hạn số lượt, mỗi khách một lần (theo SĐT / email), thời hạn, điều kiện menu.
3. Admin / quầy quét QR brochure thì thấy gì?
4. Thống kê: số lượt quét → số booking → doanh thu, theo từng brochure / chiến dịch.
