# KẾ HOẠCH TRIỂN KHAI: TÍNH NĂNG TẠM DỪNG VÀ ĐỔI KTV (PAUSE & SWAP)

Căn cứ theo các rule đặc thù đã chốt:
1. **KTV A**: Mất tiền (0đ) nhưng vẫn bị tính 1 tua (bị đẩy xuống cuối queue).
2. **KTV B**: Làm phần còn lại + thời gian nhập thêm. 
   - Nếu `Thời gian KTV B` > `Thời gian DV gốc` => KTV B nhận tiền bằng số phút thực làm.
   - Nếu `Thời gian KTV B` <= `Thời gian DV gốc` => KTV B nhận tiền bằng thời gian DV gốc (trọn tua).

---

## 1. Thay đổi Database (Migration)

### C. Vá lỗi Lương hiển thị sớm (Early Commission Fix)
- **Vấn đề hiện tại**: Hàm tính lương hiện tại quét bảng `TurnLedger` và `BookingItems` nhưng **bỏ quên điều kiện kiểm tra trạng thái hoàn thành**. Dẫn đến Lễ tân vừa gán tua là KTV đã thấy có tiền ngay lập tức (dù chưa làm hoặc đang Tạm ngưng).
- **Giải pháp**: 
  - Cập nhật lại 2 hàm SQL `get_ktv_wallet_timeline` và `calculate_ktv_wallet_stats`.
  - Thêm điều kiện cứng: **Chỉ cộng tiền tua khi dịch vụ đã đạt trạng thái `COMPLETED`, `CLEANING`, `FEEDBACK` hoặc `DONE`**. 
  - => Hệ quả: Khi bị `PAUSED` hoặc đang `IN_PROGRESS`, tiền tua sẽ bị **GIAM LẠI (= 0đ)** cho đến khi KTV bấm nút Hoàn tất.

### A. Thêm cột mới
- Bảng `TurnLedger`: Thêm cột `is_punished` (boolean, default: false).
- Bảng `BookingItems`: Thêm cột `pauseStart` (timestamptz, nullable).

### B. Cập nhật hàm tính lương (`get_ktv_wallet_timeline`)
- **Cho KTV A**: Khi lặp qua `TurnLedger`, nếu thấy `is_punished = true`, tự động set `v_turn_amount = 0` (KTV A không nhận được tiền nhưng vẫn hiển thị lịch sử phạt trong ví).
- **Cho KTV B**: Khi đọc mảng `segments` của `BookingItems`, hệ thống sẽ ưu tiên đọc cờ `customCommissionDuration` (nếu có) do API truyền vào để tính tiền cho KTV B.
  - Sửa logic: `v_ktv_duration = COALESCE((v_seg_item->>'customCommissionDuration')::integer, v_real_mins, default_duration)`

---

## 2. Xây dựng Logic (Service Layer)

Tạo file `app/api/ktv/BookingItemPause.service.ts` để tuân thủ SOLID, chứa 3 hàm chính:

### A. `pauseItem(bookingItemId)`
- Lấy giờ hiện tại ghi vào cột `pauseStart` của `BookingItems`.
- Đổi status của Item thành `PAUSED`.
- Gửi Realtime kiện cáo để iPad KTV khóa màn hình (disable nút Hoàn tất).

### B. `swapKtvOnPausedItem(bookingItemId, ktvA, ktvB, extraTime)`
Hàm này chạy Transaction xử lý nghiệp vụ phức tạp:
1. **Xử lý Thời gian & Tiền bạc**:
   - Tính thời gian A đã làm = `pauseStart - timeStart`.
   - Tính thời gian B làm = `(Thời gian gốc - Thời gian A đã làm) + extraTime`.
   - Lưu `customCommissionDuration` cho B = `MAX(Thời gian B làm, Thời gian gốc)`.
2. **Xử lý KTV A**:
   - Cập nhật `TurnLedger` của KTV A: Set `is_punished = true`.
   - Cập nhật `TurnQueue` của KTV A: Đổi trạng thái từ `working` về `waiting` (Mất đơn hàng).
3. **Xử lý KTV B**:
   - Sinh `TurnLedger` mới cho KTV B.
   - Cập nhật `TurnQueue` của KTV B sang `working`.
4. **Cập nhật mảng `technicianCodes`**: Xóa KTV A, thêm KTV B vào `BookingItems`.
5. **Cập nhật mảng `segments`**: 
   - Đóng segment của KTV A.
   - Mở segment mới cho KTV B, nhúng cờ `customCommissionDuration` vào JSON.

### C. `resumeItem(bookingItemId)`
- Tịnh tiến đồng hồ: `timeStart mới = timeStart cũ + (now - pauseStart)`.
- Cập nhật status `BookingItems` về lại `IN_PROGRESS`.
- Đặt `pauseStart = null`.
- Gửi Realtime để iPad của KTV B bắt đầu nhảy đồng hồ.

---

## 3. Cập nhật UI (Quầy Dispatch)
- Thêm nút `[ ⏸️ Tạm dừng ]` trên thẻ dịch vụ của khách.
- Khi trạng thái là `PAUSED`, thẻ đổi màu vàng cảnh báo. Nút thay bằng `[ 🔄 Đổi người ]` & `[ ▶️ Chạy tiếp ]`.
- Modal `[ 🔄 Đổi người ]`:
  - Hiển thị KTV A -> Bấm gỡ.
  - Chọn KTV B từ danh sách rảnh.
  - Ô input: **"Thời gian bù thêm (phút)"** (Mặc định = 0).
  - Nút Submit -> Gọi API `swapKtvOnPausedItem` rồi gọi tự động `resumeItem`.

---

## 4. Kiểm thử (Test Cases)
- **TH1**: Bù thêm 40p -> KTV B làm (30p còn lại + 40p bù) = 70p > 60p gốc -> Lương B = 70p. KTV A = 0đ (nhưng tốn 1 tua).
- **TH2**: Bù thêm 0p -> KTV B làm 30p còn lại < 60p gốc -> Lương B = 60p (tròn tua). KTV A = 0đ.
- **TH3**: Resume không đổi người -> KTV A không bị phạt, làm tiếp và nhận trọn tua bình thường. Giờ trên iPad không bị trôi (Drift).
