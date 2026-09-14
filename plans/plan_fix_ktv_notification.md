# Kế hoạch khắc phục lỗi thông báo gán đơn cho KTV (Cập nhật phân tích Setting)

## Phân tích vì sao "Setting trong phần quản lý thông báo chưa được áp dụng"

Khi kiểm tra cấu hình `notification_rules` trong DB, bạn đã thiết lập chính xác:
- Loại `NEW_ORDER`: có `"allowed_roles": ["admin", "reception", "ktv"]` và `"require_on_shift": true`.
- Tuy nhiên, tại client KTV (`NotificationProvider.tsx`), code kiểm tra điều kiện KTV đã điểm danh (on-shift) bị viết sai logic như sau:

```typescript
// 🚨 ĐOẠN CODE LỖI TRONG NotificationProvider.tsx:
if (isKtv && rule?.require_on_shift) {
    // Nếu KTV không phải là người được gán trực tiếp (isTargetEmployee = false)
    if (!isTargetEmployee) {
        console.log('⏭️ [NotificationProvider] KTV off-shift, skipping:', notifType);
        return; // ❌ HỦY LUÔN THÔNG BÁO!
    }
}
```

- **Hậu quả**: Vì thông báo đơn mới gửi về quầy (`NEW_ORDER`) là thông báo chung, trường `employeeId` là `null` nên `isTargetEmployee` luôn luôn bằng `false`. 
- Gặp đoạn code trên, hệ thống hiểu lầm KTV "chưa điểm danh" và tự động hủy bỏ thông báo. Do đó, mặc dù bạn đã thêm role `ktv` vào cấu hình, KTV vẫn không nhận được thông báo đơn mới.

---

## Giải pháp khắc phục

### 1. Đồng bộ trạng thái Điểm danh (`isOnShift`) thực tế của KTV tại Client
Chúng ta sẽ sửa `NotificationProvider.tsx` để theo dõi chính xác trạng thái điểm danh thực tế:
- Thêm state `isOnShift` vào `NotificationProvider`.
- Khi khởi chạy, query nhanh bảng `Users` để lấy trạng thái `isOnShift` hiện tại của KTV.
- Lắng nghe realtime sự kiện `UPDATE` trên bảng `Users` có `id = user.id`. Khi KTV điểm danh (Check-in) thành công, DB cập nhật `isOnShift = true` thì Client tự động chuyển `isOnShift = true` ngay lập tức. Khi Check-out, Client chuyển `isOnShift = false`.

### 2. Sửa logic lọc tại Client (`NotificationProvider.tsx`)
Thay thế đoạn code lỗi bằng cách kiểm tra biến `isOnShift` thực tế:

```typescript
// ✅ CODE MỚI SẼ SỬA:
if (isKtv && rule?.require_on_shift) {
    if (!isTargetEmployee) {
        // Chỉ bỏ qua nếu KTV thực sự CHƯA ĐIỂM DANH (isOnShift = false)
        if (!isOnShift) {
            console.log('⏭️ [NotificationProvider] KTV off-shift, skipping:', notifType);
            return;
        }
    }
}
```

### 3. Sửa đổi thông báo khi điều phối KTV (`processDispatch` trong `actions.ts`)
- Thay đổi `type` của thông báo phân công chi tiết do Server Action tạo ra từ `'NEW_ORDER'` thành `'KTV_NEW_ORDER'`.
- Vì `'KTV_NEW_ORDER'` có rule chỉ gửi cho người được gán (`include_target_employee = true` và `allowed_roles = []`), nên **chỉ duy nhất KTV được gán** nhận được thông báo chi tiết này.
- Tiến hành xóa thông báo sơ sài tự động tạo ra bởi database trigger cho KTV này trong cùng đơn hàng (nếu có) trước khi tạo thông báo chi tiết, tránh KTV nhận trùng lặp 2 thông báo.

### 4. Sửa đổi thông báo khi duyệt đơn Web Booking (`confirmWebBooking` trong `actions.ts`)
- Khi Lễ tân bấm duyệt đơn Web Booking, nếu đơn đó có sẵn KTV yêu cầu, tiến hành tạo thông báo `'KTV_NEW_ORDER'` cho KTV đó.

---

## Chi tiết các file thay đổi

### [MODIFY] [actions.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/dispatch/actions.ts)
- Thay đổi logic gửi thông báo cho KTV trong hàm `processDispatch`.

### [MODIFY] [actions.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/web-booking/actions.ts)
- Gửi thông báo cho KTV yêu cầu trong hàm `confirmWebBooking`.

### [MODIFY] [NotificationProvider.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/components/NotificationProvider.tsx)
- Thêm state `isOnShift` và đồng bộ realtime qua bảng `Users`.
- Cập nhật logic lọc `require_on_shift` tại Client.

---

## Kế hoạch kiểm tra (Verification Plan)

1. **Kiểm tra tự động**:
   - Chạy lệnh `npx tsc --noEmit` để đảm bảo không lỗi TypeScript.
2. **Kiểm tra thủ công**:
   - Dùng 2 tài khoản KTV: KTV A (đã điểm danh) và KTV B (chưa điểm danh).
   - Tạo đơn mới từ khách hàng: KTV A phải nhận được thông báo có đơn mới từ quầy, còn KTV B không nhận được.
   - Điều phối đơn gán cho KTV A: KTV A nhận được thông báo phân công chi tiết của riêng mình, KTV B không nhận được gì.
