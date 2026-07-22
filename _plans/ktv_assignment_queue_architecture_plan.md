# KTV Current And Next Assignment Architecture Plan

## Mục tiêu

- Tách rõ dữ liệu `đơn đang làm` và `đơn đã gán nhưng chưa tới lượt`.
- Chặn tình trạng KTV bị mất đơn tiếp theo hoặc bị hiểu nhầm là đã hết đơn.
- Hỗ trợ ổn định cho các case:
  - 1 KTV có 1 đơn
  - 1 KTV có 2 đơn nối tiếp
  - 1 KTV có nhiều đơn chờ
  - booking nhiều item
  - booking nhiều KTV
  - add-on chen giữa
  - đổi điều phối / hủy / reorder

## Kết luận kiến trúc

Không nên giải quyết bằng cách thêm một cột kiểu `next_order_id` vào `TurnQueue`.

Lý do:

- Không đủ để biểu diễn nhiều hơn 1 đơn chờ.
- Không xử lý tốt `booking item`, `segment`, `room`, `bed`, `priority`.
- Dễ stale khi:
  - đổi giờ
  - đổi KTV
  - hủy đơn
  - add-on chen ngang
  - nhiều đơn cùng chờ
- Khi một cột vừa đóng vai trò cache, vừa đóng vai trò source of truth, bug sẽ rất khó debug.

Giải pháp tốt hơn là mô hình 2 lớp:

1. `TurnQueue` chỉ quản lý `active work`
2. `KtvAssignments` quản lý `queued / future work`

## Mô hình dữ liệu đề xuất

### 1. `TurnQueue` chỉ là trạng thái hiện tại

Mỗi KTV tối đa có 1 dòng active cho 1 ngày (`business_date`).

Các field nên giữ:

- `employee_id`
- `date` (đóng vai trò là `business_date`, tuân thủ rule cắt ngày lúc 06:00 sáng hôm sau)
- `status`
- `current_order_id`
- `current_booking_item_id`
- `current_segment_id`
- `room_id`
- `bed_id`
- `start_time`
- `estimated_end_time`
- `last_served_at`
- `turns_completed`

Ý nghĩa:

- Bảng này chỉ trả lời câu hỏi:
  - `Ngay lúc này KTV đang làm gì?`
- Không dùng bảng này để nhớ cả hàng chờ phía sau.

### 2. Tạo bảng mới `KtvAssignments`

Mỗi dòng là 1 assignment thật sự cho 1 KTV.

Field gợi ý:

- `id`
- `employee_id`
- `date` (đóng vai trò là `business_date`, tuân thủ rule 06:00 AM. Ca làm việc kết thúc lúc 06:00 sáng hôm sau vẫn tính vào ngày trước đó)
- `booking_id`
- `booking_item_id`
- `segment_id`
- `planned_start_time`
- `planned_end_time`
- `room_id`
- `bed_id`
- `priority`
- `sequence_no`
- `status`
- `dispatch_source`
- `created_at`
- `updated_at`

`status` đề xuất:

- `QUEUED`
- `READY`
- `ACTIVE`
- `COMPLETED`
- `CANCELLED`
- `SKIPPED`

Ý nghĩa:

- `QUEUED`: đã gán nhưng chưa tới lượt
- `READY`: có thể đẩy lên ngay khi KTV rảnh
- `ACTIVE`: đang được sync vào `TurnQueue`
- `COMPLETED`: assignment này đã xong
- `CANCELLED`: assignment bị hủy
- `SKIPPED`: assignment bị bỏ qua vì reorder hoặc đổi điều phối

## Source of truth

### `TurnQueue`

Là source of truth cho:

- KTV đang làm booking nào
- item nào đang active
- segment nào đang active
- phòng / giường hiện tại
- thời gian kết thúc ước tính hiện tại

### `KtvAssignments`

Là source of truth cho:

