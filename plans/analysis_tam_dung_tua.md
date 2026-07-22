# 📊 PHÂN TÍCH TÍNH NĂNG TẠM DỪNG TUA VÀ ĐỔI KTV

## 1. Mục tiêu (Objective)
Cho phép quản lý **tạm dừng (pause)** thời gian của một `BookingItem` khi khách hàng có khiếu nại hoặc yêu cầu đổi KTV. Trong thời gian này, quản lý sẽ kiểm tra vấn đề:
- **Nếu KTV không có lỗi**: Tiếp tục (Resume) thời gian, KTV A hoàn thành dịch vụ và nhận đủ tiền tua.
- **Nếu KTV có lỗi / Khách nhất quyết đổi**: Đổi sang KTV B làm phần thời gian còn lại. KTV B hưởng toàn bộ tiền tua, KTV A không nhận được gì (hoặc xử lý phạt sau).

---

## 2. Giải pháp Kỹ thuật & Cấu trúc DB

### A. Cơ sở dữ liệu (`BookingItems`)
Để hỗ trợ tính năng tạm dừng, ta cần thêm 2 trường mới vào bảng `BookingItems`:
1. `status`: Bổ sung thêm state `PAUSED` (WAITING → IN_PROGRESS ↔ PAUSED → COMPLETED → DONE).
2. `pauseStart` (timestamptz): Ghi nhận lại thời điểm bắt đầu nhấn nút Tạm Dừng.

### B. Logic xử lý thời gian (Absolute Timer Constraint)
**Vấn đề**: Hàm đếm thời gian ở `KTVDashboard.logic.ts` BẮT BUỘC dùng cơ chế **Absolute Time** (`Date.now() - timeStart`). Nếu tạm dừng 10 phút, thì khi Resume `timeStart` phải được **cộng thêm 10 phút** để trừ hao khoảng thời gian đã pause.

**Công thức xử lý khi Resume:**
```javascript
const pauseDurationMs = Date.now() - bookingItem.pauseStart;
const newTimeStart = new Date(bookingItem.timeStart.getTime() + pauseDurationMs);
// Cập nhật lên Supabase
await supabase.from('BookingItems').update({
  status: 'IN_PROGRESS',
  timeStart: newTimeStart,
  pauseStart: null
});
```

---

## 3. Ảnh hưởng luồng tính tiền (TurnLedger) & SOLID

### Tác động luồng tính tiền
**KHÔNG làm ảnh hưởng** đến luồng tính tiền hiện tại.
Lý do: Luồng ghi nhận tua (`TurnLedger`) chỉ được trigger vào khoảnh khắc kết thúc (`COMPLETED` hoặc `DONE`) dựa trên mảng `technicianCodes`. 
- Nếu quản lý xóa KTV A khỏi mảng `technicianCodes` và thay bằng KTV B lúc Resume, hệ thống lúc cuối chỉ thấy có KTV B.
- => **KTV B nhận 1 tua trọn vẹn, KTV A nhận 0 tua**. Điều này thỏa mãn chính xác 100% requirement mà không cần sửa code ở luồng `TurnLedger`!

### Tuân thủ SOLID (Service Layer Pattern)
- **Single Responsibility**: Tách riêng Service Layer `BookingItemPause.service.ts` để xử lý logic tính toán timeStart và đổi KTV.
- **Open/Closed Principle**: Khả năng update `technicianCodes` và chỉnh lại `timeStart` không phá vỡ logic cũ của API Dispatch.

---

## 4. Các trường hợp ẩn (Edge Cases) & Rủi ro

1. **Trường hợp Co-working (Nhiều KTV cùng làm 1 dịch vụ)**:
   - *Rủi ro*: KTV A và KTV C đang cùng làm. Khách khó chịu KTV A. Khi bấm Pause, thời gian của C có bị dừng không?
   - *Giải pháp*: Nên dừng thời gian của toàn bộ `BookingItem` (tức là C cũng tạm nghỉ tay vì khách đang bực bội). Khi giải quyết xong đổi A thành B, Resume lại thì cả B và C cùng làm tiếp.
2. **KTV B lỡ dở tua khác / Xung đột trạng thái TurnQueue**:
   - Khi Swap KTV A thành B, KTV A phải được set trạng thái `TurnQueue` từ `working` về `waiting` (hoặc `off`). KTV B từ `waiting` thành `working`.
3. **Nút "Hoàn tất" bị vô hiệu hóa khi PAUSED**:
   - Trong quá trình `PAUSED`, UI của KTV cần chặn các nút `Hoàn tất chặng` hoặc `Hoàn tất dịch vụ` để tránh việc KTV cố tình bấm xong lúc đang bị quản lý xử lý.
4. **Drift Timer**:
   - Việc dùng `timeStart + pauseDuration` giải quyết hoàn toàn rủi ro trôi giờ. Đồng hồ đếm ngược trên dashboard KTV sẽ tự động điều chỉnh mà không cần Refresh app.

---

## 5. Thời gian triển khai dự kiến
| Giai đoạn | Công việc | Thời gian |
|---|---|---|
| **DB & Service** | Thêm cột `pauseStart`, viết `BookingItemPause.service.ts` | 1 giờ |
| **API** | Tạo route `POST /api/ktv/pause-item` và `POST /api/ktv/resume-item` | 1.5 giờ |
| **UI Quản lý** | Nút Pause ở màn Quầy (Dispatch) + popup Swap KTV | 2 giờ |
| **UI KTV** | Màn KTV Dashboard hiện "Đang tạm dừng", lock các nút | 1 giờ |
| **Test** | Mô phỏng thực tế | 1 giờ |
| **Tổng** | | **~6.5 giờ** |

---

## 6. Mô hình Test (Test Plan)
- **Test Case 1 (Resume bình thường)**: Bắt đầu item -> 5 phút sau Pause -> 2 phút sau Resume (không đổi KTV) -> KTV hoàn thành. Kiểm tra tổng thời gian và tiền tua KTV (Đủ).
- **Test Case 2 (Swap KTV)**: Bắt đầu item -> Pause -> Xóa KTV A, thêm KTV B -> Resume -> KTV B hoàn thành. Kiểm tra `TurnLedger` chỉ cộng tua cho KTV B.
- **Test Case 3 (Co-working Swap)**: [A, C] làm -> Pause -> Đổi A thành B -> Resume [B, C] -> Hoàn thành. Kiểm tra B và C nhận điểm bonus (nếu có), A không có gì.
