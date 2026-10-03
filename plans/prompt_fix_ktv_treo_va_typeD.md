# Prompt bàn giao: Fix triệt để KTV treo + Triển khai plan Loại D

**Nhánh:** `feat/bit-lo-hong-phase1`
**Ngày:** 2026-09-03
**Người bàn giao:** Sparring partner phiên trước.
**Đối tượng:** Anti (session code mới).

---

## PHẦN 0 — CONTEXT

Trên nhánh này đã có 2 fix cho lỗi T016 dashboard reload liên tục:
- `235aeda` — thêm `.order('id')` vào query BookingItems trong [handleGetBooking.ts:270](app/api/ktv/booking/_handlers/handleGetBooking.ts:270).
- `e6f5d88` — thêm `isFetchingRef` guard chặn concurrent `fetchBooking` trong [KTVDashboard.logic.ts](app/ktv/dashboard/KTVDashboard.logic.ts).

Còn **untracked**:
- `plans/plan_sua_dung_don_va_doi_ktv_typeD.md` — plan chi tiết đã chốt phương án.
- `test2.ts` — file rác, xoá được.

Việc còn phải làm chia làm **2 track độc lập**, chạy theo thứ tự A → B.

---

## 🚨 CẬP NHẬT LẦN 2 SAU COMMIT `b1d8119` (04/09/2026)

**Đã xác nhận bằng console.log MOUNT/UNMOUNT trong useEffect fetchBooking:**

Log pattern LẶP mỗi 4-6 giây:
```
🔬 [UNMOUNT] fetchBooking effect cleanup, ktvId= T016
🔬 [MOUNT] fetchBooking effect mounted, ktvId= T016
🔬 [UNMOUNT] fetchBooking effect cleanup, ktvId= T016
🔬 [MOUNT] fetchBooking effect mounted, ktvId= T016
📡 Fetch Success (3s later)
📡 Fetch Success (5s later)
[UNMOUNT]
[MOUNT]
...
```

**Kết luận CHẮC CHẮN:** useEffect với deps `[ktvId]` bị fire lại 2 LẦN mỗi cycle 4-6 giây. Vì `ktvId` là primitive string 'T016' (không đổi) → React KHÔNG thể tự re-fire. Nghĩa là **component đang unmount+remount** hoặc `useKTVDashboard` closure bị recreate.

**Đã điều tra loại trừ:**
- ✅ Không phải React Strict Mode (`next.config.ts: reactStrictMode: false`)
- ✅ Không phải `user` toggle null↔object (auth-context không setUser periodic)
- ✅ Không phải `lockedInfo` (setLockedInfo không được gọi)
- ✅ Không phải Fast Refresh (Fast Refresh chỉ log 1 lần rồi ngưng)

**Nghi vấn CÒN LẠI (cần điều tra):**
1. **`Suspense` boundary ở [page.tsx:206](app/ktv/dashboard/page.tsx:206)** — nếu `useSearchParams()` liên tục suspend do re-fetch route data → children unmount.
2. **`motion.div`** trong AppLayout ở [components/layout/AppLayout.tsx:100-107](components/layout/AppLayout.tsx:100) — framer-motion có thể force remount qua `key` hoặc `AnimatePresence` mode.
3. **AppLayout conditional render** ở line 81 (`if (!mounted || !user)`) và line 89 (`if (lockInfo)`) — nếu 1 trong 3 nhánh render toggle → children unmount+mount.
4. **NotificationProvider Realtime status** — khi `Tab became visible — reconnecting` fire → NotificationProvider có `useState` để track status? Chưa xác nhận.
5. **Test env đặc thù:** Chrome preview trong Claude Desktop có thể fire visibility events bất thường (7/10s) khiến các component có visibility-dependent behavior bị unmount cascade. **CẦN TEST TRÊN CHROME THẬT** để xác nhận bug có xảy ra ở user thật không.

**Cách fix theo từng kịch bản:**
- Nếu là Suspense re-suspend → tách `useSearchParams()` ra component riêng, không đặt trong Suspense boundary chính.
- Nếu là motion.div → thêm `layout={false}` hoặc bỏ AnimatePresence.
- Nếu là AppLayout early return → wrap main render trong stable component, chỉ toggle inner content thay vì toàn bộ children.

**Fix "band-aid" ngay lập tức nếu chưa tìm được root:** Move state ra khỏi `useKTVDashboard` (lift lên context hoặc Zustand store) để state không bị mất khi hook remount.

