# Plan: E-Voucher giới hạn số lượng, phát trên Web Booking, Admin kiểm soát

> **Mức 2.** Plan này chạm DB, RPC, tiền, đường nóng tạo đơn của WebBooking và hai repo.
> **Trạng thái:** CHỜ DUYỆT. Chưa sửa code.
> **Ngày viết:** 08/10/2026.
> **Spec gốc:** "Web Booking Limited E-Voucher Campaign", do user gửi ngày 07/10/2026.

User chốt ngày 08/10/2026: voucher **phát trên WebBooking**, **Admin kiểm soát chương trình**.

---

## 1. Hiện trạng (đã kiểm tra trên DB thật, chỉ đọc)

### Đã có

- **Engine Promotion v1–v14** đã chạy trên DB thật.
  - Có sẵn: `PromotionCampaigns`, `CustomerPromotionPasses`, `PromotionUsages`, cách tính giảm `promo_compute_discount_ex`, điều kiện `apply_conditions.sources`, hàm `promo_booking_channel`.
  - Code admin mới nằm ở `feat/bit-lo-hong-phase1`, chưa lên `main`.
- **WebBooking** ghi đơn nguyên tử qua RPC `webbooking_commit_booking(p_booking, p_items)`, đã có trên DB thật.
  - Giá do server tính lại.
  - Có quote HMAC giữ giá 5 phút.
  - Có idempotency key.

### Chưa có

- Tổng số lượng voucher của cả chương trình, trạng thái RESERVED, việc hết hạn giữ chỗ.
- Khách tự lưu voucher, kích hoạt khi tạo đơn.
- Realtime cho promo (không bảng promo nào có trong `supabase_realtime`).
- Rate limit và chống bot phía WebBooking.

### Số liệu thật

| Chỉ số | Giá trị |
|---|---|
| Đơn `WB-` tháng 09 | 134 đơn (≈ 4,5 đơn/ngày), bill trung bình **1.493.545đ**, huỷ 19 đơn (**14%**) |
| Đơn `WB-` 01–07/10 | **chỉ 2 đơn** (xem rủi ro R0) |
| `source` của đơn `WB-` 14 ngày qua | 9/9 đơn = `STANDARD_WALK_IN` (quầy ghi đè ở `app/reception/web-booking/actions.ts:290`) |
| Chương trình đang có | 1 ACTIVE PERCENT (UNLIMITED), 1 ACTIVE FREE_MINUTES (LIMITED), 6 pass ACTIVE |

---

## 2. Lợi ích và chi phí cơ hội

### 2.1. Lợi ích

| Lợi ích | Vì sao |
|---|---|
| Kéo khách đặt qua web thay vì gọi điện hoặc Zalo | Quầy đỡ việc nghe máy. Dữ liệu đơn sạch, có sẵn dịch vụ, giờ, SĐT |
| Thu SĐT và email vào CRM | Lúc kích hoạt đã có hồ sơ khách. Có thể dùng cho email voucher lần sau |
| Phễu đo được: Xem → Lưu → Kích hoạt → Dùng | Biết chương trình nào hiệu quả. Engine cũ không đo được bước "Lưu" |
| Tạo cảm giác khan hiếm ("còn 6 voucher") | Tăng tỉ lệ chốt đơn mà không cần giảm sâu |
| Hạ tầng dùng lại được | Cùng kiến trúc cho %, tiền cố định, +30 phút (engine đã hỗ trợ). Riêng FREE_SERVICE engine chưa hỗ trợ |

### 2.2. Chi phí

| Hạng mục | Ước lượng |
|---|---|
| Tiền giảm trực tiếp | 20 voucher × 10% × ~1,5tr ≈ **3 triệu đồng mỗi chương trình**. Nhỏ |
| Công làm | Khoảng **8–12 ngày công** trên 2 repo, cộng QA chạy đồng thời và kiểm tra đối chiếu tài chính |
| Rủi ro vận hành | Sửa RPC tạo đơn của web: **lỗi là khách không đặt được** (xem B6) |
| Đào tạo quầy | Nhận diện đơn có voucher web; không áp ngoại lệ được |

### 2.3. Chi phí cơ hội (làm việc này thì chưa làm được việc khác)

- **Những việc đang chờ cùng khoảng thời gian đó:**
  - Đưa phase1 + Promotion lên `main` (`plans/plan_merge_phase1_vao_main.md`).
  - Sửa 4 lỗi production (`plans/plan_sua_4_loi_production_20261004.md`).
  - Endpoint `/api/admin/promotions/contact` còn dở.
