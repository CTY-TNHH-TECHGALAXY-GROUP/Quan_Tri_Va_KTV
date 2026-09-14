# Plan: Chờ đánh giá quá 5 phút thì tự Hoàn tất

**Mức:** 2 — hàm SQL + pg_cron, chốt tiền KTV (`CLAUDE.md` mục 3, 13).
**Lập:** 2026-09-14 · **Trạng thái:** ĐÃ ÁP LÊN DB 14/09 16:24 (VN) — job `auto_complete_feedback_job` chạy lần đầu 16:25 thành công, chốt 13 dịch vụ (FEEDBACK 135 → 122, còn lại là 121 dịch vụ trước 01/09 + đơn chưa đủ số phút chờ). Code chờ merge `main`.
**Bảng tra:** `plans/nghiep_vu_tam_dung_doi_huy.md`.

---

## 1. Luật đã chốt (14/09)

- Dịch vụ vào **Chờ đánh giá** (KTV đã dọn + bàn giao xong) → sau **5 phút** mà khách chưa chấm thì **tự Hoàn tất**, để KTV thấy tiền.
- Khách chấm trước 5 phút → Hoàn tất ngay như hiện nay (không đổi).
- Lịch sử KTV: đơn không có đánh giá ghi **"Khách hàng không đánh giá"**.
- Áp dụng **mọi đơn**, không riêng đơn đổi KTV.

## 2. Câu hỏi phải chốt — khách chấm SAU 5 phút

Đo thật từ 01/09 (theo thông báo gửi từ màn khách tự chấm):

| | Số dịch vụ |
|---|---|
| Đã vào Chờ đánh giá | 223 |
| Không bao giờ được chấm | 179 (80%) |
| Chấm trước khi vào Chờ đánh giá | 9 |
| Chấm trong 5 phút | 25 |
| **Chấm sau 5 phút** | **10** (3 ca 5–10p, 5 ca 30–120p, 2 ca > 2h) |

→ Cứ 44 lượt chấm thì **10 lượt tới muộn**. Hiện màn khách tự chấm coi đơn `DONE` là "đã đánh giá" (`KioskFeedbackModal.tsx:61,106`, `feedback/page.tsx:76`) → sau khi tự Hoàn tất, **khách không chấm được nữa**.

- **(A) Khuyến nghị — vẫn cho khách chấm muộn, tiền tự tính lại.** KTV thấy tiền ngay ở phút thứ 5; nếu khách chấm sau đó thì cộng thưởng Xuất sắc / trừ theo sao như bình thường (trigger đã nghe `itemRating`). Công bằng cho KTV được khen muộn. Đổi lại: số tiền đã hiện có thể đổi thêm một lần.
- **(B) Chốt cứng.** Qua 5 phút là khoá, sao tới muộn không được nhận. Tiền không bao giờ đổi, nhưng 10/44 lượt khen/chê mất trắng.

## 3. Hiện trạng

Job `auto_skip_rating_job` chạy mỗi giờ, đóng đơn sau **24h** (mã ở `scripts/auto_skip_rating.sql`, không có migration). Hai lỗi:
1. Lọc theo trạng thái booking → **43 dịch vụ kẹt Chờ đánh giá quá 24h**.
2. Ép mọi dịch vụ chưa `DONE` thành `DONE`, kể cả đang dọn → từ 01/09 **55 dịch vụ đóng khi chưa bàn giao**; dịch vụ đã huỷ cũng có thể bị lật.

Job này được **thay hẳn** bằng job mới dưới đây.

## 4. Thay đổi

### 4.1. DB — migration `supabase/migrations/20260914…_auto_complete_feedback_after_5m.sql`

Hàm `auto_complete_unrated_feedback()`, pg_cron **mỗi phút** (`* * * * *`); gỡ `auto_skip_rating_job`.

1. **Dịch vụ:** `status = 'FEEDBACK'` · `itemRating IS NULL` · khách (`BookingGuests.rating`) chưa chấm · mốc vào Chờ đánh giá quá 5 phút.
   - Mốc = `feedbackTime` muộn nhất trong các chặng đã bắt đầu (cả app KTV lẫn quầy đều ghi: `handleFinishService.ts:162,181`, `dispatch/actions.ts:1643`); thiếu thì lùi về `handover_submitted_at`, rồi `timeEnd`.
   - Ghi: `status = 'DONE'`, `options.autoCompletedNoRating = true`, `options.autoCompletedAt`.
   - **Giữ `itemRating = NULL`, không ghi 0** — `handleFinishService` coi mọi giá trị khác NULL là "đã chấm", và NULL là thứ để nhận ra "không đánh giá".
   - Không đụng `CLEANING` / `IN_PROGRESS` / `PAUSED` / `CANCELLED` / `DONE`.
