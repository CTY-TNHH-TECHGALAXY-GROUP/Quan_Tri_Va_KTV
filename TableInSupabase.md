# 📊 Supabase Database Schema — Ngan Ha Spa

> **Mục đích**: Reference file cho AI agents và developers. **BẮT BUỘC** đọc trước khi viết code liên quan DB.

---

## NHÓM 1: BỘ LÕI ĐẶT LỊCH (Core Booking Engine)

### 1. Bookings ✅ CHỦ LỰC
**Nhiệm vụ**: Đơn hàng từ tạo → hoàn tất. Theo dõi trạng thái 7 bước, lưu đánh giá + thanh toán.
**Realtime**: ✅ (KTV Dashboard + Dispatch Board cập nhật live)

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | text PK | Mã đơn hàng duy nhất |
| `billCode` | text UNIQUE | Mã bill hiển thị cho khách (VD: "NH-240319-001") |
| `branchName` | text | Tên chi nhánh (default: "Ngan Ha Spa") |
| `bookingDate` | timestamp | Ngày đặt hàng |
| `timeBooking` | text | Giờ hẹn khách đến (VD: "14:00") |
| `timeStart` | timestamp | Thời điểm bắt đầu phục vụ thực tế — dùng cho timer khách |
| `timeEnd` | timestamp | Thời điểm kết thúc — tính tổng thời gian phục vụ |
| `customerId` | text FK → Customers | Liên kết khách hàng |
| `customerName` | text | Tên khách (cache, không cần join) |
| `customerPhone` | text | SĐT khách |
| `customerEmail` | text | Email khách |
| `customerLang` | text | Ngôn ngữ khách (VN/EN) — hiển thị journey page |
| `focusAreaNote` | text | Ghi chú vùng cần tập trung (VD: "Đau vai") |
| `notes` | text | Ghi chú đơn hàng chung |
| `technicianCode` | text | Mã KTV chính được phân công |
| `bedId` | text FK → Beds | Giường phục vụ |
| `roomName` | text | Tên phòng phục vụ |
| `totalAmount` | numeric | Tổng tiền đơn hàng |
| `paymentMethod` | text | Phương thức thanh toán |
| `status` | BookingStatus | Trạng thái: NEW → PREPARING → READY → IN_PROGRESS → COMPLETED → FEEDBACK → CLEANING → DONE |
| `source` | text | Phân loại nguồn đơn hàng: `STANDARD_WALK_IN`, `VIP_MENU`, `WEB_BOOKING` (default: `STANDARD_WALK_IN`) |
| `rating` | numeric | Rating tổng đơn hàng (legacy — ít dùng) |
| `tipAmount` | numeric | Tiền tip khách gửi |
| `violations` | jsonb | Danh sách vi phạm khách phản hồi |
| `feedbackNote` | text | Ghi chú phản hồi từ khách |
| `tip` | numeric | Tiền tip (field phụ, default 0) |
| `createdAt` | timestamp | Thời điểm tạo đơn |
| `updatedAt` | timestamp | Thời điểm cập nhật cuối |
| `idLegacy` | text | ID hệ thống cũ (nếu có) |

**Triggers:**
- `SendPushOnNewBooking` → Gửi push notification khi có đơn mới
- `tr_master_notification_handler` → Xử lý thông báo tổng hợp

---

### 2. BookingItems ✅ CHỦ LỰC
**Nhiệm vụ**: Chi tiết từng dịch vụ trong một đơn. Theo dõi trạng thái riêng, hỗ trợ nhiều KTV cùng làm (co-working).
**Realtime**: ✅ (đồng bộ màn hình KTV real-time)

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | text PK | Mã item duy nhất |
| `bookingId` | text FK → Bookings | Thuộc đơn hàng nào |
| `serviceId` | text FK → Services | Dịch vụ nào |
| `quantity` | integer | Số lượng (thường = 1) |
| `price` | numeric | Giá dịch vụ |
| `options` | jsonb | Tùy chọn thêm (VD: áp lực mạnh/nhẹ) |
| `roomName` | text | Phòng phục vụ riêng item (multi-room support) |
| `technicianCodes` | text[] | **Mảng mã KTV** phục vụ item này (hỗ trợ 2+ KTV cùng 1 DV) |
| `status` | text | Trạng thái item: WAITING → IN_PROGRESS → COMPLETED → DONE |
| `timeStart` | timestamptz | Thời điểm KTV bắt đầu làm item này — dùng cho timer per-service |
| `timeEnd` | timestamptz | Thời điểm hoàn thành item |
| `bedId` | text | Giường phục vụ riêng item |
| `segments` | jsonb | Quy trình step-by-step (VD: ["Rửa mặt", "Đắp mặt nạ"]) |
| `itemRating` | integer | ⭐ **Rating tổng** cho item — dùng cho báo cáo, thống kê, allRated check |
| `itemFeedback` | text | Phản hồi text từ khách cho item |
| `ktvRatings` | jsonb | ⭐ **Rating riêng từng KTV** — `{"NH016": 4, "NH001": 3}`. Dùng cho lịch sử KTV + trigger thưởng |
| `tip` | numeric | Tiền tip riêng item (default 0) |

