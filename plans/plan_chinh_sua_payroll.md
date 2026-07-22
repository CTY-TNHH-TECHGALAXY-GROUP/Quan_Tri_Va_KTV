# 📋 Kế Hoạch Cập Nhật "Bảng Chấm Công & Tính Lương"

Chào bạn, dựa trên hình ảnh và yêu cầu của bạn, tôi đã vào kiểm tra các file `Payroll.tsx` và `Payroll.logic.ts`. Tôi sẽ "chẩn bệnh" và vạch ra giải pháp như sau:

## 1. 🔍 Chẩn bệnh lỗi hiển thị "--:--" (Giờ Vào / Giờ Ra)

**Nguyên nhân 1:** Lỗi nối dữ liệu (Mapping mismatch). 
Hiện tại bảng chấm công lấy data từ Database bằng cách so sánh ID của KTV (`KTVAttendance.employeeId`) với ID của bảng Staff (`Staff.id`). Tuy nhiên theo thiết kế, `KTVAttendance.employeeId` được lưu là mã số dài (UUID của User), trong khi `Staff.id` là mã ngắn (ví dụ: `NH001`). Do 2 ID này không giống nhau, hệ thống không nhận diện được KTV nào đã chấm công, dẫn đến toàn bộ dữ liệu bị rỗng và hiện `--:--`.

**Nguyên nhân 2:** Lỗi múi giờ (Timezone bug). 
Trong code đang có đoạn tự cộng `+ 7 * 60 * 60 * 1000` nhưng lại dùng hàm `getUTCHours()`. Cách tính này dễ gây rủi ro sai giờ nếu server database đã trả về đúng múi giờ địa phương. 

👉 **Giải pháp:** Tôi sẽ sửa lại vòng lặp mapping, có thể cần lấy thêm trường `code` (mã nhân sự) trong Database để map chính xác KTV, đồng thời chuẩn hóa lại hàm convert giờ.

## 2. 📅 Cải tiến: Chọn từ ngày - đến ngày (Date Range Picker)

**Giải pháp chốt:** Vẫn giữ nguyên phần chọn Tháng để hiển thị nhanh. Tuy nhiên, ở bộ lọc kế bên, sẽ cho phép người dùng chọn một khoảng thời gian (Từ ngày A đến ngày B trong tháng).
- Nếu không chọn, mặc định lấy toàn bộ tháng đó.
- Thay vì chỉ 1 ô nhập ngày như cũ, sẽ có 2 ô "Từ ngày" và "Đến ngày".

## 3. 🧑‍💼 Cải tiến: Thêm Option Chọn Nhân Viên

- Thêm một thẻ Dropdown (chọn thả xuống) nằm cạnh bộ lọc Ngày.
- Option đầu tiên là **"Tất cả nhân viên"** (mặc định).
- Phía dưới là danh sách các KTV đang làm việc. Khi chọn ai thì chỉ xem lịch sử chấm công của người đó (cập nhật cả bảng số liệu tổng kết ở trên cho đúng riêng người đó luôn).