2. **Booking:** tính lại theo đúng luật `recomputeBookingStatus` (`lib/dispatch-status.ts:87`), bỏ qua dịch vụ tiện ích (`Services.is_utility`) như bản TS.
3. Cập nhật `TableInSupabase.md`: hàm + job mới; sửa dòng 107 (trạng thái item thiếu `PAUSED`/`CLEANING`/`FEEDBACK`/`CANCELLED`); ghi `options.autoCompletedNoRating`.

⚠️ Luật booking bị viết lại lần hai bằng SQL (`CLAUDE.md` 4.2). Chấp nhận vì cron chạy trong DB; ghi chú chéo ở cả hai nơi để sửa một bên phải sửa bên kia.

### 4.2. Nếu chốt (A) — cho chấm muộn

- ~~Kiosk coi `DONE` là đã chấm~~ — **đính chính khi code:** `FeedbackDashboard.logic.ts:193` suy trạng thái khách = `FEEDBACK` khi mọi item đã DONE/FEEDBACK/CLEANING, và "đã chấm" chỉ khi KTV có sao > 0 → kiosk **đã sẵn** cho chấm muộn, không phải sửa.
- `feedback/_components/actions.ts`: đang ghi cứng `Bookings.status = 'FEEDBACK'` → booking đã `DONE` bị kéo ngược về cột Chờ đánh giá. **Đã sửa:** không lùi booking đã `DONE`.
- Không cần bỏ cờ `autoCompletedNoRating` khi chấm muộn: lịch sử xét theo sao (`noCustomerRating` = DONE và không có sao), cờ chỉ để truy vết.

### 4.3. Lịch sử KTV

- `app/api/ktv/history/route.ts`: trả `noCustomerRating = đã chốt && chưa có sao && không huỷ && không bị tước`.
- `app/ktv/history/page.tsx`: dòng **Đánh giá** hiện "Khách hàng không đánh giá" thay cho "—".

## 5. Hệ quả nghiệp vụ (mục 13) — "khách không chấm sau 5 phút"

| Khía cạnh | Kết quả |
|---|---|
| Tiền tua | chốt ngay, **không trừ** (không sao → mức trừ `0`) |
| Giờ tích luỹ (D) | trigger `trg_ktvd_enqueue_item` nghe `status` → sổ cái tính lại, hết `is_provisional` |
| Lượt tua | không áp dụng — tua đã tính lúc nhận đơn |
| Thưởng Xuất sắc | 0; (A) chấm muộn ≥ 4 sao thì có |
| Đánh giá tính cho ai | không ai; (A) chấm muộn thì như thường |
| Dọn phòng / bàn giao | **không đổi** — chỉ xét dịch vụ đã bàn giao xong |
| Nợ phòng / chặn tan ca | không đổi — không đụng `CLEANING` |
| Hạn mức bỏ qua bàn giao | không áp dụng |
| TurnQueue / KtvAssignments | không đổi — KTV đã được nhả lúc bàn giao |
| Màn app KTV | không đổi (đơn đã qua REWARD) |
| Đồng hồ | không áp dụng |
| Tự chốt | job mới, mỗi phút |
| Thẻ Kanban | cột Chờ đánh giá → Hoàn tất sau ≤ 6 phút (realtime `BookingItems`) |
| "Cùng làm với" | không đổi |
| Lịch sử KTV | tiền thực nhận + "Khách hàng không đánh giá" |
| Nhật ký quầy | không ghi (hệ thống tự làm) |
| Đổi KTV / kết thúc sớm | người vào thay: như trên · người bị đổi: không liên quan · kết thúc sớm: đã về `DONE` khi bàn giao (plan riêng), không tới đây |

⚠️ **Lần chạy đầu** chốt cùng lúc 13 dịch vụ đang Chờ đánh giá + 43 dịch vụ kẹt cũ → ví các KTV liên quan tăng tiền.
⚠️ Giờ loại D chỉ cập nhật khi worker `ktvd-recompute` chạy trên production (`plan_dua_cron_len_main.md`).

