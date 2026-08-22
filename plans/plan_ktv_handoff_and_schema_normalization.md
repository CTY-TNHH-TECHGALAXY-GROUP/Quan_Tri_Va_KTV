# Kế Hoạch Triển Khai: Chuẩn Hóa Schema KtvAssignments & Auto-Handoff Engine

## Mục Tiêu Cốt Lõi
Hoàn thiện "Nửa Sau" (Read-Path/Handoff) của kiến trúc phân ca KTV, đồng thời đập bỏ hoàn toàn logic "nối chuỗi" (comma-string) để chuyển sang mô hình assignment độc lập, nguyên tử (1 dòng = 1 item assignment). Đảm bảo KTV có thể làm việc liên tục (từ đơn A sang đơn B) mà không bị "rớt" đơn.

---

## Task 1: Chuẩn hóa Schema `KtvAssignments` (1 Dòng = 1 Item Assignment)
**File ảnh hưởng:** `supabase/migrations/20260502150000_create_ktv_assignments.sql`

**Chi tiết công việc:**
1. Sửa cột `booking_item_id` (trước đây là chuỗi VARCHAR chứa nhiều ID) thành kiểu chuẩn cho 1 item duy nhất.
2. **Không dùng JSONB Array** làm source of truth cho items, đảm bảo mỗi item/KTV là một record riêng biệt trong bảng `KtvAssignments`.
3. Chỉnh sửa logic `dispatch_confirm_booking` RPC: 
   - Thay vì nhận 1 chuỗi `p_technician_code` và ghép item, RPC sẽ lặp qua mảng `p_item_updates` và insert từng dòng độc lập vào `KtvAssignments` cho từng KTV.
   - Thêm constraint/logic để đảm bảo không có duplicate assignment cho cùng 1 KTV trên 1 item.

---

## Task 2: Xây Dựng Auto-Handoff Engine (Cửa Ra)
**File ảnh hưởng:** `supabase/migrations/...` (Thêm RPC mới) và `app/reception/dispatch/actions.ts`

**Chi tiết công việc:**
1. Viết một Stored Procedure/RPC mới: `promote_next_assignment(p_employee_id, p_business_date)`.
2. Logic của hàm `promote_next_assignment(p_employee_id, p_business_date)`:
   - **Rule chọn đơn kế tiếp (Deterministic):** Bắt buộc ưu tiên theo `queue_position` nhỏ nhất (ưu tiên cao nhất), nếu bằng nhau thì dùng `created_at` tăng dần (ai tới trước làm trước). Tuyệt đối không để mơ hồ.
   - Nếu tìm thấy 1 assignment đạt tiêu chuẩn trên, đổi status thành `ACTIVE`.
   - Đồng bộ (Sync) assignment này vào `TurnQueue` (Set `current_order_id`, `booking_item_id`, đổi status thành `assigned` sẵn sàng phục vụ).
   - **Bảo toàn Invariant:** Tuyệt đối giữ nguyên tắc 1 KTV chỉ có tối đa 1 assignment `ACTIVE` trong cùng một `business_date`.
3. **Trigger Handoff (Per-KTV Release):** Gọi hàm `promote_next_assignment` ngay lập tức khi một KTV HOÀN THÀNH (hoặc BỊ RÚT KHỎI) item của họ (ví dụ: qua API `RELEASE_KTV` hoặc khi update segment actualEndTime). Tuyệt đối **không chờ đến khi toàn bộ Booking đạt status DONE**, vì các KTV có thể hoàn thành phần việc của mình ở các thời điểm khác nhau.

---

## Task 3: Dọn Dẹp Frontend Dispatch Payload
**File ảnh hưởng:** `app/reception/dispatch/page.tsx`

**Chi tiết công việc:**
1. Tháo bỏ các đoạn code đang nối `bookingItemId` thành chuỗi `item1,item2` bằng dấu phẩy.
2. Thiết kế lại payload `itemUpdates` gửi xuống RPC: Truyền cấu trúc mảng assignment rõ ràng (mỗi `ServiceBlock` là 1 object độc lập chứa `bookingItemId` và mảng `technicianCodes`).
3. Đảm bảo UI hoạt động tương thích hoàn toàn với schema "1-Item-1-Assignment", đặc biệt trong case 1 Booking chứa 2 Dịch Vụ cho cùng 1 KTV.

---

## Kế hoạch Rollout & Testing (Cutover Gate)
1. **Dual-write Window (Phase 1):** Sửa DB Schema và RPC để phân mảnh 1 dòng = 1 item. Song song đó, code cũ vẫn update `TurnQueue` trực tiếp. `KtvAssignments` đóng vai trò bảng phụ (Shadow DB) để check dữ liệu chạy ngầm có đúng không.
2. **Read-Path Cutover (Phase 2):** Khi dữ liệu shadow đã mượt, bật Auto-Handoff Engine. Các API `RELEASE_KTV` sẽ chính thức gọi `promote_next_assignment` để feed dữ liệu vào `TurnQueue`.
3. **Rollback Plan:** Dễ dàng ngắt cờ (Feature Flag hoặc comment out lệnh gọi promote) để fallback về luồng manual cũ nếu phát hiện KTV kẹt đơn diện rộng.
4. Chạy script `simulate_handoff.js` giả lập stress test (nhiều KTV chốt đơn đồng loạt) để khóa cứng Invariant trước khi cho Lễ Tân dùng thật.

> **Tình trạng:** Chờ duyệt để tiến hành code.
