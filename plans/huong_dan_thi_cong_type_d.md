# 🛠️ Hướng Dẫn Thi Công TYPE_D

> Gửi kèm `plans/prompt_type_d_handoff.md`. File đó là **bối cảnh**, file này là **quy trình làm**.
> Nguồn quyết định nghiệp vụ: §14 của `plans/plan_che_do_type_d.md`. Nguồn công thức giá: **§5.1** (KHÔNG dùng `bao_cao_bang_gia_type_d.md`, file đó đã hết hiệu lực).

---

## Nguyên tắc chung

1. **Làm tuần tự theo phase.** Mỗi phase xong phải qua mục "Nghiệm thu" của nó rồi mới sang phase kế. Phase 2 phụ thuộc Phase 1, Phase 5 phụ thuộc Phase 2.
2. **Commit theo phase**, message tiếng Việt không dấu, prefix `feat(type-d):`.
3. **Không báo hoàn thành khi chưa chạy thử.** Test fail thì nói rõ fail chỗ nào, dán output thật.
4. **Với mỗi config/flag mới, tự hỏi: *đoạn code nào thực sự đọc cái này?*** rồi mở file đó ra xác nhận. Bốn lỗi nặng nhất phát hiện ở khâu rà plan đều thuộc loại "ghi vào DB thành công nhưng không ai đọc".
5. **Không đụng logic A/B/C** trừ Phase 4 (đã nêu rõ). Nếu buộc phải sửa file dùng chung, báo trước.

---

## PHASE 0 — Nhánh + Migration + Tài khoản test

### Việc

```bash
git checkout -b feature/type-d-regime
```

Tạo `supabase/migrations/20260901000000_add_type_d_support.sql` — copy nguyên khối SQL ở §3 của plan. **Giữ đúng thứ tự PHASE 0 → A → C → D → E → F.** PHASE 0 (mở CHECK constraint) phải chạy đầu tiên, nếu không mọi lệnh ghi `TYPE_D` đều bị Postgres từ chối.

⚠️ **Đặt ở `supabase/migrations/`, KHÔNG phải `migrations/`** — thư mục gốc là folder cũ đã ngừng dùng từ 08/2026, file đặt ở đó sẽ không được apply.

Sau khi apply, regenerate types:

```bash
npx supabase gen types typescript --project-id adzfohfdindovfcpaizb > supabase_types.ts
```

Viết `scripts/insert_type_d_configs.js` — seed các key ở §4. Lấy mẫu từ `scripts/insert_maintenance_fee_configs.js` đã có sẵn.

Viết `scripts/seed_type_d_test_accounts.js` — clone 11 KTV theo bảng §11.2:

- Ghi đè `feature_flags` bằng `DEFAULT_FEATURE_FLAGS_TYPE_D`, **đừng copy nguyên từ nguồn** (NH027 và NH079 đang là TYPE_B nên flags khác 9 mã kia).
- Set `work_type_effective_from = '2026-09-01'`.
- Không clone `phone`, `id_card`, `bank_account`.

### Nghiệm thu

```sql
-- 1. Constraint đã mở
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'check_work_type';
-- phải thấy TYPE_D trong danh sách

-- 2. Bảng mới đã có
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('KTVServiceHoursLedger', 'KTVMonthlyServiceHours');
-- phải trả về 2 dòng

-- 3. Seed thành công
SELECT id, full_name, work_type, work_type_effective_from
FROM "Staff" WHERE id LIKE 'T%' ORDER BY id;
-- phải có 11 dòng, work_type = 'TYPE_D'
```

**Bẫy**: nếu bước 3 báo `violates check constraint "check_work_type"` thì PHASE 0 chưa chạy — kiểm tra lại thứ tự trong file migration.

---

## PHASE 1 — Types & Constants

### Việc

`lib/types/staff.types.ts` — thêm `'TYPE_D'` vào `WorkType`, thêm interface `FeatureFlagsTypeD`.

`lib/constants/staff.constants.ts` — thêm `TYPE_D: 'D'` vào `WORK_TYPE_LABELS`, thêm `DEFAULT_FEATURE_FLAGS_TYPE_D`, `TYPE_D_DISCIPLINE_PENALTIES`, `TYPE_D_RATING_DEDUCTION`, `TYPE_D_BONUS`.

