# KTV Status Regression And Handoff Fix Plan

## Mục tiêu

- Chặn tình trạng KTV đang ở cuối đơn cũ nhưng app bị kéo context sang đơn mới.
- Chặn lỗi `Lưu hồ sơ` của đơn cũ lại submit vào booking mới.
- Đảm bảo sau khi KTV bấm `BẮT ĐẦU`, trạng thái ở màn KTV và màn giám sát đơn luôn đồng bộ.
- Không còn trường hợp KTV phải “gửi lại đơn” mới làm tiếp được.

## Chẩn đoán đã cập nhật

Sau khi đối chiếu dữ liệu live của `NH018`, có 2 lỗi chính:

### 1. Review context bị đổi từ đơn cũ sang đơn mới

- KTV đang ở flow hậu kỳ / `REVIEW` của đơn cũ.
- Trong lúc đó, điều phối đã gửi sẵn đơn mới cho cùng KTV.
- Polling ở `ktv/dashboard` có thể kéo `booking` state hiện tại sang đơn mới trước khi KTV bấm `Lưu hồ sơ`.
- Khi đó `handleSubmitReview()` gửi `booking.id` của **đơn đang nằm trong state lúc bấm**, không khóa cứng vào “đơn vừa hoàn tất”.
- Route `POST /api/ktv/review` kiểm tra assignment theo `BookingItems.technicianCodes`.
- Nếu booking mới lúc đó chưa gán xong cho KTV, route trả lỗi:
  - `KTV is not assigned to any items in this booking`

### 2. KTV app và TurnQueue bị lệch trạng thái

- Dữ liệu live cho thấy có case:
  - `BookingItems.status = IN_PROGRESS`
  - nhưng `TurnQueue.status = assigned`
- Kết quả:
  - màn KTV đã chạy timer
  - nhưng màn giám sát đơn vẫn hiện ở cột `Chuẩn bị`
- Đây là lỗi sync trạng thái giữa KTV API và giám sát đơn, không phải lỗi hiển thị đơn thuần.

## Điều không phải lỗi

- `item2` kiểu `phòng riêng` / placeholder không có `technicianCodes` là hợp lệ nếu nghiệp vụ không cần gán KTV cho item đó.
- Plan này **không** xem `item2` là nguyên nhân gốc.

## Ràng buộc mới: không lưu KTV ngoài hệ thống vào `technicianCodes`

- Trường hợp như `LISA` là tên gõ tay nhưng không tồn tại trong `Users` / `TurnQueue` không nên được lưu vào `BookingItems.technicianCodes`.
- Nếu vẫn lưu như một KTV thật, hệ thống sẽ coi item đó là đang có người làm, nhưng không có actor thật để:
  - nhận đơn trên app
  - bấm `BẮT ĐẦU`
  - hết giờ
  - review / handover / release
- Hệ quả là booking-level status dễ bị treo ở `IN_PROGRESS`, làm nhiễu handoff của các KTV thật còn lại.
- Hướng đúng:
  - `technicianCodes` chỉ chứa KTV có thật trong hệ thống
  - người ngoài / thợ ngoài / trợ lý ngoài DB phải đi vào field riêng kiểu `externalTechnicianName`, `assistantName`, hoặc metadata tương đương

## Invariants cần chốt

- Khi KTV đã bước vào `REVIEW`, booking được submit review phải là booking vừa hoàn tất, không phải booking poll mới nhất.
- Một booking mới được gửi trước không được phép cướp context khỏi flow hậu kỳ của booking cũ.
- `START_TIMER` thành công thì:
  - `BookingItems.status` phải là `IN_PROGRESS`
  - `TurnQueue.status` cũng phải là `working`
- Màn giám sát đơn không được suy từ dữ liệu stale khi KTV app đã chuyển trạng thái thật.

## Plan triển khai

### 1. Khóa review vào completed booking, không phụ thuộc booking state hiện thời

