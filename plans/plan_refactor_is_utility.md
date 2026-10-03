# Kế Hoạch Refactor: Nhận Diện Dịch Vụ Tiện Ích (`is_utility`)

> **Ngày lập:** 2026-05-11  
> **Trạng thái:** ✅ Đã đánh giá — Sẵn sàng triển khai  
> **Mục tiêu:** Loại bỏ hoàn toàn hardcode `NHS0900` / `phòng riêng` / `duration === 0` và thay bằng cột `is_utility` chuẩn mực từ Database.

---

## 🎯 Tại Sao Cần Làm

| Vấn đề cũ | Hậu quả |
|:---|:---|
| Hardcode `serviceId === 'NHS0900'` tại 12 nơi | Thêm 1 dịch vụ tiện ích mới → phải sửa code |
| So sánh tên dịch vụ bằng string `'phòng riêng'` | Đổi tên dịch vụ → hỏng logic |
| Hack "duration = 0 phút → không gán KTV" | Nhập sai 0 phút cho DV thực → bị lọt tiện ích |
| Lặp lại ở 12 điểm trong 5 file | Vi phạm DRY, dễ bỏ sót khi sửa |

---

## 🗺️ Bản Đồ 12 Điểm Hardcode Cần Xóa

| # | File | Dòng | Mô tả |
|:--|:---|:---:|:---|
| 1 | `actions.ts` | 852 | Tính booking status — filter bỏ phòng riêng |
| 2 | `actions.ts` | 1034 | `addServices` — không gán KTV cho phòng riêng |
| 3 | `actions.ts` | 1655 | Tính timeline gối đầu — bỏ qua phòng riêng |
| 4 | `dispatch-timeline.ts` | 53–55 | Kanban pending — đánh dấu `isUtility` |
| 5 | `dispatch-timeline.ts` | 91 | Bỏ qua phòng riêng khi tính timeline |
| 6 | `dispatch-timeline.ts` | 155 | Bỏ qua phòng riêng khi xây SubOrder |
| 7 | `dispatch-timeline.ts` | 244 | Inject utilities lại UI |
| 8 | `dispatch/page.tsx` | 1881 | Ẩn KTV picker trên Kanban UI |
| 9 | `app/api/ktv/booking/route.ts` | 310 | Loại bỏ khi xét hoa hồng KTV |
| 10 | `app/api/ktv/booking/route.ts` | 681 | Loại bỏ khi tính tổng booking status |
| 11 | `KTVDashboard.logic.ts` | 1402–1406 | Filter bỏ phòng riêng khi tính tiền tua |

---

## 📋 Các Bước Triển Khai (8 bước)

### ✅ Bước 1: SQL — Chạy trên Supabase (User thực hiện)

```sql
-- Thêm cột is_utility vào bảng Services
ALTER TABLE "Services" ADD COLUMN "is_utility" BOOLEAN NOT NULL DEFAULT false;

-- Cập nhật Phòng Riêng hiện tại
UPDATE "Services" SET "is_utility" = true WHERE "id" = 'NHS0900';
```

> **Sau này**, nếu thêm dịch vụ tiện ích mới (Trà gừng, Đá nóng...), chỉ cần vào Supabase tick `is_utility = true` — không cần sửa code.

---

### 🔧 Bước 2: `actions.ts` — Fix nguồn gốc (QUAN TRỌNG NHẤT)

**2a. `getDispatchData` — Thêm `is_utility` vào query Services:**
```typescript
// Dòng 44-48: Thêm is_utility vào select
const { data: allServices } = await supabase
    .from('Services')
    .select('id, code, nameVN, nameEN, duration, description, category, priceVND, imageUrl, is_utility') // ← thêm is_utility
    .limit(1000);
```

**2b. `servicesMap` — Lưu `is_utility` trong map:**
```typescript
const info = {
    name: ...,
    duration: s.duration ?? 60,
    description: ...,
    is_utility: s.is_utility ?? false  // ← thêm dòng này
};
```

**2c. Khi map BookingItems — truyền `is_utility` xuống:**
```typescript
return {
    ...i,
    service_name: svcInfo?.name || `DV ${sId.toUpperCase()}`,
    duration: finalDuration,
    is_utility: svcInfo?.is_utility ?? false,  // ← thêm dòng này
    ...
};
```

---

### 🔧 Bước 3: `dispatch-timeline.ts` — Thay 4 điểm hardcode

Thay tất cả pattern:
```typescript
// ❌ Cũ
svc.serviceId === 'NHS0900' || 
svc.serviceName?.toLowerCase().includes('phòng riêng') || 
svc.serviceName?.toLowerCase().includes('phong rieng')
```

