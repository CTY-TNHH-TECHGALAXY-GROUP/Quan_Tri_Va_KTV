# Plan — Sửa lương & thưởng KTV Loại D (thuế 10%, bonus tua ngắn, ledger)

Ngày: 2026-09-02 · Nhánh: `feat/bit-lo-hong-phase1`

Phạm vi đã rà: `lib/services/KtvTypeDWalletService.ts`, `KtvTypeDCommissionService.ts`, `KtvTypeDBonusService.ts`, `KtvCommissionService.ts`, `KtvWalletService.ts`, `app/api/cron/sync-daily-ledger/route.ts`, bảng `SystemConfigs` + `KTVDailyLedger` trên DB thật.

---

## 0. Bối cảnh: ví Loại D lấy số từ HAI nguồn

`KtvTypeDWalletService.getWalletSummary()` cộng hai phần:

| Phần | Nguồn | Hàm tính |
|---|---|---|
| **Ngày cũ** | bảng `KTVDailyLedger` | do cron `sync-daily-ledger` ghi mỗi đêm |
| **Hôm nay** | tính trực tiếp từ `Bookings` | `KtvTypeDCommissionService` + `KtvTypeDBonusService` |

Toàn bộ lỗi bên dưới đến từ chỗ **hai nguồn này không dùng chung luật**.
Hệ quả đặc trưng: KTV thấy số đúng trong ngày, qua đêm chốt sổ là số đổi.

---

## A. LỖI ĐÃ TÌM RA

### A1 — Thuế TNCN 10% không bao giờ trừ [P0 · ✅ ĐÃ BẬT 02/09, mốc 2026-09-01]

`KtvTypeDWalletService.ts:15`:
```ts
const taxEffectiveDate = configs['ktv_type_d_tax_effective_from'] || '2099-01-01';
```

Đã tra DB thật: **key `ktv_type_d_tax_effective_from` KHÔNG tồn tại**. Mốc rơi về `2099-01-01`
nên điều kiện `date >= taxEffectiveDate` không bao giờ đúng → không ai bị trừ thuế.

Code trừ thuế bản thân nó **đúng** (`:58` cho ngày cũ, `:171` cho hôm nay, trừ 10% trên cả
commission lẫn bonus, cộng dồn vào `total_tax_deducted`).

Migration `supabase/migrations/20260902140000_add_tax_effective_from.sql` đã có sẵn nhưng chưa apply.

**Đã xử lý 02/09**: insert `ktv_type_d_tax_effective_from = '2026-09-01'` vào `SystemConfigs`
(mốc do chủ dự án chốt). An toàn khi bật sớm vì `total_tax_deducted` được **tính lại mỗi lần
mở ví**, không lưu cứng — sửa xong A3/A4 thì tiền thuế tự tính lại theo số đúng.
Muốn đổi mốc: `UPDATE "SystemConfigs" SET value = '<yyyy-mm-dd>' WHERE key = 'ktv_type_d_tax_effective_from';`

### A2 — Tua dưới 60 phút bị mất thưởng [P0 · ✅ ĐÃ SỬA]

`KtvCommissionService.calculateBookingBonus()` có luật:
```ts
if ((totalDurationForBonus / servedGuestCount) < 60) return 0;   // luật mới
if (totalDurationForBonus < 60) calculatedPoints /= 2;           // luật cũ
```
Áp cho **mọi** loại KTV. Tham số `staffWorkTypeMap` được truyền vào hàm nhưng trước đó
**chưa hề được dùng ở đâu**.

Loại D ăn theo **lượt khách**, không theo thời lượng → đã thêm cờ `isTypeD` và miễn cả hai luật.

Vì sao khó phát hiện: đường realtime (`KtvTypeDBonusService`) **không** có luật 60 phút nên
trong ngày vẫn hiện đủ 20đ; chỉ khi cron đêm ghi ledger bằng `calculateBookingBonus` mới thành 0.

### A3 — Cron chốt sổ coi Loại D như Loại A [P0 · CHƯA SỬA, đụng tiền]

`app/api/cron/sync-daily-ledger/route.ts:124`:
```ts
const workType = ktv.work_type === 'TYPE_B' ? 'TYPE_B'
               : ktv.work_type === 'TYPE_C' ? 'TYPE_C'
               : 'TYPE_A';        // ⚠️ TYPE_D rơi vào đây
```

Nên **hoa hồng ngày cũ** của Loại D được tính bằng `KtvCommissionService.calcCommission` với
bảng giá Loại A, thay vì `KtvTypeDCommissionService.calculateGuestCommission`. Khác biệt thực chất:

