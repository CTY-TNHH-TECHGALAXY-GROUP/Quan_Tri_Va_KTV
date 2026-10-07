# Plan — Giờ dự kiến của đơn sau nửa đêm bị lệch sớm 1 ngày (02/10/2026)

Mức 2 (migration, RPC điều phối, handler KTV). Chờ duyệt.

## 1. Lỗi

Spa tính ngày làm việc D từ **D 07:00 đến D+1 07:00** (`spa_day_cutoff_hours = 7`). Điều phối lưu giờ dạng `HH:mm`, rồi ghép với ngày để ra mốc thật (`plannedStartAt`, `KtvAssignments.planned_start_time`…). Hầu hết các chỗ ghép làm như sau:

```
mốc = ngày làm việc + giờ HH:mm        (+1 ngày chỉ khi giờ B < giờ A, hoặc giờ kết thúc <= giờ bắt đầu)
```

Cách này **không xét mốc cắt 07:00**. Khi cả A và B đều sau nửa đêm, mốc bị lệch sớm đúng 1 ngày.

- Ví dụ thật: đơn SEQ_LIVE_10020033_3, B lúc 03:46 ngày 02/10 bị ghi `plannedStartAt = 03:46 ngày 01/10`.

**Quy tắc đúng (một nguồn duy nhất):**

```
mốc = ngày làm việc + giờ HH:mm, cộng thêm 1 ngày nếu giờ < mốc cắt (07:00)
```

- Giờ 00:00–06:59 luôn thuộc đêm của ngày làm việc trước đó. Định nghĩa ngày làm việc trong `lib/business-date.ts` vốn đã như vậy.

## 2. Hệ quả hiện tại (ca đêm)

| Chỗ dùng mốc sai | Hệ quả vận hành |
|---|---|
| `KtvAssignments.planned_start_time/end_time` (`dispatch_confirm_booking`, `dispatch_apply_edit`, trigger `sync_unstarted_dispatch_plan`) | Thứ tự đơn kế tiếp (`promote_next_assignment`) sai; kiểm tra chồng giờ sai (đơn 23:30 và 00:30 bị xếp lệch ngày). |
| `dispatch_assign_sequential_slot_b` | Quầy gửi giờ đúng (02/10 03:46) thì **bị từ chối** "B must follow the booking service day"; chỉ nhận giờ sai. |
| Cổng "chưa đến giờ" khi KTV bấm Bắt đầu (`handleStartTimer`) | Chặng sau nửa đêm mở sớm khoảng 24 giờ (không chặn được bắt đầu sớm). |
| Popup Gán B / ô giờ B (`sequentialClockAt`, `openLiveHandoff`, `plannedHandoffStartAt`) | Giờ gợi ý và giờ gửi lên sai ngày. |
| `TurnQueue.start_time` sắp `MIN/MAX(startTime::time)` | 00:30 được coi là sớm hơn 23:30. |

- Không chạm tiền, giờ tích luỹ hay tua: các khoản này tính theo `actualStartTime/actualEndTime` (mốc thật) và ngày làm việc.
- Sai ở đây là **kế hoạch, thứ tự và kiểm tra giờ**.

## 3. Danh sách chỗ phải sửa (từ khảo sát)

**SQL** — sửa bản mới nhất của từng hàm:

| # | Hàm (migration mới nhất) | Đang làm | Sửa |
|---|---|---|---|
| S1 | `dispatch_assign_sequential_slot_b` (`20261001100000`) | ngày + giờ B, +1 nếu B < A; từ chối ngày khác | dùng `business_clock_at` |
| S2 | `dispatch_confirm_booking` (`20261001090000`) | start không cộng ngày; end +1 nếu end <= start; `MIN/MAX(time)` cho TurnQueue | start/end qua `business_clock_at`; sắp theo mốc thay vì `time` |
| S3 | trigger `sync_unstarted_dispatch_plan` (`20260927190000`) | dự phòng `service_day + startTime` | `business_clock_at` |
| S4 | `dispatch_save_sequential_update` (`20260929160000`) | A: `bookingDate + giờ`; B: giữ ngày B cũ | cả A và B neo theo `business_clock_at` |
| S5 | `dispatch_apply_edit` (`20260929160000`) | 3 chỗ ghép ngày + giờ | `business_clock_at` |
| S6 | `dispatch_commit_form_base` (`20261001091000`) | dự phòng ngày + giờ B, +1 nếu B < A | `business_clock_at` |
| S7 | `dispatch_adjust_running_sequential_pair` (`20260930200000`) | giữ ngày B đã lưu | neo theo `business_clock_at`, bỏ phụ thuộc ngày đã lưu (có thể đang sai) |

