# Plan — Tiền vào ví trước khi KTV vào thay bắt đầu làm

> **Mức 2** — chạm Dispatch (`app/reception/dispatch/actions.ts`) và sổ cái tiền/giờ (`lib/services/KtvDLedgerEngine.ts`).
> **Trạng thái**: ✅ Đã làm (11/09/2026). User chốt: người vào thay chưa bắt đầu thì **không trả**; `dispatch/actions.ts` không còn ai giữ khoá.
> **Ngày**: 11/09/2026 · **Nhánh**: `feat/bit-lo-hong-phase1`

---

## 1. Hiện tượng

KTV vừa được **gán vào thay** trên một đơn đang chạy là ví đã cộng tiền, dù chưa bấm bắt đầu.

Ca thật — đơn `WB-11092026-002`, dịch vụ `NHS0800` (chuỗi segments gốc, UTC):

| Mốc (VN) | Việc |
|---|---|
| 20:47 | T069 bắt đầu chặng 1 (gán 120p) |
| 21:06 | Quầy đổi KTV → chặng 1 của T069 đóng (`voided`, `CHANGED`), tạo chặng 2 `TAKEOVER` cho T007: `duration = customCommissionDuration = 101` |
| **21:08** | **Chặng 2 của T007 bị đóng dấu `actualEndTime` — T007 chưa hề bắt đầu** |
| 21:11 | Sổ cái tính: item đang `CLEANING` (thuộc `PAYABLE_STATUSES`) → trả T007 **101p = 168.333đ** |
| 21:13 | T007 mới thật sự bấm bắt đầu → item về `IN_PROGRESS`. Chặng giờ có `actualEndTime` (21:08) **nhỏ hơn** `actualStartTime` (21:13) |

Mô phỏng `computeMinutes` trên đúng chặng đó:

| Tình huống | Hiện tại | Đề xuất | Đúng ra |
|---|---|---|---|
| A. Vừa đổi, chưa bắt đầu | **101p** | 0p | 0p |
| B. Quầy chốt đơn, bị đóng dấu kết thúc dù chưa bắt đầu | **101p** | 0p | 0p |
| C. T007 đã bắt đầu, đang làm | **101p** | 0p | 0p |
| D. T007 làm xong | 101p | 101p | 101p |

## 2. Nguyên nhân gốc rễ — ba mắt xích

1. **Đóng dấu kết thúc lên chặng chưa bắt đầu.** `updateBookingStatus` ([dispatch/actions.ts:1363](../app/reception/dispatch/actions.ts)) — khi quầy đổi trạng thái đơn, vòng lặp ở dòng ~1414 gán `actualEndTime = endMark` cho **mọi** chặng chưa có mốc kết thúc, **không kiểm tra `actualStartTime`**. Khối tương tự ở dòng ~1258 thì có kiểm tra (`s.actualStartTime && !s.actualEndTime`) — hai khối lệch nhau. Vi phạm rule 9.4 (không đóng dấu giờ cho KTV khác).

2. **Số phút chốt cứng được trả ngay, bất kể đã làm hay chưa.** `BookingItemPauseService` tạo chặng `TAKEOVER` với `customCommissionDuration = remainingMins` — **cố ý** ("KTV bắt đầu sớm hay muộn đều nhận đúng bằng nhau", dòng 537–539). Nhưng `computeMinutes` ([KtvDLedgerEngine.ts](../lib/services/KtvDLedgerEngine.ts)) gặp `customCommissionDuration` là cộng thẳng vào `paid`, không xét chặng đã có mốc giờ chưa. Số tiền đúng, **thời điểm** sai.

3. **Item chạm trạng thái được trả tiền trước khi người vào thay bắt đầu.** Mắt xích 1 đẩy item lên `CLEANING` → lọt `PAYABLE_STATUSES` → mắt xích 2 trả đủ.

