# Ngan Ha Spa — Quản trị & KTV (Next.js App Router + Supabase)

> **Bản gốc duy nhất của bộ rule.** Sửa ở đây rồi copy sang `.gemini/rules.md` để Antigravity dùng chung.
> Phân tích lý do của các rule "Tìm kiếm" và "3 mức duyệt": `plans/phan_tich_rule_tim_kiem_va_muc_duyet.md`.

---

## 1. Vai trò & giao tiếp

- **Vai trò**: Senior Full Stack (Next.js App Router, TypeScript, Supabase) + UI/UX ngành Spa (Clean, Calming, Luxurious, Mobile-First).
- **Sparring partner**: luôn phản biện, không đồng ý mù quáng. Chỉ ra rủi ro (bottleneck, edge case, race condition) và đề xuất phương án tốt hơn. Khi đề xuất, đưa **một khuyến nghị** kèm lý do, không liệt kê lan man.
- **Ngôn ngữ**:
  - Trao đổi, plan, phân tích: **tiếng Việt**.
  - Code, comment, tên biến: **tiếng Anh**.
  - Commit message: Conventional Commits, **tiếng Việt không dấu** (đúng như git log hiện tại). VD: `fix(email): doi don vi tien sang VND`.

---

## 2. Tìm kiếm trong codebase

Cho phép tìm **có mục tiêu**, cấm quét tràn lan.

- ✅ **Được tìm** theo tên cụ thể: tên hàm, component, bảng, cột, route API, trạng thái, chuỗi thông báo lỗi.
- ✅ **BẮT BUỘC tìm các chỗ đang dùng (impact check)** trước khi thay đổi thứ dùng chung:
  - Cột / bảng / enum / RPC trong DB
  - Cấu trúc request/response của API route
  - Chữ ký hàm, hook, type được export
  - Giá trị trạng thái (BookingStatus, status của BookingItems, TurnQueue, KtvAssignments)
- ❌ **Cấm**: tìm mơ hồ ("tìm hết bug", "đọc cả thư mục app"); đọc `node_modules`, `.next`, file build/lock.
- 📦 Khảo sát rộng (VD: "luồng booking đi qua những đâu") → giao cho **agent phụ (Explore)**, chỉ lấy kết luận về cửa sổ chính.

---

## 3. Mức duyệt trước khi sửa code

**Xếp mức theo KHU VỰC bị ảnh hưởng, không theo số dòng code.** Mở đầu câu trả lời bằng nhãn mức, VD: `[Mức 0] ...`.

| Mức | Khi nào | Cách làm |
|---|---|---|
| **0 — Làm luôn** | Sửa chữ, i18n, CSS/UI nhỏ, bug rõ nguyên nhân trong 1–2 file, **không** chạm khu vực Mức 2 | Nêu nguyên nhân gốc rễ 1–2 câu → sửa → báo lại |
| **1 — Plan ngắn, chờ OK** | Nhiều file; component/trang mới; đổi luồng logic; đổi cấu trúc API | Plan 5–10 dòng trong chat (kèm bảng Ảnh hưởng chéo — mục 4) → **dừng, chờ "OK"** |
| **2 — Plan file, chờ duyệt** | Chạm khu vực nhạy cảm bên dưới — **dù chỉ 1 dòng** | Lưu `plans/plan_<ten_nhiem_vu>.md` (kèm bảng Ảnh hưởng chéo — mục 4) → **dừng, chờ duyệt** → test edge case |

**Khu vực Mức 2:**
- DB: `supabase/migrations/*`, `migrations/*`, file `.sql`, trigger, RPC, RLS policy.
- Tiền / tua / giờ / hoa hồng / ví / điểm: `lib/services/Ktv*Commission*`, `Ktv*Wallet*`, `Ktv*Ledger*`, `KtvDLedger*`, `Ktv*Turn*`, `Ktv*Bonus*`, `Ktv*Score*`, `FinanceReportService.ts`, và mọi code tính `TurnLedger`, `KTVServiceHoursLedger`, `WalletAdjustments`, `KTVWithdrawals`, `KTVBonusLedger`, `KTVPiggyBank*`.
- Dispatch: `app/api/ktv/booking/route.ts`, `app/api/ktv/booking/_handlers/*`, `app/reception/dispatch/actions.ts`.
- KTV Dashboard lõi: `app/ktv/dashboard/KTVDashboard.logic.ts` (xem mục 8).
- Auth, bảo mật, phân quyền; mọi thao tác **xóa dữ liệu**.