- Hàm mới: `business_clock_at(p_day date, p_clock text) returns timestamptz`.
  - Đọc `spa_day_cutoff_hours` (mặc định 7).
  - Trả `(p_day + p_clock) at time zone 'Asia/Ho_Chi_Minh'`, cộng 1 ngày nếu `p_clock < cutoff`.
  - STABLE, `GRANT` cho `service_role`.

**TypeScript:**

| # | Chỗ | Sửa |
|---|---|---|
| T1 | `lib/business-date.ts` | thêm `businessClockAt(day, hhmm, cutoff)`, cùng quy tắc với SQL |
| T2 | `lib/ktvUtils.ts` `sequentialClockAt` | gọi T1, bỏ luật "so với giờ A" |
| T3 | `page.tsx` `openLiveHandoff`, ô giờ B | gọi T1 |
| T4 | `lib/dispatch-handoff.ts` `plannedHandoffStartAt` | gọi T1 |
| T5 | `actions.ts` (lưu form / gán B, khoảng dòng 1579) | gọi T1 |
| T6 | `handleStartTimer.ts:48-49` cổng giờ bắt đầu | dự phòng gọi T1; sắp chặng theo mốc thật, không trộn ISO với `HH:mm` |

- Không đổi (chỉ hiển thị / ước lượng, đã có ±12 giờ): `KTVDashboard.logic.ts`, `KanbanBoard.tsx`, `lib/time.logic.ts`.

## 4. Sửa dữ liệu đã lưu sai (một lần, có báo cáo trước)

- Quét `BookingItems.segments[].plannedStartAt/plannedEndAt` và `KtvAssignments.planned_start_time/end_time` của các đơn **chưa xong** có giờ 00:00–06:59 mà mốc rơi vào ngày làm việc (không phải ngày hôm sau).
- In bảng trước/sau (dry-run), **chờ duyệt** rồi mới ghi; chạy TEST trước, PROD sau.
- Đơn đã DONE: chỉ báo cáo, không sửa. Kế hoạch đã qua, tiền/giờ không phụ thuộc vào trường này.

## 5. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Cổng "chưa đến giờ" khi bắt đầu; thứ tự "đơn tiếp theo" | Popup Gán B, ô giờ B, Kanban (thứ tự), kiểm tra chồng giờ | `business_clock_at` (SQL) + `businessClockAt` (TS) | Sửa |
| Số liệu tiền / giờ / tua | Không đổi | Không đổi | ledger tính theo giờ thật | Không ảnh hưởng — vì không dùng `plannedStartAt` |
| Realtime | KtvAssignments / BookingItems | như cũ | — | Không đổi |
| Quyền | — | — | hàm mới chỉ cấp `service_role` | Không lộ |

## 6. Test

Mô phỏng bằng dữ liệu thật trên TEST, chạy dưới `TZ=UTC`:

1. 1KTV-1DV 23:30 → 00:30 (qua nửa đêm): planned đúng ngày D và D+1.
2. 1KTV-1DV 01:00 (cả chặng sau nửa đêm): planned ngày D+1; cổng bắt đầu không mở sớm.
3. Nối tiếp A 03:00, B 03:46: gán B với giờ đúng **được nhận**; giờ sai ngày bị từ chối.
4. Nối tiếp A 23:40, B 00:10: B ngày D+1, như hiện tại vẫn đúng.
5. 1KTV-2DV gộp 00:30 + 01:00: thứ tự `promote_next_assignment` đúng.
6. 2KTV-1DV 02:00: hai phân công cùng mốc đúng.
7. Đơn ban ngày (10:00, 15:00, 22:00): không đổi gì (hồi quy).
8. Sửa A/B lặp lại khi A đang chạy sau nửa đêm (B10): ngày B không trôi.
9. Hồi quy: 10 đơn 165/165, từ chối 24/24, F 50/50, V1/V3/T3 25/25, probe G3/G5.

## 7. Lưu ý triển khai

- PROD: các hàm trên ở PROD là bản cũ hơn (chưa có các migration của nhánh này). Migration này phải đi **cùng** đợt merge nhánh nối tiếp lên PROD, không áp lẻ.
- Không đổi định nghĩa ngày làm việc. Nếu sau này đổi `spa_day_cutoff_hours`, cả SQL và TS đều đọc cùng cấu hình.
