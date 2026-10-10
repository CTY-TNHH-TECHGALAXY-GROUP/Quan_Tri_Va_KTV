# Plan — Khách chấm sao trước khi KTV bấm Kết thúc làm KTV kẹt bàn giao (ca T027 10/10/2026)

**Mức 2** (ghi dữ liệu thật, dispatch handler, KTV Dashboard lõi, migration, route khách ở WRB).
Trạng thái: user duyệt hướng 4 bước lúc 19:xx 10/10/2026 ("fix theo plan ngay lập tức, triệt để").

## 1. Sự việc

| Giờ (VN) | Sự kiện | Nguồn |
|---|---|---|
| 16:59 | T027 nhận đơn `11NDK-005-10102026`, 17:07 bắt đầu chặng `seg-h980kq4` (70p, dự kiến xong 18:07) | Vercel logs phase1 |
| 18:07 → 18:19 | Không có lượt Kết thúc nào từ máy T027 | logs |
| 18:19:47 | Khách chấm 5 sao trên WRB → `PATCH /api/journey/update` ghi `BookingItems.status = 'DONE'` | logs WRB + DB |
| 18:29 | App KTV thấy item DONE → ép `CLEANING` → nhảy REVIEW; T027 đánh giá (`reviewTime` ghi) | logs + `KTVDashboard.logic.ts:823` |
| 18:29:36 → 18:35:24 | 12 lần `PATCH /api/ktv/booking` (RELEASE_KTV) **409** — RPC `ktv_release_work_atomic` cần chặng có `actualEndTime` → "No completed live work to release" | logs |
| 18:35:53 | Quầy auto-handoff cũng thất bại: "KTV đang làm, chưa kết thúc" | logs |

Hậu quả: `KtvAssignments` T027 còn `ACTIVE`, `TurnQueue` `working` trên đơn 005 → không nhận đơn kế tiếp, có thể bị chặn tan ca. Tiền: `KTVDTurnLedger` đã ghi FINAL 70p/5 sao → không mất.

Các lỗi **401** user thấy trong log (`/api/system/config`, `/api/admin/notification-rules`, …) là HeadlessChrome gọi bản `main` khi chưa đăng nhập — không liên quan.

## 2. Nguyên nhân gốc (2 lớp)

1. **WRB** `src/app/api/journey/update/route.ts`: khách chấm sao → đặt item `DONE` vô điều kiện (4 nhánh) + đặt `Bookings.status = 'DONE'` khi mọi item có sao. Trái rule mục 9.6 (DONE chỉ khi `allSegsDone` **và** đã có đánh giá; finish handler còn yêu cầu `allHandovered`).
2. **App KTV** `KTVDashboard.logic.ts:823`: item/đơn DONE + KTV đã bắt đầu → ép `CLEANING` dù chặng của chính KTV chưa có `actualEndTime` → bỏ qua bước Kết thúc.

Nguồn ghi DONE khác đã rà (đều đóng chặng trước): `handleFinishService`, `ktv_release_work_atomic`, quầy `updateBookingItemStatus` (luôn ghi `actualEndTime` khi sang trạng thái kết thúc), `actions.ts:2746` (kiểm `allSegsDone`), cron `ktv-auto-approve` (chỉ item FEEDBACK), pg_cron `auto_complete_unrated_feedback` (chỉ FEEDBACK). Quầy `submitGuestRating` / feedback chỉ ghi điểm, không ghi status item.

## 3. Việc làm

| # | Việc | File | Trạng thái |
|---|---|---|---|
| 1 | Gỡ kẹt T027: ghi `actualEndTime = 2026-10-10T11:19:47Z` (mốc khách chấm sao) cho `seg-h980kq4` | script scratchpad `unstick_t027.cjs --write` | Đã ghi 10/10 ~19:40 (user duyệt); T027 cần nộp ảnh bàn giao để nhả tua |
| 2 | WRB: khách chấm sao chỉ ghi điểm; `DONE` chỉ khi `allSegsDone && allHandovered` (không có chặng KTV → giữ hành vi cũ). `Bookings.status` tính lại bằng RPC `dispatch_recompute_booking_status` (fallback tự tính). Nhánh legacy `status: 'DONE'` cũng đi qua recompute | `src/lib/serviceWorkFinished.ts` (mới), `src/app/api/journey/update/route.ts` | Đã sửa |
| 3 | App KTV: chỉ ép `CLEANING` khi `allDone`; `endedByReception` chỉ nhận chặng đã có `actualEndTime` | `app/ktv/dashboard/KTVDashboard.logic.ts` | Đã sửa |
| 4 | `handleReleaseKTV.fail()` ghi `console.error` lý do 409 | `app/api/ktv/booking/_handlers/handleReleaseKTV.ts` | Đã sửa |
| 5 | Trigger DB `aa_guard_item_done_requires_segments_ended`: UPDATE đặt DONE khi còn chặng mở → giữ status cũ + WARNING | `supabase/migrations/20261010200000_…sql`, `TableInSupabase.md` | **Đã apply DB thật 10/10** qua `DIRECT_URL`; test ROLLBACK 2 item đạt kỳ vọng |