**Triggers:**
- `tr_notify_ktv_on_item_rating` → Gửi thông báo thưởng/cảnh báo khi `itemRating` hoặc `ktvRatings` thay đổi

**Quan hệ `itemRating` vs `ktvRatings`:**
- 1 KTV: `itemRating = 4`, `ktvRatings = {"NH016": 4}` → cả 2 giống nhau
- 2 KTV: `itemRating = 3` (trung bình), `ktvRatings = {"NH016": 4, "NH001": 2}` → chi tiết riêng

---

### 3. Services ✅ CHỦ LỰC
**Nhiệm vụ**: Danh mục dịch vụ của spa — tra cứu tên, thời lượng, giá khi đặt lịch.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | text PK | Mã dịch vụ (VD: NHS0001) |
| `code` | text | Mã (code) rút gọn của dịch vụ |
| `nameVN` | text | Tên tiếng Việt |
| `nameEN` | text | Tên tiếng Anh |
| `nameCN` | text | Tên tiếng Trung |
| `nameJP` | text | Tên tiếng Nhật |
| `nameKR` | text | Tên tiếng Hàn |
| `description` | jsonb | Mô tả dịch vụ đa ngôn ngữ |
| `priceVND` | numeric | Giá dịch vụ VNĐ |
| `priceUSD` | numeric | Giá dịch vụ USD |
| `duration` | integer | Thời lượng (phút) — dùng cho timer |
| `category` | text | Danh mục dịch vụ (VD: Body, Facial) |
| `imageUrl` | text | URL ảnh minh họa (viết hoa chữ U) |
| `isActive` | boolean | Cờ trạng thái hoạt động |
| `focusConfig` | jsonb | Tùy chọn tập trung các vùng cơ thể |
| `tags` | jsonb | Danh sách các Tag đa ngôn ngữ (VD: Mang thai) |
| `comboTags` | jsonb | Mảng các combo tags (VD: ["body"]) |
| `is_utility` | boolean | ✅ **Cờ dịch vụ tiện ích** — Không gán KTV, không tính hoa hồng, không hiện timer KTV. Default: `false`. Set `true` cho Phòng riêng (`NHS0900`) và các DV phụ trợ khác. |

---

## NHÓM 2: QUẢN LÝ KTV (KTV Management)

### 4. TurnQueue ✅ CHỦ LỰC
**Nhiệm vụ**: Sổ tua KTV — thứ tự phục vụ trong ngày.
**Realtime**: ✅ (Dispatch Board, KTV page cập nhật live)

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `employee_id` | text FK → Staff | Mã KTV |
| `date` | date | Ngày làm việc (default: hôm nay) |
| `queue_position` | integer | Vị trí trong hàng đợi — thấp hơn = ưu tiên hơn |
| `check_in_order` | integer | Thứ tự điểm danh |
| `status` | text | Trạng thái: `waiting` (chờ) → `assigned` (đã điều phối) → `working` (đang làm) → `off` (tan ca) |
| `turns_completed` | integer | Số tua đã hoàn thành trong ngày |
| `current_order_id` | text | ID đơn hàng đang phục vụ |
| `estimated_end_time` | time | Giờ kết thúc dự kiến đơn hiện tại |
| `last_served_at` | timestamptz | Thời điểm phục vụ lần cuối |
| `start_time` | time | Giờ bắt đầu ca |
| `booking_item_id` | text | ID BookingItem đang phục vụ (Cũ/Tương thích ngược) |
| `booking_item_ids` | text[] | Mảng ID các BookingItems đang phục vụ (Hỗ trợ đa dịch vụ) |
| `room_id` | text | Phòng đang phục vụ |
| `bed_id` | text | Giường đang phục vụ |
| `created_at` | timestamptz | Thời điểm tạo |