- **Phương án rẻ hơn (khoảng 1–2 ngày):** đăng một mã chung trên web và dùng engine hiện có với điều kiện `sources = [WEB_BOOKING]`, quầy quét áp. Phương án này **thiếu** giới hạn tổng số lượng, thiếu realtime, và quầy vẫn áp ngoại lệ được. Hợp để **thử nhu cầu**, không hợp nếu cam kết "đúng 20 suất".
- **Khuyến nghị:** làm bản đầy đủ nhưng **cắt giai đoạn** như mục 6. Trang 3D `/v/{code}` và PDF để **sau cùng**, vì không ảnh hưởng tới doanh thu ban đầu. Trước khi làm phải xử lý **R0**: nếu lượng đơn web đang tụt vì lỗi thì voucher cũng không cứu được.

---

## 3. Kiến trúc chốt (khuyến nghị)

### 3.1. Admin kiểm soát được gì

| Điều khiển | Hành vi |
|---|---|
| Tạo chương trình loại **"Phát trên Web Booking"** (`distribution_channel = WEB_CLAIM`) | Đặt tổng số lượng, thời gian giữ chỗ (mặc định 30 phút, xem Q4), số voucher tối đa mỗi SĐT, ngày bắt đầu / kết thúc, ưu đãi, điều kiện áp |
| **Tạm dừng phát** (`INACTIVE`) | Ngừng nhận lượt Lưu mới **ngay lập tức** (web đổi sang "Tạm ngưng" qua realtime). Voucher đã giữ hoặc đã kích hoạt **vẫn dùng được** |
| **Kết thúc** (`ENDED`) | Ngừng Lưu **và** ngừng kích hoạt. Các lượt đang giữ chuyển EXPIRED. Voucher đã ACTIVE vẫn dùng được tới `valid_until` |
| **Đổi tổng số lượng** | Chỉ được tăng, hoặc giảm **không thấp hơn số đã cấp**. DB từ chối nếu vi phạm |
| **Thu hồi một voucher** | RESERVED hoặc ACTIVE → CANCELLED, có ghi lý do. Slot trả về kho nếu chương trình còn chạy |
| **Giải phóng mọi lượt giữ** (nút khẩn cấp khi bị bot vét) | Toàn bộ RESERVED → CANCELLED, kho được trả lại |
| **Công tắc tổng** `SystemConfigs.promotion_web_claim_enabled` | Tắt thì WebBooking ẩn thẻ voucher và RPC tạo đơn **bỏ qua** voucherCode. Đơn vẫn tạo bình thường |
| **Dashboard realtime** | Tổng / Còn / Đang giữ / Đã kích hoạt / Đã dùng / Hết hạn / Huỷ. Kèm danh sách voucher: mã, khách, trạng thái, các mốc giờ, mã đơn |

### 3.2. Mô hình dữ liệu

Không bỏ `NOT NULL` ở `CustomerPromotionPasses.customer_id`, vì mọi RPC promo đang giả định có khách.

| Đối tượng | Nội dung |
|---|---|
| `PromotionCampaigns` (thêm cột) | `distribution_channel` (`ADMIN_ISSUE` mặc định, hoặc `WEB_CLAIM`), `total_quantity`, `reservation_minutes`, `max_claims_per_phone`, `public_slug` |
| **`PromotionWebClaims`** (bảng mới) | `id`, `campaign_id`, `voucher_code` UNIQUE, `status` (RESERVED, ACTIVE, REDEEMED, EXPIRED, CANCELLED), `reserved_at`, `reservation_expires_at`, `claim_ip_hash`, `activated_at`, `activation_booking_id` (UNIQUE), `activation_channel`, `pass_id`, `usage_id`, `redeemed_at`, `cancelled_reason` |
| **`PromotionCampaignStock`** (bảng công khai) | `public_slug`, `status`, `available`, `total`, `updated_at`. **Bảng duy nhất anon được SELECT** và nằm trong `supabase_realtime`. Do RPC cập nhật |
| Ràng buộc | `CHECK (allocated <= total_quantity)` với allocated = RESERVED + ACTIVE + REDEEMED. Unique index `(activation_booking_id)` |

Khi kích hoạt, hệ thống tạo `CustomerPromotionPasses` và `PromotionUsages` **như luồng hiện có**. Nhờ vậy màn quét, danh sách usage, báo cáo và các trigger DONE/CANCELLED dùng lại được.

### 3.3. Các RPC (SECURITY DEFINER, chỉ cấp cho `service_role`)

1. **`promo_web_reserve(slug, ip_hash)`**
   - Khoá dòng campaign bằng `FOR UPDATE`.
   - Cho hết hạn các lượt RESERVED quá hạn của campaign đó.
   - Kiểm tra trạng thái, ngày hiệu lực, kho còn, giới hạn theo IP.
   - Sinh mã, insert RESERVED, cập nhật `PromotionCampaignStock`.
   - Trả về `{code, expiresAt, available}` hoặc `SOLD_OUT`, `PAUSED`, `ENDED`, `RATE_LIMITED`.