Bằng:
```typescript
// ✅ Mới (với fallback giai đoạn chuyển tiếp)
svc.is_utility === true || svc.serviceId === 'NHS0900' // Legacy — xóa sau 2 tuần
```

---

### 🔧 Bước 4: `dispatch/page.tsx` — Dòng 1881

```typescript
// ❌ Cũ
const isUtilitySvc = svc.id === 'NHS0900' || String(name).toLowerCase().includes('phòng riêng') || ...

// ✅ Mới
const isUtilitySvc = svc.is_utility === true || svc.id === 'NHS0900'; // Legacy fallback
```

---

### 🔧 Bước 5: `app/api/ktv/booking/route.ts` — 2 điểm

**Dòng ~310 và ~681:** Cập nhật query để join thêm `is_utility`:
```typescript
// Cập nhật query
await supabase
    .from('BookingItems')
    .select('status, serviceId, Services!BookingItems_serviceId_fkey(nameVN, is_utility)')
    .eq('bookingId', bookingId);

// Thay điều kiện filter
const validItems = allItems.filter((i: any) => {
    return i.Services?.is_utility !== true 
        && i.serviceId !== 'NHS0900'; // Legacy fallback
});
```

---

### 🔧 Bước 6: `actions.ts` — Hàm `addServices` (Dòng 1034)

```typescript
// Cần query is_utility từ Services trước khi insert
const { data: svcInfo } = await supabase
    .from('Services')
    .select('id, is_utility')
    .in('id', detailedItems.map(i => i.serviceId));

const svcUtilityMap = new Map(svcInfo?.map(s => [s.id, s.is_utility]) || []);

const itemsToInsert = detailedItems.map((item, index) => {
    const isUtility = svcUtilityMap.get(item.serviceId) === true 
        || item.serviceId === 'NHS0900'; // Legacy fallback
    return {
        ...
        technicianCodes: isUtility ? [] : techIds,
    };
});
```

---

### 🔧 Bước 7: `actions.ts` — Timeline gối đầu (Dòng 1655)

```typescript
// ❌ Cũ
if (item.serviceId === 'NHS0900' || item.serviceName?.toLowerCase().includes('phòng riêng') || ...) return;

// ✅ Mới
if (item.is_utility === true || item.serviceId === 'NHS0900') return; // Legacy fallback
```

---

### 🔧 Bước 8: `KTVDashboard.logic.ts` — Tính tiền tua (Dòng 1402–1406)

```typescript
// ❌ Cũ
return sId !== 'NHS0900' && !name.toLowerCase().includes('phòng riêng') ...

// ✅ Mới — lưu ý: ở đây chỉ có serviceId, cần thêm is_utility vào data fetchBooking
return !item.is_utility && sId !== 'NHS0900'; // Legacy fallback
```

> **Lưu ý:** API `fetchBooking` của KTV cũng cần join `Services(is_utility)` để trường này có trong `BookingItems`.

---

### 🔧 Bước 9: Cleanup & Cập nhật `TableInSupabase.md`

Thêm dòng vào bảng `Services`:
```markdown
| `is_utility` | boolean | Cờ dịch vụ tiện ích — không gán KTV, không tính hoa hồng. Default: false |
```

---

## 🧠 Chiến Lược Migrate An Toàn

**Vấn đề:** Có thể có BookingItem cũ trong DB với `NHS0900` vẫn chạy theo luồng cũ khi deploy.

**Giải pháp (2 giai đoạn):**

| Giai đoạn | Điều kiện | Thời gian |
|:---|:---|:---|
| **Giai đoạn 1** | `is_utility === true \|\| serviceId === 'NHS0900'` | Tuần 1-2 sau deploy |
| **Giai đoạn 2** | Chỉ `is_utility === true` | Sau 2 tuần, xóa fallback |

---

## ✅ Định Nghĩa "Hoàn Thành"

- [ ] SQL đã chạy, cột `is_utility` tồn tại trong Supabase
- [ ] `getDispatchData` truyền `is_utility` xuống đúng từng BookingItem
- [ ] 12 điểm hardcode đã được thay thế
- [ ] `TableInSupabase.md` đã cập nhật
- [ ] Test: Tạo đơn mới có "Phòng riêng" → KTV picker ẩn, không hiện trên timeline KTV
- [ ] Test: Thêm dịch vụ tiện ích mới từ Supabase (không cần sửa code) → hoạt động đúng

---

## ⏱️ Ước Tính Thời Gian

| Bước | Thời gian |
|:---|:---:|
| SQL (User chạy) | 2 phút |
| Bước 2: `getDispatchData` | 15 phút |
| Bước 3-7: Thay hardcode | 30 phút |
| Bước 8: `KTVDashboard` | 15 phút |
| Bước 9: Cleanup | 10 phút |
| **Tổng** | **~70 phút** |