- KTV còn bao nhiêu việc đang chờ
- đơn nào tới lượt tiếp theo
- thứ tự ưu tiên giữa các đơn chờ
- dữ liệu gốc của handoff từ đơn cũ sang đơn mới

### `BookingItems / segments`

Vẫn là source of truth nghiệp vụ:

- dịch vụ gì
- ai làm
- segment nào
- runtime thật (`actualStartTime`, `actualEndTime`, `reviewTime`, `feedbackTime`)

Nhưng không nên dùng trực tiếp bảng này để suy ra toàn bộ queue của KTV theo thời gian thực.

## Luồng hoạt động chuẩn

### Giai đoạn điều phối

1. Điều phối tạo hoặc cập nhật `KtvAssignments` (Gán đúng `business_date` của ca làm việc, tính theo mốc cắt ngày 06:00 sáng).
2. Assignment đầu tiên đủ điều kiện được set `READY`
3. Backend promote 1 assignment sang `ACTIVE`. **Ràng buộc Database (Invariant)**: `CREATE UNIQUE INDEX ... WHERE status = 'ACTIVE'`. Cứng ở mức DB, đảm bảo 1 KTV tuyệt đối chỉ có đúng 1 assignment `ACTIVE` trong cùng 1 `business_date`.
4. Backend sync assignment `ACTIVE` vào `TurnQueue`

### Giai đoạn KTV đang làm

1. KTV app chỉ đọc `current` từ `TurnQueue`
2. Nếu cần hiển thị đơn kế tiếp, app đọc danh sách `next assignments`
3. Booking mới không được cướp context của booking đang active

### Giai đoạn hoàn tất đơn hiện tại

1. KTV hoàn tất timer
2. KTV qua `REVIEW / HANDOVER / REWARD`
3. Backend confirm hậu kỳ đã xong
4. Assignment `ACTIVE` chuyển thành `COMPLETED`
5. `TurnQueue.current_*` được release
6. Backend query assignment kế tiếp:
   - ưu tiên `READY`
   - nếu không có thì lấy `QUEUED` nhỏ nhất theo `priority`, `sequence_no`, `planned_start_time`
7. Assignment kế tiếp được promote thành `ACTIVE`
8. Sync ngược sang `TurnQueue`

## Rule chọn đơn kế tiếp

Khi một KTV có nhiều assignment chờ, chọn theo thứ tự:

1. `priority` cao hơn
2. `planned_start_time` sớm hơn
3. `sequence_no` nhỏ hơn
4. `created_at` sớm hơn

Không nên chọn theo:

- chuỗi `technicianCode` ở cấp booking
- `booking.updatedAt`
- `timeEnd` ước tính của booking khác một cách gián tiếp

## Vì sao mô hình này giải quyết được case NH018 / NH025

Case vừa gặp cho thấy:

- `NH018` còn active item nên còn đơn
- `NH025` bị release sớm do item riêng của bạn ấy sang `FEEDBACK`
- booking tổng vẫn còn chạy

Nếu có mô hình 2 lớp:

- `TurnQueue` chỉ nói `NH025` hiện không active nữa
- nhưng `KtvAssignments` vẫn biết `NH025` còn assignment nào chờ hay không
- app sẽ không kết luận sai là `NH025` đã hết việc chỉ vì `current_order_id` bị clear

Nói cách khác:

- `hết current order` không đồng nghĩa với `hết mọi assignment`
- đây chính là điểm kiến trúc hiện tại đang thiếu

## So sánh với phương án `next_order_id`

### Nếu chỉ thêm `next_order_id`

Ưu điểm:

- Làm nhanh
- Dễ hiểu trong ngắn hạn

Nhược điểm:

- Chỉ giữ được 1 đơn tiếp theo
- Không đủ thông tin item / segment
- Khó xử lý reorder
- Khó xử lý cancel
- Khó xử lý add-on chen ngang
- Khó mở rộng nhiều đơn
- Dễ lệch giữa `current_order_id` và `next_order_id`

