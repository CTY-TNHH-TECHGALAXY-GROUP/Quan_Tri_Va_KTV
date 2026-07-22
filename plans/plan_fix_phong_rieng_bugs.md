# Plan: Fix 3 Bug Liên Quan "Phòng Riêng" (NHS0900)

## Trạng thái: ✅ ĐÃ TRIỂN KHAI

## Bối cảnh
Đơn 007 ngày 11/05/2026 bị gán KTV vào dịch vụ "Phòng riêng" → tính sai tiền tua.
Phòng riêng chỉ là **phụ phí**, không cần KTV thực hiện, không tính vào commission.

---

## Bug 1: Addon "Phòng riêng" bị gán KTV tự động

### Nguyên nhân
- **File**: `app/reception/dispatch/actions.ts` → `addAddonServices()` (dòng 1028-1040)
- Khi thêm addon, code copy `technicianCodes` từ booking gốc cho **tất cả** items, kể cả phòng riêng:
```ts
const techIds = booking.technicianCode 
    ? booking.technicianCode.split(',').map(id => id.trim())
    : [];
// ...
technicianCodes: techIds,  // ← NHS0900 cũng bị gán KTV!!!
```

### Fix
- Kiểm tra `serviceId`: nếu là `NHS0900` hoặc tên chứa "phòng riêng" → `technicianCodes: []`
- Không gán KTV cho phòng riêng

```diff
 const itemsToInsert = detailedItems.map((item, index) => {
+    const isPrivateRoom = item.serviceId === 'NHS0900' || 
+        String(item.name || '').toLowerCase().includes('phòng riêng') ||
+        String(item.name || '').toLowerCase().includes('phong rieng');
     return {
         id: `${bookingId}-addon-${timestamp}-${index}`,
         bookingId: bookingId,
         serviceId: item.serviceId,
         quantity: item.qty,
         price: item.priceOriginal,
         status: 'WAITING',
-        technicianCodes: techIds,
+        technicianCodes: isPrivateRoom ? [] : techIds,
         options: { isAddon: true, isPaid: false }
     };
 });
```

---

## Bug 2: Tính sai tiền tua (commission) — gộp cả duration phòng riêng

### Nguyên nhân
- **File**: `app/ktv/dashboard/KTVDashboard.logic.ts` → `handleFinishHandover()` (dòng 1353)
- Code tính `totalMins` lặp qua **tất cả** `assignedItems`, không filter phòng riêng:
```ts
for (const item of assignedItems) {
    // totalMins += item.duration ... ← NHS0900 cũng bị cộng!
}
```

### Fix
- Filter bỏ NHS0900 trước khi tính commission

```diff
+// Filter bỏ phòng riêng (NHS0900) — không tính vào tiền tua
+const serviceItems = assignedItems.filter((item: any) => {
+    const sId = String(item.serviceId || '').toUpperCase();
+    const sName = String(item.service_name || '').toLowerCase();
+    return sId !== 'NHS0900' && 
+           !sName.includes('phòng riêng') && 
+           !sName.includes('phong rieng');
+});
+
 let totalMins = 0;
-for (const item of assignedItems) {
+for (const item of serviceItems) {
```

---

## Bug 3: Pending dispatch ẩn mất phòng riêng → không kiểm tra được

### Nguyên nhân
- **File**: `app/reception/dispatch/_components/dispatch-timeline.ts` (dòng 51-55)
- Khi order ở trạng thái `pending`, code filter hẳn NHS0900 ra khỏi danh sách:
```ts
const pendingServices = order.services.filter(svc => 
    svc.serviceId !== 'NHS0900' && ...  // ← Ẩn mất phòng riêng!
);
```
- Lễ tân **không thấy** phòng riêng ở cột "Chờ điều phối" → không kiểm tra được

### Fix
- Giữ lại phòng riêng trong pending view (chỉ hiển thị, không yêu cầu gán KTV)
- Đánh dấu `isUtility: true` để UI biết đây là phụ phí, không bắt buộc gán KTV

```diff
 if (order.dispatchStatus === 'pending') {
-    const pendingServices = order.services.filter(svc => 
-        svc.serviceId !== 'NHS0900' &&
-        !svc.serviceName?.toLowerCase().includes('phòng riêng') && 
-        !svc.serviceName?.toLowerCase().includes('phong rieng')
-    );
+    const pendingServices = order.services.map(svc => {
+        const isPrivateRoom = svc.serviceId === 'NHS0900' ||
+            svc.serviceName?.toLowerCase().includes('phòng riêng') ||
+            svc.serviceName?.toLowerCase().includes('phong rieng');
+        return isPrivateRoom ? { ...svc, isUtility: true } : svc;
+    });
     
     if (pendingServices.length > 0) {
```

> **Lưu ý**: Ở `DispatchServiceBlock.tsx`, condition `svc.duration > 0` đã tự ẩn KTV picker nếu duration = 0.
> Nhưng vì phòng riêng có thể có duration > 0 (VD: tính theo giờ), cần thêm guard ở `DispatchServiceBlock`:

```diff
 {/* Staff Selection Area */}
-{svc.duration > 0 && (
+{svc.duration > 0 && !(svc as any).isUtility && (
     <div className="space-y-4">
```

---

## Tóm tắt các file cần sửa

| File | Thay đổi | Rủi ro |
|------|----------|--------|
| `actions.ts` → `addAddonServices` | Không gán KTV cho NHS0900 | Thấp — chỉ ảnh hưởng addon mới |
| `KTVDashboard.logic.ts` → `handleFinishHandover` | Filter NHS0900 khi tính commission | Thấp — logic cộng duration |
| `dispatch-timeline.ts` → `buildOrderTimeline` | Giữ phòng riêng ở pending view | Trung bình — cần đánh dấu isUtility |
| `DispatchServiceBlock.tsx` | Ẩn KTV picker cho isUtility | Thấp — chỉ ẩn UI element |

## Thứ tự triển khai
1. Fix Bug 2 trước (tiền tua sai → ảnh hưởng tài chính)
2. Fix Bug 1 (addon gán KTV)
3. Fix Bug 3 (hiển thị pending)
