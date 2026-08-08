# Kế Hoạch: Nâng Cấp KTV-Hub & Module Tính Lương (Payroll / Attendance)

## 1. Nâng Cấp KTV-Hub (Dashboard Lễ Tân / Quản Lý)

### 1.1. Gom nhóm "Nhân Sự Làm Việc" theo Ca
- **Hiện tại:** Đang hiển thị phẳng danh sách các KTV đang làm.
- **Thay đổi:** 
  - Lấy dữ liệu từ bảng `KTVShiftRecords` ngày hiện tại.
  - Phân loại KTV theo: `Ca 1 (09:00 - 17:00)`, `Ca 2 (11:00 - 19:00)`, `Ca 3 (17:00 - 00:00)`, `Ca Tự Do`, và `Làm Khách Yêu Cầu`.
  - Giao diện UI sẽ chia thành từng Section có Title (Ví dụ: 🔹 **Ca 1 (4 nhân sự)**: NH018, NH021...).

### 1.2. Sổ Tua (TurnTab) - Cập nhật trạng thái
- **Hiển thị Badge Trạng thái:** Trên giao diện Sổ Tua, cạnh tên mỗi KTV (đang "waiting") sẽ đính kèm nhãn báo hiệu:
  - Nếu `shiftType === 'FREE'` ➔ Badge màu Teal: **Tự do**.
  - Nếu `shiftType === 'REQUEST'` ➔ Badge màu Pink: **Khách Yêu Cầu**.
- **Hiển thị KTV OFF Đột Xuất:** 
  - Truy vấn thêm `KTVLeaveRequests` (nơi `is_sudden_off = true` và `date = today`).
  - Trong sổ tua, nếu KTV có tên trong danh sách này: Tên KTV sẽ bị gạch ngang (`line-through`), opacity mờ đi (`opacity-50`), và đính kèm Badge Đỏ: **OFF ĐỘT XUẤT**.
  - Xếp KTV này xuống cuối danh sách hoặc trong phần riêng ở Sổ Tua để dễ nhìn.

---

## 2. Xây Dựng Trang Chấm Công & Tính Lương (Finance / Payroll)
*(Hiện tại `app/finance/payroll/page.tsx` đang là Placeholder, cần xây dựng giao diện hoàn chỉnh)*

Dưới góc độ của Kế Toán, một bảng chấm công phải cung cấp bằng chứng rõ ràng, không chỉ có con số tổng.

### 2.1. Cấu trúc Bảng Chấm Công Chi Tiết (Bảng Master)
Sẽ xây dựng một bảng Data Grid hiển thị theo từng KTV trong tháng, với các cột cốt lõi:
1. **Thông tin KTV:** Mã NV, Họ Tên.
2. **Ca Làm Việc:** Hiển thị ca đăng ký (VD: Ca 1).
3. **Giờ Check-in / Check-out thực tế:** 
   - Lấy từ bảng `DailyAttendance` (cột `check_in_time`, `check_out_time`).
   - Sẽ highlight đỏ nếu `check_in_time` > `giờ bắt đầu Ca`.
4. **Trạng Thái Điểm Danh Tổng Quát:** Có mặt, Nghỉ phép (OFF hợp lệ), Đi trễ, Tan ca sớm, OFF đột xuất.
5. **Số phút đi trễ:** Tính toán số phút đến muộn so với quy định ca để Kế toán dễ áp khung phạt (nếu có).

### 2.2. Thống Kê Tổng Hợp Cuối Tháng (Chốt Lương)
Một bảng Summary theo từng KTV khi chốt lương:
- **Tổng ngày công (On Duty):** Tổng số ngày có điểm danh hợp lệ.
- **Số ngày OFF hợp pháp:** Tổng số ngày nghỉ được duyệt trước.
- **Số ngày OFF Đột Xuất (Sudden Off):** Cực kỳ quan trọng để áp dụng trừ lương hoặc cắt thưởng.
- **Số lần đi trễ:** Tổng số lần trễ. Có thể bổ sung tổng *số phút* đi trễ trong tháng.

---

## 3. Lộ Trình Triển Khai
1. **Giai đoạn 1 (KTV Hub):** Sửa file `app/reception/ktv-hub/page.tsx` và các logic API liên quan để gom nhóm Ca và hiển thị OFF Đột Xuất trong sổ tua.
2. **Giai đoạn 2 (Payroll Base):** Tạo cấu trúc page `app/finance/payroll/page.tsx`, lấy dữ liệu từ `DailyAttendance` + `KTVShiftRecords` + `KTVLeaveRequests` để kết xuất bảng Chấm Công chi tiết theo tháng.
3. **Giai đoạn 3 (Payroll Stats):** Thêm tính toán tự động số ngày công, số lần đi trễ, off đột xuất và highlight vi phạm.
