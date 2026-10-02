# Prompt — Ledger Loại D: `total_commission` = THỰC NHẬN (gộp bonus, đã trừ thuế)

> Copy toàn bộ phần dưới gửi cho anti.
> Nối tiếp `plans/plan_sua_luong_thuong_type_d.md`. Cron riêng cho Loại D đã có.

---

## 0. Yêu cầu chủ dự án

Với KTV **Loại D**, `KTVDailyLedger.total_commission` phải là **SỐ TIỀN THỰC NHẬN**:

```
total_commission (Loại D) = hoa hồng (đã trừ theo sao) + bonus quy ra VNĐ − thuế TNCN 10%
```

`commission_breakdown` cũng phải tính lại theo cách đó — có bonus, có thuế, không chỉ hoa hồng.

## 1. Hiện trạng — chưa đúng ở 3 chỗ

File `app/api/cron/sync-daily-ledger-type-d/route.ts`:

| Cần | Đang chạy |
|---|---|
| `total_commission` = thực nhận | Là hoa hồng **gộp trước thuế**, **chưa cộng bonus** (`:184`) |
| Có tính thuế | `total_tax: 0` — **để cứng**, không hề tính (`:190`) |
| `commission_breakdown` có bonus + thuế | Chỉ có hoa hồng từng đơn (`:144`) |

Phần đã đúng, giữ nguyên: `work_type_snapshot = 'TYPE_D'`, `rating_deduction`, cron chung đã loại
hẳn Loại D bằng `.neq('work_type','TYPE_D')`, và cột `total_tax` đã tồn tại trong DB.

## 2. ⚠️ HAI BẪY TÍNH TRÙNG — ĐỌC TRƯỚC KHI SỬA

Đổi ý nghĩa `total_commission` mà không sửa ví thì KTV bị **trừ thuế hai lần** và **cộng bonus hai lần**.
Cả hai lỗi đều **không báo lỗi gì cả**, chỉ lặng lẽ sai tiền.

### Bẫy 1 — trừ thuế hai lần

`lib/services/KtvTypeDWalletService.ts:56-64` hiện đang tự trừ 10% khi đọc ledger:
```ts
let dayBonus = dayBonusPoints * pointRate;
if (l.date >= taxEffectiveDate) {
    const taxComm = dayComm * 0.1;
    const taxBonus = dayBonus * 0.1;
    dayComm -= taxComm;          // ← sẽ trừ CHỒNG lên số đã trừ thuế ở cron
    dayBonus -= taxBonus;
}
```
Ledger đã là số sau thuế → ví trừ tiếp 10% → KTV mất **19%** thay vì 10%.

### Bẫy 2 — cộng bonus hai lần

`KtvTypeDWalletService.ts:203-208`:
```ts
const total_commission = ledgerSummary.comm + rt_commission;
const total_bonus      = ledgerSummary.bonus + rt_bonus;
const gross_income     = total_commission + total_adjustment;   // bonus KHÔNG nằm trong số dư
```
Hiện bonus là **ví thưởng riêng**, không tính vào số dư. Nếu cron gộp bonus vào `total_commission`
mà ví vẫn cộng `ledgerSummary.bonus` vào ví thưởng như cũ, thì **cùng một khoản bonus xuất hiện
ở hai nơi**.

## 3. VIỆC CẦN LÀM — sửa TẤT CẢ trong MỘT lần, không tách đợt

### 3.1 Cron `sync-daily-ledger-type-d`

Với mỗi KTV, mỗi ngày `>= 2026-09-01`:

```
hoaHong    = tổng KtvTypeDCommissionService (đã tách VIP/PT/COMBO + trừ theo sao)
bonusVND   = tổng KtvTypeDBonusService                    (chỉ khi ≥ 4★)
thuNhap    = hoaHong + bonusVND
thue       = 10% × thuNhap        nếu date >= ktv_type_d_tax_effective_from, ngược lại 0
thucNhan   = thuNhap − thue
```

Ghi vào ledger:
| Cột | Giá trị |
|---|---|
| `total_commission` | **`thucNhan`** ← ý nghĩa MỚI |
| `total_tax` | `thue` |
| `total_bonus` | vẫn là **ĐIỂM** — chỉ để tra cứu, **KHÔNG** dùng để cộng tiền nữa |
| `work_type_snapshot` | `'TYPE_D'` |
| `rating_deduction` | như hiện tại |
| `total_tip` | không đụng, tip không chịu thuế |

`commission_breakdown` phải ghi đủ để sau này giải trình được, mỗi đơn:
`{ bookingId, duration, rating, commissionGross, ratingDeductionAmount, bonusPoints, bonusVND }`
và một dòng tổng: `{ type: 'SUMMARY', hoaHong, bonusVND, thuNhap, thue, thucNhan }`.

⚠️ **Không được để mất số gộp trước thuế.** `total_commission` giờ là số ròng, nên nếu breakdown
không lưu số gộp thì vĩnh viễn không tách được "trả bao nhiêu hoa hồng, bao nhiêu thưởng" khi làm
báo cáo. Breakdown là nơi duy nhất còn giữ.

### 3.2 Ví `KtvTypeDWalletService` — sửa CÙNG LÚC

1. **Bỏ phép trừ 10% với phần đọc từ ledger.** `total_commission` của ledger đã là số ròng, dùng thẳng.
2. **Lấy `total_tax_deducted` phần ngày cũ từ cột `total_tax`** của ledger, thay vì tự tính lại.
3. **Không cộng `ledgerSummary.bonus` vào ví thưởng nữa** — bonus ngày cũ đã nằm trong
   `total_commission`. Cột `total_bonus` (ĐIỂM) chỉ dùng để **hiển thị số điểm**, không cộng tiền.