Hệ quả phụ: `handleGetBooking.ts:871` và `KTVDashboard.logic.ts:747` nhận diện "người vào thay đang chờ bắt đầu" bằng `note === 'TAKEOVER' && !actualEndTime`. Mốc kết thúc giả làm màn hình của T007 **mất trạng thái chờ bắt đầu**.

## 3. Đề xuất sửa (một phương án)

**Sửa ở cả hai đầu — chặn đầu vào và chặn chỗ trả tiền.** Chỉ chặn một đầu thì còn đường lọt: quầy vẫn có thể kéo đơn sang `DONE` bằng tay, lúc đó item đã `PAYABLE` và `customCommissionDuration` vẫn được trả.

| # | File | Thay đổi |
|---|---|---|
| 1 | `app/reception/dispatch/actions.ts` (`updateBookingStatus`, ~dòng 1414) | Chỉ đóng dấu `actualEndTime` cho chặng **đã bắt đầu** — khớp khối dòng 1258. Chặng chưa bắt đầu để nguyên. |
| 2 | `lib/services/KtvDLedgerEngine.ts` (`computeMinutes`) | Chặng `note === 'TAKEOVER'` chỉ được tính `customCommissionDuration` khi đã có **cả** `actualStartTime` **và** `actualEndTime`. Chặng khác (quầy/admin gán tay cho đơn cũ không có mốc giờ) **giữ nguyên** — không đụng. |
| 3 | Vá dữ liệu | Chặng T007 của `WB-11092026-002`: gỡ `actualEndTime` giả (21:08, nhỏ hơn mốc bắt đầu) để luồng hoàn tất ghi đúng mốc thật. Rồi chạy tính lại sổ cái cho đơn đó. Làm bằng script có chế độ xem trước. |

Không đổi quy tắc "số phút chốt cứng lúc đổi" — chỉ dời thời điểm trả sang lúc người vào thay làm xong.

## 4. Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Ví Thu Nhập (`/api/ktv/wallet/*`), Lịch sử, Sổ giờ; dashboard nhận diện `TAKEOVER` | Kanban/bảng điều phối (`updateBookingStatus`), màn Office giờ | `KtvDLedgerEngine.computeMinutes`, `KTVDTurnLedger` | Sửa |
| Số liệu tiền | Ví đọc `KTVDTurnLedger.take_home` | Office/giờ đọc cùng sổ cái | Công thức ở `computeMinutes` — một nguồn | Khớp (cùng nguồn, sửa một chỗ) |
| Số liệu giờ | Sổ giờ đọc `actual_minutes` | Office đọc cùng | `computeMinutes` trả cả `actual` | Khớp — cùng quy tắc cho `actual` của chặng TAKEOVER |
| A/B/C | `KtvCommissionService` cũng đọc `customCommissionDuration` | Báo cáo tài chính | Cần xác nhận | **Cần xác nhận** — plan này chỉ sửa loại D; A/B/C tính tua qua `TurnQueue` nhưng tiền vẫn có thể dính cùng lỗi thời điểm |
| Realtime | Dashboard nghe `BookingItems` | Kanban nghe `BookingItems` | trigger → `KTVDRecomputeQueue` | Đồng bộ — mắt xích 1 sửa xong thì không còn mốc giả đẩy tính lại sai |
| Quyền xem | KTV chỉ thấy ví mình | Quầy thấy mọi đơn | | Không lộ dữ liệu |

## 5. Test sau khi sửa (mục 9.8 + đổi KTV)

- 1KTV-1DV, 1KTV-2DV (gộp), 2KTV-1DV, ca đêm qua nửa đêm — tiền không đổi so với hiện tại.
- Đổi KTV: (a) vừa đổi chưa bắt đầu → 0đ; (b) quầy chốt đơn khi người vào thay chưa bắt đầu → 0đ, chặng không bị đóng dấu; (c) đã bắt đầu, đang làm → 0đ; (d) làm xong → đủ số phút chốt; (e) người vào thay tạm dừng rồi làm tiếp.
- Đơn cũ quầy gán tay `customCommissionDuration`, không có mốc giờ → vẫn được trả như cũ.
- Đối chiếu 2 phía (mục 4.3): cùng KTV + cùng ngày, ví KTV = màn Office.

