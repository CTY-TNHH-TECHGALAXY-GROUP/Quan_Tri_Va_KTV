# Khảo Sát Responsive UI/UX KTV Dashboard (Mobile)

## Mục tiêu
Tập trung rà soát và đánh giá các vấn đề về hiển thị trên giao diện điện thoại (đặc biệt là các màn hình nhỏ như iPhone SE - 320px/375px) trong file `app/ktv/dashboard/page.tsx` nhằm đảm bảo tính liền mạch, không bị tràn màn hình và tăng trải nghiệm người dùng.

## Kết quả khảo sát & Các điểm cần khắc phục

### 1. Khu vực Thông tin Khách hàng (Lỗi nghiêm trọng)
- **Vấn đề:** Các chuỗi văn bản dài (như Tên khách hàng `Rose Huyen -...`, Mã Bill `#003-24...`) nằm trong `flex` container nhưng thiếu thuộc tính tự động xuống dòng (`flex-wrap`) và ngắt chữ (`truncate` + `min-w-0`). Điều này khiến toàn bộ thẻ (card) bị phình to, vượt quá chiều rộng thiết bị, đẩy các nút bấm quan trọng ra ngoài màn hình.
- **Giải pháp:**
  - Bổ sung `flex-wrap` cho các hàng chứa thông tin dài.
  - Sử dụng `flex-1 min-w-0 truncate` cho thẻ chứa tên khách để tự động thêm dấu `...` khi quá chật.

### 2. Khu vực Checklist & Nút "Chọn tất cả" / "Quy trình"
- **Vấn đề 1 (Bị che khuất):** Nút bị đẩy ra ngoài vùng nhìn thấy do lỗi tràn chiều ngang ở mục 1. Hơn nữa, nút thiếu thuộc tính bảo vệ chống co ngót (`shrink-0`).
- **Vấn đề 2 (Touch Target quá nhỏ):** Nút "Chọn tất cả" đang dùng padding `py-1.5` (chiều cao ~24px). Theo tiêu chuẩn UI/UX Mobile (Apple/Google), vùng chạm tối thiểu nên là 44px. Nút hiện tại quá nhỏ, dễ gây ấn hụt.
- **Giải pháp:**
  - Thêm `shrink-0 whitespace-nowrap` để chống bóp méo.
  - Tăng vùng chạm bằng cách đổi `py-1.5` thành `py-2` (hoặc `py-2.5`) và tăng nhẹ font chữ nếu cần.

### 3. Dropdown Thông Báo (Notification Panel)
- **Vấn đề:** Bảng thông báo đang được fix cứng chiều rộng `w-80` (tương đương 320px) và canh phải (`right-0`). Trên các dòng điện thoại cỡ nhỏ (320px - 375px), bảng này sẽ bị tràn sang mép trái màn hình, gây mất chữ hoặc tạo thanh cuộn ngang không mong muốn.
- **Giải pháp:** Thay vì dùng kích thước cứng `w-80`, hãy sử dụng `w-[85vw] max-w-sm sm:w-80` để bảng thông báo linh hoạt co giãn theo chiều rộng màn hình thực tế của điện thoại.

### 4. Bố cục Timeline & Các danh sách
- **Đánh giá:** Các chặng lộ trình (`WorkingTimeline`) sử dụng lưới `flex` khá tốt (`w-10`, `flex-1`, `w-8`), tuy nhiên cần lưu ý nếu tên phòng/giường cực dài.
- **Giải pháp:** Không cần thay đổi lớn vì đã có cơ chế text-wrap tự nhiên, thiết kế đảm bảo an toàn.

---

## 🛠 Đề xuất hành động (Action Plan)

Tôi sẽ tiến hành cập nhật `app/ktv/dashboard/page.tsx` với các thay đổi sau:
1. Fix triệt để lỗi tràn ngang ở Card hiển thị Dịch Vụ / Khách hàng (`flex-wrap`, `min-w-0`).
2. Nâng cấp nút "Chọn tất cả" và "Quy trình" (Chống co ngót `shrink-0` & Tăng kích thước vùng chạm).
3. Làm mềm bảng Thông báo (Responsive width `w-[85vw]`).

Vui lòng xác nhận **"Duyệt"** để tôi bắt tay vào code các hạng mục trên!