⚠️ **Tên feature flag phải khớp `FEATURE_FLAG_DEFS`** trong `app/admin/settings/system/KtvFeatures.logic.ts:6`. Tên đúng: `laundry_deduction`, `sudden_leave_penalty`, `allow_on_call`, `enable_employee_tasks`, `bonus_wallet`, `savings_wallet`, `maintenance_fee`. Đặt sai tên vẫn ghi được vào jsonb nhưng **không code nào đọc** — lỗi im lặng, rất khó tìm.

Thêm nhánh `case 'TYPE_D'` vào `getDefaultFlagsForType()` (`KtvFeatures.logic.ts:58`) — hiện `default:` trả về `{}` rỗng.

### Nghiệm thu

```bash
npx tsc --noEmit
```

Phải sạch lỗi. Chỗ nào báo thiếu nhánh `TYPE_D` trong switch/union thì bổ sung — **danh sách lỗi đó chính là bản đồ các file cần đụng ở phase sau, ghi lại để dùng.**

---

## PHASE 2 — 4 Service class (phần lõi, làm kỹ nhất)

Tạo 4 file trong `lib/services/`. **Logic độc lập hoàn toàn, KHÔNG sửa `KtvCommissionService.ts`.**

### 2.1 `KtvTypeDCommissionService.ts`

Công thức **Cách B** (§5.1):

```
phút     = min(thời_gian_thực, thời_gian_gán)
basePay  = phút × rate_per_min            // VIP 3000, PT 1667
finalPay = basePay × (1 - deduction[rating])    // KHÔNG làm tròn
```

Ba điểm bắt buộc:

**(a) Hàm tính phút là hàm MỚI.** Code hiện có `calculateItemDuration()` (`KtvCommissionService.ts:265`) và `calculateItemExpectedDuration()` (`:248`) — **cả hai đều không phải** `min(thực, gán)`. Phải viết hàm riêng, đừng tái dùng nhầm.

**(b) Rating tính theo KHÁCH, không per-item** (§14 câu 2). Gom `BookingItems` theo `guest_id` rồi áp một rating cho cả nhóm. Đây là điểm khác A/B/C — hàm bonus cũ lặp từng item và lấy `maxKtvRating`.

**(c) Fallback bắt buộc: `const d = table[rating] ?? 0;`**
TYPE_D dùng thang 4★, nhưng cột `Bookings.rating` là numeric 1–5 và **dùng chung với TYPE_C (thang 5★)**. Giá trị `5` vẫn có thể lọt vào qua dữ liệu cũ, Admin nhập nhầm, hoặc form đánh giá chung. Không có `?? 0` thì `basePay × (1 - undefined)` = **`NaN`** ghi thẳng vào ví KTV.

### 2.2 `KtvTypeDBonusService.ts`

Luật ở §5.2. Flat 20 điểm nếu rating **>= 4★**; 2 KTV cùng TYPE_D chia đôi; **có KTV khác chế độ tham gia → 0đ** (§14 câu 6 đã chốt giữ nguyên luật này).

1 điểm = 1.000đ, đọc từ `ktv_bonus_rate_TYPE_D`.

### 2.3 `KtvTypeDDisciplineService.ts`

Ghi vào `KTVServiceHoursLedger`. **Upsert, không insert thuần** — migration đã có unique index riêng cho dòng phạt (`staff_id, date, penalty_type` khi `booking_id IS NULL`). Gọi 2 lần phải ra cùng kết quả, không được trừ đôi.

### 2.4 `KtvTypeDTurnService.ts`

**KHÔNG có cột `accumulated_service_hours`** — đã bỏ ở §2.4. Dùng JOIN lúc đọc:

```sql
SELECT tq.*, COALESCE(SUM(shl.hours_earned - shl.hours_penalty), 0) AS monthly_hours
FROM "TurnQueue" tq
JOIN "Staff" s ON tq.employee_id = s.id
LEFT JOIN "KTVServiceHoursLedger" shl
  ON tq.employee_id = shl.staff_id
 AND EXTRACT(MONTH FROM shl.date) = EXTRACT(MONTH FROM CURRENT_DATE)
 AND EXTRACT(YEAR  FROM shl.date) = EXTRACT(YEAR  FROM CURRENT_DATE)
 AND shl.date >= s.work_type_effective_from
WHERE s.work_type = 'TYPE_D' AND tq.date = $1
GROUP BY tq.id, s.id
ORDER BY monthly_hours DESC, tq.check_in_order ASC
```

