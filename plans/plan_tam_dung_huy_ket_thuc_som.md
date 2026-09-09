# Plan: Chuẩn hoá luồng Tạm dừng → Huỷ / Kết thúc sớm / Đổi KTV

**Ngày lập:** 2026-09-06
**Nhánh:** `feat/bit-lo-hong-phase1`
**Phạm vi:** thẻ Kanban đơn tạm dừng (màn Giám sát), API pause/swap/resume, huỷ đơn, mốc giờ & tiền tua.

---

## 1. Bốn kịch bản nghiệp vụ

| # | Tình huống | Quầy làm gì | Tiền tua | Giờ tích luỹ | Trạng thái đơn | Nhãn |
|---|---|---|---|---|---|---|
| **A** | KTV **không thông báo** (bỏ khách) | Xác nhận **Huỷ đơn** | ❌ không | ❌ không | `CANCELLED` | — |
| **B** | KTV bấm **"khách xuống sớm"** | Xác nhận **Hoàn thành sớm** | ✅ theo giờ **thực làm** | ✅ theo giờ thực làm | **Hoàn tất, KHÔNG qua đánh giá** | **"Ra sớm"** |
| **C** | Sự cố từ KTV hoặc khách (quầy bấm Dừng, hoặc KTV bấm Khẩn cấp) → thương thảo | | | | | |
| C1 | → KTV cũ làm tiếp | **Tiếp tục** | ✅ theo **giờ đã gán** | ✅ theo giờ đã gán | về `IN_PROGRESS` | — |
| C2 | → Đổi người | **Đổi KTV** | người cũ ❌ **mất trắng**<br>người mới ✅ | người cũ ❌ **mất trắng**<br>người mới ✅ | `IN_PROGRESS` | — |
| C3 | → Khách có vấn đề, huỷ đơn | **Huỷ** + quầy **chọn** có cộng giờ đã làm hay không | quầy quyết | quầy quyết | `CANCELLED` | — |
| C4 | → Lỗi do KTV, huỷ thẳng | **Huỷ** | ❌ không | ❌ không | `CANCELLED` | — |

Người thay ở C2 nhận **một trong hai**, quầy chọn:
- **(a)** phần thời gian **còn lại** của dịch vụ (+ giờ bù nếu có) — đang có sẵn
- **(b)** phần thời gian **quầy gán tay** — **chưa có**

---

## 2. Khoảng cách giữa hiện trạng và yêu cầu

