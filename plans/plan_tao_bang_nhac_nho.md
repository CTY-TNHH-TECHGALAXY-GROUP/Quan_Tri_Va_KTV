# Kế hoạch triển khai bảng Reminders

## 1. Mục tiêu
Tạo bảng `Reminders` trên Supabase database để lưu trữ các câu nhắc nhở sử dụng trong hệ thống Spa.

## 2. Cấu trúc bảng `Reminders`
- `id`: `uuid` (Khóa chính, tự động tạo UUID).
- `content`: `text` (Nội dung câu nhắc nhở).
- `is_active`: `boolean` (Mặc định `true` - Dùng để ẩn/hiện nhắc nhở trên UI thay vì xóa hoàn toàn khỏi DB).
- `order_index`: `integer` (Mặc định `0` - Dùng để sắp xếp thứ tự hiển thị của các câu nhắc nhở).
- `created_at`: `timestamptz` (Thời gian tạo record mặc định là `now()`).

## 3. Dữ liệu mặc định (Seed Data)
Các câu nhắc nhở mặc định được đưa vào:
1. NHẮC KHÁCH KIỂM TRA ĐỒ
2. TẮT THIẾT BỊ
3. TẮT THIẾT BỊ CHỤP HÌNH BÀN GIAO
4. KHÔNG NÓI CHUYỆN RIÊNG
5. KIỂM TRA NƯỚC NÓNG TRƯỚC KHI GỘI
6. LÁT CÓ THỢ LÊN
7. ĐỌC KỸ BILL
8. ĐỔ XÔ NƯỚC Ở V3
9. ĐỔ XÔ NƯỚC Ở PG

## 4. Các bước triển khai
- [x] Lưu kế hoạch vào `plans/plan_tao_bang_nhac_nho.md`.
- [ ] Tạo file migration SQL trong thư mục `supabase/migrations/`.
- [ ] Cập nhật bảng này vào file `TableInSupabase.md` dưới mục "NHÓM 3: THÔNG BÁO & CẤU HÌNH".
- [ ] Nhắc user chạy lệnh push lên Supabase.
