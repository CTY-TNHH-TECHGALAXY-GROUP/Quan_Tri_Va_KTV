# Kế Hoạch Tối Ưu Hóa Vercel CPU (Tránh Vượt Quá 4h/tháng)

## 1. Mục Tiêu
- Giảm tải mức tiêu thụ CPU của Vercel cho dự án `quan-tri-va-ktv`.
- Khắc phục tình trạng tăng đột biến CPU do lỗi rò rỉ (Resource Leak) từ Polling hoặc Realtime subscriptions.

## 2. Giai Đoạn 1: Tối ưu Supabase Queries (Low Risk, High Reward)
- Quét toàn bộ `app/api/` tìm kiếm các truy vấn lạm dụng `.select('*')`.
- Thu gọn payload: Thay vì lấy toàn bộ các cột, chỉ select đúng các cột (`id`, `name`, `status`,...) cần dùng cho frontend.
- Phân tích và bổ sung DB Index nếu các cột sử dụng để filter/sort chưa được index.

## 3. Giai Đoạn 2: Kiểm soát Polling và Realtime Leak
- Quét khu vực `KTVDashboard.logic.ts` và các thành phần liên quan.
- Xác định và loại bỏ/tối ưu các vòng lặp `setInterval` chạy ngầm gọi API liên tục không kiểm soát.
- Đảm bảo Realtime subscription không re-fetch toàn bộ bảng hoặc trigger quá nhiều tính toán ở Server.

## 4. Giai Đoạn 3: Áp dụng Edge Runtime (Tùy chọn & Thận trọng)
- Rà soát các API Route thuần túy (GET), không sử dụng node.js native dependencies.
- Thêm cấu hình `export const runtime = 'edge';` để giảm tối đa chi phí CPU.
- Thử nghiệm trên local trước khi chốt.
