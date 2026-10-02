# Kế hoạch: Sửa giao diện khi dừng đơn, badge Loại D, và luồng đổi KTV theo giờ thực

**Ngày lập:** 03/09/2026
**Nhánh:** `feat/bit-lo-hong-phase1`
**Phạm vi:** Kanban lễ tân (dispatch) — badge loại thợ, bố cục nút khi PAUSED, action "Kết thúc đơn", và công thức lương khi đổi KTV.
**Trạng thái:** Chờ duyệt.

---

## Bối cảnh

Ảnh chụp ngày 03/09/2026: một đơn đã bắt đầu, KTV mã `T016` (Loại D thực tế) hiển thị badge "A" trên card kanban. Bên dưới có 4 nút "Dọn / Tiếp / Đổi / Link" — không đúng ý; khi đơn đang dừng, không cần "Dọn" mà cần "Tiếp / Đổi KTV / Kết thúc đơn". Ngoài ra chính sách tiền khi đổi KTV cần cập nhật.

---

## MỤC 1 — Badge Loại D hiển thị sai thành "A" (P0)

**Nguyên nhân xác định:** [components/KanbanBoard.tsx:69-73](app/reception/dispatch/_components/KanbanBoard.tsx:69) chỉ định nghĩa TYPE_A/B/C. Với TYPE_D, biểu thức `WORK_TYPE_BADGE_KANBAN[workType] || WORK_TYPE_BADGE_KANBAN.TYPE_A` rơi vào fallback → hiển thị "A".

**Sửa:**
- `WORK_TYPE_BADGE_KANBAN` bổ sung: `TYPE_D: { label: 'D', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' }`.
- Điều kiện `if (!workType || workType === 'TYPE_A') return null;` giữ nguyên; TYPE_D vẫn hiện badge.
- Rà thêm nơi có bảng tương tự để đồng bộ: `lib/constants/staff.constants.ts` (`WORK_TYPE_LABELS`) — kiểm tra đã có "D" chưa; nếu chưa thì thêm.

**Kiểm chứng:** Trên đơn của T016, badge đổi thành "D" (xanh emerald). Với TYPE_B/C, giữ nguyên.

---

## MỤC 2 — Bố cục nút khi đơn PAUSED (P1)

### 2.1 Ẩn nút "Dọn"

Hiện tại [components/KanbanBoard.tsx:1096-1128](app/reception/dispatch/_components/KanbanBoard.tsx:1096) luôn render nút chính `currentCfg.nextLabel` (🧹 Dọn) dựa vào `dispatchStatus === 'IN_PROGRESS'`, không phân biệt items có đang PAUSED không.

**Sửa:** Bọc block `currentCfg.next` bằng điều kiện thêm:
```
const anyPaused = services.some(s => s.status === 'PAUSED');
if (currentCfg.next && !anyPaused) { ... render nút Dọn ... }
```

### 2.2 Thêm nút "Kết thúc đơn"

Chưa tồn tại action này trong luồng dispatch (grep `KẾT THÚC|END_EARLY|FINISH_EARLY` → 0). Cần bổ sung:

**Frontend** ([components/KanbanBoard.tsx:1131-1150](app/reception/dispatch/_components/KanbanBoard.tsx:1131)):
- Khi `anyPaused`, hàng nút chỉ gồm 3 nút cùng cấp: `Tiếp` (xanh) / `Đổi` (indigo) / `Kết thúc đơn` (rose).
- `Link` giữ vị trí như cũ (nút riêng bên phải cùng hàng, hoặc xuống dòng nếu chật) — không đổi.
- Nút "Kết thúc đơn" mở `ConfirmDialog` xác nhận trước khi gọi API.

