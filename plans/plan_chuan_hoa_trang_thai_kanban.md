# Kế Hoạch Chuẩn Hóa Trạng Thái Kanban

## Mục tiêu

Chuẩn hóa toàn bộ flow trạng thái của màn giám sát đơn theo một contract duy nhất:

`Chuẩn bị -> Đang làm -> Dọn phòng -> Đánh giá -> Hoàn tất`

Trong đó:
- `Hoàn tất` là trạng thái khóa cứng, không được đi tiếp hay lùi lại.
- UI Kanban, context menu, drag/drop, realtime patching, server actions và KTV API phải hiểu cùng một flow.

---

## Trạng thái mong muốn

### 1. Thứ tự cột Kanban

Thứ tự cột đúng cần là:
1. `Chuẩn bị`
2. `Đang làm`
3. `Dọn phòng`
4. `Đánh giá`
5. `Hoàn tất`

### 2. Flow chuyển trạng thái hợp lệ

- Từ `Chuẩn bị`:
  - được đi tới `Đang làm`
  - được đi tới `Dọn phòng`
  - được đi tới `Đánh giá`
  - được đi tới `Hoàn tất`

- Từ `Đang làm`:
  - được đi tới `Dọn phòng`
  - được đi tới `Đánh giá`
  - được đi tới `Hoàn tất`

- Từ `Dọn phòng`:
  - được đi tới `Đánh giá`
  - được đi tới `Hoàn tất`

- Từ `Đánh giá`:
  - chỉ được đi tới `Hoàn tất`

- Từ `Hoàn tất`:
  - khóa cứng, không đi đâu nữa

### 3. Raw status trong DB đề xuất dùng thống nhất

- `PREPARING` = Chuẩn bị
- `IN_PROGRESS` = Đang làm
- `CLEANING` = Dọn phòng
- `FEEDBACK` = Đánh giá
- `DONE` = Hoàn tất

Ghi chú:
- `WAITING_RATING` không nên là raw status của DB.
- `COMPLETED` nếu còn dùng thì chỉ nên là alias tương thích tạm thời, không phải đích bấm trực tiếp của Kanban.

---

## Vấn đề hiện tại

### 1. Kanban đang dùng thứ tự cột sai

Hiện tại UI đang đi theo logic gần như:

`Chuẩn bị -> Đang làm -> Đánh giá -> Dọn phòng -> Hoàn tất`

Điều này lệch với quy trình nghiệp vụ mong muốn.

### 2. UI và DB đang nói hai ngôn ngữ status khác nhau

- UI dùng `waiting_rating`
- DB / raw status đang dùng `FEEDBACK`

Khi UI gửi status không đồng nhất với DB, card có thể:
- đi sang cột đúng lúc bấm
- rồi refetch/realtime xong lại nhảy về cột cũ

### 3. Có nhiều nơi tự tính lại trạng thái

Logic status hiện đang nằm rải rác ở:
- `app/reception/dispatch/_components/KanbanBoard.tsx`
- `app/reception/dispatch/page.tsx`
- `app/reception/dispatch/actions.ts`
- `app/api/ktv/booking/route.ts`

Mỗi nơi đang có mapping hơi khác nhau, dẫn đến:
- bấm xong bị nhảy lại trạng thái cũ
- trạng thái hiển thị ở Kanban khác với status thật trong DB
- transition hợp lệ ở UI nhưng server lại hiểu theo kiểu khác

### 4. Drag/drop hiện chưa bị khóa theo rule nghiệp vụ

Card có thể bị kéo sang cột không hợp lệ nếu chỉ dựa vào drop target của UI.

### 5. Backend chưa chặn đủ backward move / invalid move

Server actions hiện vẫn có nguy cơ:
- nhận status không hợp lệ từ UI
- update xong rồi recompute lại thành trạng thái khác
- hoặc cho phép ghi một trạng thái không nằm trong flow mong muốn

### 6. Có race condition giữa nhiều auto-worker

Hiện có hơn một luồng tự động có thể ghi trạng thái:
- auto-finish theo sub-order / item
- auto-finish theo whole booking

Nếu hai luồng này không cùng contract, card rất dễ bị:
- vừa chuyển xong lại bị kéo lùi
- hoặc nhảy sai cột sau refetch

---

## Kết luận đánh giá hiện tại

Project hiện chưa thiếu UI hay thiếu thao tác bấm, mà thiếu một "nguồn sự thật duy nhất" cho status flow.

Nói cách khác:
- vấn đề gốc không nằm ở từng nút riêng lẻ
- mà nằm ở chỗ status đang bị định nghĩa ở nhiều nơi khác nhau

Vì vậy nếu chỉ vá từng bug đơn lẻ ở Kanban thì sẽ còn lặp lại.

---

## Kế hoạch triển khai

### Bước 1. Tạo một nguồn sự thật duy nhất cho trạng thái

Tạo file mới, ví dụ:

`lib/dispatch-status.ts`

