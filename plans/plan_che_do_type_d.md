# 🆕 Chế Độ KTV TYPE_D — Bản Kế Hoạch FINAL

> **Trạng thái**: ✅ Kiến trúc + Nghiệp vụ đã chốt — **SẴN SÀNG CODE**
> **Cập nhật**: 2026-08-31 13:17 (đồng bộ lần cuối — sửa xung đột ghi đè)
> **Lịch sử**: 2026-08-27 (bản gốc) → 2026-08-27 23:29 (báo cáo giá) → 2026-08-31 (rà soát kỹ thuật 4 lần) → 2026-08-31 10:07 (chốt nghiệp vụ FINAL) → 2026-08-31 13:17 (đồng bộ xung đột)

> [!IMPORTANT]
> **Công thức giá ĐÃ CHỐT (31/08 lần 2)**: `phút × (rate_giờ / 60)` — PT `100.000đ/giờ`, VIP `180.000đ/giờ`. Không milestones, không làm tròn theo mốc, `Math.round` đến đồng khi ghi sổ. Xem §5.1.
> `phút = min(thời_gian_thực, thời_gian_gán)`. Thang 4★ (không có 5★). Rating theo booking-level.
>
> Các mục có gắn nhãn **[BỔ SUNG]** trong tài liệu là phát hiện từ đợt rà soát 31/08, đã đối chiếu với code thật.

---

## 1. Tổng Quan & So Sánh

| Tiêu chí | Hiện tại (TYPE_A/B/C) | TYPE_D ("D") |
|---|---|---|
| **Tên hiển thị** | Cơ bản / Hợp tác / Nhập tay | **D** |
| **Xếp thứ tự tua** | Theo `turns_completed` (ít tua → ưu tiên) | Theo **tổng thời gian làm tua** (**nhiều giờ → ưu tiên gán trước**). Bận → gán người kế |
| **Reset sổ tua** | Không rõ / thủ công | **Reset cuối mỗi tháng** về 0 giờ |
| **Khung giá tua** | Milestones riêng per-type | **Hệ số theo giờ, chia 60**: VIP = `phút × (180.000/60)`, PT = `phút × (100.000/60)`. `phút = min(thực, gán)`. Không milestones |
| **Khấu trừ theo sao** | Không có (chỉ trừ bonus) | **4★=100%, 3★=75%, 2★=50%, 1★=25%** tiền tua. TYPE_D dùng thang 4★ (TYPE_C dùng 5★) |
| **Bonus** | Shift-based, gộp chung service | **TÁCH RIÊNG**: 20đ/tua flat nếu 4★. Chia đôi nếu 2 KTV cùng TYPE_D. 0đ nếu làm chung KTV khác chế độ |
| **Kỷ luật** | Phạt tiền + Điểm chuyên cần | **Trừ giờ tích lũy** (không phạt tiền) |
| **Giáng chức** | Tự động B→A khi điểm < 80 | **KHÔNG tự động**. Chỉ Admin thủ công + chốt sổ |
| **Lương cứng** | Tùy loại | Không lương cứng, hưởng 100% đơn giá |
| **Menu VIP** | Cờ `is_active_vip_menu` | **CÓ** — dùng cờ giống TYPE_B |
| **Ví tích lũy (Heo đất)** | TYPE_A/B có | **KHÔNG** — TYPE_D không tham gia |
| **Phí giặt đồ** | TYPE_A có (20k/ngày) | **CÓ** — áp dụng cho TYPE_D |
| **Phí bảo trì** | 50k/tháng | **CÓ** — 50k/tháng (cài đặt được) |
| **Quỹ nội bộ** | Không | **CÓ** — 250k/tháng, có toggle bật/tắt (cài đặt được) |
| **Rút tiền** | Bất kỳ lúc nào | Phải đăng ký từ sáng |

> ⚠️ **[BỔ SUNG] Hai ô "cài đặt được" ở bảng trên cần đọc kèm §4.** Phí giặt đồ và phí bảo trì hiện **không** cấu hình được riêng theo loại KTV — code đọc key global bằng `.eq()` cứng. TYPE_D sẽ dùng chung mức 20k/50k với A/B/C, trừ khi chấp nhận sửa code dùng chung (xem §14 câu 14).

---

## 2. Quyết Định Kiến Trúc (ĐÃ DUYỆT ✅)

### 2.1 Hybrid: Dùng chung bảng DB + Service class riêng

- Dùng chung `KTVDailyLedger`, `KTVBonusLedger`, `WalletAdjustments`, `KTVWithdrawals`
- Thêm cột **`work_type_snapshot`** vào mỗi bảng (Temporal Tagging)
- **4 Service class riêng** cho TYPE_D → logic 100% tách biệt, không chạm code cũ

### 2.2 Temporal Tagging — Chống trộn dữ liệu khi chuyển chế độ

Mỗi bút toán ghi nhận `work_type_snapshot` = chế độ KTV **tại thời điểm phát sinh**:

| Query mục đích | Filter |
|---|---|
| Ví TYPE_D | `WHERE staff_id = X AND work_type_snapshot = 'TYPE_D'` |
| Ví TYPE_A | `WHERE staff_id = X AND (work_type_snapshot = 'TYPE_A' OR work_type_snapshot IS NULL)` |
| Dữ liệu cũ (NULL) | Mặc định TYPE_A (backward compat) |

**Khi Admin chuyển chế độ giữa chừng**:
1. Chốt sổ ví cũ (bút toán cũ giữ nguyên `work_type_snapshot`)
2. Bút toán mới ghi snapshot mới
3. **Giờ tích lũy TYPE_D reset về 0 khi chuyển chế độ** (cả chuyển ra lẫn chuyển vào lại — xem §14 câu 12). Bản ghi cũ trong `KTVServiceHoursLedger` vẫn giữ nguyên làm lịch sử, nhưng **không tính vào xếp hạng** nữa
   - Cách làm: query xếp tua ở §2.4 chỉ cộng các bản ghi có `date >= ngày bắt đầu chế độ D hiện tại`, nên cần lưu mốc này (cột `work_type_effective_from` trên `Staff`, hoặc bảng lịch sử chuyển chế độ)
   - Hệ quả: **chặn được kẽ hở** chuyển ra/vào để né phạt hoặc giữ hạng
4. KTV vẫn xem lại lịch sử ví cũ

> [!CAUTION]
> **[BỔ SUNG] Temporal Tagging KHÔNG tự phủ được phần "realtime" của ví.**
>
> `KtvWalletService.getBalance()` ([KtvWalletService.ts](../lib/services/KtvWalletService.ts)) tính số dư theo mô hình **lai**:
> - Phần quá khứ: đọc từ `KTVDailyLedger` → *có* stamp snapshot ✅
> - Phần từ ngày cuối có ledger đến hiện tại: **tính lại trực tiếp từ `Bookings`** bằng `work_type` **HIỆN TẠI** của KTV ❌
>
> Nghĩa là ngay khi Admin bấm chuyển A→D, toàn bộ cửa sổ realtime (thường là hôm nay, có thể vài ngày nếu cron lỗi) bị tính lại theo đơn giá D — kể cả các tua làm khi còn là TYPE_A.
>
> Thêm nữa, `KTVDailyLedger` upsert với `onConflict: 'date, staff_id'` → **mỗi KTV chỉ có 1 dòng/ngày**, nên một ngày chỉ chứa được **một** giá trị `work_type_snapshot`.
>
> **Đề xuất (cần chốt — xem §14 câu 4)**: bắt buộc **việc chuyển chế độ chỉ có hiệu lực từ 00:00 ngày hôm sau**. Admin bấm chuyển → ghi vào hàng đợi `effective_from = ngày mai`, cron `sync-daily-ledger` chốt sổ ngày hiện tại xong mới áp dụng. Cách này giữ nguyên `onConflict` hiện tại và không phải đụng vào nhánh realtime.
>
> Phương án thay thế (nặng hơn): đổi unique key thành `(date, staff_id, work_type_snapshot)` **và** sửa nhánh realtime để chia cửa sổ theo mốc đổi chế độ.

### 2.3 TYPE_D không giáng chức tự động

- Không dùng `KTVDisciplinePoints` (điểm chuyên cần)
- Chỉ Admin thủ công chuyển chế độ + hệ thống chốt sổ
- Cơ chế phạt nặng nhất: Khóa tài khoản khi nghỉ không đăng ký OFF → Phí kích hoạt lại (cài đặt được)

> ⚠️ **[BỔ SUNG] Mâu thuẫn cần làm rõ.** Bản gốc ghi đây là *"cơ chế phạt **duy nhất**"*, nhưng §5.3 lại liệt kê **4 loại phạt trừ giờ**. Hai chỗ này mâu thuẫn nhau.
>
> Thêm nữa, riêng lỗi *"nghỉ không đăng ký OFF"* hiện bị **ba tầng phạt cùng lúc**: (1) trừ 10 giờ tích lũy [§5.3], (2) khóa tài khoản, (3) phí kích hoạt lại 1.000.000đ. Trong đó tầng (1) còn kéo dài ảnh hưởng suốt phần còn lại của tháng qua thứ tự xếp tua.
>
> **Cần chốt**: §2.3 và §5.3 đang nói về **cùng một lỗi hay hai lỗi khác nhau?** Đọc plan hiện tại không phân biệt được. (Xem §14 câu 16)

