# Plan: `KTVDTurnLedger` — sổ cái tua loại D + dọn hạ tầng kỷ luật / điểm danh

**Ngày lập:** 2026-09-04
**Nhánh:** `feat/bit-lo-hong-phase1`
**Phạm vi:** chỉ KTV `work_type = 'TYPE_D'`. Không đụng A/B/C.

---

## 1. Bối cảnh

Hiện tại tiền tua và giờ tích lũy của loại D được **tính lại độc lập ở 5 nơi**, mỗi nơi một công thức:

| Nơi | Tính gì | Nguồn |
|---|---|---|
| [sync-daily-ledger-type-d/route.ts](app/api/cron/sync-daily-ledger-type-d/route.ts) | tiền + giờ → `KTVDailyLedger`, `KTVServiceHoursLedger` | Bookings |
| [KtvTypeDWalletService.getBalance](lib/services/KtvTypeDWalletService.ts) | số dư ví | Ledger + Bookings |
| [wallet/timeline/route.ts](app/api/ktv/wallet/timeline/route.ts) | dòng thời gian ví | Ledger + Bookings |
| [ktv/history/route.ts](app/api/ktv/history/route.ts) | lịch sử theo đơn con | Bookings |
| [type-d/service-hours/route.ts](app/api/ktv/type-d/service-hours/route.ts) | giờ tích lũy tháng | Bookings (bỏ qua cột `hours_earned`) |

### 1.1. Các điểm lệch đã xác nhận

| # | Lỗi | Bằng chứng |
|---|---|---|
| L1 | **Cron loại D đọc sai key config.** Dùng `ktv_type_d_vip_rate_60m` / `pt_rate_60m` / `combo_rate_60m` / `rating_deductions`. Toàn bộ phần còn lại + UI admin dùng `..._per_60m` và `rating_deduction` (số ít) → **admin đổi giá trong Settings thì cron không đọc được, luôn rơi về default** | [route.ts:41-47](app/api/cron/sync-daily-ledger-type-d/route.ts) vs [KtvTypeDSettingsBlock.tsx](app/admin/settings/system/KtvTypeDSettingsBlock.tsx) |
| L2 | **Nguồn sao khác nhau.** History dùng `itemRating`; cron + wallet dùng `Bookings.rating` | [history/route.ts:342](app/api/ktv/history/route.ts) |
| L3 | ~~**COMBO** lệch 30k/h~~ — **ghi sai, đã kiểm chứng lại**: không mã dịch vụ nào bắt đầu bằng `COMBO` (0/`danh_sach_dich_vu.csv`; "Combo King" là `NHS0800`). Nhánh COMBO trong cron là **code chết**, `rateCombo` chưa bao giờ được áp dụng → **không có lệch**. Đã gỡ ở bước 0 | [route.ts:138](app/api/cron/sync-daily-ledger-type-d/route.ts) |
| L4 | **Giờ tích lũy có 2 định nghĩa.** Cron ghi `hours_earned` bằng `calculateActualMinutes` (giờ **thực**); `service-hours` route bỏ qua cột đó, tự tính bằng `calculateItemDuration` (giờ **gán**) | [KtvTypeDTurnService.ts:22](lib/services/KtvTypeDTurnService.ts) vs [service-hours/route.ts:88](app/api/ktv/type-d/service-hours/route.ts) |
| L5 | **Thuế 10% tính ở 2 tầng.** Ví: `dayComm * 0.1` (tổng ngày). Lịch sử: `Math.round(gross * 0.1)` (từng đơn). `Σ round(đơn) ≠ round(Σ)` → KTV cộng tay lịch sử không ra số trong ví | [history:437](app/api/ktv/history/route.ts) vs [WalletService:59](lib/services/KtvTypeDWalletService.ts) |
| L6 | ✅ **ĐÃ SỬA (bước 1).** `getMonthlyNetHours` trộn 2 hệ ngày: `todayStr` theo cutoff nhưng cửa sổ truy vấn theo nửa đêm lịch. Thực chất cửa sổ cũ hành xử như **cutoff = 7** và phớt lờ config — xem §1.2 | [KtvTypeDTurnService.ts:174](lib/services/KtvTypeDTurnService.ts) |
| L7 | **Cron ledger không dùng cutoff.** Cắt theo `T00:00:00+07:00`→`T23:59:59+07:00` → cũng thành cutoff 7 (§1.2). **Cố tình hoãn** — sửa cùng lúc viết `KTVDTurnLedger` để không xê dịch ranh giới ngày trên dữ liệu đã chốt (xem §7 bước 6) | [route.ts:25](app/api/cron/sync-daily-ledger-type-d/route.ts) |
| L11 | **`Bookings.timeStart` là `timestamp` KHÔNG timezone**, lưu theo giờ UTC — trong khi các cột `timestamptz` thì có offset. Mọi filter dạng `${d}T00:00:00+07:00` đều bị Postgres bỏ qua offset → lệch 1 tiếng ở mọi ranh giới ngày | §1.2 |
| L8 | 🔴 **2 cron chưa bao giờ chạy.** Vercel Cron gọi **GET**; `reset-type-d-hours` và `daily-absence-check` chỉ export `POST` → 405 | xem §6.1 |
| L9 | **Grain sai.** `UNIQUE(staff_id, date, booking_id)` = 1 KTV/1 bill/1 dòng → không lưu được `service_id` từng đơn con | [migration:51](supabase/migrations/20260901000000_add_type_d_support.sql) |
| L10 | **Partial index chặn `ON CONFLICT`** → phải insert từng dòng bắt lỗi 23505 | working diff hiện tại |

