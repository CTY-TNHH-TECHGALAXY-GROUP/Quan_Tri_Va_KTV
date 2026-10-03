# Prompt — Sửa 3 lỗi phần Thuế TNCN 10%

> Copy toàn bộ phần dưới gửi cho anti.
> Nhánh `feat/bit-lo-hong-phase1`.
> ⚠️ Prompt này **CHỈ đụng phần Thuế**. Mọi thứ khác trên nhánh (đăng ký lịch TYPE_D, nút Báo Khách, on-call, tan ca lại) là của luồng khác — xem §0.

---

## 0. Ranh giới — đọc trước

Nhánh này đang có **nhiều luồng cùng làm**. Prompt này chỉ giao đúng **3 lỗi của phần Thuế TNCN 10%**.

| Vùng | Chủ | Bạn được đụng? |
|---|---|---|
| `lib/services/KtvTypeDWalletService.ts` (phần thuế), migration `*total_tax*`, config `ktv_type_d_tax_*` | **Prompt này** | ✅ |
| Nút Báo Khách / auto-OFF / `guest-arrival-sweep` / `has_seen_pending` | `plans/plan_ra_soat_dangky_typeD_va_baokhach.md` §B | ❌ **Không đụng** — cơ chế auto-OFF là do luồng đó thiết kế (D2+D3, cron 5 phút), không phải lỗi |
| Đăng ký lịch TYPE_D, `daily-registration`, `attendance-adjustment`, `check_in_at`, cron `daily-absence-check` | `plans/plan_ra_soat_dangky_typeD_va_baokhach.md` §A | ❌ Không đụng |
| Tan ca lại + Bật Nhận Đơn cho D | `plans/plan_type_d_tan_ca_bat_nhan_don.md` | ❌ Không đụng |

**40 file đang treo chưa commit** phần lớn là của các luồng trên. **Không commit hộ.** Chỉ commit đúng file bạn sửa trong prompt này, `git add` liệt kê tường minh từng đường dẫn. **Cấm `git add -A` / `git add .`**.

Tương tự với rác thư mục gốc (`cleanup.js`, `cleanup2.js`, `temp.py`, `restore.patch`) — không chắc của mình thì **để nguyên**, chỉ báo lại.

---

## Ghi nhận: phần thuế làm đúng kiến trúc

Ledger giữ số gộp, cột `total_tax` chỉ lưu vết đối chiếu, phép trừ 10% nằm **duy nhất** ở `KtvTypeDWalletService`. Comment cảnh báo trừ thuế hai lần trong migration `20260903110000` viết chuẩn — **giữ nguyên tinh thần đó**, 3 việc dưới đây không được phá vỡ nó.

Còn 3 lỗi. Tôi vừa kiểm lại trên working tree hiện tại: **cả 3 vẫn còn nguyên**.

---

## V1 — Hai migration trùng nhau, cái cũ sẽ làm gãy deploy ⛔ GẤP NHẤT

`ls supabase/migrations | grep total_tax` ra **2 file**, cùng thêm cột `total_tax` vào `KTVDailyLedger`:

| File | Vấn đề |
|---|---|
| `20260903000000_add_total_tax_to_ledger.sql` | `ADD COLUMN` **không có `IF NOT EXISTS`** → chạy trên DB đã có cột là **lỗi, gãy cả chuỗi migration** |
| `20260903110000_add_total_tax_to_ledger.sql` | Có `IF NOT EXISTS`, comment đầy đủ — **bản đúng, giữ lại** |

**Việc:** xoá `20260903000000_add_total_tax_to_ledger.sql`.

Trước khi xoá, so 2 file xem cái cũ có gì mà cái mới không có. Hiện tôi chỉ thấy khác kiểu dữ liệu: `numeric(15,2)` (file cũ) vs `NUMERIC` (file mới). **Nếu DB production đã chạy file cũ rồi thì cột đang là `numeric(15,2)`** — ghi rõ điều này vào báo cáo để sau này khỏi tưởng nhầm kiểu dữ liệu.

---

## V2 — Thuế suất hardcode `0.1`, không có config

Grep `ktv_type_d_tax_rate` toàn repo = **0 kết quả**. Config chưa từng được tạo, trong khi số `0.1` nằm cứng ở **4 chỗ** trong `lib/services/KtvTypeDWalletService.ts`: dòng **60, 61, 173, 174**.

v16 ghi rõ đây là *"thông số cần cài đặt Loại D"*. Hiện muốn đổi thuế suất phải sửa code + deploy — không phải việc của kế toán.

