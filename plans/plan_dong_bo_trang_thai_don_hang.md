# Kế hoạch Đồng bộ Trạng thái Đơn hàng & Dọn phòng

Mục tiêu: Tái cấu trúc luồng trạng thái của đơn hàng (`Bookings`) và KTV (`TurnQueue`) để phản ánh đúng vận hành thực tế:
1. KTV làm xong phần việc của mình sẽ được giải phóng ngay lập tức.
2. Đơn hàng chỉ kết thúc khi toàn bộ dịch vụ (chặng) kết thúc.
3. Việc dọn phòng và đánh giá (Journey App) chỉ diễn ra ở chặng cuối cùng. Phòng bị "khóa" theo Đơn hàng.
4. Đồng bộ logic trạng thái giữa hệ thống Quản Trị và Web Nội Bộ.

## Đồng bộ trạng thái với `wrb-noi-bo-dev`
Web nội bộ (Journey App) hiện đang kích hoạt màn hình đánh giá khi gặp trạng thái: `['COMPLETED', 'DONE', 'CLEANING']`.
Do đó, khi bấm **"Khách làm xong -> Dọn phòng & Nhận xét"**, hệ thống Quản Trị phải đẩy status của `Bookings` về `CLEANING`. Điều này sẽ "kích hoạt" chuẩn xác màn hình đánh giá bên cho khách.

## Proposed Changes

### Thay đổi Trạng thái Đơn (Booking Status Flow)

Chúng ta sẽ chuẩn hóa luồng trạng thái Đơn hàng (ở bảng Điều Phối Lễ Tân) thành các bước sau:

1. `NEW` / `PREPARING`: Đơn mới / Đang sắp xếp.
2. `IN_PROGRESS`: KTV đang thực hiện dịch vụ.
3. `CLEANING`: **Đang dọn phòng & Chờ đánh giá**. (Trạng thái này kích hoạt QR Hành Trình cho khách).
3. `CLEANING`: **Đang dọn phòng & Chờ đánh giá**. (Trạng thái này kích hoạt QR Hành Trình cho khách).
3. `CLEANING`: **Đang dọn phòng & Chờ đánh giá**. (Trạng thái này kích hoạt QR Hành Trình cho khách).
4. `COMPLETED`: **Đã dọn xong & Khách ra sảnh**. (Giường & Phòng chính thức `AVAILABLE`).
5. `DONE`: **Hoàn tất thanh toán**.

---

### [Quan_Tri_Va_KTV] Quầy Lễ Tân (Trình Điều Phối)

Sửa đổi Menu chuột phải (Context Menu) trên Kanban Board để điều hướng trạng thái chuẩn xác:

#### [MODIFY] `app/reception/dispatch/page.tsx`
- Sửa lại các nút điều hướng trạng thái trong component `Context Menu`:
  - Nếu đơn đang `in_progress` (Đang làm): Hiện nút **"Hết giờ -> Khách thay đồ & Đánh giá"** -> Cập nhật trạng thái thành `CLEANING`.
  - Nếu đơn đang `cleaning` (Đang dọn & Đánh giá): Hiện nút **"Đã dọn phòng xong (Khách ra sảnh)"** -> Cập nhật trạng thái thành `COMPLETED` (Lúc này phòng được nhả ra).
  - Bỏ đi sự trùng lặp của trạng thái `waiting_rating`.
- Cập nhật hàm gọi `handleUpdateStatus` cho khớp logic tên nhãn.

#### [MODIFY] `app/reception/dispatch/_components/KanbanBoard.tsx`
- Đảm bảo màu sắc hiển thị cột/thẻ phù hợp:
  - `CLEANING` hiển thị màu cam (Đang dọn & Khách nhận xét).
  - Đảm bảo UI Kanban hỗ trợ kéo thả qua cột `CLEANING` / `COMPLETED` mượt mà.
