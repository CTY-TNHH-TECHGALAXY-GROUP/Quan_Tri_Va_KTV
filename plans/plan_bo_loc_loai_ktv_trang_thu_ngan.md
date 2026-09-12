# Plan — Bộ lọc Loại KTV ở trang Thu Ngân KTV + hiện nhân viên Loại D

**Mức duyệt: 2** — chạm `app/api/finance/*` (tiền tua, ví, `WalletAdjustments`, `KTVWithdrawals`) và thêm nhánh đọc sổ cái Loại D.
**Trạng thái: ĐÃ DUYỆT — ĐÃ LÀM XONG (12/09/2026).** Kiểm bằng `scripts/qa/qa_17_finance_type_d_parity.ts`, đạt cả ở giờ hệ thống lẫn `TZ=UTC`.

---

## 1. Nguyên nhân gốc rễ — vì sao Loại D không hiện

Trang `app/finance/ktv` lấy bảng thống kê ví từ 2 API. Cả hai đều lọc nhân viên bằng **tiền tố mã**:

- `app/api/finance/ktv-summary/route.ts:44` → `.ilike('id', 'NH%')`
- `app/api/finance/ktv-bonus-summary/route.ts:26` → `.ilike('id', 'NH%')`

KTV Loại D mang mã `T001`, `T016`, `T069`… nên **rơi hết khỏi bộ lọc**. Đây đúng là lỗi đã từng xảy ra ở bảng Tính năng KTV và được ghi lại ngay trong `app/api/admin/staff-features/route.ts:17-20`: "trước đây bộ lọc là `ilike 'NH%'`… chặn luôn cả KTV Loại D mã `T001`, `T016`, `T069`… nên 11/12 KTV loại D không hiện".

Hệ quả kèm theo: lệnh rút tiền của Loại D **vẫn hiện** ở khối thẻ "Đang chờ ra quầy lấy tiền" (`/api/finance/withdrawals` không lọc mã), nhưng thu ngân **không có dòng nào** trong bảng thống kê để đối chiếu số dư trước khi giao tiền, cũng không bấm được nút Thưởng/Phạt cho họ.

### 1.1. Chỉ bỏ bộ lọc mã là CHƯA ĐỦ — số sẽ sai

`ktv-summary` tính tiền tua bằng cách quét lại `Bookings` + `KtvCommissionService`. Với Loại D công thức đó sai ở 3 chỗ:

| Điểm sai | Chi tiết |
|---|---|
| Sai công thức tua | Loại D tính theo `rate_per_60m` (VIP/PT), trừ theo sao, trừ thuế TNCN — nằm ở `KTVDTurnLedger` / `KtvDLedgerReader`. `KtvCommissionService.calcCommission` không biết gì về các quy tắc đó. |
| Sai tiền cọc | `KtvCommissionService.getAllConfigs` chỉ trả về `TYPE_A/B/C` (dòng 138-149). `commConfigs['TYPE_D']` = `undefined` → rơi về cấu hình `TYPE_A`, nên "Tiền khả dụng" trừ cọc 500k thay vì `ktv_deposit_amount_TYPE_D` (mặc định 1.000.000đ). |
| Sai phạm vi ví | Ví Loại D lọc `work_type_snapshot = 'TYPE_D'` trên `WalletAdjustments` / `KTVWithdrawals` và loại dòng tín hiệu "Báo trước" (`laDongTinHieu`). `ktv-summary` không làm cả hai. |

Nguồn đúng đã có sẵn và đang được app KTV dùng: `KtvWalletService.getBalance` → `KtvTypeDWalletService.getBalance` → `KtvDLedgerReader`. Theo mục 4.2 của CLAUDE.md, phía Quản lý phải gọi **cùng nguồn** đó, không được tính lại.

> ⚠️ Lỗi đang có trên production: KTV Loại D nào lỡ mang mã `NH…` (theo ghi chú ở `staff-features` là 1/12 người) **đang hiện với số tiền sai** trên bảng này. Sửa lần này chữa luôn ca đó.

### 1.2. Ví Bonus (điểm) và Loại D