File này sẽ chứa:
- thứ tự cột chuẩn
- mapping `rawStatus -> dispatchStatus`
- mapping `dispatch action -> rawStatus`
- ma trận `canTransition(from, to)`
- rule terminal cho `DONE`

Mục tiêu:
- mọi nơi chỉ import từ đây
- không hardcode status rải rác nữa

### Bước 2. Chuẩn hóa lại contract UI <-> DB

Thống nhất:
- cột `Đánh giá` map trực tiếp với raw status `FEEDBACK`
- bỏ việc gửi `WAITING_RATING` xuống DB
- nếu cần giữ `waiting_rating` cho UI cũ thì chỉ dùng như alias hiển thị, không dùng để ghi DB

### Bước 3. Sửa thứ tự cột Kanban

Cập nhật:
- `app/reception/dispatch/_components/KanbanBoard.tsx`
- các config tab / badge tương ứng trong `app/reception/dispatch/page.tsx`

Đưa toàn bộ UI về đúng thứ tự:

`Chuẩn bị -> Đang làm -> Dọn phòng -> Đánh giá -> Hoàn tất`

### Bước 4. Sửa nút next và context menu theo flow mới

Không để UI tự suy diễn nữa.

Mapping thao tác cần rõ ràng:
- `Chuẩn bị` -> next mặc định là `Đang làm`
- `Đang làm` -> next mặc định là `Dọn phòng`
- `Dọn phòng` -> next mặc định là `Đánh giá`
- `Đánh giá` -> next mặc định là `Hoàn tất`
- `Hoàn tất` -> không có next

Đồng thời context menu phải cho phép các bước forward đúng như rule đã chốt, nhưng không được cho đi lùi.

### Bước 5. Chặn drag/drop sai trạng thái

Tại Kanban:
- chỉ cho drop vào các cột hợp lệ theo `canTransition`
- chặn kéo lùi
- chặn thao tác với card `DONE`

### Bước 6. Thêm validation cứng ở backend

Tại server actions của dispatch:
- trước khi update phải đọc trạng thái hiện tại
- kiểm tra `canTransition(current, next)`
- nếu không hợp lệ thì reject ngay

Mục tiêu:
- UI bug cũng không làm hỏng trạng thái DB
- realtime stale data cũng không ghi bậy được

### Bước 7. Gom logic recompute status vào helper chung

Tạo helper dùng chung cho:
- reception dispatch actions
- KTV booking API

Không để:
- mỗi nơi tự suy ra `COMPLETED`
- nơi khác tự suy ra `CLEANING`
- nơi khác lại kéo về `PREPARING`

### Bước 8. Gỡ race condition của auto-worker

Rà lại 2 nhóm auto-update:
- auto-finish ở page-level
- auto-finish ở sub-order / item-level

Chốt chỉ giữ một luồng auto-update duy nhất, ưu tiên luồng bám theo item/sub-order.

Mục tiêu:
- không còn chuyện vừa bấm xong thì worker khác kéo ngược lại

### Bước 9. Chuẩn hóa realtime patching

Khi nhận realtime từ `Bookings` / `BookingItems`:
- không patch `dispatchStatus` theo kiểu ad-hoc
- luôn đi qua helper mapping chung

Mục tiêu:
- tránh nhảy cột sai sau refetch
- tránh mismatch giữa `rawStatus` và `dispatchStatus`

### Bước 10. Test theo ma trận trạng thái cố định

Test tối thiểu các case:
- đơn 1 dịch vụ
- đơn nhiều dịch vụ
- 1 KTV hoàn tất phần của mình nhưng booking còn phần khác
- skip forward thủ công
- drag/drop sai cột
- refresh / realtime ngay sau đổi trạng thái
- `DONE` không thể bị kéo lùi

---

## Tiêu chí hoàn thành

Đợt fix này được xem là xong khi:

- Kanban hiển thị đúng thứ tự cột mong muốn
- mọi thao tác bấm tay đi đúng flow nghiệp vụ
- `DONE` bị khóa cứng ở cả UI lẫn backend
- không còn trường hợp xác nhận trạng thái xong rồi bị nhảy về cột cũ
- không còn raw status lạ do UI gửi sai contract
- một booking chỉ có một cách duy nhất để suy ra trạng thái tổng

---

## Gợi ý thứ tự làm an toàn

1. Tạo `dispatch-status.ts`
2. Chuẩn hóa mapping raw status
3. Sửa thứ tự cột Kanban
4. Sửa next button + context menu
5. Chặn drag/drop sai
6. Chặn transition sai ở backend
7. Gom recompute status vào helper chung
8. Tắt bớt auto-worker dư thừa
9. Chạy test matrix

---

## Ghi chú

Đây là bài toán state machine nhiều nguồn ghi, nên hướng đúng là:
- không vá từng bug đơn lẻ
- mà gom toàn bộ flow về một contract duy nhất

Nếu làm đúng hướng này, các bug kiểu:
- nhảy lại `Đang làm`
- nhảy về `Chuẩn bị`
- bấm `Đánh giá` nhưng DB lại hiểu khác

sẽ giảm rất mạnh thay vì lặp lại theo từng case mới.
