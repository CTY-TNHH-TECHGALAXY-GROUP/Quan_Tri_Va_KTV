# Kế hoạch Fix Lỗi Nhảy Trạng Thái DV1 và Hỗ Trợ Kéo Lùi Chuẩn Bị (PREPARING)

## Bối cảnh (Context)
Bạn gặp 2 vấn đề:
1. Đơn 2 dịch vụ (DV1, DV2), KTV của DV1 đã bấm "Bắt đầu" (trạng thái `IN_PROGRESS`). Tại màn hình Điều Phối (Lễ tân), khi bạn đổi/chỉnh thời gian cho DV2 và bấm "Lưu điều phối", DV1 tự động bị "nhảy trạng thái" lùi về `PREPARING` (Chuẩn bị), khiến KTV bị mất timer.
2. Bạn muốn nếu Lễ tân cố tình kéo một thẻ từ cột `IN_PROGRESS` ngược về cột `PREPARING` trên bảng Kanban thì hệ thống phải hiện bảng Xác nhận (Confirm) để tránh kéo nhầm.

## Nguyên nhân gốc rễ (Root Cause)
1. **Lỗi ghi đè dữ liệu cũ (Stale Data Overwrite)**: Khi bạn mở Modal "Đổi dịch vụ" lúc KTV chưa bấm Bắt đầu, dữ liệu trên máy bạn chưa có `actualStartTime`. Sau đó KTV bấm Bắt đầu, DB đã lưu thời gian. Khi bạn bấm "Lưu", giao diện gửi mảng `segments` cũ (không có thời gian) lên đè vào DB, làm xóa mất `actualStartTime` của DV1, khiến App KTV hiểu là chưa bắt đầu và lùi về màn hình Chuẩn bị.
2. **Kéo lùi bị chặn cứng**: Hàm `canTransition` ở Backend và Frontend hiện đang chặn 100% các thao tác kéo lùi trạng thái (Backward) nên bạn không thể kéo lùi được.

## Đề xuất thay đổi (Proposed Changes)

### 1. Fix lỗi ghi đè xóa giờ (Stale Data Overwrite)
#### [MODIFY] `app/reception/dispatch/actions.ts`
- Tại hàm `processDispatch` và `saveDraftDispatch`: Bổ sung một lớp Pre-processor. Trước khi gọi RPC xuống Database, hệ thống sẽ tự động `select` mảng `segments` hiện tại trong DB.
- Trích xuất các trường `actualStartTime`, `actualEndTime`, `feedbackTime`, `reviewTime` đang có trong DB và "trộn" (merge) ngược vào dữ liệu mà Lễ tân gửi lên.
- **Kết quả**: Dù Lễ tân có bấm Lưu chậm, thời gian KTV đã bấm Bắt đầu cũng sẽ được giữ nguyên tuyệt đối, KHÔNG BAO GIỜ bị xóa mất.

### 2. Cho phép kéo ngược thẻ về PREPARING (có cảnh báo)
#### [MODIFY] `app/reception/dispatch/_components/KanbanBoard.tsx`
- Sửa đổi sự kiện `onDrop`: Nếu kéo lùi thẻ (`canTransition` trả về false nhưng `toIdx < fromIdx`), hiển thị `confirm()`: *"Trạng thái đang đi lùi từ [A] về [B]. Bạn có chắc chắn muốn KÉO LẠI và reset thời gian không?"*.
- Nếu chọn OK, gọi hàm `onUpdateStatus` kèm theo một tham số `forceBackward=true`.

#### [MODIFY] `app/reception/dispatch/page.tsx`
- Cập nhật hàm `handleUpdateStatus` để nhận tham số `forceBackward`.

#### [MODIFY] `app/reception/dispatch/actions.ts`
- Cập nhật hàm `updateBookingItemStatus` nhận biến `forceBackward`. Nếu `true`, bỏ qua `canTransition`.
- Đồng thời bổ sung logic: Nếu ép lùi về `PREPARING`, sẽ tự động **XÓA SẠCH** `actualStartTime`, `actualEndTime` trong DB của các Item đó để KTV có thể làm lại từ đầu.

## User Review Required
> [!IMPORTANT]
> Việc cho phép kéo ngược về `PREPARING` và xóa sạch thời gian đã làm của KTV là một quyền lực khá lớn của Lễ Tân. Vui lòng xác nhận bạn đồng ý với luồng này (có hộp thoại Confirm bảo vệ).

Xin bạn xem và duyệt Kế hoạch này (reply OK) để tôi bắt tay vào sửa mã nguồn nhé!
