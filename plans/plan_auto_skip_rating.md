# Kế hoạch: Tự động Skip Rating sau 24h

Tính năng này giúp tự động chuyển các đơn hàng bị kẹt ở trạng thái chờ đánh giá (FEEDBACK / COMPLETED) sang trạng thái hoàn tất (DONE) sau 24 giờ. Điều này giúp dọn dẹp hệ thống và cho phép khách hàng dễ dàng đặt lại (Rebook) đơn cũ mà không bị vướng màn hình đánh giá.

## ⚠️ Phân tích Kiến trúc (Options)

Vì Next.js không có sẵn trình chạy ngầm (background worker) như Node.js thuần, chúng ta có 3 phương án:

1. **Phương án 1 (Khuyên dùng): Lazy-Update (Cập nhật lười)**
   - **Cách hoạt động:** Khi khách hàng vào trang Lịch sử đơn (`GET /api/orders`), hệ thống sẽ tự động quét và chuyển các đơn >24h của họ thành `DONE` ngay lập tức.
   - **Ưu điểm:** Code gọn nhẹ, không cần cài đặt server hay Vercel Cron. Giải quyết chính xác vấn đề "khách quay lại đặt lại được".
   - **Nhược điểm:** Đơn hàng chỉ được chuyển thành `DONE` khi có ai đó gọi API.

2. **Phương án 2: API Cron Job (Vercel Cron / cron-job.org)**
   - **Cách hoạt động:** Viết 1 API `/api/cron/auto-skip-rating` và cấu hình hệ thống ngoài gọi vào API này mỗi 1 tiếng/lần.
   - **Ưu điểm:** Đơn hàng được cập nhật tự động cực kỳ chuẩn xác về mặt thời gian, kể cả khi không có user truy cập.
   - **Nhược điểm:** Cần cấu hình Vercel Cron hoặc dùng tool bên thứ 3.

3. **Phương án 3: Supabase pg_cron (Database Trigger)**
   - **Cách hoạt động:** Viết mã SQL chạy ngầm trực tiếp bên trong Database Supabase.
   - **Ưu điểm:** Mạnh nhất, chạy độc lập không phụ thuộc Next.js.
   - **Nhược điểm:** Khó bảo trì code.

---

## 🎯 Giải pháp Đề xuất (Hybrid)

Để đảm bảo hiệu quả cao nhất mà không phức tạp hóa hạ tầng, tôi đề xuất giải pháp kết hợp giữa **Phương án 1 và 2**:

1. **Tạo API chuyên dụng `/api/cron/auto-skip-rating`**
   - Lọc các đơn `Bookings` có `status` = `COMPLETED` hoặc `FEEDBACK`.
   - Lọc điều kiện `timeEnd` < (Hiện tại - 24 tiếng).
   - Update `status = 'DONE'`, `rating = 0` (để nhận biết là skip), và `feedbackNote = 'Auto-skipped after 24h'`.

2. **Gọi "ké" Lazy-Update trong luồng Lịch sử đơn (`GET /api/orders`)**
   - Mỗi khi khách hàng vào trang xem lịch sử, API `orders` sẽ âm thầm gọi tính năng dọn dẹp này (chỉ cho riêng khách đó).
   - Nhờ vậy, ngay lúc khách vào web, đơn cũ lập tức hóa `DONE` và hiện nút Rebook.

3. **(Tùy chọn tương lai)**
   - Đưa API này lên Vercel Cron để chạy ngầm tự động mỗi ngày.