## 6. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Lịch sử, Ví | Kanban, màn khách tự chấm, báo cáo tài chính | hàm SQL + cron, `KTVDRecomputeQueue` | Sửa |
| Số liệu | tiền chốt sau 5 phút | báo cáo cùng sổ cái | `KtvDLedgerEngine` (`DONE` → hết tạm tính), `KtvCommissionService` | Khớp — không đổi công thức |
| Realtime | lịch sử đọc khi mở | Kanban nghe `BookingItems`, `Bookings` | 2 bảng trên | Đồng bộ |
| Quyền xem | KTV chỉ thấy đơn của mình | không đổi | | Không lộ dữ liệu |

## 7. Kiểm

1. **Chạy khô** câu SELECT của hàm trên DB thật: in danh sách sẽ đóng; kỳ vọng **0** dịch vụ `CLEANING`/`CANCELLED`.
2. Mô phỏng (dữ liệu giống thật, `TZ=UTC`): chấm ở phút 3 → DONE theo luồng cũ · không chấm → DONE ở phút 5–6, `itemRating` NULL · (A) chấm ở phút 7 → sao ghi nhận, booking vẫn `DONE`, tiền tính lại · bill 2 khách (một chấm, một không) · 2KTV-1DV bàn giao lệch giờ · ca qua nửa đêm.
3. Đối chiếu 1 KTV loại D + 1 loại A: Lịch sử = báo cáo tài chính (mục 4.3).

## 7b. Chốt thêm 14/09 — mốc 01/09

Chỉ tự chốt item vào Chờ đánh giá **từ 01/09/2026 (giờ VN)**. Đo lúc code: 134 item đang chờ, **121 item trước 01/09** (tháng 5–8, 28 KTV, chưa từng tính tiền) → **không đụng**, quản lý xem và xử lý tay. Chốt vào sẽ cộng tiền cho những tháng đã quyết toán.

## 7c. Chốt thêm 14/09 — số phút chờ cài đặt được

Số phút chờ đọc từ `SystemConfigs.customer_rating_timeout_minutes` (key có sẵn từ 22/07, giá trị 30, chưa code nào đọc) → migration đổi 30 thành **5** (không ghi đè nếu quản lý đã đổi). Sửa ở admin **Cài đặt tính năng → Bàn giao phòng** ("⭐ Thời gian chờ khách đánh giá"). Thiếu / hỏng / âm → 5; `0` = hoàn tất ngay khi bàn giao. Test 41/41.

## 7d. Sự cố 14/09 16:27 — chốt khi người sau còn đang làm

Đơn `11NDK-005-14092026-B`, dịch vụ BODY GỘI làm nối tiếp: người 1 xong 16:20, thẻ Kanban của người 1 kéo cả dịch vụ sang FEEDBACK (lỗi ở `updateBookingItemStatus` — xem `plan_kanban_noi_tiep_giu_dang_lam.md`) trong khi **NH021 làm 16:20–17:20**. Job chỉ nhìn trạng thái → chốt DONE lúc 16:27. Quét toàn bộ: 2/15 dịch vụ bị chốt sai (thêm `11NDK-008-07092026-item3`, chặng NH07 chưa từng bắt đầu).

**Chốt 14/09 (owner):** người sau trong chuỗi cũng phải xong; chờ **cả đơn con** xong, giờ chờ tính từ người xong cuối, chốt cả đơn một lần để khách chấm 1 lần cho mọi người.
- Migration `20260914180000_auto_complete_require_all_segments_done.sql` — user tự chạy trên SQL Editor 14/09.
- Sửa dữ liệu: `scripts/repair_auto_complete_14092026.sql` — item2 → IN_PROGRESS (booking B → IN_PROGRESS), item3 → FEEDBACK; user chạy 14/09.
- Test `qa_auto_complete_feedback.cjs`: 50/50 (thêm: người sau đang làm / chưa bắt đầu / bị tước / đã xong; nhiều dịch vụ trong đơn: còn CLEANING, IN_PROGRESS, PAUSED, xong lệch giờ, xong đủ giờ).

## 8. Không làm

55 dịch vụ cũ bị job 24h đóng khi chưa bàn giao: **để nguyên** — phòng không dọn lại được, mở lại sẽ đảo tiền đã vào ví.