### 1.2. ⚠️ Cái bẫy kiểu timestamp — đọc trước khi viết bất kỳ filter theo ngày nào

Hai kiểu cột đang sống chung trong DB và **render khác nhau**:

| Cột | Kiểu | PostgREST trả về |
|---|---|---|
| `KTVServiceHoursLedger.created_at` | `timestamptz` | `"2026-09-03T15:17:58.193365+00:00"` |
| `Bookings.timeStart`, `bookingDate`, `createdAt` | **`timestamp` (naive)** | `"2026-09-04T07:40:00"` — không `Z`, không offset |

Giá trị naive được lưu theo **giờ UTC**. Khi so sánh, Postgres cast chuỗi filter sang `timestamp` và **bỏ qua phần offset**:

```
'2026-09-02T00:00:00+07:00'::timestamp  →  2026-09-02 00:00:00   (offset bị vứt)
                                        →  thực chất là VN 07:00
```

Hệ quả: mọi cửa sổ viết dạng `${d}T00:00:00+07:00` → `${d}T23:59:59+07:00` thực ra là **VN [D 07:00, D+1 06:59]** — tức cutoff 7 cứng, phớt lờ `spa_day_cutoff_hours`. Đây là gốc chung của L6 và L7.

**Cách viết đúng:** dùng `businessDayRange()` trong [lib/business-date.ts](lib/business-date.ts) — nó trả `.toISOString()` nên phần UTC khớp thẳng với dữ liệu lưu, đúng cho cả cột naive-UTC lẫn `timestamptz` thật.

**Kiểm chứng trên dữ liệu thật:** sau khi quy đổi đúng, phân bố giờ VN đạt đỉnh 14h–18h và kéo tới 01h đêm — khớp với thực tế "tua muộn nhất kết thúc khoảng 01:00". Nếu diễn giải sai (coi là VN local) thì phân bố ra đỉnh 07h–11h và chết sau 18h, vô lý với spa.

⚠️ Khi ghi `KTVDTurnLedger.work_date`, phải tính từ `toBusinessDate()` chứ **không** được cắt chuỗi `timeStart.slice(0,10)` — cắt chuỗi sẽ ra ngày UTC, lệch 7 tiếng.

---

## 2. Kiến trúc mục tiêu

### 2.1. Nguyên tắc: 1 công thức — 1 nơi ghi — 1 cửa đọc

```
┌─ TẦNG 1 — GHI (event-driven) ─────────────────────────────────────┐
│                                                                    │
│   recomputeTurnRows(supabase, bookingItemIds[])                    │
│   ── idempotent · tự đọc lại DB · tự upsert                        │
│   ── KHÔNG hook nào được tự tính công thức                         │
│                          │                                         │
│      ┌────────┬──────────┼──────────┬───────────┐                  │
│   KTV bấm   Khách    Admin sửa   Duyệt      Huỷ / đổi              │
│    xong    chấm sao    phút     handover      KTV                  │
│      └────────┴──────────┼──────────┴───────────┘                  │
│                          ▼                                         │
│              ┌──────────────────────┐                              │
│              │   KTVDTurnLedger     │  ◄── NGUỒN SỰ THẬT           │
│              │  1 dòng = KTV × item │                              │
│              └──────────────────────┘                              │
└──────────────────────────┬─────────────────────────────────────────┘
                           │  chỉ SELECT + SUM — KHÔNG công thức
┌─ TẦNG 2 — ĐỌC ───────────┼─────────────────────────────────────────┐
│    ┌─────────┬───────────┼───────────┬──────────────┐              │
│    ▼         ▼           ▼           ▼              ▼              │
│ Lịch sử   Ví tua   Giờ tích lũy   Xếp tua    Báo cáo admin         │
│ list rows  Σ net   Σ actual_min     rank        group by           │
└────────────────────────────────────────────────────────────────────┘

Cron còn đúng 2 việc (KHÔNG còn tính toán):
  · lưới an toàn — quét ngày hôm qua tìm item thiếu dòng → gọi lại tầng 1
  · khoá sổ    — OPEN quá hạn → FINAL/LOCKED
```

**Ràng buộc kỷ luật:** sau khi hoàn tất, không consumer nào được query `Bookings` để tính tiền/giờ loại D. Ai cần số thì gọi `KtvDLedgerReader.getRows()` rồi `reduce`.

### 2.2. `KtvDLedgerEngine` — công thức duy nhất

Hàm **thuần** (pure), không tự query, không ghi DB:

```ts
computeRows(bookings: Booking[], configs: TypeDConfigs): TurnRow[]
```

Nâng từ [history/route.ts:300-460](app/api/ktv/history/route.ts) — chỗ duy nhất hiện tính đủ cả `duration` + `actualDuration` + `commissionBeforeDeduction` + `commission` + `ratingDeductionRate` + thuế + `isProvisional`.

Hai sửa bắt buộc khi nâng lên:
- đổi nguồn sao sang **chuỗi theo khách** (L2, xem §3.3)
- đọc **đúng key config** `..._per_60m` / `rating_deduction` (L1 — đã làm ở bước 0)

Phân nhóm đơn giá chỉ có **2 nhóm**: VIP (`NHP`/`NHT`/`VIP`) và Phổ thông (còn lại). Không có nhóm COMBO — xem L3.

### 2.3. `recomputeTurnRows()` — cửa ghi duy nhất

