# Kế Hoạch Cải Tiến KTV App: Rút Tiền & Điểm Danh

Dưới đây là phân tích và kế hoạch triển khai dựa trên yêu cầu của bạn:

## 1. Cải tiến form rút tiền (Ví Tua/Ví Bonus)
**Vấn đề hiện tại:** Đang sử dụng hàm `prompt()` mặc định của trình duyệt để nhập số tiền rút. Giao diện thô sơ, dễ nhập nhầm số không có dấu phân cách hàng nghìn, và không có nút tiện ích "Rút hết".
**Giải pháp:**
- Loại bỏ hoàn toàn `prompt()`.
- Xây dựng một **Custom Modal (Giao diện pop-up riêng)** trực tiếp trên trang Ví bằng TailwindCSS.
- **Tính năng Input:** Khi nhập số tiền, hệ thống sẽ tự động format thêm dấu phẩy phân cách hàng nghìn (ví dụ: `1,000,000`).
- **Nút "Rút hết":** Thêm một nút nhỏ bên cạnh, khi bấm vào sẽ tự động điền toàn bộ số dư khả dụng vào ô nhập.
- Áp dụng tương tự cho cả "Ví Tua" và "Ví Bonus" (quy đổi điểm).

**Files cần sửa:**
- `app/ktv/wallet/page.tsx`
- `app/ktv/wallet/KTVWallet.logic.ts`

## 2. Cải tiến trải nghiệm chụp ảnh điểm danh
**Vấn đề hiện tại:** Thẻ `<input type="file" capture="environment">` trên mobile khi bật lên chỉ cho phép chụp 1 tấm rồi tự động đóng Camera lại. Muốn chụp thêm phải bấm mở lại rất bất tiện.
**Giải pháp:**
- Tích hợp **Custom WebRTC Camera** trực tiếp vào ứng dụng web thay vì gọi app Camera của điện thoại.
- Khi bấm "Chụp ảnh", một khung hình Camera sẽ hiện ra ngay trên màn hình web.
- User có thể bấm nút chụp liên tục. Mỗi lần bấm, ảnh sẽ được ghi nhận và hiển thị dạng thu nhỏ bên dưới.
- **ĐẶC BIỆT LƯU Ý:** User có quyền tự do dừng chụp bất kỳ lúc nào. Chỉ cần chụp từ 1 tấm trở lên là có thể bấm nút "Hoàn tất/Xong" để đóng Camera lại, không bắt buộc phải chụp đủ 5 tấm. (5 tấm chỉ là giới hạn tối đa để tránh nặng hệ thống).
- Xử lý mượt mà quyền truy cập Camera và fallback (về lại kiểu cũ `<input type="file">`) nếu trình duyệt/thiết bị không hỗ trợ WebRTC.

**Files cần sửa:**
- `app/ktv/attendance/page.tsx`
- `app/ktv/attendance/Attendance.logic.ts`
