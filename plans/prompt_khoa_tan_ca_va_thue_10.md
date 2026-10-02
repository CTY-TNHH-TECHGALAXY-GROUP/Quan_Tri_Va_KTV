# Prompt — Hạng mục A (Khóa Tan Ca) + Thuế TNCN 10%

> Copy toàn bộ phần dưới gửi cho anti.
> Plan chi tiết: `plans/plan_bo_sung_khoa_tan_ca_va_thue_10.md`. Luật chống xung đột: `plans/prompt_bit_lo_hong_van_hanh_phase1.md` §0 — **vẫn còn hiệu lực nguyên vẹn**.

---

Hạng mục **B và C đã đạt**, tôi kiểm chứng độc lập:

- `SPLIT_GUARD` vá đủ cả 2 nhánh, `KtvAssignments` được đồng bộ đúng `employee_id`+`business_date` ✅
- Test đã đổi sang gọi `PATCH` thật, có assert `handover_images` và assert status Booking ✅
- `npx tsc --noEmit` sạch ✅

**Trước khi làm việc mới, dọn nốt 2 việc treo:**

1. `scripts/test_race_condition_handover.ts:12` hardcode `localhost:3003` nhưng comment dòng 7 ghi `3000`, và `npm run dev` mặc định chạy 3000. Thống nhất 1 cổng hoặc đọc `process.env.TEST_API_URL`.
2. Chạy `npm run test:race`, **dán output**, rồi **commit B và C** (đang treo ở working tree, chưa commit dòng nào).

---

## PHẦN I — HẠNG MỤC A: Khóa nút Tan ca

### Quyết định nghiệp vụ đã chốt (02/09) — không tự đổi

| | |
|---|---|
| Cơ chế | **Toggle bấm tay hoàn toàn. KHÔNG có TTL, KHÔNG tự nhả.** Lễ tân bật, lễ tân tắt |
| Phạm vi | **CHỈ KTV `TYPE_D`.** A/B/C không bị ảnh hưởng dòng nào |
| KTV đã hết giờ ca | **Vẫn khóa** — TYPE_D không có khái niệm ca, chưa báo về là vẫn đang nhận khách |
| Cách chặn ở UI | **ẨN (hide) nút Tan ca**, không phải làm mờ. Kèm dòng: *"Quầy vừa báo có khách. Vui lòng giữ máy."* |
| Thao tác khác | `SUDDEN_OFF`, `OFF_REQUEST` (xin nghỉ/tạm nghỉ) **vẫn cho phép bình thường** |

### ⚠️ Bẫy số 1 — đừng nhét khóa vào `canCheckOut`

`app/ktv/attendance/Attendance.logic.ts:337` có early-return:

```ts
if (activeShiftType === 'FREE' || activeShiftType === 'REQUEST' || ... ) 
    return { canCheckOut: true, checkoutBlockedUntil: null };
```

Nhét khóa vào biến `canCheckOut` là bị early-return này **nuốt mất** — KTV TYPE_D thường rơi vào đúng các loại ca đó. Khóa phải là **điều kiện độc lập**, đứng ngoài toàn bộ logic giờ ca.

### ⚠️ Bẫy số 2 — ẩn UI KHÔNG phải là biện pháp kiểm soát

Phải có **cả hai**: ẩn nút ở UI **và** chặn 403 ở backend. Ẩn mỗi UI thì KTV gọi thẳng API từ điện thoại là tan ca được như thường.

### A1. `[NEW] supabase/migrations/20260902090000_create_guest_arrival_events.sql`

Bảng `GuestArrivalEvents`: `id uuid pk default gen_random_uuid()`, `created_by text`, `created_by_name text`, `created_at timestamptz default now()`, `released_at timestamptz null`, `released_by text null`, `note text`.

Khóa đang hiệu lực ⟺ `released_at IS NULL`. (Không còn `expires_at` vì đã bỏ TTL.)

