# Kế hoạch phát triển: Quản lý & Gợi ý KTV ngoài (Cập nhật theo yêu cầu)

Tuyệt vời! Yêu cầu của bạn rất hợp lý và thực tế. Mình đã cập nhật lại bản vẽ kỹ thuật như sau:

## 1. Mục "KTV Ngoài" ngay trên Sổ Tua
- Thay vì làm nút bấm ẩn hay Modal rời rạc, mình sẽ tích hợp hẳn một mục **"KTV Ngoài"** (Có thể dạng một bảng nhỏ hoặc danh sách) ngay bên trong hoặc liền kề giao diện **Sổ Tua** hiện hành.
- Quầy Lễ tân có thể nhìn thấy toàn bộ danh sách KTV ngoài (mã `C_` và `EXT_`) tại đây.
- Kèm theo là công tắc **Bật/Tắt thủ công** (Chờ việc / Nghỉ).

## 2. Gợi ý gán tua thông minh & Sắp xếp thứ tự
- Khi Lễ tân "Bật" một KTV ngoài lên, người đó sẽ NGAY LẬP TỨC có mặt trong danh sách thả xuống khi chọn KTV gán tua.
- **Quy tắc sắp xếp (Sorting):** 
  - Ưu tiên 1: KTV cơ hữu của nhà (Mã `NH_xxx` hoặc không phải `EXT/C_`) sẽ luôn được đẩy lên hàng đầu.
  - Ưu tiên 2: KTV ngoài (Mã `EXT_`, `C_`) sẽ luôn bị đẩy xuống phía dưới danh sách.
  - *Mục đích:* Đảm bảo Lễ tân luôn ưu tiên xếp khách cho KTV nhà trước, chỉ khi nào thiếu người mới lướt xuống dưới chọn KTV ngoài.

## 3. Chi tiết kỹ thuật triển khai
1. **Component Sổ Tua:** Mở rộng giao diện Sổ Tua (Kanban hoặc danh sách) để render thêm block "KTV Ngoài".
2. **Logic Sắp xếp:** Tại component `DispatchStaffRow.tsx` và `QuickDispatchTable.tsx`, sửa đổi logic `.filter` và thêm `.sort` để đẩy các ID bắt đầu bằng `EXT_` và `C_` xuống cuối mảng.
3. **Database:** Khi bật/tắt thủ công, gọi API cập nhật trực tiếp vào bảng `TurnQueue` với trạng thái `waiting` hoặc `off`.

> [!NOTE]
> Bản kế hoạch đã được tinh chỉnh đúng ý bạn chưa? Nếu OK, hãy bấm **Proceed (Duyệt)** để mình bắt tay vào viết code nhé!
