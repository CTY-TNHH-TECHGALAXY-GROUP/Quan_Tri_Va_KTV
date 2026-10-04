# Promotion Frontend (Agent B) — yêu cầu gửi Agent A

> Ngày: 02/10/2026. Nhánh frontend: `feat/promotion-frontend` (worktree `.worktrees/promotion-frontend`, gốc `3d15d13f`).
> Contract frontend đang dùng: `lib/types/promotion-client.ts`, adapter `lib/services/promotionApi.ts`.
> Đối chiếu với `plans/plan_promotion_engine_backend.md` v2 (Agent A).

## 1. Quyết định mới của user (02/10/2026) — làm đổi backend

| # | Quyết định | Ảnh hưởng tới A |
|---|---|---|
| U1 | **Voucher dùng chung được**: khách gửi e-voucher cho bạn bè, bạn bè dùng được. | Bỏ chặn `ORDER_CUSTOMER_MISMATCH` trong `promo_apply_pass`. `PromotionUsages.customer_id` = **khách của đơn**, không phải chủ voucher. Vẫn giữ `max_usage_per_order`, khoá `FOR UPDATE`, partial UNIQUE (pass, booking). |
| U2 | Khi quét, quầy thấy **hiệu lực voucher + mọi đơn đang mở** (NEW / PREPARING / IN_PROGRESS) để chọn, không cần đúng khách. | `GET /api/promotion-passes/[id]/active-orders` trả đơn mở **của cả spa trong ngày làm việc** (không chỉ của chủ voucher). Có `?q=` tìm theo mã đơn / tên khách / phòng. Đơn của chủ voucher xếp đầu (`isPassOwnerOrder`). |
| U3 | Admin đặt được **giới hạn tổng số lần** (VD 10 lần). | Đã có `usage_type = LIMITED` + `usage_limit`. Frontend gửi `usageType`, `usageLimit`. Trả `PROMOTION_USAGE_LIMIT_REACHED` khi hết. |
| U4 | Khách nhận **e-voucher qua email** có QR để quét. | Cần gửi email khi phát voucher (tự động + thủ công). QR trong email = `qr_token` hoặc URL chứa `?t=<qr_token>`. Template email chưa có. |
| U5 | **Trang History phía khách giữ nguyên**, chỉ **thêm phần E-Voucher** (nhập email → thấy voucher + QR → đưa quầy quét). Không OTP. | Đợt 2. Cần API/RPC cho Web Booking repo (`NganHa-WebBooking`) — quyết định #5 của A hiện ghi "chưa làm API cho Web Booking". |

## 2. Endpoint frontend đang gọi (khác hoặc thêm so với plan A §5)

| Method | Endpoint | Ghi chú |
|---|---|---|
| GET | `/api/admin/promotions/overview` | **Mới**. `{ activeCampaigns, passesIssued, activePasses, usesThisMonth }`. Thiếu thì trang Tổng quan báo lỗi + Thử lại. |
| GET | `/api/admin/promotions/passes?q&campaignId&status&expiry` | **Mới (GET)**. Plan A chỉ có POST. `expiry` = `VALID` / `EXPIRING_7D` / `EXPIRED`. Tìm theo tên / SĐT / email / mã voucher. **Không trả `qrPayload` trong danh sách.** |
| GET | `/api/admin/promotions/passes/[id]` | **Mới**. Trả pass + `qrPayload`. |
| PATCH | `/api/admin/promotions/passes/[id]` | Body `{ action: 'SUSPEND' \| 'CANCEL' \| 'REACTIVATE', reason? }`. |
| GET | `/api/admin/promotions/usages?from&to&campaignId&status&q&passId` | **Mới**. `from`/`to` = `yyyy-MM-dd` theo giờ VN. |
| GET | `/api/admin/promotions/customers?q` | **Mới**. Tìm khách để phát tay: `[{ id, name, phone, email }]`. Không dùng `/api/customers` vì route đó nặng (dựng cả lịch sử). |
| GET | `/api/promotion-passes/lookup?t=` / `?code=` | Như plan A. Không tìm thấy → `INVALID_QR` hoặc `PROMOTION_NOT_FOUND` (frontend gộp cả hai thành "Không tìm thấy voucher hợp lệ"). |
| GET | `/api/promotion-passes/[id]/active-orders?q=` | Theo U2. |
| POST | `/api/promotion-passes/[id]/apply` | `{ bookingId }`. Response xem §3. |
| POST | `/api/admin/promotions/campaigns` / PATCH `[id]` | Body = `CampaignFormInput` (camelCase). `validFrom`/`validUntil` = `yyyy-MM-dd` → server tự đổi sang `00:00:00+07` / `23:59:59+07`. |
| POST | `/api/admin/promotions/campaigns/[id]/status` | `{ action: 'ACTIVATE' \| 'DEACTIVATE' \| 'END' }`. |

