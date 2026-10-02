# Prompt — Đợt 3: Thống nhất đơn vị bonus & đồng bộ 3 màn (KTV Loại D)

> Copy toàn bộ phần dưới gửi cho anti.
> Kế hoạch gốc: `plans/plan_sua_luong_thuong_type_d.md` (mục A4, E3, E4).

---

## 0. Trạng thái hiện tại

Đợt 1 (audit) và Đợt 2 (cron chốt sổ) đã xong và đã được kiểm chứng độc lập: rào chắn
`TYPE_D_RULE_EFFECTIVE_FROM = '2026-09-01'` chạy đúng, nhánh Loại D gọi đúng service riêng,
dữ liệu test đã dọn sạch khỏi DB. Không đụng lại hai đợt đó.

**Phần chủ dự án đã tự làm, ĐỪNG LÀM LẠI:**
- `app/api/ktv/history/route.ts` + `app/ktv/history/page.tsx`: đã có thuế 10% từng đơn,
  nhãn Tạm tính / Thực nhận, câu giải thích bắt buộc, và **hoa hồng Loại D đã chuyển sang
  `KtvTypeDCommissionService`** (tách VIP/PT + trừ theo sao).
- Nếu thấy cần sửa gì ở hai file đó thì **báo trước**, đừng tự viết đè.

## 1. VIỆC CHÍNH — A4: đơn vị bonus lệch 1000 lần

File: `lib/services/KtvTypeDWalletService.ts`

### 1.1 Lỗi cộng sai đơn vị (dòng ~68 và ~204)

```ts
ledgerSummary.bonus += dayBonus;                              // ĐIỂM (đọc từ ledger)
rt_bonus += KtvTypeDBonusService.calculateBonusForTypeD(...)  // VNĐ  (points × pointRate)
const total_bonus = ledgerSummary.bonus + rt_bonus;           // cộng hai đơn vị khác nhau
```

`KTVDailyLedger.total_bonus` lưu **ĐIỂM**. `pointRate = ktv_bonus_rate_TYPE_D = 1000`.
Vậy thưởng ngày cũ đang vào ví **nhỏ hơn 1000 lần**: 20 điểm hôm qua = 20 đồng, đáng lẽ 20.000 đồng.

Sửa: quy đổi `dayBonus × pointRate` **trước khi** cộng vào `ledgerSummary.bonus`.

### 1.2 ⚠️ LỖI CHƯA GHI TRONG PLAN — thuế cũng đang tính trên ĐIỂM

Dòng ~57-64:
```ts
let dayBonus = Number(l.total_bonus || 0);        // ĐIỂM
if (l.date >= taxEffectiveDate) {
    const taxBonus = dayBonus * 0.1;             // 10% của ĐIỂM, không phải của tiền
    total_tax_deducted += (taxComm + taxBonus);
    dayBonus -= taxBonus;
}
```

Thuế phần bonus của ngày cũ cũng nhỏ hơn 1000 lần.

**Thứ tự bắt buộc: quy đổi điểm → VNĐ TRƯỚC, rồi mới trừ 10%.** Làm ngược lại vẫn sai.

### 1.3 Vì sao gấp

Trước đây bonus toàn 0 nên lỗi này chưa ăn vào số thật. Nhưng ledger ngày 01/09 **đã có bonus
thật** (`NH027` 20 điểm, `NH011` 40 điểm). Để càng lâu càng nhiều ngày dữ liệu sai.

## 2. Rà các nơi khác đọc `total_bonus`

Kiểm ba chỗ sau xem có chỗ nào đang hiểu `total_bonus` là VNĐ không:
- `app/api/finance/ktv-bonus-summary/route.ts`
- `lib/services/KtvLedgerSyncService.ts`
- `app/api/ktv/wallet/timeline/route.ts`

Báo lại từng chỗ: **đang hiểu là điểm hay là tiền**, có phải sửa không. Đừng sửa mò —
nếu một chỗ đang cố ý dùng điểm (ví dụ bảng xếp hạng điểm thưởng) thì để nguyên và nói rõ.

Thêm chú thích đơn vị ngay tại mỗi chỗ cộng dồn và tại khai báo kiểu, để lần sau không tái diễn.

## 3. TIÊU CHÍ NGHIỆM THU — ba màn phải ra CÙNG MỘT SỐ

Đây là điều kiện đạt/không đạt của Đợt 3. Chọn **một KTV Loại D** và **một ngày cụ thể từ
01/09 trở đi**, rồi đối chiếu ba nguồn:

| Nguồn | Cách lấy |
|---|---|
| Ví | `KtvTypeDWalletService.getWalletSummary()` — màn `/ktv/wallet` |
| Cron | dòng tương ứng trong `KTVDailyLedger` |
| Lịch sử | tổng các đơn của ngày đó trên `/ktv/history` |