| Tiêu chí | Luật Loại D (realtime) | Đang chạy ở ledger (Loại A) |
|---|---|---|
| Đơn giá | VIP `ktv_type_d_vip_rate_per_60m` = 180.000 / PT `..._pt_rate_per_60m` = 100.000 | Mốc `milestones` + `ratePer60` của Loại A |
| Tách VIP / PT | Có (theo tiền tố `NHP` / `NHT` / `VIP`) | Không |
| Trừ theo sao | Có (`ktv_type_d_rating_deduction`: 3★ −25%, 2★ −50%, 1★ −75%) | Không |
| Thời lượng | Theo `segments` (giờ chạy thật, có `customCommissionDuration`) | `calculateItemDuration`, thiếu thì mặc định 60 |

⇒ Lương ngày cũ của Loại D **đang sai**, và sai theo cả hai chiều (thiếu VIP 180k, nhưng cũng không bị trừ sao).

### A4 — Bonus ngày cũ lệch 1000 lần vì sai đơn vị [P0 · CHƯA SỬA, đụng tiền]

Quy ước của hệ thống: `KTVDailyLedger.total_bonus` lưu **ĐIỂM** (`calculateBookingBonus` trả `Math.floor(calculatedPoints)`). `KtvWalletService` của các loại khác cũng cộng điểm với điểm — nhất quán.

Nhưng `KtvTypeDWalletService`:
```ts
ledgerSummary.bonus += dayBonus;                              // ĐIỂM  (từ ledger)
rt_bonus += KtvTypeDBonusService.calculateBonusForTypeD(...)  // VNĐ   (basePoints × pointRate)
const total_bonus = ledgerSummary.bonus + rt_bonus;           // cộng thẳng hai đơn vị khác nhau
```

`pointRate = ktv_bonus_rate_TYPE_D = 1000`. Vậy **thưởng ngày cũ đang nhỏ hơn 1000 lần** so với thưởng hôm nay. 20 điểm ngày hôm qua = 20 đ trong ví, đáng lẽ 20.000 đ.

### A5 — Bonus ngày cũ dùng sai bảng điểm [P1 · CHƯA SỬA]

Cùng gốc với A3: `bonusConfig = allBonusConfigs['TYPE_A']` → ledger dùng điểm theo ca (`s1Bonus`/`s2Bonus`/`s3Bonus`) của Loại A, trong khi Loại D phải là `ktv_type_d_bonus_points = 20` cố định mỗi khách, chia đều nếu nhiều KTV cùng phục vụ.

### A6 — Không có bài kiểm tra tự động cho tiền [P2]

Bốn lỗi trên đều là lỗi **số học thầm lặng**: không exception, không log, `tsc` sạch, build xanh. Chỉ lộ ra khi ai đó ngồi so ví với thực tế.

---

## B. KẾ HOẠCH SỬA

### Đợt 1 — ✅ ĐÃ HOÀN TẤT (02/09)
Dựng lưới an toàn TRƯỚC khi đụng công thức. Không sửa công thức nào ở đợt này. Mục tiêu: có số liệu để biết sửa xong đúng hay sai.
1. **Script đối chiếu** `scripts/audit_type_d_wallet.ts`: với mỗi KTV Loại D và mỗi ngày trong khoảng chỉ định, tính song song **(a)** số ledger đang lưu và **(b)** số theo luật Loại D.
2. Chạy script cho toàn bộ dữ liệu Loại D. Đã xuất ra file CSV.
3. Báo cáo lại tổng chênh lệch. (Đã báo cáo, chênh lệch thực tế lớn nhất lên tới -284k và +450k/ngày, chốt giữ nguyên số cũ).

### Đợt 2 — ✅ ĐÃ HOÀN TẤT (02/09)
Sửa cron chốt sổ (A3 + A5).
4. Trong `sync-daily-ledger`, tách nhánh riêng cho `work_type === 'TYPE_D'`: gọi đúng `KtvTypeDCommissionService.calculateGuestCommission` và `KtvTypeDBonusService.calculateBonusForTypeD`.
5. Đã bọc điều kiện `targetDateStr >= '2026-09-01'` để bỏ qua các ngày cũ, bảo vệ Option B.
6. Đã tạo booking giả lập (rating 5) và xác nhận luồng bonus ghi nhận chính xác 20 ĐIỂM vào KTVDailyLedger.

### Đợt 3 — Thống nhất đơn vị bonus (A4)
7. Chốt quy ước: `KTVDailyLedger.total_bonus` **luôn lưu ĐIỂM** (giữ nguyên như các loại khác).
8. `KtvTypeDWalletService` nhân `ledgerSummary.bonus × pointRate` khi cộng, thay vì cộng thẳng.
9. Rà mọi nơi đọc `total_bonus` (`app/api/finance/ktv-bonus-summary`, `KtvLedgerSyncService`,
   `app/api/ktv/wallet/timeline`) để chắc chắn không chỗ nào đang hiểu là VNĐ.