## 4. Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `app/ktv/dashboard` (ScreenEngine), `PATCH /api/ktv/booking` RELEASE_KTV | Điều phối: thẻ Kanban cột IN_PROGRESS giữ lâu hơn khi khách chấm sớm (đúng thực tế); `reception/feedback` không đổi | `BookingItems.status`, RPC `dispatch_recompute_booking_status`, `ktv_release_work_atomic` | Sửa 2 phía + WRB |
| Số liệu (tiền, tua, giờ) | Không đổi công thức — `KTVDTurnLedger` tính từ segments; chặng giờ có `actualEndTime` thật thay vì fallback | Không đổi | `lib/services/Ktv*`, RPC ledger | Khớp |
| Realtime / refresh | subscribe `BookingItems` như cũ; thay đổi chỉ ở cách suy `currentStatus` | subscribe như cũ | `BookingItems` | Đồng bộ |
| Quyền xem | Không đổi | Không đổi | | Không lộ dữ liệu |

## 5. Vùng nổ (mục 4.5)

1. **Dùng chung gì?** `BookingItems.status` (mọi màn), `segments[].actualEndTime` (ledger, Kanban, journey khách), `dispatch_recompute_booking_status` (release RPC, finish RPC). WRB thêm `segments` vào 3 câu select nhỏ (đã có cột, không phải đường nóng `getDispatchData`).
2. **Sai thì sập gì?** Nếu `customerRatingMayCloseItem` sai → item không bao giờ DONE từ WRB → pg_cron `auto_complete_unrated_feedback` ("đã có sao mà vẫn FEEDBACK → DONE") và release RPC (`rated AND all_handed → DONE`) vẫn đóng item; quầy vẫn kéo thẻ được. App KTV: nếu `allDone` sai → KTV ở lại TIMER, vẫn bấm Kết thúc được (finish handler không lùi DONE). Trigger DB: chỉ giữ status cũ, không văng lỗi.
3. **Luồng khách?** Có — WRB journey: khách chấm sao vẫn lưu điểm; màn journey hiện DONE muộn hơn (khi KTV xong). Email / hoá đơn không đổi.
4. **Cô lập?** Có — WRB bọc RPC bằng fallback; app KTV chỉ đổi 2 điều kiện; trigger BEFORE không chạm bảng khác.

## 6. Mô phỏng (mục 10)

`scripts/qa/qa_30_khach_cham_sao_truoc_ktv_ket_thuc.ts` — chạy `npx tsx` (xem kết quả in trong chat 10/10/2026): 1KTV-1DV chấm trước/sau Kết thúc/sau bàn giao, 2KTV-1DV một người xong, chặng voided (đổi KTV), dịch vụ không có KTV, chặng ca đêm qua nửa đêm.

## 7. Triển khai

- Repo Quản trị: nhánh `feat/bit-lo-hong-phase1` (bản staff đang dùng). Cron chạy `main` → không liên quan (không chạm cron).
- WRB: nhánh `main`, Vercel auto-deploy khi push.
- Migration: đã apply bằng node `pg` qua `DIRECT_URL` (`DATABASE_URL` pooler trong `.env.local` sai mật khẩu). Đã push: Quản trị `ec944e76`, WRB `cedf3f4`.
- Dữ liệu cũ: 22 item khác (04/2026 → 02/10) cũng DONE với chặng chưa có `actualEndTime` — không gỡ tự động; chỉ T027 còn `ACTIVE`/`working` hôm nay.