Với Loại D, thưởng 4★ **đã nằm thẳng trong tiền tua** (`KtvDLedgerEngine.applyBonusAndTax`); `KtvTypeDWalletService` ghi rõ `total_bonus = 0` và giữ trường này chỉ để giao diện cũ không vỡ. Nên tab "Ví Bonus (Points)" **không áp dụng** cho Loại D — đề xuất không liệt kê Loại D ở tab này, kèm dòng chú thích, thay vì hiện một loạt dòng 0 pts gây hiểu nhầm là "chưa được thưởng".

---

## 2. Phạm vi thay đổi

### 2.1. `lib/services/KtvTypeDWalletService.ts` — thêm hàm cho phía Quản lý

Thêm `getFinanceSummary(supabase, staffId, fromDate?, toDate?)`, dùng lại đúng các mảnh của `getBalance`:

- Số dư / khả dụng / cọc / chờ duyệt (all-time) → tái dùng `getBalance` (không đổi công thức, không đổi kết quả cho app KTV).
- Cột theo kỳ (`Tiền Tua`, `Tiền Tip`, `Đã rút trong kỳ`, `Thưởng/Phạt`, `Số dư kỳ trước`) → `getRows` trên `KTVDTurnLedger` theo **`work_date`** (ngày làm việc) + `sumByStaff`, loại dòng `is_provisional` đúng như ví.
- `WalletAdjustments` / `KTVWithdrawals` theo kỳ: lọc `work_type_snapshot = 'TYPE_D'` và loại dòng tín hiệu bằng đúng hàm `laDongTinHieu` đang có.
- Trả thêm `accumulated_hours` (giờ tích lũy tháng) và `total_tax_deducted` để bảng thu ngân hiện được.

Lý do đặt ở service chứ không đặt trong route: mục 4.2 — công thức một nguồn duy nhất.

### 2.2. `app/api/finance/ktv-summary/route.ts`

1. Đổi bộ lọc nhân viên: bỏ `.ilike('id','NH%')`, thay bằng tiêu chí "là KTV có tài khoản app" giống `staff-features`:
   - `Staff.status = 'ĐANG LÀM'`
   - join `Users.code` → chỉ giữ `role ∈ {TECHNICIAN, KTV}` (loại lễ tân, admin, dev)
   - loại mã placeholder `^(EXT|C_)` (KTV ngoài gõ tay, ô gộp trên bảng điều phối)
2. Rẽ nhánh theo `work_type`: `TYPE_D` → gọi `KtvTypeDWalletService.getFinanceSummary`; còn lại giữ nguyên luồng hiện tại **không đụng một dòng nào**.
3. Thêm `work_type` vào payload mỗi dòng (bộ lọc UI cần).
4. Bỏ khối tính `netHoursMap` bằng `KtvTypeDTurnService.getMonthlyNetHours` nếu hàm mới đã trả giờ — tránh 2 nguồn giờ (sẽ giữ đúng 1).

### 2.3. `app/api/finance/ktv-bonus-summary/route.ts`

- Đổi bộ lọc nhân viên giống 2.2.
- Loại `work_type === 'TYPE_D'` khỏi kết quả (lý do ở 1.2), trả thêm `work_type` cho các loại còn lại.

### 2.4. `app/finance/ktv/FinanceKTV.logic.ts`

- Thêm state `filterWorkType: 'ALL' | 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D'`.
- `filteredSummaries` / `filteredBonusSummaries` lọc thêm theo `work_type`.
- `staffList` (dropdown chọn KTV) chỉ liệt kê người thuộc loại đang chọn; đổi loại thì reset `filterStaffId` về `ALL` để không kẹt ở một người không còn trong danh sách.
- Thêm `countsByType` để hiện số lượng mỗi loại trên nhãn bộ lọc.

### 2.5. `app/finance/ktv/page.tsx`

- Thêm `<select>` "Loại KTV" cạnh 2 bộ lọc sẵn có (Tất cả loại / Loại A / B / C / D + số lượng).
- Mỗi dòng bảng: thêm chip nhỏ ghi loại (`Loại A`…`Loại D`) dưới mã KTV.
- Tab Ví Bonus: khi chọn Loại D → hiện dòng giải thích "Loại D không dùng ví điểm — thưởng 4★ đã cộng thẳng vào tiền tua".
- Nhãn hiển thị để ở `*.i18n.ts` (mục 6), không hard-code chuỗi trong `.tsx`.

**Không đụng**: `/api/finance/withdrawals`, `/api/finance/adjustment`, luồng duyệt/từ chối rút tiền, mọi file phía KTV.