10. Thêm chú thích đơn vị ngay tại khai báo cột và tại mỗi chỗ cộng dồn.

### Đợt 4 — Kiểm lại thuế (A1 — cờ đã bật sẵn)
11. ~~Bật thuế~~ → đã bật 02/09 với mốc `2026-09-01`. Vì thuế là số **dẫn xuất**, nó tự đúng lại
    ngay khi A3/A4/A5 xong; không cần bật lại.
12. Sau khi A3/A4 xong, đối chiếu lại số thuế của vài KTV với bản tính tay.
13. Kiểm: một KTV Loại D có thu nhập ở cả ngày trước và ngày sau mốc → chỉ phần từ mốc trở đi
    bị trừ; `total_tax_deducted` khớp đúng 10% của (commission + bonus) phần đó.

### Đợt 5 — Chốt chặn lâu dài (A6)
14. Test cho `calculateBookingBonus`: Loại D tua 30 phút **vẫn** đủ điểm; Loại A tua 30 phút **mất** điểm.
15. Test cho nhánh Loại D của cron: một booking VIP + một booking PT, rating 3★ → so với số tính tay.
16. Cho script bước 1 chạy định kỳ (hoặc thành route cron chỉ đọc) và cảnh báo khi ledger lệch
    quá ngưỡng so với luật realtime — để lần sau lệch là biết ngay, không đợi KTV phát hiện.

---

## C. THỨ TỰ BẮT BUỘC

```
Đợt 1 (đo)  →  Đợt 2 (cron)  →  Đợt 3 (đơn vị)  →  Đợt 4 (thuế)  →  Đợt 5 (test)
```

Không đảo. Bật thuế trước khi sửa A3/A4 là trừ 10% trên con số sai; sửa đơn vị trước khi có ảnh chụp ở Đợt 1 là mất căn cứ đối chiếu.

---

## D. CÁC QUYẾT ĐỊNH ĐÃ CHỐT (02/09)

1. **Mốc áp thuế** -> ✅ CHỐT: `2026-09-01`. Đã insert config, thuế 10% đang chạy.
2. **Xử lý số cũ** -> ✅ CHỐT (Option B): **Giữ nguyên** số cũ, không tính lại ledger, không ghi bù WalletAdjustments.
3. **Mốc bắt đầu chế độ Loại D cho Ledger** -> ✅ CHỐT: `2026-09-01`. Các ngày trước mốc này Cron sẽ bỏ qua (continue) để bảo toàn dữ liệu lịch sử theo đúng Option B.
4. **Việc rút tiền** -> ✅ XÁC NHẬN: Chưa có KTV Loại D nào rút tiền trong giai đoạn này (lệnh tháng 8 còn PENDING). Không cần bù trừ hay xử lý hậu quả giao dịch.

---

## E. CÔNG THỨC CHUẨN & TRẠNG THÁI TẠM TÍNH (chốt 02/09)

### E1. Công thức đúng cho KTV Loại D

```
tiền tua gốc  = (số phút / 60) × rate          rate: PT 100.000 · VIP 180.000
trừ theo sao  = tiền tua gốc × tỷ lệ trừ       ktv_type_d_rating_deduction
                                               4★+ : 0%   3★ : 25%   2★ : 50%   1★ : 75%
tiền tua      = tiền tua gốc − trừ theo sao
bonus         = +20 điểm × pointRate           CHỈ khi đánh giá ≥ 4★
──────────────────────────────────────
thu nhập đơn  = tiền tua + bonus quy tiền
thuế TNCN     = 10% × thu nhập đơn             chỉ Loại D, từ 2026-09-01
thực nhận     = thu nhập đơn − thuế TNCN
```

**Ví dụ chuẩn**: tua 60 phút PT = 100.000đ, khách chấm 3★
→ trừ 25% = −25.000đ → tiền tua **75.000đ** → chưa đủ 4★ nên **không có bonus**
→ thuế 10% = −7.500đ → **thực nhận 67.500đ**.

⚠️ Ghi rõ vì dễ hiểu sai: phần trừ theo sao nằm **bên trong** tiền tua, không phải một khoản trừ riêng cộng thêm vào thuế. Thuế tính trên số **đã trừ sao rồi**.

### E2. Vấn đề "hai lần nhìn ra hai giá"

Lúc khách **chưa đánh giá**, hệ thống chưa biết trừ bao nhiêu nên tạm tính **đủ tiền tua**
(bảng `ktv_type_d_rating_deduction` có `"0": 0`). Sau khi khách chấm 3★, số tụt 25%.

KTV mở lịch sử hai lần thấy hai con số khác nhau → tưởng hệ thống trừ oan. Phải nói trước.