Envelope: `{ success: true, data }` | `{ success: false, error: { code, message, data? } }`. 409 `PASS_ALREADY_EXISTS` → `error.data` = pass đang có.

## 3. Field UI cần mà plan A chưa nêu rõ

- **Pass**: `campaign { id, name, campaignCode }`, `customer { id, name, phone, email }`, `usage { type, limit, usedCount, maxPerOrder }`, `lastUsedAt`, `statusReason`, `issueSource`, `sourceBookingId`, `qrPayload` (chỉ ở detail / lookup).
  - `usedCount` và `lastUsedAt` cần server tính (đếm usage không CANCELLED).
- **Order candidate**: `displayCode`, `customerName`, `status`, `bookingTime`, `roomLabel`, `totalAmount`, `totalDurationMinutes` (server tính, gồm cả item KM), `items[] { id, serviceName, durationMinutes, price, isPromotion }`, `isPassOwnerOrder`, **`canApply` + `blockedReasonCode`**.
  - Server quyết định đơn nào áp dụng được. Frontend chỉ làm mờ đơn và hiện lý do.
- **Apply result**: `usageId`, `booking { id, displayCode, items, totalDurationMinutes, totalAmount }` (sau khi thêm item KM), `appliedMinutes`, `pass` (đã cập nhật `usedCount`).
- **Campaign**: `issuedPassCount`, `usageCount` (null nếu chưa có thì UI ẩn cột).
- **Mã lỗi thêm**: `VALIDATION_ERROR` (kèm `data.field`), `FORBIDDEN`, `UNAUTHORIZED`.

## 4. Quyền

- Frontend đã thêm module `promotions` vào `ModuleId` / `MODULES` / Sidebar (nhóm "Vận Hành"). Không vai trò nào có sẵn quyền này; admin phải bật ở trang Phân quyền.
  - **A không cần thêm lại module này**, chỉ kiểm quyền `promotions` ở các route admin.
- Trang quét `/admin/promotions/scan` mở cho quyền `dispatch_board` (lễ tân), khớp với quyền của lookup / apply trong plan A.

## 5. Rủi ro cần A xem xét

- **U1 + voucher Unlimited**: không có trần nào ngoài 1 lần/đơn. User xác nhận voucher chỉ gửi thẳng cho khách. Admin vẫn có thể đặt LIMITED nếu cần.
- **Lộ `qr_token` qua email / chuyển tiếp** là chủ ý (U1). Nhưng token **không được** suy ra id, SĐT hay email (plan A §2.2 đã đúng).
- **Trang khách (U5) tra bằng email không OTP**: ai biết email đều thấy voucher và QR của người đó. Theo U1 thì chấp nhận được. Nhưng lịch sử ghé spa (đang có sẵn ở History) là quyết định cũ của trang đó, không thuộc phạm vi này.

## 6. Mẫu e-voucher dùng chung (thêm 02/10/2026)

- `components/promotions/VoucherCard3D.tsx` là **mẫu gốc** của e-voucher. Admin dùng nó để đối chiếu với màn hình hoặc email của khách.
- Email e-voucher (U4) và phần E-Voucher ở Web Booking (U5) phải dựng **đúng bố cục** này:
  - Thương hiệu lấy từ `SYSTEM_CONFIG.spa_name` (hiện là "Oria Spa"), tên chương trình, ưu đãi chữ lớn, mã voucher, ngày hết hạn, tên khách, QR, kiểu lượt dùng.
