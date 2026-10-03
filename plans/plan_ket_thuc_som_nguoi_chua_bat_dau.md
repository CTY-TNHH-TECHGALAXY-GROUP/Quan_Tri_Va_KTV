# Plan: Kết thúc sớm khi còn KTV chưa bắt đầu

**Mức:** 2 — `app/api/ktv/finish-early-paused/route.ts`, `app/api/ktv/booking/_handlers/handleFinishService.ts` (Dispatch, `CLAUDE.md` mục 9), `app/ktv/dashboard/KTVDashboard.logic.ts`, sự kiện nghiệp vụ (mục 13).
**Lập:** 2026-09-14 · **Trạng thái:** ĐÃ DUYỆT + ĐÃ CODE 14/09 — tua chốt **(B)**: *"nếu không làm là trừ tua"*. Chưa commit, chờ deploy.

> **Kết quả code (14/09):**
> - `lib/segment-time.ts`: `NOTE_EARLY_LEAVE_NOT_STARTED`, `markNotStartedOnEarlyLeave`, `hasNoRoomDutyOnItems`.
> - `lib/dispatch-status.ts`: `segmentProgress` (bỏ qua chặng `voided`) — `handleFinishService` dùng. Hệ quả phụ đúng nghiệp vụ: đổi KTV, người thay bàn giao xong + khách đã chấm → `DONE` ngay (trước đây người cũ không bàn giao làm "chưa bàn giao hết").
> - `lib/services/KtvReleaseService.ts`: `releaseNotStartedKtvFromItem` — nhả `TurnQueue`, huỷ `KtvAssignments` + `promote_next_assignment`, trừ tua A/B/C (`punishTurnIfIdle`), không trừ loại D.
> - `finish-early-paused/route.ts`: tước + nhả người chưa bắt đầu; nhật ký "· T014 chưa bắt đầu, đã nhả".
> - `attendance/status`, `HandoverService`, `unfinished-work`: dùng `hasNoRoomDutyOnItems`.
> - **Khác plan:** `KTVDashboard.logic.ts` KHÔNG sửa — người chưa bắt đầu bị nhả ngay nên không bao giờ vào màn đánh giá/dọn phòng của đơn đó; giữ nguyên để không chạm lõi ScreenEngine (mục 8).
> - Lịch sử KTV: nhãn "Khách về sớm" + dòng "Khách về sớm trước lượt của bạn — không tính tiền, giờ và tua." Kanban: tag "CHƯA LÀM · KHÁCH VỀ SỚM".
> - Kiểm: `qa_kanban_sequential_hold.ts` 36/36 (thêm `segmentProgress` 1KTV-1DV, gộp, nối tiếp, song song, đổi KTV, qua nửa đêm) · `qa_release_not_started_ktv.ts` 9/9 (client giả) · `qa_auto_complete_feedback.cjs` 73/73 (DB thật, ROLLBACK) · `scripts/repair_early_leave_not_started.cjs` dry-run: 1 item (`aa79c2d1-…` IN_PROGRESS → FEEDBACK), chưa `--apply`.
**Bảng tra:** `plans/nghiep_vu_tam_dung_doi_huy.md` (mục 3 "Còn lỗ", dòng "KS × nối tiếp / song song").
**Liên quan:** `plan_ket_thuc_som_hoan_tat.md` (đã chốt A: KTV đang làm vẫn dọn + bàn giao), `plan_tu_hoan_tat_don_khong_danh_gia.md`.

---

## 1. Lỗ

Quầy bấm **Kết thúc** trên thẻ đang tạm dừng. `finish-early-paused/route.ts:93–114` chỉ đóng chặng **đã bắt đầu**:

```ts
if (!seg.actualStartTime || seg.actualEndTime) continue;
```

Người **chưa bắt đầu** — người sau trong chuỗi nối tiếp, hoặc người làm song song chưa kịp vào — bị bỏ ngỏ:

