# 🧭 TYPE_D — BẢN TỔNG HỢP DUY NHẤT (MASTER)

> **Ngày soạn**: 2026-09-03 · **Nhánh**: `feat/bit-lo-hong-phase1`
> **Cách soạn**: quét code + migration + git log thật, KHÔNG chép lại trạng thái từ các plan cũ.
>
> ⚠️ **File này thay thế toàn bộ 33 file `plans/*type_d*` về mặt TRẠNG THÁI TIẾN ĐỘ.**
> Các file cũ chỉ còn giá trị làm **nguồn nghiệp vụ** và **nhật ký lịch sử** — xem §7.

---

## 1. Hai nguồn sự thật duy nhất

| Loại | File | Ghi chú |
|---|---|---|
| **Nghiệp vụ / công thức** | `plans/plan_che_do_type_d.md` (973 dòng) | §5.1 = công thức giá. §14 = các quyết định đã chốt |
| **Tiến độ / việc còn lại** | **File này** | Cập nhật sau mỗi đợt |

**ĐÃ HẾT HIỆU LỰC — KHÔNG DÙNG SỐ / KHÔNG DÙNG BẢNG TRẠNG THÁI:**
- `bao_cao_bang_gia_type_d.md` — công thức cũ, tự nó đã ghi cảnh báo
- `huong_dan_thi_cong_type_d.md`, `prompt_type_d_rollout_full.md` — bảng Phase 0-8 đã sai (ghi Phase 5 và 7 "chưa làm" trong khi đã xong)

---

## 2. Chốt nghiệp vụ (trích, để khỏi phải mở file khác)

| Hạng mục | Luật |
|---|---|
| Giá tua | `phút × (rate_giờ / 60)`, `Math.round` khi ghi sổ. VIP 180.000đ/giờ, PT 100.000đ/giờ |
| `phút` | `min(thời_gian_thực, thời_gian_gán)` |
| Thang sao | **4★** (không có 5★). Khấu trừ dạng phân số `{"0":0,"1":0.75,"2":0.5,"3":0.25,"4":0}` |
| Bonus | 20 điểm/tua khi 4★. Chia đôi nếu 2 KTV cùng TYPE_D. 0 nếu ghép KTV khác chế độ |
| Thuế TNCN | **10%**, áp từ config `ktv_type_d_tax_effective_from` |
| Xếp tua | Theo **giờ tích lũy tháng, nhiều giờ → ưu tiên**. Reset đầu tháng |
| Kỷ luật | **Trừ giờ tích lũy**, không phạt tiền |
| Heo đất | KHÔNG áp dụng cho TYPE_D |
| Mốc áp dụng | `TYPE_D_RULE_EFFECTIVE_FROM = '2026-09-01'` |

---

## 3. Bản đồ code TYPE_D (hiện trạng)

### Service (`lib/services/`)
| File | Dòng | Vai trò |
|---|---|---|
| `KtvTypeDCommissionService.ts` | 71 | Tiền tua + khấu trừ sao |
| `KtvTypeDBonusService.ts` | 30 | Bonus 20 điểm/tua |
| `KtvTypeDTurnService.ts` | 80 | Xếp tua theo giờ tích lũy |
| `KtvTypeDDisciplineService.ts` | 81 | Trừ giờ kỷ luật |
| `KtvTypeDWalletService.ts` | 233 | Ví riêng + **nơi DUY NHẤT trừ thuế 10%** |
| `KtvTypeDOnlineService.ts` | 260 | On-call / mở ca / tan ca (chưa commit) |

### API
- `app/api/cron/sync-daily-ledger-type-d/route.ts` (257 dòng) — cron chốt sổ **riêng** của D
- `app/api/cron/sync-daily-ledger/route.ts` — cron A/B/C, có `.neq('work_type','TYPE_D')` + rào `TYPE_D_RULE_EFFECTIVE_FROM`
- `app/api/cron/daily-absence-check/route.ts` — kiểm tra vắng, chạy `59 16 * * *`
- `app/api/ktv/type-d/on-call/route.ts`, `app/api/ktv/type-d/service-hours/route.ts`
- `app/api/ktv/attendance-adjustment/route.ts`, `app/api/ktv/daily-registration/route.ts`
- `app/api/turns/route.ts:44-68` — sort TYPE_D theo `monthly_hours` DESC

