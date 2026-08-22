# Kế Hoạch Sửa 3 Lỗi: Auto-Finish, Timeline KTV, timeEnd ghi đè

## Dữ Liệu Thực Tế (Đơn 002-28042026)

| Field | Giá trị |
|-------|---------|
| `booking.timeStart` | `08:18:57 UTC` = **15:18 VN** (lúc DV1 bắt đầu) |
| `booking.timeEnd` | `09:23:49 UTC` = **16:23 VN** (lúc DV1 kết thúc!) |
| Item1 (NHS0602 Ráy Tai) | NH011, segment 16:20-17:20, timeEnd = 16:23 VN ✅ Đã xong |
| Item2 (NHS0041 4 Liệu Trình) | NH021, segment 16:21-17:51, timeEnd = 17:50 VN ✅ Đã xong |

### Bằng chứng lỗi:
- `booking.timeEnd = 16:23` nhưng DV2 kết thúc lúc `17:50`
- → `booking.timeEnd` đã bị ghi đè bởi DV1 (xong trước), không chờ DV2

---

## Lỗi 1: Thông báo "Xác nhận HẾT GIỜ" liên tục

### Nguyên nhân chuỗi:
1. Khi NH011 (DV1) hoàn thành → API `PATCH /api/ktv/booking` ghi `booking.timeEnd = now()` (dòng 450)
2. Hàm `getEstimatedEndTime()` trong Kanban ưu tiên `booking.timeEnd` (dòng 59-61) → trả về **16:23**
3. `checkAutoFinish` thấy 16:23 < thời gian hiện tại → gọi `onUpdateStatus('COMPLETED')` → bật `confirm()`
4. Lễ tân bấm Cancel → 30 giây sau lại hỏi lại → lặp vô tận

### Giải pháp (3 bước):

#### Bước 1: API không ghi đè `booking.timeEnd` khi còn DV khác đang làm
**File:** `app/api/ktv/booking/route.ts` (dòng 450)
- Khi 1 KTV hoàn thành, kiểm tra xem còn item nào đang IN_PROGRESS không
- Nếu CÒN → KHÔNG ghi `booking.timeEnd`
- Nếu TẤT CẢ đã xong → mới ghi `booking.timeEnd`

#### Bước 2: `getEstimatedEndTime` không tin `booking.timeEnd` mù quáng
**File:** `KanbanBoard.tsx` (dòng 55-61)
- Xóa logic return sớm khi có `booking.timeEnd`
- Thay vào đó, luôn quét tất cả segments để lấy `maxEndTime` chính xác

#### Bước 3: `checkAutoFinish` + `skipConfirm`
**File:** `KanbanBoard.tsx` (dòng 155-184) + `page.tsx` (dòng 1047)
- Thêm cờ `skipConfirm` vào hàm `handleUpdateStatus`
- `checkAutoFinish` truyền `skipConfirm = true`
- Thêm Set `autoFinishedOrderIds` để không hỏi lại đơn đã bị Cancel

---

## Lỗi 2: Timeline KTV hiển thị sai giờ cho người thứ 2

### Nguyên nhân:
- Dashboard KTV truyền `actualStartTime={item.timeStart || booking.timeStart}`
- NH021 (DV2) chưa bắt đầu → `item.timeStart = null`
- Fallback lấy `booking.timeStart = 15:18` (thời điểm DV1 bắt đầu)
- Timeline tính sai: 15:18 + 90 phút = 16:48, thay vì 16:21 + 90 = 17:51

### Giải pháp:
**File:** `app/ktv/dashboard/page.tsx`
- Xóa fallback `booking.timeStart` trong WorkingTimeline
- Chỉ dùng `item.timeStart` (nếu null → dùng giờ phân bổ từ segment)

---

## Lỗi 3 (đã fix): KTV kẹt màn hình Review
**File:** `KTVDashboard.logic.ts` — ĐÃ FIX ✅

---

## Thứ tự triển khai
1. Fix API `booking.timeEnd` ghi đè sai (root cause)
2. Fix `getEstimatedEndTime` trong Kanban
3. Fix `checkAutoFinish` + `skipConfirm`
4. Fix Timeline KTV Dashboard