2. **`promo_web_validate(code, cart)`**
   - Chỉ đọc. Trả trạng thái, tiền giảm dự kiến (dùng lại `promo_compute_discount_ex`) và lý do nếu không đạt.
3. **`promo_web_activate(code, booking_id)`**
   - Chỉ được gọi **bên trong `webbooking_commit_booking`**, cùng transaction.
   - Khoá dòng claim, kiểm tra RESERVED, chưa hết hạn, chương trình đang chạy, điều kiện áp.
   - Tạo pass + usage + dòng giảm `KM####`, cập nhật `totalAmount`, chuyển claim sang ACTIVE với `activation_channel = 'WEB_BOOKING'`.
4. **`promo_web_admin_*`**: tạm dừng, thu hồi, giải phóng, đổi số lượng. Mỗi thao tác ghi log người làm.
5. **pg_cron** chạy mỗi 2 phút: cho hết hạn lượt giữ và cập nhật kho. **Không chỉ dựa vào cron** (xem B3).

### 3.4. Trạng thái so với engine cũ

| Spec | Lưu ở đâu |
|---|---|
| RESERVED | `PromotionWebClaims.status` |
| ACTIVE | claim ACTIVE + usage `APPLIED` (giảm ngay vào tổng đơn, xem Q1) |
| REDEEMED | usage `COMPLETED`: trigger có sẵn chạy khi đơn DONE, thêm cập nhật claim |
| CANCELLED (đơn huỷ hoặc no-show) | Trigger có sẵn huỷ usage, thêm cập nhật claim và trả slot (xem Q2) |

---

## 4. Lỗi tiềm ẩn và cách chặn

