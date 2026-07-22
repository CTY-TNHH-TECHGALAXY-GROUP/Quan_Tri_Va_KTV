# Kế hoạch Hiện thị Thời gian Bắt đầu/Kết thúc cho Từng Dịch Vụ

Tính năng này nhằm giải quyết vấn đề hệ thống hiện tại chỉ lấy thời gian bắt đầu chung của toàn bộ đơn hàng (Bookings), dẫn đến việc không thể theo dõi chính xác tiến độ của từng KTV trên từng dịch vụ cụ thể.

## ❗️ User Review Required
Bạn vui lòng kiểm tra kế hoạch này. Sự thay đổi này sẽ ảnh hưởng đến giao diện của thẻ đơn hàng trên **Bảng Điều Phối (Dispatch Board)**. Thẻ đơn hàng sẽ dài ra một chút để có thể hiển thị chi tiết từng dịch vụ.

## ❓ Open Questions
- Khi KTV bấm "Bắt đầu", hệ thống sẽ cộng `[Thời gian hiện tại] + [Tổng thời lượng các chặng (segments) của dịch vụ]` để ra `Kết thúc`. Cách tính này đã chuẩn chưa?
- Đối với 1 dịch vụ do 2 KTV cùng làm (cùng gán vào 1 BookingItem), thời gian bắt đầu sẽ tính theo người bấm đầu tiên hay người bấm sau cùng? (Đề xuất: Người bấm đầu tiên sẽ kích hoạt thời gian của dịch vụ đó).

## Proposed Changes

---

### API Cập nhật Trạng Thái (KTV)
Cập nhật API khi KTV bấm Bắt đầu để lưu thời gian riêng lẻ cho từng dịch vụ.

#### [MODIFY] `app/api/ktv/booking/route.ts`
- **Logic cập nhật:**
  - Thay vì ghi đè `Bookings.timeStart` mọi lúc, chỉ cập nhật `Bookings.timeStart` nếu nó đang bị trống (để làm mốc bắt đầu chung).
  - Cập nhật chính xác `timeStart` vào bảng `BookingItems` cho các dịch vụ (`allItemIdsForThisKTV`) mà KTV này đang phục vụ.
  - **Tính toán `timeEnd`**: Duyệt qua mảng `segments` của từng dịch vụ để lấy tổng số phút (duration). Ngay khi KTV bấm "Bắt đầu", lập tức set `timeEnd = timeStart + tổng_phút` cho `BookingItem` tương ứng.

---

### Backend Data Fetching (Điều Phối)
Cấu trúc lại dữ liệu trả về cho trang Điều phối để bao gồm thông tin thời gian của từng dịch vụ.

#### [MODIFY] `app/reception/dispatch/types.ts`
- Bổ sung trường `timeStart?: string` và `timeEnd?: string` vào interface `ServiceBlock`.

#### [MODIFY] `app/reception/dispatch/actions.ts`
- Đảm bảo hàm `fetchDispatchData` lấy các trường `timeStart`, `timeEnd` từ bảng `BookingItems` và ánh xạ đúng vào mảng `services` của `PendingOrder`.

---

### Giao Diện Bảng Điều Phối (Dispatch Board)
Vẽ lại component thẻ đơn hàng để đáp ứng yêu cầu UI mới.

#### [MODIFY] `app/reception/dispatch/_components/KanbanBoard.tsx`
- Loại bỏ khung "Bắt đầu -> Kết thúc" dùng chung ở cuối thẻ đơn hàng.
- Nâng cấp vòng lặp map `order.services` bên trong OrderCard:
  - Hiển thị tên dịch vụ + phòng.
  - Phía dưới tên dịch vụ, hiển thị tên KTV được phân công (từ `s.staffList`).
  - Nếu dịch vụ đã được bấm bắt đầu (có `s.timeStart`), hiển thị ngay 1 thanh nhỏ dạng: `[Bắt đầu: 15:29] ➔ [Kết thúc: 16:29]`.
  - Giữ lại tính năng "tính tổng thời gian dự kiến (ra ca)" trên góc phải của thẻ để Lễ tân tiện theo dõi mốc hoàn thành cuối cùng.

## Verification Plan

### Manual Verification
1. Lễ tân tạo một đơn hàng gồm 2 dịch vụ (VD: Body + Cạo mặt).
2. Điều phối KTV A làm Body, KTV B làm Cạo mặt.
3. KTV A bấm "Bắt đầu" -> Kiểm tra thẻ đơn hàng xem dịch vụ Body có hiện thời gian `15:29 -> 16:29` chưa, và dịch vụ Cạo mặt vẫn trống.
4. KTV B bấm "Bắt đầu" 10 phút sau -> Kiểm tra thẻ xem dịch vụ Cạo mặt có hiện thời gian riêng `15:39 -> ...` không.
5. Kiểm tra giao diện KanbanBoard trên Mobile xem có bị vỡ layout khi nội dung thẻ đơn hàng dài ra hay không.