**Quy tắc hiển thị đã chốt:**

| Tình trạng đơn | Nhãn | Ý nghĩa |
|---|---|---|
| Chưa có đánh giá, đơn chưa `DONE` | **Tạm tính** (vàng) | Còn có thể giảm khi khách chấm sao |
| Có đánh giá (bất kể mấy sao) | **Thực nhận** (xanh) | Đã chốt |
| Không đánh giá nhưng đơn đã `DONE` | **Thực nhận** (xanh) | Khách bỏ qua → giữ nguyên số hiện tại |

### ⛔ TIÊU CHÍ BẮT BUỘC: phải có câu giải thích ở CẢ HAI trạng thái

Không được chỉ giải thích lúc chưa đánh giá. Mỗi đơn của Loại D **luôn** phải kèm một câu nói rõ vì sao con số là như vậy — đây là điều kiện nghiệm thu, thiếu là chưa đạt.

| Trạng thái | Câu giải thích bắt buộc |
|---|---|
| Chưa đánh giá | "Khách **chưa đánh giá** nên đang tạm tính đủ tiền tua. Nếu khách chấm 3★ số này giảm 25%, 2★ giảm 50%, 1★ giảm 75%. Khách bỏ qua không đánh giá thì giữ nguyên số này." |
| Đã đánh giá, có bị trừ | "Khách đánh giá **3★** nên tiền tua bị trừ **25%** (−25.000đ, từ 100.000đ). Số này **đã chốt**, không thay đổi nữa." |
| Đã đánh giá, không bị trừ | "Khách đã đánh giá **5★** — tiền tua **không bị trừ**, còn được cộng **20 điểm** bonus. Số này **đã chốt**, không thay đổi nữa." |

Ba yêu cầu với câu giải thích:
1. Nêu **số sao thật** của khách, không nói chung chung.
2. Nêu **số tiền bị trừ** và **số gốc trước khi trừ**, để KTV tự đối chiếu được.
3. Nói rõ **đã chốt hay chưa chốt** — đây là thứ chặn hiểu nhầm "hai lần hai giá".

Khối này hiển thị cho **mọi đơn của Loại D**, kể cả ngày chưa áp thuế (trước 01/09) — lúc đó chỉ ẩn riêng dòng thuế, phần giải thích vẫn còn.

**✅ ĐÃ LÀM 02/09**
- `app/api/ktv/history/route.ts`: trả `isProvisional`, `isTypeD`, `taxAmount`, `netIncome`, `bonusValue`, `commissionBeforeDeduction`, `ratingDeductionRate`, `ratingDeductionAmount`.
- `app/ktv/history/page.tsx`: khối thuế + nhãn Tạm tính/Thực nhận + câu giải thích ở cả hai trạng thái.
- **Đã làm luôn một phần E3**: hoa hồng Loại D trong Lịch sử nay tính bằng `KtvTypeDCommissionService` (tách VIP/PT + trừ theo sao), không còn dùng bảng giá Loại A. Bắt buộc phải làm cùng lúc, nếu không câu giải thích "bị trừ 25%" sẽ mâu thuẫn với con số hiển thị bên trên nó.

### E3. A7 (MỚI) — Màn Lịch sử là đường tính THỨ BA dùng code chung [P0 · CHƯA SỬA]

`app/api/ktv/history/route.ts` cũng gọi `KtvCommissionService.calcCommission` + `calculateBookingBonus` cho **mọi** loại KTV. Nghĩa là **tiền tua hiển thị trong Lịch sử của Loại D vẫn đang tính theo bảng giá Loại A** — đúng lỗi A3, chỉ khác chỗ.

⚠️ Hệ quả ngay sau khi cron Đợt 2 chạy: **Ví đã đúng luật D, Lịch sử thì chưa** → hai màn hình lệch nhau, KTV càng hoang mang hơn.

⇒ Đưa vào **Đợt 3**: cho `/api/ktv/history` dùng `KtvTypeDCommissionService` + `KtvTypeDBonusService` cho Loại D, giống hệt cách đã làm cho cron. Vẫn nguyên tắc cũ: **gọi lại service, không sao chép công thức**.

Sau Đợt 3, ba đường tính (ví realtime · cron chốt sổ · lịch sử) phải cho **cùng một con số**. Đây là tiêu chí nghiệm thu của Đợt 3.

### E4. Cron cập nhật ví theo Loại D

Sau khi cron ghi `KTVDailyLedger` theo luật D (Đợt 2), phải kiểm ví đọc lại đúng:
- `KtvTypeDWalletService` nhân `ledgerSummary.bonus × pointRate` (lỗi A4).
- Số ví = số lịch sử = số cron, cho cùng một ngày.
- Thuế trong ví khớp với tổng thuế từng đơn trong lịch sử.