Điều kiện `shl.date >= s.work_type_effective_from` là thứ **thực thi quyết định "chuyển chế độ thì reset về 0"** (§14 câu 12). Thiếu nó thì kẽ hở chuyển ra/vào để giữ hạng vẫn còn nguyên.

### Nghiệm thu

Viết 4 script mô phỏng ở §10, chạy bằng `node`:

- `simulate_type_d_commission.mjs` — đối chiếu với **§5.1**, không dùng bảng trong `bao_cao_bang_gia_type_d.md`. Bắt buộc có case `min(thực, gán)`: gán 60p xong 50p → tính 50p; gán 60p xong 65p → tính 60p. Và case rating = 5 phải rơi về fallback, không ra `NaN`.
- `simulate_type_d_bonus.mjs` — solo, 2 KTV cùng D, có KTV khác chế độ, tua dưới 60 phút.
- `simulate_type_d_discipline.mjs` — 4 loại vi phạm, và gọi 2 lần phải cho cùng kết quả.
- `simulate_type_d_turn_order.mjs` — sort DESC, KTV đang bận, tie-breaker, và **case KTV vừa chuyển chế độ giữa tháng phải bắt đầu từ 0**.

Cả 4 phải xanh trước khi sang Phase 3.

---

## PHASE 3 — API Routes

Theo bảng §6. Lưu ý:

- **Logic ví nằm ở service, không phải route.** `app/api/ktv/wallet/balance/route.ts` chỉ 31 dòng, gọi thẳng `lib/services/KtvWalletService.ts` — sửa route là sửa nhầm chỗ.
- `KtvWalletService.getBalance()` tính lai: phần quá khứ đọc `KTVDailyLedger`, phần gần đây **tính lại trực tiếp từ `Bookings`**. Nhánh TYPE_D phải phủ **cả hai đường**, không chỉ đường ledger.
- Mọi chỗ tạo bút toán phải stamp `work_type_snapshot`. Viết một helper `getWorkTypeSnapshot(supabase, staffId)` rồi dùng ở **tất cả** các nơi (rủi ro R4).
- Hai route mới: `GET /api/ktv/type-d/service-hours` và `POST /api/cron/reset-type-d-hours`.

### Nghiệm thu

Gọi thật bằng `curl` với `techCode=T001`, đối chiếu số tiền trả về với script mô phỏng ở Phase 2. Hai bên phải khớp từng đồng.

---

## PHASE 4 — Sửa code dùng chung ⚠️ RỦI RO HỒI QUY CAO

§14 câu 14 chốt TYPE_D có **mức phí riêng**. Hiện 2 chỗ đọc key global bằng `.eq()` cứng:

| Khoản | File | Key global hiện tại |
|---|---|---|
| Giặt đồ | `app/api/ktv/attendance/route.ts:452` | `laundry_fee` |
| Bảo trì | `lib/services/KtvLedgerSyncService.ts:136-156` | `enable_maintenance_fee`, `maintenance_fee_amount` |

Sửa thành resolve theo `work_type`. Mẫu có sẵn: `typeSuffix` trong `KtvCommissionService.getCommissionConfig()` — thử key `_TYPE_x` trước, không có thì rơi về key global.

### Nghiệm thu — BẮT BUỘC test hồi quy

Đây là code dùng chung cho mọi loại KTV. Trước và sau khi sửa, chạy đối chiếu phí giặt đồ + phí bảo trì của **một KTV TYPE_A, một TYPE_B, một TYPE_C** — số phải **giống hệt** trước khi sửa. Chỉ TYPE_D được phép khác.

---

## PHASE 5 — Admin UI (tab "Loại D")

Theo §7. **KHÔNG dùng `MilestonesEditor`** — TYPE_D chỉ có 2 ô input rate (VIP đ/phút, PT đ/phút) cộng bảng khấu trừ sao 5 dòng (0★–4★).

### Nghiệm thu

Sửa giá trị trên UI → lưu → query `SystemConfigs` xác nhận đúng key, đúng value. Reload trang phải hiện lại đúng số vừa lưu.

---

## PHASE 6 — Reception / Dispatch ⚠️ PHẠM VI LỚN NHẤT