| Mã | Vấn đề | Bằng chứng |
|---|---|---|
| **L1** | **"Người bị đổi mất tiền tua" chưa hề được cài.** Cột `TurnLedger.is_punished` có tồn tại và `syncTurnsForDate` đã loại trừ nó khỏi `turns_completed` — nhưng **không một dòng code nào set `is_punished = true`**. Đổi KTV xong, người cũ vẫn được tính đủ tua | [turn-sync.ts:14](lib/turn-sync.ts) · [migration](supabase/migrations/20260703163000_add_pause_and_punish_columns.sql) · grep toàn repo chỉ ra 2 chỗ này |
| **L2** | ⚠️ **Đã sửa lại kết luận.** Ban đầu tôi ghi "KTV cũ vẫn được trả tiền" — **sai**. Chặng của họ có ghi `customCommissionDuration = oldWorkedMins` thật, nhưng swap đồng thời **xoá họ khỏi `technicianCodes`**, mà đó mới là danh sách mọi nơi đọc để tính tiền. Kết quả thực tế: họ **không được trả gì cả** — nhưng theo kiểu **mất sạch dấu vết**, xem L2b | [BookingItemPauseService.ts:275](lib/services/BookingItemPauseService.ts) · [:314](lib/services/BookingItemPauseService.ts) |
| **L2b** | 🔴 **KTV bị đổi biến mất khỏi đơn.** `technicianCodes` là nguồn dữ liệu duy nhất mà **tất cả** các nơi đọc; bị gỡ khỏi đó là mất khỏi mọi chỗ: sổ cái loại D không sinh dòng nào, lịch sử KTV không thấy đơn, thẻ Kanban chỉ còn tên người mới. Dấu vết duy nhất còn lại là `segments[]` trong DB — **không giao diện nào hiển thị**. Không giải thích được cho KTV, không thống kê được ai bị đổi bao nhiêu lần | ledger D lặp `techCodes` [KtvDLedgerEngine.ts:313](lib/services/KtvDLedgerEngine.ts) · tiền A/B/C [ktv-ranking/route.ts:269](app/api/finance/reports/ktv-ranking/route.ts) · lịch sử [history/route.ts:173](app/api/ktv/history/route.ts) · thẻ Kanban [useDispatchBoard.logic.ts:272](app/reception/dispatch/useDispatchBoard.logic.ts) |
| **L3** | **Không có lựa chọn "làm phần thời gian quầy gán"** cho người thay. Chỉ có công thức cứng `(tổng − đã làm) + bù thêm` | [BookingItemPauseService.ts:281](lib/services/BookingItemPauseService.ts) |
| **L4** | **`resumeItem` DỜI `actualStartTime` tới trước** đúng bằng thời gian tạm dừng, để đồng hồ chạy tiếp cho mượt. Hệ quả: **mốc bắt đầu thật bị xoá vĩnh viễn**. Kanban lấy `displayStart = firstSeg.actualStartTime` nên **giờ bắt đầu trên thẻ tự đổi mỗi lần tạm dừng** — đúng như đang thấy | [BookingItemPauseService.ts:163](lib/services/BookingItemPauseService.ts) · [KanbanBoard.tsx:799](app/reception/dispatch/_components/KanbanBoard.tsx) |
| **L5** | **Kết thúc sớm đang đẩy đơn sang `CLEANING`** → chạy tiếp Dọn phòng → **Chờ đánh giá**. Yêu cầu B là hoàn tất luôn, **không qua FB** | [finish-early-paused/route.ts:89](app/api/ktv/finish-early-paused/route.ts) |
| **L6** | 🔴 **Đồng hồ KTV vẫn đếm sau khi quầy bấm Kết thúc, phải F5 mới hết.** Nguyên nhân xác định: guard chống "ghost completion" ép trạng thái ngược về `IN_PROGRESS` khi `isTimerRunning` còn true — mà cờ này chỉ tắt khi tải lại trang. Quầy kết thúc hộ thì KTV chưa hề bấm finish nên cờ vẫn bật | [KTVDashboard.logic.ts:617](app/ktv/dashboard/KTVDashboard.logic.ts) |
| **L7** | **Chưa có nhãn "đơn ra sớm"** ở bất kỳ đâu | — |
| **L8** | **Huỷ đơn luôn tính tiền theo giờ thực làm**, không có lựa chọn "không cho gì". Kịch bản A / C4 cần mất trắng, C3 cần quầy chọn | [actions.ts:1155](app/reception/dispatch/actions.ts) · [BookingModificationService.ts:505](lib/services/BookingModificationService.ts) |
| **L9** | **Thẻ tạm dừng chưa có nút Huỷ.** Đang là Tiếp / Đổi / Kết thúc / **Link**; phải huỷ bằng chuột phải → menu ngữ cảnh | [KanbanBoard.tsx:1137](app/reception/dispatch/_components/KanbanBoard.tsx) |

---

## 3. Thiết kế lõi: bỏ cách "dời giờ bắt đầu"

Đây là thay đổi nền, các phần khác dựa lên nó.

### Hiện tại
```
bắt đầu 11:20 ──── làm 1' ──── dừng 11:21 ═══ chờ 4' ═══ tiếp 11:25 ──── làm tiếp ────►
                                              resumeItem: actualStartTime := 11:24
```
Giờ bắt đầu bị ghi đè, mốc thật mất luôn. Giờ làm thực chỉ còn suy ra được gián tiếp bằng `(end − start)`.

### Đề xuất
Giữ `actualStartTime` **bất biến**, ghi các khoảng tạm dừng vào chính segment:

```jsonc
{
  "ktvId": "T016",
  "actualStartTime": "…T04:20:52Z",   // KHÔNG BAO GIỜ đổi
  "actualEndTime":   null,
  "pauses": [ { "from": "…T04:21:43Z", "to": "…T04:25:30Z" } ]
}
```

- **giờ làm thực** `= (end − start) − Σ(pauses)`
- **giờ bắt đầu hiển thị** luôn là mốc thật → Kanban hết nhảy (L4)
- Kịch bản B: chốt `actualEndTime = pause cuối cùng .from` → thẻ hiện đúng **11:20 → 11:21**, đúng yêu cầu
- Đồng hồ đếm ngược của KTV vẫn mượt: hạn kết thúc `= start + duration + Σ(pauses)`, tính lúc render thay vì ghi đè DB

**Tương thích ngược:** dữ liệu cũ không có `pauses` → `Σ = 0`, công thức thoái về đúng cách tính hiện tại. Không cần migrate.