| # | Lỗi tiềm ẩn | Hậu quả | Cách chặn | Test bắt buộc |
|---|---|---|---|---|
| **R0** | Đơn web tháng 10 chỉ có 2 đơn trong 7 ngày (tháng 09 là 134 đơn) | Chạy voucher trên một phễu có thể đang hỏng | **Kiểm tra trước khi làm**: production WebBooking đang ở bản nào, `/api/bookings` có lỗi không, mã bill có đổi không | Probe log Vercel và DB |
| **B1** | Bán vượt số lượng do hai người cùng bấm | Phát 21 voucher cho chương trình 20 suất | `FOR UPDATE` trên dòng campaign + `CHECK allocated <= total`. Không bao giờ đọc rồi trừ ở client | 50 request song song vào chương trình còn 1 suất → đúng 1 SUCCESS, 49 SOLD_OUT |
| **B2** | Bot hoặc một người vét sạch kho | Khách thật thấy "Hết" | Giới hạn theo IP hash (1 lượt giữ mỗi IP mỗi chương trình), Vercel BotID hoặc Turnstile, giữ chỗ ngắn 30 phút, nút "Giải phóng mọi lượt giữ", `max_claims_per_phone` kiểm tra lúc kích hoạt | 1 IP Lưu 5 lần → 1 thành công, 4 lần `RATE_LIMITED` |
| **B3** | Lượt giữ hết hạn không được trả về kho vì cron chết (job pg_cron xoá ảnh chấm công **đang hỏng**) | Kho kẹt ở 0 dù thực tế còn | Cho hết hạn tại chỗ trong mọi RPC reserve, validate, activate + cron 2 phút + dashboard cảnh báo khi có RESERVED quá hạn hơn 10 phút | Tắt cron rồi Lưu → slot quá hạn vẫn được thu hồi |
| **B4** | Realtime lộ dữ liệu khách | Lộ SĐT, mã voucher | Anon chỉ đọc được `PromotionCampaignStock`. Các bảng promo khác giữ RLS không policy | Dùng anon key SELECT `PromotionWebClaims` → 0 dòng hoặc lỗi |
| **B5** | Mất sự kiện realtime (tab ngủ, mạng yếu) | Thẻ hiện "còn 3" trong khi đã hết | Tải lại khi `visibilitychange` hoặc `focus` + polling 60 giây làm dự phòng. **Server vẫn kiểm tra lại** ở reserve, validate, activate | Ngắt mạng 2 phút, bật lại → số đúng |
| **B6** | Voucher lỗi làm hỏng việc tạo đơn (đường nóng) | **Khách không đặt được lịch** | Không có voucherCode thì RPC chạy **y như cũ**. Voucher không hợp lệ thì trả mã lỗi riêng `VOUCHER_*` (không dùng 409 chung), client hỏi "Đặt không kèm voucher?". Có công tắc tổng | Hồi quy: đặt không voucher, 1KTV-2DV, nhiều khách, replay idempotency → kết quả giống hệt trước khi sửa |
| **B7** | Gửi lại request (idempotency) làm kích hoạt 2 lần, hoặc 1 voucher gắn 2 đơn | Giảm hai lần | Unique `activation_booking_id`. Claim khoá `FOR UPDATE`. Replay trả lại kết quả cũ, không gọi activate lần nữa | Replay cùng key; 2 tab cùng đặt với 1 mã → 1 đơn có giảm, đơn kia báo `VOUCHER_ALREADY_USED` |
| **B8** | Giá xem trước khác giá chốt (quote HMAC giữ tổng cũ) | Lỗi `PRICE_CHANGED` liên tục khi có voucher | Quote thêm `voucherCode` và tiền giảm. `/api/bookings/reprice` gọi validate. Lúc commit tính lại, lệch thì trả mã riêng | Áp voucher, đổi giỏ, xác nhận → giá đúng, không lỗi oan |
| **B9** | Kiểm nguồn đơn bằng `Bookings.source` | Đơn web bị từ chối vì quầy đã đổi source | Chỉ kích hoạt **trong RPC của web** và lưu `activation_channel` vào claim. Không đọc lại `source` | Quầy xác nhận đơn web (source đổi sang WALK_IN) → voucher vẫn ACTIVE |
| **B10** | Quầy áp ngoại lệ voucher web cho đơn walk-in | Phá luật "chỉ Web Booking" | Với `WEB_CLAIM`, `promo_apply_pass` trả `WEB_BOOKING_REQUIRED` **không cho override**. Mã chỉ kích hoạt được qua RPC web | Quầy quét mã web áp vào đơn walk-in → bị từ chối kể cả có quyền override |
| **B11** | Quầy sửa đơn web (thêm, bớt dịch vụ) sau khi đã giảm | Tiền giảm sai: % tính trên giỏ cũ, hoặc tổng âm | Theo luật engine hiện tại cho dòng `KM`. Bổ sung: bớt dịch vụ làm không còn đạt điều kiện thì cảnh báo ở quầy. Trần giảm ≤ tổng | Thêm hoặc bớt dịch vụ, xoá item → tổng đúng, không âm |
| **B12** | Đơn huỷ hoặc no-show (14% đơn web bị huỷ) | Slot bị kẹt, hoặc voucher dùng lại được sai | Trigger có sẵn huỷ usage, thêm: claim → CANCELLED, trả slot theo Q2 | Huỷ đơn → kho +1 (nếu Q2 = trả), realtime cập nhật |
| **B13** | Admin giảm tổng xuống dưới số đã cấp, hoặc Kết thúc khi còn lượt đang giữ | Số âm, khách đang giữ bị mất quyền mà không biết | DB từ chối giảm dưới allocated. Kết thúc thì lượt giữ → EXPIRED và web báo rõ "Chương trình đã kết thúc" | Đổi số lượng xuống 5 khi đã cấp 8 → bị từ chối |
| **B14** | Biên ngày giờ: `valid_until`, server chạy UTC | Voucher hết hạn sớm hoặc muộn 7 giờ | So sánh `timestamptz` trong SQL. Hiển thị theo Asia/Bangkok (`gioDongHoVN`). Chạy test dưới `TZ=UTC` | Chương trình kết thúc 23:59 ngày X → 23:58 VN vẫn Lưu được, 00:01 bị từ chối |
| **B15** | Không dùng được localStorage (trình duyệt trong Zalo/Facebook, Safari ẩn danh) hoặc khách đổi thiết bị | Mất ví voucher, khách "mất" voucher đã lưu | Bọc try/catch, rơi về bộ nhớ tạm. Màn "Đã lưu" luôn hiện **mã + link `/v/{code}`** để mở lại. Checkout có ô "Có mã voucher?" làm đường phụ | Mở trong Zalo in-app → Lưu → mở Safari dán link → checkout nhận mã |
| **B16** | `clearBookingCart()` xoá nhầm ví, hoặc ví giữ mã đã dùng | Checkout gợi ý voucher đã hết hạn | Ví dùng key riêng `oria_saved_vouchers`. Sau khi kích hoạt hoặc hết hạn thì validate trả trạng thái mới và client tự dọn | Đặt xong → mở tab mới không còn gợi ý mã cũ |
| **B17** | Dò mã qua `/v/{code}` hoặc `validate` | Dùng mã của người khác | Mã 8 ký tự ngẫu nhiên (bộ 32 ký tự). Rate limit validate theo IP. Trang công khai chỉ hiện ưu đãi và trạng thái, **không hiện tên, SĐT, mã đơn đầy đủ** | Dò 100 mã/phút → bị chặn |
| **B18** | Các màn hiển thị tiền chưa biết dòng giảm (email xác nhận, hoá đơn/journey ở WRB nội bộ, báo cáo tài chính, hoa hồng KTV) | Khách thấy tổng chưa giảm. Báo cáo doanh thu hoặc **hoa hồng KTV lệch** | **Đã kiểm tra:** `lib/services/Ktv*Commission*`, `*Turn*`, `app/api/finance/*` và WRB nội bộ **không có chỗ nào xử lý `isPromotion` / dòng `KM`**. Rủi ro này **đã tồn tại** với voucher % đang ACTIVE. Phải đối chiếu (mục 4.3 CLAUDE.md) trước khi bật | Đơn 1KTV-1DV có voucher 10% → hoa hồng KTV, doanh thu báo cáo, hoá đơn khách khớp với kỳ vọng nghiệp vụ |
| **B19** | Hai nguồn SQL của `webbooking_commit_booking`: chỉ có trong file paste ở repo WebBooking, không có trong `supabase/migrations` của admin | Ghi đè nhầm phiên bản cũ, mất kiểm soát thay đổi | Trước khi sửa, dump định nghĩa đang chạy trên DB thật (`pg_get_functiondef`) và lưu thành migration chính thức. Sửa trên bản dump đó | So sánh diff định nghĩa trước và sau |
| **B20** | Sai thứ tự deploy giữa 2 repo và DB | WebBooking gửi `voucherCode` khi RPC chưa nhận → `BOOKING_FIELD_NOT_ALLOWED` → **không đặt được** | Thứ tự: migration (công tắc TẮT) → admin → WebBooking → bật công tắc. RPC mới chấp nhận cả payload cũ | Deploy WebBooking cũ với DB mới → vẫn đặt được |