**Backend** — API mới `POST /api/ktv/finish-early-paused` (hoặc mở rộng `pause-swap-resume` với action `FINISH_EARLY`):
1. Nạp `BookingItems` theo `bookingItemId` (và các sibling merged đang PAUSED cùng KTV — dùng chính logic gộp trong `pauseItem`).
2. Với mỗi item:
   - Duyệt `segments`, với mỗi segment có `actualStartTime` và **chưa có** `actualEndTime`: chốt `actualEndTime = pauseStart` (thời điểm dừng, không phải `now` — tránh cộng thời gian dừng vào lương).
   - Ghi `customCommissionDuration = round((actualEndTime − actualStartTime)/60000)` cho segment vừa chốt.
   - Đánh `note: 'FINISHED_EARLY_ON_PAUSE'`.
3. Update `BookingItems.status = 'COMPLETED'` (hoặc trạng thái dùng cho luồng chuyển sang `CLEANING`/`FEEDBACK` — cần khớp với `RawStatus` hiện tại).
4. Đồng bộ `subOrder.dispatchStatus` (`CLEANING` là bước kế tiếp `IN_PROGRESS` trong `KANBAN_COLS`); có thể bỏ qua `CLEANING` nếu đề bài yêu cầu về thẳng `FEEDBACK` — nói rõ khi triển khai.
5. `syncTurnsForDate(businessDate)` để cập nhật tua.

**Kiểm chứng:** Đơn đang PAUSED → bấm "Kết thúc đơn" → item chuyển trạng thái, `segments` có `actualEndTime = pauseStart`, `KtvCommissionService.calculateItemDuration` trả về số phút đúng bằng khoảng đã làm.

---

## MỤC 3 — Đổi công thức lương khi SWAP KTV (P1)

### 3.1 Vấn đề

`lib/services/BookingItemPauseService.ts:swapKtvOnPausedItem` hiện:
- KTV cũ: `TurnLedger.delete()` → **0đ** (banner đỏ [PauseSwapKtvModal.tsx:196](app/reception/dispatch/_components/PauseSwapKtvModal.tsx:196) khẳng định điều này).
- KTV mới: `customCommissionDuration = originalDuration + extraTimeMins` → **hưởng trọn tua**.

Yêu cầu mới: "KTV cũ nhận đúng thời gian đã làm (bắt đầu → lúc dừng), KTV mới làm phần thời gian còn lại".

### 3.2 Cách sửa `swapKtvOnPausedItem`

**Bước A — Tính thời gian KTV cũ đã làm:**
```
const aIndex = segments.findIndex(seg => seg.ktvId === oldKtvId && !seg.endTime);
const oldSeg = segments[aIndex];
const pauseTimeMs = new Date(item.pauseStart).getTime();
const oldStartMs = new Date(oldSeg.actualStartTime).getTime();
const oldWorkedMins = Math.max(0, Math.round((pauseTimeMs - oldStartMs) / 60000));
```

**Bước B — Chốt segment KTV cũ:**
```
segments[aIndex] = {
  ...oldSeg,
  endTime: item.pauseStart,
  actualEndTime: item.pauseStart,
  customCommissionDuration: oldWorkedMins,
  note: 'CHANGED',   // theo đề bài
};
```

**Bước C — Xử lý TurnLedger KTV cũ:**
- Hiện tại: xoá bản ghi.
- Mới: **giữ nguyên** (không xoá, không set `is_punished`). Commission sẽ được tính từ `customCommissionDuration` mà `KtvCommissionService.calculateItemDuration` đã đọc ([KtvCommissionService.ts:288](lib/services/KtvCommissionService.ts:288)).
- Bỏ nhánh `keepTurnForOldKtv` trong flow SWAP (không còn nghĩa), hoặc tài liệu hoá lại — kiểm tra ở modal xem có UI nào bật flag này không (grep: chỉ mặc định `false`).