⚠️ Đụng `computeMinutes` ([KtvDLedgerEngine.ts:219](lib/services/KtvDLedgerEngine.ts)) và `calculateActualMinutes` ([KtvTypeDTurnService.ts:19](lib/services/KtvTypeDTurnService.ts)) — hai chỗ này phải sửa **cùng lúc**, đúng như ghi chú đã cảnh báo trong file.

---

## 4. Mô hình dữ liệu thêm

Đều nằm trong `BookingItems.options` (jsonb, đã dùng cho `cancelReason`, `mergedIntoId`) — **không cần migration**:

| Khoá | Giá trị | Dùng cho |
|---|---|---|
| `earlyLeave` | `true` | nhãn "Ra sớm" (B) |
| `cancelReason` | chuỗi tự do quầy gõ | lý do huỷ (đã có sẵn, chỉ chuyển từ `prompt()` sang hộp thoại tử tế) |
| `cancelCredit` | `'NONE'` (mặc định) \| `'WORKED'` | có cộng giờ đã làm cho KTV không |

Trong segment:

| Khoá | Dùng cho |
|---|---|
| `pauses[]` | §3 |
| `voided: true` | chặng bị tước sạch tiền + giờ (C2 người cũ, A, C4) |

`voided` phải được tôn trọng ở **cả ba** nơi tính: `computeMinutes`, `calculateActualMinutes`, `KtvCommissionService.calculateItemDuration`.

Riêng **tua** thì tước bằng `TurnLedger.is_punished = true` — hạ tầng đã có sẵn, chỉ thiếu người ghi (L1).

---

## 5. Các bước triển khai

> **TÌNH TRẠNG 06/09/2026 — ĐÃ TRIỂN KHAI XONG CẢ 5 ĐỢT.**
> `tsc` sạch hoàn toàn, 0 lỗi. (Ghi chú cũ nói còn lỗi ở `app/admin/ktv-office/hours`
> nay không còn đúng — chỗ đó đã được sửa và commit ở `69182a4`.)
> Kiểm chứng: `scripts/simulate_pause_windows.ts` 18/18 đạt; `simulate_type_d_commission`
> và `simulate_type_d_bonus` vẫn đạt. Hai script `simulate_type_d_discipline` và
> `simulate_type_d_turn_order` **hỏng sẵn từ trước** — chúng seed vào
> `KTVServiceHoursLedger`, bảng đã bị đợt refactor sổ cái trước thay bằng
> `KTVDPenaltyLedger` / `KTVDTurnLedger`; không liên quan tới thay đổi này.
> **CHƯA chạy thử end-to-end trên giao diện** — cần một đơn thật để bấm.
>
> **Rà soát lại 09/09/2026:** đối chiếu từng bước với code, phát hiện **bước 8 mới
> làm một nửa** — `cancelBooking` (huỷ cả bill) chưa có `cancelCredit`. Đã vá:
> thêm tham số, tước chặng bằng `voided`, tước tua bằng `is_punished`, và đưa
> luồng huỷ cả bill dùng chung hộp thoại với huỷ đơn con thay cho `confirm()` trơn.
> Các bước còn lại đã kiểm chứng có mặt đầy đủ trong code.


### Đợt 1 — Nền mốc giờ *(chạm tiền, làm trước và làm một mình)*
1. `pauseItem` ghi `pauses[].from`; `resumeItem` ghi `pauses[].to` và **thôi dời `actualStartTime`**.
2. `computeMinutes`, `calculateActualMinutes`, `calculateItemDuration`: trừ `Σ(pauses)`, bỏ qua chặng `voided`.
3. Đồng hồ KTV: hạn kết thúc tính động `start + duration + Σ(pauses)`.
4. **Kiểm chứng bằng script** như đã làm hôm qua: dựng chặng có 1–2 lần tạm dừng, so `assigned / actual / paid` trước và sau.

### Đợt 2 — Kết thúc sớm (kịch bản B)
5. `finish-early-paused`: ghi `options.earlyLeave = true`.
   - ⚠️ **Đã làm khác kế hoạch ban đầu.** Plan viết "đặt item `DONE` thay vì `CLEANING`",
     nhưng phòng thì vẫn phải dọn dù khách về sớm. Thực tế: item vẫn sang `CLEANING`,
     rồi Kanban dựa vào `earlyLeave` để nhảy thẳng từ Dọn phòng sang `DONE`, **bỏ qua
     `FEEDBACK`** — đúng yêu cầu "không qua đánh giá" mà không mất bước dọn phòng.
   - `PAYABLE_STATUSES` đã có `DONE`; `SETTLED_STATUSES` cũng có → tiền hiện ngay, không chờ sao.
   - Không có sao ⇒ `rating = 0` ⇒ `ratingDeductions['0'] = 0` ⇒ **không bị trừ**.
     ✅ Đã chốt 06/09: đúng ý — quy chế không hề nói trừ, khách về sớm KTV đã thiệt giờ rồi.
