# Kế Hoạch Triển Khai: Tự Động Hóa KTV Daily Ledger

## 1. Mục tiêu
Đảm bảo bảng `KTVDailyLedger` luôn được tự động cập nhật dữ liệu vào **02:00 sáng mỗi đêm** (giờ Việt Nam) để chốt sổ tiền hoa hồng, tiền tip và ứng/rút của ngày hôm trước mà không cần thao tác thủ công từ Lễ tân hay Quản lý.

## 2. Chi tiết thực hiện

### Bước 1: Cấu hình Vercel Cron
- Tạo/Cập nhật file `vercel.json` ở thư mục gốc của dự án.
- Khai báo lịch trình tự động (cron expression): `0 19 * * *`.
  *(Giải thích: Vercel Cron chạy theo múi giờ UTC. 19:00 UTC sẽ tương ứng với 02:00 sáng múi giờ GMT+7 Việt Nam).*
- Đường dẫn trỏ về: `/api/cron/sync-daily-ledger`.

### Bước 2: Bổ sung phương thức `GET` cho API
- Hiện tại API `/api/cron/sync-daily-ledger` chỉ nhận `POST` request (có truyền payload `targetDate`). Vercel Cron mặc định sẽ ping bằng phương thức `GET`.
- Sẽ refactor logic chốt sổ vào một hàm dùng chung (ví dụ: `processSyncLedger(date)`).
- Viết thêm hàm `export async function GET(request: Request)`:
  - Tự động lấy ngày hôm qua (YESTERDAY) theo múi giờ Việt Nam làm `targetDate`.
  - Gọi hàm xử lý và trả về kết quả.

### Bước 3: Bảo mật Endpoint Cron Job
- Để tránh bị kẻ xấu hoặc bên thứ 3 vô tình/cố ý quét trúng API này làm quá tải hệ thống, cần thiết lập bảo mật.
- Trong hàm `GET` (và `POST`), bổ sung việc kiểm tra Header: `Authorization: Bearer <CRON_SECRET>`.
- `<CRON_SECRET>` sẽ được cấu hình trong Environment Variables của Vercel (`process.env.CRON_SECRET`). Khi Vercel tự động kích hoạt cron, nó sẽ gắn sẵn header này.

## 3. Các bước kiểm tra sau khi code
- Đảm bảo `vercel.json` hợp lệ.
- Chạy thử `POST` và `GET` locally để đảm bảo logic tính tiền của ngày hôm qua không bị hỏng.
- Request user cập nhật thêm biến `CRON_SECRET` trong cài đặt trên Vercel sau khi push code.
