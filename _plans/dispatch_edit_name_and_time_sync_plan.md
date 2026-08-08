# Dispatch Edit Name And Time Sync Plan

## Bối cảnh

Ở màn điều phối nhanh, Lễ tân có thể:

- sửa `Tên in phiếu` của dịch vụ
- chỉnh `mốc thời gian bắt đầu` cho từng KTV

Hiện tại 2 thông tin này đang đi qua các tầng không đồng đều:

- UI in phiếu trong `QuickDispatchTable` đã đọc từ `state.displayName` và `state.ktvStartTimes`
- dữ liệu gửi sang KTV vẫn chủ yếu dựa vào `serviceId -> Services.nameVN` và `segments.startTime`
- push / realtime notification cho KTV vẫn đang gửi message chung kiểu “Bạn được phân công cho đơn hàng...”

Kết quả là sau khi điều phối sửa tên DV hoặc mốc giờ:

- phiếu in có thể đúng lúc preview nhưng không chắc dữ liệu lưu vào DB đúng
- KTV app có thể vẫn thấy tên gốc từ `serviceId`
- thông tin gửi sang KTV không phản ánh đúng tên in phiếu và giờ mới

## Mục tiêu

- Khi Lễ tân sửa tên DV và chọn mốc giờ mới, hệ thống phải coi đây là **2 field nghiệp vụ chính thức**.
- Cả 3 đầu ra phải đồng bộ cùng một source of truth:
  - dữ liệu lưu DB
  - phiếu in
  - thông tin gửi sang KTV
- Sau khi refresh, reload, hoặc KTV mở app từ push notification, KTV vẫn thấy đúng:
  - tên DV đã sửa
  - giờ bắt đầu đã sửa

## Hai thông tin cần chuẩn hóa

1. `displayName`
- tên hiển thị / tên in phiếu do điều phối chỉnh tay

2. `dispatchStartTime`
- mốc giờ bắt đầu thực tế điều phối chọn cho KTV hoặc cho segment đầu tiên

## Source of truth đề xuất

### 1. Tên dịch vụ gửi sang KTV

- Lưu vào `BookingItems.options.displayName`
- Không dùng `serviceId -> Services.nameVN` làm ưu tiên số 1 nữa khi render KTV
- Thứ tự fallback:
  1. `BookingItems.options.displayName`
  2. `BookingItems.service_name` hoặc `serviceName` nếu đã hydrate trước đó
  3. `Services.nameVN / nameEN`

### 2. Giờ bắt đầu gửi sang KTV

- Source of truth là `segments[].startTime` của item / staff assignment
- Nếu 1 item có nhiều segment, segment active của KTV là nguồn đúng nhất
- `TurnQueue.start_time` chỉ là mirror cho điều phối / queue, không phải nguồn render cuối cùng nếu lệch segment runtime

## Phạm vi chỉnh sửa

### A. Điều phối nhanh

- File: `app/reception/dispatch/_components/QuickDispatchTable.tsx`
- File: `app/reception/dispatch/page.tsx`

Mục tiêu:
- `displayName` và `ktvStartTimes` phải luôn được đẩy vào `itemUpdates`
- Khi sửa dịch vụ hoặc sửa giờ, local state không được làm rơi `displayName`
- Khi bấm điều phối / lưu tạm, payload gửi server phải chứa đủ 2 thông tin này

### B. Lưu DB khi dispatch

- File: `app/reception/dispatch/page.tsx`
- File: `app/reception/dispatch/actions.ts`
- RPC liên quan: `dispatch_confirm_booking`

Mục tiêu:
- `itemUpdates[].options.displayName` phải được persist vào `BookingItems.options`
- `itemUpdates[].segments[].startTime` phải được persist nguyên vẹn
- Nếu `TurnQueue.start_time` đang được dùng cho chặng đầu, phải sync theo giờ mới đã chọn

### C. In phiếu

- File: `app/reception/dispatch/_components/QuickDispatchTable.tsx`
- File: `app/reception/dispatch/page.tsx`
- File: `app/reception/dispatch/_components/DispatchStaffRow.tsx` nếu có in từ detail mode

Mục tiêu:
- Phiếu in luôn lấy:
  - tên từ `displayName`
  - giờ từ `ktvStartTimes[idx]` hoặc segment start tương ứng
- Không được fallback về `serviceName`/`turn.start_time` nếu user vừa sửa tay mà chưa rời màn hình

### D. KTV app nhận dữ liệu

- File: `app/api/ktv/booking/route.ts`
- File: `app/ktv/dashboard/page.tsx`

Mục tiêu:
- API KTV phải trả `service_name` ưu tiên từ `options.displayName`
- Nếu KTV có nhiều segment, UI phải đọc `segment.startTime` active thay vì chỉ nhìn tên gốc từ `Services`
- Sau refresh vẫn ra đúng tên in phiếu và giờ đã chỉnh

### E. Notification / Gửi sang KTV

- File: `app/reception/dispatch/actions.ts`
- Có thể thêm helper riêng nếu cần format message