```ts
recomputeTurnRows(supabase, bookingItemIds: string[]): Promise<void>
```

- Đọc lại items + bookings + guests + services + configs
- Gọi `KtvDLedgerEngine.computeRows()`
- `upsert` theo `UNIQUE(staff_id, booking_item_id)`
- Bỏ qua dòng đã `LOCKED` (ghi dòng điều chỉnh thay vì sửa đè)

Gọi bao nhiêu lần cũng ra cùng kết quả. Backfill và cron lưới an toàn dùng **chính hàm này**.

### 2.4. `KtvDLedgerReader` — cửa đọc duy nhất

```ts
getRows(supabase, staffId, fromDate, toDate): Promise<TurnRow[]>
```

`TurnRow` phải là **cùng một TypeScript type** cho dòng DB và dòng in-memory.

---

## 3. Schema

### 3.1. `KTVDTurnLedger` — nguồn sự thật

Grain: **1 dòng = 1 KTV × 1 BookingItem**. `group_id` để lịch sử gom thành dòng A/B/C lúc đọc.

```sql
CREATE TABLE "KTVDTurnLedger" (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- KHOÁ -------------------------------------------------------
  staff_id           TEXT NOT NULL,
  booking_item_id    TEXT NOT NULL,
  booking_id         TEXT NOT NULL,
  guest_id           TEXT,            -- BookingGuests.id  ← "khách"
  group_id           TEXT NOT NULL,   -- options.mergedIntoId || item.id  ← "đơn con"
  work_date          DATE NOT NULL,   -- business date theo spa_day_cutoff_hours

  -- SNAPSHOT HIỂN THỊ (lịch sử không cần join Bookings/Services)
  bill_code          TEXT,
  bill_suffix        TEXT,            -- '-A' / '-B'
  service_id         TEXT,            -- NHS0800 / NHP0900 / NHT...
  service_name       TEXT,
  rate_category      TEXT,            -- 'VIP' | 'PT'  (xem L3: không có nhóm COMBO)
  booking_time_start TIMESTAMPTZ,

  -- THỜI GIAN --------------------------------------------------
  assigned_minutes   NUMERIC DEFAULT 0,  -- tua gán       (60)
  actual_minutes     NUMERIC DEFAULT 0,  -- làm thực      (55) → GIỜ TÍCH LŨY
  paid_minutes       NUMERIC DEFAULT 0,  -- phút trả tiền (55) → TIỀN TUA
  custom_minutes     NUMERIC,            -- admin can thiệp, NULL nếu không

  -- TIỀN -------------------------------------------------------
  rate_per_60m       NUMERIC NOT NULL,   -- SNAPSHOT đơn giá lúc chốt
  rating_used        INT,
  rating_source      TEXT,               -- 'GUEST_KTV'|'GUEST'|'ITEM_KTV'|'ITEM'|'BOOKING'|'NONE'
  deduction_rate     NUMERIC DEFAULT 0,
  commission_gross   NUMERIC DEFAULT 0,  -- trước trừ sao
  commission_net     NUMERIC DEFAULT 0,  -- sau trừ sao  → VÍ TUA
  tax_amount         NUMERIC DEFAULT 0,  -- thuế TNCN của dòng này (xem §3.4)
  tip                NUMERIC DEFAULT 0,

  -- TRẠNG THÁI -------------------------------------------------
  item_status        TEXT,
  is_provisional     BOOLEAN DEFAULT TRUE,
  entry_status       TEXT DEFAULT 'OPEN',   -- 'OPEN'|'FINAL'|'LOCKED'|'VOID'
  locked_at          TIMESTAMPTZ,

  -- PHỤ TRỢ HIỂN THỊ -------------------------------------------
  handover_status    TEXT,
  handover_comment   TEXT,
  co_workers         TEXT[],

  -- TRUY VẾT ---------------------------------------------------
  source             TEXT,            -- 'EVENT'|'CRON'|'BACKFILL'|'ADMIN_ADJUST'
  computed_at        TIMESTAMPTZ DEFAULT NOW(),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX "uq_ktvd_turn"           ON "KTVDTurnLedger" (staff_id, booking_item_id);
CREATE INDEX        "idx_ktvd_turn_staff_dt" ON "KTVDTurnLedger" (staff_id, work_date);
CREATE INDEX        "idx_ktvd_turn_date"     ON "KTVDTurnLedger" (work_date);
```

**Index toàn phần** → `upsert(onConflict)` chạy được, bỏ được vòng lặp bắt 23505 (L10).

Tách 3 cột phút là chủ ý: `actual_minutes` → **giờ tích lũy**; `paid_minutes` → **tiền**. Đây là chỗ L4 đang lẫn.

Snapshot `rate_per_60m` trả lời "admin đổi giá có tính lại quá khứ không": **không**.

### 3.2. `KTVDPenaltyLedger` — phạt

Phạt không gắn BookingItem nào → không nhét vào bảng trên. Đây chính là lỗi thiết kế của `KTVServiceHoursLedger` hiện tại (trộn 2 loại dòng → sinh 2 partial index).

```sql
CREATE TABLE "KTVDPenaltyLedger" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      TEXT NOT NULL,
  work_date     DATE NOT NULL,
  penalty_type  TEXT NOT NULL,      -- LATE_NO_UPDATE | ORDER_REJECT | ACCOUNT_LOCK | ...
  hours_penalty NUMERIC DEFAULT 0,
  money_penalty NUMERIC DEFAULT 0,
  note          TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX ON "KTVDPenaltyLedger" (staff_id, work_date, penalty_type);
```