---

## 🚨 CẬP NHẬT SAU COMMIT `b1d8119` (03/09/2026, tối)

Đã apply đủ Track A (A1 + A2 + A2.5 + A2.6) trong 1 commit. **Fix có tác dụng nhưng CHƯA đủ.**

Live debug với instrument `window.fetch` + stack trace cho thấy:
- Vẫn còn burst 4 fetch/4-6s
- Mỗi burst = 2 pair × (fetchBooking + checkNextOrder) fire cách nhau ~9ms
- Đây là dấu hiệu **effect re-mount 2 lần trong 9ms** — mount → unmount → mount

Nguyên nhân KHÔNG phải React Strict Mode (`next.config.ts` đã set `reactStrictMode: false`).

**Nghi vấn thủ phạm còn lại (chưa fix):**
- `useAuth()` context ở [KTVDashboard.logic.ts:57](app/ktv/dashboard/KTVDashboard.logic.ts:57) có thể return `user` object với identity đổi liên tục → `ktvId = user?.code?.toUpperCase()` trả về same string 'T016' nhưng React vẫn nhìn thấy re-render → nếu có Suspense boundary hoặc parent conditional render → effect có thể unmount/remount.
- Hoặc `NotificationProvider` ở [components/NotificationProvider.tsx](components/NotificationProvider.tsx) thay đổi state khiến parent re-render và **remount** `KTVDashboardContent` (chứ không chỉ re-render).

**Cách điều tra tiếp:**
1. Vào [app/ktv/dashboard/page.tsx](app/ktv/dashboard/page.tsx), thêm `console.log('mount')` trong `useEffect(() => { console.log('mount'); return () => console.log('unmount'); }, [])` bên trong `KTVDashboardContent` → xem mount/unmount có lặp không.
2. Nếu có → tìm parent component gây re-mount (khả năng cao là AppLayout, Suspense boundary, hoặc NotificationProvider).
3. Nếu không mount lặp nhưng effect vẫn re-run → check nguồn đổi deps (log `useEffect(() => {...}, [ktvId])` cùng với log giá trị ktvId).

**Fix triệt để cần:**
- Ổn định `ktvId` bằng `useMemo` nếu user context không stable.
- Nếu là re-mount thật → sửa parent component để không unmount con.

## TRACK A — Verify + fix nốt bug treo giao diện KTV

### 🔴 CẬP NHẬT SAU LIVE DEBUG (03/09/2026)

Chạy dev server local + login T016 + instrument bằng `performance.getEntriesByType('resource')`:
- **Fetch pattern:** burst 4 request `/api/ktv/booking` mỗi 4-6 giây (10+ burst liên tiếp)
- **isFetchingRef guard KHÔNG hoạt động** đầy đủ — vẫn 4 concurrent per burst
- **Visibility events bounce** rất nhanh (7 events/10s trong Chrome preview) — mỗi lần `visible` → `handleVisibilityChange` gọi `fetchBookingRef.current()` KHÔNG debounce
- **Call sites tìm được:** `logic.ts:991` (fetchBooking initial/interval) + `logic.ts:1498` (visibility handler) + có thể `logic.ts:1239` (checkNextOrder không qua guard)
- **UI kẹt spinner "Đang tải dữ liệu ca làm việc..."** vì `[ScreenEngine] Final Check` luôn thấy `currentScreen: DASHBOARD` — `setScreen('TIMER')` bị revert do fetch burst gây race giữa `screenRef.current` và React batched setState

### A0. Verify trước khi code
Reload T016 và inspect:
```js
performance.getEntriesByType('resource').filter(e => e.name.includes('/api/ktv/booking')).length
```
- Nếu tăng >1 mỗi 4-6 giây (burst kích thước >1) → bug chưa fix
- Console: `[ScreenEngine]` phải log `currentScreen: TIMER` sau setScreen chứ không phải DASHBOARD mãi

### A1. Thu hẹp deps của useEffect chính (ưu tiên cao nhất)

**File:** [app/ktv/dashboard/KTVDashboard.logic.ts:1214](app/ktv/dashboard/KTVDashboard.logic.ts:1214)

Hiện tại:
```ts
}, [ktvId, booking?.id, booking?.assignedItemId]);
```

Đổi thành:
```ts
}, [ktvId]);
```

**Tại sao:** Mọi state đọc bên trong `fetchBooking`, realtime handler, và polling interval đều đã dùng ref (`bookingRef.current`, `screenRef.current`, `postServiceBookingIdRef.current`). Không cần deps này.

