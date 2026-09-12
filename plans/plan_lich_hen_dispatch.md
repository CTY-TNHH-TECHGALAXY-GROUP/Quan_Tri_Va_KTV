# Kế hoạch phát triển: Tính năng Lịch Hẹn (Pre-Bookings) tại trang Dispatch

## 1. Bối cảnh & Mục tiêu
Chức năng "Khách liên hệ trước" (Pre-bookings) trước đây nằm ở nhánh test Web Nội Bộ (`wrb-noi-bo-dev`) sẽ bị gỡ bỏ. Thay vào đó, tính năng này được mang sang tích hợp thẳng vào **Giao diện Lịch Hẹn (`ScheduleBoard.tsx`)** trên Web Quản Trị (`Quan_Tri_Va_KTV`). 
Khi Lễ tân (Quản trị) bấm vào một khách hẹn từ Lịch Hẹn, hệ thống sẽ mở tab Web Nội Bộ ra (trang `/en/new-user/standard/menu`) và tự động truyền thông tin khách hàng sang để giữ nguyên luồng Auto-fill thông tin ở bước thanh toán.

---

## 2. Các thay đổi đề xuất

### 2.1. Cập nhật Data Schema (`TableInSupabase.md`)
Bổ sung khai báo bảng `PreBookings` để quản lý Khách Hẹn.
- `id` (uuid)
- `customer_name` (text)
- `customer_phone` (text)
- `guest_count` (int)
- `booking_date` (date)
- `booking_time` (time)
- `notes` (text)
- `status` ('PENDING', 'CONVERTED', 'CANCELLED')

### 2.2. Web Quản Trị (`Quan_Tri_Va_KTV`)
**Vị trí sửa đổi chính:** `components/shared/ScheduleBoard/ScheduleBoard.tsx` (Giao diện Lịch Hẹn).

1. **Hiển thị danh sách khách hẹn (PreBookings):**
   - Fetch dữ liệu từ bảng `PreBookings` có `status = 'PENDING'`.
   - **Xác định Khách Cũ:** Kiểm tra số điện thoại của PreBooking có tồn tại trong bảng `Customers` hay không. Nếu có, gắn nhãn badge **"Khách cũ"** lấp lánh để Lễ tân dễ nhận biết.
   - Hiển thị danh sách khách hẹn (có thể render thành dạng Panel danh sách bên cạnh lưới Lịch, hoặc thành các thẻ chờ xếp vào giờ).

2. **Tính năng Thêm Khách Hẹn (Add PreBooking):**
   - Thêm nút **"+ Thêm Khách Hẹn"** trong `ScheduleBoard`.
   - Hiển thị Form nhập liệu y hệt bản cũ của web nội bộ: `Họ tên`, `Số điện thoại`, `Số khách`, `Ngày hẹn`, `Giờ hẹn`, `Ghi chú`.
   - Khi lưu, insert vào bảng `PreBookings` trên Supabase.
   - Nếu sđt nhập vào trùng với bảng `Customers`, hiển thị ngay lập tức gợi ý/nhãn là "Khách cũ".

3. **Chức năng chuyển hướng (Redirect tới Web Nội Bộ):**
   - Thêm biến môi trường `.env.local`: `NEXT_PUBLIC_WEB_NOI_BO_URL` (ví dụ `http://localhost:3000`).
   - Khi Lễ tân click vào một Khách Hẹn trên lưới/danh sách, mở URL ra một New Tab theo đường dẫn được chỉ định:
     `{NEXT_PUBLIC_WEB_NOI_BO_URL}/en/new-user/standard/menu?preBookingId={id}&name={customer_name}&phone={customer_phone}&guests={guest_count}&notes={notes}`

### 2.3. Web Nội Bộ (`wrb-noi-bo-dev`)
**Vị trí sửa đổi:** Page nhận Redirect `src/app/[lang]/new-user/[menuType]/menu/page.tsx` (Menu) hoặc Layout cấp cao nhất của khu vực này.

- **Cơ chế Catch & Save (Auto-fill):** 
  Khi trang load lên, đọc `useSearchParams()` để kiểm tra URL.
  - Nếu URL có các query string `preBookingId`, `name`, `phone`...
  - Thì tự động đóng gói và lưu vào `localStorage.setItem('contactedFirstInfo', JSON.stringify({ ... }))`.
  - Lúc User thực hiện qua trang Checkout, luồng Checkout hiện tại của Web Nội Bộ sẽ tự động Auto-fill thông tin như bình thường.
  - Xoá params trên URL (bằng window.history.replaceState) để URL trở nên sạch sẽ.

---

## 3. Các bước thực thi (Execution)
- [ ] **Data:** Thêm logic Query/Insert vào API hoặc trực tiếp trên Client thông qua Supabase SDK.
- [ ] **UI ScheduleBoard:** Tạo layout chia đôi (một bên Lưới lịch, một bên Cột danh sách PreBookings) hoặc Modal thêm/sửa khách hẹn.
- [ ] **Kiểm tra Khách Cũ:** Thêm một function `checkExistingCustomer(phone)` trigger khi gõ SĐT vào form, và apply badge "Khách cũ" lên các thẻ đang hiển thị.
- [ ] **Redirect URL:** Gắn logic onClick mở window.open với link `/en/new-user/standard/menu`.
- [ ] **Web Nội Bộ:** Thêm logic `useEffect` để catch URL parameters vào file page/layout của Menu Web Nội Bộ.