Ba con số **hoa hồng**, **bonus (quy ra VNĐ)**, **thuế**, **thực nhận** phải khớp nhau.
Nộp bảng đối chiếu này trong báo cáo. Lệch một đồng cũng phải giải thích được vì sao.

Công thức chuẩn để tự kiểm (mục E1 của plan):
```
tiền tua gốc  = (phút / 60) × rate            PT 100.000 · VIP 180.000
trừ theo sao  = tiền tua gốc × {4★+: 0%, 3★: 25%, 2★: 50%, 1★: 75%}
tiền tua      = tiền tua gốc − trừ theo sao
bonus         = 20 điểm × 1.000               CHỈ khi ≥ 4★
thu nhập đơn  = tiền tua + bonus
thuế TNCN     = 10% × thu nhập đơn            chỉ Loại D, từ 2026-09-01
thực nhận     = thu nhập đơn − thuế
```
Ví dụ tự kiểm: tua 60 phút PT, khách chấm 3★ → 100.000 − 25.000 = 75.000, không bonus,
thuế 7.500 → **thực nhận 67.500**.

## 4. VIỆC TỒN ĐỌNG PHẢI XỬ LÝ TRƯỚC

### 4.1 Build đang fail — chưa ai xác minh

Báo cáo Đợt 2 nói build fail do *"thư mục `/admin/` thiếu file giao diện gốc"*. **Điều này sai.**
Đã kiểm cả trên đĩa lẫn `git ls-tree HEAD`:

```
app/admin/support/employee/[id]/page.tsx   → CÓ, 34.959 bytes, có export default
app/admin/settings/invoice/page.tsx        → CÓ, 431 bytes, có export default
```

Không file nào trong `app/admin/` bị sửa ở đợt này. `PageNotFoundError` lúc *Collecting page data*
thường là **`.next` cache hỏng** do chạy `next build` khi `next dev` đang chiếm cùng thư mục.

Việc cần làm **trước tiên**: dừng dev server, chạy `rm -rf .next && npm run build`, dán output thật.
Nếu vẫn fail thì đó là lỗi thật, phải xử lý xong mới đụng tiếp vào phần tiền — build fail nghĩa là
không deploy được.

### 4.2 Xác nhận phạm vi công việc

Từ 22:13–22:31 có thêm các file mới không nằm trong plan lương:
`AttendanceTypeD.tsx`, `app/api/ktv/type-d/on-call/`, `lib/services/KtvTypeDOnlineService.ts`,
`scripts/backfill_type_d_allow_on_call.ts`.

Nếu đây là việc chủ dự án giao riêng thì bỏ qua ghi chú này. Nếu là tự mở rộng, **dừng lại**
và làm xong phần tiền trước — đang có dữ liệu lương sai tích tụ mỗi ngày.

## 5. KHÔNG ĐƯỢC LÀM

- Không đổi quy ước lưu trữ: `KTVDailyLedger.total_bonus` **vẫn lưu ĐIỂM**. Chỉ sửa chỗ **đọc ra**.
- Không tính lại ledger trước `2026-09-01` (Option B đã chốt).
- Không viết công thức mới — gọi lại `KtvTypeDCommissionService` / `KtvTypeDBonusService`.
- Không sửa `app/api/ktv/history/*` và `app/ktv/history/*` mà không báo trước.

## 6. LƯU Ý KỸ THUẬT

- `SystemConfigs.value` là **jsonb**: `true`/`false`/số viết trần được, **chuỗi phải bọc nháy kép**
  (`'"2026-09-01"'` hoặc `to_jsonb('...'::text)`), nếu không sẽ lỗi `22P02`.
- Đọc config phải chuẩn hoá (`String(v).replace(/"/g,'')`), giá trị có thể về dạng số, boolean,
  hoặc chuỗi có nháy.
- Ngày giờ nghiệp vụ dùng `lib/vn-time.ts`, không `new Date()` trần.

## 7. BẮT BUỘC TRƯỚC KHI BÁO XONG

1. Output `rm -rf .next && npm run build` (mục 4.1) — dán nguyên văn.
2. Output `npx tsc --noEmit`.
3. **Bảng đối chiếu 3 nguồn** ở mục 3 — đây là phần quan trọng nhất, không có thì coi như chưa xong.
4. Mở thật `/ktv/wallet` và `/ktv/history` bằng tài khoản Loại D, xem Console có lỗi đỏ không.
   Build xanh không đồng nghĩa chạy được — đã có tiền lệ `api-endpoints.ts` mất `${employeeId}`,
   TypeScript không bắt được, build xanh mà màn điểm danh chết sạch.
5. Kết quả rà 3 chỗ đọc `total_bonus` ở mục 2: chỗ nào là điểm, chỗ nào là tiền, chỗ nào đã sửa.
6. Nói rõ mục nào **chưa test được**, đừng báo "xong" chung chung.
