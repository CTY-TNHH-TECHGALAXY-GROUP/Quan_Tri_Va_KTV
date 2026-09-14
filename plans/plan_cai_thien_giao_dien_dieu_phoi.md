# Kế Hoạch Triển Khai: Cải Thiện Giao Diện Điều Phối & Tính Năng Mới

Mục tiêu của đợt cập nhật này là giải quyết 4 yêu cầu từ bạn:
1. Xóa các đoạn text không cần thiết trên giao diện Điều Phối.
2. Tách Sổ Tua thành component dùng chung và tích hợp vào trang Quản lý KTV (`ktv-hub`).
3. Bổ sung mục Sơ đồ Phòng (Room Status) để xem tình trạng phòng rảnh/bận phục vụ công tác điều phối.
4. Tạo mới trang Lịch Biểu Diễn Đơn Hàng trong ngày.

> [!IMPORTANT]
> Vui lòng xem kỹ phương án thiết kế dưới đây và bấm **Proceed** hoặc phản hồi nếu bạn muốn thay đổi bất kỳ điều gì trước khi hệ thống bắt đầu code.

---

## 1. Xóa Text Trên Bảng Điều Phối
- **File ảnh hưởng**: `app/reception/dispatch/page.tsx`
- **Thay đổi**: Xóa dòng chữ `Bảng Điều Phối Trung Tâm` và `Theo dõi tiến trình phục vụ đơn hàng` theo đúng yêu cầu gạch chéo trong hình ảnh. Giữ lại thanh chọn chế độ (Điều Phối / Giám Sát Đơn) và các nút bấm.

## 2. Bổ Sung Mục "Sổ Tua Dùng Chung" ở Quản Lý KTV
- **Hiện trạng**: Trang `ktv-hub` hiện đã có Tab Sổ Tua nhưng code đang nằm dính liền trong file `page.tsx` và chưa tối ưu để tái sử dụng.
- **Phương án**:
  - Tạo một Shared Component mới: `components/shared/TurnQueueBoard.tsx` (hoặc đặt trong `app/_components/` tùy cấu trúc dự án).
  - Component này sẽ nhận data `TurnQueue`, `Staffs`, `Shifts` và tự động render danh sách hàng đợi KTV với UI chuẩn hóa (hiển thị trạng thái Đang làm, Sẵn sàng, Về sớm...).
  - Thay thế code cũ trong `ktv-hub/page.tsx` bằng component mới này.
  - Tái sử dụng component này ở các nơi khác nếu cần trong tương lai.

## 3. Bổ Sung Mục "Phòng" Để Điều Phối
- **Vấn đề**: Lễ tân cần xem nhanh phòng nào đang trống, phòng nào bận để xếp khách.
- **Phương án**:
  - Bổ sung thêm một chế độ xem (View Mode) hoặc một phần hiển thị **"Sơ Đồ Phòng"** ngay trong trang Điều Phối (`app/reception/dispatch/page.tsx`).
  - Lấy dữ liệu từ bảng `Rooms`, `Beds`, đối chiếu với các `BookingItems` đang `IN_PROGRESS` (hoặc `TurnQueue` có gán `room_id`).
  - Giao diện: Hiển thị danh sách các phòng dạng Card/Grid. 
    - 🟢 Trống: Có thể bấm vào để xem chi tiết số giường.
    - 🔴 Bận: Hiển thị tên KTV/Khách đang sử dụng và thời gian dự kiến kết thúc.
    - 🧹 Đang dọn dẹp: Nếu tích hợp logic dọn phòng.

## 4. Trang "Cuốn Sổ Lịch Biểu Diễn Đơn Hàng"
- **Vấn đề**: Cần cái nhìn tổng quan về dòng thời gian (Timeline) của tất cả đơn hàng trong ngày (từ web, walk-in, vip menu).
- **Phương án**:
  - Tạo một trang mới: `app/reception/schedule/page.tsx` (hoặc vị trí bạn muốn, ví dụ `app/reception/booking-timeline/page.tsx`).
  - **Giao diện**: Dạng **Gantt Chart** hoặc **Calendar Timeline** (trục ngang là các khung giờ từ 9:00 - 24:00, trục dọc là các KTV hoặc Phòng).
  - Tuy nhiên, để đơn giản và dễ nhìn nhất cho Spa, trục dọc sẽ là **Giờ hẹn (Time Slot)** và hiển thị các đơn hàng xếp dọc theo dòng thời gian từ sáng đến tối.
  - Khác với Dispatch (chỉ hiển thị đơn đang phục vụ/chờ), trang này hiển thị **Toàn bộ lịch sử và tương lai** của ngày hôm đó dựa trên `timeBooking` và `bookingDate`.

---

## ❓ Câu Hỏi Mở (Open Questions)

> [!WARNING]
> Để thực hiện chính xác nhất, bạn vui lòng xác nhận các điểm sau (có thể trả lời trực tiếp trong chat):

1. **Vị trí trang Lịch Biểu (Timeline)**: Bạn muốn trang lịch này nằm ở đường dẫn nào? (`/reception/schedule` hay tích hợp thẳng vào một tab trên trang Điều Phối luôn cho tiện?)
2. **Sơ đồ Phòng**: Nằm trong trang Điều Phối hiện tại (thêm 1 nút chọn view kế bên nút "Giám Sát Đơn") là hợp lý nhất đúng không?
3. **Thư viện Sổ Tua**: Bạn muốn đặt shared component này ở thư mục `components/shared` hay trong thư mục `lib/`? (Thường UI component sẽ đặt ở `components`).

---

## Các Bước Kiểm Tra Kỹ Thuật (Verification Plan)
- Đảm bảo logic Realtime của Sổ Tua không bị vỡ khi tách component.
- Kiểm tra lại luồng Dispatch, KTVDashboard.logic.ts không bị ảnh hưởng (TUYỆT ĐỐI KHÔNG sửa logic Dispatch/KTV timer theo như Rule quy định, chỉ extract UI).
- Test UI mục Phòng xem có load chính xác dữ liệu từ `Rooms` và `Beds` không.

Bạn xem qua kế hoạch này, nếu OK thì bấm Proceed hoặc nhắn tin xác nhận để mình bắt đầu tiến hành code nhé!