**Constraint**: `UNIQUE(employee_id, date)` — mỗi KTV chỉ 1 record/ngày

---

### 4.5. TurnLedger ✅ CHỦ LỰC
**Nhiệm vụ**: Sổ cái ghi nhận tua KTV. Tách biệt hoàn toàn việc tính tua khỏi `TurnQueue`.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `date` | date | Ngày tính tua |
| `booking_id` | text | Mã đơn hàng |
| `employee_id` | text | Mã KTV nhận tua |
| `counted_at` | timestamptz | Thời điểm ghi nhận tua |
| `source` | text | Nguồn (VD: 'DISPATCH_CONFIRM') |
| `created_at` | timestamptz | Thời điểm tạo |

**Constraint**: `UNIQUE(date, booking_id, employee_id)` — Idempotency: Mỗi KTV trong 1 bill chỉ được tính đúng 1 tua.

---

### 5. KTVAttendance ✅ CHỦ LỰC
**Nhiệm vụ**: Chấm công GPS có duyệt của admin.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid | Khóa chính (Primary Key). |
| `employeeId` | uuid | Mã KTV yêu cầu điểm danh (FK -> Users.id). |
| `employeeName` | varchar | Tên KTV (đẻ hiển thị nhanh trên Admin). |
| `date` | date | Ngày business date điểm danh (hỗ trợ sort, lọc dễ dàng) |
| `checkType` | enum | Loại yêu cầu: `CHECK_IN`, `CHECK_OUT`, `LATE_CHECKIN`, `OFF_REQUEST`. |
| `status` | enum | `PENDING`, `CONFIRMED`, `REJECTED`. |
| `latitude` | float8 | Tọa độ GPS vĩ độ (lúc gửi yêu cầu). |
| `longitude` | float8 | Tọa độ GPS kinh độ (lúc gửi yêu cầu). |
| `locationText` | text | Địa chỉ text (Geocoding) hoặc chuỗi tọa độ dự phòng. |
| `photoUrl` | text | Link ảnh chụp minh chứng điểm danh. |
| `reason` | text | Ghi chú/lý do điểm danh bổ sung hoặc xin OFF. |
| `checkedAt` | timestamp | Thời gian KTV bấm gửi yêu cầu (Default: now()). |
| `confirmedBy` | uuid | ID của admin/lễ tân duyệt yêu cầu. |
| `confirmedAt` | timestamp | Thời gian duyệt yêu cầu. |
| `checkOutTime` | timestamptz | Thời điểm tan ca |
| `estimatedEndTime` | text | Giờ về dự kiến (lúc điểm danh, dành cho ca tự do) |

---

### 5.1. KTVLeaveRequests ✅ CHỦ LỰC
**Nhiệm vụ**: Quản lý lịch nghỉ (OFF) của KTV. Mỗi ngày OFF = 1 record riêng. KTV có thể đăng ký OFF nhiều ngày (gửi mảng dates → hệ thống tạo nhiều records).
**Realtime**: ✅ (KTV Hub cập nhật live)

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `employeeId` | text | Mã KTV xin nghỉ |
| `employeeName` | text | Tên KTV (cache hiển thị) |
| `date` | date | **Ngày muốn nghỉ** (YYYY-MM-DD) — key quan trọng nhất |
| `reason` | text | Lý do xin nghỉ |
| `status` | text | `PENDING` / `APPROVED` / `REJECTED` |
| `is_extension` | boolean | Có phải gia hạn nghỉ (nối liền chuỗi OFF trước đó) |
| `is_sudden_off` | boolean | Nghỉ đột xuất (hết lượt gia hạn) |
| `reviewedBy` | text | ID admin duyệt |
| `reviewedAt` | timestamptz | Thời điểm duyệt |
| `createdAt` | timestamptz | Thời điểm tạo yêu cầu |