**Rủi ro:** Filter Realtime channel ở dòng [1110](app/ktv/dashboard/KTVDashboard.logic.ts:1110) đang dùng `booking?.id`:
```ts
filter: booking?.id ? `id=eq.${booking.id}` : undefined
```
Nếu bỏ dep, filter sẽ đóng băng ở lần mount đầu. **Phải sửa cùng lúc**: bỏ filter theo id, thay bằng check trong callback:
```ts
.on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'Bookings',
    // KHÔNG filter theo id → nhận tất cả, filter trong callback
}, (payload: any) => {
    const currentBookingId = bookingRef.current?.id;
    if (!currentBookingId || payload.new?.id !== currentBookingId) return;
    // ... logic cũ
})
```

### A2. Debounce fetch từ realtime

**Vấn đề:** 3 handler realtime ở [1132](app/ktv/dashboard/KTVDashboard.logic.ts:1132), [1179](app/ktv/dashboard/KTVDashboard.logic.ts:1179), [1193](app/ktv/dashboard/KTVDashboard.logic.ts:1193) đều gọi `fetchBooking()`. Khi DB update 3 bảng gần nhau → 3 fetch cùng lúc.

**Fix:** Thêm debounce 300ms cho `fetchBooking` khi gọi từ realtime (không debounce khi gọi từ polling hoặc user action):
```ts
const realtimeFetchTimerRef = useRef<NodeJS.Timeout | null>(null);
const scheduleRealtimeFetch = () => {
    if (realtimeFetchTimerRef.current) clearTimeout(realtimeFetchTimerRef.current);
    realtimeFetchTimerRef.current = setTimeout(() => {
        fetchBooking();
        realtimeFetchTimerRef.current = null;
    }, 300);
};
```
Trong 3 handler realtime, thay `fetchBooking()` bằng `scheduleRealtimeFetch()`. Cleanup timer khi unmount.

### A2.5 (BỔ SUNG SAU LIVE DEBUG) — Debounce visibility/focus handler

**File:** [KTVDashboard.logic.ts](app/ktv/dashboard/KTVDashboard.logic.ts) — effect có `handleVisibilityChange` và `handleFocus` (~line 1488).

**Vấn đề đã xác nhận live:**
- Visibility events có thể bounce visible↔hidden nhanh (7 events/10s trong test)
- Handler gọi `fetchBookingRef.current()` mỗi lần → spam fetch
- Fix bằng closure variable `lastVisibilityFetchMs` KHÔNG hoạt động vì effect deps `[booking, isTimerRunning, ktvId]` → mỗi lần booking đổi, closure re-create, biến reset về 0

**Fix đúng:** dùng `useRef` cho cooldown state:
```ts
// Đặt ngoài effect, cùng chỗ với isFetchingRef
const lastVisibilityFetchMsRef = useRef(0);

// Trong handler:
const handleVisibilityChange = async () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastVisibilityFetchMsRef.current < 5000) {
        recalcTimerFromServer(); // vẫn recalc timer, chỉ skip fetch
        return;
    }
    lastVisibilityFetchMsRef.current = now;
    if (fetchBookingRef.current) await fetchBookingRef.current();
    recalcTimerFromServer();
};
// Áp dụng cùng pattern cho handleFocus
```

### A2.6 (BỔ SUNG) — Guard cho checkNextOrder

**File:** [KTVDashboard.logic.ts:1239](app/ktv/dashboard/KTVDashboard.logic.ts:1239) `checkNextOrder`.

Đang gọi `apiClient.get` trực tiếp, không qua `fetchBooking` → không có guard. Fix: dùng chung `isFetchingRef` guard hoặc riêng `isCheckingNextRef`:
```ts
const isCheckingNextRef = useRef(false);
const checkNextOrder = async () => {
    if (isCheckingNextRef.current) return;
    isCheckingNextRef.current = true;
    try { /* ... */ } finally { isCheckingNextRef.current = false; }
};
```

### A2.7 (BỔ SUNG) — Điều tra 4-caller phenomenon

Sau A2.5 + A2.6, nếu vẫn burst 4 → cần instrument tại chỗ (thêm console.trace vào fetchBooking) để tìm 2 nguồn còn lại. Nghi vấn: `fetchBookingRef.current()` được gọi từ nhiều nơi khác (grep `fetchBookingRef.current` — có ~7 chỗ). Đối chiếu với event timing.

