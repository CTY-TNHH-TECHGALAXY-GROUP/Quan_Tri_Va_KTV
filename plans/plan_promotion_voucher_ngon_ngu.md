# Plan — E-voucher mặc định tiếng Anh + admin nhập nội dung 5 ngôn ngữ

> Mức 2 (chạm migration / RPC / email của Promotion Engine). Yêu cầu user ngày 04/10/2026:
> "default ưu tiên voucher = tiếng Anh, sau đó bổ sung cho admin được nhập 5 ngôn ngữ".
> Trạng thái: **đã làm xong trên nhánh `feat/promotion-frontend` và Supabase TEST (04/10/2026)**. Chưa chạy trên DB thật.

## 1. Hiện trạng: những chỗ đang ngầm mặc định tiếng Việt

| # | Chỗ | Hiện tại | Ai sở hữu |
|---|---|---|---|
| 1 | Trang `/voucher` — `pickVoucherLang()` (`lib/promotion-voucher.i18n.ts`) | `?lang=` → ngôn ngữ của điện thoại (Accept-Language) → **vi** | A (file dùng chung), B gọi |
| 2 | Email e-voucher — `promo_customer_language()` (SQL v2) | Ngôn ngữ khách hay đặt nhất (`Bookings.customerLang`) → **vi** | A |
| 3 | Email — `asLang()` (`PromotionEmailService.ts`) | Giá trị lạ → **vi** | A |
| 4 | Thẻ 3D trong admin (xem trước, đối chiếu với khách) | Luôn dùng nhãn **vi** | B |
| 5 | Tên và mô tả chương trình | **Chỉ có 1 ô**, khách thấy đúng chữ admin gõ, ngôn ngữ nào cũng vậy | A (cột DB) + B (form) |

Phần chữ do hệ thống tự sinh (ưu đãi "+30 MIN", hạn dùng, trạng thái, câu điều kiện, nhãn thẻ) **đã đủ 5 ngôn ngữ**. Chỉ còn **tên và mô tả chương trình** là chữ admin tự gõ, nên chỉ có một ngôn ngữ.

## 2. Phần 1 — Mặc định tiếng Anh

Thứ tự chọn ngôn ngữ mới:

- **Trang `/voucher`:** `?lang=` (khách bấm VI/EN/…) → **en**. Bỏ việc tự đoán theo ngôn ngữ điện thoại. Lý do: voucher có thể được chuyển cho bạn bè, nên đoán theo máy dễ ra ngôn ngữ khác nhau giữa người gửi và người nhận. Mặc định cố định một ngôn ngữ thì dễ hướng dẫn hơn.
- **Email:** ngôn ngữ khách hay đặt nhất nếu có → **en** (thay cho vi). Khách Việt vẫn nhận tiếng Việt nếu lịch sử đặt của họ là `vi`.
- **`asLang()`:** giá trị lạ → **en**.
- **Thẻ trong admin:** mặc định **en**, có thêm nút chuyển 5 ngôn ngữ để quầy đối chiếu đúng với màn khách đang mở.

## 3. Phần 2 — Admin nhập tên và mô tả 5 ngôn ngữ

### DB (A)
- Thêm cột cho `PromotionCampaigns`:
  - `name_i18n jsonb NOT NULL DEFAULT '{}'`
  - `description_i18n jsonb NOT NULL DEFAULT '{}'`
  - Khoá ngôn ngữ: `en`, `vi`, `cn`, `jp`, `kr`.
- Cột `name` hiện có giữ nguyên, là **tên chính / tiếng Anh, bắt buộc**. Các ô ngôn ngữ khác **tuỳ chọn**.
- Chương trình cũ không phải chuyển dữ liệu: `{}` nghĩa là mọi ngôn ngữ dùng `name`.
- Ràng buộc: chỉ nhận đúng 5 khoá trên; mỗi tên tối đa 120 ký tự, mỗi mô tả tối đa 1000 ký tự.
- Đổi tên/mô tả **được phép cả khi chương trình đã phát voucher** (giống ô tên hiện nay ở `toLockedCampaignPatch`). Lý do: chỉ là chữ hiển thị, không đổi quyền lợi.

### RPC / API (A)
- `promo_create_campaign`, `promo_update_campaign`: nhận thêm `nameI18n`, `descriptionI18n`. Cập nhật zod schema và `CAMPAIGN_KEY_MAP` tương ứng.
- `promo_campaign_json`: trả thêm `nameI18n`, `descriptionI18n`.
- `promo_public_voucher_by_token` và dữ liệu email: trả thêm `campaignNameI18n`.
- **Quy tắc chọn chữ (một hàm dùng chung cho email và trang khách):** ngôn ngữ đang xem → `en` → `name`.
- Cập nhật `TableInSupabase.md` và `plans/promotion_engine_api_contract.md`.

### Giao diện (B)
- **Form chương trình:** ô "Tên chương trình" và "Mô tả" có 5 tab `EN* | VI | 中文 | 日本語 | 한국어`.
  - EN bắt buộc; tab đã có nội dung hiện dấu ✓.
  - Thẻ xem trước đổi theo tab đang chọn.
