# Plan bổ sung — Khóa Tan Ca & Thuế TNCN 10%

> Bổ sung/đính chính cho `plans/plan_khoa_tan_ca_va_thue_10.md` (bản anti soạn).
> Nguồn nghiệp vụ: `v16.md` PHẦN 4 mục 1 + PHẦN 1 mục 1. Quyết định đã duyệt của chủ dự án giữ nguyên, phần dưới chỉ đính chính **cấu trúc kỹ thuật** cho khớp code thật.
> Soạn 02/09/2026, sau khi đối chiếu trực tiếp từng file.

---

## 0. Tiến độ hiện tại (kiểm lúc soạn file này)

Nhánh `feat/bit-lo-hong-phase1`, **chưa có commit nào**, toàn bộ nằm ở working tree.

| Hạng mục | Trạng thái |
|---|---|
| **B** — đá văng đơn cha SPLIT | ✅ **XONG**. V1 đã vá đủ: cả 2 nhánh đều dọn `KtvAssignments` (`handleGetBooking.ts:145-150` đổi `booking_id`, `:160-165` set `CANCELLED`), lọc đúng `employee_id`+`business_date`, có thêm `.order('timeStart')` |
| **C** — test race condition | ✅ **XONG**. Đã đổi sang gọi `PATCH` thật, assert `handover_images` (dòng 66) và assert status **Booking** ở kịch bản 3 (dòng 129) |
| `npx tsc --noEmit` | ✅ sạch |
| Chạy test | ❌ **chưa có output nào được dán lại** |
| **A** — khóa nút Tan ca | ⛔ chưa bắt đầu |
| Thuế 10% | ⛔ chưa bắt đầu |

**Còn 1 lỗi nhỏ trong test**: `scripts/test_race_condition_handover.ts:12` hardcode `localhost:3003`, nhưng comment dòng 7 ghi `localhost:3000` và `npm run dev` mặc định chạy 3000. Thống nhất lại 1 cổng, hoặc đọc từ `process.env.TEST_API_URL`.

---

## 1. Khóa nút Tan ca — DUYỆT, bổ sung 3 việc còn thiếu

Nghiệp vụ giữ **nguyên như đã duyệt**: toggle thủ công, ẩn nút (không phải làm mờ), áp cho mọi KTV trong danh sách tua kể cả đã hết giờ ca, **không tự động nhả**, các thao tác khác (xin tạm nghỉ / SUDDEN_OFF / OFF_REQUEST) vẫn cho phép.

### 1.1 ⛔ THIẾU: chốt chặn phía Backend

Bản plan liệt kê 5 đầu việc kỹ thuật, **không có việc nào đụng `app/api/ktv/attendance/route.ts`**. Ẩn nút chỉ là ẩn giao diện — KTV gọi thẳng API từ điện thoại vẫn tan ca được bình thường. Ẩn UI **không phải** là biện pháp kiểm soát.

**Phải thêm:** trong khối `if (checkType === 'CHECK_OUT' || selectedShiftType === 'SUDDEN_OFF_CHECKOUT')` (`app/api/ktv/attendance/route.ts:119-153`), sau đoạn check task chưa nghiệm thu, thêm check khóa → trả **403**: *"Quầy vừa báo có khách. Vui lòng giữ máy, chưa thể tan ca lúc này."*

Chỗ này đã có sẵn tiền lệ đọc config theo `work_type` ở dòng 131 — dùng lại đúng khuôn mẫu đó.

**Không chặn** `checkType === 'SUDDEN_OFF'` và `OFF_REQUEST`, đúng như quyết định "các thao tác khác vẫn bình thường".

### 1.2 ⛔ THIẾU: ràng buộc "chỉ 1 record active"

Plan nêu mục tiêu nhưng không nói cách làm. Lễ tân bấm 2 lần → 2 record ON → tắt 1 cái vẫn còn khóa, KTV vẫn kẹt.