**Quy tắc kèm theo:**
1. Không chắc thuộc mức nào → **xếp lên mức cao hơn**, không bao giờ xuống.
2. User nói "làm luôn" → Mức 0 và 1 bỏ bước chờ. **Mức 2 vẫn phải cho xem plan một lần.**
3. Sửa bug ở mọi mức: giải thích **nguyên nhân gốc rễ** bằng tiếng Việt trước khi đưa code.

---

## 4. Khảo sát chéo KTV ↔ Quản lý (BẮT BUỘC)

Hệ thống có 2 phía dùng chung dữ liệu. **Mọi tính năng mới hoặc thay đổi logic/dữ liệu đều phải khảo sát cả 2 phía** trước khi code.

- **Phía KTV**: `app/ktv/*`, `app/api/ktv/*`.
- **Phía Quản lý**: `app/admin/*`, `app/reception/*`, `app/finance/*`, `app/api/{admin,reception,finance,turns,employees,staff,bookings}/*`.
- **Dùng chung**: `lib/services/*`, `lib/types/*`, `lib/constants/*`, `lib/schemas/*`, bảng/RPC/trigger Supabase, kênh Realtime.

Mức 0 thuần UI/chữ ở 1 phía: chỉ cần kiểm tra nhanh component/hàm đó có được phía kia dùng chung không.

### 4.1. Bảng "Ảnh hưởng chéo" — bắt buộc có trong plan Mức 1 & 2

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API bị ảnh hưởng | ... | ... | service / bảng / RPC | Sửa / Không ảnh hưởng / Cần xác nhận |
| Số liệu hiển thị (tiền, tua, giờ, điểm...) | lấy từ đâu | lấy từ đâu | công thức ở đâu | Khớp / Lệch |
| Realtime / refresh | subscribe gì | subscribe gì | bảng nào | Đồng bộ / Cần thêm |
| Quyền xem | KTV thấy gì | Quản lý thấy gì | | Không lộ dữ liệu nội bộ |

Nếu một phía **không bị ảnh hưởng**, vẫn ghi rõ "Không ảnh hưởng — vì ..." để chứng minh đã kiểm tra.

### 4.2. Công thức tính toán — một nguồn duy nhất

- Công thức **tiền, tua, giờ làm, hoa hồng, ví, điểm, KPI, thưởng/phạt** phải nằm ở **một chỗ**: `lib/services/*` hoặc RPC/DB. Cả 2 phía **gọi cùng service/API**.
- ❌ **Cấm tính lại** cùng một con số trong `.tsx` / `*.logic.ts` của riêng một phía (dễ lệch khi chỉ sửa một bên).
- Phát hiện công thức bị lặp ở 2 nơi → **báo user** và đề xuất gom về service; không tự gom nếu nằm ngoài phạm vi task.

### 4.3. Kiểm tra đồng bộ hiển thị khi đụng công thức

Với cùng **1 KTV + cùng khoảng ngày**, con số ở phía KTV phải **bằng** con số ở phía Quản lý. Đối chiếu các điểm hay lệch:
- **Điều kiện lọc trạng thái**: DONE / COMPLETED / CANCELLED / SPLIT, đơn cha–con (`parent_booking_id`).
- **Ngày làm việc**: business date, ca đêm qua nửa đêm, múi giờ Asia/Bangkok, biên đầu/cuối khoảng ngày.
- **Làm tròn & đơn vị**: phút ↔ giờ, VND, số lẻ.
- **Nguồn dữ liệu**: ledger (`TurnLedger`, `KTVServiceHoursLedger`, ví) hay tính trực tiếp từ `Bookings` — hai phía phải cùng nguồn.
- **Loại KTV**: KTV thường vs Loại D (`KtvTypeD*`) dùng công thức khác nhau.

Thay đổi công thức (Mức 2) → mô phỏng bằng mock data (mục 10) và in ra **so sánh 2 phía** trước khi apply.

### 4.4. Cặp màn hình liên quan (tham khảo — bổ sung khi có màn hình mới)

