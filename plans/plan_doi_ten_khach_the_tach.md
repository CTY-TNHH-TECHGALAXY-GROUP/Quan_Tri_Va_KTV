# Kế Hoạch Bổ Sung Tính Năng Đổi Tên Khách Theo Từng Đơn (Thẻ Tách)

## 📌 Bối cảnh và Vấn đề
Hiện tại, khi 2 KTV phục vụ chung 1 dịch vụ nhưng có thời gian bắt đầu khác nhau, hệ thống Trình Điều Phối (`dispatch-timeline.ts`) sẽ tách hiển thị thành 2 thẻ (SubOrders) trên Kanban Board để dễ quản lý. 
Tuy nhiên, tên khách hàng đang được lấy gốc từ bảng `Bookings` (`customerName`). Do đó, nếu đổi tên khách thì sẽ đổi chung cho cả 2 thẻ.
Với trường hợp đi nhóm (chung 1 bill nhưng tách người phục vụ), Lễ tân cần tính năng **đổi tên hiển thị (Customer Name) cho từng thẻ tách biệt** để KTV dễ nhận diện khách của mình.

## ⚠️ Cần User Duyệt (User Review Required)

> [!WARNING]
> **Quyết định lưu trữ dữ liệu (Database Storage)**
> Để không phải sửa schema Database (tránh tạo thêm cột phức tạp), tôi đề xuất lưu tên khách hàng tùy chỉnh này vào trường **`options` (kiểu JSONB)** của bảng **`BookingItems`**. 
> - Cấu trúc lưu: `options: { customNames: { "NH011": "Anh A", "Tiểu Tiên": "Chị B" } }`
> - Lợi ích: Không cần migrate database, tính linh hoạt cao, gắn liền với KTV cụ thể.
> Bạn có đồng ý với phương án lưu trữ này không?

## 🛠 Đề xuất Triển khai (Proposed Changes)

---

### 1. Server Actions (`app/reception/dispatch/actions.ts`)
Tạo một API action mới để cập nhật tên riêng lẻ.

#### [NEW API] `updateSubOrderCustomerName`
- **Input**: `bookingId` (string), `ktvIds` (string[]), `newName` (string).
- **Logic**: 
  - Truy vấn các `BookingItems` thuộc `bookingId`.
  - Cập nhật trường `options.customNames` cho các mã KTV được truyền vào.
  - Lưu vào CSDL qua Supabase.

---

### 2. Giao diện Kanban Board (`app/reception/dispatch/_components/KanbanBoard.tsx`)
Cập nhật UI trên từng thẻ SubOrder để cho phép sửa tên.

#### [MODIFY] Hiển thị tên ưu tiên (Override Name)
- Lấy tên hiển thị ưu tiên từ `services[0].options.customNames[subOrder.ktvIds[0]]`.
- Nếu không có, fallback về `order.customerName` như cũ.

#### [MODIFY] Thêm nút và trạng thái "Chỉnh sửa tên" (Inline Editing)
- Thêm icon ✏️ (Edit) nhỏ gọn kế bên Tên Khách Hàng.
- Bấm vào sẽ hiện ô Input nhỏ (Inline Input) thay vì `window.prompt` để giữ trải nghiệm mượt mà, chuẩn Spa (sang trọng, dễ bấm trên mobile).
- Sau khi nhập tên và bấm Save, sẽ gọi hàm Server Action mới tạo ở trên.

---

### 3. State Management (`app/reception/dispatch/page.tsx`)
Chèn hàm xử lý tương tác UI.

#### [MODIFY] Truyền props xử lý
- Thêm state hoặc hàm handler gọi `updateSubOrderCustomerName` trong thư viện actions.
- Truyền callback update name xuống component `KanbanBoard` thông qua props.

---

## 🔬 Kế hoạch Kiểm tra (Verification Plan)
### Bằng tay (Manual Testing)
1. Tạo 1 Đơn hàng (Booking) gồm 1 Dịch vụ chung cho 2 KTV, khác thời gian bắt đầu.
2. Kiểm tra Kanban xuất hiện 2 thẻ.
3. Bấm Edit tên ở thẻ của KTV thứ 1 (ví dụ đổi thành "Chị Nga"), lưu lại.
4. Xác nhận thẻ KTV 1 hiện "Chị Nga", thẻ KTV 2 vẫn hiện tên gốc.
5. Tải lại trang (F5) để xác nhận dữ liệu đã được lưu chính xác xuống Database.
