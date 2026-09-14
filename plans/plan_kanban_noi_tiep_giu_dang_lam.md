# Plan: Dịch vụ nhiều KTV nối tiếp — người trước xong thì dịch vụ vẫn "Đang làm"

**Mức:** 2 — `app/reception/dispatch/actions.ts` (Dispatch, `CLAUDE.md` mục 3, 9).
**Lập:** 2026-09-14 · **Trạng thái:** ĐÃ DUYỆT 14/09, ĐÃ CODE — `shouldHoldItemStatus` / `hasOpenKtvSegment` (`lib/dispatch-status.ts`), dùng trong `updateBookingItemStatus`; mô phỏng `scripts/qa/qa_kanban_sequential_hold.ts` 36/36 (2 KTV song song; đổi KTV, kết thúc sớm, huỷ × nối tiếp / song song — chặng dựng bằng `voidSegment` / `closeOpenPause` thật). Chờ merge `main`. ⚠️ Lỗ còn lại: kết thúc sớm khi còn KTV chưa bắt đầu — xem `nghiep_vu_tam_dung_doi_huy.md` mục 3.
**Liên quan:** `plans/plan_tu_hoan_tat_don_khong_danh_gia.md` (sự cố 14/09).

---

## 1. Sự cố

Đơn `11NDK-005-14092026-B`, dịch vụ BODY GỘI: `EXT_4EA0CD` 15:50–16:20, rồi **NH021 16:20–17:20**.

1. 16:20:45 người 1 xong. Thẻ Kanban của người 1 (thẻ tách theo giờ) sang cột Dọn phòng.
2. 16:21:17 `checkAutoFinish` tự đẩy thẻ đó sang Chờ đánh giá → `updateBookingItemStatus(itemIds, 'FEEDBACK', …, targetKtvIds=[EXT_4EA0CD])`.
3. Hàm chỉ ghi giờ kết thúc cho **người 1** (lọc `targetKtvIds`), nhưng lại đặt `status = 'FEEDBACK'` cho **cả dịch vụ** (`actions.ts:1671`) — bỏ qua NH021 đang làm.
4. Job tự hoàn tất thấy FEEDBACK → chốt DONE lúc 16:27. (Job đã sửa ở migration `20260914180000`.)

Luồng app KTV **không** dính: `handleFinishService` đã giữ `IN_PROGRESS` khi còn chặng chưa xong ("2 KTV 1 DV: Ng 1 xong, item giữ IN_PROGRESS cho Ng 2"). Chỉ đường tắt ở quầy bỏ qua luật đó.

## 2. Thay đổi

**`updateBookingItemStatus`** — khi gọi cho **một số KTV** (`targetKtvIds` có giá trị) và trạng thái mới là kết thúc (`CLEANING`/`FEEDBACK`/`DONE`/`COMPLETED`):
- Vẫn ghi `actualEndTime` / `feedbackTime` cho chặng của KTV đó như cũ.
- Sau khi ghi, nếu dịch vụ **còn chặng có KTV, không bị tước, chưa có `actualEndTime`** → **không đổi `status` và `timeEnd` của dịch vụ** (giữ `IN_PROGRESS`), chỉ lưu `segments`.
- Đồng bộ dịch vụ con gộp (`mergedIntoId`, `actions.ts:1702`): chỉ đổi theo khi dịch vụ cha **thật sự** đổi trạng thái.
- Luật "chặng còn mở" viết thành hàm thuần `hasOpenKtvSegment(segs)` ở `lib/dispatch-status.ts` — cùng định nghĩa với hàm SQL `booking_item_has_open_segment` (ghi chú chéo hai nơi).

**Không đổi:**
- Quầy kéo **cả thẻ** (không có `targetKtvIds`) = quầy chủ động chốt cả dịch vụ → giữ như cũ.
- Nhả tua theo từng KTV (`COMPLETED`/`CANCELLED`, lọc `employee_id`) → giữ như cũ.
- Tính lại trạng thái booking → đi theo trạng thái item như cũ.

## 3. Hệ quả hiển thị

`dispatch-timeline.ts:349–366`: khi item **không** ở DONE/CANCELLED/PAUSED, mỗi thẻ tự tính cột từ chặng của chính người đó.
→ Item giữ `IN_PROGRESS`: thẻ người 1 vẫn sang **Chờ đánh giá** (có `actualEndTime` + `feedbackTime`), thẻ NH021 ở **Đang làm**. Người 2 xong → dịch vụ mới lên FEEDBACK → khách chấm một lần cho cả hai → job chờ đủ số phút rồi chốt.
`checkAutoFinish` nhánh CLEANING không lặp: sau lần gọi đầu thẻ người 1 đã tính ra FEEDBACK nên không gửi lại.

## 4. Bảng hệ quả (mục 13) — "người trước trong chuỗi xong, quầy/Kanban đẩy thẻ của họ"

| Khía cạnh | Người trước | Người sau (đang làm) |
|---|---|---|
| Tiền tua / giờ tích luỹ | theo chặng của mình (không đổi) | tiếp tục chạy, chốt khi xong |
| Lượt tua / TurnQueue | nhả theo luồng hiện có | giữ `working` |
| Thưởng / đánh giá | khách chấm 1 lần khi cả dịch vụ xong | như người trước |
| Dọn phòng / bàn giao | theo luồng hiện có | sau khi xong |
| Màn app KTV | không đổi | **không bị đẩy sang hoàn tất** (trước đây item DONE) |
| Tự chốt (job) | chỉ khi cả đơn con xong | như trái |
| Thẻ Kanban | Chờ đánh giá | Đang làm |
| Lịch sử KTV | "Chờ FB" tới khi chốt | như trái |

## 5. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không đổi code — item giữ `IN_PROGRESS` nên người sau không bị đá khỏi đồng hồ | Kanban (thẻ tách theo giờ) | `updateBookingItemStatus`, `lib/dispatch-status.ts` | Sửa |
| Số liệu | Không đổi công thức | Không đổi | sổ cái đọc chặng | Không ảnh hưởng — vì chỉ đổi thời điểm item lên FEEDBACK |
| Realtime | nghe `BookingItems` | nghe `BookingItems` | `BookingItems` | Đồng bộ |
| Quyền xem | không đổi | không đổi | | Không lộ dữ liệu |

## 6. Kiểm (`CLAUDE.md` 9.8)

Mô phỏng `hasOpenKtvSegment` + quyết định đổi trạng thái bằng dữ liệu giống thật (in kết quả), các ca: **1KTV-1DV** (đổi như cũ), **1KTV-2DV gộp**, **2KTV-1DV nối tiếp** (người 1 xong → giữ IN_PROGRESS; người 2 xong → FEEDBACK), **2KTV-1DV người sau chưa bắt đầu**, **chặng bị tước**, **ca qua nửa đêm**, quầy kéo cả thẻ (không `targetKtvIds`).
