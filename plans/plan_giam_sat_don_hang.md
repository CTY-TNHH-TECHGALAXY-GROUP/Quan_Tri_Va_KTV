# Kế Hoạch Cập Nhật Trang Giám Sát Đơn

Vấn đề hiện tại:
1. Khi thêm dịch vụ, đơn hàng bị quay lại bước "Chuẩn bị".
2. Bảng giám sát chưa hiển thị số tiền chưa thu của các dịch vụ phát sinh (add-on).
3. Trang giám sát đơn cập nhật realtime chậm.

## Đề Xuất Giải Quyết

### 1. Sửa lỗi Reset Trạng Thái Đơn Hàng
Nguyên nhân là do hàm `handleDispatch` trong `app/reception/dispatch/page.tsx` hiện tại luôn hardcode trạng thái truyền lên là `status: 'PREPARING'`. Khi người dùng (Lễ tân/Admin) nhấn nút "Cập nhật" sau khi thao tác trên đơn hàng đang chạy, trạng thái bị ghi đè về `PREPARING` (Chuẩn bị).
- **Cách sửa:** Sửa logic truyền status trong `handleDispatch` thành: giữ nguyên trạng thái cũ (`clonedOrder.rawStatus`) nếu đơn hàng không phải là đơn mới.

### 2. Hiển thị Tiền Phát Sinh Chưa Thu
- **Thêm field vào Type:** Bổ sung `price` vào `ServiceBlock` trong `app/reception/dispatch/types.ts`.
- **Map data:** Cập nhật hàm `fetchData` trong `app/reception/dispatch/page.tsx` để truyền thuộc tính `price: bi.price` từ Database xuống UI.
- **Cập nhật UI:** Trong `KanbanBoard.tsx`, duyệt qua danh sách `order.services` để tính tổng số tiền chưa thu `(svc.options?.isPaid === false)`. Nếu tổng > 0, hiển thị dòng cảnh báo màu đỏ `"Phát sinh chưa thu: XXX.000đ"` ngay dưới tên khách hàng.

### 3. Tăng tốc độ Realtime
Hiện tại bảng điều phối chỉ đang lắng nghe (`subscribe`) các thay đổi từ bảng `Bookings` và `TurnQueue`. Khi KTV thay đổi trạng thái của từng chặng/dịch vụ (Bảng `BookingItems`), hệ thống không bắt được event này ngay lập tức.
- **Cách sửa:** Thêm listener cho bảng `BookingItems` (sự kiện `*`) trong `useEffect` của `app/reception/dispatch/page.tsx`. Khi có thay đổi, hệ thống sẽ tự động gọi lại `fetchData()` để làm mới UI ngay tức khắc.

---

## Chi tiết các file thay đổi

### Cập nhật `app/reception/dispatch/types.ts`
- Thêm `price?: number;` vào interface `ServiceBlock`.

### Cập nhật `app/reception/dispatch/page.tsx`
- Sửa hàm `fetchData`: Map thuộc tính `price: Number(bi.price) || 0` vào `services`.
- Sửa hàm `handleDispatch`: Đổi `status: 'PREPARING'` thành `status: clonedOrder.rawStatus === 'NEW' ? 'PREPARING' : (clonedOrder.rawStatus || 'PREPARING')`.
- Thêm `.on('postgres_changes', { event: '*', schema: 'public', table: 'BookingItems' }, ...)` vào `channel` realtime.

### Cập nhật `app/reception/dispatch/_components/KanbanBoard.tsx`
- Viết logic tính `unpaidAmount`.
- Gắn UI hiển thị `Phát sinh chưa thu` cạnh badge `Chưa TT` hoặc bên dưới tên khách hàng.