- Email không chạy được 3D, nên chỉ cần dựng mặt trước dạng ảnh hoặc HTML tĩnh, kèm QR.

## 7. Đối chiếu contract v2 + v4 (03/10/2026)

B đã khớp với `plans/promotion_engine_api_contract.md`, gồm cả mục 3.1 (lọc hồ sơ khách và phát hàng loạt):

- **Trạng thái và mã đơn:** dùng `effectiveStatus` cho badge, bộ lọc và màn quét. Mã đơn hiện bằng `billCode`; `bookingTime` dạng "HH:mm" hiện nguyên văn.
- **Ngày giờ không có offset:** `lastVisitAt` không kèm offset nên B coi là giờ VN, không phải giờ của trình duyệt.
- **QR và link quét:** QR là URL có `?t=`. Trang `/admin/promotions/scan?t=` hoặc `?code=` tự tra voucher khi mở, nên nhân viên quét bằng camera gốc của điện thoại vẫn được.
- **Form chương trình:**
  - Có `PERCENT_DISCOUNT` / `FIXED_DISCOUNT` (kèm `benefitConfig.maxDiscountAmount`) và `validityType` / `validityDays`.
  - Có `applicableMenus` lấy từ `/menus`, mặc định không chọn menu nào.
  - Mã chương trình theo `^[A-Za-z0-9_-]{3,40}$`; tiền tố voucher không bắt buộc.
- **Phát tự động:** **tắt**. Lựa chọn `AUTO` hiện nhưng bị khoá, ghi "(đang tắt)"; mặc định là `MANUAL_ONLY`.
- **Sửa chương trình đã kích hoạt:** PATCH chỉ gửi `name`, `description`, `validUntil` để tránh `CAMPAIGN_LOCKED` báo nhầm.
- **Email:** chi tiết voucher có trạng thái email và nút "Gửi lại email". Kết quả phát hiện đủ `SENT`, `FAILED`, `SKIPPED`, `QUEUED`, và dòng "đang chờ gửi N" lấy từ `summary.emailQueued`.
- **Huỷ lượt áp dụng:** có ở trang Lịch sử dùng và chi tiết voucher, chỉ hiện cho lượt đang `APPLIED`.
- **Lọc khách:**
  - `tier` chỉ còn `NEW` / `RETURNING`; lọc khách dùng menu VIP bằng `vipMenu`.
  - Tick `onlyQualified` thì tự điền 30 ngày gần nhất, chặn khoảng quá 93 ngày.
  - Khách có `alreadyHasPass` hiện mờ và không tick được.
  - Có `qualificationIgnored` thì ẩn ô lọc "đạt điều kiện".
  - Mỗi trang 50 khách, mỗi lần phát tối đa 50.

**Câu hỏi còn mở cho A:**

1. Khách có voucher **đã huỷ** thì có được phát lại cho cùng chương trình không? Mock của B đang coi như đã có voucher (`alreadyHasPass` = true).
2. Danh sách lọc khách nên xếp khách `alreadyHasPass` xuống cuối, để trang đầu toàn là khách phát được.
3. Mục 3 của contract chưa ghi endpoint `/api/admin/promotions/menus`, và chưa ghi rằng `qrPayload` trỏ tới `/voucher?t=` (theo `PROMOTION_VOUCHER_PATH`). Hai điểm này B lấy từ code, nhờ A bổ sung vào contract.
4. Trang công khai `/voucher`: `PromotionPublicVoucherDto` khớp với `VoucherCardData` của B, nên nên dùng lại `components/promotions/VoucherCard3D.tsx` để thẻ khách thấy giống hệt thẻ admin đối chiếu.

## 8. Cập nhật 03/10/2026 (contract v5)

**B đã làm:**

- **Phát voucher theo ngữ cảnh:**
  - Admin bấm chọn khách (bấm cả dòng được) → thanh "Phát voucher" / "Phát cho N khách" chỉ hiện khi đã chọn.
  - Chọn 1 khách = phát lẻ, nên bỏ mục "Phát lẻ cho một khách" riêng.
  - Bỏ luôn `searchCustomers` khỏi adapter: B không gọi `GET /api/admin/promotions/customers` nữa.
