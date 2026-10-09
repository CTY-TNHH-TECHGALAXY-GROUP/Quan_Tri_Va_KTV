# Prompt cho cửa sổ B: E-Voucher web, phía NganHa-WebBooking

> Dán toàn bộ phần dưới đường kẻ vào một cửa sổ Claude Code mới. Mở cửa sổ đó ở thư mục `CTY TechGalaxy Group/Quan_Tri_Va_KTV` để nó đọc được `CLAUDE.md`, plan và `TableInSupabase.md`.

---

Bạn là **Conversation B (Executor)** của tính năng **E-Voucher giới hạn số lượng phát trên Web Booking**. Conversation A (cửa sổ khác) làm phần Admin và **sở hữu toàn bộ DB**.

## Đọc trước khi làm

1. `CLAUDE.md`, nhất là mục 3 (mức duyệt), 4.5 (vùng ảnh hưởng), 5 (git: không tự commit hay push), 6 (chuẩn code), 7 (DB).
2. `plans/plan_evoucher_webbooking_gioi_han.md`: toàn bộ, nhất là mục 3, 4 (bảng lỗi B1–B20), 7 (user đã chốt) và 9 (tiến độ, phát hiện cho GĐ4).
3. `TableInSupabase.md`, mục **[v15] E-Voucher giới hạn số lượng**. Đây là hợp đồng DB.
4. `supabase/migrations/20261008100000_promotion_web_claim_v15.sql`. **Chỉ đọc.**
5. `.agents/coordination.md`, mục "Conversation B". Chỉ sửa đúng các file được khoá cho B.

## Phạm vi

- **GĐ3 (làm ngay):**
  - Thẻ voucher hiện số "còn X" theo realtime, có các trạng thái OPEN / PAUSED / SOLD_OUT / ENDED.
  - Nút **Lưu voucher**, gọi API giữ chỗ phía server.
  - Ví voucher trong `localStorage` (key `oria_saved_vouchers`), đồng bộ giữa các tab.
  - Màn "Đã lưu!" gồm mã, nút **Xem voucher**, nút **Tiếp tục đặt lịch**, và link `/v/{code}` để mở lại trên thiết bị khác.
- **GĐ4 (chỉ làm sau khi GĐ3 được user OK, và sau khi A báo RPC bọc đã sẵn sàng):**
  - Checkout tự nhận voucher đã lưu, nút **Áp dụng** xem trước tiền giảm.
  - Reprice và quote có voucher.
  - Gọi `webbooking_commit_booking_with_voucher`.
  - Email xác nhận có dòng giảm.
- **GĐ6 (sau GĐ4):** trang `/v/{code}` (thẻ 3D đang có) và PDF/QR.
- **Ngoài phạm vi:** mọi file của repo Quan_Tri_Va_KTV, mọi file SQL / migration. Cần đổi DB (thêm cột, đổi RPC, thêm mã lỗi) thì **dừng lại**, ghi rõ yêu cầu và nhờ user chuyển cho Conversation A.

## Repo và worktree (bắt buộc)

- Repo `../NganHa-WebBooking` đang ở nhánh `feat/oria-care` và có việc khác đang dở. **Không** checkout hay chuyển nhánh ở thư mục đó.
- Tạo worktree riêng từ `origin/master`:
  ```bash
  cd "../NganHa-WebBooking" && git fetch origin master
  git worktree add -b feat/web-evoucher "../NganHa-WebBooking-evoucher" origin/master
  ```
- Mọi sửa code nằm trong `../NganHa-WebBooking-evoucher`. Trước mỗi lần báo xong, chạy `git -C ../NganHa-WebBooking-evoucher branch --show-current` để chắc vẫn đang ở `feat/web-evoucher`.

## Env: chỉ dùng Supabase TEST

- ⚠️ `../NganHa-WebBooking/.env.local` trỏ vào **DB THẬT** (`adzfohfdindovfcpaizb`). **Không được copy file này.**
- Tạo `../NganHa-WebBooking-evoucher/.env.local` mới, lấy 3 biến `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` từ `Quan_Tri_Va_KTV/.worktrees/sequential-two-slot-handoff-20260926/.env.local` (TEST, ref `eknggruuiuadwldacpmb`).
  - Đặt `BOOKING_QUOTE_SECRET` là một chuỗi ngẫu nhiên.
  - **Để trống SMTP_\*** để không gửi email thật.
- Trước khi chạy bất cứ thứ gì ghi dữ liệu, assert URL có chứa `eknggruuiuadwldacpmb`.
- Trên TEST, v15 đã chạy. Công tắc `promotion_web_claim_enabled` mặc định tắt. Để test, tự tạo campaign và bật cờ theo đúng cách `scripts/qa/qa_promotion_web_claim.ts` làm (hàm `setup` và `setFlag`), rồi **dọn sạch sau khi test**.

## Hợp đồng DB (v15, chỉ gọi từ server bằng service role)