### A3. Hardening apiClient cho các endpoint khác

**Vấn đề:** Lỗi "Failed to fetch" ở fetchWallet ([KTVDashboard.logic.ts:238](app/ktv/dashboard/KTVDashboard.logic.ts:238)), fetchKpi ([:256](app/ktv/dashboard/KTVDashboard.logic.ts:256)), fetchDiscipline ([:261](app/ktv/dashboard/KTVDashboard.logic.ts:261)) khi HMR hoặc network hiccup.

**Fix trong [lib/apiClient.ts:82](lib/apiClient.ts:82)**, thêm nhánh retry cho TypeError network:
```ts
} catch (error: any) {
    lastError = error;
    if (error instanceof ApiError && error.status < 500) throw error;
    if (error.name === 'AbortError') throw new Error('Kết nối bị quá hạn (Timeout). Vui lòng thử lại.');
    // NEW: retry network fail
    const isNetworkFail = error instanceof TypeError && /failed to fetch|network/i.test(error.message);
    if (isNetworkFail && i < retries) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
        continue;
    }
    if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
}
```

Và set `retries: 1` cho các call read-only ở KTVDashboard: wallet, kpi, discipline. Ví dụ:
```ts
apiClient.get<any>(url, { retries: 1 })
```

**Không** set retry cho `fetchBooking` — đã có in-flight guard.

### A4. Deliverables Track A

- 1 commit fix `KTVDashboard.logic.ts` (deps + realtime filter + debounce).
- 1 commit fix `apiClient.ts` (retry network fail) + apply retries:1 cho wallet/kpi/discipline.
- Không đụng plan Loại D trong track này.
- Report lại pattern log sau fix.

---

## TRACK B — Triển khai plan Loại D

**Plan chi tiết:** [plans/plan_sua_dung_don_va_doi_ktv_typeD.md](plans/plan_sua_dung_don_va_doi_ktv_typeD.md).

**Đã chốt 3 câu hỏi cuối plan:**
1. "Kết thúc đơn" khi PAUSED → chuyển đơn về **CLEANING** (không nhảy thẳng FEEDBACK). Phòng đã dùng phải dọn + chụp bàn giao.
2. KTV cũ làm quá ngắn → **tính đúng từng phút**, không áp ngưỡng phạt. Đọc `actualStartTime` và `pauseStart` để tính chính xác.
3. `extraTimeMins` cho KTV mới → **giữ nguyên** trên form Đổi KTV để lễ tân có quyền bù giờ khi khách khiếu nại.

### Đã có sẵn (không cần làm lại)
- **Mục 3 — Công thức lương SWAP KTV:** đã được implement trong `lib/services/BookingItemPauseService.ts` và banner UI ở `PauseSwapKtvModal.tsx` đã ghi nhận chính sách mới. Verify lại 1 lần: đọc `swapKtvOnPausedItem`, đảm bảo KTV cũ nhận `customCommissionDuration = (pauseStart - actualStartTime) / 60000`, KTV mới nhận phần còn lại + extraTimeMins.

### Cần làm

#### B1. Mục 1 — Badge Loại D (P0)

**File:** [app/reception/dispatch/_components/KanbanBoard.tsx:69](app/reception/dispatch/_components/KanbanBoard.tsx:69) (constant `WORK_TYPE_BADGE_KANBAN`).

Bổ sung:
```ts
TYPE_D: { label: 'D', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
```

Verify thêm `lib/constants/staff.constants.ts` (`WORK_TYPE_LABELS`) đã có `TYPE_D` chưa; nếu chưa thì thêm.

Điều kiện `if (!workType || workType === 'TYPE_A') return null;` giữ nguyên → TYPE_D vẫn hiện badge.

**Test:** Card của T016 → badge đổi từ "A" thành "D" (xanh emerald). TYPE_B/C không đổi.

#### B2. Mục 2.1 — Ẩn nút Dọn khi PAUSED (P1, chỉ frontend)

**File:** [app/reception/dispatch/_components/KanbanBoard.tsx:1096](app/reception/dispatch/_components/KanbanBoard.tsx:1096).

Bọc block render nút chính bằng điều kiện:
```ts
const anyPaused = services.some(s => s.status === 'PAUSED');
if (currentCfg.next && !anyPaused) {
    // render nút Dọn như cũ
}
```

**Test:** Đơn IN_PROGRESS → còn nút Dọn. Đơn PAUSED → mất nút Dọn.

