# Prompt — Sửa lương & thưởng KTV Loại D

> Copy toàn bộ phần dưới gửi cho anti.
> Kế hoạch đầy đủ: `plans/plan_sua_luong_thuong_type_d.md` — đọc trước khi code.

---

## 0. ĐỌC KỸ TRƯỚC KHI GÕ DÒNG NÀO

Đây là **tiền lương thật của nhân viên**, không phải giao diện. Sai một con số là sai vào túi người ta.
Ba nguyên tắc bắt buộc, vi phạm là hỏng việc:

1. **Đợt 1 chỉ ĐỌC, không ghi.** Không `UPDATE`, không `INSERT`, không chạy cron thật.
2. **Không tự ý tính lại ledger cũ.** Chủ dự án chưa chốt cách xử lý số cũ (mục 5).
3. **Không viết công thức mới.** Gốc của toàn bộ lỗi này là đang tồn tại HAI đường tính song song.
   Thêm đường thứ ba là tái diễn đúng cái bẫy đó.

## 1. Bối cảnh: ví Loại D lấy số từ hai nguồn không cùng luật

`KtvTypeDWalletService.getWalletSummary()` cộng hai phần:

| Phần | Nguồn | Hàm tính |
|---|---|---|
| Ngày cũ | bảng `KTVDailyLedger` | cron `app/api/cron/sync-daily-ledger` ghi mỗi đêm |
| Hôm nay | tính trực tiếp từ `Bookings` | `KtvTypeDCommissionService` + `KtvTypeDBonusService` |

Hai đường này **không dùng chung luật**. Triệu chứng đặc trưng: KTV thấy số đúng trong ngày,
qua đêm chốt sổ là số đổi.

## 2. Hai lỗi ĐÃ SỬA — đừng đụng lại

- **Thuế TNCN 10%**: thiếu key `ktv_type_d_tax_effective_from` trong `SystemConfigs` nên mốc rơi về
  `2099-01-01`, không ai bị trừ. Đã insert `'2026-09-01'`, đang chạy.
- **Tua dưới 60 phút mất thưởng**: `KtvCommissionService.calculateBookingBonus()` áp luật
  "dưới 60 phút / khách thì 0 điểm" cho **mọi** loại KTV. Đã thêm cờ `isTypeD` để miễn cho Loại D.

## 3. VIỆC CẦN LÀM

### Đợt 1 — Script đối chiếu (CHỈ ĐỌC). Làm xong dừng lại, báo cáo, chờ duyệt.

Tạo `scripts/audit_type_d_wallet.ts`. Nhận tham số khoảng ngày. Với mỗi KTV `work_type = 'TYPE_D'`
và mỗi ngày trong khoảng, in ra bảng so sánh:

| Cột | Nguồn |
|---|---|
| `ledger_commission`, `ledger_bonus` | đọc thẳng từ `KTVDailyLedger` |
| `dung_luat_commission` | tính lại bằng `KtvTypeDCommissionService.calculateGuestCommission` |
| `dung_luat_bonus` | tính lại bằng `KtvTypeDBonusService.calculateBonusForTypeD` |
| `chenh_lech` | hiệu số, và tổng theo từng KTV |

Yêu cầu:
- **Xuất CSV** ra `scripts/output/` — đây là ảnh chụp trước khi sửa, là căn cứ nếu phải truy thu / bù.
- Ghi rõ đơn vị từng cột (xem §4 — đây là chỗ dễ sai nhất).
- Tuyệt đối không ghi vào DB.
- Chạy thử trên **1 KTV, 1 ngày** trước; đối chiếu tay với số trên app rồi mới chạy toàn bộ.

**Dừng ở đây. Gửi file CSV + bảng tổng chênh lệch theo từng KTV. Chờ duyệt mới sang Đợt 2.**

### Đợt 2 — Sửa cron chốt sổ (chỉ làm sau khi Đợt 1 được duyệt)

`app/api/cron/sync-daily-ledger/route.ts:124`:
```ts
const workType = ktv.work_type === 'TYPE_B' ? 'TYPE_B'
               : ktv.work_type === 'TYPE_C' ? 'TYPE_C'
               : 'TYPE_A';        // ⚠️ TYPE_D rơi vào đây
```

Loại D bị tính bằng bảng giá **Loại A**. Khác biệt thực chất:

| Tiêu chí | Luật Loại D (đúng) | Ledger đang chạy (Loại A) |
|---|---|---|
| Đơn giá | VIP 180.000 / PT 100.000 (`ktv_type_d_vip_rate_per_60m`, `..._pt_rate_per_60m`) | `milestones` + `ratePer60` của Loại A |
| Tách VIP / PT | Có (tiền tố `NHP` / `NHT` / `VIP`) | Không |
| Trừ theo sao | Có (`ktv_type_d_rating_deduction`) | Không |
| Thời lượng | Theo `segments` (giờ chạy thật, có `customCommissionDuration`) | Mặc định 60 nếu thiếu |

Việc cần làm: tách nhánh riêng cho `work_type === 'TYPE_D'`, **gọi lại đúng hai service realtime**
(`KtvTypeDCommissionService`, `KtvTypeDBonusService`). Không sao chép công thức sang file cron.

Thêm tham số `?dryRun=1` cho route cron: chạy đủ logic nhưng **chỉ trả JSON, không ghi DB**.
Dùng nó để so với CSV của Đợt 1 trước khi cho chạy thật.