6. Kanban: hiện nhãn **"RA SỚM"** trên thẻ; thẻ hiển thị **giờ bấm bắt đầu → giờ bấm dừng**.
7. **Sửa L6**: guard `isTimerRunning` không được chặn khi kết thúc đến từ quầy. Cách gọn nhất là bỏ qua guard khi segment của KTV đã có `actualEndTime` do server ghi (`note` = `FINISHED_EARLY_ON_PAUSE`), thay vì tin vào cờ phía client.

### Đợt 3 — Huỷ đơn phân loại (A, C3, C4)
8. `cancelBooking` / `cancelBookingItem` nhận thêm `cancelCredit`.
   - ⚠️ **Rà lại 09/09: lúc đầu chỉ làm `cancelBookingItem`, bỏ sót `cancelBooking`.**
     Nghĩa là huỷ TOÀN BỘ đơn từ menu chuột phải vẫn trả tiền theo giờ đã làm và
     giữ nguyên lượt tua — đúng kịch bản A/C4 mà lại không mất trắng. Đã vá.
   - `'NONE'` (mặc định) → đánh dấu chặng `voided`, set `TurnLedger.is_punished = true` → mất tiền, mất giờ, mất tua.
   - `'WORKED'` → giữ nguyên cách chốt hiện tại (đóng chặng tại mốc thực, được tính theo giờ đã làm).
9. Hộp thoại huỷ thay cho `prompt()` hiện tại ([actions.ts:1616](app/reception/dispatch/page.tsx)): **ô nhập tay lý do** + **công tắc "Cộng giờ đã làm cho KTV"** (mặc định tắt). Không có danh mục lý do cố định — quầy gõ gì thì lưu nấy vào `options.cancelReason`.
   - ⚠️ Lý do là chuỗi tự do nên **không được dùng nó để quyết định tiền**. Chỉ công tắc mới điều khiển tiền.

### Đợt 4 — Đổi KTV (C2)
10. **GIỮ KTV cũ trong `technicianCodes`**, đừng xoá (sửa L2b). Thay vào đó đánh dấu chặng của họ `voided: true` + `note: 'CHANGED'`, và set `TurnLedger.is_punished = true`.
    - Kết quả: vẫn **mất sạch tiền và tua** đúng quy chế, nhưng là **dòng bằng 0 có giải thích được**, thay vì biến mất không dấu vết.
    - Thẻ Kanban và lịch sử KTV vẫn thấy "bạn này từng làm cho khách", kèm nhãn **"Đã đổi"** và **số phút đã làm** (chốt 06/09).
      Số phút lấy từ `seg.customCommissionDuration` của chặng `voided` — nên **vẫn phải ghi con số này**, chỉ khác là các hàm tính tiền bỏ qua nó vì cờ `voided`. Đừng xoá con số đi, nó là bằng chứng đối soát.
      Dòng hiển thị mong muốn, ví dụ: `T016 · đã làm 25p · Đã đổi · 0đ`.
    - ✅ An toàn: KTV cũ **không** bị kéo ngược vào đơn. `handleGetBooking` bước 1.a chỉ nhận item mà KTV còn chặng **chưa có `actualEndTime`** ([:78](app/api/ktv/booking/_handlers/handleGetBooking.ts)) — chặng của họ đã đóng; bước 1.b đi theo `TurnQueue`, mà swap đã hạ họ về `waiting`.
11. Người mới: thêm lựa chọn **(a) phần còn lại** / **(b) số phút quầy gán tay** (L3).
12. Ba nơi tính tiền phải cùng bỏ qua chặng `voided`: `computeMinutes`, `calculateActualMinutes`, `calculateItemDuration` — nếu sót một nơi thì KTV bị đổi vẫn được trả.
    - ⚠️ **Rà lại 09/09: có NƠI THỨ TƯ mà plan bỏ sót, và nó vô hiệu hoá cả ba.**
      `if (itemDuration <= 0) itemDuration = 60` ở màn Lịch sử ([history/route.ts](app/api/ktv/history/route.ts)) và màn **Ví** ([wallet/timeline/route.ts](app/api/ktv/wallet/timeline/route.ts)).
      Dòng dự phòng này sinh ra để cứu đơn **thiếu segment**, nhưng chặng bị tước cũng ra 0 nên bị gộp làm một → KTV bị đổi ra **được trả nguyên 1 giờ**.
      Cộng thêm `checkIsItemPassed` hiện luôn `return true` vô điều kiện, và hai lớp `if (commission === 0 && passedCount > 0) → 60 phút`.
      Đối chiếu dữ liệu thật: **6 cặp KTV-dịch vụ, mỗi cặp 100.000đ, tổng 600.000đ** trả sai.
      Đã vá bằng `KtvCommissionService.isKtvVoidedOnItem()` — tách "0 vì bị tước" khỏi "0 vì thiếu data".
    - Nhãn trên **lịch sử KTV** (yêu cầu ở mục 10) trước đó chưa hề có. Đã thêm `voidedNote`: `Đã đổi KTV · đã làm 25p · 0đ`.
