# 📋 Plan: Fix External KTV Selection & Haircut Service Dispatch

## Ngày: 2026-05-10
## Status: ⏳ Chờ duyệt

---

## 🔍 Phân Tích Nguyên Nhân Gốc Rễ

### Vấn đề 1: KTV ngoài bị bỏ qua khi dispatch

**Root cause:** `page.tsx` dòng 1099-1100:
```typescript
const currentTurn = turns.find(t => t.employee_id === ktvId);
if (!currentTurn) continue; // ← BỎ QUA KTV không có trong TurnQueue!
```

Khi admin nhập tên KTV ngoài (VD: "Na", "Bích Hồng" - không điểm danh hôm nay), code frontend tạo assignment nhưng **không đưa vào** `allStaffAssignments` → server không nhận được KTV → **đơn dispatch thiếu người**.

**Tuy nhiên:** RPC `dispatch_confirm_booking` trên server **ĐÃ hỗ trợ** UPSERT TurnQueue, nên nếu frontend gửi đủ assignment, server sẽ tự tạo TurnQueue record cho KTV ngoài.

### Vấn đề 2: Cắt tóc (duration=0) ẩn khu vực chọn nhân viên

**Root cause:** `DispatchServiceBlock.tsx` dòng 180:
```tsx
{svc.duration > 0 && (
    // Khu vực "Nhân viên & Phòng" bị ẩn hoàn toàn khi duration = 0
)}
```

Và `page.tsx` dòng 776:
```tsx
if (s.duration === 0) return true; // Skip validation → không bắt lỗi thiếu KTV/Phòng
```

---

## 🛠 Kế Hoạch Sửa

### Fix 1: Hỗ trợ KTV ngoài TurnQueue

#### File: `app/reception/dispatch/page.tsx`

**Thay đổi 1a:** Sửa `handleDispatch` — bỏ `if (!currentTurn) continue`

Thay thế bằng logic: nếu KTV không có TurnQueue → tạo fallback assignment data (queuePos = max + 1, turnsCompleted = 0):

```typescript
// TRƯỚC:
const currentTurn = turns.find(t => t.employee_id === ktvId);
if (!currentTurn) continue;

// SAU:
const currentTurn = turns.find(t => t.employee_id === ktvId);

let turnsCompleted = currentTurn?.turns_completed ?? 0;
let queuePos = currentTurn?.queue_position ?? 0;

if (!currentTurn) {
  // KTV ngoài TurnQueue → tạo fallback position
  const currentMax = Math.max(...turns.map(t => t.queue_position), 0);
  const uniqueAddedKtvs = new Set(allStaffAssignments.map(a => a.ktvId));
  queuePos = currentMax + uniqueAddedKtvs.size + 1;
}
```

#### File: `app/reception/dispatch/_components/DispatchStaffRow.tsx`

**Thay đổi 1b:** Thêm section "KTV Ngoài" trong dropdown

- Lấy danh sách `Staff` có `status = 'ĐANG LÀM'` từ props (đã fetch sẵn trong `page.tsx`)
- Lọc ra những Staff **KHÔNG** có trong `availableTurns`
- Hiển thị section riêng với tiêu đề "Nhân viên ngoài (chưa điểm danh)"

**Props cần thêm:** `allStaffs: StaffData[]` truyền từ `DispatchServiceBlock` → `DispatchStaffRow`

#### File: `app/reception/dispatch/_components/DispatchServiceBlock.tsx`

**Thay đổi 1c:** Pass `allStaffs` props xuống `DispatchStaffRow`

---

### Fix 2: Cắt tóc cần KTV + Phòng + Giường, không cần Thời gian

#### Xác định Service ID cắt tóc

> ⚠️ **CẦN USER CUNG CẤP:** ID cụ thể của dịch vụ cắt tóc trong bảng `Services` (VD: "NHS_BARBER_01")

Sẽ dùng constant:
```typescript
// 🔧 SERVICES THAT NEED STAFF + ROOM BUT NOT TIME
const STAFF_ONLY_SERVICE_IDS: string[] = ['???']; // ← Cần user điền
```

#### File: `app/reception/dispatch/_components/DispatchServiceBlock.tsx`

**Thay đổi 2a:** Đổi condition hiển thị khu vực nhân viên:

```tsx
// TRƯỚC:
{svc.duration > 0 && (

// SAU:
{(svc.duration > 0 || STAFF_ONLY_SERVICE_IDS.includes(svc.serviceId)) && (
```

#### File: `app/reception/dispatch/_components/DispatchSegmentRow.tsx`

**Thay đổi 2b:** Ẩn phần thời gian (Duration, Bắt đầu, Kết thúc) khi service thuộc danh sách STAFF_ONLY:

- Thêm prop `hideTimeFields?: boolean`
- Khi `hideTimeFields = true`: ẩn grid 3 cột (Phút/Bắt đầu/Kết thúc), chỉ hiện Room + Bed

#### File: `app/reception/dispatch/page.tsx`

**Thay đổi 2c:** Sửa validation `isDispatchReady` và `getMissingInfo`:

```typescript
// TRƯỚC:
if (s.duration === 0) return true; // Skip hoàn toàn

// SAU:
if (s.duration === 0 && !STAFF_ONLY_SERVICE_IDS.includes(s.serviceId)) return true;
// Nếu là service cắt tóc → vẫn validate KTV + Room + Bed, skip time
```

---

## 📁 Files Cần Sửa

| File | Thay đổi | Rủi ro |
|------|----------|--------|
| `page.tsx` (dispatch) | Fix handleDispatch + validation | ⚠️ Trung bình - cần test dispatch flow |
| `DispatchStaffRow.tsx` | Thêm section KTV ngoài | 🟢 Thấp - UI only |
| `DispatchServiceBlock.tsx` | Đổi condition + pass props | 🟢 Thấp |
| `DispatchSegmentRow.tsx` | Thêm prop ẩn time fields | 🟢 Thấp |

---

## ❓ Câu Hỏi Cần Trả Lời Trước Khi Code

1. **Service ID cắt tóc là gì?** (VD: NHS0015, NHS_BARBER...) — Tôi cần ID chính xác trong bảng `Services`
2. **Có nên validate KTV ngoài phải tồn tại trong bảng Staff không?** Hay cho phép nhập hoàn toàn tự do?

---

## 🔒 Impact Assessment

- **KTV Dashboard**: Không ảnh hưởng — RPC đã hỗ trợ UPSERT TurnQueue
- **Commission Flow**: Không ảnh hưởng — TurnLedger ghi nhận bình thường
- **Kanban Board**: Không ảnh hưởng — đọc từ BookingItems status
- **Realtime Sync**: Không ảnh hưởng