- **Theo dõi voucher:**
  - 2 tab "Đang hiệu lực" / "Đã qua", gửi `group=ACTIVE|PAST`.
  - Số đếm lấy từ `overview.activePasses` / `pastPasses`.
  - Tab "Đã qua" hiện cột `endedAt`; voucher có `supersededAt` gắn nhãn "Đã phát lại".
  - Tab "Đang hiệu lực" có nút lọc nhanh "Hết hạn trong 7 ngày" (`expiry=EXPIRING_7D`).
- **Trạng thái `USED_UP`** và mã lỗi `PROMOTION_USED_UP` đã có câu tiếng Việt.
- **Trang `/voucher`:**
  - UI xong ở `components/promotions/VoucherPublicView.tsx`. Component nhận đúng kết quả của `resolveVoucherView()` và chữ của `PROMOTION_VOUCHER_PAGE_I18N`.
  - Chữ trên thẻ 3D có đủ 5 ngôn ngữ ở `components/promotions/voucher-card.i18n.ts`.
  - **`app/voucher/page.tsx` chưa tạo**, vì nó import `lib/promotion-voucher-view.ts` và `lib/promotion-voucher.i18n.ts` mà A chưa commit. Sau khi merge `feat/promotion-engine`, file trang chỉ cần nối như sau:
    ```tsx
    const view = await resolveVoucherView(sp.t);
    if (view.mode === 'STAFF') redirect(view.redirectTo);
    const lang = pickVoucherLang(sp.lang, (await headers()).get('accept-language'));
    return <VoucherPublicView view={view} strings={PROMOTION_VOUCHER_PAGE_I18N[lang]} lang={lang} token={sp.t ?? ''} langs={PROMOTION_VOUCHER_LANGS} />;
    ```

**Cần A:**

1. **Tên menu cho trang khách:** `PromotionPublicVoucherDto.applicableMenus.menus` chỉ có mã (`NHP`). B đã chừa field `menuLabels?: string[]`; nhờ A trả tên menu để khách không thấy mã. Chưa có thì trang hiện tên category, rồi mới tới mã.
2. **Số đếm "hết hạn trong 7 ngày":** chưa có trong `overview`. Có thì B hiện con số trên nút lọc nhanh.

## 9. Điều kiện áp dụng in trên e-voucher (03/10/2026)

User muốn thẻ e-voucher ghi rõ điều kiện, VD **"Dành cho Menu VIP từ 90 phút trở lên"**. B đã làm phần hiển thị, đủ 5 ngôn ngữ, dựng từ `applicableMenus` + `qualification` (MIN_PAID_DURATION).

**Cần A:**
1. **Pass (admin) và `PromotionPublicVoucherDto`:** thêm `conditions: { menuLabels: string[], minPaidMinutes: number | null }`. Bản công khai thì chỉ cần thêm `minPaidMinutes`, vì `menuLabels` đã xin ở mục 8. Chưa có field này thì thẻ của voucher thật chỉ hiện "Ưu đãi miễn phí"; thẻ mẫu của chương trình thì đã hiện đủ.
2. **Quy tắc lúc áp voucher — cần A chốt:** hiện `promo_check_apply` chỉ chặn theo menu (`ORDER_MENU_NOT_ELIGIBLE`), không kiểm số phút. Nếu thẻ ghi "từ 90 phút trở lên" mà đơn 60 phút vẫn áp được thì quầy và khách sẽ hiểu sai.
   - **Khuyến nghị:** kiểm thêm `paid_qualifying_minutes ≥ qualification_value` lúc áp, trả mã mới `ORDER_MIN_DURATION_NOT_MET`. B sẽ thêm câu tiếng Việt cho mã này.
   - Nếu không kiểm lúc áp thì B bỏ phần "từ N phút" khỏi thẻ, chỉ ghi menu.

## 10. Áp ngoại lệ (contract v8 §4.1) — B đã làm (03/10/2026)