---

## 5. Ảnh hưởng chéo (4.1) và vùng ảnh hưởng (4.5)

### 5.1. Bảng ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không đổi màn KTV. Dòng `KM` đã tồn tại với engine hiện tại | Form chương trình, dashboard, màn quét (chặn override), danh sách voucher | `webbooking_commit_booking`, các RPC `promo_*`, bảng mới | Sửa |
| Số liệu tiền / hoa hồng | **Cần xác nhận** hoa hồng KTV có bị dòng giảm âm ảnh hưởng không (B18) | Doanh thu báo cáo | `promo_compute_discount_ex` (một nguồn) | **Cần đối chiếu** trước khi bật |
| Realtime | Không đổi | Dashboard subscribe `PromotionCampaignStock` | Bảng công khai mới | Thêm |
| Quyền xem | KTV không thấy gì mới | Admin cần quyền `promotions.*`, thu hồi cần quyền riêng | Anon chỉ đọc được bảng kho | Không lộ dữ liệu |

### 5.2. Bốn câu về vùng ảnh hưởng

1. **Tính năng nào dùng chung?**
   - `webbooking_commit_booking`: **đường nóng của mọi đơn web**.
   - `promo_apply_pass`: màn quét ở quầy.
   - Trigger `tr_promo_on_booking_status`: mọi lần đổi trạng thái đơn.
2. **Nếu sai thì sập cái gì?** Khách không đặt được trên web (B6, B20). Quầy vẫn làm việc được. KTV không bị ảnh hưởng nếu B18 đạt.
3. **Có đụng luồng khách không?** **Có**: WebBooking checkout, email xác nhận, trang `/v/`, và hoá đơn/journey ở WRB nội bộ.
4. **Cô lập được không?**
   - Có công tắc tổng.
   - Không có `voucherCode` thì RPC chạy y nguyên.
   - Thẻ voucher ở WebBooking tải riêng, bọc try/catch, **không nằm trong** request `/api/services` hay checkout chính.
   - Dashboard admin query riêng.

---

## 6. Các giai đoạn và điều kiện để qua giai đoạn