**Việc:**
1. Migration mới seed `ktv_type_d_tax_rate` = `0.1` (mẫu `20260502000000_add_day_cutoff_config.sql`, dùng `ON CONFLICT DO UPDATE`).
2. Đọc config trong `KtvTypeDWalletService`, cạnh chỗ đang đọc `ktv_type_d_tax_effective_from` (**dòng 15**). Đặt biến `taxRate`, thay cả 4 chỗ hardcode.
3. **Fallback phải an toàn**: config thiếu / đọc lỗi / parse không ra số → `taxRate = 0` (không trừ), **không** phải `0.1`. Cùng tinh thần với `tax_effective_from` đang mặc định `'2099-01-01'`.
4. ⚠️ Giá trị trong `SystemConfigs` có thể ra `'0.1'`, `'"0.1"'` (kèm nháy) hoặc số — tuỳ nơi ghi. Xem tiền lệ đã xử lý ở `lib/guest-arrival.logic.ts:26` (`isGuestArrivalEnabled`), làm y hệt kiểu bóc nháy đó rồi mới `Number()`.
5. ⚠️ **Không tự thêm ô nhập vào tab Admin "Loại D"** (`app/admin/settings/system/page.tsx`) — vùng của luồng TYPE_D Phase 5. Chỉ seed key, phần UI báo lại để chủ dự án điều phối.

---

## V3 — Nhánh realtime tính thuế sai ngày, KTV bị trừ oan

`lib/services/KtvTypeDWalletService.ts:172`:

```ts
if (todayStr >= taxEffectiveDate) {
    const rtTaxComm = rt_commission * 0.1;   // trừ cả cục
```

Đây là lấy **ngày hôm nay** áp cho **toàn bộ** thu nhập realtime. Mà `rt_commission` là tổng của **nhiều ngày** — từ ngày chốt sổ gần nhất tới nay.

Nhánh ledger ở **dòng 59** làm **đúng**: `if (l.date >= taxEffectiveDate)` — xét từng ngày một. Hai nhánh đang không nhất quán.

**Kịch bản hỏng:** `tax_effective_from = 2026-09-01`, cron chốt sổ trễ nên ledger mới tới `2026-08-28`. Hôm nay `2026-09-03` → điều kiện đúng → **thu nhập các ngày 29, 30, 31/08 (trước mốc hiệu lực) bị trừ 10% oan.** Cron TYPE_D mới dựng nên chốt sổ trễ là chuyện có thật, không phải giả định.

**Việc:** gate thuế **theo ngày của từng booking**, không phải `todayStr`.

Vòng lặp `for (const b of allBookings)` đã có sẵn `b.timeStart`. Cách gọn nhất: tách 2 biến tích luỹ (`rt_commission_taxable` / `rt_commission_exempt`), cộng vào đúng biến theo ngày của `b` so với `taxEffectiveDate`, rồi chỉ trừ thuế trên phần `taxable`. Làm y hệt cho `rt_bonus`.

⚠️ Quy đổi `timeStart` sang **ngày làm việc theo giờ VN** cho khớp cách nhánh ledger so `l.date` — đừng so thẳng chuỗi UTC. Trong file đã có sẵn `VN_OFFSET_MS`, dùng lại.

---

## Nghiệm thu — dán output thật

- [ ] **V1**: `ls supabase/migrations | grep total_tax` → chỉ còn **1** file
- [ ] **V2**: `SELECT value FROM "SystemConfigs" WHERE key='ktv_type_d_tax_rate'` → dán kết quả
- [ ] **V2**: đổi tạm config sang `0.05`, mở ví 1 KTV TYPE_D → **số thuế đổi theo**, dán 2 con số. Rồi trả về `0.1`
- [ ] **V2**: xoá tạm dòng config → ví **không trừ thuế đồng nào** (chứng minh fallback = 0, không phải 0.1)
- [ ] **V3**: dựng dữ liệu có thu nhập **trước** và **sau** `tax_effective_from` trong cùng vùng realtime (ledger chưa chốt tới) → dán phép tính chứng minh **chỉ phần sau mốc bị trừ**
- [ ] `npm run test:type-d` vẫn xanh
- [ ] KTV **TYPE_A/B/C**: số dư ví **không đổi một đồng** — dán bảng đối chiếu 3 tài khoản trước/sau
- [ ] `npx tsc --noEmit` sạch
- [ ] `git status --short` → xác nhận **không commit nhầm** file của luồng khác

---

## Commit

Một commit duy nhất cho cả 3 việc, message tiếng Việt không dấu:

`fix(ops): dua thue suat TYPE_D ra config va sua gate ngay hieu luc o nhanh realtime`

Báo cáo cuối nêu rõ V1/V2/V3 làm gì, dán output từng ô nghiệm thu. Nếu thấy file mình định sửa đã bị luồng khác đụng → **dừng, báo cáo, không tự merge**.