### 2.4 Bảng `TurnQueue` — Sort DESC (ĐÃ SỬA 31/08)

> [!IMPORTANT]
> **KHÔNG thêm cột `accumulated_service_hours` vào TurnQueue.** (Bỏ PHASE B migration)
>
> Lý do: TurnQueue có `UNIQUE(employee_id, date)` — mỗi sáng tạo dòng mới với DEFAULT 0.
> Nếu lưu giờ tích lũy trên đây, mỗi sáng KTV TYPE_D đều reset về 0, sort DESC vô nghĩa.
> Phải sync ở 3 nơi (attendance, booking done, sửa đơn cũ) — thiếu 1 chỗ = sai thứ tự.

**Giải pháp đã chốt: JOIN lúc đọc**

```
getTurnOrder() cho TYPE_D:
  SELECT tq.*, COALESCE(SUM(shl.hours_earned - shl.hours_penalty), 0) AS monthly_hours
  FROM "TurnQueue" tq
  LEFT JOIN "KTVServiceHoursLedger" shl
    ON tq.employee_id = shl.staff_id
    AND EXTRACT(MONTH FROM shl.date) = EXTRACT(MONTH FROM CURRENT_DATE)
    AND EXTRACT(YEAR FROM shl.date) = EXTRACT(YEAR FROM CURRENT_DATE)
  JOIN "Staff" s ON tq.employee_id = s.id
  WHERE tq.date = CURRENT_DATE
    AND s.work_type = 'TYPE_D'
  GROUP BY tq.id
  ORDER BY monthly_hours DESC, tq.check_in_order ASC
```

- **Luôn đúng real-time** — không cần sync
- **Miễn nhiễm R3** (sửa đơn cũ → ledger tự cập nhật → sort tự đúng)
- **Cost**: 1 aggregate query / ~145 rows — không đáng kể
- TYPE_A/B/C vẫn sort theo `turns_completed` ASC như cũ (không ảnh hưởng)
- Nếu KTV đang bận (`status = 'working'`) → gán người kế tiếp
- Nếu giờ bằng nhau → xét `check_in_order`

---

## 3. Database Migration

### [NEW] `supabase/migrations/20260831000000_add_type_d_support.sql`

> ⚠️ **Đặt đúng thư mục**: migration đang được apply thật nằm ở `supabase/migrations/` (mới nhất `20260830_add_dispatch_booking_guard.sql`). Thư mục `migrations/` ở gốc là folder cũ, dừng ở 20260801 — đặt vào đó sẽ **không được chạy**.

```sql
-- ================================================
-- PHASE 0: MỞ CHECK CONSTRAINT work_type  ⚠️ BẮT BUỘC — LÀM ĐẦU TIÊN
-- ================================================
-- Lý do: supabase/migrations/20260722000001_add_work_type_to_staff.sql đã khoá cứng
--   CHECK (work_type IN ('TYPE_A','TYPE_B','TYPE_C'))
-- ở tầng DATABASE. Nếu không mở, mọi lệnh ghi work_type = 'TYPE_D' đều bị Postgres
-- từ chối với lỗi:
--   new row for relation "Staff" violates check constraint "check_work_type"
-- → Phase 0 (seed 11 tài khoản test T001–T079) fail ngay dòng đầu tiên,
--   dù code TypeScript đã sửa đủ.
-- Postgres không cho sửa CHECK tại chỗ → phải DROP rồi ADD lại.

ALTER TABLE "Staff" DROP CONSTRAINT IF EXISTS check_work_type;
ALTER TABLE "Staff" ADD CONSTRAINT check_work_type
  CHECK (work_type IN ('TYPE_A', 'TYPE_B', 'TYPE_C', 'TYPE_D'));

-- ================================================
-- PHASE A: TEMPORAL TAGGING (4 bảng ledger)
-- ================================================
ALTER TABLE "KTVDailyLedger"    ADD COLUMN IF NOT EXISTS "work_type_snapshot" TEXT DEFAULT NULL;
ALTER TABLE "KTVBonusLedger"    ADD COLUMN IF NOT EXISTS "work_type_snapshot" TEXT DEFAULT NULL;
ALTER TABLE "WalletAdjustments" ADD COLUMN IF NOT EXISTS "work_type_snapshot" TEXT DEFAULT NULL;
ALTER TABLE "KTVWithdrawals"    ADD COLUMN IF NOT EXISTS "work_type_snapshot" TEXT DEFAULT NULL;

-- ================================================
-- PHASE B: ĐÃ BỎ — không thêm cột vào TurnQueue
-- Lý do: dùng JOIN sang KTVServiceHoursLedger lúc đọc (xem §2.4)
-- ================================================

-- ================================================
-- PHASE C: RATING DEDUCTION
-- ================================================
ALTER TABLE "KTVDailyLedger"
  ADD COLUMN IF NOT EXISTS "rating_deduction" NUMERIC DEFAULT 0;

-- ================================================
-- PHASE D: Sổ kỷ luật giờ tích lũy TYPE_D
-- ================================================
CREATE TABLE IF NOT EXISTS "KTVServiceHoursLedger" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "hours_earned" NUMERIC DEFAULT 0,
  "hours_penalty" NUMERIC DEFAULT 0,
  "penalty_type" TEXT,
  "booking_id" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_svc_hours_ledger_unique" 
  ON "KTVServiceHoursLedger" ("staff_id", "date", "booking_id") 
  WHERE "booking_id" IS NOT NULL;

-- Idempotency cho dòng PHẠT: các dòng phạt có booking_id = NULL nên KHÔNG rơi vào
-- index bên trên → gọi deductHours() 2 lần sẽ trừ giờ 2 lần. Cần index riêng.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_svc_hours_ledger_penalty_unique"
  ON "KTVServiceHoursLedger" ("staff_id", "date", "penalty_type")
  WHERE "booking_id" IS NULL AND "penalty_type" IS NOT NULL;

-- ================================================
-- PHASE E: Tổng giờ tích lũy TYPE_D theo tháng
-- ================================================
CREATE TABLE IF NOT EXISTS "KTVMonthlyServiceHours" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id" TEXT NOT NULL,
  "month" INT NOT NULL,
  "year" INT NOT NULL,
  "total_hours_earned" NUMERIC DEFAULT 0,
  "total_hours_penalty" NUMERIC DEFAULT 0,
  "net_hours" NUMERIC DEFAULT 0,
  "synced_at" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("staff_id", "month", "year")
);

-- ================================================
-- PHASE F: MỐC BẮT ĐẦU CHẾ ĐỘ  ⚠️ [BỔ SUNG 31/08]
-- ================================================
-- Bắt buộc để thực hiện §14 câu 12: "chuyển chế độ → giờ tích lũy reset về 0".
-- Không có cột này thì query §2.4 sẽ cộng cả giờ KTV làm ở chế độ trước đó
-- → kẽ hở chuyển ra/vào để giữ hạng vẫn còn nguyên.
ALTER TABLE "Staff"
  ADD COLUMN IF NOT EXISTS "work_type_effective_from" DATE DEFAULT NULL;

-- Backfill cho dữ liệu cũ: coi như đã ở chế độ hiện tại từ rất lâu
UPDATE "Staff" SET "work_type_effective_from" = '2020-01-01'
  WHERE "work_type_effective_from" IS NULL;
```

> **Cách dùng `work_type_effective_from`:**
> - Admin đổi `work_type` → set luôn cột này = ngày áp dụng.
> - Query xếp tua §2.4 thêm điều kiện: `AND shl.date >= s.work_type_effective_from`.
> - Nhờ vậy giờ tích lũy của chế độ cũ **không được cộng** vào xếp hạng, nhưng bản ghi vẫn còn nguyên trong `KTVServiceHoursLedger` để tra lịch sử.
> - Với đợt áp dụng đầu tiên: set `work_type_effective_from = '2026-09-01'` cho toàn bộ KTV chuyển sang TYPE_D.

---

## 4. Constants & Types

### [MODIFY] `staff.types.ts`
```diff
-export type WorkType = 'TYPE_A' | 'TYPE_B' | 'TYPE_C';
+export type WorkType = 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';

+export interface FeatureFlagsTypeD {
+    // ⚠️ TÊN CỜ PHẢI KHỚP FEATURE_FLAG_DEFS — xem cảnh báo bên dưới
+    laundry_deduction: boolean;        // Trừ phí giặt đồ khi điểm danh
+    sudden_leave_penalty: boolean;     // TYPE_D = false (phạt bằng GIỜ, không phạt tiền)
+    allow_on_call: boolean;
+    enable_employee_tasks: boolean;
+    bonus_wallet: boolean;             // Ví Bonus
+    savings_wallet: boolean;           // TYPE_D = false (KHÔNG có Heo đất)
+    maintenance_fee: boolean;          // Trừ phí bảo trì hàng tháng
+    // Cờ MỚI riêng cho TYPE_D:
+    internal_fund_enabled: boolean;    // Quỹ nội bộ 250k — toggle bật/tắt
+    withdraw_morning_only: boolean;    // Chỉ cho đăng ký rút tiền buổi sáng
+    [key: string]: any;
+}
```

