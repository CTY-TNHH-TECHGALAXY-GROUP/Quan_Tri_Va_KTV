# Kế hoạch Triển khai Tính năng: Khách hàng Mua thêm Dịch vụ (Add-on Services)

*Đã cập nhật theo feedback từ Ngan Ha*

## 1. Trả lời các câu hỏi về Logic

### 1.1 Đồng hồ thời gian xử lý ra sao?
- **Kiến trúc hiện tại**: Hệ thống tách biệt thời gian theo từng dịch vụ (`BookingItems`), mỗi item có `timeStart` và `duration` riêng.
- **Giải pháp**: Khi mua thêm, `insert` các dịch vụ mới vào `BookingItems`. Khi KTV làm xong dịch vụ cũ, họ bấm "Bắt đầu" dịch vụ mới. Đồng hồ đếm ngược dựa trên `timeStart` mới này và `duration` của dịch vụ mới.
- **Mở rộng**: Cập nhật cộng dồn thời lượng (`duration`) của các dịch vụ mới vào `estimated_end_time` trong bảng `TurnQueue` để hệ thống biết KTV sẽ ra trễ hơn dự kiến.

### 1.2 Tính tiền tua của KTV ra sao?
- **Quy tắc 1 Tua**: Thêm dịch vụ vào cùng 1 Bill **KHÔNG** làm tăng số tua (`turns_completed`). Vẫn chỉ tính là 1 tua trong sổ tay.
- **Tính tiền tua theo thời gian (System Config)**: Tiền tua được tính dựa trên thời gian làm việc (ví dụ 60p = 100k từ bảng `SystemConfigs`), KHÔNG phải theo doanh thu. Việc thêm `BookingItem` mới sẽ cộng thêm `duration` cho KTV đó. Khi xuất báo cáo tính lương, hệ thống sẽ lấy `Tổng duration` của tất cả các items KTV phục vụ để quy ra tiền tua. Do đó KTV làm thêm dịch vụ thì tự động được thêm tiền tua thời gian.

## 2. Kế hoạch Code (Proposed Changes)

### 2.1 Backend: Tạo API Mới
#### [NEW] `src/app/api/bookings/[id]/add-services/route.ts`
- **Method**: `POST`
- **Body**: `{ items: [{ serviceId: 'NHS001', qty: 1 }], addedBy: 'ADMIN_ID' }`
- **Logic**:
  1. `INSERT` dịch vụ mới vào bảng `BookingItems` (gán `technicianCodes` là mã của KTV hiện tại, `status` là `WAITING`).
  2. Thêm ghi chú hoặc cờ (VD: `options: { isAddon: true, isPaid: false }`) vào `BookingItem` để quầy biết khoản này chưa thanh toán.
  3. `UPDATE` tổng tiền `totalAmount` trong bảng `Bookings` = `totalAmount` hiện tại + tiền mua thêm.
  4. `UPDATE` bảng `TurnQueue`: `estimated_end_time` = `estimated_end_time` + tổng `duration` dịch vụ mua thêm.

### 2.2 Frontend: Luồng thao tác (Lễ tân thực hiện)
- **Màn hình KTV**: KTV sử dụng nút **"Thông báo"** (đã có sẵn trên UI) để nhắn cho Quầy Lễ Tân yêu cầu thêm dịch vụ. KTV **không** thao tác thêm trực tiếp.
- **Màn hình Điều phối (Quầy Lễ Tân)**: Thêm nút **"Mua thêm dịch vụ"** trong giao diện chi tiết đơn hàng (Booking Details/Dispatch Board). Lễ tân sẽ bấm vào đây, chọn dịch vụ để thêm vào Bill cho khách.

### 2.3 Giao diện Khách hàng & KTV (Realtime Sync với Optimistic Update)
Để các màn hình tự động hiển thị dịch vụ mới ngay lập tức mà không làm quá tải Server:
1. **Màn hình Khách (Journey) & KTV Dashboard**: Cập nhật hook Realtime (`useJourneyRealtime.ts` và logic ở KTV) bắt thêm sự kiện `INSERT` trên bảng `BookingItems`.
2. **Optimistic Update**: Khi bắt được tín hiệu `INSERT` chứa dữ liệu dịch vụ mới, Frontend sẽ **push trực tiếp** object đó vào mảng `items` hiện tại thay vì gọi API `fetchState()` tải lại toàn bộ. Giao diện thay đổi tức thì, mượt mà và tiết kiệm 100% tài nguyên server.
3. **Màn hình Lễ Tân (Quản lý Công nợ/Unpaid Amount)**: Khi `totalAmount` tăng lên, nếu khách đã thanh toán trước (VD: qua chuyển khoản), giao diện Dispatch Board của lễ tân sẽ **bôi đỏ nổi bật** dòng chữ *"Phát sinh chưa thu: +XXX.000 VNĐ"*. Giúp lễ tân tuyệt đối không quên thu tiền chênh lệch lúc Check-out.

---

> [!IMPORTANT]
> **User Review Required**
> Kế hoạch đã được điều chỉnh bám sát theo luồng: **Chỉ có Lễ Tân thao tác nút thêm dịch vụ trên giao diện Điều phối -> KTV dùng nút Thông báo có sẵn trên app để nhờ Quầy -> Tiền tua tự động tính theo số phút tăng thêm -> Khách hàng và KTV đều được đồng bộ Realtime.**
>
> Bạn xem lại nếu mọi thứ đã chuẩn xác, vui lòng bấm `Duyệt` để mình tiến hành code nhé.