- File: `app/ktv/dashboard/KTVDashboard.logic.ts`
- Khi timer của đơn cũ kết thúc và chuyển sang `REVIEW`, lưu riêng:
  - `reviewBookingId`
  - nếu cần, `reviewAssignedItemId`
- `handleSubmitReview()` phải dùng `reviewBookingId` cố định này thay vì đọc `booking.id` đang thay đổi theo poll.
- Chỉ clear `reviewBookingId` khi hoàn tất `REVIEW -> HANDOVER -> RELEASE`.

### 2. Chặn booking mới chiếm context khi đang ở hậu kỳ

- File: `app/ktv/dashboard/KTVDashboard.logic.ts`
- Nếu `screen` đang là `REVIEW`, `HANDOVER`, hoặc `REWARD`, polling không được ghi đè `booking` active bằng booking mới.
- Booking mới có thể được ghi nhớ ở hàng chờ cục bộ kiểu:
  - `pendingNextBookingId`
- Chỉ sau khi flow hậu kỳ của booking cũ kết thúc mới cho phép activate booking mới.

### 3. Tăng guard forward-only ở poll

- File: `app/ktv/dashboard/KTVDashboard.logic.ts`
- Nếu local state đang ở hậu kỳ của booking A, payload poll của booking B chỉ được dùng để:
  - báo có đơn kế tiếp
  - không được đổi `screen`
  - không được đổi `booking.id` hiện tại
- Mục tiêu là giữ trọn vẹn session hậu kỳ cho 1 đơn.

### 4. Sửa route review để chống fail do assignment chưa hoàn tất

- File: `app/api/ktv/review/route.ts`
- Giữ `technicianCodes` làm rule chính.
- Nhưng thêm fallback ownership mềm:
  - nếu không thấy qua `technicianCodes`, thử tìm qua `segments[].ktvId`
- Điều này giúp review không fail chỉ vì dispatch của booking mới đang trong giai đoạn persist dở.
- Tuy nhiên fallback này chỉ là lớp đệm; frontend vẫn phải khóa đúng `reviewBookingId`.

### 5. Đồng bộ chắc chắn TurnQueue khi KTV bắt đầu

- File: `app/api/ktv/booking/route.ts`
- Sau `START_TIMER`, nếu `BookingItems` đã được set `IN_PROGRESS`, phải bắt buộc update:
  - `TurnQueue.status = 'working'`
  - `TurnQueue.estimated_end_time`
  - nếu cần, `TurnQueue.booking_item_id` sang active item hiện tại
- Nếu update `TurnQueue` fail, route không nên âm thầm thành công.

### 6. Chốt source of truth cho active item

- File: `app/api/ktv/booking/route.ts`
- Booking active của KTV phải chọn theo thứ tự:
  1. segment runtime đang chạy
  2. item `IN_PROGRESS`
  3. `TurnQueue.booking_item_id`
  4. `booking_item_ids`
- Không để `TurnQueue.booking_item_id` stale kéo app lùi hoặc kéo sang item sai.

### 7. Thêm logging để bắt handoff bug

- Files:
  - `app/ktv/dashboard/KTVDashboard.logic.ts`
  - `app/api/ktv/booking/route.ts`
  - `app/api/ktv/review/route.ts`
- Log ra:
  - `current booking id on screen`
  - `reviewBookingId`
  - `incoming poll booking id`
  - `screen`
  - `turnqueue status`
  - `assignedItemId`
  - `statusSource`
  - `review route bookingId`
  - `review route techCode`
- Mục tiêu là nếu tái diễn sẽ biết nó hỏng ở bước “đổi context” hay “persist assignment”.

### 8. Chặn KTV ngoài DB ngay từ lúc điều phối

- Files:
  - `app/reception/dispatch/page.tsx`
  - `app/reception/dispatch/_components/QuickDispatchTable.tsx`
  - `app/reception/dispatch/actions.ts`
- Khi người dùng nhập hoặc chọn KTV cho một item:
  - nếu đó là KTV thật trong hệ thống, mới cho vào `technicianCodes`
  - nếu đó là người ngoài DB, không được ghi vào `technicianCodes`
