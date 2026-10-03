# Phân Tích & Kế Hoạch Sửa Lỗi Trạng Thái "Dọn Phòng" Bị Lùi Về "Chuẩn Bị"

## 1. Phân Tích Nguyên Nhân (Root Cause Analysis)
Dựa trên gợi ý của bạn: *"kiểm xem cái tính năng bắt đầu dịch vụ này có làm sai hk, có thể là nó làm cho việc ghi cái bắt đầu vào cái item hk gộp"*. Bạn đã bắt đúng "bệnh" của hệ thống!

**Luồng gây ra lỗi như sau:**
1. **Lỗi Gán KTV vào Dịch vụ Con:** Khi Lễ tân gộp 2 dịch vụ (VD: Lấy ráy tai + Chăm sóc da), nếu KTV vô tình được gán trực tiếp vào dịch vụ Con (Chăm sóc da) thay vì dịch vụ Cha (Lấy ráy tai) — hoặc KTV tự bấm bắt đầu trước khi Lễ tân gộp.
2. **KTV Bấm "Bắt đầu làm":** API `handleStartTimer` chỉ tìm thấy KTV đang nằm ở dịch vụ Con. Nó ghi nhận `actualStartTime` và đẩy trạng thái dịch vụ Con lên `IN_PROGRESS` (Đang làm).
3. **Cơ chế Sync Cũ (Đè trạng thái):** Cơ chế đồng bộ (Sync) cũ lại có quy tắc cứng: *"Nếu mày là dịch vụ Con, mày phải lấy trạng thái của dịch vụ Cha"*.
4. **Xung Đột Trạng Thái:** Vì dịch vụ Cha chưa có KTV làm, nó vẫn đang ở `PREPARING` (Chuẩn bị). Cơ chế Sync vô tình **ĐÈ ngược** dịch vụ Con (vừa lên `IN_PROGRESS`) trở về lại `PREPARING`.
5. **KTV Bấm "Dọn phòng":** Dịch vụ Con được cập nhật lên `CLEANING`. Cơ chế Sync lại tiếp tục đè nó về `PREPARING`.
6. **Hệ Quả:** Tổng trạng thái của toàn bộ đơn hàng bị kéo về `PREPARING` (Chuẩn bị) mặc dù KTV đã làm xong và đang dọn phòng.

## 2. Giải Pháp Khắc Phục (Implementation Plan)

Chúng ta cần can thiệp ở 2 chốt chặn: **Backend API (Khi KTV thao tác)** và **Receptionist App (Khi Lễ tân gộp dịch vụ)**.

### A. Chốt chặn 1: Backend (KTV API) - "Smart Sync bằng Trọng Số"
Sửa đổi logic đồng bộ trong `handleStartTimer.ts` và `handleFinishService.ts`:
Thay vì ép dịch vụ Con luôn phải theo dịch vụ Cha (rất dễ bị lỗi nếu dữ liệu cũ gán nhầm KTV), ta sẽ dùng **Trọng số trạng thái (Status Weight)**:
- `NEW` (0) < `WAITING` (1) < `PREPARING` (2) < `IN_PROGRESS` (4) < `CLEANING` (5) < `DONE` (7).
- Hệ thống sẽ tìm **Trạng thái cao nhất** trong nhóm dịch vụ đã gộp, và ép TẤT CẢ các dịch vụ trong nhóm đó (cả Cha lẫn Con) lên trạng thái cao nhất này.
- *Lợi ích:* KTV dù bấm vào Cha hay Con, toàn bộ nhóm đều sẽ tiến lên phía trước, tuyệt đối không bao giờ bị lùi lại.

### B. Chốt chặn 2: Receptionist (App Lễ tân) - "Dọn dẹp dữ liệu gộp"
Sửa file `app/reception/dispatch/actions.ts` (API lưu bảng điều phối):
- Khi Lễ tân bấm "Lưu", nếu hệ thống phát hiện có dịch vụ Con (bị gộp), nó sẽ tự động **cắt toàn bộ KTV (technicianCodes) và Thời gian (segments)** của dịch vụ Con và **CHUYỂN HẾT sang cho dịch vụ Cha**.
- *Lợi ích:* Đảm bảo cơ sở dữ liệu luôn sạch sẽ. Dịch vụ Con chỉ đóng vai trò "hóa đơn", toàn bộ thời gian và KTV được tập trung quản lý tại dịch vụ Cha. Dứt điểm triệt để lỗi ghi nhận sai đối tượng.

## 3. Các file sẽ sửa đổi
#### [MODIFY] `app/api/ktv/booking/_handlers/handleStartTimer.ts`
- Cập nhật logic "🔄 SYNC CHILD ITEMS" thành "🔄 SYNC MERGED ITEMS STATUS" (Sử dụng Status Weight).

#### [MODIFY] `app/api/ktv/booking/_handlers/handleFinishService.ts`
- Cập nhật logic "🔄 SYNC CHILD ITEMS" tương tự như trên.

#### [MODIFY] `app/reception/dispatch/actions.ts`
- Thêm tiền xử lý (Pre-processor) để tự động chuyển `technicianCodes` và `segments` từ Child sang Parent trước khi lưu vào Database.