### Nếu dùng `KtvAssignments`

Ưu điểm:

- Hỗ trợ từ 1 đến nhiều đơn
- Rõ current / next / queued
- Dễ debug
- Dễ viết rule handoff
- Dễ support multi-item, multi-KTV
- Dễ thêm dashboard theo hàng chờ thật

Nhược điểm:

- Phải thêm bảng và sửa flow
- Tốn công migration hơn

Kết luận:

- `next_order_id` chỉ nên dùng như `cache/hint` nếu thật sự cần
- không nên dùng như source of truth

## Pha triển khai đề xuất

### Pha 1. Chốt contract dữ liệu

- Chốt schema `KtvAssignments`
- Chốt enum `status`
- Chốt rule chọn assignment kế tiếp
- Chốt rule promote `QUEUED -> READY -> ACTIVE`

### Pha 2. Song song hóa với hệ thống hiện tại

- Tạo `KtvAssignments`
- Khi điều phối, vừa ghi logic cũ vừa ghi assignment mới
- Chưa đổi toàn bộ KTV app ngay

### Pha 3. Đọc `current` từ `TurnQueue`, đọc `next` từ `KtvAssignments`

- API KTV trả:
  - `current`
  - `nextAssignments`
- UI KTV không còn tự suy đoán đơn kế tiếp từ booking hoặc poll mơ hồ

### Pha 4. Handoff bằng backend

- Khi release current order:
  - complete assignment active
  - promote assignment tiếp theo
  - update `TurnQueue`
- Toàn bộ handoff phải atomic nếu có thể

### Pha 5. Cleanup logic cũ

- Giảm phụ thuộc vào:
  - `booking.technicianCode`
  - `TurnQueue.booking_item_id` kiểu legacy
  - suy đoán đơn tiếp theo từ `BookingItems` rời rạc

## Test matrix bắt buộc

### Case 1. Một KTV có đúng 1 đơn

- Finish xong thì không còn `current`
- Không có `next`

### Case 2. Một KTV có 2 đơn nối tiếp

- Đơn 1 active
- Đơn 2 queued
- Finish đơn 1 xong thì đơn 2 tự trở thành current

### Case 3. Một KTV có 3 đơn chờ

- Thứ tự handoff phải theo `priority + sequence_no + planned_start_time`

### Case 4. Đơn tiếp theo bị hủy

- Assignment đó sang `CANCELLED`
- Hệ thống chọn assignment kế tiếp khác

### Case 5. Add-on chen ngang

- Add-on mới được gắn `priority` cao hơn
- Sau release current order, add-on được promote trước

### Case 6. Multi-KTV booking

- Mỗi KTV có assignment riêng
- Không vì KTV A xong mà queue của KTV B bị clear nhầm

### Case 7. Đổi giờ hoặc đổi phòng của đơn chờ

- Update đúng assignment queued
- Không làm hỏng current assignment

### Case 8. Refresh / polling / realtime

- Không được kéo current sang queued
- Không được mất next assignments

## Definition of done

- KTV app luôn biết rõ:
  - đơn hiện tại
  - đơn tiếp theo
- Ràng buộc an toàn: Khóa cứng DB đảm bảo tuyệt đối mỗi KTV chỉ có **duy nhất 1 ACTIVE assignment** trên cùng 1 `business_date`.
- Luôn lấy mốc 06:00 sáng làm giờ cắt ngày (Business Date) cho toàn bộ queue và assignment.
- Một KTV có thể có 0, 1, 2 hoặc nhiều đơn chờ mà không cần thêm cột mới vào `TurnQueue`
- Không còn tình trạng:
  - mất đơn tiếp theo
  - release quá sớm
  - app hiểu nhầm là hết việc
  - booking mới cướp context booking cũ
- Handoff từ đơn cũ sang đơn mới do backend quyết định, không để UI tự suy luận mơ hồ