| GĐ | Nội dung | Điều kiện qua |
|---|---|---|
| **0** | Kiểm tra R0 (đơn web tụt). Dump định nghĩa `webbooking_commit_booking` thành migration (B19). Đối chiếu tiền và hoa hồng của dòng `KM` (B18) | User xác nhận phễu web bình thường, đã biết rõ hướng xử lý B18 |
| **1** | Migration bảng, cột, RPC reserve / validate / admin + cron. Chạy trên **Supabase TEST** | Mô phỏng 50 request đồng thời (B1), bot (B2), cron chết (B3), RLS anon (B4) đều đạt |
| **2** | Admin: form chương trình `WEB_CLAIM`, các nút điều khiển, dashboard realtime, chặn override ở màn quét (B10) | QA trên preview TEST |
| **3** | WebBooking: thẻ voucher + realtime + ví localStorage (đồng bộ tab bằng sự kiện `storage`, tải lại khi `visibilitychange`), route reserve có rate limit + BotID | B5, B15, B16, B17 đạt |
| **4** | Checkout: tự nhận voucher, Apply, reprice/quote có voucher. Mở rộng `webbooking_commit_booking` gọi `promo_web_activate`. Email có dòng giảm | Hồi quy B6 / B7 / B8 / B20. Đối chiếu tiền hai phía (B18) |
| **5** | Trigger huỷ, DONE → cập nhật claim và kho (B12) | Huỷ, no-show, DONE đều đúng kho |
| **6** | Trang `/v/{code}` 3D + PDF/QR | Không lộ dữ liệu (B17) |
| **Go-live** | Deploy theo thứ tự B20, bật công tắc với một chương trình 3 suất chạy thử nội bộ, sau đó mới mở 20 suất | Theo dõi 48 giờ |

**Rollback:**
- Tắt công tắc tổng: web ẩn thẻ, RPC bỏ qua voucher.
- Code: revert từng commit theo giai đoạn.
- DB: viết thêm phần cho tính năng này vào `plans/sql/rollback_promotion_engine.sql`.
- Voucher đã ACTIVE giữ nguyên, vì đó là cam kết với khách.

---

## 7. User chốt (08/10/2026)

| # | Câu hỏi | Quyết định |
|---|---|---|
| **Q1** | ACTIVE có trừ tiền ngay vào tổng đơn không? | **Có.** Trừ lúc đặt, quầy không áp ngoại lệ được |
| **Q2** | Đơn có voucher bị huỷ hoặc no-show thì trả suất không? | **Trả suất** về kho (nếu chương trình còn chạy). Voucher của đơn đó chuyển CANCELLED |
| **Q3** | Có cho chuyển mã cho người khác không? | **Cho**: ai có đúng mã thì dùng được. Voucher gắn vào SĐT của đơn khi kích hoạt |
| **Q4** | Giữ chỗ 30 phút + chống bot? | **Có** |
| **Q5** | Mỗi SĐT được mấy voucher? | **Đã chốt:** `max_open_per_phone = 1`. Mỗi SĐT có **1 voucher chưa dùng** tại một thời điểm; khách quay lại vẫn lấy được nếu còn suất và còn hạn. Tuỳ chọn `max_total_per_phone`, để trống = không giới hạn |

## 8. Kết quả Giai đoạn 0, phần R0 (08/10/2026, DB thật, chỉ đọc)

Đơn `WB-` theo ngày tạo (giờ VN) trong 21 ngày gần nhất:
- 16–26/09: 30 đơn, ngày cao nhất là 10 đơn (23/09).
- 27/09–07/10: **2 đơn** (02/10 và 05/10). Tổng đơn toàn hệ thống vẫn khoảng 15–30 đơn mỗi ngày.

Con số 134 đơn của tháng 09 **dồn vào đầu tháng**, quanh lúc go-live. Hai đơn trong tháng 10 cho thấy luồng tạo đơn **vẫn chạy**, nhưng lượng đơn web tự nhiên hiện chỉ còn khoảng **0,2 đơn mỗi ngày**.

Hệ quả:
- Chương trình 20 suất có thể mất nhiều tuần mới hết suất. Hiệu ứng "còn X suất" yếu nếu không kéo thêm traffic vào web (quảng cáo, QR tại quầy, Zalo).
- **Vẫn cần kiểm tra lỗi phía client** (log Vercel của WebBooking: 4xx/5xx ở `/api/bookings` và `/reprice`), vì DB chỉ thấy các đơn tạo **thành công**.

- User 08/10/2026: chương trình offline có kênh riêng, nên lượng đơn web thấp **không chặn** việc làm tính năng này.

## 9. Tiến độ (08/10/2026)

### Giai đoạn 0: xong
- **B19:** đã lấy định nghĩa `webbooking_commit_booking` đang chạy trên DB thật, lưu tại `plans/sql/baseline_webbooking_commit_booking_20261008.sql`. Phần thân **giống hệt** file paste trong repo WebBooking. Chỉ `service_role` được gọi.
- **B18:** hoa hồng KTV (`KtvCommissionService`) tính theo **phút và mã KTV**. Dòng `KM` có `technicianCodes = {}` và `segments = []`, nên **không ảnh hưởng hoa hồng**. Doanh thu ở báo cáo tài chính dùng `Bookings.totalAmount`, tức đã trừ giảm, là đúng. Bảng theo dịch vụ hiện thêm một dòng `KM####` âm, tổng vẫn khớp. Chỉ số "doanh thu theo KTV" trong bảng xếp hạng chia theo `totalAmount` nên giảm theo voucher. Đây là chỉ số tham khảo, không phải tiền lương. Còn phải kiểm ở GĐ4: hoá đơn / journey ở WRB nội bộ hiển thị dòng âm.