**Lưu ý quan trọng**:
- Auto-approved khi đăng ký trước deadline (19h hôm trước)
- Gia hạn nghỉ: có quota `max_leave_extensions_per_month` (SystemConfigs)
- Bảng này **khác** `KTVAttendance` (chấm công GPS). Dùng bảng này khi check lịch OFF cho VIP Menu.
- Query mẫu: `SELECT "employeeId" FROM "KTVLeaveRequests" WHERE date = '2026-05-17' AND status IN ('APPROVED', 'PENDING')`

---

### 5.2. KTVShiftRecords ✅ CHỦ LỰC
**Nhiệm vụ**: Quản lý ca làm việc của KTV (Ca 1/2/3, Ca tự do, Làm khách yêu cầu).
**Realtime**: ✅ (KTV Hub cập nhật live)

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `employee_id` | text | Mã KTV |
| `shift_type` | text | Loại ca: `SHIFT_1` (09-17h), `SHIFT_2` (11-19h), `SHIFT_3` (17-00h), `FREE`, `REQUEST` |
| `status` | text | `ACTIVE` / `PENDING` / `REJECTED` |
| `effective_from` | date | Ngày bắt đầu áp dụng ca |
| `previous_shift` | text | Ca trước đó (nếu đổi ca) |
| `reason` | text | Lý do đổi ca |
| `reviewed_by` | text | Admin duyệt |
| `reviewed_at` | timestamptz | Thời điểm duyệt |
| `created_at` | timestamptz | Thời điểm tạo |
| `estimatedEndTime` | text | Giờ về dự kiến (dành riêng cho ca tự do) |

---

### 5.3. DailyAttendance ✅ CHỦ LỰC
**Nhiệm vụ**: Bảng điểm danh hàng ngày (admin set trạng thái). Khác `KTVAttendance` (KTV tự bấm GPS).
**Realtime**: ✅

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `employee_id` | text | Mã KTV |
| `date` | date | Ngày điểm danh |
| `status` | text | `on_duty` / `absent` / `off_leave` / `off_duty` |
| `check_in_time` | time | Giờ bắt đầu ca |
| `check_out_time` | time | Giờ tan ca |

**Constraint**: `UNIQUE(employee_id, date)` — mỗi KTV chỉ 1 record/ngày

---

### 6. Staff ✅ CHỦ LỰC
**Nhiệm vụ**: Danh sách nhân viên — KTV, lễ tân, admin.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | text PK | Mã nhân viên (VD: "NH016") |
| `full_name` | text | Họ tên đầy đủ |
| `status` | text | Trạng thái làm việc (ĐANG LÀM / NGHỈ VIỆC) |
| `birthday` | date | Ngày sinh |
| `gender` | text | Giới tính |
| `id_card` | text | Số CCCD/CMND |
| `phone` | text | Số điện thoại |
| `email` | text | Email |
| `bank_account` | text | Số tài khoản ngân hàng |
| `bank_name` | text | Tên ngân hàng |
| `avatar_url` | text | URL ảnh đại diện |
| `position` | text | Chức vụ |
| `experience` | text | Kinh nghiệm |
| `join_date` | date | Ngày vào làm |
| `height` | integer | Chiều cao (cm) |
| `weight` | integer | Cân nặng (kg) |
| `skills` | jsonb | Kỹ năng chuyên môn |
| `created_at` | timestamptz | Thời điểm tạo |

---

### 6.1. WalletAdjustments ✅ CHỦ LỰC (PHA 1 - RÚT TIỀN)
**Nhiệm vụ**: Sổ ghi nhận các khoản điều chỉnh ví KTV (Tặng tiền, Phạt tiền, Sửa sai sót). Dùng nguyên tắc "Audit Trail" (Không xoá/sửa, chỉ đảo ngược).

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `staff_id` | text FK → Staff | Mã KTV nhận điều chỉnh |
| `amount` | numeric | Số tiền (Dương: Cộng, Âm: Trừ) |
| `type` | text | Loại: `GIFT`, `PENALTY`, `INITIAL`, `ADJUST` |
| `reason` | text | Lý do chi tiết |
| `created_by` | text | ID Admin/Kế toán thực hiện |
| `created_at` | timestamptz | Thời điểm tạo |

---