## 6. Cần chốt trước khi làm

**Người vào thay chưa kịp bắt đầu mà quầy đã chốt hoàn tất đơn** (khách về sớm, v.v.) — người đó có được trả số phút đã chốt không? Plan đang hiểu là **không** (chưa làm thì không trả). Nếu quy chế là vẫn trả, mục #2 phải đổi điều kiện.

## 7. Khoá file

`.agents/coordination.md` còn mục **"Conversation Antigravity — Triển khai KtvAssignments Architecture"** ghi `app/reception/dispatch/actions.ts` ở trạng thái "Đang làm" (mã hoá lỗi, nhiều khả năng đã cũ). Cần user xác nhận trước khi sửa file này.

---

## 8. Kết quả thực hiện

**Code**
- `KtvDLedgerEngine.computeMinutes`: chặng `TAKEOVER` chỉ tính khi có cả mốc bắt đầu và kết thúc, **kết thúc sau bắt đầu** (`takeoverFinished`). Chặng khác không đổi.
- `dispatch/actions.ts` `updateBookingStatus`: bỏ qua chặng `TAKEOVER` chưa bắt đầu khi đóng dấu kết thúc.

**Lệch so với plan — mục #1 thu hẹp:** chỉ chặn chặng `TAKEOVER` chưa bắt đầu, không phải mọi chặng chưa bắt đầu. Lý do: đơn cũ không bấm giờ vẫn cần mốc kết thúc để `handleReleaseKTV` chốt `KtvAssignments`. Cũng không huỷ (void) chặng — `updateBookingStatus` chạy cả ở bước trung gian (21:08 lên CLEANING rồi 21:13 T007 vẫn bắt đầu), huỷ là người vào thay làm không công.

**Lệch so với plan — mục #3 vá dữ liệu:** lúc làm thì T007 đã làm xong (item `FEEDBACK`), nhưng `handleFinishService` không ghi đè mốc kết thúc giả nên giờ xong thật bị mất. Thay vì gỡ mốc, gán `actualEndTime = reviewTime` (21:16:13, lúc T007 gửi đánh giá — dịch vụ chắc chắn đã xong). Tiền giữ 101p = 168.333đ, nay hợp lệ.

**Ca thứ hai phát hiện khi đối chiếu toàn sổ:** T069 đơn `WB-10092026-013` — chặng `TAKEOVER` không có mốc bắt đầu, không có `reviewTime`, bị quầy đóng dấu kết thúc 04:23 → đã được trả 119p = 198.333đ. Theo quyết định "không trả", tính lại → dòng `VOID`. T069 là tài khoản test, chưa có lệnh rút nào.

**Kiểm chứng**
- Mô phỏng 12 ca (1KTV-1DV, ra sớm, 1KTV-2DV gộp, ca đêm, đơn cũ không bấm giờ, quầy gán tay, 5 ca đổi KTV, KTV bị đổi ra): 12/12 đạt.
- Đối chiếu toàn bộ sổ cái tháng 9, engine cũ vs mới: đúng 2 dòng đổi, cả hai là ca lỗi nêu trên; không KTV nào khác bị đổi tiền.
- `qa_10_bonus_in_turn`, `qa_01_03_hours_sort`: ĐẠT.

## 9. Còn lại — ngoài phạm vi

- `handleFinishService` không ghi đè `actualEndTime` đã có kể cả khi nó **sớm hơn** mốc bắt đầu. Sau khi chặn nguồn gây mốc giả thì không tái phát, nhưng chưa có lớp phòng thủ ở handler (rule 9.1: mỗi lần một handler).
- A/B/C (`KtvCommissionService`) cũng đọc `customCommissionDuration` — chưa kiểm tra có dính cùng lỗi thời điểm không.
- Production vẫn chạy engine cũ tới khi deploy: nếu đơn `WB-10092026-013` bị tính lại trước đó, dòng 198.333đ sẽ quay lại.