**Phải thêm** vào migration:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS "GuestArrivalEvents_single_active"
ON "GuestArrivalEvents" ((released_at IS NULL))
WHERE released_at IS NULL;
```
Kèm đó, API `POST` phải là **idempotent**: đang có khóa mở sẵn thì trả về khóa đó, không insert thêm.

### 1.3 ⛔ THIẾU: đường thoát khi lễ tân quên tắt

Đã bỏ TTL theo quyết định. Nhưng phải có ít nhất 2 van an toàn:

- **Admin tắt được**: API `DELETE` cho phép cả quyền admin, không chỉ `dispatch_board`. Nếu lễ tân bật rồi về mất, phải có người tắt hộ.
- **Kill-switch tính năng**: config `guest_arrival_lock_enabled` (bool). Khi `false` thì nút chỉ gửi thông báo, không khóa. Cần cho lúc tính năng lỗi mà không kịp deploy.
- **Hiển thị ai bật, lúc nào**: nút toggle khi đang ON phải hiện `Đang khóa — bật bởi <tên lễ tân> lúc HH:mm`. Không có dòng này thì ca sau không biết vì sao khóa, không dám tắt.

### 1.4 ✅ ĐÃ CHỐT (02/09/2026)

| Câu hỏi | Quyết định |
|---|---|
| TTL tự nhả bao nhiêu phút? | **Không có TTL. Bấm tay hoàn toàn** — lễ tân bật, lễ tân tắt |
| Phạm vi khóa | **Chỉ KTV `TYPE_D`**. A/B/C không bị ảnh hưởng |
| KTV đã hết giờ ca có bị khóa không? | **Có — vì TYPE_D không có khái niệm ca.** Chưa báo về là vẫn đang nhận khách, nên vẫn bị khóa |

**Hệ quả kỹ thuật của câu 3 — bẫy phải tránh:** `Attendance.logic.ts:337` có early-return trả `canCheckOut: true` cho `FREE / REQUEST / SUPPORT / VIP`. **Không được nhét khóa vào biến `canCheckOut`** — sẽ bị early-return nuốt mất. Khóa phải là **điều kiện độc lập**, đứng ngoài toàn bộ logic giờ ca.

Vì bỏ TTL nên các van an toàn ở §1.3 (admin tắt được, kill-switch, hiện "bật bởi ai lúc nào") **chuyển từ nên-có thành bắt buộc** — đó là đường thoát duy nhất còn lại.

### 1.5 Danh sách file (đã chốt lại đầy đủ)

| File | Việc |
|---|---|
| `supabase/migrations/20260902090000_create_guest_arrival_events.sql` [NEW] | Bảng + partial unique index (§1.2) + realtime publication + seed `guest_arrival_lock_enabled` |
| `app/api/reception/guest-arrival/route.ts` [NEW] | `POST` bật (idempotent) / `DELETE` tắt (cho cả admin) / `GET` trạng thái |
| `app/reception/dispatch/page.tsx` | Nút toggle + dòng "bật bởi ai, lúc nào" |
| `app/api/ktv/attendance/status/route.ts` | Trả `guestArrivalLock` — ⚠️ route có **8 nhánh return** (dòng 134-185), phải thêm **đủ cả 8** |
| **`app/api/ktv/attendance/route.ts`** | **Chốt 403 (§1.1) — việc bị thiếu trong plan gốc** |
| `app/ktv/attendance/Attendance.logic.ts` | State + subscribe realtime (mẫu có sẵn dòng 186-210) |
| `app/ktv/attendance/page.tsx` | **Ẩn** nút Tan ca + hiện thông báo "Quầy vừa báo có khách. Vui lòng giữ máy." |
| `app/ktv/attendance/_components/AttendanceTypeB.tsx` | Ẩn nút Check-out tương ứng — bỏ file này là KTV Type B lách được |

---

## 2. Thuế TNCN 10% — PHẢI VIẾT LẠI phần cấu trúc kỹ thuật

Nghiệp vụ (10% trên tua + bonus, chỉ TYPE_D, hiện dòng thuế trong lịch sử) **giữ nguyên**. Ba điểm kỹ thuật dưới đây sai với code thật, code theo bản gốc sẽ không chạy.

### 2.1 ⛔ `KTVWalletTransactions` KHÔNG TỒN TẠI

Grep toàn repo (code + migrations): **0 kết quả**. Không có bảng này, nên cũng không có trường `metadata` để nhét `{taxDeducted, preTaxAmount}`.

Các bảng ví có thật: `KTVDailyLedger`, `KTVMonthlyLedger`, `KTVYearlyLedger`, `KTVWithdrawals`, `WalletAdjustments`, `KTVPiggyBank*`, `KTVServiceHoursLedger`, `TurnLedger`.

### 2.2 ⛔ Không tồn tại "bước chốt tiền cộng vào Ví khi khách review"

Ví TYPE_D **không phải mô hình sự kiện**, mà là **mô hình tính lại**, xem `lib/services/KtvTypeDWalletService.ts:35-80`:

- Ngày quá khứ → đọc `KTVDailyLedger`
- Từ ngày chốt sổ gần nhất tới nay → **tính trực tiếp từ bảng `Bookings`** mỗi lần mở ví

Nơi **duy nhất** ghi `KTVDailyLedger` là cron đêm `app/api/cron/sync-daily-ledger/route.ts`. Mà cron đó hiện **chưa xử lý TYPE_D dòng nào** (grep `TYPE_D` = 0 — đúng như `prompt_type_d_rollout_full.md` ghi Phase 8 dở dang).

→ **Không có "khoảnh khắc cộng tiền" để chen thuế vào.** Phải chọn tầng áp thuế.

### 2.3 ❓ QUYẾT ĐỊNH LỚN NHẤT cần chốt: trừ thuế ở tầng LƯU hay tầng HIỂN THỊ?

Vì ví có 2 nguồn số liệu, chọn sai là số dư **nhảy lúc nửa đêm** hoặc bị **trừ thuế 2 lần**.

| | Cách làm | Ưu | Nhược |
|---|---|---|---|
| **(a) — ĐỀ XUẤT** | `KTVDailyLedger` vẫn lưu **gross**; trừ 10% ở tầng đọc (`KtvTypeDWalletService.getBalance`) | Không đổi ý nghĩa cột `total_commission` → **không ảnh hưởng báo cáo tài chính** đang đọc cột này (`ktv-summary`, `ktv-bonus-summary`, `ktv-ranking`). Sửa sai/đổi thuế suất chỉ cần deploy, không phải chạy lại dữ liệu | Phải nhớ áp thuế ở **mọi** nơi hiển thị tiền KTV, kể cả `KTVMonthlyLedger`/`KTVYearlyLedger` |
| (b) | Ledger lưu **net** (đã trừ thuế) | Số trong DB là số thật KTV nhận | Đổi ý nghĩa `total_commission` cho riêng TYPE_D → mọi báo cáo dùng cột đó lệch; dữ liệu cũ đã ghi gross phải migrate |

**Đề xuất chốt (a).** Nếu chọn (a) thì phải ghi thành comment ngay đầu `KtvTypeDWalletService`: *"Ledger lưu GROSS, thuế trừ ở tầng đọc — cấm trừ thuế lần nữa ở cron."*

### 2.4 ⛔ THIẾU: ngày hiệu lực — nếu không có, ví KTV cũ sẽ tụt 10% ngay lập tức

`getBalance` tính **toàn bộ lịch sử từ `2026-05-04`** (`GLOBAL_START_DATE_STR`, dòng 7). Áp thuế mà không chặn theo ngày thì mọi thu nhập cũ của KTV TYPE_D **bị trừ hồi tố 10%** — số dư tụt ngay trong lần mở ví kế tiếp, và những khoản đã rút trước đó thành ra rút quá tay.

**Phải có config `ktv_type_d_tax_effective_from` (dạng `YYYY-MM-DD`)**, chỉ áp thuế cho thu nhập phát sinh **từ ngày đó trở đi**. Codebase đã có sẵn khuôn mẫu tương tự: `work_type_effective_from` dùng trong `KtvTypeDTurnService.getTurnQueue`.

Chốt giúp: ngày hiệu lực là ngày nào?

### 2.5 Nơi áp thuế — chính xác theo dòng code

Trong `lib/services/KtvTypeDWalletService.ts`:

- **Dòng 178-180** — `total_commission = ledgerSummary.comm + rt_commission`, `total_bonus = ledgerSummary.bonus + rt_bonus`. Đây là chỗ áp thuế.
- ⚠️ **Bonus là ví RIÊNG**, không nằm trong `gross_income` (dòng 183 chỉ cộng `total_commission + total_adjustment`; bonus trả qua `bonus_wallet_total`). Nên "(Tua + Bonus) − 10%" phải hiểu là **trừ 10% trên từng ví**, không phải gộp rồi trừ một lần.
- Thuế phải trừ **trước** khi trừ `total_withdrawn` / `total_pending` (dòng 184), không thì logic rút tiền sai.
- Trả thêm ra ngoài các trường: `tax_rate`, `tax_amount_commission`, `tax_amount_bonus`, `pre_tax_commission`, `pre_tax_bonus` — để UI render mà không phải tự tính lại.

### 2.6 Thuế suất phải là config, không hardcode

v16 ghi rõ đây là *"thông số cần cài đặt Loại D"*. Dùng key `ktv_type_d_tax_rate` (giá trị `0.1`).

⚠️ **Ô nhập cho key này nằm ở tab Admin "Loại D" — file `app/admin/settings/system/page.tsx`, đang là vùng của luồng TYPE_D Phase 5 đang code dở.** Không tự thêm vào file đó. Chỉ seed key qua migration, phần UI báo lại để chủ dự án điều phối giữa 2 luồng.

### 2.7 ⚠️ XUNG ĐỘT: 2 file UI trong plan gốc là của luồng khác

`app/ktv/wallet/page.tsx` và `app/ktv/history/page.tsx` thuộc **Phase 7 / Bước E của luồng TYPE_D rollout** (ví, ẩn Heo đất, giờ tích lũy). `grep -rl TYPE_D app/ktv/` hiện ra **0 file** → luồng kia chưa đụng nhưng sắp đụng.

Đây đúng là ô ❌ trong bảng chống xung đột §0 của `prompt_bit_lo_hong_van_hanh_phase1.md`. **Phải chốt ai làm 2 file này trước khi code**, không thì 2 luồng ghi đè nhau.

Ngoài ra, theo v16 §1 thì chi tiết tiền phải hiện ở **Lịch sử Ví tiền**, tức `app/api/ktv/wallet/timeline/route.ts` — chứ không phải màn History (màn History lấy dữ liệu từ `API.KTV.HISTORY`, là lịch sử **đơn hàng**, không phải dòng tiền). Cần bổ sung route timeline vào phạm vi.

### 2.8 ⚠️ Màn REWARD sau tua sẽ hiện số lệch

`app/ktv/dashboard/KTVDashboard.logic.ts:1966-1985` tự tính hoa hồng **client-side** rồi `setCommission()` hiện lên cho KTV ngay sau khi xong tua. Trừ thuế ở ví mà không đụng chỗ này → KTV thấy **2 con số khác nhau** cho cùng một tua.

Mà v16 §1 lại ghi: *"Popup thông báo xong tua CHỈ báo hoàn thành, không báo số tiền (để bảo mật)"*. Nên hướng đúng nhiều khả năng là **tắt hiện tiền ở màn REWARD cho TYPE_D** (đã có sẵn cờ `ktv_instant_reward_enabled` xử lý đúng việc này ở dòng 2007), chứ không phải sửa cho khớp số.

Chốt giúp: TYPE_D có tắt hiện tiền sau tua không?

### 2.9 ❓ Thứ tự trừ: thuế trước hay quỹ nội bộ trước?

v16 §3 xếp thứ tự hiển thị: Gross → Thuế 10% → Quỹ nội bộ. Cần ghi rõ **quỹ nội bộ tính trên số trước thuế hay sau thuế** — chênh nhau vài chục nghìn mỗi KTV mỗi tháng.

---

## 3. Thứ tự thi công đề xuất

1. **Vá nốt cổng test** (5') → chạy `npm run test:race`, dán output → **commit hạng mục B + C** (đang treo, làm xong rồi mà chưa commit).
2. **Hạng mục A** — làm được ngay, không phụ thuộc câu hỏi nào ngoài §1.4. Ước ~3h.
3. **Thuế 10%** — **chưa code**, chờ chốt §2.3 (tầng áp thuế), §2.4 (ngày hiệu lực), §2.7 (ai giữ file UI), §2.8, §2.9.

---

## 4. Tổng hợp câu hỏi — trạng thái chốt

### Đã chốt 02/09/2026

| # | Câu hỏi | Quyết định |
|---|---|---|
| 1 | TTL khóa "có khách" | **Bấm tay hoàn toàn, không tự nhả** |
| 2 | Phạm vi khóa | **Chỉ TYPE_D** |
| 3 | KTV hết giờ ca có bị khóa? | **Có** — TYPE_D không có khái niệm ca |
| 4 | Thuế TNCN 10% có gộp vào đợt code này? | **Có — gộp chung Phase 1** |

### Còn treo — chặn phần thuế

| # | Câu hỏi | Đề xuất | Chặn việc gì |
|---|---|---|---|
| 5 | Trừ thuế ở tầng **lưu** hay tầng **hiển thị**? (§2.3) | **Tầng hiển thị** — ledger giữ gross, không đụng báo cáo tài chính | ⛔ Toàn bộ phần thuế |
| 6 | Ngày hiệu lực tính thuế? (§2.4) | **01/09/2026** (mốc áp dụng chính sách TYPE_D) | ⛔ Toàn bộ phần thuế — không có là ví KTV tụt 10% hồi tố |
| 7 | Ai giữ `app/ktv/wallet/page.tsx` + `history/page.tsx`? (§2.7) | Luồng này làm, luồng TYPE_D Phase 7 nhận sau | UI hiển thị thuế |
| 8 | TYPE_D có tắt hiện tiền màn REWARD sau tua? (§2.8) | **Tắt** — đúng v16 §1 "popup không báo số tiền" | Tính nhất quán con số |
| 9 | Quỹ nội bộ tính trên số **trước** hay **sau** thuế? (§2.9) | **Sau thuế** — theo thứ tự hiển thị v16 §3 | Công thức ví |