| RPC | Dùng ở |
|---|---|
| `promo_web_reserve(p_slug, p_device_hash, p_ip_hash)` | API Lưu voucher. `device_hash` = hash của id ngẫu nhiên lưu trong localStorage. `ip_hash` = SHA-256(IP + secret phía server). **Không gửi IP thô** |
| `promo_web_voucher_status(p_code)` | Checkout tự nhận voucher, trang `/v/{code}`. Không trả SĐT hay tên khách |
| `promo_web_activate(p_code, p_booking_id)` | **KHÔNG gọi trực tiếp.** GĐ4 dùng RPC bọc do A cung cấp |

- Đọc kho: anon key `SELECT` trên bảng `PromotionCampaignStock`, lọc `public_slug`.
- Realtime: `postgres_changes` trên cùng bảng, `filter: public_slug=eq.<slug>`.
- **Realtime không đảm bảo thứ tự.** Chỉ nhận một bản ghi khi `version` của nó **lớn hơn** version đang hiển thị.
- Tải lại kho khi load trang, khi `visibilitychange`/`focus`, và polling mỗi 60 giây làm dự phòng.
- Kết quả RPC có dạng `{success:true,data}` hoặc `{success:false,error:{code,message}}`.

**Mã lỗi phải xử lý riêng.** Không gộp chung vào lỗi 409 "xem lại giỏ"; mỗi mã có câu riêng bằng 5 ngôn ngữ vi/en/cn/jp/kr:

- `FEATURE_DISABLED`: ẩn thẻ.
- `CAMPAIGN_NOT_FOUND`, `CAMPAIGN_NOT_STARTED`, `CAMPAIGN_PAUSED`, `CAMPAIGN_INACTIVE`, `CAMPAIGN_ENDED`
- `SOLD_OUT`: hiện ngay trạng thái hết. Lỗi này có trả kèm `data.stock`.
- `RATE_LIMITED`, `INVALID_REQUEST`
- `VOUCHER_NOT_FOUND`, `VOUCHER_EXPIRED`, `VOUCHER_CANCELLED`, `VOUCHER_ALREADY_USED`
- `WEB_BOOKING_REQUIRED`, `PHONE_LIMIT_REACHED`, `VOUCHER_CUSTOMER_REQUIRED`, `ORDER_CONDITION_NOT_MET`

Trường hợp `reserve` trả `reused: true` nghĩa là thiết bị này đã giữ một voucher. Khi đó hiện lại mã cũ, không báo lỗi.

## Luật bắt buộc (từ plan)

- **localStorage không phải nguồn sự thật.** Mọi trạng thái hiển thị phải lấy từ server. Bọc mọi thao tác đọc/ghi localStorage trong try/catch, vì trình duyệt trong Zalo/Facebook và Safari ẩn danh có thể chặn (B15).
- **Đồng bộ nhiều tab:** dùng sự kiện `storage`. Tab B phải thấy mã đã lưu ở tab A; cùng một thiết bị thì không xin mã mới.
- **Không đặt dữ liệu voucher vào đường nóng.** Thẻ voucher tải riêng, lỗi thì ẩn thẻ. Không chèn vào `/api/services`, và không làm chậm hay hỏng trang checkout hiện có (CLAUDE.md 4.5).
- **API Lưu voucher có chống bot:**
  - Thêm giới hạn tần suất phía route (theo IP). Đây là lớp phụ; DB đã giới hạn 1 lượt giữ cho mỗi thiết bị và 3 lượt cho mỗi IP.
  - Đề xuất thêm Vercel BotID, nhưng **hỏi user trước khi thêm dependency**.
- **Chữ hiển thị** để trong `*.i18n.ts` hoặc dictionaries, đủ 5 ngôn ngữ. **Không hard-code** chuỗi trong `.tsx`.
- **Giao diện spa:** mobile-first, vùng chạm ≥ 44px, theo phong cách thẻ voucher Oria đang có.
- **Tên thương hiệu:** dùng "Oria Spa". Không dùng "Ngân Hà Spa".

## Cách làm và báo cáo

1. **Mức 1:** viết plan ngắn trong chat cho GĐ3, gồm bảng Ảnh hưởng chéo và 4 câu về vùng ảnh hưởng. **Dừng, chờ user OK.**
2. **Code và test trên TEST:**
   - 2 tab cùng lúc.
   - Bấm Lưu khi chỉ còn 1 suất.
   - Mất mạng rồi có mạng lại.
   - Chặn localStorage.
   - Trình duyệt trong Zalo (giả lập).
   - Chạy `npm run build` và lint.
3. **Báo user:**
   - File đã sửa.
   - Kết quả test.
   - Gợi ý commit message (Conventional Commits, tiếng Việt không dấu), kèm bảng **ảnh hưởng vận hành** (CLAUDE.md 5.1).
   - **Không tự commit hay push.**
4. Xong việc: đổi mục "Conversation B" trong `.agents/coordination.md` sang 🔴 và thêm 1 dòng vào bảng Lịch sử.

---

## Bổ sung 08/10/2026: hợp đồng GĐ4 (phần DB do Conversation A làm, đã sẵn sàng trên TEST)