- **Màn quét:**
  - Mỗi đơn có badge theo `eligibility`: Đủ điều kiện / Chưa đủ điều kiện / Không áp được.
  - `unmetReasons` hiện nguyên văn dưới đơn.
  - Đơn `NOT_ELIGIBLE` vẫn chọn được; khi đó nút chính đổi thành "Áp ngoại lệ…".
- **Popup áp ngoại lệ:**
  - Mở khi chọn đơn `NOT_ELIGIBLE`, hoặc khi server trả `ORDER_CONDITION_NOT_MET` có `canOverride`.
  - Popup liệt kê `unmetReasons`, và bắt buộc nhập lý do 3–500 ký tự (kiểm ở client và server).
  - Lý do hợp lệ thì gửi lại `{ bookingId, overrideConditions: true, overrideNote }`.
  - Server trả `OVERRIDE_REASON_REQUIRED` thì báo lỗi ngay trong popup.
  - Áp xong, màn thành công gắn nhãn "Đã áp ngoại lệ".
- **Lịch sử áp dụng:**
  - Lượt áp ngoại lệ có nhãn "Áp ngoại lệ", kèm "Lý do: `overrideNote`" và "Người áp: `staffName`".
  - Có ô lọc "Chỉ lượt áp ngoại lệ" (`overridden=1`).
- **Tự chọn đơn:** chỉ tự chọn sẵn đơn `canApply`. Đơn lễ tân đã chọn (kể cả đơn chưa đủ điều kiện) được giữ khi danh sách tải lại.

**Còn cần chốt (nghiệp vụ):** contract cho mọi người có quyền `dispatch_board` áp ngoại lệ. Nếu chỉ muốn quản lý được duyệt, A phải chặn ở server (ví dụ thêm một quyền riêng). Frontend chỉ ẩn nút thì không đủ an toàn.

## 11. Liên hệ của spa in trên e-voucher (03/10/2026)

User yêu cầu e-voucher có **địa chỉ, hotline, website** của Oria Spa. B in thông tin này ở **cả mặt trước lẫn mặt sau thẻ 3D**, dạng một dải nhỏ có icon, đọc được ở mọi ngôn ngữ. Khi có dải này, thẻ cao hơn một chút và mặt trước chỉ khoét khía trên.

- **Trang `/voucher`:** dùng `view.contact` của `resolveVoucherView()`, không cần đổi gì.
- **Trang admin:** **cần A thêm `GET /api/admin/promotions/contact`** dưới quyền `promotions`.
  - Trả `{ brandName, hotline, address, websiteUrl }`, cùng nguồn `getEmailConfig()` như trang `/voucher`.
  - **Không** trả thông tin ngân hàng.
  - Lý do không dùng `/api/admin/settings/email`: route đó cần quyền cài đặt hệ thống và trả cả số tài khoản.
  - Chưa có endpoint này thì thẻ trong admin chỉ ẩn dải liên hệ, không báo lỗi.
- **Email e-voucher của A** nên in cùng 3 dòng này ở cùng chỗ, để thẻ trong email khớp với thẻ trên web.

## 12. Điều kiện áp dụng v7 — B đã chuyển xong (04/10/2026)

- **Form chương trình:** chỉ gửi `applyConditions` (bộ soạn nhiều điều kiện: menu / nhóm / dịch vụ / số phút của 1 dịch vụ / tổng tiền tối thiểu, ghép ALL hoặc ANY, tối đa 10). **Không gửi** `qualification*` hay `applicableMenus` nữa.
- **Câu điều kiện** trên thẻ (admin, `/voucher`), trang chi tiết chương trình và bảng lọc khách: dựng từ `conditionsSummary` bằng `formatPromotionConditions()` của A, nên khớp đúng câu trong email.
- **Danh mục menu, nhóm, dịch vụ** lấy từ `GET /menus`.

