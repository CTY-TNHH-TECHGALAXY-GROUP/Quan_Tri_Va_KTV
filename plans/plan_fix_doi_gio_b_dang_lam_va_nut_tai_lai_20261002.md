# Plan — Đổi giờ B đang làm (A đã xong) + nút tải lại kèm thông báo (02/10/2026)

Mức 2 (migration RPC điều phối, `actions.ts` / `page.tsx`). Chờ duyệt.

## H1 — A làm xong, B đang làm: quầy không đổi được thời lượng B

**Nguyên nhân:**

- Popup xác nhận phía quầy đã nhận diện được chặng đang chạy, kể cả của B.
- Server chặn ở `dispatch_commit_form`. Wrapper chỉ xử lý chặng đang chạy là **lượt 1 (A)**, hoặc dịch vụ không nối tiếp, qua `dispatch_adjust_running_sequential_a` / `_pair`.
- Khi **lượt 2 (B)** đang chạy, wrapper không có nhánh xử lý. Bản lưu đi thẳng vào `dispatch_commit_form_base` và bị từ chối: "Nhân viên đã bắt đầu; dùng Dừng/Đổi để giữ giờ thực tế".

**Sửa:**

1. Migration mới, RPC `dispatch_adjust_running_sequential_b(p_booking_id, p_item_id, p_expected_revision, p_minutes, p_actor)`, làm giống bản của A:
   - Điều kiện:
     - Dịch vụ nối tiếp, trạng thái IN_PROGRESS/PAUSED, đúng revision.
     - B (lượt 2) đã bắt đầu, chưa kết thúc.
     - **Mọi chặng khác đã kết thúc hoặc đã void** (A xong).
   - Thời lượng 1–600 phút.
   - Mốc kết thúc mới = `actualStartTime` của B + số phút.
   - Kiểm tra trùng giờ của nhân viên và giường với phân công khác, giống A.
   - Cập nhật:
     - Chặng B: `endTime`, `duration`, `plannedEndAt`.
     - `KtvAssignments.planned_end_time`.
     - `TurnQueue.estimated_end_time`.
     - Lịch sử ghi action `ADJUST_B_DURATION`.
   - Chỉ cấp quyền cho `service_role`.
2. Thêm nhánh vào wrapper `dispatch_commit_form` (thân copy từ bản đang chạy `20261001102000`):
   - Khi B lượt 2 đang chạy và quầy chỉ đổi thời lượng hoặc giờ kết thúc của B, gọi RPC mới.
   - Đổi nhân viên, phòng hoặc giờ bắt đầu thì báo lỗi rõ ràng.
   - Thêm `durationChanges` cho B.
3. Thông báo:
   - Nút "Xác nhận / Hủy bỏ" có sẵn, đổi câu hỏi thành **"Thay đổi thời gian của dịch vụ đã bắt đầu?"**.
   - Xác nhận xong, B nhận thông báo `KTV_ORDER_CHANGED`: "Quầy đã thay đổi thời gian dịch vụ của bạn thành X phút (bắt đầu–kết thúc). Vui lòng kiểm tra đồng hồ."
   - Admin nhận cảnh báo như khi đổi giờ A.
   - Đồng hồ trên app B tự cập nhật theo realtime, như khi đổi giờ A (F1 trước đây).
4. **Không cho** giảm thời lượng B xuống dưới số phút B đã làm. Mốc kết thúc mới phải lớn hơn thời điểm bấm Lưu, nếu không đồng hồ B về 0 ngay.

## H2 — Thông báo khi thao tác trên dữ liệu cũ phải có nút tải lại

**Hiện tại:** các câu như "Dịch vụ đã có bản lưu mới… tải lại", "Ca đã thay đổi…", "Chặng đã thay đổi…" chỉ hiện `alert` hoặc toast. Người dùng phải tự reload trang.

**Sửa (trang điều phối):**