**Bước D — Segment KTV mới:**
```
const remainingMins = Math.max(0, originalDuration - oldWorkedMins) + extraTimeMins;
segments.push({
  ktvId: newKtvId,
  startTime: new Date().toISOString(),
  actualStartTime: new Date().toISOString(),   // set để commission tính đúng
  endTime: null,
  duration: remainingMins,           // để calculateItemExpectedDuration đọc
  customCommissionDuration: remainingMins,
  note: 'TAKEOVER',
});
```

**Bước E — Tương thích commission:**
- `KtvCommissionService.calculateItemDuration` đã cộng `customCommissionDuration` từ mọi segment ([:288](lib/services/KtvCommissionService.ts:288)) → tổng số phút đúng.
- `calculateItemExpectedDuration` chỉ đọc `seg.duration` ([:270](lib/services/KtvCommissionService.ts:270)) → cần bảo đảm segment KTV cũ giữ trường `duration` gốc (không ghi đè bằng `oldWorkedMins`; chỉ ghi vào `customCommissionDuration`).

**Bước F — Sửa banner UI:**
`PauseSwapKtvModal.tsx:196`: đổi "KTV bị đổi sẽ tự động bị hủy tua này và nhận 0đ" → "KTV bị đổi được tính lương theo đúng thời gian đã làm; KTV mới nhận phần còn lại (+ giờ bù nếu có)."

### 3.3 Kiểm chứng

- Tạo đơn 60 phút, KTV A start lúc 09:00, dừng lúc 09:20, đổi sang KTV B, extra = 0.
  - Segment A: `customCommissionDuration = 20`.
  - Segment B: `customCommissionDuration = 40`.
- Đơn merged 2 dịch vụ (A + B cùng lúc): kiểm tra chỉ segment của KTV bị đổi bị chốt; segment KTV còn lại không bị đụng.
- Ca gộp phòng: `oldSeg.actualStartTime` là mốc thật của chặng, không dùng `booking.timeStart`.

---

## MỤC 4 — Ghi chú phụ

- Modal PauseSwap: nút "Tạm dừng / Đổi KTV" tooltip hiện chung ([KanbanBoard.tsx:1151](app/reception/dispatch/_components/KanbanBoard.tsx:1151)); giữ nguyên, việc thêm "Kết thúc đơn" chỉ hiện khi đã PAUSED nên không xung đột.
- Nếu Payroll/Bonus có luồng khác đọc `TurnLedger` (không dùng `KtvCommissionService`), phải rà thêm — grep `TurnLedger` trong `lib/services/*Payroll*`, `*Bonus*` trước khi triển khai.
- KTV Loại D có nghiệp vụ tính lương riêng (`KtvTypeDWalletService`, `KtvTypeDOnlineService`); cần kiểm tra xem có đọc `segments/customCommissionDuration` cùng cách không, hay có nhánh riêng.

---

## Thứ tự triển khai đề xuất

1. **Mục 1** (badge D) — thay đổi tối thiểu, kiểm chứng ngay.
2. **Mục 2.1** (ẩn nút Dọn khi paused) — chỉ frontend, an toàn.
3. **Mục 3** (công thức SWAP) — có thay đổi backend, cần test kỹ với đơn merged.
4. **Mục 2.2** (Kết thúc đơn) — action mới, thảo luận với bạn về trạng thái đích (CLEANING hay FEEDBACK) trước khi code.

---

## Câu hỏi cần bạn quyết trước khi triển khai

1. "Kết thúc đơn" ở trạng thái PAUSED nên đưa đơn về **CLEANING** (giống nút Dọn bình thường) hay bỏ qua và về **FEEDBACK**?
2. Khi KTV cũ đã làm rất ngắn (ví dụ 3 phút), có muốn áp dụng ngưỡng tối thiểu (vd nếu <10 phút thì tính 0) hay tính đúng từng phút?
3. Trường hợp `extraTimeMins > 0` (bù thêm giờ cho KTV mới) có còn cần trong chính sách mới không, hay đã đủ vì KTV mới tự nhận phần còn lại?