Mục tiêu:
- Notification gửi KTV phải chứa 2 thông tin:
  - tên dịch vụ hiển thị sau chỉnh sửa
  - giờ bắt đầu điều phối
- Không gửi message chung chung nữa nếu có đủ dữ liệu

Ví dụ format:
- `Bạn được phân công: Body Aroma 90p lúc 14:30. Vui lòng kiểm tra ứng dụng.`

## Plan triển khai

### Pha 1. Chốt schema payload điều phối

- Bổ sung contract rõ cho `itemUpdates.options.displayName`
- Chốt field giờ gửi theo `segments[0].startTime` hoặc theo segment gắn đúng KTV
- Audit tất cả chỗ build `itemUpdates` để chắc `displayName` không bị bỏ qua khi edit service hoặc add-on

### Pha 2. Persist đúng vào DB

- Kiểm tra RPC `dispatch_confirm_booking` có đang ghi `options.displayName` và `segments.startTime` đầy đủ không
- Nếu RPC chưa ghi, bổ sung logic ghi đúng
- Với flow `saveDraftDispatch`, cũng phải persist cùng cấu trúc để reload ra đúng dữ liệu đang chỉnh

### Pha 3. Render đúng ở KTV API

- `app/api/ktv/booking/route.ts`
- Khi hydrate item:
  - `service_name = options.displayName || mapped service name`
- Với thời gian:
  - nếu có segment của KTV thì dùng `segment.startTime`
  - chỉ fallback về `dispatchStartTime` khi hoàn toàn không có segment

### Pha 4. Đồng bộ in phiếu

- Cả quick print preview và print thật phải dùng chung helper format ticket data
- Helper này chỉ đọc từ:
  - `displayName`
  - segment/time state hiện tại
- Tránh việc mỗi nơi tự fallback khác nhau

### Pha 5. Đồng bộ notification gửi KTV

- Khi `processDispatch` hoàn tất, build notification payload từ `itemUpdates` hoặc `staffAssignments`
- Với mỗi KTV:
  - lấy đúng item/segment của KTV đó
  - format message chứa `displayName + startTime`
- Push notification và `StaffNotifications.message` phải cùng dùng 1 formatter

## Cần chỉnh riêng cho flow “Sửa dịch vụ”

- File: `app/reception/dispatch/actions.ts`
- File: `app/reception/dispatch/page.tsx`

Hiện `editBookingService(...)` mới update:
- `serviceId`
- `price`
- `estimated_end_time`

Nhưng chưa chốt rõ:
- có giữ `options.displayName` cũ không
- có cần đổi `displayName` mặc định sang tên mới không nếu user chưa custom
- có cần tính lại toàn bộ `segments[].endTime` theo `startTime` mới và duration mới không

Rule đề xuất:
- Nếu user đã custom `displayName`, không tự ghi đè bằng tên service mới
- Nếu `displayName` đang trống hoặc đúng bằng tên service cũ, cho phép sync sang tên service mới
- Khi đổi duration, cập nhật lại `segments[].endTime` theo `startTime` hiện tại

## Test cases bắt buộc

### Case 1. Chỉnh tên in phiếu rồi điều phối

- Sửa `displayName`
- Điều phối
- KTV mở app thấy đúng tên đã sửa
- In phiếu ra đúng tên đã sửa

### Case 2. Chỉnh giờ bắt đầu rồi điều phối

- Đổi `ktvStartTimes[0]`
- Điều phối
- KTV mở app thấy đúng giờ mới
- Phiếu in ra đúng giờ mới

### Case 3. Chỉnh cả tên và giờ rồi refresh

- Điều phối xong
- Refresh màn điều phối
- Refresh màn KTV
- Cả hai bên vẫn thấy đúng 2 thông tin

### Case 4. Sửa dịch vụ sau khi đã custom tên in phiếu

- Đổi serviceId
- Nếu `displayName` là custom name, hệ thống phải giữ nguyên
- Nếu `displayName` chưa custom, hệ thống có thể sync theo tên dịch vụ mới

### Case 5. Một dịch vụ, nhiều KTV, giờ khác nhau

- Mỗi KTV có start time khác nhau
- KTV A nhận đúng giờ A
- KTV B nhận đúng giờ B
- Phiếu của từng KTV in ra đúng giờ tương ứng

### Case 6. Một booking nhiều dịch vụ

- Chỉ sửa tên và giờ của 1 dịch vụ
- KTV của dịch vụ khác không bị nhận nhầm dữ liệu

### Case 7. Draft dispatch

- Lưu tạm rồi mở lại
- `displayName` và `startTime` vẫn còn nguyên

## Definition of done

- Điều phối sửa tên DV và giờ mới xong, cả in phiếu lẫn KTV app đều hiện đúng 2 thông tin đó.
- Refresh, poll, mở lại app không làm mất `displayName` hoặc `startTime`.
- Notification gửi KTV chứa đúng tên DV hiển thị và giờ bắt đầu đã chọn.
- Flow sửa dịch vụ không vô tình ghi đè custom `displayName`.
