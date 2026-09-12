# Kế hoạch Refactor KTV Dispatch & TurnQueue

## 🎯 Mục tiêu
Tách bạch hoàn toàn khái niệm "Điều phối" (Dispatch) và "Vận hành" (Working) ra khỏi `TurnQueue`. Đảm bảo hệ thống tính tua chính xác tuyệt đối (1 KTV/1 Bill = 1 Tua), chống phân mảnh dữ liệu khi partial dispatch, và giải quyết triệt để các rủi ro race condition (tranh chấp KTV/Giường).

## 🛠 Lộ trình Triển khai (Step-by-Step)

### Bước 1: Vá nóng Logic tính tua và Partial Dispatch (App Level)
1. **Dừng `saveDraftDispatch()` tác động tới tua:** Đảm bảo lưu nháp không ghi nhận bất kỳ sự thay đổi nào về tua của KTV.
2. **Dừng `syncTurnsForDate()` suy tua từ `technicianCodes`:** Sửa `lib/turn-sync.ts` để ngừng đếm và cộng tua dựa trên chuỗi KTV trong `BookingItems`.
3. **Chặn Partial Dispatch overwrite `Bookings`:** Trong `app/reception/dispatch/page.tsx`, ngăn việc dispatch cục bộ 1 dịch vụ ghi đè lên `roomName`, `bedId`, `technicianCode`, `notes` của toàn bộ đơn hàng.
4. **Fix hiển thị Ghi chú KTV:** Khi load đơn, đảm bảo UI ưu tiên nạp và hiển thị đúng `notesForKtvs[ktvId]`.

### Bước 2: Supabase Schema Migration (Tái cấu trúc DB & Chính sách dữ liệu)
1. **Mở rộng `TurnQueue.status`:** Thêm trạng thái `assigned` vào vòng đời.
2. **Hỗ trợ đa dịch vụ trên TurnQueue:** Thêm cột `booking_item_ids text[]` (tạm giữ `booking_item_id` cũ để backfill).
3. **Tạo `TurnLedger` (Sổ cái Tua gốc):**
   - Các cột: `id`, `date`, `booking_id`, `employee_id`, `counted_at`, `source`, `created_at`.
   - **Unique Constraint:** `UNIQUE(date, booking_id, employee_id)` để đảm bảo tính Idempotency và chặn cộng tua trùng.
4. **Chính sách hủy đơn:** 
   - Rule 1: **Đã Confirm Dispatch nhưng CHƯA bắt đầu**: Nếu khách hủy đơn, tua vẫn được giữ trong `TurnLedger` (không rollback) để đảm bảo quyền lợi KTV đã giữ chỗ. KTV quay lại trạng thái sẵn sàng.
   - Rule 2: **Đã BẮT ĐẦU (Working) mới hủy đơn**: KTV vẫn bị tính 1 lượt tua đó (Tua vẫn nằm trong Ledger) và mất lượt ưu tiên trong hàng đợi (không được hoàn lại lượt). KTV quay lại trạng thái sẵn sàng nhưng ở cuối hàng đợi.
5. **Backfill & Cutover:** 
   - Thực hiện script backfill `booking_item_id` cũ sang mảng `booking_item_ids`.
   - Giai đoạn Dual-write: Ghi song song cả 2 cột cho đến khi refactor xong toàn bộ Consumer.

### Bước 3: Tạo RPC `dispatch_confirm_booking` (Transaction & Idempotency)
Tạo hàm RPC trên Supabase thực thi Atomic:
1. **Idempotency Check:** Dựa trên `TurnLedger` UNIQUE constraint. Nếu đã tồn tại bản ghi tua cho KTV này trong bill này -> Bỏ qua bước insert Ledger và gán hàng đợi lần 2.
2. **Validate:** Kiểm tra KTV / Bed còn available tại thời điểm commit.
3. **Update BookingItems:** Cập nhật trạng thái và thông tin dịch vụ.
4. **Update TurnQueue:** Gán KTV vào lịch (`assigned`).
5. **Insert TurnLedger:** Chốt tua vĩnh viễn (Sử dụng `ON CONFLICT DO NOTHING`).
6. **Recompute Bookings summary (Derived Fields):** 
   - Tổng hợp lại `technicianCode`, `roomName`, `bedId`, `notes`, `status` từ danh sách `BookingItems`.
   - **Cấm tuyệt đối** UI hoặc Partial Dispatch ghi đè trực tiếp các field summary này theo kiểu cục bộ.

### Bước 4: Refactor toàn bộ Consumer của `booking_item_id`
Chuyển toàn bộ luồng đọc/ghi sang mảng `booking_item_ids`:
1. `app/reception/dispatch/actions.ts` & `app/reception/dispatch/page.tsx`
2. `app/api/ktv/booking/route.ts`
3. Các luồng **Add-on / Edit / Remove** service.

### Bước 5: Cập nhật UI & Trạng thái Vận hành
1. **`DispatchStaffRow.tsx` & Kanban:** Bổ sung hiển thị và xử lý cho trạng thái `assigned` (Đã giữ người nhưng chưa bắt đầu).
2. **Push Notification:** Chỉ bắn thông báo app layer sau khi RPC commit thành công.

### Bước 6: UAT Checklist (Mở rộng)
- [ ] Draft không tính tua.
- [ ] Confirm dispatch tính đúng 1 tua/KTV/bill (Idempotency test: bấm 2 lần không sao).
- [ ] Assigned không hiển thị là working.
- [ ] Start mới chuyển sang working.
- [ ] Hủy đơn sau dispatch không mất tua (theo rule nghiệp vụ).
- [ ] Add-on/edit/remove service không làm kẹt TurnQueue.
- [ ] Partial dispatch không làm mất summary booking (technicianCode, roomName...).
- [ ] Race condition: 2 người cùng giành KTV/Bed phải có 1 người bị chặn bởi RPC.
