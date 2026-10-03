# Kế Hoạch Sửa Lỗi Điều Chỉnh Đơn KTV Bị Lùi Trạng Thái (Cập Nhật)

## 1. Nguyên nhân gốc rễ (Root Cause)
1. **Lỗi lùi trạng thái (Mất ca KTV đang làm):**
   Khi Lễ tân thay đổi điều phối, giao diện gửi danh sách `itemUpdates` xuống máy chủ với trạng thái mặc định. Tuy server có chặn lùi trạng thái cho toàn bộ đơn (Booking), nhưng lại **thiếu chặn lùi trạng thái cho từng dịch vụ chi tiết (BookingItems)**. Do đó RPC lưu trực tiếp trạng thái cũ (ví dụ `PREPARING`) lên các dịch vụ đã `IN_PROGRESS` hoặc `DONE`.
2. **Lỗi nhảy trạng thái sai (Dịch vụ chưa gán KTV nhảy sang PREPARING):**
   Khi đơn có 3 dịch vụ, Lễ tân chỉ gán KTV cho dịch vụ 1. Tuy nhiên Frontend vẫn đẩy toàn bộ 3 dịch vụ có trạng thái `PREPARING` xuống server. Do không có logic lọc, server cũng cập nhật luôn dịch vụ 2 và 3 thành `PREPARING` mặc dù chưa hề có ai nhận ca.

## 2. Giải pháp đề xuất
Chúng ta sẽ cài đặt thêm một bộ lọc "thông minh" (PRE-PROCESSOR) trong hàm xử lý `processDispatch` và `saveDraftDispatch` tại file `app/reception/dispatch/actions.ts`:

**Bước 1:** Thay đổi câu truy vấn lấy dữ liệu hiện tại để có đủ các trường:
`select('id, segments, status, technicianCodes')` thay vì chỉ `select('id, segments')`.

**Bước 2: Sửa lỗi Dịch vụ nhảy sang "Chuẩn bị" khi chưa có KTV:**
Nếu trạng thái truyền lên (`updateItem.status`) là `PREPARING`, nhưng dịch vụ này **KHÔNG CÓ KTV NÀO ĐƯỢC GÁN** (`technicianCodes` rỗng), thì hệ thống sẽ tự động ép trạng thái của dịch vụ này về lại `WAITING` (Chờ) thay vì `PREPARING`.

**Bước 3: Sửa lỗi Lùi trạng thái của ca đang làm/đã xong:**
Áp dụng thang điểm trọng số cho các trạng thái:
`'NEW': 0, 'WAITING': 1, 'PREPARING': 2, 'READY': 3, 'IN_PROGRESS': 4, 'CLEANING': 5, 'FEEDBACK': 6, 'DONE': 7`.
Nếu trạng thái đang có ở DB cao hơn trạng thái truyền lên, ta ghi đè `updateItem.status = dbItem.status` để bảo vệ, KHÔNG cho lùi trạng thái (ví dụ KTV đã xong thì Lễ tân bấm lưu sẽ không bị mất).

## 3. Các file sẽ bị ảnh hưởng
- **[MODIFY]** `app/reception/dispatch/actions.ts`

## 4. Xác minh (Verification)
- Điều phối đơn 3 dịch vụ, chỉ gán KTV cho dịch vụ 1 -> Dịch vụ 1 là Chuẩn bị (PREPARING), dịch vụ 2 & 3 là Chờ (WAITING).
- Khi KTV bấm Bắt đầu (IN_PROGRESS) cho DV1. Lễ tân vào gán KTV cho DV2 và bấm cập nhật.
- Kết quả: DV1 vẫn giữ nguyên `IN_PROGRESS` (không bị lùi), DV2 nhảy sang `PREPARING`, DV3 vẫn là `WAITING`.

## ⚠️ Cần User Duyệt
Bạn vui lòng kiểm tra và phản hồi xem có đồng ý với phương án BỔ SUNG này không để mình tiến hành sửa code nhé!
