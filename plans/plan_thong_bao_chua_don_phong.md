# Plan: Bổ sung thông báo "Bạn chưa dọn phòng" cho KTV

> **Trạng thái**: ✅ Đã duyệt (v2 — sửa lỗ hổng fetch)  
> **Ngày**: 03/09/2026  
> **File sửa**: `KTVDashboard.logic.ts` + `page.tsx` (2 file)

---

## Bối cảnh

### Kịch bản thực tế
1. KTV xong tua 1 → Có đơn mới đang chờ → Bấm "⏭ Bỏ qua — Nhận đơn mới" (skip handover)
2. Phòng tua 1 vào trạng thái "Nợ bàn giao" (`pendingHandovers`)
3. `handleSkipHandover()` → `handleFinishHandover()` → `setScreen('REWARD')` **trực tiếp** (không ghé Dashboard)
4. KTV nhận tua 2 thẳng → Làm → Xong → Màn REWARD
5. **Cần nhắc KTV**: "Bạn còn phòng chưa dọn!"

### Hệ thống đã có sẵn
- **Logic**: `pendingHandovers` state + `fetchPendingHandovers()` trong `KTVDashboard.logic.ts` (dòng 89, 2092–2102)
- **API**: `GET /api/ktv/handover/pending?ktvCode=${ktvId}`
- **Banner hiện tại**: Ô vàng nhạt trên Dashboard (dòng 624–641)
- **Action**: `handleSelectDebt(bookingId)` — KTV bấm đơn nợ → load flow bàn giao nộp ảnh bù

### Lỗ hổng phát hiện (v2)

> ⚠️ **`pendingHandovers` chỉ được fetch khi `screen === 'DASHBOARD'`** (dòng 2104–2109).
>
> Kịch bản skip handover đi thẳng `HANDOVER → REWARD` mà **không ghé Dashboard**, nên `pendingHandovers` vẫn là `[]` cũ → banner REWARD sẽ **KHÔNG hiện**.
>
> **Phải sửa logic.ts** để fetch cả ở REWARD.

---

## Thay đổi chi tiết

### 1. Sửa logic fetch pendingHandovers — `KTVDashboard.logic.ts`

**Vị trí**: Dòng 2104–2109

**Trước**:
```ts
useEffect(() => {
    if (screen === 'DASHBOARD' && ktvId) {
        fetchPendingHandovers();
    }
}, [screen, ktvId]);
```

**Sau**:
```ts
useEffect(() => {
    if (['DASHBOARD', 'REWARD'].includes(screen) && ktvId) {
        fetchPendingHandovers();
    }
}, [screen, ktvId]);
```

**Lý do**: Khi KTV skip handover → `setScreen('REWARD')` trực tiếp → effect phải trigger fetch ở REWARD để `pendingHandovers` được nạp mới, banner mới render đúng.

---

### 2. Thêm banner nhắc nợ ở màn REWARD — `page.tsx`

**Vị trí**: `ScreenReward` component, phía trên nút "Tiếp tục làm việc" (~dòng 1809)

```tsx
{/* Banner nhắc nợ bàn giao trên REWARD */}
{logic.pendingHandovers?.length > 0 && (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-amber-500 p-4 rounded-3xl text-white w-full max-w-[320px]"
  >
    <div className="flex items-center gap-2 mb-1">
      <AlertTriangle size={16} className="animate-pulse" />
      <span className="font-black text-xs uppercase tracking-widest">
        Chưa dọn phòng
      </span>
    </div>
    <p className="text-[11px] font-medium text-amber-50">
      Bạn còn {logic.pendingHandovers.length} phòng chưa bàn giao. 
      Hãy dọn phòng sau khi quay về Dashboard.
    </p>
  </motion.div>
)}
```

---

### 3. Nâng cấp UI banner nợ trên Dashboard — `page.tsx`

**Vị trí**: Dòng 624–641 hiện tại

**Thay đổi**:
- Từ `bg-amber-50 border-amber-100` → `bg-red-50 border-red-200` (nổi bật hơn)
- Icon từ `AlertCircle` tĩnh → `AlertTriangle` kèm `animate-pulse`
- Text từ "Nợ bàn giao (1)" → **"⚠ Bạn chưa dọn phòng (1 phòng)"**
- Nút bấm đơn nợ nổi bật hơn

---

## Tóm tắt file thay đổi

| File | Hành động | Chi tiết |
|---|---|---|
| `app/ktv/dashboard/KTVDashboard.logic.ts` | **MODIFY** | Mở rộng useEffect fetch `pendingHandovers` cho cả REWARD |
| `app/ktv/dashboard/page.tsx` | **MODIFY** | Thêm banner nhắc nợ ở ScreenReward + nâng cấp UI banner Dashboard |

---

## Verification

> ⚠️ **Quan trọng**: Test phải đi đúng đường **không ghé Dashboard** giữa 2 tua.

1. KTV ở Dashboard → Nhận tua 1 → Làm → Xong → Màn HANDOVER
2. Có đơn mới → Bấm **"⏭ Bỏ qua — Nhận đơn mới"** → Hệ thống chuyển **thẳng sang đơn mới** (không quay về Dashboard)
3. Làm tua 2 → Xong → Màn REWARD → **Thấy banner vàng "Bạn còn 1 phòng chưa bàn giao"**
4. Bấm "Tiếp tục làm việc" → Về Dashboard → **Thấy banner đỏ "⚠ Bạn chưa dọn phòng"**
5. Bấm vào đơn nợ → Dọn phòng + Nộp ảnh → Banner biến mất ở cả 2 màn