Ghi thêm `ACCOUNT_LOCK` (0 giờ) để lịch sử KTV có vết vì sao mất tài khoản — hiện chỉ nằm ở `SecurityAuditLogs`.

### 3.3. Chuỗi ưu tiên sao (chốt: **theo khách**)

```
BookingGuests.ktv_ratings[staff_id]     → rating_source = 'GUEST_KTV'
  → BookingGuests.rating                → 'GUEST'
  → BookingItems.ktvRatings[staff_id]   → 'ITEM_KTV'
  → BookingItems.itemRating             → 'ITEM'
  → Bookings.rating                     → 'BOOKING'
  → 0                                   → 'NONE'
```

`BookingGuests.rating` và `ktv_ratings` được ghi tại [submitFeedbackAction](app/reception/feedback/_components/actions.ts:38).

### 3.4. Thuế 10% — chốt: **theo đơn của khách, KHÔNG làm tròn**

Lưu `tax_amount` ngay trong dòng; mọi nơi `SUM(tax_amount)`.

**Không làm tròn** là mấu chốt. Nhờ đó thuế cộng dồn chính xác ở mọi cấp:

```
thuế(khách) = 0,1 × Σ(tiền từng đơn) = Σ(0,1 × tiền từng đơn) = Σ thuế từng dòng
```

Nên lưu theo dòng hay theo khách đều ra **cùng một số** — đúng nghĩa "thuế theo đơn của khách" mà không cần gộp dòng.

Chính việc làm tròn là thứ đã đẻ ra L5: ví tính `dayComm × 0,1` còn lịch sử tính `round(gross × 0,1)` từng đơn, nên `Σ round(đơn) ≠ round(Σ)`. Bỏ làm tròn thì lệch **không còn khả năng xảy ra** ở bất kỳ cấp cộng dồn nào.

Kiểm chứng trên dữ liệu thật (T016, tháng 9): cộng từng dòng = cộng theo khách = tính trên tổng ngày = 10% tổng tháng = **15.558,1đ**.

**Tiền tua cũng bỏ làm tròn**, cùng một lý do: chỉ cần làm tròn ở một cấp là tổng theo khách, theo ngày, theo tháng sẽ lệch nhau.

```
T016 tháng 9 — tiền tua:  từng dòng = theo khách = theo ngày = 155.579,3542đ
                  thuế:  từng dòng = 10% tổng    = 15.557,9354đ
```

⚠️ `commission_gross`, `commission_net`, `tax_amount` đều có phần lẻ (vd `3.261,9097đ`). Làm tròn ở **tầng giao diện** khi hiện cho KTV và ở **lúc chi tiền thật**, KHÔNG làm tròn khi lưu.

Thuế **thưởng** (bonus) không thuộc bảng này (bonus tính theo khách, không theo item) → xử lý ở tầng ngày cùng `total_bonus`.

### 3.5. Bảng bị bỏ

| Bảng / cron | Xử lý | Lý do |
|---|---|---|
| `KTVServiceHoursLedger` | ngừng ghi → read-only → drop sau backfill | thay bằng 2 bảng mới |
| `KTVMonthlyServiceHours` | **DROP** | chỉ 1 chỗ đọc ([ktv-summary:310](app/api/finance/ktv-summary/route.ts)), và trường `accumulated_hours` trả ra **không màn hình nào dùng**. Query còn sai: đọc tháng **hiện tại**, cron chỉ ghi tháng **trước** → vĩnh viễn `null` |
| cron `reset-type-d-hours` | **XOÁ** | "reset tháng" chỉ là mệnh đề `WHERE work_date BETWEEN` |

---

## 4. Quyết định đã chốt

| Hạng mục | Chốt |
|---|---|
| Bảng chính | `KTVDTurnLedger` + `KTVDPenaltyLedger` |
| Cách ghi | **event-driven** qua `recomputeTurnRows()` |
| Grain | 1 KTV × 1 BookingItem, `UNIQUE(staff_id, booking_item_id)` |
| Sao | theo khách — chuỗi §3.3 |
| `paid_minutes` | `min(thực, gán)`, `customCommissionDuration` ưu tiên cao nhất — **giữ nguyên luật hiện tại** |
| Thuế | tầng dòng, cột `tax_amount` |
| Backfill | từ **2026-09-01** |
| `spa_day_cutoff_hours` | **giữ 6 — KHÔNG đổi** (tua muộn nhất ~01:00, xem §6.2) |
| Khoá sổ `LOCKED` | **cả hai**: auto D+3 từng dòng + "chốt tháng" quét sạch phần còn `OPEN` |
| Mốc giờ tuyệt đối cho D | **không thêm** — chỉ xếp hạng tương đối (xem §9.1) |
| `ACCOUNT_LOCK` | **có ghi** vào `KTVDPenaltyLedger`, `hours_penalty = 0` (dấu mốc, không phải phạt) |
| Cron chốt sổ | dời **06:30 VN** |
| Cửa sổ giờ tích lũy | **tháng lịch**, reset ngày 1 |
| `KTVMonthlyServiceHours` + cron reset | **xoá** |

---

## 5. Quy chế đăng ký / kỷ luật — luật mới

### 5.1. Luật chốt