### UI
- `app/ktv/attendance/_components/AttendanceTypeD.tsx`
- `app/admin/settings/system/KtvTypeDSettingsBlock.tsx` + tab D tại `page.tsx:57,162,177`
- `app/ktv/{dashboard,schedule,history,wallet}` đã có nhánh D
- `components/shared/AccountLockedScreen.tsx` — màn khóa kỷ luật

### Migration đã có
`20260901000000_add_type_d_support.sql`, `20260901010000_add_commission_breakdown_to_ledger.sql`,
`20260902103002_rename_type_d_daily_registration.sql`, `20260902140000_add_tax_effective_from.sql`,
`20260902150000_create_ktv_daily_registration.sql`, `20260903110000_add_total_tax_to_ledger.sql`,
`20260903120000_update_ledger_column_comments.sql`

### Cron đã đăng ký (`vercel.json`)
`sync-daily-ledger`, `sync-daily-ledger-type-d` (0 19 * * *), `reset-type-d-hours` (0 17 1 * *), `daily-absence-check` (59 16 * * *)

---

## 4. TIẾN ĐỘ — Phase 0 → 8

| # | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|
| 0 | Migration + tài khoản test | ✅ XONG | 7 migration có đủ, script seed/cleanup có đủ |
| 1 | Types & Constants | ✅ XONG | `lib/types/staff.types.ts`, `lib/constants/staff.constants.ts` |
| 2 | 6 service class lõi | ✅ XONG | §3 |
| 3 | API routes + `work_type_snapshot` | ✅ XONG | helper stamp snapshot, `applySnapshotFilter` |
| 4 | Phí dùng chung per-type | ⚠️ **DỞ DANG** | Giặt đồ ✅ (`attendance/route.ts`). **Phí bảo trì CHƯA** — `KtvLedgerSyncService.ts:136,156` còn `.eq('key', ...)` cứng |
| 5 | Admin UI tab "Loại D" | ✅ XONG | `admin/settings/system/page.tsx:57,162,177` |
| 6 | Reception/Dispatch tách sort | ⚠️ **DỞ DANG** | API ✅ (`turns/route.ts:44-68`). **UI CHƯA** — `QuickDispatchTable.tsx` grep `TYPE_D` = 0 kết quả |
| 7 | KTV App | ✅ XONG | 7 file trong `app/ktv/` |
| 8 | Cron chốt sổ | ✅ XONG | Cron riêng của D đã có + đã đăng ký |

**Các chuỗi phụ (ngoài 8 phase gốc):**

| Chuỗi | Trạng thái |
|---|---|
| On-call đợt 1→5 (tan ca vẫn nhận đơn) | ✅ Đợt 5 đã hoàn tác tiền đề sai của đợt 4. Loại B **để đợt sau** |
| Lương/thưởng đợt 1→3 (đơn vị bonus, thuế 10%) | ✅ Xong. Bonus lưu dạng **ĐIỂM**, thuế trừ ở ví |
| Báo vắng / báo trễ (Phase 5.5) | ✅ Có `daily-absence-check` + `KTVDailyRegistration` |
| Khóa kỷ luật Phase 3 | ✅ `AccountLockedScreen.tsx` + `KtvTypeDDisciplineService` |
| Ledger "thực nhận" | ⚠️ **CHƯA** — xem §5.3 |

---

## 5. VIỆC CÒN LẠI — theo thứ tự ưu tiên

### 5.1 [P0] Phase 6 — Tách sort TYPE_D trên UI lễ tân
**File**: `app/reception/dispatch/_components/QuickDispatchTable.tsx` (~dòng 1142)

Đang sort **trộn chung mọi loại KTV** theo `turns_completed` ASC. TYPE_D phải là **danh sách riêng, sort theo giờ tích lũy DESC** — giống `app/api/turns/route.ts:54-68`.

Không sửa → luật xếp tua của Loại D mất hiệu lực trên thực tế, dù API đã đúng.

**Nghiệm thu**: thứ tự A/B/C không đổi; D thành nhóm riêng, nhiều giờ đứng trước.

### 5.2 [P1] Phase 4 — Phí bảo trì per-type
**File**: `lib/services/KtvLedgerSyncService.ts:136,156`

Đổi `.eq('key', 'enable_maintenance_fee')` và `.eq('key', 'maintenance_fee_amount')` sang resolve theo `work_type`, dùng lại pattern `typeSuffix` của `KtvCommissionService.getCommissionConfig()` (thử key `_TYPE_D` trước, không có thì rơi về key global).

**Nghiệm thu bắt buộc — test hồi quy**: phí bảo trì của 1 KTV TYPE_A, 1 TYPE_B, 1 TYPE_C phải **giống hệt** trước khi sửa. Đây là code dùng chung.