---

## 3. Bảng Ảnh hưởng chéo (CLAUDE.md mục 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API bị ảnh hưởng | `app/ktv/wallet` → `/api/ktv/wallet/balance` → `KtvWalletService.getBalance`. **Không ảnh hưởng** — chỉ *thêm* hàm mới vào `KtvTypeDWalletService`, `getBalance` giữ nguyên chữ ký và thân hàm. | `app/finance/ktv`, `/api/finance/ktv-summary`, `/api/finance/ktv-bonus-summary` — **Sửa** | `KtvTypeDWalletService`, `KtvDLedgerReader`, `KTVDTurnLedger` | Sửa phía Quản lý; phía KTV không đổi |
| Số liệu tiền tua / tip / thuế (Loại D) | Ví KTV lấy từ `KtvDLedgerReader.getRows` + `sumByStaff` (`take_home`) | Nay lấy **cùng** nguồn đó qua `getFinanceSummary` | `KTVDTurnLedger` | Khớp (trước đây Lệch vì quét lại `Bookings`) |
| Tiền cọc / khả dụng (Loại D) | `ktv_deposit_amount_TYPE_D` | Nay cùng config đó | `SystemConfigs` | Khớp (trước Lệch: dùng cọc `TYPE_A`) |
| Rút tiền / điều chỉnh (Loại D) | Lọc `work_type_snapshot='TYPE_D'`, bỏ dòng tín hiệu `amount=1` | Nay lọc y hệt | `KTVWithdrawals`, `WalletAdjustments` | Khớp |
| Giờ tích lũy (Loại D) | `app/ktv/hours-ranking` → `KtvDLedgerReader.netHoursByStaff` | `/api/admin/ktv-office/hours` + bảng thu ngân | `KTVDTurnLedger`, `KTVDPenaltyLedger` | Khớp — gom về 1 nguồn, bỏ `getMonthlyNetHours` ở route thu ngân |
| Số liệu Loại A/B/C | Không đổi | Không đổi — nhánh cũ giữ nguyên | `KtvCommissionService` | Không ảnh hưởng |
| Ví Bonus (điểm) | Loại D: `bonus_wallet_total = 0`, thưởng nằm trong tiền tua | Ẩn Loại D khỏi tab Bonus + chú thích | `KTVBonusLedger` | Khớp |
| Realtime / refresh | Không đổi | Vẫn poll 5 phút + refresh sau thao tác | — | Đồng bộ |
| Quyền xem | KTV chỉ thấy ví của mình | Thu ngân thấy toàn bộ KTV — đúng như hiện tại, chỉ thêm Loại D | quyền `finance_management` | Không lộ dữ liệu nội bộ |
| Danh sách nhân viên | Không ảnh hưởng | Bộ lọc mới có thể kéo thêm người từng bị mã `NH%` chặn nhầm | `Staff` + `Users.role` | Cần xác nhận ở bước kiểm (mục 5, bước 1) |

---

## 4. Rủi ro & phản biện

1. **Rủi ro lớn nhất: bộ lọc mới kéo nhầm người không phải KTV** (lễ tân, tài khoản test). Chốt chặn: bắt buộc có dòng trong `Users` với `role ∈ {TECHNICIAN, KTV}` **và** mã không phải `EXT_`/`C_`. Trước khi apply sẽ in ra danh sách mã được thêm vào để bạn duyệt bằng mắt.
2. **Hiệu năng**: `ktv-summary` hiện đã gọi `supabase` trong vòng lặp cho mỗi KTV Loại D (query `WalletAdjustments` BONUS). Thêm Loại D vào sẽ thành ~12 lượt. Sẽ gom `getRows` **một lần** cho toàn bộ Loại D thay vì gọi `getBalance` từng người, giữ số round-trip gần như cũ.
3. **Không tự gom công thức Loại A/B/C**: `ktv-summary` đang chép lại công thức tua của `KtvWalletService` (vi phạm mục 4.2 có sẵn từ trước). Task này **không** đụng vào — chỉ báo để bạn quyết định làm riêng, vì gom lại là một thay đổi Mức 2 khác, rủi ro lệch số cho toàn bộ KTV thường.
4. **Ngày làm việc vs ngày lịch**: cột theo kỳ của Loại D dùng `work_date` (ngày làm việc, ca đêm qua nửa đêm tính về ngày mở ca) trong khi Loại A/B/C dùng ngày lịch `timeStart + 7h`. Đây là khác biệt **cố ý** và đúng với app KTV (commit `8c1e0c1a` đã chốt hướng này), sẽ ghi chú ngay trong code.