| Hậu quả | Vì sao |
|---|---|
| Dịch vụ kẹt **Đang làm** vĩnh viễn | KTV đang làm bàn giao xong → `handleFinishService:198` thấy chặng chưa bắt đầu → `IN_PROGRESS` |
| Không bao giờ tự hoàn tất | job coi chặng chưa có `actualEndTime` là còn mở |
| Người chưa bắt đầu **không được nhả** | route cố ý không đụng `TurnQueue` / `KtvAssignments` → họ vẫn giữ `current_order_id` / phiếu `QUEUED`·`READY` → `handleGetBooking` vẫn dẫn họ tới phòng khách đã về, sổ tua thấy họ bận |
| Kanban thẻ người chưa bắt đầu treo | không có mốc kết thúc |

Đơn thật: `aa79c2d1-ed16-4cd3-b39d-b0670fb36c31` (TEST-260908-DS5E) — T069 song song chưa bắt đầu, T007 bị kết thúc sớm → kẹt `IN_PROGRESS` + `earlyLeave` từ 08/09. Test đã khoá hành vi an toàn (không tự chốt, ⚠️) trong `qa_auto_complete_feedback.cjs` và `qa_kanban_sequential_hold.ts`.

## 2. Nghiệp vụ đề xuất — cần chốt

Khách đã về trước lượt của họ → người chưa bắt đầu **không làm gì**, **không có lỗi**.

| Khía cạnh | Đề xuất |
|---|---|
| Tiền tua / giờ tích luỹ (D) | **0** — tước chặng (0 phút) |
| Nhả KTV | **Ngay lúc quầy bấm Kết thúc** — về hàng chờ, phiếu phân công huỷ, kéo đơn kế tiếp lên |
| Dọn phòng / bàn giao / nợ phòng / chặn tan ca | **Không** — không vào phòng |
| Đánh giá khách, thưởng Xuất sắc | **Không** |
| Lịch sử KTV | Một dòng **"Khách về sớm trước lượt bạn · 0đ"** |

**❓ Câu hỏi — tua (A/B/C):** tua được ghi vào `TurnLedger` **ngay lúc quầy điều phối** (RPC `DISPATCH_CONFIRM`), tức người chưa bắt đầu đã có 1 tua.
- **(A) Khuyến nghị — giữ tua:** không bật `is_punished`. Không phải lỗi của họ; đúng với cách đã nói với bạn ("không trừ tua").
- **(B) Bỏ tua:** bật `is_punished` như huỷ không công — coi như chưa từng được gọi.

Loại D không có tua (xếp theo giờ tích luỹ) → không áp dụng.

## 3. Thay đổi

### 3.1. `lib/segment-time.ts` — một nguồn cho "người không còn nghĩa vụ với phòng"
- Hằng `NOTE_EARLY_LEAVE_NOT_STARTED = 'EARLY_LEAVE_NOT_STARTED'`.
- `markNotStartedOnEarlyLeave(seg, endMark)`: `actualEndTime = endMark`, `customCommissionDuration = 0`, `voided = true`, `note = EARLY_LEAVE_NOT_STARTED`. Ghi `actualEndTime` để mọi nơi đang đọc "chặng đã đóng chưa" (job SQL, Kanban, `hasOpenKtvSegment`) thấy đã đóng mà không phải sửa.
- `laNguoiBiDoiRaKhoiDon` hiện chỉ nhận `note === 'CHANGED'` → thêm hàm `khongConNghiaVuPhong(items, ktvId, khopKtv)`: mọi chặng của người đó `voided` **và** note ∈ {`CHANGED`, `EARLY_LEAVE_NOT_STARTED`}. Huỷ không công (`CANCELLED_NO_CREDIT`) **không** thuộc nhóm này — người đang làm bị huỷ vẫn phải dọn (luật cũ giữ nguyên).

