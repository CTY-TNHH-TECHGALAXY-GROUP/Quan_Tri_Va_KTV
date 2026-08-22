# Kế hoạch triển khai: API Nhận Dạng Khách Hàng (Customer Identification)

Tính năng này giúp Lễ tân hoặc hệ thống Webhook tự động nhận dạng khách hàng ngay khi có thông tin số điện thoại/email từ đơn đặt lịch mới. Qua đó, phân loại khách (Cũ/Mới) và trích xuất sở thích/thói quen để tăng tính cá nhân hóa ("Wow" experience) cho Spa.

## 📝 Đề xuất Thay đổi (Proposed Changes)

### 1. Tạo API Endpoint Mới

#### [NEW] `app/api/customers/identify/route.ts`
- **Phương thức:** `GET`
- **Input:** Query parameters `phone` và/hoặc `email`.
- **Logic Xử lý:**
  1. **Tra cứu Customer:** Tìm trong bảng `Customers` bằng số điện thoại. Lấy ra `fullName`, `notes` (ghi chú của quầy).
  2. **Đếm Lịch sử (Bookings):** Query bảng `Bookings` (trạng thái hoàn tất) của số điện thoại này để tính `visitCount`.
     - Nếu `visitCount === 0`: Đánh dấu Khách Mới (`isReturning = false`).
     - Nếu `visitCount > 0`: Đánh dấu Khách Cũ (`isReturning = true`).
  3. **Trích xuất Thói quen (BookingItems):** Nếu là Khách Cũ, lôi toàn bộ `BookingItems` cũ để thống kê:
     - Dịch vụ làm nhiều nhất (`topService`).
     - KTV được chọn nhiều nhất (`topKtv`).
     - Lực massage ưa thích (`preferredStrength`).
  4. **Tạo thông điệp "Wow" (Greeting Suggestion):** Sinh câu chào tự động dựa trên tên khách, số lần đến, dịch vụ, KTV và lực yêu cầu. Lời chào sẽ được AI/Logic tự động sinh ra dựa trên dữ liệu. Nếu khách thiếu 1 trong 3 yếu tố (Thiếu KTV ruột, hoặc thiếu Lực yêu cầu), hệ thống sẽ linh hoạt bỏ qua phần đó trong câu chào.

### 2. Payload Trả Về (JSON Response)
Ví dụ dữ liệu trả về cho Webhook / UI Lễ tân:
```json
{
  "success": true,
  "data": {
    "isReturning": true,
    "visitCount": 5,
    "customer": {
      "name": "Nguyễn Văn A",
      "phone": "0901234567",
      "notes": "Dị ứng tinh dầu quế, thích yên tĩnh"
    },
    "preferences": {
      "topService": "Massage Cổ Vai Gáy 60p",
      "topKtv": "NH016",
      "preferredStrength": "Mạnh"
    },
    "wowMessage": "Ting! Đơn mới từ Khách Cũ VIP (Đến lần 5). Khách này hay làm Massage Cổ Vai Gáy 60p, thích lực Mạnh, và hay chọn KTV NH016.",
    "greetingSuggestion": "Chào anh A, hôm nay anh vẫn làm Cổ Vai Gáy 60p lực mạnh với bạn NH016 đúng không ạ?"
  }
}
```

## 🧪 Kế hoạch Kiểm thử (Verification Plan)
1. **Kiểm thử Khách Mới:** Gọi API với 1 số điện thoại chưa từng tồn tại -> Đảm bảo `isReturning: false` và không có gợi ý sai.
2. **Kiểm thử Khách Cũ (Đầy đủ dữ liệu):** Gọi API với số điện thoại của 1 khách hàng thường xuyên -> Đảm bảo trả về đúng KTV ruột và Dịch vụ yêu thích.
3. **Kiểm thử Ghi chú:** Đảm bảo `notes` của Lễ tân lưu trong CRM được bốc ra chính xác ở trường `customer.notes`.