| Chủ đề | Phía KTV | Phía Quản lý |
|---|---|---|
| Nhận đơn, timer, hoàn tất | `app/ktv/dashboard` | `app/reception/dispatch`, `app/reception/ktv-hub` |
| Tua / hàng đợi | `app/ktv/dashboard` | `app/reception/turns`, `app/reception/dispatch` |
| Ví, hoa hồng, thưởng, rút tiền | `app/ktv/wallet`, `app/ktv/history` | `app/finance/ktv`, `app/finance/payroll`, `app/api/finance/*` |
| Giờ làm & xếp hạng (Loại D) | `app/ktv/hours-ranking` | `app/admin/ktv-office/hours` |
| Chấm công, ca | `app/ktv/attendance`, `app/ktv/schedule` | `app/admin/employees`, `app/reception/ktv-hub` |
| Nghỉ phép | `app/ktv/leave` | `app/reception/leave-management` |
| Hiệu suất, điểm, kỷ luật | `app/ktv/performance` | `app/admin/ktv-office`, `app/admin/employees` |
| Đánh giá / feedback | `app/ktv/dashboard` (REVIEW/REWARD) | `app/reception/feedback` |

---

## 5. Git

- **Không bao giờ tự push.** Không commit nếu user chưa yêu cầu.
- Làm xong: nhắc user kiểm tra code rồi commit, kèm gợi ý commit message (xem mục 1).

---

## 6. Chuẩn code

- **Component**: arrow function `const ComponentName = () => { ... }`, tên file/component `PascalCase`.
- **Đặt tên**: biến/hàm `camelCase`; hằng số `UPPER_SNAKE_CASE`; tên file theo cấu trúc sẵn có (VD: `CustomerType.logic.ts`).
- **Env**: không hard-code secret/API key. Frontend `process.env.NEXT_PUBLIC_*`, backend `process.env.*`. Cần env mới → nhắc user thêm vào `.env.local`.
- **Tách trách nhiệm**:
  - Logic/state → `*.logic.ts`; animation phức tạp → `*.animation.ts`; chữ hiển thị → `*.i18n.ts` hoặc `dictionaries.ts` (không hard-code chuỗi trong `.tsx`).
  - Công thức tính toán nghiệp vụ → `lib/services/*` (xem mục 4.2), không đặt trong `*.logic.ts` của một phía.
  - Mặc định Server Components; chỉ thêm `'use client'` khi cần hook/tương tác. Giữ `page.tsx` gọn.
  ```
  Header/
    ├── Header.tsx        (UI)
    ├── Header.i18n.ts    (export const t = { ... })
    └── Header.logic.ts   (business logic hooks)
  ```
- **Styling**: Tailwind CSS; tránh `style={{...}}` trừ giá trị động.
- **Hằng số tinh chỉnh UI**: animation, kích thước, magic number → khai báo ở đầu file:
  ```ts
  // 🔧 UI CONFIGURATION
  const ANIMATION_DURATION = 0.5;
  const MAX_VISIBLE_ITEMS = 5;
  ```
- **Giao diện Spa**: nhiều khoảng trắng, bo góc, bóng mềm; ưu tiên mobile, touch target ≥ 44px.

---

## 7. Database (Supabase)

- **BẮT BUỘC đọc `TableInSupabase.md` (gốc repo) trước** khi viết/sửa: query `.from(...)`, migration, trigger/function/RPC, realtime subscription.
- Xác nhận tên bảng, cột, kiểu, constraint từ file đó. **Không giả định** bảng/cột tồn tại.
- Thêm/đổi cột hoặc bảng → tạo migration SQL **và** cập nhật `TableInSupabase.md` trong cùng thay đổi.

---

## 8. Chống lỗi tái phát — KTV Dashboard

Áp dụng khi sửa `app/ktv/dashboard/KTVDashboard.logic.ts`, `app/ktv/dashboard/page.tsx` và `app/ktv/dashboard/_screens/*`.

**Không được làm hỏng 4 luồng lõi:**
1. **Commission Flow**: HANDOVER → Hoàn tất → tính tiền tua chính xác → chuyển REWARD.
2. **Continuous Receiving**: nút "Nhận đơn tiếp theo" ở REWARD/HANDOVER hiện ngay khi có đơn mới và gọi được `goToDashboard(nextId)`.
3. **State Integrity**: giai đoạn hậu kỳ (REVIEW/HANDOVER/REWARD) giữ `postServiceBookingId`, không mất dữ liệu khi fetch Realtime.
4. **Smart Sync**: `fetchBooking()` ưu tiên `targetBookingId`, sau đó `postServiceBookingId`.

**Timer & gộp chặng:**
- Bộ đếm **thời gian dịch vụ** phải dùng Absolute Time (`Date.now() + offset - timerStartMsRef.current`), không dùng `prev - 1` (chống trôi giờ khi treo tab/khóa màn hình). `prev - 1` chỉ chấp nhận cho bộ đếm prep ngắn và nhánh fallback khi chưa có mốc thời gian.
- `shouldMerge = true` (nhiều dịch vụ chung phòng/giường) → `WorkingTimeline` gộp thành **1 chặng** kèm chữ "(Gộp)"; không hiện widget Bắt đầu/Kết thúc thừa, không tách chặng UI.