### Giai đoạn 1: xong trên TEST (chưa chạy trên DB thật)
- Migration `supabase/migrations/20261008100000_promotion_web_claim_v15.sql`, đã chạy trên Supabase TEST. Chạy lại nhiều lần vẫn an toàn.
- Rollback `plans/sql/rollback_promotion_web_claim_v15.sql`, đã chạy thử trên TEST trong transaction rồi huỷ.
- `TableInSupabase.md` có mục `[v15]`.
- **Thay đổi so với plan:**
  - "Tạm dừng phát" là cờ `web_claim_paused`, không dùng status `INACTIVE`. Lý do: `promo_apply_pass` chặn chương trình không ACTIVE, nên nếu dùng INACTIVE thì voucher đang giữ không kích hoạt được.
  - Giới hạn chống bot: **1 lượt giữ cho mỗi thiết bị** (bấm lại thì trả mã cũ) và **tối đa 3 lượt cho mỗi IP**. Lý do: khách ngồi ở spa dùng chung wifi, nên giới hạn 1 lượt mỗi IP sẽ chặn nhầm khách thật.
  - Kho công khai có cột `version`. Lý do: realtime **không đảm bảo thứ tự**; một lần chạy thử đã nhận "còn 1" sau "còn 0". Client chỉ giữ bản ghi có version cao nhất.
- **QA** `scripts/qa/qa_promotion_web_claim.ts` (chỉ chạy trên TEST, `TZ=UTC`): **PASS 3/3 lần**, dữ liệu test được dọn sạch. Đã kiểm:
  - 50 người bấm Lưu cùng lúc với kho 3: đúng 3 người thành công, 47 người SOLD_OUT.
  - Realtime tới anon.
  - Anon không đọc được claims và không gọi được RPC.
  - Giảm số lượng xuống dưới số đã cấp thì bị chặn.
  - Bấm lại trên cùng thiết bị thì nhận lại mã cũ.
  - Giới hạn theo IP.
  - Hết hạn giữ chỗ khi cron không chạy.
  - Kích hoạt qua RPC ghi đơn thật: 300.000 thành 270.000, dòng KM không có KTV.
  - Gọi lại kích hoạt không giảm tiền lần hai.
  - Mã đã dùng cho đơn khác thì cả đơn bị rollback.
  - Đơn tại quầy nhận `WEB_BOOKING_REQUIRED`.
  - Quầy áp ngoại lệ mã web cũng bị chặn.
  - Quầy đổi source của đơn thì voucher vẫn ACTIVE.
  - Giới hạn theo SĐT, và khách quay lại sau khi đã dùng voucher vẫn lấy được.
  - Huỷ đơn thì trả suất.
  - Tạm dừng: không Lưu mới được, voucher đang giữ vẫn kích hoạt được.
  - Nút giải phóng mọi lượt giữ.
  - Kết thúc chương trình.

### Phát hiện cho Giai đoạn 4
- **Gửi lại request đặt đơn sau khi đã kích hoạt** (idempotency replay) trả `IDEMPOTENCY_KEY_REUSED`. Nguyên nhân: `webbooking_commit_booking` so sánh **toàn bộ** item và `totalAmount` của đơn đã lưu, mà đơn đó giờ có thêm dòng `KM` và tổng đã giảm.
- **Cách xử lý:** tạo RPC bọc mới `webbooking_commit_booking_with_voucher(p_booking, p_items, p_voucher_code)`.
  - Khi replay, RPC này so sánh **bỏ qua dòng `isPromotion`** và dùng tổng **trước giảm**.
  - Lần đầu thì gọi `webbooking_commit_booking` rồi `promo_web_activate` trong cùng transaction.
  - **Không sửa** RPC cũ, nên route WebBooking hiện tại vẫn chạy y nguyên (giảm rủi ro B6 / B20).

### Giai đoạn 2 (Admin): code xong, đã test tầng service trên TEST (08/10/2026)

**Thẻ "Phát trên Web Booking"** nằm ở trang chi tiết chương trình (`components/promotions/CampaignWebClaimCard.tsx` + `.logic.ts`). Form tạo chương trình **giữ nguyên**: form này dùng schema strict và khoá luật khi chương trình đã ACTIVE.

