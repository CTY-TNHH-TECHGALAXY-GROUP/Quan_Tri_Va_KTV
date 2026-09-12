# Plan — Màn Lịch Sử lọc theo NGÀY LÀM VIỆC (hiện đang lọc theo ngày lịch)

> **Mức 2** — chạm tiền/giờ của KTV (`app/api/ktv/history/route.ts`).
> **Trạng thái**: ⏳ Chờ duyệt. Việc tách ra từ `plan_vi_gom_theo_ngay_lam_viec.md` mục 8.
> **Ngày**: 12/09/2026 · **Nhánh**: `feat/bit-lo-hong-phase1`

---

## 1. Hiện tượng — tiền BIẾN MẤT khỏi Lịch Sử

Ví đã gom theo ngày làm việc (cutoff 6h). Lịch Sử thì chưa: nó lọc đơn theo
`Bookings.bookingDate` — ngày quầy đang chọn trên bảng điều phối — nhưng lấy tiền
từ `KTVDTurnLedger` lọc theo `work_date` (ngày làm việc). **Hai trục ngày khác nhau
trên cùng một màn.**

Khi hai trục lệch, đơn vẫn hiện nhưng `ledgerByGroup.get(...)` trượt → rơi vào
nhánh "không có dòng sổ cái" → `commission = 0`. Mà ngày kia thì đơn không được
liệt kê. Tiền **mất hẳn khỏi Lịch Sử**, trong khi Ví vẫn có.

Số thật (T016, gọi API thật hôm nay):

| Đơn | Sổ cái `work_date` | Ví hiện ở nhóm | `bookingDate` | Lịch Sử ngày đó | Lịch Sử ngày sổ cái |
|---|---|---|---|---|---|
| `005-02092026-B` | 01/09 | **01/09 · 100.000đ** | 02/09 | **0đ** ❌ | không có đơn ❌ |
| `WB-001-02092026-A` | 02/09 | **02/09 · 3.262đ** | 03/09 | **0đ** ❌ | không có đơn ❌ |

Quy mô: **2/36 tua loại D** trong sổ cái đang lệch trục (5,6%). Toàn bộ là tua chạy
quanh nửa đêm hoặc quầy chọn tay ngày khác.

## 2. Hai lỗi phụ trên cùng màn

1. **Bảng giờ tích luỹ ngay bên dưới đã dùng ngày làm việc.** `useKtvHoursLedger`
   lọc `rows.filter(r => picked.has(r.date))` với `r.date = work_date`. Nên cùng
   một màn, **khung giờ đúng mà khung tiền sai** — KTV thấy "có 1,7 giờ mà 0đ".
2. **Ngày mặc định không xét cutoff.** `selectedDates` khởi tạo bằng
   `getVnDateStr()` ([lib/time.logic.ts:30](../lib/time.logic.ts)) — ngày lịch
   thuần. KTV mở Lịch Sử lúc 00:30 thấy ngày MỚI trống trơn trong khi đang giữa ca.
   Bảng điều phối của quầy thì có trừ cutoff (`dispatch/page.tsx:164`) — nhưng viết
   tay `if (getUTCHours() < 6)` chứ không gọi `toBusinessDate`, vi phạm mục 4.2.

## 3. Đề xuất (một phương án)

**Cho Lịch Sử dùng đúng trục ngày của sổ cái và của Ví: ngày làm việc.**

| # | File | Thay đổi |
|---|---|---|
| 1 | `app/api/ktv/history/route.ts` | Nới cửa sổ truy vấn `Bookings` ra **±1 ngày** quanh khoảng người dùng chọn (đơn của ngày làm việc X có `bookingDate` X−1 hoặc X+1). |
| 2 | `app/api/ktv/history/route.ts` | Mỗi dòng trả về gắn `business_date`: loại D lấy thẳng `work_date` của sổ cái; dòng không có sổ cái (A/B/C, đơn huỷ) suy bằng `toBusinessDate(timeStart ?? createdAt, cutoff)`. Rồi **lọc lại** đúng khoảng đã chọn theo trường này. |
| 3 | `app/api/ktv/history/route.ts` | `getRows(...)` giữ nguyên `from/to` theo ngày làm việc — sau bước 2 thì hai bên cùng trục, hết trượt join. |
| 4 | `app/api/ktv/history/route.ts` | `bDateStr` (tra ca để tính thưởng A/B/C) đổi sang `business_date` thay vì `bookingDate`, cho cùng một trục. |
| 5 | `app/ktv/history/KTVHistory.logic.ts` | Ngày mặc định dùng ngày làm việc (`toBusinessDate` + cutoff đọc từ `SystemConfigs`), không dùng `getVnDateStr()`. |

