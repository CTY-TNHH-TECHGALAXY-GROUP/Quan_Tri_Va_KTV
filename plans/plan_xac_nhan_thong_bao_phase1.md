# Plan: Xác nhận Thông báo 2 Chiều — Phase 1 (KTV ↔ Quầy)

> **Dành cho Executor.** Đọc kỹ toàn bộ plan trước khi code.

## Tổng quan

Biến notification từ 1 chiều thành 2 chiều: Quầy bấm "Đã xử lý" + nhập ghi chú → KTV nhận thông báo phản hồi realtime.

## Quyết định kiến trúc đã chốt
- Dùng chung bảng `StaffNotifications`, thêm 2 cột mới.
- Quầy xác nhận qua nút trên Toast + ghi chú inline.
- KTV nhận phản hồi qua Supabase Realtime (đã có sẵn).

---

## Bước 1: Migration SQL

**Tạo file**: `migrations/20260707_add_notification_acknowledge.sql`

```sql
-- Thêm cột xác nhận vào StaffNotifications
ALTER TABLE "StaffNotifications"
ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "acknowledgedNote" TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'STAFF';
-- source: 'STAFF' (từ KTV), 'CUSTOMER' (từ khách - dùng ở Phase 2)

COMMENT ON COLUMN "StaffNotifications"."acknowledgedAt" IS 'Thời điểm Quầy xác nhận đã xử lý';
COMMENT ON COLUMN "StaffNotifications"."acknowledgedNote" IS 'Ghi chú từ Quầy khi xác nhận (VD: Đang mang nước lên)';
COMMENT ON COLUMN "StaffNotifications"."source" IS 'Nguồn: STAFF (KTV gửi) hoặc CUSTOMER (khách gửi)';
```

**Chạy migration trên Supabase Dashboard (SQL Editor).**

**Cập nhật `TableInSupabase.md`**: Thêm 3 cột mới vào mô tả bảng `StaffNotifications`.

---

## Bước 2: Backend API — PATCH /api/ktv/interaction

**Sửa file**: `app/api/ktv/interaction/route.ts`

Thêm hàm `PATCH` vào file hiện có (file đã có `POST`).

### Logic chi tiết:

```typescript
// PATCH /api/ktv/interaction
// Body: { notificationId: string, note?: string }
export async function PATCH(request: Request) {
    // 1. Parse & validate body
    // 2. Update StaffNotifications:
    //    SET acknowledgedAt = new Date().toISOString(), 
    //        acknowledgedNote = note || 'Đã xác nhận',
    //        isRead = true
    //    WHERE id = notificationId
    // 3. Lấy notification gốc để biết type, bookingId
    // 4. Tạo notification phản hồi cho KTV:
    //    createNotification({
    //      type: 'REQUEST_CONFIRMED',
    //      message: `✅ Quầy đã xử lý: ${note || 'Đã xác nhận'}`,
    //      bookingId: originalNotif.bookingId,
    //      employeeId: originalNotif.employeeId  // để KTV nhận đúng
    //    })
    // 5. Return { success: true }
}
```

### Schema validation:
**Sửa file**: `lib/schemas/ktv.schema.ts`

```typescript
export const KtvInteractionAckSchema = z.object({
    notificationId: z.string().min(1, "notificationId is required"),
    note: z.string().optional().default('Đã xác nhận'),
});
```

---

## Bước 3: Frontend Quầy — Nút Xác nhận trên Toast

**Sửa file**: `components/NotificationProvider.tsx`

### 3.1 Toast Component (cho Quầy — component `Toast`)

Tìm component `Toast` (khoảng dòng 750+). Với các notification thuộc loại tương tác (`WATER`, `SUPPORT`, `BUY_MORE`, `EMERGENCY`, `EARLY_EXIT`):

- Thêm state `isAcking` và `ackNote` cho mỗi toast.
- Thêm nút **"✅ Xác nhận"** bên cạnh nút đóng (X).
- Khi bấm "Xác nhận": Hiện inline input ghi chú nhỏ + nút "Gửi".
- Gọi `PATCH /api/ktv/interaction` với `notificationId` và `note`.
- Sau khi thành công: Đổi toast sang trạng thái "✅ Đã xác nhận" (màu xanh, không cho bấm lại).

### 3.2 Thêm type mới vào SOUND_MAP:

```typescript
'REQUEST_CONFIRMED': '/sounds/ktv-nhan-thuong.wav',
```

### 3.3 KtvMessageToast (cho KTV)

- Thêm `REQUEST_CONFIRMED` vào logic phân loại toast.
- Title: "Phản hồi từ Quầy"
- Icon: CheckCircle, màu xanh emerald.

---

## Bước 4: Frontend Admin — Trang Lịch sử Notifications

**Sửa file**: `app/admin/notifications/page.tsx` và `NotificationHistory.logic.ts`

### 4.1 Logic

- Interface `NotificationItem`: Thêm `acknowledgedAt?: string`, `acknowledgedNote?: string`.
- Thêm filter mới: `'acknowledged'` (đã xác nhận) vs `'pending'` (chưa xác nhận).

### 4.2 UI

- Mỗi notification card hiển thị:
  - Nếu `acknowledgedAt`: Badge 🟢 "Đã xác nhận" + ghi chú + thời gian.
  - Nếu chưa: Badge 🟡 "Chờ xử lý" + nút "Xác nhận" (gọi PATCH API).

---

## Bước 5: Cập nhật interaction POST (thêm employeeId)

**Sửa file**: `app/api/ktv/interaction/route.ts` (hàm POST hiện có)

Hiện tại `createNotification` không truyền `employeeId` (techCode). Cần bổ sung:

```typescript
await createNotification({
    type,
    message: finalMessage,
    bookingId,
    employeeId: techCode || null  // ← THÊM DÒNG NÀY
});
```

Mục đích: Để khi Quầy xác nhận, hệ thống biết notification thuộc KTV nào mà gửi phản hồi đúng người.

---

## Checklist kiểm tra

- [ ] Migration SQL đã chạy trên Supabase.
- [ ] `PATCH /api/ktv/interaction` trả về `{ success: true }`.
- [ ] Toast Quầy hiện nút "Xác nhận" cho WATER/SUPPORT/BUY_MORE/EMERGENCY/EARLY_EXIT.
- [ ] Sau khi Quầy xác nhận → KTV nhận toast `REQUEST_CONFIRMED` với ghi chú.
- [ ] Trang Admin Notifications hiển thị trạng thái acknowledged.
- [ ] `TableInSupabase.md` đã được cập nhật.
- [ ] Build không lỗi type.