### 5.3 [P1] `total_tax` đang hardcode `0`
**File**: `app/api/cron/sync-daily-ledger-type-d/route.ts:190` ghi `total_tax: 0`.

Cột `total_tax` đã tồn tại, migration mô tả rõ nó **chỉ để lưu vết đối chiếu, KHÔNG dùng để trừ**. Cần ghi số thuế thật của ngày vào đây.

> ⚠️ **BẪY TRỪ THUẾ HAI LẦN**: nơi trừ thuế duy nhất hiện tại là `KtvTypeDWalletService.ts:60-63` và `:172-175`. Nếu đổi `total_commission` sang số đã-trừ-thuế thì **phải bỏ phép trừ trong ví trong CÙNG một lần sửa**.

Yêu cầu gốc "`total_commission` = thực nhận" (`prompt_ledger_type_d_thuc_nhan.md`) **chưa làm**. Hiện ledger lưu số GỘP và mọi thứ đang khớp → cần chủ dự án xác nhận có còn muốn đổi không.

### 5.4 [P2] Migration trùng tên
`20260903000000_add_total_tax_to_ledger.sql` và `20260903110000_add_total_tax_to_ledger.sql` cùng thêm cột `total_tax` nhưng **comment mâu thuẫn nhau**. Bản `110000` dùng `IF NOT EXISTS` nên vẫn chạy được, nhưng nên **xoá bản `000000`** để người sau không đọc nhầm mô tả cũ.

### 5.5 [P2] `rating_deduction` lấy sao thấp nhất cả ngày
`sync-daily-ledger-type-d/route.ts:173-174` dùng `lowestRating` cho **toàn bộ ngày**, trong khi plan chốt rating ở mức **booking-level**. Cần xác nhận: cố ý (phạt nặng) hay là lỗi?

### 5.6 [P2] Dọn `plans/` — xem §7

---

## 6. Câu hỏi còn treo cho chủ dự án

1. **§5.3** — `total_commission` giữ GỘP như hiện tại, hay đổi sang "thực nhận"?
2. **§5.5** — `rating_deduction` theo ngày hay theo từng booking?
3. **Loại B on-call** — đợt 5 ghi "để đợt sau", giờ làm chưa?
4. **Phạt "nghỉ không đăng ký OFF"** — hiện 3 tầng cộng dồn (trừ 10 giờ + khóa tài khoản + phí kích hoạt 1.000.000đ). Áp cả 3 cùng lúc hay chọn 1? Câu này treo từ `prompt_type_d_rollout_full.md` §1.2, **chưa thấy trả lời ở plan nào**.

---

## 7. Xử lý 33 file plan cũ

**GIỮ (nguồn nghiệp vụ):**
- `plan_che_do_type_d.md` — nghiệp vụ gốc
- `plan_type_d_bao_vang_bao_tre.md` — luật báo vắng/báo trễ
- `plan_ra_soat_dangky_typeD_va_baokhach.md` §D — 5 quyết định nghiệp vụ chốt 02/09
- `plan_sua_luong_thuong_type_d.md` — mô hình "ví lấy số từ 2 nguồn"

**ARCHIVE → `plans/_archive/type_d/`** (nhật ký, hết hiệu lực điều hành):
toàn bộ `prompt_type_d_*` (25 file), `prompt_cron_rieng_type_d.md`, `prompt_ledger_type_d_thuc_nhan.md`, `prompt_sua_luong_thuong_type_d.md`, `prompt_fix_type_d_allow_on_call.md`, `prompt_phase3_khoa_ky_luat_typeD.md`, `bao_cao_bang_gia_type_d.md`, `huong_dan_thi_cong_type_d.md`.

---

## 8. Sức khỏe nhánh hiện tại

- `npx tsc --noEmit` — ✅ **sạch** (chạy 03/09/2026)
- `git status` — **105 file đang treo chưa commit**, gồm nhiều file TYPE_D quan trọng (`KtvTypeDOnlineService.ts`, `AttendanceTypeD.tsx`, 7 migration). **Nên commit sớm** để có mốc quay lui.
- Rác ở thư mục gốc: ~300 file `check_*.js`, `fix_*.js`, `test_*.js`, `tmp_*.js`, `patch_*.js`, `scratch*.js` — nên gom vào `scratch/` hoặc thêm `.gitignore`.

---
*Cập nhật file này sau mỗi đợt. Đừng tạo `prompt_*.md` mới chỉ để ghi trạng thái.*