Dùng lại `toBusinessDate` / `getDayCutoffHours` (`lib/business-date.ts`) — không viết
công thức ngày mới. **Không đụng một đồng nào**: không đổi công thức tiền, thuế,
thưởng; chỉ đổi *đơn thuộc ngày nào*.

## 4. Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Lịch Sử (`/api/ktv/history`) — đổi trục lọc ngày | Không gọi route này (đã grep: chỉ `app/ktv/history` dùng) | `KtvDLedgerReader.getRows`, `lib/business-date.ts` | Sửa phía KTV; **quản lý không ảnh hưởng — vì không dùng chung route** |
| Số liệu tiền | Lịch Sử đọc `KTVDTurnLedger` | `finance/ktv`, `finance/payroll` đọc cùng sổ cái theo `work_date` | `KTVDTurnLedger` | Sau khi sửa: **khớp** (nay đang lệch 2 tua) |
| Số liệu giờ | Bảng giờ trên chính màn này đã theo `work_date` | Office giờ cùng nguồn | `KtvOfficeScoreService.hoursLedger` | **Không ảnh hưởng — vì đã đúng**; sửa xong thì tiền mới cùng trục với giờ |
| Ví ↔ Lịch Sử | Ví đã theo `business_date` (commit `841bd54a`) | — | `toBusinessDate` | Sau khi sửa: **khớp** |
| Thưởng A/B/C | `calculateBookingBonus(bDateStr)` tra ca theo ngày | Báo cáo thưởng | `KtvCommissionService` | **Cần xác nhận** — đổi `bDateStr` có dịch ca của tua sau nửa đêm; phải mô phỏng trước |
| Realtime / refresh | Lịch Sử tự fetch theo `selectedDates` | Không | — | Không đổi |
| Quyền xem | KTV chỉ thấy lịch sử mình (`techCode` từ phiên) | — | — | Không đổi |

## 5. Kiểm chứng trước khi apply (mục 10 + 4.3)

1. Hai ca thật ở mục 1 phải hiện đúng tiền, đúng ngày: `005-02092026-B` → 01/09 ·
   100.000đ; `WB-001-02092026-A` → 02/09 · 3.262đ.
2. **Đối chiếu Ví ↔ Lịch Sử**: cùng KTV + cùng ngày làm việc, tổng tiền tua hai màn
   bằng nhau — chạy cho cả 13 KTV loại D, kỳ vọng 0 lệch.
3. **Đối chiếu tiền ↔ giờ trên cùng màn**: ngày nào có giờ thì phải có tiền.
4. Mốc biên với `cutoff = 6`: 23:59, 00:00, 05:59, 06:00 — chạy thêm dưới `TZ=UTC`.
5. A/B/C: mô phỏng `calculateBookingBonus` trước/sau khi đổi `bDateStr`, in ra tua
   nào đổi thưởng. Nếu có tua đổi tiền → dừng, báo user trước.
6. Đơn huỷ, đơn bị đổi KTV (`voidedKind`), đơn chưa có sổ cái vẫn hiện đúng ngày.

## 6. Rủi ro

- Đơn sẽ **nhảy ngày** trên Lịch Sử sau khi sửa (đúng 2 tua hiện tại) — giống việc
  đã làm với Ví. Nên báo KTV cùng một lượt.
- Nới cửa sổ ±1 ngày làm truy vấn `Bookings` nặng hơn ~3 lần khi chọn 1 ngày; chọn
  7 ngày thì chỉ +2/9. Chấp nhận được, nhưng nên đo lại thời gian trả về.
- Mục #4 (`bDateStr`) là chỗ duy nhất có thể **đổi tiền** của A/B/C. Nếu mô phỏng
  cho thấy có đổi, tách riêng, không gộp vào lần sửa này.

---

## 7. Kết quả thực hiện (12/09/2026)

**Phát hiện thêm khi làm — `bookingDate` còn tệ hơn plan tưởng.** Cùng một cột mà
ba đường ghi ba kiểu:

| Đơn | `createdAt` (UTC) | `bookingDate` | Đang lưu cái gì |
|---|---|---|---|
| `005-02092026` | 14:48:11 | `2026-09-02 14:48:11` | giờ **UTC** |
| `TEST-260902-JRYL` | 13:37:13 | `2026-09-02 20:37:13` | giờ **VN** |
| `WB-001-02092026` | 13:49:08 | `2026-09-03 03:30:00` | giờ **HẸN** của khách |