Migration `supabase/migrations/20261008150000_webbooking_commit_with_voucher_v16.sql` đã chạy trên TEST. QA `scripts/qa/qa_promotion_web_claim.ts` PASS, gồm 17 ca ghi đơn (W1–W10) và 9 ca xem trước (P1–P7). Chi tiết ở `TableInSupabase.md`, mục `[v16]`.

### 1. Nút Áp dụng ở checkout: `promo_web_preview(p_code, p_items)`
- `p_items` là **chính các dòng sẽ gửi cho writer**, dạng `[{serviceId, quantity, options}]`. Server tự lấy giá.
- Kết quả thành công: `{eligible, unmetReasons[], discountAmount, appliedMinutes, subtotalAmount, totalAmount, expiresAt}`.
  - `eligible = false`: hiện `unmetReasons` (câu tiếng Việt do engine trả về; cần tự dịch hoặc hiện câu chung đủ 5 ngôn ngữ).
- Lỗi: `FEATURE_DISABLED`, `VOUCHER_NOT_FOUND / EXPIRED / CANCELLED / ALREADY_USED`, `CAMPAIGN_ENDED / INACTIVE`, `INVALID_REQUEST`, `SERVICE_NOT_BOOKABLE`.
- Chỉ dùng để hiển thị. **Số tiền thật là số writer trả về lúc đặt.**

### 2. Ghi đơn: `webbooking_commit_booking_with_voucher(p_booking, p_items, p_voucher_code)`
- **Chỉ gọi khi có mã.** Không có mã thì giữ nguyên `webbooking_commit_booking`.
- `p_booking.totalAmount`, quote HMAC và reprice vẫn là **tổng trước giảm**. Writer cũ vẫn kiểm `BOOKING_TOTAL_CONFLICT` theo tổng này.
- Thành công: kết quả như writer cũ, thêm `voucher: {applied, voucherCode, discountAmount, totalAmount (sau giảm), subtotalAmount (trước giảm)}`.
- **Voucher bị từ chối:** lỗi Postgres có message `VOUCHER_REJECTED:<MÃ>` (vd `VOUCHER_REJECTED:VOUCHER_EXPIRED`, `...:PHONE_LIMIT_REACHED`, `...:ORDER_CONDITION_NOT_MET`, `...:VOUCHER_ALREADY_USED`, `...:FEATURE_DISABLED`).
  - **Đơn KHÔNG được tạo** (rollback).
  - Route trả 409 với `code: 'VOUCHER_REJECTED'` và `voucherError: '<MÃ>'`. **Không dùng lỗi 409 chung "xem lại giỏ".**
  - Client hỏi khách "Đặt không kèm voucher?". Nếu khách đồng ý thì gửi lại **cùng idempotency key**, không kèm mã. Gửi lại được vì lần trước đã rollback.
- **Gửi lại cùng key, cùng mã:** `idempotent: true`, `voucher.applied: true`. Đơn không bị giảm lần hai.
- **Gửi lại cùng key nhưng khác mã / giờ / dịch vụ:** `IDEMPOTENCY_KEY_REUSED`, như writer cũ.
- **Lần đầu không mã, gửi lại kèm mã:** `idempotent: true`, `voucher: {applied:false, reason:'REPLAY_WITHOUT_VOUCHER'}`. Đơn giữ nguyên và **không giảm**; phải báo đúng cho khách.

### 3. Route `/api/bookings` phải sửa (nếu không, đơn có voucher sẽ bị coi là "incomplete")
- **Kiểm snapshot sau khi ghi** (`replayLinesMatch`, so sánh `totalAmount`):
  - **Bỏ các dòng `options.isPromotion === true`** khi so sánh dòng.
  - So `snapshot.totalAmount + voucher.discountAmount === pricing.totalAmountVND`.
  - Áp dụng cho cả nhánh `writerReplay`, nhánh ghi lần đầu và `reconcileAfterUncertainCommit` / `resolveReplayConflict`.
- **Email xác nhận** (`sendBookingConfirmationEmail`) và màn thành công: hiện Tạm tính, dòng "Oria Booking Reward −X" và Tổng sau giảm, đủ 5 ngôn ngữ.
- **`options` của mỗi dòng phải do server dựng** (`buildBookingItems`), không lấy từ client. Engine đọc `options.duration` để xét điều kiện "từ X phút"; nếu lấy từ client thì khách có thể sửa để lách điều kiện.
- Sau khi đặt thành công: xoá mã khỏi ví localStorage. Hoặc để `promo_web_voucher_status` báo `ACTIVE`, rồi ví tự dọn.

### 4. Test bắt buộc của GĐ4 (CLAUDE.md mục 9.8 áp cho luồng đặt)
- 1 dịch vụ; 2 dịch vụ; nhiều khách; đặt cho ngày mai.
- Gửi lại (double click / mạng chập).
- Mã hết hạn giữa lúc Apply và lúc Xác nhận.
- Hai tab cùng đặt bằng một mã.
- Tắt công tắc giữa chừng.
- Đơn không kèm mã: kết quả phải **y hệt trước đây**.