4. **Phần hôm nay (realtime) phải ra cùng dạng số**: `rt_commission` cũng phải là
   `hoaHong + bonusVND − thuế` để cộng với ledger cho đồng nhất. Không được ngày cũ là số ròng
   mà hôm nay là số gộp.
5. Rà lại `gross_income`, `net_balance`, `available_balance`, `bonus_wallet_total` xem còn chỗ nào
   cộng trùng không.

### 3.3 Chạy lại ledger

Sau khi sửa, chạy lại cron D cho **01/09, 02/09, 03/09** (các ngày từ mốc trở đi) để ghi lại theo
ý nghĩa mới. **Không** chạy cho ngày trước 01/09 (Option B).

### 3.4 Cập nhật mô tả cột trong DB

Migration `supabase/migrations/20260903110000_add_total_tax_to_ledger.sql` đang ghi chú
"total_commission lưu số gộp trước thuế" — **nay đã sai**. Viết migration mới cập nhật `COMMENT`:
- `total_commission`: "Voi TYPE_D: SO THUC NHAN (hoa hong + bonus - thue). Voi loai khac: hoa hong gop."
- `total_tax`: "Thue TNCN da tru, DA phan anh trong total_commission cua TYPE_D."
- `total_bonus`: "DIEM thuong. Voi TYPE_D chi de tra cuu, tien da nam trong total_commission."

File UTF-8. Ghi rõ vì chính chỗ thiếu chú thích đơn vị đã gây lỗi lệch 1000 lần trước đây.

## 4. Việc chưa xong từ đợt trước — làm luôn

### 4.1 Giải thích chênh lệch T016
```
02/09  T016 (Loại D)   ledger comm = 225.000 đ
                       audit Đợt 1 "đúng luật" = 25.000 đ
```
Gấp 9 lần, chưa ai giải thích. Truy đơn thật của T016 ngày 02/09 (items, serviceId, segments,
rating), tính tay, nói rõ **bên nào đúng**. Nếu cron sai thì phải sửa trước khi ghi đè dữ liệu mới.

### 4.2 Build chưa từng chạy thành công
Không có `.next/BUILD_ID` trên đĩa → `next build` **chưa bao giờ hoàn tất**, dù hai báo cáo trước
đều nói đã chạy. Lần này chạy thật: `rm -rf .next && npm run build`, dán output nguyên văn.

### 4.3 Dọn code chết
Cron chung đã loại Loại D ở tầng query (`:55`), nhưng vẫn còn nhánh `if (work_type === 'TYPE_D')`
ở `:152` và `:193` — không bao giờ chạy tới. Xoá cho khỏi gây hiểu nhầm về sau.

### 4.4 `rating_deduction` đang lấy sao thấp nhất cả ngày
`sync-daily-ledger-type-d:172` dùng `lowestRating` của toàn bộ đơn trong ngày. KTV có 2 đơn,
một 5★ một 2★ → cả ngày bị ghi trừ 50%, dù chỉ đơn 2★ bị trừ. Cột này để tra cứu nên gây hiểu
nhầm khi đối chiếu. Đề xuất: ghi mức trừ **bình quân theo tiền**, hoặc để `null` khi các đơn
trong ngày có mức trừ khác nhau. Báo cáo phương án trước khi làm.

## 5. TIÊU CHÍ NGHIỆM THU

Chọn 1 KTV Loại D + 1 ngày từ 01/09, đối chiếu và nộp bảng:

| Nguồn | Phải khớp |
|---|---|
| Ledger | `total_commission` = thực nhận · `total_tax` = thuế |
| Ví | Số dư dùng đúng `total_commission`, **không** trừ thuế lần hai, **không** cộng bonus lần hai |
| Lịch sử | Tổng `netIncome` các đơn trong ngày = `total_commission` của ledger |

Bài kiểm bắt buộc — **tự tính tay rồi so**:
> Tua 60 phút PT, khách chấm **3★**: 100.000 − 25.000 = **75.000**, không bonus (dưới 4★),
> thuế 7.500 → **thực nhận 67.500**.
> Tua 60 phút PT, khách chấm **5★**: 100.000, bonus 20.000 → 120.000, thuế 12.000 →
> **thực nhận 108.000**.

Chạy cron **hai lần liên tiếp** → số không đổi (idempotent), không nhân đôi.

## 6. BẮT BUỘC TRƯỚC KHI BÁO XONG

1. Output `rm -rf .next && npm run build` — nguyên văn.
2. Output `npx tsc --noEmit`.
3. Trả lời 4.1: **225.000 hay 25.000 đúng?**
4. Dán 1 dòng ledger Loại D sau khi chạy lại, đủ các cột `total_commission`, `total_tax`,
   `total_bonus`, `work_type_snapshot`, `rating_deduction`.
5. Bảng đối chiếu 3 nguồn ở mục 5 + kết quả 2 bài kiểm tính tay.
6. Xác nhận đã rà xong 2 bẫy tính trùng ở mục 2, chỉ rõ đã sửa ở dòng nào.
7. Nói rõ mục nào **chưa test được**.

## 7. KHÔNG ĐƯỢC LÀM

- Không sửa cron mà **không sửa ví trong cùng lần** — đó là nguyên nhân trừ thuế / cộng bonus hai lần.
- Không tính lại ledger trước `2026-09-01`.
- Không sửa `app/api/ktv/history/*`, `app/ktv/history/*` mà không báo trước.
- Không viết công thức mới — gọi lại `KtvTypeDCommissionService` / `KtvTypeDBonusService`.
