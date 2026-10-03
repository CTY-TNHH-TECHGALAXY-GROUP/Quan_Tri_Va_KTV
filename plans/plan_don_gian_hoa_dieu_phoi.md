# Kế hoạch Đơn giản hoá Điều phối & KTV Dashboard (Cập nhật)

Dưới đây là kế hoạch đã được điều chỉnh dựa trên phản hồi của bạn để đáp ứng chính xác nhất nhu cầu của Lễ tân và KTV:

## 1. Trường hợp 1: 1 KTV làm từ 2 Dịch vụ trở lên trong 1 Booking
**Yêu cầu:** Gỡ bỏ logic chia "chặng", gộp tổng thời gian đếm ngược, nhưng **vẫn hiển thị** lộ trình phòng nào trước phòng nào sau, dịch vụ nào trước dịch vụ nào sau.
**Giải pháp triển khai:**
- **KTV Dashboard (`app/ktv/dashboard/*`)**: 
  - Vẫn hiển thị bảng `WorkingTimeline` liệt kê danh sách các dịch vụ & phòng theo trình tự thời gian (để KTV biết lộ trình).
  - **KHÔNG bắt KTV bấm chuyển chặng**. Màn hình Timer chính sẽ gộp tổng `duration` của TẤT CẢ dịch vụ (Ví dụ Gội 60p + Massage 60p = 120p).
  - KTV chỉ cần bấm **Bắt đầu** 1 lần cho cả lộ trình 120p. Hệ thống tự động đẩy toàn bộ `BookingItems` của KTV đó sang trạng thái `IN_PROGRESS`.
  - Hết 120p, KTV bấm **Hoàn tất** 1 lần cho toàn bộ dịch vụ.
- **Kanban Board (`KanbanBoard.tsx`)**:
  - Gộp chung hiển thị trên 1 thẻ (như hiện tại).
  - Thời gian dự kiến hoàn thành (`EstimatedEndTime`) tính tổng từ lúc bắt đầu dịch vụ đầu tiên.

## 2. Trường hợp 2: 2 KTV làm chung 1 Dịch vụ (Cùng thời gian bắt đầu)
**Yêu cầu:** 1 người bấm Bắt đầu/Hoàn tất thì đồng bộ qua người kia. Đã chạy mô phỏng.
**Kết quả chạy mô phỏng (AI Simulation):**
```bash
--- KHOI TAO MO PHONG: 1 DICH VU - 2 KTV ---
Trang thai ban dau: KTV NH01 = WAITING, KTV NH02 = WAITING

👉 [KTV NH01] Bam nut: BAT DAU DICH VU
[Backend] Nhan request tu NH01 -> Cap nhat DB: BI_123 = IN_PROGRESS
[Supabase] Phat song Realtime 'UPDATE' cho bang BookingItems
[📱 KTV NH01 App] Nhan thong bao Realtime: Trang thai -> IN_PROGRESS
[📱 KTV NH02 App] Nhan thong bao Realtime: Trang thai -> IN_PROGRESS

--- KIEM TRA DONG BO ---
Trang thai hien tai: KTV NH01 = IN_PROGRESS, KTV NH02 = IN_PROGRESS
✅ DONG BO THANH CONG: KTV NH02 da tu dong chuyen sang IN_PROGRESS!
```
**Nhận xét:** Hệ thống Database và cơ chế Realtime hiện tại của dự án *đã sẵn sàng* cho việc này. Khi tôi gộp logic bấm nút 1 lần cho toàn bộ `BookingItems`, việc đồng bộ trạng thái giữa 2 máy KTV sẽ tự động hoạt động mượt mà.

## 3. Trường hợp 3: 2 KTV làm chung 1 Dịch vụ (Người A làm trước, Người B làm sau)
**Yêu cầu:** Nếu lệch thời gian bắt đầu thì tách ra làm 2 thẻ Kanban để dễ giám sát riêng. Nếu Lễ tân setup giờ khác nhau thì tách thẻ.
**Giải pháp triển khai:**
- **Kanban Board (`KanbanBoard.tsx`)**: Sửa lại thuật toán nhóm thẻ (grouping SubOrders).
- **Thuật toán mới:** Sẽ dùng tổ hợp `[Mã KTV] + [Giờ bắt đầu]` để gom nhóm.
  - Ví dụ NH01 bắt đầu 10:00, NH02 bắt đầu 10:30 -> Tạo 2 thẻ Kanban rời. 
  - Nếu Lễ tân cho NH01 và NH02 cùng bắt đầu 10:00 -> Gộp chung 1 thẻ Kanban có 2 Avatar KTV.

---

## Tóm tắt file cần cập nhật:
1. `app/ktv/dashboard/KTVDashboard.logic.ts` (Sửa logic đếm timer gộp, update API nhiều items)
2. `app/ktv/dashboard/page.tsx` (Bỏ nút chuyển chặng, giữ Timeline hiển thị thụ động)
3. `app/reception/dispatch/_components/KanbanBoard.tsx` (Thuật toán nhóm thẻ theo KTV + StartTime)

**Kế hoạch đã được điều chỉnh. Bạn có ĐỒNG Ý để tôi tiến hành sửa code luôn không?**