### 6.2. KTVWithdrawals ✅ CHỦ LỰC (PHA 1 - RÚT TIỀN)
**Nhiệm vụ**: Quản lý các lệnh yêu cầu rút tiền của KTV.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `staff_id` | text FK → Staff | Mã KTV yêu cầu rút |
| `amount` | numeric | Số tiền muốn rút |
| `status` | text | Trạng thái: `PENDING`, `APPROVED`, `REJECTED` |
| `note` | text | Ghi chú/Lý do từ chối từ Kế toán |
| `request_date` | timestamptz | Thời điểm yêu cầu |
| `processed_at` | timestamptz | Thời điểm được Kế toán duyệt/từ chối |
| `processed_by` | text | ID Admin/Kế toán xử lý |

---

### 6.3. KTVBonusLedger ✅ CHỦ LỰC (VÍ ĐIỂM BONUS)
**Nhiệm vụ**: Ghi nhận lịch sử điểm bonus KTV — mỗi booking được rating >= 4★ sẽ sinh 1 record. Chia đều theo unique KTVs trong booking.
**Feature Flag**: `enable_bonus_wallet` (SystemConfigs) — `false` = không ghi DB, `true` = ghi vào bảng này.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `staff_id` | text | Mã KTV nhận bonus |
| `booking_id` | text | Mã booking được thưởng (nullable cho DEDUCT/REDEEM) |
| `points` | integer | Số điểm (dương: cộng, âm: trừ) |
| `type` | text | Loại: `EARN` / `DEDUCT` / `REDEEM` |
| `description` | text | Mô tả chi tiết (VD: "Bonus 10đ (20/2 KTV) - Rating 4★") |
| `date` | date | Ngày kinh doanh |
| `created_at` | timestamptz | Thời điểm tạo |

**Constraint**: `UNIQUE(staff_id, booking_id) WHERE type = 'EARN'` — Mỗi KTV chỉ nhận bonus 1 lần per booking

**Công thức Bonus**:
- `basePoints` theo ca: Ca1=20, Ca2=20, Ca3=40 (từ SystemConfigs)
- `bonus_per_ktv = Math.floor(basePoints_CA_MÌNH / totalUniqueKTVs)`
- Điều kiện: booking rating >= 4★

---

## NHÓM 3: THÔNG BÁO & CẤU HÌNH (Notification & Config)


### 7. StaffNotifications ✅ CHỦ LỰC
**Nhiệm vụ**: Thông báo nội bộ real-time.
**Realtime**: ✅ (toast notification live qua Supabase Realtime)

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `bookingId` | text FK → Bookings | Đơn hàng liên quan |
| `employeeId` | text | Mã NV nhận thông báo (NULL = gửi cho admin/toàn bộ) |
| `type` | text | Loại: `REWARD` / `COMPLAINT` / `NEW_ORDER` / `CHECK_IN` / `EMERGENCY` / `FEEDBACK` / `WATER` / `SOS` |
| `message` | text | Nội dung thông báo |
| `isRead` | boolean | Đã đọc chưa |
| `createdAt` | timestamptz | Thời điểm gửi |

---

### 8. SystemConfigs ✅ CHỦ LỰC
**Nhiệm vụ**: Cấu hình toàn cục (key-value store).

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `key` | text UNIQUE | Tên cấu hình (VD: `turn_rate_per_60min`, `max_leave_extensions_per_month`) |
| `value` | jsonb | Giá trị cấu hình (linh hoạt kiểu dữ liệu) |
| `description` | text | Mô tả cấu hình |
| `created_at` | timestamptz | Thời điểm tạo |
| `updated_at` | timestamptz | Thời điểm cập nhật |

---

### 8.5. Reminders ✅ CHỦ LỰC
**Nhiệm vụ**: Lưu trữ danh sách các câu nhắc nhở trên giao diện Spa (như nhắc khách tắt thiết bị, kiểm tra nước nóng...).

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `content` | text | Nội dung câu nhắc nhở |
| `is_active` | boolean | Trạng thái hiển thị (ẩn/hiện) |
| `order_index` | integer | Thứ tự sắp xếp khi hiển thị |
| `created_at` | timestamptz | Thời điểm tạo |

---

### 8.6. Reminders_Customer ✅ CHỦ LỰC
**Nhiệm vụ**: Lưu trữ 6 câu hỏi feedback của khách hàng trên màn hình Journey (đa ngôn ngữ).

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `contentVN` | text | Câu hỏi tiếng Việt |
| `contentEN` | text | Câu hỏi tiếng Anh |
| `contentCN` | text | Câu hỏi tiếng Trung |
| `contentJP` | text | Câu hỏi tiếng Nhật |
| `contentKR` | text | Câu hỏi tiếng Hàn |
| `is_active` | boolean | Trạng thái hiển thị (ẩn/hiện) |
| `order_index` | integer | Thứ tự sắp xếp hiển thị |
| `created_at` | timestamptz | Thời điểm tạo |