13. ⚠️ **Sửa lại mục 10 (chốt 09/09): `is_punished` CHỈ áp dụng cho A/B/C.**
    Loại D xếp thứ tự theo **giờ tích luỹ** (`net_hours` từ `KTVDTurnLedger`), `TurnLedger` không đụng tới thứ tự của họ.
    Tước tua cho D vừa vô nghĩa vừa đẻ ra tua ma trong báo cáo tài chính. Với D, chặng `voided` đã tự tước giờ.
    Cộng tua cho người mới cũng vậy: chỉ A/B/C.

### Đợt 5 — Nút trên thẻ *(nhẹ, làm lúc nào cũng được)*
12. Bỏ **Link**, thay bằng **Huỷ** trên thẻ tạm dừng (L9). Link vẫn còn ở thẻ thường và ở menu chuột phải.

---

## 6. Cần bạn chốt trước khi tôi code

| # | Câu hỏi | Vì sao cần |
|---|---|---|
| ~~Q1~~ | ✅ **ĐÃ CHỐT (06/09):** người bị đổi **mất hết** — cả phần đã làm thật. Tiền = 0, giờ tích luỹ = 0, tua bị `is_punished`. Số phút đã làm vẫn ghi lại để đối soát nhưng không quy ra tiền | — |
| ~~Q1b~~ | ✅ **ĐÃ CHỐT (06/09):** giữ tên KTV bị đổi trong đơn, **và hiện luôn số phút họ đã làm** trên thẻ Kanban lẫn lịch sử, dù tiền = 0 | — |
| **Q2** | B — đơn ra sớm không có đánh giá thì **không trừ sao** (mặc định 0 sao = trừ 0%). Đúng ý chưa, hay muốn coi như 4 sao / một mức khác? | Quyết định mức tiền thực nhận |
| ~~Q3~~ | ✅ **ĐÃ CHỐT (06/09):** nút Huỷ trên thẻ chỉ huỷ **đơn con** của KTV đó, không đụng các khách khác trong cùng bill. Muốn huỷ cả bill thì vẫn dùng menu chuột phải như cũ | — |
| ~~Q4~~ | ✅ **ĐÃ CHỐT (06/09):** **bỏ hẳn danh mục lý do**. Hộp thoại chỉ có **ô nhập tay lý do** (lưu vào `options.cancelReason` như hiện tại) + **một công tắc** *"Cộng giờ đã làm cho KTV"*, mặc định **TẮT**. Không cần `cancelKind` nữa | — |
| ~~Q5~~ | ✅ **ĐÃ CHỐT (06/09):** số phút quầy gán tay **chặn trên bằng đúng thời lượng dịch vụ**, không được vượt. Nhập quá thì kẹp về mức tối đa | — |

---

## 7. Rủi ro

- **Đợt 1 chạm thẳng vào tiền.** Ba nơi tính giờ phải sửa đồng bộ, lệch một nơi là lệch lương. Bắt buộc chạy script đối chiếu trước/sau trên dữ liệu thật trước khi merge.
- **Không migrate dữ liệu cũ.** Đơn đã chốt trước khi đổi code vẫn mang `actualStartTime` đã bị dời — số liệu quá khứ giữ nguyên, không truy hồi. Cần thống nhất là chấp nhận.
- **`is_punished` chưa từng chạy thật.** `syncTurnsForDate` có lọc nó nhưng chưa bao giờ có dòng nào `true` — phải kiểm lại đường tính `turns_completed` sau khi bắt đầu ghi.
- Vẫn còn tồn từ đợt trước, chưa gộp vào plan này: cột "Đã Huỷ" trên Kanban luôn rỗng, `PAUSED` thiếu ở lịch sử KTV / kỷ luật / báo cáo tài chính, chưa có watchdog chặn kẹt đơn.