- Với người ngoài DB:
  - lưu vào field phụ như `externalTechnicianName` trong `options` hoặc schema mới
  - không tạo `TurnQueue` row kiểu KTV thật
  - không đưa người đó vào flow review/release của KTV app

### 9. Tách rõ “KTV thật” và “người hỗ trợ ngoài hệ thống” ở backend

- Files:
  - `app/api/ktv/booking/route.ts`
  - `app/api/ktv/review/route.ts`
  - RPC / server actions dispatch liên quan
- Rule backend:
  - mọi logic chọn active item, review, release chỉ dựa trên `technicianCodes` của KTV thật
  - metadata người ngoài DB chỉ để hiển thị/phục vụ điều phối, không tham gia state machine KTV
- Nếu item chỉ có người ngoài DB mà không có KTV thật:
  - không được đẩy vào hàng chờ KTV app
  - không được giữ booking ở trạng thái chờ hành động từ app KTV

## Test matrix bắt buộc

### Case 1. Đơn mới gửi trước khi đơn cũ kết thúc

- NH018 đang làm booking A
- Điều phối gửi booking B trước khi A hết giờ
- KTV hết timer booking A
- KTV phải vẫn review đúng booking A
- Sau khi xong hậu kỳ mới nhìn thấy booking B

### Case 2. Bấm lưu review khi poll đang chạy

- Đặt polling interval ngắn
- Khi đang ở `REVIEW`, để booking mới về từ server
- Bấm `Lưu hồ sơ`
- Review phải ghi vào booking cũ, không được fail vì booking mới

### Case 3. Start timer xong, giám sát đơn phải đổi cột

- KTV bấm `BẮT ĐẦU`
- `BookingItems.status` chuyển `IN_PROGRESS`
- `TurnQueue.status` phải đổi sang `working`
- Giám sát đơn phải hiện ở cột `Đang làm`

### Case 4. Booking mới chưa persist xong assignment

- Giả lập booking mới vừa tạo nhưng `technicianCodes` persist chậm
- KTV vẫn đang review booking cũ
- Review không được fail vì booking mới

### Case 5. Reload giữa hậu kỳ

- Đang ở `REVIEW` hoặc `HANDOVER`
- Refresh app
- App phải phục hồi đúng booking hậu kỳ cũ, không bật sang booking mới

### Case 6. Đơn mới sẵn sàng sau khi release

- Hoàn tất hậu kỳ booking A
- `RELEASE_KTV` xong
- App mới nhận booking B
- KTV bấm bắt đầu được ngay
- Giám sát đơn nhảy đúng trạng thái

### Case 7. Có người ngoài DB cùng tham gia booking

- Một item gắn KTV thật, một item khác chỉ có người ngoài DB như `LISA`
- Hệ thống không được coi người ngoài DB là actor KTV thật
- Booking không được treo chỉ vì item của người ngoài DB không có app flow
- Review của KTV thật vẫn phải submit đúng booking vừa hoàn tất

### Case 8. Người ngoài DB chỉ là metadata hiển thị

- Điều phối nhập tên người ngoài DB
- Tên đó vẫn hiển thị được ở điều phối/in phiếu nếu cần
- Nhưng không xuất hiện trong `TurnQueue`, không đi vào `technicianCodes`, và không ảnh hưởng state machine KTV

## Definition of done

- Không còn lỗi `KTV is not assigned to any items in this booking` khi KTV đang review đơn vừa hoàn tất mà booking mới đến trước.
- `REVIEW/HANDOVER/REWARD` không bị booking mới cướp context.
- `START_TIMER` xong thì `TurnQueue.status` và `BookingItems.status` đồng bộ.
- KTV không cần “gửi lại đơn” để tiếp tục flow.
- Màn giám sát đơn và màn KTV hiển thị cùng một trạng thái thực tế.
- Người ngoài DB không còn được lưu như `technicianCodes`, nên không thể kéo lệch state của KTV thật.