### Đợt 3 — Thống nhất đơn vị bonus

Xem §4. Sửa `KtvTypeDWalletService` nhân `ledgerSummary.bonus × pointRate` khi cộng.
Rà thêm `app/api/finance/ktv-bonus-summary`, `KtvLedgerSyncService`, `app/api/ktv/wallet/timeline`
xem có chỗ nào đang hiểu `total_bonus` là VNĐ không.

## 4. ⚠️ BẪY ĐƠN VỊ — đọc kỹ, đây là lỗi nặng nhất

Quy ước hệ thống: **`KTVDailyLedger.total_bonus` lưu ĐIỂM**, không phải VNĐ
(`calculateBookingBonus` trả `Math.floor(calculatedPoints)`). Các loại KTV khác nhất quán điểm-với-điểm.

Nhưng `KtvTypeDWalletService` đang:
```ts
ledgerSummary.bonus += dayBonus;                              // ĐIỂM (ledger)
rt_bonus += KtvTypeDBonusService.calculateBonusForTypeD(...)  // VNĐ  (points × pointRate)
const total_bonus = ledgerSummary.bonus + rt_bonus;           // cộng hai đơn vị khác nhau
```

`pointRate = ktv_bonus_rate_TYPE_D = 1000`. Nghĩa là **thưởng ngày cũ đang nhỏ hơn 1000 lần**:
20 điểm hôm qua vào ví thành 20 đồng, đáng lẽ 20.000 đồng.

Khi viết script Đợt 1 phải ghi rõ cột nào là điểm, cột nào là VNĐ — nếu không sẽ tự tay tạo ra
báo cáo sai lệch 1000 lần rồi kết luận nhầm.

## 5. BA CÂU HỎI ĐÃ ĐƯỢC CHỦ DỰ ÁN CHỐT (02/09)

1. **Số cũ: GIỮ NGUYÊN (Option B).** Không tính lại ledger cũ, không ghi bù `WalletAdjustments`.
2. **Mốc áp dụng: từ 2026-09-01.** Luật Loại D đúng chỉ áp cho ngày `>= 2026-09-01`.
   Mọi ngày **trước 01/09 giữ nguyên số cũ**, không đụng tới.
3. **Chưa ai rút tiền thật trong giai đoạn Loại D.** Đã tra `KTVWithdrawals`: mọi lệnh rút đã duyệt
   của NH079 đều từ tháng 5–6/2026; các lệnh tháng 8 còn `PENDING`; không lệnh nào có
   `work_type_snapshot = TYPE_D`. ⇒ Không cần bù trừ, không có rủi ro âm ví.

### ⚠️ Ràng buộc bắt buộc đi kèm mốc 01/09

`sync-daily-ledger` nhận tham số ngày. Nếu ai đó backfill tháng 8 sau khi sửa, số cũ sẽ đổi —
phá vỡ quyết định "giữ nguyên số cũ". Vì vậy:

- Thêm hằng số `TYPE_D_RULE_EFFECTIVE_FROM = '2026-09-01'`.
- Nhánh Loại D **chỉ chạy khi `targetDateStr >= TYPE_D_RULE_EFFECTIVE_FROM`**.
- Ngày trước mốc: giữ nguyên đường tính cũ, hoặc **bỏ qua hẳn** không ghi đè dòng ledger đã có.
- Ghi log rõ khi bỏ qua, để sau này nhìn log biết vì sao ngày cũ không đổi.

Lưu ý số sẽ thay đổi: ngày 01/09 của NH079 hiện là `100.000`, theo luật đúng là `99.023`
(chênh −977). Đây là thay đổi **đúng dự kiến** vì 01/09 nằm trong mốc áp dụng.

## 6. LƯU Ý KỸ THUẬT

- Cột `SystemConfigs.value` là **jsonb**. `true` / `false` / số viết trần được, nhưng **chuỗi phải bọc
  nháy kép**: `'"2026-09-01"'` hoặc `to_jsonb('...'::text)`. Viết trần sẽ lỗi
  `22P02 invalid input syntax for type json`.
- Đọc cờ boolean từ `SystemConfigs` phải chuẩn hoá, đừng so `=== 'true'` — giá trị có thể về dạng
  boolean thật hoặc chuỗi có nháy. Xem `isGuestArrivalEnabled` trong `lib/guest-arrival.logic.ts`
  làm mẫu.
- Mọi so sánh ngày/giờ nghiệp vụ dùng `lib/vn-time.ts`, không `new Date()` trần
  (server chạy giờ UTC, lệch 7 tiếng).
- File migration lưu **UTF-8**, không UTF-16.

## 7. BẮT BUỘC TRƯỚC KHI BÁO XONG

1. Dán output `npx tsc --noEmit` (phải sạch).
2. Dán output `npm run build`.
3. Mở thật `/ktv/wallet` bằng tài khoản KTV Loại D, xem Console có lỗi đỏ không.
   Build xanh **không** đồng nghĩa chạy được — đã có tiền lệ `lib/api-endpoints.ts` mất `${employeeId}`
   khỏi URL, TypeScript không bắt được, build xanh mà màn điểm danh chết sạch.
4. Với Đợt 1: nộp file CSV + bảng tổng chênh lệch từng KTV, và nói rõ đã đối chiếu tay
   được bao nhiêu trường hợp.
5. Nói rõ mục nào **chưa test được**, đừng báo "xong" chung chung.