> [!CAUTION]
> **[BỔ SUNG] Bản gốc đặt SAI tên cờ — sẽ không có tác dụng gì.** Tên cờ phải khớp chính xác `FEATURE_FLAG_DEFS` trong [KtvFeatures.logic.ts:6](../app/admin/settings/system/KtvFeatures.logic.ts#L6), vì đây là danh sách mà cả Admin UI lẫn các route đọc/ghi.
>
> | Bản gốc ghi (SAI) | Tên thật trong code | Nơi code đọc |
> |---|---|---|
> | `laundry_fee_enabled` | **`laundry_deduction`** | `attendance/route.ts:447` |
> | `bonus_enabled` | **`bonus_wallet`** | Admin UI + ví bonus |
> | *(thiếu)* | **`maintenance_fee`** | `KtvLedgerSyncService.ts:190` |
> | *(thiếu)* | **`savings_wallet`** | Phải đặt `false` — đây mới là cách loại TYPE_D khỏi Heo đất |
> | *(thiếu)* | **`sudden_leave_penalty`** | Phải đặt `false` — TYPE_D phạt bằng giờ, không phạt tiền |
> | `vip_menu_enabled` | ❌ **không tồn tại trong FEATURE_FLAG_DEFS** | VIP menu dùng cột riêng `Staff.is_active_vip_menu`, không phải feature flag |
>
> Cờ đặt sai tên sẽ được ghi vào `feature_flags` jsonb mà **không báo lỗi**, nhưng không có đoạn code nào đọc → tính năng im lặng không hoạt động. Rất khó debug.
>
> Đồng thời phải thêm nhánh `case 'TYPE_D'` vào `getDefaultFlagsForType()` ([KtvFeatures.logic.ts:58](../app/admin/settings/system/KtvFeatures.logic.ts#L58)) — hiện `default:` trả về `{}` rỗng.

### [MODIFY] `staff.constants.ts`
```diff
 export const WORK_TYPE_LABELS = {
     TYPE_A: 'Cơ bản',
     TYPE_B: 'Hợp tác',
-    TYPE_C: 'Nhập tay'
+    TYPE_C: 'Nhập tay',
+    TYPE_D: 'D'
 };

+export const DEFAULT_FEATURE_FLAGS_TYPE_D: FeatureFlagsTypeD = {
+    laundry_deduction: true,        // CÓ trừ giặt đồ
+    sudden_leave_penalty: false,    // KHÔNG phạt tiền — phạt bằng giờ
+    allow_on_call: false,
+    enable_employee_tasks: false,
+    bonus_wallet: true,             // CÓ ví bonus (tách riêng)
+    savings_wallet: false,          // KHÔNG có Heo đất
+    maintenance_fee: true,          // CÓ phí bảo trì
+    internal_fund_enabled: true,    // CÓ quỹ nội bộ
+    withdraw_morning_only: true     // Chỉ rút buổi sáng
+};

+// TYPE_D Discipline: Penalty hours (cài đặt được trên Admin)
+export const TYPE_D_DISCIPLINE_PENALTIES = {
+    ABSENT_NO_NOTICE: 10,
+    ABSENT_EARLY_NOTICE: 5,
+    LATE_NO_UPDATE: 5,
+    ORDER_REJECT_MULTIPLIER: 3
+} as const;

+// TYPE_D Commission: Rating-based deduction — THANG 4★ (cài đặt được trên Admin)
+export const TYPE_D_RATING_DEDUCTION = {
+    4: 0,     // 4★: 100%
+    3: 0.25,  // 3★: 75%
+    2: 0.50,  // 2★: 50%
+    1: 0.75,  // 1★: 25%
+    0: 0      // Chưa đánh giá: tạm tính 100%
+} as const;

+// TYPE_D Bonus: Flat points (cài đặt được trên Admin)
+export const TYPE_D_BONUS = {
+    BASE_POINTS: 20      // 20đ/tua nếu rating >= 4★ (gồm cả 5★)
+} as const;
```

> [!CAUTION]
> **TYPE_D dùng thang 4★, nhưng CỘT DB vẫn cho phép 5 → BẮT BUỘC có fallback.**
>
> §14 câu 1 đã chốt TYPE_D chỉ dùng thang 4 sao. Tuy nhiên `Bookings.rating` là numeric 1–5 và `BookingItems.ktvRatings` là jsonb tự do — **cùng cột dùng chung với TYPE_C (thang 5★)**. Nghĩa là giá trị `5` **vẫn có thể lọt vào** một đơn của KTV TYPE_D qua: dữ liệu cũ, Admin nhập nhầm, hoặc form đánh giá dùng chung.
>
> Nếu điều đó xảy ra mà bảng chỉ có 4/3/2/1/0 thì `deduction[5]` = `undefined` → `basePay × (1 - undefined)` = **`NaN`** ghi thẳng vào ví KTV.
>
> **Bắt buộc khi code:** `const d = table[rating] ?? 0;` — mọi giá trị ngoài thang (5, 6, null, chuỗi rỗng) đều rơi về 0% khấu trừ. Không được để `undefined` lọt vào phép nhân. Đây là hàng rào an toàn, không phải mở rộng thang sao.

### SystemConfigs Keys mới cho TYPE_D:

| Key | Default | Mô tả | Cài đặt được |
|---|---|---|---|
| `ktv_type_d_vip_rate_per_60m` | `180000` | Rate VIP (đ/**giờ**) — chia 60 khi tính | ✅ |
| `ktv_type_d_pt_rate_per_60m` | `100000` | Rate Phổ thông (đ/**giờ**) — chia 60 khi tính | ✅ |
| ~~`ktv_type_d_vip_rate_per_min`~~ | ~~3000~~ | ⛔ **ĐÃ BỎ** — phải XOÁ khỏi SystemConfigs | ❌ |
| ~~`ktv_type_d_pt_rate_per_min`~~ | ~~1667~~ | ⛔ **ĐÃ BỎ** — phải XOÁ khỏi SystemConfigs | ❌ |
| `ktv_deposit_amount_TYPE_D` | `1000000` | Tiền cọc ví (= bằng A/B) | ✅ |
| `enable_ktv_bonus_TYPE_D` | `true` | Bật/tắt bonus | ✅ Toggle |
| `ktv_type_d_bonus_points` | `20` | Điểm bonus mỗi tua rating **≥ 4★** | ✅ |
| `ktv_type_d_rating_deduction` | `{4:0, 3:0.25, 2:0.5, 1:0.75, 0:0}` | Bảng khấu trừ (thang 4★) | ✅ |
| `ktv_bonus_rate_TYPE_D` | `1000` | Quy đổi 1 điểm bonus → VNĐ. Khớp convention hiện có | ✅ |
| `ktv_type_d_discipline_rules` | `{ABSENT_NO_NOTICE:10,...}` | Mức trừ giờ kỷ luật | ✅ |
| `ktv_type_d_internal_fund` | `250000` | Quỹ nội bộ/tháng | ✅ |
| `ktv_type_d_internal_fund_enabled` | `true` | Toggle quỹ nội bộ | ✅ Toggle |
| `ktv_type_d_reactivation_fee` | `1000000` | Phí kích hoạt lại | ✅ |
| ~~`laundry_fee_TYPE_D`~~ | — | ⚠️ **KEY NÀY KHÔNG TỒN TẠI** — xem cảnh báo bên dưới | ❌ |
| ~~`maintenance_fee_TYPE_D`~~ | — | ⚠️ **KEY NÀY KHÔNG TỒN TẠI** — xem cảnh báo bên dưới | ❌ |

> **Quy ước key `_TYPE_D` chỉ chạy được cho MỘT NHÓM key.** `KtvCommissionService.getCommissionConfig()` sinh key theo `typeSuffix = '_TYPE_' + workType.replace('TYPE_','')` ([KtvCommissionService.ts:37](../lib/services/KtvCommissionService.ts#L37)), nên `ktv_deposit_amount_TYPE_D`, `enable_ktv_bonus_TYPE_D`, `ktv_shift_*_bonus_TYPE_D`, `ktv_bonus_rate_TYPE_D` chạy được ngay, **không cần sửa gì**.

> [!CAUTION]
> **[BỔ SUNG] Phí giặt đồ & phí bảo trì KHÔNG theo quy ước `_TYPE_x`.** Bản gốc giả định sai. Đã kiểm tra cả code lẫn DB production:
>
> | Khoản | Bản gốc ghi (SAI) | Cơ chế THẬT |
> |---|---|---|
> | Giặt đồ | `laundry_fee_TYPE_D` | Số tiền: key **global `laundry_fee`** (= 20.000), đọc bằng `.eq('key','laundry_fee')` **cứng** tại [attendance/route.ts:452](../app/api/ktv/attendance/route.ts#L452). Bật/tắt: **feature flag `laundry_deduction`** trên từng Staff. **Không có bản per-type nào trong DB.** |
> | Bảo trì | `maintenance_fee_TYPE_D` | Số tiền: key global **`maintenance_fee_amount`** (= 50.000). Bật/tắt: `enable_maintenance_fee` (global) + feature flag `maintenance_fee` trên Staff. Đọc bằng `.eq()` cứng tại [KtvLedgerSyncService.ts:136-156](../lib/services/KtvLedgerSyncService.ts#L136) |
>
> **Hệ quả**: nếu chỉ insert key `laundry_fee_TYPE_D` / `maintenance_fee_TYPE_D` như bản gốc, chúng sẽ nằm chết trong DB và **không đoạn code nào đọc tới**. TYPE_D sẽ dùng chung mức phí global với A/B/C.
>
> **Chọn 1 trong 2 hướng:** ✅ **ĐÃ CHỐT: Hướng (b) — RIÊNG**
> - ~~**(a) Đơn giản**: TYPE_D dùng chung mức phí global~~
> - **(b) TYPE_D có mức phí RIÊNG** ✅: phải sửa 2 chỗ đọc `.eq()` cứng thành resolve theo `typeSuffix` giống `getCommissionConfig()`. Đây là **sửa code dùng chung cho cả A/B/C** → rủi ro hồi quy, phải test lại phí của các loại cũ.
>
> Ghi chú thêm: DB có sẵn `enable_maintenance_fee_TYPE_A/B/C` và `maintenance_fee_deduct_deposit_TYPE_A`, nhưng `KtvLedgerSyncService` chỉ đọc bản **global**. Đây là điểm không nhất quán **có sẵn từ trước**, không phải do TYPE_D — nhưng nên biết để không đi theo vết cũ.

> **Đối chiếu giá trị DB production (31/08)**: `ktv_deposit_amount` = **1.000.000** (TYPE_A/B = 1tr, TYPE_C = 0). ✅ **ĐÃ CHỐT**: TYPE_D = **1.000.000** (bằng A/B).

> **[NEW] Bước seed config còn thiếu.** Plan mới chỉ *liệt kê* key, chưa có bước ghi giá trị mặc định xuống `SystemConfigs`. Nếu không seed, mọi hàm `getConfig()` sẽ rơi về fallback và Admin UI hiện ô trống. Cần thêm script `scripts/insert_type_d_configs.js` (theo mẫu `scripts/insert_maintenance_fee_configs.js` đã có).

---

## 5. Core Service Classes — 4 FILES MỚI (LOGIC ĐỘC LẬP)

### 5.1 [NEW] `KtvTypeDCommissionService.ts` — Tiền tua

> **Hệ số theo GIỜ, chia 60 khi tính**. KHÔNG dùng milestones. Có khấu trừ theo đánh giá sao.
> **KHÔNG làm tròn theo mốc.** Thang **4★** (không có 5★).

> [!IMPORTANT]
> **ĐÃ CHỐT LẠI 31/08 (lần 2)**: lưu rate theo **giờ** rồi chia 60, **không** lưu rate theo phút.
>
> Lý do: `1667 đ/phút × 60 = 100.020đ/giờ` — lệch +20đ/giờ so với mức "100k/60p" trong quy chế, và làm mọi số tiền phổ thông lẻ đến hàng chục (75.015đ, 150.030đ). Lưu `100000` rồi chia 60 thì 60 phút ra **đúng 100.000đ**.
>
> Bản chất vẫn là Cách B — nhân theo phút, không milestones, không làm tròn theo mốc. Chỉ đổi **cách biểu diễn rate** để hết sai số.

```
Công thức chốt (FINAL 31/08 lần 2):
┌──────────────────────────────────────────────────────────────┐
│ VIP_RATE_PER_60M = 180,000 đ/giờ   (cài đặt được)           │
│ PT_RATE_PER_60M  = 100,000 đ/giờ   (cài đặt được)           │
│                                                               │
│ phút    = min(thời_gian_thực, thời_gian_gán)                 │
│ basePay = phút × (RATE_PER_60M / 60)                         │
│ finalPay = basePay × (1 - deduction[rating])                 │
│                                                               │
│ VD: 90p VIP 4★ = 90 × (180000/60)        = 270,000đ         │
│ VD: 60p PT  4★ = 60 × (100000/60)        = 100,000đ  ← tròn │
│ VD: 60p PT  3★ = 60 × (100000/60) × 0.75 =  75,000đ         │
│ VD: 50p PT  4★ = 50 × (100000/60)        =  83,333.33đ      │
└──────────────────────────────────────────────────────────────┘
```

> ⚠️ **Số thập phân**: phép chia 60 sinh số lẻ ở các mốc phút không chia hết (50p → `83333.33333333334`). **Không được ghi nguyên giá trị dấu phẩy động vào ví KTV.** Làm tròn đến đơn vị đồng (`Math.round`) tại lớp ghi sổ. "Không làm tròn" trong quy chế nghĩa là không làm tròn theo mốc/milestone, không phải giữ 14 chữ số thập phân.

```
Flow tính tiền tua TYPE_D:
1. Đọc rate từ SystemConfigs:
   - `ktv_type_d_vip_rate_per_60m` (default 180000)
   - `ktv_type_d_pt_rate_per_60m`  (default 100000)
   ⚠️ KHÔNG dùng key `*_rate_per_min` — đã bỏ, xem cảnh báo ở §4
2. Xác định service type:
   - VIP (NHP/NHT): dùng VIP_RATE_PER_60M
   - Phổ thông (NHS): dùng PT_RATE_PER_60M
3. phút = min(thời_gian_thực_làm, thời_gian_dịch_vụ_gán)
   - Lấy từ `segments`, lọc theo `ktvId`. ⚠️ `BookingItems.segments` có thể là
     CHUỖI JSON (57% dữ liệu production) → phải `JSON.parse` trước khi `.filter`
   - Segment có `customCommissionDuration` → dùng thẳng giá trị đó
   - Segment thiếu `actualStartTime`/`actualEndTime` → dùng `seg.duration` (giờ gán)
4. basePay = phút × (rate_per_60m / 60)
5. Lấy rating THEO KHÁCH (booking-level):
   - 1 KTV làm nhiều DV cho 1 khách → dùng chung rating của khách
   - 1 KTV làm 2+ đơn con trong 1 đơn cha → mỗi đơn con tính riêng
6. finalPay = Math.round(basePay × (1 - deduction[rating]))
```

**Quy tắc rating TYPE_D (KHÁC A/B/C):**
```
TYPE_D: Rating tính theo KHÁCH (booking-level), không phải per-item.
1 KTV × 1 khách × nhiều DV → tính 1 lần rating = rating booking
1 KTV × 2+ đơn con trong đơn cha → mỗi đơn con tính riêng
```

> ⚠️ TYPE_A/B/C dùng per-item rating (`ktvRatings[techCode]`).
> TYPE_D dùng **booking-level rating** → đơn giản hơn, phù hợp "1 khách = 1 đánh giá".

**Methods:**
- `getConfig(supabase)`: Đọc VIP rate/min, PT rate/min, rating deduction table từ SystemConfigs
- `calcCommission(actualMins, assignedMins, serviceId, bookingRating, config)`: Tính tiền tua
- `calcBookingCommission(booking, techCode, config)`: Tính cho 1 Booking (gộp tất cả items)

---

### 5.2 [NEW] `KtvTypeDBonusService.ts` — Bonus ĐỘC LẬP ⭐

> **Hoàn toàn tách biệt** với `calculateBookingBonus` trong `KtvCommissionService.ts`.

```
Quy tắc Bonus TYPE_D:
┌─────────────────────────────────────────────────┐
│ 1. Rating < 4★ → 0đ  (tức >= 4★ mới có, gồm 5★) │
│ 2. Solo (1 KTV TYPE_D, 1 khách) → 20đ          │
│    (kể cả tua 30 phút!)                        │
│ 3. 2 KTV cùng TYPE_D → chia đôi (10đ mỗi)     │
│ 4. Có KTV khác chế độ tham gia → 0đ            │
│ 5. Điểm cơ bản (20đ) cài đặt được trên Admin   │
└─────────────────────────────────────────────────┘
```

**Methods:**
- `calcBonus(booking, techCode, staffWorkTypeMap, config)`: Tính bonus 1 booking
- `getConfig(supabase)`: Đọc `ktv_type_d_bonus_points`, `enable_ktv_bonus_TYPE_D`

**Khác biệt so với bonus A/B/C:**
| | TYPE_A/B/C | TYPE_D |
|---|---|---|
| Điểm theo Ca | Ca 1=20đ, Ca 2=20đ, Ca 3=30đ | **Flat 20đ** (không phân ca) |
| Tua < 60 phút | Mất trắng (0đ) | **Vẫn được 20đ** nếu >= 4★ |
| Làm chung khác chế độ | Tính bình thường (chia quỹ) | **0đ** cho TYPE_D |
| Làm chung cùng chế độ | Chia theo guest/KTV ratio | Chia đôi đơn giản (÷2) |
| Service class | `KtvCommissionService.calculateBookingBonus()` | **`KtvTypeDBonusService.calcBonus()`** |

---

### 5.3 [NEW] `KtvTypeDDisciplineService.ts` — Kỷ luật trừ giờ

```
Bảng phạt TYPE_D (cài đặt được trên Admin):
┌──────────────────────────────────────────────────────┐
│ Bỏ lịch đã đăng ký (không báo / báo trễ)  → -10 giờ │
│ Báo vắng đúng hạn (trước 7h sáng)         → -5 giờ  │
│ Đến trễ không cập nhật nhóm                → -5 giờ  │
│ Từ chối tua đã gán                         → -3× giờ │
│   (VD: gói 60p → -3h, gói 90p → -4.5h)              │
└──────────────────────────────────────────────────────┘
```

**Methods:**
- `deductHours(supabase, staffId, penaltyType, bookingDurationMins?)`: Ghi `KTVServiceHoursLedger`
- `getMonthlyNetHours(supabase, staffId)`: Tổng (earned - penalty) tháng hiện tại
- `monthlyReset(supabase)`: Chốt sổ + reset về 0

**KHÔNG dùng**: `KTVDisciplinePoints`, `WalletAdjustments`, cơ chế giáng chức tự động.

---

### 5.4 [NEW] `KtvTypeDTurnService.ts` — Xếp tua theo giờ

```
Thuật toán ưu tiên TYPE_D (đã đồng bộ với quyết định JOIN ở §2.4):
1. Lấy tất cả KTV TYPE_D có status = 'waiting' trong TurnQueue
2. Sort theo monthly_hours DESC
   — giá trị này KHÔNG lưu sẵn, mà tính bằng JOIN sang KTVServiceHoursLedger
     và SUM(hours_earned - hours_penalty) của tháng hiện tại (xem SQL §2.4)
3. Nếu KTV #1 đang bận (working) → gán KTV #2
4. Tie-breaker: check_in_order (ai điểm danh trước)
```

**Methods:**
- `getTurnOrder(supabase, date)`: Trả về danh sách KTV TYPE_D đã sort (JOIN + aggregate lúc đọc)
- `getMonthlyHours(supabase, staffId)`: Tổng giờ tháng hiện tại của 1 KTV (dùng cho app KTV)

> ✅ **`syncServiceHoursForDate()` ĐÃ BỎ.** Theo quyết định §2.4, không còn cột nào cần đồng bộ nên không cần hàm sync, cũng không cần xác định "gọi lúc nào". Ghi giờ vào `KTVServiceHoursLedger` ngay khi tua hoàn tất là đủ.

---

## 6. API Routes

### Routes cần MODIFY:

| Route | Thay đổi cho TYPE_D |
|---|---|
| `POST /api/ktv/attendance` | CHECK_IN: **CÓ** trừ phí giặt đồ. Nghỉ ĐX: gọi `KtvTypeDDisciplineService.deductHours()` thay vì phạt tiền |
| `GET /api/ktv/wallet/balance` | Branch: Gọi `KtvTypeDCommissionService`, filter `work_type_snapshot = 'TYPE_D'`, include rating deduction |
| `GET /api/ktv/wallet/bonus/balance` | Branch: Gọi `KtvTypeDBonusService`, filter `work_type_snapshot = 'TYPE_D'` |
| `GET /api/turns` | Branch: TYPE_D sort **`monthly_hours` DESC** — giá trị tính bằng JOIN sang `KTVServiceHoursLedger` lúc đọc (§2.4), **không** đọc cột trên TurnQueue |
| `POST /api/finance/adjustment` | Hỗ trợ `wallet_type: 'HOURS'` để admin điều chỉnh giờ tích lũy. Luôn stamp `work_type_snapshot` |
| `GET /api/finance/ktv-summary` | Thêm cột: giờ tích lũy, rating deduction, quỹ nội bộ cho TYPE_D |

### Routes MỚI:

| Route | Mục đích |
|---|---|
| `GET /api/ktv/type-d/service-hours` | Xem tổng giờ tích lũy + lịch sử phạt giờ trong tháng |
| `POST /api/cron/reset-type-d-hours` | Cron cuối tháng: Chốt sổ + reset giờ về 0 |

---

## 7. UI Changes

### Admin Settings — Tab "Loại D"

| Section | Nội dung |
|---|---|
| **Khung giá tua** | ❌ **KHÔNG dùng Milestones editor.** Chỉ **2 ô input**: Rate VIP (đ/giờ) + Rate Phổ thông (đ/giờ). Cộng bảng khấu trừ theo sao — **6 dòng (0★–5★)**, cài đặt được |
| **Bonus** | Điểm cơ bản (input số), Toggle bật/tắt, Tỷ lệ quy đổi điểm→VNĐ |
| **Kỷ luật** | 4 dòng mức trừ giờ (input số, cài đặt/nhập/xóa) |
| **Phí & Quỹ** | Quỹ nội bộ (input + **toggle bật/tắt**), Phí bảo trì (50k, input), Phí giặt đồ (20k, input), Phí kích hoạt lại (input), Tiền cọc ví (input) |

### Reception — Turns Board
- KTV TYPE_D: Cột "Giờ tích lũy" thay "Số tua"
- Sort DESC — nhiều giờ đứng đầu
- Badge 🟣 **D**

### KTV App — Wallet
- Ví tua: Số dư sau khấu trừ rating
- Ví bonus: Điểm bonus TYPE_D (tách riêng, không lẫn với bonus A/B)
- **KHÔNG** hiển thị tab Heo đất cho TYPE_D
- Giờ tích lũy tháng này

### KTV App — Dashboard
- Instant reward: Tiền sau khấu trừ rating
- Tổng giờ tích lũy tháng

---

## 8. Cron Jobs

| Cron | Thay đổi |
|---|---|
| `sync-daily-ledger` (hàng đêm) | TYPE_D: Ghi `rating_deduction`, `work_type_snapshot = 'TYPE_D'`. Trừ quỹ nội bộ nếu toggle = ON. Trừ phí bảo trì cuối tháng |
| **[NEW]** `reset-type-d-hours` (00:00 ngày 1 hàng tháng) | **CHỈ chốt sổ** → `KTVMonthlyServiceHours`. ~~Reset `accumulated_service_hours` = 0~~ — **không còn cần**: query §2.4 đã lọc theo tháng hiện tại nên sang tháng mới tổng tự về 0 |

### ⚠️ [BỔ SUNG] Đăng ký cron trong `vercel.json`

Cron mới **sẽ không tự chạy** nếu chưa khai báo. File hiện có đúng 3 entry (`sync-daily-ledger`, `piggy-bank-deduct`, `cleanup-online`). Cần thêm:

```json
{
  "path": "/api/cron/reset-type-d-hours",
  "schedule": "0 17 1 * *"
}
```

> Giờ Vercel cron là **UTC**. `0 17 1 * *` = 00:00 ngày 2 giờ VN. Muốn đúng 00:00 ngày 1 giờ VN thì phải để `0 17 L * *` (ngày cuối tháng) — Vercel cron **không hỗ trợ `L`**, nên phương án thực tế là chạy `0 17 1 * *` (tức 00:00 ngày 2 VN) hoặc để cron chạy hằng ngày và tự kiểm tra "hôm nay có phải ngày 1 không". Cách thứ hai giống mẫu đã dùng trong `sync-daily-ledger` (§7 của route đó tự phát hiện ngày cuối tháng). **Đề xuất dùng cách thứ hai** để tránh lệch múi giờ.

Route cũng cần bảo vệ bằng `CRON_SECRET` giống các cron hiện có:
```ts
const authHeader = request.headers.get('authorization');
if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
}
```

---

## 9. Tổng Hợp Files

### Files MỚI (7 files):

| # | File | Mô tả |
|---|---|---|
| 1 | `migrations/add_type_d_support.sql` | Migration DB (5 phase) |
| 2 | `lib/services/KtvTypeDCommissionService.ts` | Tiền tua: **phút × rate/phút, KHÔNG làm tròn** (Cách B, §5.1) + rating deduction theo khách |
| 3 | `lib/services/KtvTypeDBonusService.ts` | **Bonus TÁCH RIÊNG**: 20đ flat, luật chia riêng |
| 4 | `lib/services/KtvTypeDDisciplineService.ts` | Kỷ luật: trừ giờ tích lũy |
| 5 | `lib/services/KtvTypeDTurnService.ts` | Xếp tua: DESC theo giờ |
| 6 | `app/api/ktv/type-d/service-hours/route.ts` | API giờ tích lũy |
| 7 | `app/api/cron/reset-type-d-hours/route.ts` | Cron reset tháng |
| 8 | `scripts/insert_type_d_configs.js` | **[BỔ SUNG]** Seed giá trị mặc định cho 14 key SystemConfigs (mẫu: `insert_maintenance_fee_configs.js`) |
| 9 | `scripts/seed_type_d_test_accounts.js` | Tạo 11 tài khoản test T001–T079 (đã mô tả ở §11.2) |
| 10 | `scripts/cleanup_type_d_test_accounts.js` | Dọn tài khoản test trước khi merge (đã mô tả ở §11.3) |

### Files SỬA (~15-20 files):

| Nhóm | Files | Ghi chú |
|---|---|---|
| Types & Constants | `lib/types/staff.types.ts`, `lib/constants/staff.constants.ts` | |
| Turn Sync | `lib/turn-sync.ts` | Thêm branch TYPE_D |
| **Service (logic thật)** | **`lib/services/KtvWalletService.ts`** | ⚠️ **[BỔ SUNG]** Route `wallet/balance` chỉ 31 dòng, gọi thẳng service này. Logic ví nằm ở đây, không phải ở route |
| **Service (logic thật)** | **`lib/services/KtvLedgerSyncService.ts`** | ⚠️ **[BỔ SUNG]** Nơi trừ phí bảo trì cuối tháng (`processMonthlyMaintenanceFee`) |
| API Routes | `ktv/attendance/route.ts`, `ktv/wallet/balance/route.ts`, `ktv/wallet/bonus/balance/route.ts`, `turns/route.ts`, `finance/ktv-summary/route.ts`, `finance/adjustment/route.ts` | |
| **API Routes** | **`ktv/wallet/timeline/route.ts`**, **`ktv/wallet/bonus/timeline/route.ts`** | ⚠️ **[BỔ SUNG]** Cũng đọc `KTVDailyLedger` → cũng cần filter `work_type_snapshot` |
| **API Routes** | **`ktv/wallet/withdraw/route.ts`** | ⚠️ **[BỔ SUNG]** Chặn rút ngoài buổi sáng (R5 có nêu nhưng bảng file gốc bỏ sót) |
| ~~Cron piggy-bank~~ | ~~`cron/piggy-bank-deduct/route.ts`~~ | ✅ **KHÔNG cần sửa** — xem ghi chú Heo đất bên dưới |
| Cron | `cron/sync-daily-ledger/route.ts` | |
| **Config** | **`vercel.json`** | ⚠️ **[BỔ SUNG]** Đăng ký cron mới. Hiện chỉ có 3 cron, thiếu entry cho `reset-type-d-hours` |
| **Types gen** | **`supabase_types.ts`** | ⚠️ **[BỔ SUNG]** Regenerate sau migration (2 bảng mới + 5 cột mới) |
| Admin UI | `admin/settings/system/page.tsx` (tab D), `KtvFeatures.logic.ts`, `KtvFeaturesTable.tsx`, employees dropdown | ❌ **KHÔNG** cần `MilestonesEditor.tsx` — D không dùng milestones |
| KTV UI | `ktv/wallet/page.tsx`, `KTVWallet.logic.ts`, `ktv/dashboard/page.tsx` | |
| Reception UI | `reception/turns/page.tsx`, `turns.logic.ts` | |
| **Reception Dispatch** | **`reception/dispatch/useDispatchBoard.logic.ts`**, **`actions.ts`**, **`_components/QuickDispatchTable.tsx`**, **`_components/DispatchStaffRow.tsx`**, **`_components/KanbanBoard.tsx`**, **`components/shared/TurnQueueBoard/*`** (3 files), `reception/ktv-hub/page.tsx`, `api/ktv/booking/_shared/utils.ts` | ⚠️ **[BỔ SUNG]** Xem cảnh báo phạm vi bên dưới |

> [!NOTE]
> **Loại TYPE_D khỏi Heo đất — không cần sửa cron.** Đã kiểm tra `PiggyBank.service.ts`: cron chỉ quét bảng `KTVPiggyBank` với `status = 'ACTIVE'`, tức **chỉ động tới KTV đã có sổ Heo đất**. Sổ này do Admin tạo tay qua `/api/admin/piggy-bank`, không tự sinh.
>
> → Việc cần làm chỉ là: **(1)** không tạo sổ Heo đất cho KTV TYPE_D, **(2)** đặt feature flag `savings_wallet = false`, **(3)** ẩn tab Heo đất trên app KTV. Cron tự khắc không đụng tới.
>
> *(Ghi chú rà soát: bản 31/08 lần đầu ghi cron này "sẽ trừ nhầm TYPE_D" — nhận định đó SAI, đã kiểm tra lại service và sửa.)*

> [!WARNING]
> **Phạm vi dispatch bị đánh giá thấp trong bản gốc.** Bản gốc chỉ ghi mơ hồ *"dispatch files"*. Thực tế có **23 file** đụng tới `turns_completed`. Riêng [QuickDispatchTable.tsx:1142](../app/reception/dispatch/_components/QuickDispatchTable.tsx#L1142) đang sort **trộn chung mọi loại KTV** theo `turns_completed` ASC — đúng như rủi ro R1 đã cảnh báo. Ước lượng "2-3 ngày" ở §13 nên được xem lại.

> [!NOTE]
> **Thứ tự tua là GỢI Ý, không phải cưỡng chế.** Đã kiểm chứng: hệ thống **không có auto-assign KTV** ở bất kỳ đâu. Lễ tân chọn tay từ danh sách có ô tìm kiếm ([QuickDispatchTable.tsx:1131](../app/reception/dispatch/_components/QuickDispatchTable.tsx#L1131)); sort chỉ quyết định thứ tự hiển thị.
>
> **Hệ quả tích cực**: KTV D đứng cuối bảng vẫn nhận được tua qua kênh khách yêu cầu đích danh hoặc lễ tân chủ động chọn → không có bẫy chết đói.
>
> **Hệ quả cần lưu ý**: cơ chế sort DESC của chế độ D chỉ phát huy tác dụng nếu lễ tân tuân theo thứ tự hiển thị. Vì vậy việc **tách 2 danh sách riêng biệt (R1) là bắt buộc**, không phải tùy chọn — nếu để lẫn, KTV D nằm sai vị trí và toàn bộ luật xếp tua của chế độ D mất hiệu lực trên thực tế.

---

## 10. Verification Plan

### Automated Tests
- `simulate_type_d_commission.mjs`: Test công thức **Cách B** — `phút × rate/phút × (1 - deduction)`, **không làm tròn** (**5 mức sao 0★–4★** × VIP/Phổ thông × nhiều mốc phút).
  - ⚠️ **Nguồn đối chiếu là §5.1 của plan này**, KHÔNG dùng bảng A2/B2 trong `bao_cao_bang_gia_type_d.md` (báo cáo đó tính theo công thức cũ, số sẽ lệch).
  - Bắt buộc có case `min(thực, gán)`: gán 60p xong 50p → 50p; gán 60p xong 65p → 60p.
  - Bắt buộc có case rating = 5 lọt vào → phải rơi về fallback `?? 0`, không được ra `NaN`.
- `simulate_type_d_bonus.mjs`: Test bonus riêng (solo, 2 KTV cùng D, KTV khác chế độ, tua < 60p)
- `simulate_type_d_discipline.mjs`: Test trừ giờ (4 loại vi phạm)
- `simulate_type_d_turn_order.mjs`: Test sort DESC, busy fallback, tie-breaker

### Manual Verification (Dùng 11 tài khoản test T001–T079)
1. Admin tạo KTV TYPE_D → Kiểm tra badge & sổ tua
2. Dispatch đơn VIP cho TYPE_D → Tiền tua = phút × 3.000 + khấu trừ sao, không làm tròn
3. Đánh giá 3★ → Trừ 25% tiền tua
4. Đánh giá 4★ → Bonus cộng 20đ
5. 2 KTV TYPE_D cùng 1 khách → Bonus chia đôi (10đ)
6. 1 KTV TYPE_D + 1 KTV TYPE_A → Bonus TYPE_D = 0đ
7. Phạt TYPE_D bỏ lịch → Trừ 10 giờ tích lũy
8. Chuyển TYPE_A → TYPE_D giữa tháng → Ví không trộn (Temporal Tagging)
9. Reset cuối tháng → Giờ tích lũy = 0
10. Admin tab D → Sửa 2 rate (VIP/PT), bảng khấu trừ sao, bonus, phí → Lưu thành công

---

## 11. Phase 0 — Test Branch & Test Accounts (LÀM ĐẦU TIÊN)

### 11.1 Git Branch

```bash
git checkout -b feature/type-d-regime
```

Tất cả code TYPE_D sẽ được phát triển trên nhánh `feature/type-d-regime`. Chỉ merge vào `main` sau khi test đầy đủ.

### 11.2 Test Accounts — Clone từ KTV thật

Tạo **11 tài khoản test** (ID prefix `T`) clone từ nhân viên thật (NH). Giữ nguyên `avatar_url`, `skills`, `feature_flags` để đảm bảo VIP menu hoạt động.

| Test ID | Clone từ | Tên gốc | Work Type | VIP | Avatar |
|---|---|---|---|---|---|
| `T001` | `NH001` | Phát | **TYPE_D** | ✅ bật | ✅ `NH001.jpg` |
| `T002` | `NH002` | NHI | **TYPE_D** | ✅ giữ | ✅ `NH002.jpg` |
| `T011` | `NH011` | Yully | **TYPE_D** | ✅ giữ | ✅ `NH011.jpg` |
| `T014` | `NH014` | Tea | **TYPE_D** | ✅ giữ | ✅ `NH014.jpg` |
| `T016` | `NH016` | Tieu Kim Nghi | **TYPE_D** | ✅ bật | ✅ `NH016.jpg` |
| `T018` | `NH018` | Cherry | **TYPE_D** | ✅ giữ | ✅ `NH018.jpg` |
| `T021` | `NH021` | Ua | **TYPE_D** | ✅ giữ | ✅ `NH021.jpg` |
| `T025` | `NH025` | Rose | **TYPE_D** | ✅ giữ | ✅ `NH025.jpg` |
| `T027` | `NH027` | Sunny | **TYPE_D** | ✅ giữ | ✅ `NH027.png` |
| `T069` | `NH069` | JK | **TYPE_D** | ✅ bật | ✅ external |
| `T079` | `NH079` | Hiếu | **TYPE_D** | ✅ giữ | ✅ external |

> [!NOTE]
> **✅ [ĐÃ KIỂM CHỨNG trên DB production 31/08]** — bảng trên chính xác, có thể dùng luôn:
> - **Đủ 11/11 mã nguồn tồn tại**, tên khớp hoàn toàn với plan (NH079 tên đầy đủ là "Huỳnh Ngọc Tuấn Hiếu").
> - Cả 11 đều có `status = 'ĐANG LÀM'` và `avatar_url` khác NULL → clone giữ nguyên là được.
> - Cột VIP khớp: NH001, NH016, NH069 đang `is_active_vip_menu = false` → đúng như plan ghi "✅ **bật**"; 8 mã còn lại đã `true` → đúng như plan ghi "✅ giữ".
> - **Không có Staff nào có `id` bắt đầu bằng `T`** → dải mã `T001`–`T079` an toàn, không đụng dữ liệu thật.
> - Giá trị `status` hợp lệ là `'ĐANG LÀM'` (141 NV). Lưu ý DB còn lẫn `'active'` (2) và `'working'` (2) — **không dùng 2 giá trị này** cho tài khoản test.
>
> ⚠️ Một điểm cần biết: **NH027 (Sunny) và NH079 (Hiếu) đang là `TYPE_B`**, 9 mã còn lại là `TYPE_A`. Khi clone sang TYPE_D, `feature_flags` nguồn của 2 mã này khác 9 mã kia → **đừng copy nguyên `feature_flags`**, hãy ghi đè bằng `DEFAULT_FEATURE_FLAGS_TYPE_D` ở §4.
>
> Nhắc lại: 2 bảng `KTVServiceHoursLedger` và `KTVMonthlyServiceHours` **chưa tồn tại** trên DB — phải chạy migration §3 trước khi seed.

**Script tạo**: `scripts/seed_type_d_test_accounts.js`

```javascript
// Flow:
// 1. Đọc Staff NH001, NH002, ... (select *)
// 2. Clone sang T001, T002, ... với:
//    - id: thay NH → T
//    - full_name: giữ nguyên + " (Test D)"
//    - work_type: 'TYPE_D'
//    - is_active_vip_menu: true (tất cả đều bật VIP)
//    - status: 'ĐANG LÀM'
//    - avatar_url: giữ nguyên URL gốc (ảnh NH)
//    - skills: giữ nguyên
//    - feature_flags: merge với TYPE_D defaults
//    - Không clone: phone, id_card, bank_account (bảo mật)
// 3. Upsert vào Staff table (conflict on id → update)
```

### 11.3 Dọn dẹp sau test

Script `scripts/cleanup_type_d_test_accounts.js`:
- Xóa tất cả Staff có `id LIKE 'T%'`
- Xóa TurnQueue, KTVServiceHoursLedger, KTVDailyLedger, KTVBonusLedger có `staff_id LIKE 'T%'`
- Chạy trước khi merge vào `main`

---

## 12. ⚠️ Phản Biện & Phân Tích Rủi Ro

### 🔴 RỦI RO CAO

#### R1: Dispatch Board lẫn TYPE_D với TYPE_A/B/C

**Vấn đề**: `TurnQueue` chứa MỌI loại KTV. Nếu không filter đúng, dispatch sẽ sort lẫn (TYPE_A theo `turns_completed` ASC, TYPE_D theo `monthly_hours` DESC) → gán sai người.

**Giải pháp**: Dispatch Board phải JOIN `Staff.work_type` và **tách 2 danh sách riêng biệt**:
- List A/B/C: Sort `turns_completed` ASC (logic cũ)
- List D: Sort `monthly_hours` DESC (tính bằng JOIN lúc đọc — xem §2.4)

Lễ tân nhìn 2 tab riêng hoặc 2 section riêng trên cùng board.

---

#### R2: Tiền tua bị tính sai khi rating chưa có

**Vấn đề**: TYPE_D khấu trừ tiền tua theo rating. Nhưng rating thường được nhập **sau khi đơn hoàn tất** (khách đánh giá sau). Lúc đơn vừa DONE, rating = 0 → hệ thống tính sao?

**Giải pháp 2 bước**:
1. **Tạm tính 100%**: Khi đơn DONE mà chưa có rating → tạm ghi nhận 100% tiền tua (giả định 4★)
2. **Truy thu/hoàn**: Khi rating được nhập → Cron hoặc webhook recalculate → ghi `rating_deduction` chênh lệch vào `KTVDailyLedger`

> [!WARNING]
> Nếu khách KHÔNG đánh giá (rating = 0 mãi), cần policy: Mặc định tính 4★? Hay 0★? → **Đề xuất: Mặc định 4★ (100%)** — giống hệ thống hiện tại cho bonus.

---

#### R3: Tính giờ tích lũy bị trôi khi BookingItems bị sửa sau

**Vấn đề**: `syncServiceHoursForDate()` quét BookingItems để tổng hợp giờ. Nhưng Admin có thể sửa `segments`, thay đổi `duration`, hoặc cancel đơn cũ → giờ tích lũy bị lệch mà KTV không biết.

**Giải pháp**:
- `syncServiceHoursForDate()` luôn **tính lại từ đầu** (full re-scan) mỗi lần gọi, không dùng incremental
- Lưu `KTVServiceHoursLedger` chỉ ghi `hours_earned` từ scan gần nhất (idempotent upsert)
- Admin log khi sửa đơn cũ → notification cho KTV bị ảnh hưởng

---

### 🟡 RỦI RO TRUNG BÌNH

#### R4: `work_type_snapshot` quên stamp khi tạo bút toán

**Vấn đề**: Nếu bất kỳ API nào tạo record vào `KTVDailyLedger` / `KTVBonusLedger` mà quên ghi `work_type_snapshot`, record đó sẽ là `NULL` → fallback vào TYPE_A → TYPE_D mất tiền.

**Giải pháp**:
- Tạo helper function `getWorkTypeSnapshot(supabase, staffId)` → dùng ở MỌI nơi tạo ledger record
- Thêm DB trigger (optional): `BEFORE INSERT ON KTVDailyLedger → SET work_type_snapshot = (SELECT work_type FROM Staff WHERE id = NEW.staff_id)` — phòng trường hợp code quên

---

#### R5: KTV TYPE_D bấm rút tiền ngoài buổi sáng

**Vấn đề**: PDF nói "yêu cầu rút tiền phải đăng ký buổi sáng". Nếu hệ thống không enforce → KTV bấm bất kỳ lúc nào → vi phạm quy chế.

**Giải pháp**: 
- Feature flag `withdraw_morning_only = true` trên Staff
- API `/api/ktv/wallet/withdraw` kiểm tra: Nếu TYPE_D + flag ON + giờ hiện tại > 12:00 VN → reject với message "Vui lòng đăng ký rút tiền vào buổi sáng"
- Admin có thể tắt flag cho từng KTV nếu cần linh hoạt

---

#### R6: Bonus 0đ khi làm chung KTV khác chế độ — KTV phản đối

**Vấn đề**: Luật TYPE_D: "Tua có sự tham gia của nhân sự KHÔNG cùng chế độ → không cộng bonus". Nếu KTV TYPE_D bị dispatch chung với TYPE_A (do thiếu người), TYPE_D mất bonus → bất mãn.

**Giải pháp**:
- Dispatch Board nên **ưu tiên ghép KTV cùng chế độ** khi cần 2 KTV
- Nếu buộc phải ghép khác chế độ → hiện cảnh báo cho lễ tân: "⚠️ Ghép khác chế độ: KTV TYPE_D sẽ không nhận bonus"
- KTV thấy lý do trên timeline ví: "Không nhận bonus — tua ghép với KTV khác chế độ"

---

### 🟢 RỦI RO THẤP

#### ~~R7: Reset giờ cuối tháng bị lỡ (Cron fail)~~ — ĐÃ TRIỆT TIÊU ✅

**Rủi ro này không còn tồn tại** sau quyết định JOIN lúc đọc (§2.4).

Lý do: query xếp tua lọc `EXTRACT(MONTH FROM shl.date) = EXTRACT(MONTH FROM CURRENT_DATE)`, nên **sang tháng mới tổng giờ tự động về 0** — không có thao tác reset nào để mà fail.

Cron `reset-type-d-hours` giờ chỉ còn nhiệm vụ **chốt sổ lưu trữ** vào `KTVMonthlyServiceHours`. Nếu nó fail thì chỉ thiếu dữ liệu báo cáo lịch sử, **không ảnh hưởng thứ tự xếp tua**. Vẫn nên giữ log và nút chạy tay cho Admin, nhưng hạ từ rủi ro xuống mức ghi nhận.

---

#### R8: Test accounts T001–T079 lọt vào production data

**Vấn đề**: Nếu quên cleanup, tài khoản test xuất hiện trên báo cáo tài chính, dispatch board thật.

**Giải pháp**:
- Tên hiển thị có suffix `(Test D)` → dễ nhận biết
- Script cleanup chạy trước merge
- Báo cáo tài chính có thể filter `WHERE staff_id NOT LIKE 'T%'` (optional)

---

## 13. Ước Lượng & Phân Chia

| Phase | Effort | Ưu tiên |
|---|---|---|
| **Phase 0: Branch + Test Accounts** | 🟢 Nhỏ | **P0 — LÀM ĐẦU TIÊN** |
| Phase 1: DB Migration | 🟢 Nhỏ | P0 |
| Phase 2: Types & Constants | 🟢 Nhỏ | P0 |
| Phase 3: 4 Service Classes | 🔴 Lớn (~400-600 LOC) | P0 — Core logic |
| Phase 4: API Routes | 🟡 Trung bình | P1 |
| Phase 5: Admin UI (Tab D) | 🟡 Trung bình | P1 |
| Phase 6: Reception UI | 🟡 Trung bình | P2 |
| Phase 7: KTV App | 🟡 Trung bình | P2 |
| Phase 8: Cron Jobs | 🟢 Nhỏ | P2 |

**Tổng**: ~2-3 ngày, nên chia 3-4 Executor windows.

**Gợi ý chia team**:
- **Executor 1**: Phase 0-3 (Branch + DB + Types + 4 Services) — Backend core
- **Executor 2**: Phase 4-5 (API Routes + Admin UI) — Backend + Admin
- **Executor 3**: Phase 6-8 (Reception + KTV App + Cron) — Frontend + Jobs

---

## 14. ⏳ Câu Hỏi Nghiệp Vụ — ĐÃ CHỐT 31/08 ✅

> Cập nhật: 31/08 10:04 — User đã trả lời tất cả câu hỏi.

### 🟢 ĐÃ CHỐT

| # | Câu hỏi | Quyết định | Ghi chú |
|---|---|---|---|
| **1** | Thang sao TYPE_D? | **Thang 4★** (không có 5★). TYPE_C dùng 5★ | `deduction = {4:0, 3:0.25, 2:0.5, 1:0.75, 0:0}` |
| **2** | Khấu trừ theo item hay booking? | **Theo KHÁCH (booking-level)**. 1 KTV × 1 khách × nhiều DV = rating 1 lần. 1 KTV × 2+ đơn con trong đơn cha = mỗi đơn con tính riêng | Khác A/B/C (per-item) |
| **3** | Chính sách ví âm | **HOÃN** — không implement tính năng này ở phase đầu | Chi phí cố định ~820k/tháng, cần xem thực tế trước |
| **4** | Chuyển chế độ hiệu lực khi nào? | **Ngày 1/9/2026 áp dụng** — có ngày cụ thể, không cần cơ chế "hiệu lực hôm sau" | Tất cả KTV TYPE_D bắt đầu từ 1/9 |
| **5** | 1 điểm bonus = bao nhiêu VNĐ? | **1.000đ/điểm** (= `ktv_bonus_rate` đã có). 20đ/tua = **20.000đ/tua** | Thêm `ktv_bonus_rate_TYPE_D = 1000` |
| **6** | Ghép khác chế độ → bonus 0đ? | **Giữ nguyên luật.** Đã được nhân viên đồng ý. VD: 5 DV 5 khách, 4 TYPE_D + 1 TYPE_A/B/C → cả 4 TYPE_D đều 0đ bonus | Dù được quầy xin FB vẫn 0đ |
| **7** | Ai nhập/sửa rating? | **Admin** (trước mắt). Chưa cần khoá sau X giờ hay audit log ở phase đầu | Mở rộng sau nếu có tranh chấp |
| **8** | Phạt giờ carry-over? | **Không carry-over** — reset sạch đầu tháng. Phạt ngày 28 chỉ tác dụng 3 ngày | Đúng tinh thần PDF "reset hàng tháng" |
| **9** | Giờ dự kiến hay thực tế? | **`min(thời_gian_thực, thời_gian_gán)`**. VD: gán 60p, xong 50p → tính 50p. Gán 60p, xong 65p → tính 60p (cap tại gán) | Áp dụng CHO CẢ tiền tua lẫn giờ tích lũy |
| **10** | Tua ghép: giờ tích lũy tính sao? | Phụ thuộc **song song hay nối tiếp**. Cách tính thời gian giống câu 9: `min(thực, gán)` cho mỗi KTV | Cộng đủ giờ cho mỗi KTV (không chia đôi) |
| **11** | Dịch vụ tiện ích (`is_utility`)? | **KHÔNG tính giờ tích lũy** cho tiện ích | Tiện ích = dịch vụ phụ |
| **12** | Chuyển ra rồi vào lại TYPE_D? | **Bắt đầu từ 0** — giờ cũ là lịch sử, không dùng xếp hạng | Chặn kẽ hở chuyển ra/vào né phạt |
| **13** | Tiền cọc TYPE_D? | **1.000.000đ** (= bằng A/B) | Sửa từ 500k lên 1tr |
| **14** | Phí giặt đồ & bảo trì: chung hay riêng? | **RIÊNG** — chỗ nào liên quan tiền/bonus phải dùng riêng, không chung chạ | **Hướng (b)**: cần sửa code `.eq()` cứng → resolve theo `work_type`. Rủi ro hồi quy — test lại A/B/C |
| ~~**15**~~ | Giờ tích lũy: lưu TurnQueue hay JOIN? | **JOIN lúc đọc** ✅ | Đã cập nhật §2.4, §3, bỏ PHASE B |
| **16** | §2.3 "phạt duy nhất" vs §5.3 "4 loại phạt"? | **CẦN LÀM RÕ khi code** — 3 tầng phạt chồng nhau cho cùng 1 lỗi | Ghi nhận, không chặn code |

---

## 15. ✅ Checklist Trước Khi Bắt Đầu Phase 0

- [x] ~~Trả lời xong câu 1–14 ở §14~~ — **ĐÃ CHỐT TẤT CẢ 31/08**
- [x] ~~Xác nhận CHECK constraint `check_work_type` trên DB thật~~ — **ĐÃ KIỂM TRA 31/08 trên production**:
      `CHECK (work_type = ANY (ARRAY['TYPE_A','TYPE_B','TYPE_C']))` — constraint **đang sống thật**, khớp file migration,
      không ai sửa qua dashboard. → **PHASE 0 của migration là bắt buộc.**
      Phân bố hiện tại: TYPE_C 127 NV · TYPE_A 16 NV · TYPE_B 2 NV.
- [ ] **Sửa `.env.local`**: host pooler còn là `aws-0-ap-southeast-1...` (đã cũ), phải đổi thành `aws-1-...`
      ở cả `DATABASE_URL` và `DIRECT_URL`. Hiện mọi script node chạy local đều fail với lỗi
      `(ENOTFOUND) tenant/user postgres.xxx not found`. Không ảnh hưởng app trên Vercel.
- [x] ~~Xác nhận công thức giá~~ — **`phút × (rate_giờ / 60)`**, PT 100.000đ/giờ, VIP 180.000đ/giờ (chốt lần 2, 31/08)
- [ ] **XOÁ 2 key rate cũ khỏi SystemConfigs**: `ktv_type_d_vip_rate_per_min`, `ktv_type_d_pt_rate_per_min` — hiện đang tồn tại song song với bộ `_per_60m`, nguy cơ Phase 3 lấy nhầm → trả sai gấp 60 lần
- [ ] **Sửa lại 2 config bị hỏng**: `ktv_type_d_rating_deduction` và `ktv_type_d_discipline_rules` đang lưu chuỗi `[object Object]` — mất dữ liệu, phải seed lại bằng `JSON.stringify()`
- [ ] Tạo nhánh `feature/type-d-regime`
- [ ] Migration đặt tại `supabase/migrations/`, **không** phải `migrations/`
- [ ] Có script seed SystemConfigs, không chỉ liệt kê key
- [ ] Sửa code `.eq()` cứng cho phí giặt đồ & bảo trì → resolve per-type (câu 14: RIÊNG)
