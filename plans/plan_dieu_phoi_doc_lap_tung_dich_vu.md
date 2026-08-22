# Kế hoạch Điều Phối & Quản Lý Theo Từng Dịch Vụ Độc Lập

Dựa trên yêu cầu của bạn: *"tách lẻ riêng từng cục chứ không gom chung 1 cục, quản lý rất khó"* và *"thêm nút điều phối nhỏ theo dịch vụ"*, hệ thống đang bộc lộ điểm yếu là quản lý vòng đời (lifecycle) ở cấp độ **Đơn Hàng (Booking)** thay vì **Dịch Vụ (BookingItem)**.

Để giải quyết triệt để, chúng ta sẽ kiến trúc lại Bảng điều phối (Kanban) và Modal điều phối để mọi thao tác đều hướng tới **Từng Dịch Vụ**.

## ❗️ User Review Required
Mình đã cập nhật lại kế hoạch theo ý bạn: 
- Nếu 2 dịch vụ do cùng 1 KTV (hoặc cùng một nhóm KTV) làm, hệ thống sẽ **gộp chung vào 1 thẻ** và hiển thị dưới dạng các chặng nối tiếp.
- Nếu các dịch vụ do các KTV khác nhau làm, hệ thống sẽ **tách thành các thẻ riêng biệt** để kéo thả độc lập trên bảng.
Bạn xem lại chi tiết bên dưới nhé, nếu đã chốt thì mình sẽ bắt tay vào code!

---

## Proposed Changes

### 1. Bảng Kanban (Tách thẻ theo KTV được gán)
Thay vì hiển thị 1 thẻ duy nhất cho toàn bộ `Booking`, bảng Kanban sẽ tự động gộp nhóm các dịch vụ (`BookingItem`) dựa trên KTV thực hiện.

#### [MODIFY] `app/reception/dispatch/_components/KanbanBoard.tsx`
- **Logic gom nhóm (Grouping):** Duyệt qua tất cả dịch vụ của một đơn hàng. Các dịch vụ có cùng danh sách KTV sẽ được gộp thành 1 "SubOrder" (Thẻ Kanban).
  - VD: Đơn có DV1 (KTV A), DV2 (KTV A), DV3 (KTV B). Sẽ sinh ra 2 thẻ: Thẻ 1 (KTV A làm DV1 + DV2), Thẻ 2 (KTV B làm DV3).
- **Phân cột Kanban:** Dựa trên trạng thái gộp của các dịch vụ trong thẻ đó.
- **Giao diện thẻ:** Thẻ sẽ hiển thị danh sách các dịch vụ dạng chặng (như hiện tại) nếu có nhiều dịch vụ gộp chung.

### 2. Modal Điều Phối (Điều phối lẻ từng dịch vụ)
Cho phép Lễ tân phân công KTV và bấm "Bắt đầu điều phối" cho từng dịch vụ riêng biệt.

#### [MODIFY] `app/reception/dispatch/page.tsx`
- **Giao diện:** Trong phần danh sách dịch vụ của đơn, thêm nút **"Điều phối dịch vụ này" (Dispatch this service)** bên cạnh mỗi dịch vụ.
- **Logic:** Khi bấm nút này, hệ thống sẽ:
  1. Kiểm tra xem dịch vụ này đã chọn Phòng, Giường và KTV chưa.
  2. Cập nhật `status` của riêng `BookingItem` này thành `PREPARING` (Đẩy thông báo xuống KTV).
  3. Đẩy KTV vào `TurnQueue`.
- Thay đổi logic của nút "Lưu thông tin" tổng: Chuyển thành "Lưu nháp" hoặc "Điều phối tất cả".

#### [MODIFY] `app/api/ktv/booking/route.ts` & Server Actions
- Đảm bảo API hỗ trợ cập nhật trạng thái (`status`) và tạo `TurnQueue` ở cấp độ `BookingItem` một cách an toàn mà không làm ảnh hưởng đến các item khác trong cùng đơn.

### 3. Đồng bộ trạng thái đơn hàng (Booking Status Sync)
- **Logic tự động:** Trạng thái của đơn hàng tổng (`Booking.status`) sẽ được tự động tính toán dựa trên trạng thái của các dịch vụ con.
  - VD: Nếu có ít nhất 1 dịch vụ `IN_PROGRESS` -> Đơn là `IN_PROGRESS`.
  - Nếu TẤT CẢ dịch vụ đã `COMPLETED` -> Đơn chuyển sang `COMPLETED`.

### 4. Đồng bộ thời gian Real-time (Sổ Tua / Dispatch Board)
- Khi KTV bấm "Bắt đầu", hệ thống sẽ tính toán lại `timeEnd` dựa trên thời lượng thực tế.
- **[CRITICAL]** Ghi đè `timeEnd` này vào trường `estimated_end_time` của bảng `TurnQueue`.
- Cơ chế Real-time sẽ tự động phát sóng (broadcast) sự thay đổi này lên giao diện Lễ tân (phần Bảng Điều phối và Modal Chọn Tua KTV), giúp Lễ tân luôn thấy chính xác KTV đó sẽ rảnh vào lúc mấy giờ.

## Verification Plan

### Manual Verification
1. Lễ tân tạo 1 đơn hàng có 2 dịch vụ: Gội đầu và Massage.
2. Tại màn hình Điều phối, Lễ tân chỉ chọn KTV cho dịch vụ Gội đầu và bấm nút **"Điều phối riêng"** cho Gội đầu.
3. Ra bảng Kanban: Thấy xuất hiện 1 thẻ "Gội đầu" nằm ở cột Chuẩn bị. Thẻ "Massage" chưa xuất hiện hoặc nằm ở danh sách chờ.
4. KTV làm xong Gội đầu, Lễ tân tiếp tục vào đơn hàng, chọn KTV cho Massage và bấm "Điều phối riêng". Thẻ Massage xuất hiện ở cột Chuẩn bị.
5. Cả 2 dịch vụ hoàn thành, hệ thống tự gom đơn hàng sang trạng thái Dọn phòng / Thanh toán.