### 3.2. `finish-early-paused/route.ts`
- Trong vòng lặp chặng: chặng có `ktvId`, **chưa** `actualStartTime`, chưa `voided` → `markNotStartedOnEarlyLeave`; gom mã KTV đó.
- Sau khi cập nhật item, **nhả từng người chưa bắt đầu** cho đúng dịch vụ này — cùng cách `cancelBookingItem` đang làm cho người chưa bắt đầu (`BookingModificationService.ts:575–632`): `TurnQueue` bỏ item khỏi `booking_item_ids` (hết item → `waiting`, xoá `current_order_id`/phòng/giờ), `KtvAssignments` của item → `CANCELLED`, gọi `promote_next_assignment`. Gom phần nhả này thành hàm dùng chung `releaseNotStartedKtvFromItem` trong `lib/services/*` — route gọi; `cancelBookingItem` giữ nguyên trong plan này (ghi chú chỗ trùng, gom sau).
- Tua: theo câu trả lời mục 2.
- Nhật ký quầy: thêm ghi chú vào dòng `FINISH_EARLY` — `"chốt tại mốc tạm dừng · T014 chưa bắt đầu, đã nhả"`.
- KTV đang làm: **không đổi** (vẫn dọn + bàn giao, không nhả — quyết định 06/09 và 14/09).

### 3.3. `handleFinishService.ts` (một handler, mục 9.1)
`startedSegs`, `hasUnstartedSegs`, `allHandovered` (dòng 196–206) **bỏ qua chặng `voided`**. Không có bước này thì chặng đã tước (chưa bắt đầu) vẫn bị coi là "còn người chưa làm" và lùi dịch vụ về `IN_PROGRESS`.

### 3.4. Các chỗ đang dùng `laNguoiBiDoiRaKhoiDon` → đổi sang `khongConNghiaVuPhong`
| File | Tác dụng |
|---|---|
| `app/api/ktv/attendance/status/route.ts:220` | không chặn tan ca vì nợ phòng |
| `lib/services/HandoverService.ts:319` | không hiện nợ bàn giao |
| `lib/unfinished-work.ts:72` | không tính là việc dang dở |
| `app/ktv/dashboard/KTVDashboard.logic.ts:2139` | nếu còn mở đơn: không bắt đánh giá / dọn phòng |

### 3.5. Lịch sử KTV
`app/api/ktv/history/route.ts:407–456`: `voidedKind` thêm `'EARLY_LEAVE_NOT_STARTED'`, nhãn "Khách về sớm trước lượt bạn". `page.tsx` + `KTVHistory.logic.ts`: nhãn trạng thái, ẩn đánh giá / bàn giao / thưởng như các loại tước khác (chữ vào `KTVHistory.i18n.ts`).

### 3.6. Kanban
`dispatch-timeline.ts:277–302` đã gom người bị tước vào thẻ đầu → thẻ không tách thêm. Thẻ `KanbanBoard.tsx` đang gắn tag "ĐÃ ĐỔI" cho người bị tước → với note mới hiện **"CHƯA LÀM · KHÁCH VỀ SỚM"**.

### 3.7. Dữ liệu cũ
Script một lần (dry-run trước, chạy khi bạn cho phép): đơn `aa79c2d1-…` và mọi item `earlyLeave` còn chặng chưa bắt đầu → áp 3.1 cho chặng đó, rồi tính lại trạng thái item theo luật mới. Quét 14/09: **1 item** (đơn test).

### 3.8. Không cần sửa
- Tiền / giờ: `KtvCommissionService.isKtvVoidedOnItem`, `KtvTypeDCommissionService`, `KtvDLedgerEngine` đã bỏ qua chặng `voided`.
- Job tự hoàn tất (SQL) và `hasOpenKtvSegment` / `shouldHoldItemStatus`: bỏ qua `voided` → đơn tự chốt sau khi người đang làm bàn giao + đủ giờ chờ.
- "Cùng làm với": `lib/co-workers.ts:73` đã lọc `voided`.