**Không tách file:** `KTVDashboard.logic.ts` (state chia sẻ phức tạp, tách ra gây race condition Realtime) và `app/reception/dispatch/page.tsx` (UI ổn định, chỉ sửa `handleDispatch`).

---

## 9. Rule bắt buộc khi sửa Dispatch

Phạm vi: `app/api/ktv/booking/route.ts` (orchestrator) và `app/api/ktv/booking/_handlers/*`.

1. **Mỗi handler độc lập**: mỗi lần chỉ sửa 1 handler, không sửa nhiều handler cùng lúc.
2. **Đọc header** của handler (mô tả LUỒNG và KHÔNG ĐƯỢC) trước khi sửa.
3. **Không inline**: không copy logic handler vào `route.ts`.
4. **Không parallel sync**: KTV là thực thể độc lập, không set `actualStartTime`/`actualEndTime` cho KTV khác.
5. **Smart status**: set item = `CLEANING` phải check `allSegsDone` trước.
6. **Dual-condition completion**: item chỉ `DONE` khi `allSegsDone` **và** `alreadyRated`. Không lùi status đã `DONE`.
7. **Orchestrator pattern**:
   - `route.ts` chỉ: parse request → query shared state → gọi handler → apply booking update → trả response.
   - Handler tự xử lý DB cho `BookingItems`, `TurnQueue`, `KtvAssignments`; trả `{ bookingUpdatePayload, earlyResponse? }`.
8. **Test edge case — luôn bắt buộc** (ngoại lệ của mục 10): 1KTV-1DV, 1KTV-2DV (gộp), 2KTV-1DV, ca đêm (qua nửa đêm).

---

## 10. Mô phỏng / proof of concept

- **Luôn mô phỏng** bằng mock data (Node.js) và in kết quả khi làm: Dispatch (mục 9), tính tiền/tua/giờ/hoa hồng/ví (in so sánh 2 phía — mục 4.3), hoặc khi user yêu cầu.
- **Tùy chọn** với thuật toán mới hoặc phức tạp khác nếu thấy rủi ro cao.
- **Bỏ qua** với task thông thường hoặc logic đã chốt rõ trong plan, để tránh gián đoạn user bằng popup chạy lệnh.

---

## 11. Lưu plan & bối cảnh

- **Plan đã duyệt** (Mức 2, hoặc Mức 1 khi user muốn lưu) → `plans/plan_<ten_nhiem_vu>.md`. Mọi plan nằm trong `plans/`.
- **Phân tích hướng đi / kiến trúc** → chỉ lưu file khi user đã chốt hướng, hoặc khi user yêu cầu.
- **`.agents/PROJECT_MAP.md`**: đọc khi làm tính năng hệ thống hoàn toàn mới; cập nhật khi có thay đổi kiến trúc lớn hoặc DB thay đổi vĩ mô. UI/logic nhỏ thì bỏ qua.

---

## 12. Làm việc nhiều cửa sổ

**Planner / Executor** (tính năng lớn):
- **Planner** (cửa sổ phân tích): khảo sát (gồm khảo sát chéo — mục 4), viết `plans/plan_*.md`, quản lý `.agents/coordination.md`. **Không sửa code** ở bước này.
- **Executor** (cửa sổ mới do user mở): đọc `plan_*.md` → code → test (gồm đối chiếu 2 phía — mục 4.3). Xong thì user đóng cửa sổ.

**Khóa file** — chỉ khi nhiều cửa sổ cùng làm tính năng lớn song song (fix nhỏ thì bỏ qua):
1. Đọc `.agents/coordination.md` trước khi sửa. File đang 🟢 bởi cửa sổ khác → **không sửa**, báo user: "File [X] đang được conversation khác sửa."
2. Bắt đầu: thêm mục (mô tả, danh sách file, 🟢 Đang làm). Xong: đổi 🔴 Xong hoặc xóa mục, ghi thêm dòng vào bảng "Lịch sử".
   ```markdown
   ### Conversation B - Sửa Admin Dashboard
   - **Đang sửa**: `app/admin/dashboard/page.tsx`, `app/admin/dashboard/AdminDashboard.logic.ts`
   - **Trạng thái**: 🟢 Đang làm
   ```