**Bắt buộc** — chặn bật trùng ở tầng DB:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS "GuestArrivalEvents_single_active"
ON "GuestArrivalEvents" ((released_at IS NULL))
WHERE released_at IS NULL;
```
Không có index này thì lễ tân bấm 2 lần → 2 record ON → tắt 1 cái vẫn còn khóa, KTV kẹt mà không ai hiểu vì sao.

Thêm bảng vào publication realtime — **bọc kiểm tra tồn tại** theo mẫu `supabase/migrations/20260818_create_booking_guests.sql:38-42`.

Seed config `guest_arrival_lock_enabled` = `true` theo mẫu `20260502000000_add_day_cutoff_config.sql`.

### A2. `[NEW] app/api/reception/guest-arrival/route.ts`

- `POST` — `requirePermission('dispatch_board')`. **Idempotent**: đang có khóa mở sẵn thì trả về khóa đó, **không** insert thêm. Gọi `createNotification({ type: 'GUEST_ARRIVAL', ... })` từ `lib/notification-helper.ts`.
- `DELETE` — set `released_at = now()`, `released_by`. **Cho phép cả quyền admin**, không chỉ `dispatch_board` — vì bỏ TTL rồi, nếu lễ tân bật xong về mất thì phải có người tắt hộ.
- `GET` — trả trạng thái + `created_by_name` + `created_at`.

> ⚠️ **Không tự gửi Push trong route này.** `lib/notification-helper.ts:1-12` ghi rõ: chỉ INSERT `StaffNotifications`, Push do DB Webhook lo. Gửi thêm ở đây là KTV nhận đúp 2 lần.

### A3. `[MODIFY] app/api/notifications/trigger-webhook/route.ts`

Thêm nhánh title cho `record.type === 'GUEST_ARRIVAL'`: title `🔔 CÓ KHÁCH`, `requireOnShift: true`. Chỉ đụng phần dựng title trong khối `ktvRoles` (dòng ~113-126).

Kèm đó thêm rule vào `SystemConfigs.notification_rules` qua `PATCH /api/admin/notification-rules`:
`"GUEST_ARRIVAL": { "enabled": true, "allowed_roles": ["KTV","ADMIN","RECEPTION"], "include_target_employee": false, "require_on_shift": true }`

⚠️ `notification_rules` là **MỘT dòng JSON chứa toàn bộ rule hệ thống**. Bắt buộc đọc → merge → ghi lại. Ghi đè cả object là xoá sạch rule của mọi loại thông báo khác.

### A4. `[MODIFY] app/api/ktv/attendance/status/route.ts`

Trả thêm `guestArrivalLock: { active, lockedBy, lockedAt, message }`.

**Lọc TYPE_D ngay tại server**: route này đã đọc `staffRow.work_type` sẵn ở **dòng 81**. Chỉ trả `active: true` khi `workType === 'TYPE_D'` **và** `guest_arrival_lock_enabled = true`. Làm ở server thì UI không phải tự đoán, và A/B/C không bao giờ nhìn thấy cờ này.

⚠️ Route có **8 nhánh `return NextResponse.json`** (dòng 134-185). Thiếu 1 nhánh là UI mất khóa ở đúng trạng thái đó. Grep `incompleteTasksCount` xem nó xuất hiện bao nhiêu chỗ thì thêm đủ bấy nhiêu.

### A5. `[MODIFY] app/api/ktv/attendance/route.ts` — chốt chặn 403

Chèn vào **cuối khối `if (checkType === 'CHECK_OUT' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT')` (dòng 119-153)**, ngay sau đoạn check task chưa nghiệm thu. Dùng lại khuôn mẫu đọc config theo `work_type` đã có ở dòng 131.

- `work_type === 'TYPE_D'` + khóa đang bật → **403**: *"Quầy vừa báo có khách. Vui lòng giữ máy, chưa thể tan ca lúc này."*
- **Không chặn** `checkType === 'SUDDEN_OFF'` và `OFF_REQUEST`.

> ⚠️ File này luồng TYPE_D đang giữ ở **dòng ~488** (phí giặt đồ). Chỉ được chèn trong khối 119-153. Không format lại file, không đổi import order.

### A6. `[MODIFY] app/ktv/attendance/Attendance.logic.ts`

- State `guestArrivalLock`, đọc từ API status (cạnh `incompleteTasksCount`, dòng ~96).
- Subscribe realtime `postgres_changes` `event: '*'` bảng `GuestArrivalEvents` — mẫu có sẵn dòng 186-210, nhớ `supabase.removeChannel` trong cleanup.
- Export `guestArrivalLock` trong return object.
- **Đọc lại Bẫy số 1** — để độc lập, đừng gộp vào `canCheckOut`.

### A7. `[MODIFY] app/ktv/attendance/page.tsx`

**Ẩn** hẳn nút Tan ca (dòng 594-628) khi `guestArrivalLock.active`, thay bằng banner: *"🔔 Quầy vừa báo có khách. Vui lòng giữ máy."* Đặt banner ở vị trí banner `incompleteTasksCount` hiện tại (dòng 580-593).

### A8. `[MODIFY] app/ktv/attendance/_components/AttendanceTypeB.tsx`

Nhận prop `guestArrivalLock`, ẩn nút Check-out tương ứng. Bỏ file này là KTV lách được qua UI Type B.

### A9. `[MODIFY] app/reception/dispatch/page.tsx`

Nút toggle **[🔔 Thông báo có khách]** ở cụm toolbar cạnh nút chuông (khu vực dòng ~1800-1865).

- OFF → bấm để bật (có `confirm` chống bấm nhầm)
- ON → nút đỏ, hiện **`Đang khóa — bật bởi <tên> lúc HH:mm`**, bấm lần 2 để tắt

Dòng "bật bởi ai, lúc nào" là **bắt buộc**, không phải trang trí: bỏ TTL rồi nên ca sau vào không biết vì sao đang khóa thì không ai dám tắt.

> ⚠️ File 3887 dòng, luồng TYPE_D Bước D sắp đụng nhóm dispatch. **Chỉ thêm nút vào toolbar**, không đụng `QuickDispatchTable.tsx`, không sửa logic điều phối.

### Nghiệm thu hạng mục A

- [ ] Lễ tân bật → App KTV **TYPE_D** ẩn nút Tan ca trong ≤3s
- [ ] KTV **TYPE_A/B/C** mở app cùng lúc → nút Tan ca **vẫn bình thường** (dán ảnh 2 tài khoản cạnh nhau)
- [ ] KTV F5 lại app → nút vẫn ẩn (state đến từ API, không chỉ realtime)
- [ ] `curl -X POST /api/ktv/attendance` với `checkType='CHECK_OUT'` cho 1 KTV TYPE_D → **403**, dán response
- [ ] Cùng lúc đó, `checkType='SUDDEN_OFF'` → **vẫn thành công** (không bị chặn nhầm)
- [ ] Lễ tân bấm nút 2 lần liên tiếp → `SELECT count(*) FROM "GuestArrivalEvents" WHERE released_at IS NULL` = **1**, dán kết quả
- [ ] Lễ tân tắt → nút hiện lại ngay
- [ ] `guest_arrival_lock_enabled = false` → bật nút chỉ gửi thông báo, không khóa
- [ ] `notification_rules` sau khi sửa vẫn **đủ** rule cũ + 1 rule mới — dán danh sách key trước/sau

---

## PHẦN II — THUẾ TNCN 10%

Chủ dự án đã chốt: **gộp vào đợt này**. Nhưng plan cũ (`plan_khoa_tan_ca_va_thue_10.md` mục 2) có **3 điểm sai nền tảng**, code theo đó sẽ không chạy. Đọc kỹ trước khi động vào.

### ⛔ Sai 1 — `KTVWalletTransactions` KHÔNG TỒN TẠI

Grep toàn repo (code + migrations) = **0 kết quả**. Không có bảng này, nên cũng không có trường `metadata` để nhét `{taxDeducted, preTaxAmount}`.

Bảng ví có thật: `KTVDailyLedger`, `KTVMonthlyLedger`, `KTVYearlyLedger`, `KTVWithdrawals`, `WalletAdjustments`, `KTVPiggyBank*`, `KTVServiceHoursLedger`, `TurnLedger`.

### ⛔ Sai 2 — không tồn tại "bước chốt tiền cộng vào Ví khi khách review"

Ví TYPE_D **không phải mô hình sự kiện**, mà là **mô hình tính lại** (`lib/services/KtvTypeDWalletService.ts:35-80`):

- Ngày quá khứ → đọc `KTVDailyLedger`
- Từ ngày chốt sổ gần nhất tới nay → **tính trực tiếp từ `Bookings` mỗi lần mở ví**

Nơi duy nhất ghi `KTVDailyLedger` là cron đêm `app/api/cron/sync-daily-ledger/route.ts` — mà cron đó **chưa xử lý TYPE_D dòng nào** (grep `TYPE_D` = 0). **Không có khoảnh khắc cộng tiền để chen thuế vào.**

### ⛔ Sai 3 — thiếu ngày hiệu lực, ví KTV cũ sẽ tụt 10% hồi tố

`getBalance` tính **toàn bộ lịch sử từ `2026-05-04`** (`GLOBAL_START_DATE_STR`, dòng 7). Áp thuế mà không chặn theo ngày thì mọi thu nhập cũ bị trừ hồi tố 10% — số dư tụt ngay lần mở ví kế tiếp, và các khoản đã rút trước đó thành rút quá tay.

### Cách làm đúng

**Tầng áp thuế: TẦNG HIỂN THỊ.** `KTVDailyLedger` vẫn lưu **gross**, trừ 10% ở tầng đọc trong `KtvTypeDWalletService.getBalance`. Lý do: không đổi ý nghĩa cột `total_commission` → không ảnh hưởng báo cáo tài chính đang đọc cột đó (`ktv-summary`, `ktv-bonus-summary`, `ktv-ranking`). Ghi comment ngay đầu service: *"Ledger lưu GROSS, thuế trừ ở tầng đọc — CẤM trừ thuế lần nữa ở cron."*

**Hai config mới** (seed qua migration):
- `ktv_type_d_tax_rate` = `0.1`
- `ktv_type_d_tax_effective_from` = `'2026-09-01'` — chỉ áp thuế cho thu nhập phát sinh từ ngày này. Khuôn mẫu tương tự đã có: `work_type_effective_from` dùng trong `KtvTypeDTurnService.getTurnQueue`.

⚠️ **Không tự thêm ô nhập vào tab Admin "Loại D"** (`app/admin/settings/system/page.tsx`) — file đó là của luồng TYPE_D Phase 5 đang code dở. Chỉ seed key, phần UI báo lại để chủ dự án điều phối.

### Nơi sửa — chính xác theo dòng

`lib/services/KtvTypeDWalletService.ts`:

- **Dòng 178-180**: `total_commission = ledgerSummary.comm + rt_commission`, `total_bonus = ledgerSummary.bonus + rt_bonus` → đây là chỗ áp thuế.
- ⚠️ **Bonus là ví RIÊNG**, không nằm trong `gross_income` (dòng 183 chỉ cộng `total_commission + total_adjustment`; bonus trả ra qua `bonus_wallet_total`). Nên *"(Tua + Bonus) − 10%"* phải hiểu là **trừ 10% trên từng ví riêng**, không phải gộp rồi trừ một lần.
- Thuế phải trừ **trước** khi trừ `total_withdrawn` / `total_pending` (dòng 184), không thì logic rút tiền sai.
- Trả thêm ra ngoài: `tax_rate`, `pre_tax_commission`, `tax_amount_commission`, `pre_tax_bonus`, `tax_amount_bonus` — để UI render mà không phải tự tính lại.

**Hiển thị**: theo v16 §1, chi tiết tiền phải hiện ở **Lịch sử Ví tiền** → `app/api/ktv/wallet/timeline/route.ts` + `app/ktv/wallet/page.tsx`. Màn History (`app/ktv/history/`) lấy dữ liệu từ `API.KTV.HISTORY` là lịch sử **đơn hàng**, không phải dòng tiền — không phải chỗ chính.

> ⚠️ **XUNG ĐỘT**: `app/ktv/wallet/page.tsx` và `app/ktv/history/page.tsx` thuộc **Phase 7 / Bước E của luồng TYPE_D rollout**. `grep -rl TYPE_D app/ktv/` hiện = 0 file, tức luồng kia chưa đụng **nhưng sắp đụng**. Chủ dự án đã chốt luồng này làm trước. **Báo cáo rõ mình đã sửa gì trong 2 file đó** để bàn giao lại cho luồng kia.

### Hai điểm phụ phải xử lý luôn

1. **Màn REWARD sau tua sẽ hiện số lệch.** `app/ktv/dashboard/KTVDashboard.logic.ts:1966-1985` tự tính hoa hồng client-side rồi `setCommission()` hiện cho KTV — số **trước thuế**. Mà v16 §1 ghi: *"Popup xong tua CHỈ báo hoàn thành, không báo số tiền (để bảo mật)"*. → **Tắt hiện tiền sau tua cho TYPE_D**, dùng cờ `ktv_instant_reward_enabled` đã có sẵn (đang xử lý đúng việc này ở dòng 2007). Không sửa số cho khớp, mà là không hiện số.
2. **Quỹ nội bộ tính SAU thuế**, theo thứ tự hiển thị v16 §3: Gross → Thuế 10% → Quỹ nội bộ.

### Nghiệm thu phần thuế

- [ ] Lấy 1 KTV TYPE_D có dữ liệu thật: dán **số dư ví trước và sau** khi áp thuế, kèm phép tính tay chứng minh đúng 10%
- [ ] Chứng minh **không hồi tố**: thu nhập phát sinh **trước** `ktv_type_d_tax_effective_from` không bị trừ đồng nào
- [ ] Ví bonus bị trừ 10% **riêng**, không gộp chung với ví tua
- [ ] KTV **TYPE_A/B/C**: số dư ví **không đổi một đồng** trước/sau khi deploy — dán bảng đối chiếu 3 tài khoản
- [ ] `npm run test:type-d` vẫn xanh
- [ ] Màn REWARD sau tua của TYPE_D không hiện tiền nữa

---

## Commit & báo cáo

Vẫn nhánh `feat/bit-lo-hong-phase1`. Commit tách theo hạng mục, message tiếng Việt **không dấu**, prefix `feat(ops):`:

- `feat(ops): khoa nut tan ca cho TYPE_D khi le tan bao co khach`
- `feat(ops): tru thue TNCN 10% cho vi TYPE_D o tang hien thi`

`git add` liệt kê tường minh từng file. **Cấm `git add -A` / `git add .`** — working tree đang có file rác và file `plans/`, `scripts/` untracked **của luồng khác**.

Báo cáo cuối: nêu rõ đụng file nào, kết quả từng ô nghiệm thu (dán output/SQL thật, fail thì dán nguyên lỗi), và **liệt kê riêng những gì đã sửa trong `app/ktv/wallet/` + `app/ktv/history/`** để bàn giao cho luồng TYPE_D Phase 7.