Thẻ gồm:
- **Bật / cấu hình:**
  - Tổng số voucher.
  - Thời gian giữ chỗ.
  - Số voucher chưa dùng tối đa mỗi SĐT.
  - Tổng tối đa mỗi SĐT.
  - Đường dẫn công khai.
- **7 ô số liệu:** Tổng · Còn · Đang giữ · Đã kích hoạt · Đã dùng · Hết hạn · Huỷ.
- **Nhãn trạng thái kho** kèm chấm "Cập nhật trực tiếp".
- **Các nút:**
  - Tạm dừng / Phát tiếp, có hộp xác nhận.
  - Giải phóng mọi lượt giữ, bắt buộc ghi lý do.
  - Thu hồi từng voucher đang giữ.
- **Danh sách voucher:** lọc theo trạng thái; SĐT và tên khách bị che nếu người xem không có quyền `customer.pii`.

**Cách cập nhật dữ liệu:**
- Realtime trên `PromotionCampaignStock`, chỉ nhận sự kiện có `version` mới hơn.
- Polling 30 giây làm dự phòng.
- Tải lại khi tab được focus.

**API:**
- `GET/PATCH /api/admin/promotions/campaigns/[id]/web-claim`
- `POST …/web-claim/pause`
- `POST …/web-claim/release`
- Quyền: `campaign.read` cho xem, `campaign.manage` cho mọi thao tác ghi.

**Mã lỗi mới:** `QUANTITY_BELOW_ALLOCATED`, `SLUG_TAKEN`, `VOUCHER_NOT_RESERVED`, `FEATURE_UNAVAILABLE`.

**DB chưa có v15** (PostgREST trả `PGRST202`, đã kiểm trên DB thật bằng lệnh chỉ đọc): thẻ **tự ẩn**. Nhờ vậy deploy code admin trước migration cũng không làm hỏng trang chương trình.

**API mock** (dev) có cùng hợp đồng.

**Đã kiểm:**
- QA `scripts/qa/qa_promotion_web_claim.ts` PASS: phần service của GĐ2, phần mock, và toàn bộ GĐ1.
- `tsc --noEmit` toàn repo: 0 lỗi.

**Chưa làm được:**
- Chưa xem giao diện trên trình duyệt: trang cần đăng nhập. Cần xem trên preview TEST.
- Repo chưa có `eslint.config.js` (ESLint 9), nên không chạy được lint.

### Giai đoạn 4, phần DB: xong trên TEST (08/10/2026)

Migration `20261008150000_webbooking_commit_with_voucher_v16.sql` gồm 3 phần:
- **`webbooking_commit_booking_with_voucher`:** RPC bọc ngoài, ghi đơn và kích hoạt voucher trong 1 transaction. Xử lý được việc gửi lại request (replay) khi đơn có dòng KM. **Không sửa writer cũ.**
- **`promo_web_preview`:** xem trước tiền giảm ở checkout bằng chính engine. Ghi một đơn tạm trong subtransaction rồi rollback; đã kiểm là không để lại đơn, hàng đợi KTVD hay thông báo nào.
- **`promo_compute_discount_core`:** công thức giảm tách ra từ `promo_compute_discount_ex`, thân hàm không đổi.

**Kết quả QA:**
- `qa_promotion_web_claim.ts`: PASS 2/2, có thêm W1–W10 và P1–P7.
- `qa_promotion_engine.ts` trên TEST: 213 pass, 3 fail. **Cả 3 lỗi đều có sẵn từ trước:** khôi phục hàm v14 gốc vẫn cho đúng 3 lỗi này.
  - Script kỳ vọng % giảm chỉ tính trên dịch vụ đạt điều kiện, trong khi từ v14 (user chốt 05/10) % giảm tính trên cả đơn.
  - Ca còn lại liên quan ngôn ngữ email.
  - Cần cập nhật script này, nhưng nằm ngoài phạm vi tính năng voucher web.

**Rollback:** `plans/sql/rollback_promotion_web_claim_v15.sql` gỡ cả v15 và v16, có khôi phục thân hàm v14. Đã chạy thử trên TEST trong transaction rồi huỷ.

**Hợp đồng cho cửa sổ B:** `plans/prompt_cua_so_B_evoucher_webbooking.md`, mục "Bổ sung 08/10/2026".

### B18 đã đóng (08/10/2026)
Hoá đơn ở WRB nội bộ (`src/components/invoice/PrintableInvoice.tsx:273-276`) cộng mọi dòng, kể cả dòng KM âm, nên tổng đúng. Journey dùng `Bookings.totalAmount`. **Không sửa code WRB.** Checklist go-live: `plans/checklist_golive_evoucher_web.md`.