Nên **bỏ hẳn `bookingDate` khỏi mọi phép tính ngày**, chỉ dùng để quét rộng. Ngày
thật lấy từ `work_date` của sổ cái, không có thì suy từ `timeStart ?? createdAt`
(cả hai đều là UTC thật).

**Code** — 3 file:
- `app/api/ktv/history/route.ts`: cửa sổ quét `Bookings` nới ±1 ngày; `getRows` và
  `shiftMap` nới theo cho khớp; mỗi dòng trả thêm `business_date`; lọc lại ở cuối
  bằng `isPickedDay`. Bỏ khối lọc theo `bookingDate` trong `.filter()`.
- `app/ktv/history/KTVHistory.logic.ts`: ngày mặc định dùng `toBusinessDate` thay
  cho `getVnDateStr()`; thêm `business_date` vào `HistoryRecord`.
- `app/ktv/history/page.tsx`: (việc riêng cùng lượt) thẻ thưởng hiện **+20đ** theo
  điểm thay vì `+20.000đ`.

**Lệch so với plan:**
1. **Mục #4 (`bDateStr`) KHÔNG làm.** Đó là chỗ duy nhất đụng được tiền thưởng
   A/B/C. Giữ nguyên để lần sửa này zero-risk về tiền; tách việc riêng.
2. **Ngày quyết ở CẤP DÒNG, không phải cấp đơn.** Plan viết như thể mỗi đơn một
   ngày, nhưng `WB-001-02092026` có khách A ngày 02/09 và khách B ngày 03/09 —
   một bill nằm trên hai ngày làm việc. Nên `business_date` tính trong vòng lặp
   nhóm khách, sau khi đã tra sổ cái.
3. **`shiftMap` nới thêm** (plan không nhắc). Không nới thì đơn kéo vào từ ngày
   sát biên rơi về `SHIFT_1` mặc định và tính sai thưởng A/B/C. Đã đo: nới vào
   **không đổi dòng nào** trong 144 dòng thử.

**Kiểm chứng**
- Hai ca hỏng ở mục 1 đã đúng: `005-02092026-B` → ngày 01/09 · **100.000đ**;
  `WB-001-02092026-A` → ngày 02/09 · **3.262đ**. Khách B cùng bill vẫn ở 03/09 —
  chứng minh ngày quyết ở cấp dòng.
- **Đối chiếu Ví ↔ Lịch Sử**: 17 cặp (KTV × ngày làm việc), **0 lệch**.
- **Trước/sau trên 144 dòng** (10 KTV × 12 ngày, đủ cả A/B/C/D): 3 dòng đổi ngày,
  **2 dòng đổi tiền** — đúng hai ca hỏng, từ 0đ về số đúng. Không dòng nào biến
  mất, không dòng nào tự hiện ra.
- Dòng A/B/C đổi ngày duy nhất: `007-10092026-B` (TYPE_C) từ 10/09 → 09/09. Kiểm
  lại `timeStart` = 21:21 UTC 09/09 = **04:21 sáng 10/09 giờ VN** → đúng là ngày
  làm việc 09/09. **Tiền không đổi** (117.000đ).
- Mô phỏng 7 mốc biên (22:02, 23:59, 00:00, 00:57, 05:59, 06:00, 06:01) + biên
  tháng/năm + cửa sổ ±1 ngày: đạt; chạy lại dưới `TZ=UTC` cũng đạt (mục 13.5).
- `npm run test:qa` (16 bộ): ĐẠT. Typecheck sạch, eslint không thêm lỗi mới,
  `/ktv/history` trả 200.

## 8. Còn lại — ngoài phạm vi lần này

- **`bDateStr` vẫn suy từ `bookingDate`** (mục #4 chưa làm) → tra ca cho thưởng
  A/B/C vẫn có thể lệch một ngày với đơn tạo sau 17h. Việc riêng, đụng tiền A/B/C.
- **Sổ kỷ luật (`KTVDisciplineLedger`)** vẫn lọc theo `created_at` ngày lịch, chưa
  đổi sang ngày làm việc. Cố ý để ngoài phạm vi — khác sổ, khác trục.
- **Ngày mặc định phía client dùng cutoff mặc định 6**, không đọc `SystemConfigs`.
  Chỉ ảnh hưởng ngày được chọn sẵn; ngày của từng đơn do server tính bằng cutoff thật.
- Nhánh `bookings.length === 0` trả `data: []` (mảng) trong khi nhánh thường trả
  object `{bookings, disciplines, disciplinePoints}` → ngày không có đơn thì phiếu
  phạt cũng không hiện. Lỗi sẵn có, chưa sửa.
- Sau khi deploy, đơn sẽ nhảy ngày trên Lịch Sử — nên báo KTV cùng lượt với Ví.