#### B3. Mục 2.2 — Nút "Kết thúc đơn" khi PAUSED (P1, frontend + backend)

##### B3.1 Backend — API mới

**Đường dẫn:** `POST /api/ktv/finish-early-paused` (tạo file mới `app/api/ktv/finish-early-paused/route.ts`).

**Payload:** `{ bookingItemId: string, reason?: string }`

**Logic (đọc kỹ plan gốc mục 2.2):**
1. Nạp `BookingItems` theo `bookingItemId`.
2. Tìm sibling merged đang PAUSED cùng KTV — dùng cùng logic gộp với `pauseItem` trong `BookingItemPauseService`.
3. Với mỗi item:
   - Duyệt `segments`. Với segment có `actualStartTime` và **CHƯA có** `actualEndTime`:
     - Set `actualEndTime = item.pauseStart` (thời điểm dừng — **KHÔNG dùng `now()`** vì sẽ cộng thời gian dừng vào lương).
     - Tính `customCommissionDuration = Math.round((actualEndTime - actualStartTime) / 60000)`.
     - Set `note: 'FINISHED_EARLY_ON_PAUSE'`.
4. Update `BookingItems.status = 'COMPLETED'` (hoặc trạng thái tương đương mà flow CLEANING đang dùng — check `RawStatus` enum).
5. Update `subOrder.dispatchStatus = 'CLEANING'` (**theo chốt câu hỏi 1** — về CLEANING, không nhảy FEEDBACK).
6. Gọi `syncTurnsForDate(businessDate)` để cập nhật tua.
7. Trả về `{ success: true, data: { bookingItemId, actualEndTime, minutes } }`.

**Lưu ý ngưỡng phạt:** Không áp — tính đúng từng phút (theo chốt câu hỏi 2).

##### B3.2 Frontend — Nút mới

**File:** [app/reception/dispatch/_components/KanbanBoard.tsx:1131](app/reception/dispatch/_components/KanbanBoard.tsx:1131).

Khi `anyPaused` (từ B2), render 3 nút cùng cấp thay vì block cũ:
- **Tiếp** (xanh) — action resume có sẵn.
- **Đổi** (indigo) — mở `PauseSwapKtvModal` như cũ.
- **Kết thúc đơn** (rose) — mở `ConfirmDialog` mới, nội dung: "Xác nhận kết thúc đơn sớm? KTV sẽ được tính lương theo đúng thời gian đã làm."

`Link` giữ vị trí như cũ (nút riêng bên phải, hoặc xuống dòng nếu chật).

Sau confirm → gọi `POST /api/ktv/finish-early-paused` với `bookingItemId`. On success → reload dispatch board.

##### B3.3 Test cases

- Đơn 60p, KTV làm 20p rồi PAUSED → bấm "Kết thúc đơn" → segment có `actualEndTime = pauseStart`, `customCommissionDuration = 20`.
- Đơn merged 2 dịch vụ cùng 1 KTV, dừng ở phút 15 → cả 2 items đều được chốt về CLEANING với duration đúng.
- KTV cùng phòng khác dịch vụ, chỉ 1 item PAUSED → không đụng item còn lại.

#### B4. Deliverables Track B

- 1 commit Mục 1 (badge D).
- 1 commit Mục 2.1 (ẩn nút Dọn).
- 1 commit Mục 2.2 (API + UI + ConfirmDialog).
- Xoá `test2.ts` cùng lúc.
- Commit `plans/plan_sua_dung_don_va_doi_ktv_typeD.md` để lưu quyết định.

---

## RULES

- Không đụng plan hoặc code Mục 3 (SWAP KTV commission) — đã xong trước đó.
- Không refactor ngoài phạm vi 2 track này. Nếu thấy code smell → note lại ở cuối PR, đừng sửa.
- Trước mỗi commit chạy `npm run build` để đảm bảo TypeScript OK.
- Không thêm comments lý giải WHAT — chỉ thêm khi WHY không rõ.
- Commit message tiếng Việt, prefix `fix:` hoặc `feat:` theo convention nhánh.

## Câu hỏi cần trả lời trước khi merge

1. Sau A1 (bỏ deps + đổi realtime filter), có case nào KTV nhảy giữa 2 đơn mà state cũ chưa clear không? (Realtime channel không còn filter theo booking.id).
2. B3 → khi có sibling merged, có cần đảm bảo cả 2 KTV (nếu shared segment) cùng thấy trạng thái CLEANING đồng bộ qua Realtime không?