Có **23 file** đụng `turns_completed`. Trọng tâm:

`app/reception/dispatch/_components/QuickDispatchTable.tsx:1142` đang sort **trộn chung mọi loại KTV** theo `turns_completed` ASC. Phải **tách 2 danh sách riêng**:

- A/B/C: `turns_completed` ASC (giữ nguyên)
- D: `monthly_hours` DESC

Đây là **bắt buộc, không phải tùy chọn**. Hệ thống không có auto-assign — lễ tân chọn tay theo thứ tự hiển thị. Để lẫn thì KTV D nằm sai vị trí và toàn bộ luật xếp tua của chế độ D mất hiệu lực trên thực tế.

Thêm badge 🟣 **D**, đổi cột "Số tua" thành "Giờ tích lũy" cho KTV D.

### Nghiệm thu

Mở dispatch board với 11 tài khoản test. Kiểm: nhóm D sắp DESC theo giờ, nhóm A/B/C sắp ASC theo tua, hai nhóm không lẫn vào nhau.

---

## PHASE 7 — KTV App

Ví tua (số dư sau khấu trừ rating), ví bonus riêng, giờ tích lũy tháng. **Ẩn tab Heo đất** cho TYPE_D.

Về Heo đất: **không cần sửa cron**. `PiggyBank.service.ts` chỉ quét bảng `KTVPiggyBank` với `status = 'ACTIVE'`, mà sổ đó do Admin tạo tay chứ không tự sinh. Chỉ cần không tạo sổ cho TYPE_D, đặt `savings_wallet: false`, và ẩn tab.

---

## PHASE 8 — Cron

`sync-daily-ledger` — thêm nhánh TYPE_D: ghi `rating_deduction`, `work_type_snapshot`, trừ quỹ nội bộ nếu toggle bật.

`reset-type-d-hours` (mới) — **chỉ chốt sổ** vào `KTVMonthlyServiceHours`. Không cần reset gì cả: query ở §2.4 đã lọc theo tháng hiện tại nên sang tháng mới tổng tự về 0.

Khai báo trong `vercel.json` (hiện chỉ có 3 entry). Vercel cron chạy **giờ UTC** và **không hỗ trợ `L`** — nên cho cron chạy hằng ngày rồi tự kiểm tra "hôm nay có phải ngày 1 không", giống cách `sync-daily-ledger` đang tự phát hiện ngày cuối tháng. Bảo vệ bằng `CRON_SECRET` như các cron khác.

---

## Trước khi merge

- [ ] Chạy `scripts/cleanup_type_d_test_accounts.js` — xoá Staff `id LIKE 'T%'` và các bản ghi liên quan
- [ ] `npx tsc --noEmit` sạch
- [ ] 4 script mô phỏng đều xanh
- [ ] Đã chạy test hồi quy Phase 4 cho A/B/C
- [ ] Xác nhận không còn tài khoản `T%` nào trên production

---

## Cần hỏi lại chủ dự án trước khi bắt đầu

1. **Mốc 1/9/2026** (§14 câu 4): là ngày áp dụng chính sách với nhân viên (giai đoạn đầu tính tay, hệ thống theo sau) hay ngày hệ thống phải chạy được? Khối lượng trên không thể xong trong một ngày — câu trả lời quyết định làm đủ hay làm tối thiểu trước.

2. **Rate phổ thông**: giữ `1667` — khi đó 60p ra 100.020đ, lệch +20đ/giờ so với mức "100k/60p" ghi trong quy chế, và mọi số tiền phổ thông sẽ lẻ đến hàng chục (75.015đ, 150.030đ). Hoặc lưu `100000` rồi tính `phút × rate / 60` để 60p ra đúng 100.000đ — vẫn là nhân theo phút, không milestones, không làm tròn. **Nên chốt trước khi viết `KtvTypeDCommissionService`**, sửa sau phải sửa cả test lẫn dữ liệu đã sinh. (VIP không bị vấn đề này: 3.000 × 60 = 180.000 tròn.)

3. **§14 câu 16**: lỗi "nghỉ không đăng ký OFF" hiện chịu 3 tầng phạt chồng nhau (trừ 10 giờ + khoá tài khoản + phí kích hoạt lại 1.000.000đ). §2.3 và §5.3 đang nói về cùng một lỗi hay hai lỗi khác nhau?