## 4. Bảng hệ quả (mục 13) — sự kiện "quầy Kết thúc sớm, còn KTV chưa bắt đầu"

| Khía cạnh | KTV đang làm (bị kết thúc sớm) | KTV chưa bắt đầu |
|---|---|---|
| Tiền tua | theo phút làm thật (không đổi) | 0đ |
| Giờ tích luỹ (D) | theo phút làm thật | 0 |
| Lượt tua (A/B/C) | giữ (không đổi) | **trừ tua** (chốt B 14/09); loại D không áp dụng |
| Thưởng | theo sao (không đổi) | không |
| Đánh giá khách tính cho ai | người đang làm | không |
| Dọn phòng / bàn giao | **có** (không đổi) | **không** |
| Nợ phòng / chặn tan ca | có nếu chưa dọn | **không** |
| Hạn mức bỏ qua bàn giao | như cũ | không áp dụng — không bàn giao |
| TurnQueue / KtvAssignments | giữ tới khi bàn giao (không đổi) | **nhả ngay** |
| Màn app KTV | Đánh giá → Bàn giao → Thưởng | về trang chủ, đơn biến mất |
| Đồng hồ | dừng tại mốc tạm dừng | không áp dụng — chưa chạy |
| Tự chốt (job) | sau bàn giao + đủ giờ chờ, cả đơn con | không chặn đơn nữa |
| Thẻ Kanban | Dọn phòng → Chờ đánh giá | tag "CHƯA LÀM · KHÁCH VỀ SỚM" trên thẻ đầu |
| "Cùng làm với" | không hiện người chưa bắt đầu | không áp dụng |
| Lịch sử KTV | như cũ | "Khách về sớm trước lượt bạn · 0đ" |
| Nhật ký quầy | "Kết thúc sớm · chốt tại mốc tạm dừng · T014 chưa bắt đầu, đã nhả" | (cùng dòng) |
| Lý do | không bắt buộc | không áp dụng |

## 5. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | app KTV (Dashboard), `/api/ktv/attendance/status`, `/api/ktv/history` | Kanban, sổ tua, nút Kết thúc | `finish-early-paused`, `handleFinishService`, `lib/segment-time.ts`, `HandoverService`, `unfinished-work` | Sửa |
| Số liệu | tiền/giờ người chưa bắt đầu = 0 | báo cáo đọc cùng sổ cái | engine đã bỏ qua `voided` | Khớp — không đổi công thức |
| Realtime | Dashboard nghe `BookingItems`, `KtvAssignments` | Kanban nghe `BookingItems`, `TurnQueue` | các bảng trên | Đồng bộ |
| Quyền xem | KTV chỉ thấy dòng của mình | không đổi | | Không lộ dữ liệu |

## 6. Kiểm (mục 9.8 + 13.6)

1. **Mô phỏng** (không ghi DB), dựng chặng bằng hàm thật + đúng bước route: 1KTV-1DV (không có ai chưa bắt đầu → như cũ), 1KTV-2DV gộp, **2KTV-1DV nối tiếp** (người 2 chưa bắt đầu), **2KTV-1DV song song** (người 2 chưa vào), ca qua nửa đêm. In: trạng thái item sau route, sau `handleFinishService`, chặng người chưa bắt đầu.
2. Đổi 2 ca ⚠️ trong `qa_auto_complete_feedback.cjs` và `qa_kanban_sequential_hold.ts` sang dữ liệu sau khi sửa → kỳ vọng tự chốt / không giữ.
3. **DB thật, ROLLBACK**: gọi phần nhả KTV trên đơn test T0xx (không dùng NH0xx), kiểm `TurnQueue`, `KtvAssignments`, `TurnLedger.is_punished` theo câu trả lời mục 2.
4. `TZ=UTC`; đối chiếu lịch sử KTV với báo cáo cho người chưa bắt đầu (0đ hai phía).