---

## NHÓM 4: CƠ SỞ VẬT CHẤT & KHÁCH HÀNG (Infra & CRM)

### 9. Rooms ✅ CHỦ LỰC
**Nhiệm vụ**: Danh sách phòng phục vụ.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | text PK | Mã phòng |
| `name` | text | Tên phòng (VD: "Phòng VIP 1") |
| `capacity` | integer | Sức chứa (số giường) |
| `type` | text | Loại phòng |
| `prep_procedure` | jsonb | Quy trình mở phòng (JSON array of strings). Default: 5 bước chuẩn |
| `clean_procedure` | jsonb | Quy trình dọn dẹp phòng (JSON array of strings). Default: 4 bước chuẩn |
| `allowed_services` | jsonb | Danh sách ID dịch vụ phòng này có thể nhận (JSON array of service IDs) |
| `default_reminders` | jsonb | Danh sách ID các câu nhắc nhở mặc định (JSON array of reminder IDs) |
| `created_at` | timestamptz | Thời điểm tạo |
| `updated_at` | timestamptz | Thời điểm cập nhật |

---

### 10. Beds ✅ CHỦ LỰC
**Nhiệm vụ**: Danh sách giường trong từng phòng.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | text PK | Mã giường |
| `name` | text | Tên giường (VD: "Giường 1") |
| `roomId` | text FK → Rooms | Thuộc phòng nào |
| `room_id` | uuid | ID phòng (legacy, nullable) |

---

### 11. Customers ✅ ĐANG DÙNG
**Nhiệm vụ**: Hồ sơ khách hàng — lịch sử, tra cứu khách quen.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | text PK | Mã khách hàng |
| `fullName` | text | Họ tên khách |
| `phone` | text UNIQUE | Số điện thoại (dùng để tra cứu) |
| `email` | text | Email |
| `gender` | text | Giới tính |
| `birthday` | timestamp | Ngày sinh |
| `notes` | text | Ghi chú (sở thích, dị ứng...) |
| `lastVisited` | timestamp | Lần ghé thăm gần nhất |
| `createdAt` | timestamp | Thời điểm tạo |
| `updatedAt` | timestamp | Thời điểm cập nhật |

---

## NHÓM 5: HỆ THỐNG XÁC THỰC & PUSH (Auth & Push)

### 12. Users ✅ CHỦ LỰC
**Nhiệm vụ**: Tài khoản đăng nhập tất cả nhân viên.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | text PK | ID người dùng |
| `username` | text UNIQUE | Tên đăng nhập |
| `password` | text | Mật khẩu (hashed) |
| `code` | text UNIQUE | Mã nhân viên liên kết với Staff |
| `fullName` | text | Họ tên hiển thị |
| `gender` | text | Giới tính |
| `isOnShift` | boolean | Đang trực ca hay không |
| `isBusy` | boolean | Đang bận phục vụ hay không |
| `role` | Role | Vai trò: `TECHNICIAN` / `RECEPTIONIST` / `ADMIN` |
| `permissions` | jsonb | Quyền chi tiết (tùy chỉnh) |
| `googleId` | text UNIQUE | Google login (nếu có) |
| `createdAt` | timestamp | Thời điểm tạo |

---

### 13. StaffPushSubscriptions ⚠️ PHỤ TRỢ
**Nhiệm vụ**: Đăng ký nhận push notification trên thiết bị.

| Cột | Kiểu | Mô tả chức năng |
|-----|------|-----------------|
| `id` | uuid PK | ID tự sinh |
| `staff_id` | text FK → Staff | NV nhận push |
| `subscription` | jsonb | Web Push subscription token (endpoint + keys) |
| `user_agent` | text | Trình duyệt/thiết bị đăng ký |
| `created_at` | timestamptz | Thời điểm đăng ký |
| `updated_at` | timestamptz | Thời điểm cập nhật |

**Constraint**: `UNIQUE(staff_id, subscription)` — mỗi thiết bị chỉ đăng ký 1 lần