1. Không đăng ký gì (không OFF, không LÀM) cho ngày D → **khoá tài khoản**.
2. Đã đăng ký LÀM, muốn bỏ → **bắt buộc chuyển sang OFF**, không được huỷ trắng.
3. Chuyển sang OFF **trước 07:00** → **miễn phạt hoàn toàn**.
4. Sau 07:00 → chỉ còn quyền **báo trễ 1 lần**. Không đến → **khoá tài khoản**.
5. Đến trễ hơn giờ đã báo trễ → **−5h** (`LATE_NO_UPDATE`).

### 5.2. Thay đổi cần thực hiện

| # | Việc | File |
|---|---|---|
| R1 | **Bỏ `type: 'CANCEL'`** cho ngày hôm nay + tương lai gần. Thay bằng chuyển `OFF_REGISTERED`. Hiện `CANCEL` **xoá bản ghi** → cron thấy `!registration` → **khoá tài khoản**, trong khi UI không cảnh báo gì | [daily-registration/route.ts:86](app/api/ktv/daily-registration/route.ts), [Schedule.logic.ts:199](app/ktv/schedule/Schedule.logic.ts) |
| R2 | **Gỡ `ABSENT_EARLY_NOTICE` (−5h)** khỏi luồng. Trước 07:00 chuyển OFF đã miễn phí → nút "Báo vắng" tạo ra **hai nút cùng nghĩa, chênh 5 giờ**; chỉ phạt được người bấm nhầm | [attendance-adjustment/route.ts:55](app/api/ktv/attendance-adjustment/route.ts), [daily-absence-check/route.ts:110](app/api/cron/daily-absence-check/route.ts) |
| R3 | `REPORT_ABSENT` → ghi thẳng `OFF_REGISTERED` thay vì `ABSENT_REPORTED`, hoặc bỏ hẳn action | như trên |
| R4 | **Gỡ `ABSENT_NO_NOTICE` (−10h)** — hằng số chết, cron không nhánh nào gọi tới | [staff.constants.ts:65](lib/constants/staff.constants.ts) |
| R5 | Cập nhật nhãn Settings cho khớp luật mới | [KtvTypeDSettingsBlock.tsx:191](app/admin/settings/system/KtvTypeDSettingsBlock.tsx) |
| R6 | Sửa comment sai ở `canEditRegistration` — ghi "khoá 00:00" nhưng code cho tới 06:59 | [vn-time.ts](lib/vn-time.ts) |

### 5.3. Nút "Báo đi muộn" trên trang điểm danh — **mới**

**Backend đã có đủ**, chỉ thiếu UI:
- `attendance-adjustment` action `REPORT_LATE` — [route.ts:72](app/api/ktv/attendance-adjustment/route.ts)
- Guard 1 lần: `if (registration.late_report_count >= 1) → 400`
- Phạt trễ hơn giờ hẹn: [attendance/route.ts:217](app/api/ktv/attendance/route.ts) → `LATE_NO_UPDATE`

**Cần thêm** vào [AttendanceTypeD.tsx](app/ktv/attendance/_components/AttendanceTypeD.tsx):
- Nút "Báo đi muộn" + input giờ hẹn, chỉ hiện khi `status = 'REGISTERED'` và chưa check-in
- Sau khi báo: **ẩn/disable nút**, hiện `late_expected_time` + nhãn "Đã báo trễ — chỉ được 1 lần"
- Sau 07:00 đây là hành động **duy nhất** còn lại (không được đổi giờ, không được chuyển OFF)

### 5.4. Tích "Yêu cầu rút tiền" — chỉ 1 lần/ngày — **mới**

**Hiện trạng:** checkbox nằm trên form `CHECK_IN` ([page.tsx:850](app/ktv/attendance/page.tsx)). Mỗi lần submit có tick → [attendance/route.ts:657](app/api/ktv/attendance/route.ts) **insert 1 dòng `KTVWithdrawals`** `amount = 1`, `status = 'PENDING'`, không có guard nào.

**Rủi ro đúng như mô tả:** tan ca → đăng nhập lại → check-in lại → tick lại → nhiều dòng.

**Hệ quả sâu hơn:** các dòng `amount = 1` này **không bị lọc** trong `KtvTypeDWalletService` — filter chỉ loại `amount === 1 && note.includes('Bảo trì')`, còn note ở đây là `'Báo trước lúc điểm danh (Chưa chốt số tiền)'`. Nên mỗi dòng trùng **trừ thêm 1đ** vào `total_pending` → `net_balance`, và làm rác hàng đợi duyệt của Thu ngân.

**Sửa:**

```sql
ALTER TABLE "KTVWithdrawals" ADD COLUMN IF NOT EXISTS "intent_date" DATE;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_withdrawal_intent_per_day"
  ON "KTVWithdrawals" ("staff_id", "intent_date")
  WHERE "intent_date" IS NOT NULL;
```

- Insert set `intent_date = businessDate(now)`; trùng → bắt `23505` → bỏ qua (an toàn cả khi race)
- UI: nếu hôm nay đã có intent → checkbox **disabled** + nhãn "Đã gửi yêu cầu rút tiền hôm nay"
- Sửa filter trong `KtvTypeDWalletService` + `KtvWalletService` để loại dòng `intent_date IS NOT NULL` khỏi `total_pending` / `total_withdrawn` (nó là **tín hiệu**, không phải số tiền)

---

## 6. Sửa hạ tầng

### 6.1. 🔴 Hai cron chưa bao giờ chạy

Vercel Cron gọi endpoint bằng **GET**:

| Cron | Export | Chạy được? |
|---|---|---|
| `sync-daily-ledger` | GET + POST | ✅ |
| `sync-daily-ledger-type-d` | GET + POST | ✅ |
| `piggy-bank-deduct` | GET + POST | ✅ |
| `cleanup-online` | GET | ✅ |
| `reset-type-d-hours` | chỉ POST | 🔴 405 → **xoá luôn** (§3.5) |
| `daily-absence-check` | chỉ POST | 🔴 405 → **phải bật lại** |

Hệ quả: **toàn bộ kỷ luật loại D chưa bao giờ được áp dụng** — chưa KTV nào bị phạt hay khoá.

⚠️ **Không bật `daily-absence-check` nguyên trạng.** Phải sửa xong §6.3 trước, nếu không đêm đầu tiên có nguy cơ khoá oan hàng loạt.

Nên cân nhắc gửi **thông báo nhắc đăng ký** tối hôm trước trước khi bật luật khoá.

### 6.2. `spa_day_cutoff_hours` — **giữ 6, KHÔNG đổi**

Công thức trong code: `businessDate(t) = date(t − cutoff)` → **cutoff = giờ MỞ ngày mới**, phải nằm **sau** tua muộn nhất trong đêm, có dư biên.

**Thực tế: tua muộn nhất kết thúc khoảng 01:00.**

| cutoff | Tua 01:00 rơi vào | Biên an toàn | |
|---|---|---|---|
| 2 | ngày hôm trước | 1h | ✅ đúng nhưng mỏng — tua chạy quá giờ là lệch |
| 4 | ngày hôm trước | 3h | ✅ |
| **6 (hiện tại)** | ngày hôm trước | **5h** | ✅ |

Cả ba **cho kết quả giống hệt nhau**, vì từ 01:00 đến 06:00 không có hoạt động nào. Đổi config sẽ tốn 1 migration + kiểm tra lại **13 chỗ** đang dùng, đổi lấy đúng con số 0 khác biệt.

→ **Không đụng vào `spa_day_cutoff_hours`.**

Cặp **6 / 07:00** cũng đang khớp gọn: 06:00 mở ngày làm việc → 07:00 chốt danh sách (hở 1 tiếng).

⚠️ Nếu sau này spa kéo dài giờ mở cửa, phải kiểm lại: cutoff **luôn phải > giờ kết thúc tua muộn nhất**. Đây là lý do phương án cutoff = 2 từng cân nhắc bị loại — nó chỉ còn 1h biên.

### 6.3. Giờ chạy cron

Ngày làm việc D đóng lúc **06:00 VN ngày D+1** (cutoff 6). Cả 4 cron đang chốt sổ **trước** khi ngày đóng:

| Cron | Nay (UTC → VN) | Sửa thành | Ghi chú |
|---|---|---|---|
| `sync-daily-ledger` | `0 19` → 02:00 | `30 23` → **06:30** | sớm 4h |
| `sync-daily-ledger-type-d` | `0 19` → 02:00 | `30 23` → **06:30** | sớm 4h |
| `daily-absence-check` | `59 16` → 23:59 | `30 23` → **06:30** | sớm 6h |
| `reset-type-d-hours` | `0 17 1 * *` | — | **xoá** |

⚠️ `daily-absence-check` đang lấy `todayStr = format(nowVn)` ([route.ts:25](app/api/cron/daily-absence-check/route.ts)). Dời sang 06:30 D+1 thì `todayStr` thành **D+1** → phạt rơi sai ngày và không trừ đúng ngày trong sổ giờ. **Phải đổi thành `businessDate(now) − 1 ngày`**, giống cách `sync-daily-ledger` đang làm.

### 6.4. Business date — một hàm dùng chung

Tách `getBusinessDate(supabase, at?: Date)` ra `lib/` dùng chung cho: `work_date` khi ghi ledger, ranh giới đọc, cả 4 cron, `intent_date`. Sửa luôn L6 (cửa sổ truy vấn `getMonthlyNetHours`) — mẫu đúng đã có ở [attendance/status/route.ts:47](app/api/ktv/attendance/status/route.ts).

---

## 7. Lộ trình

| Bước | Việc | Verify |
|---|---|---|
| **0** | Sửa L1 (key config cron). Độc lập, đang gây sai số thật | Đổi giá trong Settings → chạy cron tay → số đổi theo |
| **1** | ✅ **XONG** — `lib/business-date.ts` dùng chung + sửa L6 + tháng/năm xếp hạng theo ngày làm việc. L7 hoãn sang bước 6 (§1.2) | Test mốc biên 01:00/05:59/06:00/00:30 đều pass; cửa sổ về đúng VN [D 06:00, D+1 06:00) |
| **2** | ✅ **XONG** — `lib/services/KtvDLedgerEngine.ts` (thuần) + 52 test + script đối chiếu dữ liệu thật | 52/52 test pass; đối chiếu 01–03/09: 3/39 ô lệch, **giải thích được 100%** (chỉ do L7 + L2) — xem §7.1 |
| **3** | ✅ **XONG** — migration `20260904120000` (2 bảng, RLS siết) + backfill 11 dòng từ 01/09. `intent_date` dời sang bước 7 | Đối chiếu 3/39 ô lệch, giải thích 100% (§7.1). RLS test: anon đọc 0 dòng, ghi bị chặn 42501 |
| **4** | ✅ **XONG** — `lib/services/KtvDLedgerReader.ts`: `getRows` / `getPenalties` + cộng dồn thuần (`sumByStaff`, `netHoursByStaff`, `groupForHistory`) | Trên dữ liệu thật: ví 155.581đ = Σ lịch sử 155.581đ, thuế 15.559đ = 15.559đ → **L5 chết hẳn về mặt cấu trúc** |
| **6** | ⚠️ **ĐẢO LÊN TRƯỚC BƯỚC 5** — cắm 4 hook (§2.3) + cron hạ vai trò xuống lưới an toàn | Chạy 3 đêm song song 2 bảng, so |
| **5** | Chuyển consumer lần lượt: `service-hours` → `history` → `wallet/timeline` → `getBalance` | Mỗi lần chuyển, chụp số cũ/mới đối chiếu |
| **7** | Quy chế §5: R1–R6 + nút báo trễ + tích rút tiền 1 lần | Kịch bản tay: check-in 2 lần → chỉ 1 dòng intent |
| **8** | Dời giờ cron §6.3 + bật `daily-absence-check` (GET) | Chạy thử tay 1 ngày, xem danh sách sẽ khoá **trước** khi bật thật |
| **9** | Drop `KTVServiceHoursLedger`, `KTVMonthlyServiceHours`, cron reset | — |

