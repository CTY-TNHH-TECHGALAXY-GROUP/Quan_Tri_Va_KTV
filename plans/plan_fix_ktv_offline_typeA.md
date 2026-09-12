# Kế hoạch Fix lỗi VIP Menu (KTV Loại A & On-call)

**Mô tả vấn đề:**
1. KTV NH018 (Loại A) đã **Tan ca** (Check-out) nhưng vẫn hiện trên Menu VIP.
2. KTV NH016 (Loại A, có quyền nhận đơn ngoài giờ) đã **Hết giờ cài đặt** (quá 13h30) nhưng vẫn hiện ở Menu VIP.

## Nguyên nhân gốc rễ (Root Cause)

1. **Lỗi 1 (NH018 Tan ca vẫn hiện VIP)**: 
   - KTV Loại A hiển thị trên VIP Menu dựa vào cờ `is_active_vip_menu = true`.
   - Khi KTV bấm Tan ca (`CHECK_OUT`), hệ thống đã đóng ca (`isOnShift = false`) và cho Sổ tua về trạng thái 'off', **nhưng lại Quyên tắt cờ `is_active_vip_menu`**. Do đó, KTV về nhà rồi mà khách vẫn thấy trên Web VIP.
   
2. **Lỗi 2 (NH016 Hết giờ vẫn kẹt VIP)**:
   - NH016 là KTV Loại A nhưng được cấp quyền `allow_on_call = true` (Nhận đơn ngoài giờ).
   - Hàm dọn dẹp KTV hết giờ ngầm (Cronjob `cleanupExpiredOnline`) hiện tại được code cứng chỉ quét dọn cho `work_type = 'TYPE_B'`. Nên hệ thống **bỏ quên** việc dọn dẹp NH016. Do đó NH016 bị kẹt trạng thái `ONLINE` mãi mãi.
   - Bên cạnh đó, khi Cronjob dọn dẹp, nó cũng không gạt cờ VIP Menu về `false`.

## Giải pháp (Đề xuất thay đổi)

### 1. `app/api/ktv/attendance/route.ts`
- **Sửa logic điểm danh**: Khi KTV Loại A có hành động `CHECK_OUT`, `SUDDEN_OFF` (Nghỉ đột xuất), hoặc `OFF_REQUEST` (Yêu cầu off), bổ sung lệnh cập nhật cờ `is_active_vip_menu = false` vào bảng `Staff`.
- Đảm bảo KTV đã tan ca thì lập tức biến mất khỏi Menu VIP.

### 2. `lib/services/KtvOnlineService.ts`
- **Sửa hàm `goOffline()`**: Khi KTV bấm "Tắt nhận đơn", ngoài việc chuyển trạng thái về `OFFLINE`, cập nhật thêm `is_active_vip_menu: false` để tắt VIP menu.
- **Sửa hàm `cleanupExpiredOnline()`**:
  - Gỡ bỏ bộ lọc `eq('work_type', 'TYPE_B')` để Cronjob có thể quét dọn CẢ KTV Loại A nếu họ đang bật nhận đơn ngoài giờ.
  - Bổ sung `is_active_vip_menu: false` vào lệnh cập nhật tự động offline.

> [!IMPORTANT]
> Giải pháp này đã bao trùm mọi ngóc ngách của hệ thống (Check-out thường, Tắt nhận đơn, và Quá giờ tự tắt). KTV dù quên tắt máy đi về nhà thì Cronjob cũng sẽ tự động xử lý.

Anh/Chị vui lòng **DUYỆT** kế hoạch để hệ thống tiến hành sửa code luôn nhé.