---

## 5. Kiểm chứng trước khi báo xong (mục 10 + 4.3)

1. Script Node in danh sách KTV mà bộ lọc mới thêm vào so với `ilike 'NH%'` — xác nhận đúng 100% là KTV.
2. Với 2–3 KTV Loại D thật, in **so sánh 2 phía** cho cùng khoảng ngày:
   `/api/ktv/wallet/balance` (phía KTV) ↔ dòng tương ứng trong `/api/finance/ktv-summary` — `net_balance`, `available_balance`, `min_deposit`, `total_withdrawn`, `total_pending` phải **bằng nhau tuyệt đối**.
3. Kiểm biên ngày: `fromDate = toDate = ` một ngày có ca đêm qua nửa đêm; chạy thêm dưới `TZ=UTC` (mục 13.6).
4. Kiểm KTV Loại A bất kỳ: số liệu **không đổi** so với trước khi sửa (chụp trước/sau).
5. Kiểm bộ lọc UI: chọn từng loại → đếm dòng khớp `countsByType`; chọn Loại D ở tab Bonus → hiện chú thích, không hiện dòng 0 pts.

---

## 6. Việc cần làm sau khi apply

- Cập nhật `TableInSupabase.md`: cột `work_type` mới ghi `TYPE_A/B/C`, thiếu `TYPE_D` (dòng 369). Không đổi DB, chỉ sửa tài liệu cho khớp thực tế.
- Không tự commit, không push (mục 5). Gợi ý commit message:
  `fix(thu-ngan): hien KTV loai D va them bo loc theo loai KTV`


---

## 7. Kết quả thực tế sau khi apply

| Hạng mục | Số đo |
|---|---|
| Bộ lọc nhân viên | 14 → **26 dòng** (+12 KTV loại D). **Không ai biến mất.** |
| KTV loại D hiện ra | 13 người — 12 người trước đây bị chặn hoàn toàn (`T001…T079`) |
| Đối chiếu 2 phía | 9/9 chỉ tiêu khớp tuyệt đối cho **cả 13** KTV loại D |
| `NH079` (loại D mã NH) | Tiền cọc **500.000đ → 1.000.000đ**, số dư nay bằng đúng ví KTV |
| Tab Ví Bonus | 13 dòng, **không còn** loại D |

### 7.1. Hai điểm lệch so với plan ban đầu

1. **Giữ `KtvTypeDTurnService.getMonthlyNetHours`** thay vì tự gọi `netHoursByStaff` (mục 2.2 điểm 4 của plan). Lý do: hàm đó ĐÃ đọc từ `KtvDLedgerReader` — cùng một nguồn — và còn xử lý thêm `work_type_effective_from` (KTV mới chuyển sang loại D chỉ tính từ ngày chuyển). Tự viết lại là mất phần đó.
2. **Lọc vai trò bằng danh sách LOẠI TRỪ, không phải danh sách cho phép.** Bản nháp allowlist `TECHNICIAN` đã âm thầm xoá `NH099` (Daisy, vai trò `SUPPORT`) khỏi bảng — sửa lỗi loại D mà làm mất một người khác. Kịch bản QA nay có hẳn một mục chốt chặn "không ai biến mất".

### 7.2. Sửa kèm

- `/api/finance/ktv-summary`: tháng/năm để tính giờ tích luỹ lấy từ `todayStr` (đã +7h) thay vì `new Date().getMonth()` — server chạy UTC nên từ 17h ngày cuối tháng giờ VN đã sang tháng mới mà `getMonth()` vẫn trả tháng cũ (CLAUDE.md 13.5).
- `TableInSupabase.md`: cột `work_type` bổ sung `TYPE_D`.

### 7.3. Còn nợ (ngoài phạm vi task này)

`/api/finance/ktv-summary` vẫn **chép lại** công thức tua của `KtvWalletService` cho loại A/B/C — vi phạm mục 4.2 có từ trước. Gom lại là một thay đổi Mức 2 riêng, rủi ro lệch số cho toàn bộ KTV thường.