⚠️ **Bước 6 phải làm TRƯỚC bước 5.** Backfill phủ ngày cũ, cron phủ hôm qua, nhưng **hôm nay** chỉ có hook mới ghi được. Chuyển consumer trước khi cắm hook → KTV mở ví giữa ca thấy 0đ.

**Bước 0 và 8 nên tách PR riêng** — bước 0 sửa lỗi tiền đang chạy, bước 8 động tới tài khoản KTV.

### 7.1. Kết quả đối chiếu engine vs sổ cũ (01–03/09)

Chạy `npx ts-node -O '{"module":"commonjs"}' scripts/audit_ktvd_ledger_engine.ts 2026-09-01 2026-09-03`

| ngày | KTV | sổ cũ | engine | chênh | vì sao |
|---|---|---|---|---|---|
| 01/09 | T016 | 113.048đ | 100.000đ | −13.048đ | **L7** — `WB-001-02092026-A` chuyển sang 02/09 theo ngày làm việc |
| 02/09 | T016 | 25.835đ | 29.097đ | +3.262đ | **L2** — đơn đó khách chấm riêng T016 **1★**, trừ 75%; sổ cũ đọc `Bookings.rating = null` → trả đủ |
| 03/09 | T016 | 24.634đ | 26.484đ | +1.850đ | **L2** ngược lại — `Bookings.rating = 1` (−75%) nhưng sao riêng của T016 là 0 → không trừ |

**3/39 ô lệch, không còn dư lượng nào không giải thích được.** Cả hai chiều đều xuất hiện: có đơn KTV đang được **trả dư** vì sao xấu không được đọc, có đơn KTV đang bị **phạt oan** vì sao của khách khác trong cùng bill.

### 7.2. ⚠️ Phút tiền ≠ phút giờ — đã kiểm chứng, không được gộp

Trong lần chạy đối chiếu đầu tiên, engine lệch thêm ở NH079 (−690đ). Nguyên nhân: engine làm tròn phút, còn công thức tiền đang chạy dùng **phút lẻ**.

| | Nguồn | Phần lẻ | Mốc lỗi (`t2 < t1`) | Chặn trên |
|---|---|---|---|---|
| `paid_minutes` (TIỀN) | `calculateGuestCommission` | **giữ nguyên** | trả **0** | `min(thực, gán)` |
| `actual_minutes` (GIỜ) | `calculateActualMinutes` | **làm tròn** | lùi về **giờ gán** | không chặn |

Ví dụ thật: `009-01092026-C` làm 29,4140 phút → tiền tính theo 29,4140 phút; giờ tích lũy tính 29 phút. Gộp chung là **tự ý đổi lương KTV**.

`computeMinutes()` sao chép trung thành cả hai. Đây chính là lỗi L4 ở dạng tinh vi: không phải "dùng nhầm hàm" mà là "hai hàm vốn khác nhau ở phần lẻ và ở mốc lỗi".

### 7.3. ⚠️ Hai cách hiểu sai về "tua treo" — đã kiểm chứng và bác bỏ

Trong lúc chuẩn bị bước 6 đã dựng một cron "lưới an toàn" cho auto-finish rồi **gỡ bỏ** (commit `8708f23` → revert `8a18f7b`), vì tiền đề sai. Ghi lại để không ai đi lại đường này.

**Nhận định sai 1 — "224 item đang kẹt, đang xảy ra hôm nay".**
Tách theo mốc 01/09 thì khác hẳn:

| Trạng thái | Từ 01/09 | Trước 01/09 |
|---|---|---|
| `FEEDBACK` | 9 | 121 |
| `CLEANING` | 2 | 176 |
| `IN_PROGRESS` | **0** | 43 |
| `WAITING`/`PREPARING` | 0 | 168 |

508 item là rác lịch sử/test từ trước. **Đếm ngược ở client đang chạy đúng** — từ 01/09 không tua nào kẹt ở `IN_PROGRESS`.

**Nhận định sai 2 — "kẹt ở FEEDBACK làm KTV mất tiền".**
Cả 9 item đó đều có **0 segment**: 2 cái là Phòng riêng (tiện ích), 7 cái có mã KTV nhưng chưa từng sinh segment. Engine bỏ qua item không segment, nên chúng **không sinh dòng sổ cái, không ảnh hưởng tiền hay giờ**.

**Bài học:** trước khi kết luận có lỗi vận hành, phải (a) tách theo mốc chế độ có hiệu lực, và (b) kiểm `segments` chứ không chỉ nhìn `status`. Con số tổng gộp cả rác lịch sử sẽ dẫn tới vá nhầm chỗ.