- **Trang chi tiết chương trình và thẻ trong trang voucher khách:** có nút chuyển ngôn ngữ, hiện tên theo ngôn ngữ đang chọn.
- **Trang `/voucher`:** tên chương trình theo `?lang`, chưa nhập thì lấy EN.
- **Danh sách nội bộ** (bảng chương trình, lịch sử, màn quét): vẫn hiện `name` (EN) để quầy thống nhất một tên.
- **Mock:** thêm `nameI18n` mẫu; QA thêm ca chọn chữ (`vi` có → `vi`; `kr` trống → `en`; `en` trống → `name`).

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — app KTV không hiển thị voucher | Form, chi tiết chương trình, voucher khách, màn quét (chỉ tên EN) | `PromotionCampaigns`, RPC promo_*, email, `/voucher` | Sửa |
| Số liệu (tiền, phút, lượt) | Không ảnh hưởng | Không đổi — chỉ thêm chữ hiển thị | Engine áp voucher không đọc tên | Khớp |
| Realtime / refresh | Không ảnh hưởng | Không có kênh realtime cho promotion | — | Không cần thêm |
| Quyền xem | Không ảnh hưởng | Sửa tên dùng quyền `campaign.manage` như hiện nay | Trang khách chỉ nhận tên theo ngôn ngữ, không thêm dữ liệu riêng tư | Không lộ dữ liệu |

## 5. Rủi ro

- **Email đã gửi** không đổi ngôn ngữ (email đã nằm trong hộp thư). Chỉ email mới và lần mở `/voucher` sau deploy mới theo quy tắc mới.
- **Khách Việt không có lịch sử `customerLang`** sẽ nhận email tiếng Anh thay vì tiếng Việt. Đây đúng là yêu cầu mặc định EN, nhưng **quầy cần biết**.
- Migration chỉ **thêm cột có mặc định**, không sửa và không xoá dữ liệu cũ. Muốn lùi thì bỏ đọc cột, không cần xoá cột.
- **Đã kiểm tra trước:**
  - Phải chạy trên Supabase TEST trước.
  - Mã version migration không được trùng: hiện `20261002120000` đã trùng tên với một migration khác trên TEST (`rating_notifications_by_scale`), nên migration mới phải lấy version chưa dùng.

## 6. Thứ tự làm và kiểm thử

1. **Phần 1:**
   - B sửa trang `/voucher` và thẻ admin.
   - A sửa `promo_customer_language` fallback `en` và `asLang`. **Không cần thêm cột.**
   - Kiểm: `/voucher` không `?lang` → EN; `?lang=vi` → VI. Chạy thêm dưới `TZ=UTC`.
2. **Phần 2:**
   - A: migration + RPC, chạy trên TEST.
   - B: form 5 tab, chọn chữ theo ngôn ngữ, mock + QA.
   - Kiểm trên TEST: tạo chương trình chỉ có EN → 5 ngôn ngữ đều EN; thêm VI → `/voucher?lang=vi` hiện tên VI, `?lang=kr` hiện EN; email `vi`/`en` đúng tên.
3. Chụp màn hình iPhone/Android cho form và `/voucher`, rồi báo user trước khi commit.

## 7. Cần user chốt

1. Trang `/voucher` có **bỏ** tự đoán theo ngôn ngữ điện thoại, luôn mở EN trước không? *(Khuyến nghị: có.)*
2. Email: **giữ** ngôn ngữ theo lịch sử đặt của khách, chỉ đổi mặc định sang EN? Hay **mọi email đều EN**? *(Khuyến nghị: giữ theo lịch sử.)*
3. Ngoài **tên** và **mô tả**, admin có cần nhập 5 ngôn ngữ cho phần nào khác không? Ví dụ tên menu "Menu VIP" — hiện lấy từ cấu hình chung, chưa dịch.
4. Phần DB/RPC/email: **giao A làm** theo plan này, hay **B (mình) làm luôn** cả hai phía?


## 8. User chốt (04/10/2026) và kết quả

User chốt:
- Tên, mô tả chương trình và nội dung trên e-voucher dùng **EN trước**.
- Tên menu/dịch vụ lấy **tên tiếng Anh**.

Các điểm 1, 2, 4 làm theo khuyến nghị:
- `/voucher` mặc định EN.
- Email giữ ngôn ngữ theo lịch sử đặt của khách, chưa có thì EN.
- B làm cả hai phía và ghi lại cho A.

**Kết quả trên TEST:**
- Migration v12 chạy thử trong giao dịch rollback trước, rồi mới áp thật.
- `/voucher` trên iPhone cài tiếng Việt vẫn mở EN; `?lang=vi` hiện tên VI; `?lang=kr` (chưa dịch) hiện tên EN.
- Form 5 tab hoạt động; thẻ xem trước đổi theo tab.
- QA frontend 171/171.