- Thêm hàm `notifyActionError(message)` dùng chung:
  - Câu báo thuộc loại "dữ liệu cũ" (nhận theo nội dung: *bản lưu mới / đã thay đổi / tải lại*) → mở hộp thoại có nút **"Tải lại dữ liệu"** và "Đóng".
    - "Tải lại dữ liệu" = bỏ bản nháp của đơn đó và tải lại dữ liệu bảng (`fetchData`), **không reload cả trang**, nên phần đang sửa ở đơn khác vẫn giữ.
  - Lỗi khác vẫn hiện như cũ.
- Thay các `alert(...)` ở luồng Lưu / Điều phối / Gán B / lưu theo hàng / thao tác A-B bằng `notifyActionError`.
- **App KTV:** khi bấm trên dữ liệu cũ, app đã tự tải lại đơn (`fetchBookingRef`) sau khi báo lỗi. Nếu anh/chị muốn cả hai phía giống nhau, thêm nút "Tải lại" vào toast lỗi.

**Giảm số lần phải bấm:**

- Giữ các cơ chế tự đồng bộ của đợt G6:
  - Tự lên revision mới khi chỉ có thay đổi runtime.
  - Bỏ bản nháp trùng với server.
  - Nút "Giữ bản đang sửa".
- Nút tải lại chỉ là đường lùi khi có xung đột thật.

## Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | B nhận thông báo, đồng hồ B cập nhật | Form điều phối (đổi giờ B đang làm), hộp thoại tải lại | `dispatch_commit_form`, RPC mới | Sửa |
| Tiền / giờ / tua | Hoa hồng tính theo thời lượng phân công của B (giống đổi giờ A) | — | ledger theo chặng | Thay đổi có chủ đích (quầy xác nhận) |
| Realtime | BookingItems | BookingItems | — | Đồng bộ |
| Quyền | — | chỉ `dispatch_board` | RPC chỉ `service_role` | Không đổi |

## Test

- Probe trên TEST, dữ liệu QA tự dọn, chạy `TZ=UTC`:
  - A xong → B chạy → tăng / giảm B. Kiểm segments, KtvAssignments, TurnQueue, thông báo B.
  - Giảm dưới số phút đã làm → bị từ chối.
  - Đổi nhân viên / phòng → bị từ chối.
  - A đang chạy → luồng cũ không đổi.
  - Ca đêm.
- Hồi quy: 10 đơn, F, V1/V3/T3, G3/G5, từ chối, E2E trang demo.

## Đã làm (02/10/2026)

- **H1:**
  - Migration `20261002100000_adjust_running_sequential_b.sql` đã áp lên TEST: RPC mới chỉ cấp cho `service_role`; wrapper `dispatch_commit_form` +19 dòng.
  - Câu xác nhận: "Thay đổi thời gian của dịch vụ đã bắt đầu?".
  - Thông báo cho KTV: "Quầy đã thay đổi thời gian dịch vụ của bạn thành X phút…", dùng chung cho cả A và B.
  - Probe `verify_h1_adjust_running_b.ts`: 11/11.
- **H2 (đã chỉnh theo phản hồi: bỏ "Giữ bản của tôi"):**
  - `recoverStaleSave` cho Lưu / Điều phối / lưu theo hàng / Gán B / tắt nối tiếp.
  - Gặp lỗi dữ liệu cũ thì tải lại dữ liệu và chờ bước đối chiếu bản nháp.
    - Chỉ có thao tác của KTV → tự lưu lại một lần, kèm toast "đã tự cập nhật và lưu lại".
    - Xung đột thật → hộp thoại chỉ có "Tải lại dữ liệu" và "Đóng". Tải lại chỉ bỏ bản nháp của đúng đơn đó.
  - Banner vàng cũng chỉ còn nút "Tải lại dữ liệu".
- **Hồi quy:** G3/G5 9/9, từ chối 24/24, 10 đơn 165/165, F 50/50, V1/V3/T3 25/25, bàn giao 12/12, mô phỏng G2 2/2, unit pass, E2E trang demo 17/17 (U1 thỉnh thoảng chập chờn, chạy lại 2 lần đều pass).