Rủi ro còn lại là thật nhưng chưa xảy ra: auto-finish sống trong `useEffect` ở trình duyệt lễ tân ([KanbanBoard.tsx:234](app/reception/dispatch/_components/KanbanBoard.tsx)). Đóng máy sớm thì không ai đẩy tua. Chỉ xử lý khi nào thực sự phát sinh.

---

## 8. Rủi ro

| # | Rủi ro | Chặn bằng |
|---|---|---|
| RR1 | **Sót hook → dòng sai vĩnh viễn** (giá của event-driven) | (a) cron lưới an toàn quét ngày hôm qua tìm item thiếu dòng / `OPEN` quá 24h; (b) script đối chiếu hằng tuần `KTVDTurnLedger` vs tính lại từ `Bookings` — chính thứ lẽ ra đã bắt được L1 |
| RR2 | **Sao về sau khi đã ghi dòng** → tiền đóng băng ở mức chưa trừ sao | Hook 2 (`submitFeedbackAction`) ghi đè; cron reconcile **3 ngày gần nhất**, chỉ `LOCKED` sau đó |
| RR3 | **Chậm thao tác KTV bấm xong** — `handleFinishService` đã nặng | Gọi `recomputeTurnRows` **sau khi trả response** (không `await`); cron lưới an toàn lo phần thất bại |
| RR4 | **Bật `daily-absence-check` → khoá oan hàng loạt** | Chạy thử tay in ra danh sách sẽ khoá trước; sửa §6.3 trước; gửi thông báo nhắc đăng ký |
| RR5 | **Backfill lệch với ledger cũ** | Bước 3 bắt buộc chốt từng chênh lệch trước khi đi tiếp; giữ `KTVDailyLedger` song song tới bước 9 |
| RR6 | **Reset ngày 1 → mọi người về 0**, thứ tự tua rơi hết về `check_in_order` | Đã biết và chấp nhận (cửa sổ = tháng lịch). Nếu sau này đổi ý → chuyển sang cửa sổ trượt 30 ngày chỉ là đổi mệnh đề `WHERE` |

---

## 9. Các quyết định bổ sung (đã chốt 04/09)

### 9.1. Khoá sổ — dùng **cả hai** cơ chế

Chúng bổ sung nhau, không xung đột:

| Cơ chế | Khi nào | Phạm vi |
|---|---|---|
| Auto `D+3` | cron hằng ngày | từng dòng đã `FINAL` quá 3 ngày → `LOCKED` |
| "Chốt tháng" | admin bấm | quét sạch mọi dòng còn `OPEN` trong tháng → `LOCKED` |

`D+3` lo phần đông đảo; "chốt tháng" quét nốt các dòng kẹt (khách không FB, handover treo) để không sót khi kết sổ.

Sau `LOCKED`: **cấm sửa đè**. Mọi thay đổi ghi dòng mới `source = 'ADMIN_ADJUST'` — ví và lịch sử vẫn `SUM` ra đúng, và có vết truy.

### 9.2. Mốc giờ tuyệt đối — **không có, không thêm**

Loại D không dùng cơ chế milestone như A/B/C. Giờ tích lũy chỉ để **so KTV với nhau** khi sắp thứ tự nhận khách:

```
sort: net_hours DESC → check_in_order ASC → employee_id ASC
```

Xếp hạng tương đối nên chuyện tháng 28/30/31 ngày không gây bất công — ai cũng cùng số ngày.

### 9.3. `ACCOUNT_LOCK` — **có ghi**, dạng dấu mốc

Khi cron khoá tài khoản, hiện xảy ra 3 việc:

| Ghi ở đâu | Ai thấy | Tồn tại tới khi nào |
|---|---|---|
| `Staff.status = 'KHÓA_TÀI_KHOẢN'` | chặn đăng nhập ([auth-server.ts:216](lib/auth-server.ts)) | tới khi unlock |
| `SecurityAuditLogs` | **admin + dev**; KTV cũng thấy `reason` qua `lockInfo` ([attendance/status:84](app/api/ktv/attendance/status/route.ts)) | vĩnh viễn, nhưng chỉ tra được bằng cách lục log |
| Notification `EMERGENCY` | KTV | thấy 1 lần rồi trôi |

Vậy lúc **đang bị khoá** thì KTV biết lý do. Chỗ thiếu là **sau khi đã mở khoá**: `lockInfo` chỉ hiện khi `status = 'KHÓA_TÀI_KHOẢN'`, nên vài tuần sau mở lịch sử ngày-theo-ngày ra thì không còn dấu vết gì ở ngày đó.

**Thêm dòng `KTVDPenaltyLedger` với `hours_penalty = 0`** — dấu mốc, không phải phạt:

```
work_date:     2026-09-12
penalty_type:  'ACCOUNT_LOCK'
hours_penalty: 0
note:          'Khoá tài khoản — không đăng ký lịch và không điểm danh'
```

[api/admin/staff/unlock](app/api/admin/staff/unlock/route.ts) ghi thêm dòng gỡ tương ứng khi mở khoá.

Mục đích là **giữ vết trong lịch sử ngày-theo-ngày sau khi đã mở khoá** — không thay thế `SecurityAuditLogs` (vẫn là nguồn chi tiết cho admin/dev), cũng không thay `lockInfo` (vẫn là thứ KTV thấy lúc đang bị khoá).