**Lỗi bên A cần sửa (ưu tiên cao):** `promo_customer_candidates` (bản mới nhất ở migration v5) vẫn xét "đơn đạt điều kiện" theo `qualification_type` / `qualification_value` cũ.
- Chương trình tạo bằng `applyConditions` sẽ có `qualification_type = 'MANUAL_ASSIGNMENT'` (mặc định trong `promo_create_campaign` v7/v9), nên trả `qualificationIgnored = true`. Ô **"Có đơn đạt điều kiện chương trình" không lọc được gì**.
- **Đề nghị:** RPC lọc khách dùng chính `apply_conditions` (cùng hàm `promo_check_apply` / bộ đánh giá điều kiện), và `qualificationIgnored` chỉ bằng `true` khi chương trình **không có điều kiện nào**.
- Mock của B đã làm theo hành vi đúng này.

> **Cập nhật 04/10/2026:** lỗi bộ lọc "đạt điều kiện" ở mục 12 **đã được A sửa** (`cee0e017`, migration v11 `20261004150000`). B đã merge vào `feat/promotion-frontend` (`55e476b8`). Logic khớp với mock của B: `qualificationIgnored` chỉ bằng `true` khi chương trình không có điều kiện nào.

## 13. `promo_menu_catalog` đang lọc mất cả menu Deep Body (04/10/2026)

User yêu cầu danh mục menu và nhóm trong form chương trình **lấy đúng theo DB**, không đổi tên hay ẩn theo ý riêng.

**Lỗi:** RPC lọc `COALESCE(s."isActive", true)`. Trên DB thật có 72 dịch vụ `isActive = false` ("Tạm ngưng" ở Admin → Menu dịch vụ), nhưng các dịch vụ này **vẫn được đặt**:
- **Toàn bộ menu NHT (Deep Body)** đang `isActive = false`, có 27 lượt đặt, lượt gần nhất là 03/10/2026.
- 30 ngày gần đây: NHT0002, NHS0606, NHS0201 vẫn có đơn.
- Kết quả: form không có menu Deep Body, và thiếu các nhóm Facial, Hair Wash, Heel Skin Shave.

**Đề nghị:**
1. Bỏ điều kiện `isActive` khỏi `promo_menu_catalog`, chỉ giữ `is_promotion` / `is_utility`.
2. Nhãn category trả đúng giá trị DB, không `initcap`. Hiện `VIP_MENU` đang thành `Vip_Menu`.
3. Migration chứa RPC này **chưa có trên DB**: gọi thử báo PGRST202, và cột `Services.is_promotion` chưa tồn tại.

**Mock của B** (`lib/services/promotionApi.mock.menus.ts`) là snapshot bảng `Services` ngày 04/10/2026, không lọc `isActive`:
- NHP: 14 dịch vụ.
- NHS: 128 dịch vụ.
- NHT: 6 dịch vụ.
- Nhãn vẫn giữ `initcap` cho đến khi A đổi.


## 14. B đã làm thay phần backend v12 — A cần review (04/10/2026)

User muốn e-voucher dùng tiếng Anh trước và admin nhập được 5 ngôn ngữ. B đã làm migration `20261004180000_promotion_engine_v12.sql` và đã chạy trên Supabase TEST.

**Hàm SQL sửa lại**, mỗi hàm dựng từ bản mới nhất của A, chỉ thêm dòng:
- `promo_create_campaign`, `promo_update_campaign`
- `promo_campaign_json`, `promo_pass_json`, `promo_public_voucher_by_token`, `promo_claim_pass_email`
- `promo_conditions_summary`, `promo_scope_labels`, `promo_menu_catalog` (dùng `nameEN` trước)
- `promo_customer_language` (mặc định `en`)

**File TS sửa:**
- `promotion.schema.ts`, `PromotionEngineService.ts` (`CAMPAIGN_KEY_MAP`)
- `PromotionEmailService.ts`: chọn tên/mô tả theo ngôn ngữ email, `asLang` mặc định `en`
- `promotion-voucher.i18n.ts`: `pickVoucherLang` mặc định `en`, thêm `pickPromotionText`

Chi tiết xem hợp đồng API mục v12. **A sửa tiếp hàm nào trong danh sách trên thì phải dựng từ bản v12**, nếu không sẽ mất phần đa ngôn ngữ.
