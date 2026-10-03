# Promotion Engine — API contract v9 (cho Agent B / Frontend, wrb-noi-bo, Web Booking)

> Backend: nhánh `feat/promotion-engine`.
> Migration: `20261002120000_promotion_engine.sql` + `20261002180000_promotion_engine_v2.sql` + `20261002200000_promotion_engine_v3.sql`.
> **v9:** **phân quyền theo thao tác** (mục 0.1) — mọi API khuyến mãi bắt đăng nhập; prefix voucher tự sinh từ mã chương trình khi bỏ trống.
> **v8:** quầy **áp ngoại lệ** cho đơn chưa đủ điều kiện, bắt buộc ghi lý do (mục 4.1).
> **v7:** **điều kiện áp dụng** nhiều tiêu chí (mục 2.2), engine **kiểm cả số phút lúc áp**, voucher trả kèm `conditionsSummary`. Trả lời mục 9 của B.
> **v6:** trang khách có tên menu: `menuLabels` (public voucher) và `applicableMenus.labels` (campaign), mục 6.1.
> **v5:** trạng thái `USED_UP`, tab đang hiệu lực / đã qua (`group`), phát lại sau khi voucher cũ đã đóng, lịch sử voucher trên hồ sơ (mục 3.2). Endpoint `/menus` ở mục 2.1, trang `/voucher?t=` ở mục 6.1.
> **v4:** lọc hồ sơ khách + phát hàng loạt (mục 3.1), bỏ email ảo `@guest.com`.
> **v3:** menu áp dụng chọn động (mục 2.1), QR trỏ tới trang e-voucher công khai `/voucher?t=` (mục 6.1), email dạng thẻ e-voucher.
> Shape bám theo `lib/types/promotion-client.ts` của B. Một số field là phần **thêm**, ghi ở mục 7.
> Mọi quy tắc nằm trong RPC `promo_*`. Frontend chỉ hiển thị, **không tự tính** phút, giảm giá, `canApply` hay trạng thái hiệu lực.

## 0. Quy ước chung

**Envelope response:**
- Thành công: `{ "success": true, "data": … }`.
- Lỗi: `{ "success": false, "error": { "code", "message", "data"? } }`.

**Lỗi đặc biệt:**
- `VALIDATION_ERROR` (400): `error.data = { field, issues: [{ field, message }] }`.
- 409 `PASS_ALREADY_EXISTS`: `error.data` = pass đang có, kèm `qrPayload`.
- 401 / 403 / 423: `error.code` = `UNAUTHORIZED` / `FORBIDDEN` / `ACCOUNT_LOCKED`.

**Body:** mọi body đều **strict**, gửi thừa field thì nhận 400.

**Giờ:** ISO, offset `+07:00`. Riêng form campaign nhận `yyyy-MM-dd`: `validFrom` được đổi thành `00:00:00+07:00`, `validUntil` thành `23:59:59+07:00`.

**Quyền:**
- `promotions`: cho các route `/api/admin/promotions/*`. B đã khai báo module này.
- `dispatch_board`: cho lookup, active-orders, apply, cancel, và lịch sử khuyến mãi của khách.

**Người thao tác (`staffId`):** server tự lấy từ session, client không gửi lên.

### 0.1 Phân quyền (v9, user 04/10/2026) — thay mọi chỗ ghi `promotions` / `dispatch_board` ở các mục dưới

**Cơ chế:**
- **Admin tick quyền** theo vai trò / tài khoản ở trang Phân quyền (`Users.permissions`). Không chỗ nào viết cứng ai được làm gì.
- **Code chỉ có một bảng** thao tác → quyền: `PROMOTION_ACTION_PERMISSIONS` trong `lib/constants/promotion.ts`. Hàm `promotionCan(permissions, action)` dùng chung cho server và UI.

| Mã quyền (B thêm vào `MODULES`, nhóm "Khuyến mãi") | Mở các API |
|---|---|
| `promotions_scan_apply` — Quét & áp voucher | `lookup`, `active-orders`, `apply` (đơn đủ điều kiện), `promotion-usages/:id/cancel` |
| `promotions_override` — Áp ngoại lệ | `apply` với `overrideConditions: true` |
| `promotions_view` — Xem voucher & lịch sử | `overview`, `passes` GET, `passes/:id` GET, `usages`, `customers/:id/promotions`, `campaigns` GET |
| `promotions_issue` — Phát voucher | `customers`, `customer-candidates`, `passes` POST, `passes/bulk`, `send-email`, `passes/:id` PATCH, `campaigns` GET |
| `promotions_campaign_manage` — Quản lý chương trình | `campaigns` POST / PATCH, `campaigns/:id/status`, `menus`, `campaigns` GET |
| `promotions` — toàn quyền (giữ từ bản đầu) | Tất cả |

- **`dispatch_board` không còn mở API khuyến mãi nào.** Khi deploy, admin tick `promotions_scan_apply` cho vai trò Lễ tân.
- **Luôn bắt đăng nhập**, kể cả khi `AUTH_ENFORCE_API` tắt:
  - Không có phiên → `401 UNAUTHORIZED`.
  - Thiếu quyền → `403 FORBIDDEN`.
  - Tài khoản bị khoá → `423 ACCOUNT_LOCKED`.
- **Không có quyền xem SĐT / email** (không có `promotions_view` / `promotions_issue`): kết quả `lookup` và `apply` trả `customer.phone` / `customer.email` / `emailTo` = `null`, chỉ còn tên chủ voucher.
- **`active-orders`:** `canOverride` = `false` nếu người quét không có `promotions_override`.
- **Gửi `overrideConditions` khi không có quyền** → `403`, message "Bạn không có quyền áp ngoại lệ…".
- **Gợi ý UI cho B:** ẩn / hiện menu và nút bằng `hasPermission(...)` theo đúng bảng trên, hoặc dùng luôn `promotionCan(user.permissions, action)`.

**Prefix voucher (v9):** form để trống thì server tự sinh từ mã chương trình (`OCT_FREE30_2026` → `OCT`; trùng thì `OCT2`…), lưu một lần lúc tạo. Campaign trả `voucherPrefix`.

## 1. Enum

| Enum | Giá trị |
|---|---|
| `benefit.type` | `FREE_MINUTES` · `PERCENT_DISCOUNT` · `FIXED_DISCOUNT` (`FREE_SERVICE` / `FREE_UPGRADE` dự trữ → `BENEFIT_NOT_SUPPORTED`) |
| `usage.type` | `ONE_TIME` · `LIMITED` (cần `usageLimit`) · `UNLIMITED` |
| `validity.type` (**mới**) | `CAMPAIGN_PERIOD` (theo tháng / khoảng ngày của campaign) · `DAYS_FROM_ISSUE` (N ngày kể từ ngày phát, cần `validityDays`) |
| `qualification.type` | `MIN_PAID_DURATION` · `MIN_ORDER_AMOUNT` · `SPECIFIC_SERVICE` · `MANUAL_ASSIGNMENT` · `CUSTOM` |
| `assignmentMode` | `AUTO` · `MANUAL_ONLY` · `SPECIFIC_CUSTOMER` · `CUSTOMER_GROUP` |
| Campaign `status` | `DRAFT` → `ACTIVE` ⇄ `INACTIVE` → `ENDED` |
| Pass `status` (lưu DB) | `ACTIVE` · `EXPIRED` · `SUSPENDED` · `CANCELLED` |
| Pass `effectiveStatus` (**dùng cho UI và filter**) | `ACTIVE` · `NOT_STARTED` · `INACTIVE` · `EXPIRED` · **`USED_UP`** (v5: theo lượt đã dùng đủ) · `SUSPENDED` · `CANCELLED` |
| `emailStatus` | `PENDING` · `SENDING` · `SENT` · `FAILED` · `SKIPPED` (khách không có email) |
| Usage `status` | `APPLIED` · `COMPLETED` · `CANCELLED` |

**"Theo lượt / theo ngày / theo tháng" trên UI:**

| Kiểu | Gửi lên |
|---|---|
| Theo lượt | `usageType: "LIMITED"` + `usageLimit` |
| Theo ngày | `validityType: "DAYS_FROM_ISSUE"` + `validityDays` |
| Theo tháng | `validityType: "CAMPAIGN_PERIOD"` (mặc định) + `validFrom` / `validUntil` = ngày đầu / cuối tháng |

Với "Theo ngày": voucher hết hạn cuối ngày VN thứ N (tính cả ngày phát), nhưng không quá `validUntil` của campaign.

## 2. Campaign (`promotions`)

| Method | Endpoint |
|---|---|
| GET | `/api/admin/promotions/campaigns?status=` |
| POST | `/api/admin/promotions/campaigns` |
| GET / PATCH | `/api/admin/promotions/campaigns/:id` |
| POST | `/api/admin/promotions/campaigns/:id/status` `{ action: ACTIVATE \| DEACTIVATE \| END }` |
| GET | `/api/admin/promotions/overview` → `{ activeCampaigns, passesIssued, activePasses, usesThisMonth }` |
| GET | `/api/admin/promotions/menus` → danh sách menu / category / dịch vụ **lấy trực tiếp từ bảng Services** (mục 2.1) |

### 2.1 Menu áp dụng (dynamic, không hard-code)

**`GET /api/admin/promotions/menus`:**

```json
[{ "code": "NHT", "label": "Menu Deep Body", "serviceCount": 12,
   "categories": [{ "code": "DEEP BODY", "label": "Deep Body", "serviceCount": 12 }],
   "services": [{ "id": "NHT0001", "name": "…", "category": "Deep Body", "categoryCodes": ["DEEP BODY"] }] }]
```

- **Menu** = tiền tố chữ của mã dịch vụ (`NHP`, `NHS`, `NHT`, …), lấy từ dịch vụ đang bật. Không tính dịch vụ KM và dịch vụ tiện ích.
- **Tên hiển thị** lấy từ `SystemConfigs.promotion_menu_labels`: `NHP` = Menu VIP, `NHS` = Menu Standard, `NHT` = Menu Deep Body. Prefix mới chưa khai báo thì hiện chính prefix.
- **Category** được chuẩn hoá: `["Body"]`, `Body`, `BODY` là cùng một category (`code` viết hoa).

**Form campaign** gửi `"applicableMenus": { "menus": ["NHT"], "categories": ["DEEP BODY"], "serviceIds": [] }`:
- Để trống hoặc không gửi nghĩa là **mọi menu**.
- `serviceIds`: chọn lẻ từng dịch vụ.
- `categories` đi kèm `menus` thì lọc trong các menu đó. `categories` đứng một mình thì áp ở mọi menu.

Lựa chọn này dùng chung cho 3 việc:
1. **Điều kiện phát voucher:** chỉ tính phút / tiền của dịch vụ thuộc phạm vi.
2. **Áp voucher:** đơn phải có ít nhất 1 dịch vụ thuộc phạm vi. Nếu không, đơn bị chặn với `ORDER_MENU_NOT_ELIGIBLE`, có hiện trong danh sách đơn.
3. **Giảm %:** chỉ tính trên tiền dịch vụ thuộc phạm vi. Gửi `benefitConfig.discountScope = "ORDER"` để tính trên cả đơn.

Campaign trả về `applicableMenus: { menus, categories, serviceIds, allMenus }`.

Sau khi campaign ACTIVE, đổi menu áp dụng bị khoá (`CAMPAIGN_LOCKED`), giống các quy tắc khác.

**Body POST / PATCH** — đúng `CampaignFormInput` của B, cộng thêm field tuỳ chọn:

```json
{ "name": "October +30 Minutes", "campaignCode": "OCT_FREE30_2026", "description": "",
  "benefitType": "FREE_MINUTES", "benefitValue": 30, "validFrom": "2026-10-01", "validUntil": "2026-10-31",
  "usageType": "UNLIMITED", "usageLimit": null, "maxUsagePerOrder": 1,
  "qualificationType": "MIN_PAID_DURATION", "qualificationValue": 90, "assignmentMode": "AUTO", "voucherPrefix": "OCT30",
  "validityType": "CAMPAIGN_PERIOD", "validityDays": null,
  "qualificationConfig": { "serviceIdPrefixes": ["NHP"], "serviceCategories": ["VIP_MENU"] },
  "benefitConfig": { "maxDiscountAmount": 150000 }, "maxUsagePerCustomer": null,
  "serviceNameVN": "Khuyến mãi +30 phút", "serviceNameEN": "Promotion +30 mins" }
```

**PATCH:**
- Gửi cả form cũng được.
- Khi campaign đã `ACTIVE` / `INACTIVE`, chỉ báo `422 CAMPAIGN_LOCKED` nếu một **field quy tắc thực sự đổi giá trị**. `error.data.fields` liệt kê các field đó.
- Tên, mô tả, `validUntil` luôn sửa được.

**Response `Campaign`:**

```json
{ "id": "…", "campaignCode": "OCT_FREE30_2026", "name": "October +30 Minutes", "description": null,
  "benefit": { "type": "FREE_MINUTES", "value": 30, "config": {}, "serviceId": "KM0001" },
  "usage": { "type": "UNLIMITED", "limit": null, "maxPerOrder": 1, "maxPerCustomer": null },
  "qualification": { "type": "MIN_PAID_DURATION", "value": 90, "config": { "serviceIdPrefixes": ["NHP"], "serviceCategories": ["VIP_MENU"] } },
  "validity": { "type": "CAMPAIGN_PERIOD", "days": null },
  "assignmentMode": "AUTO", "onePassPerCustomer": true, "status": "ACTIVE",
  "validFrom": "2026-10-01T00:00:00+07:00", "validUntil": "2026-10-31T23:59:59+07:00", "voucherPrefix": "OCT30",
  "benefitServiceId": "KM0001", "issuedPassCount": 12, "usageCount": 30,
  "createdBy": "admin", "createdAt": "…", "updatedAt": "…" }
```

> ⚠️ **Phát tự động:** khi đơn DONE, voucher chỉ tự phát nếu campaign `AUTO` **và** `SystemConfigs.promotion_auto_issue_enabled = true`. Công tắc này **mặc định tắt** (user chốt 02/10/2026). Trước mắt admin phát tay.

### 2.2 Điều kiện áp dụng (v7) — một cấu hình cho cả áp voucher và phát tự động

**Form campaign** gửi `applyConditions`. Field này **thay cho** `applicableMenus`; `applicableMenus` vẫn được nhận và tự đổi sang 1 điều kiện.

```json
"applyConditions": {
  "match": "ALL",
  "conditions": [
    { "menus": ["NHS"], "categories": [], "serviceIds": ["NHS0003", "NHS0007"], "minMinutes": 90, "minOrderAmount": null }
  ]
}
```

**Mỗi điều kiện:**
- Là phép **VÀ** giữa các tiêu chí được đặt. Trong mỗi tiêu chí, danh sách giá trị nghĩa là "**một trong**".
- Phải có **cùng một dịch vụ** của đơn thoả mọi tiêu chí: menu, category, dịch vụ, và `minMinutes`.
- `minMinutes` = số phút của **một** dịch vụ, không cộng dồn, không nhân số lượng. Phút lấy theo thứ tự `vipDuration` → `duration` → `Services.duration`.
- `minOrderAmount` (không bắt buộc) = tổng tiền các dịch vụ gốc của đơn.
- Mỗi điều kiện cần ít nhất 1 tiêu chí. Tối đa 10 điều kiện.

**Ghép điều kiện:** `match` = `ALL` (đạt mọi điều kiện) hoặc `ANY` (đạt một là đủ). Không có điều kiện nào = áp được cho mọi đơn.

**Dịch vụ được xét** = những dịch vụ khách chọn **khi gửi đơn**. Không tính add-on gọi thêm sau (`options.isAddon`), dịch vụ KM, dịch vụ tiện ích, dịch vụ huỷ.
- Ví dụ: VIP 90 phút → đạt. VIP 60 phút + VIP gọi thêm 30 phút → **không** đạt.

**Đơn không đạt:**
- Mã chặn: `ORDER_CONDITION_NOT_MET` (thay cho `ORDER_MENU_NOT_ELIGIBLE`).
- Danh sách đơn ở quầy trả thêm `conditionResult.results[i]` = `{ met, bestMinutes, minMinutes, minOrderAmount, amountMet }`, để hiện ví dụ "Cần Menu VIP từ 90 phút — đơn có 60 phút".

**Giảm %:** chỉ tính trên các dịch vụ đã đạt điều kiện.

**Phát tự động** (khi bật lại) dùng chính cấu hình này. Campaign `AUTO` bắt buộc có ít nhất 1 điều kiện.

**Campaign trả về** `applyConditions` (đã chuẩn hoá) và `conditionsSummary`. Sau khi ACTIVE, đổi điều kiện bị khoá: `CAMPAIGN_LOCKED` với `fields: ["apply_conditions"]`.

**Hiển thị — mọi nơi đều có `conditionsSummary`:** campaign, **pass** (chi tiết và từng dòng danh sách), voucher công khai `/voucher`, email.

```json
"conditionsSummary": { "match": "ALL", "conditions": [ { "menus": ["Menu VIP"], "categories": [], "services": [], "minMinutes": 90, "minOrderAmount": null } ] }
```

- Dựng chữ bằng `formatPromotionConditions(summary, lang)` trong `lib/promotion-voucher.i18n.ts`, có đủ 5 ngôn ngữ. Ví dụ "Menu VIP · từ 90 phút", hoặc "Menu Standard · một trong (A, B) · từ 90 phút".
- **Trả lời mục 9 của B:** engine **có kiểm số phút lúc áp**, nên chữ "từ 90 phút" trên thẻ khớp quy tắc thật. Voucher thật lấy `pass.conditionsSummary`, không cần hiện "Ưu đãi miễn phí" chung chung.

## 3. Voucher (pass) (`promotions`)

| Method | Endpoint |
|---|---|
| GET | `/api/admin/promotions/passes?q&campaignId&status&expiry&limit&offset` |
| GET | `/api/admin/promotions/passes/:id` |
| POST | `/api/admin/promotions/passes` `{ campaignId, customerId, sendEmail? }` |
| PATCH | `/api/admin/promotions/passes/:id` `{ action: SUSPEND \| REACTIVATE \| CANCEL, reason? }` |
| POST | `/api/admin/promotions/passes/:id/send-email` `{ kind?: "ISSUE" \| "REMINDER" }` |
| GET | `/api/admin/promotions/customers?q=` → `[{ id, name, phone, email, language }]` |

**GET danh sách:**
- `q` tìm theo tên, SĐT, email của chủ voucher, hoặc mã voucher.
- `status` lọc theo **effectiveStatus**.
- `expiry` = `VALID` / `EXPIRING_7D` / `EXPIRED`.
- Trả `data: Pass[]` và `meta: { total }`.
- **Không** có `qrPayload` trong danh sách.

**GET chi tiết:** Pass kèm `qrPayload`.

**POST phát voucher:**
- Admin chọn **hồ sơ khách**. Server gửi e-voucher ngay tới **email trên hồ sơ** đó, bằng **ngôn ngữ trên hồ sơ** (`language`).
- Gửi `sendEmail: false` để không gửi.
- Response `201`: Pass có `qrPayload`, thêm `emailDelivery: { status: SENT | FAILED | SKIPPED, reason? }`.
- Khách không có email → pass vẫn được tạo, `emailStatus = SKIPPED`.
- Khách đã có voucher của campaign → `409 PASS_ALREADY_EXISTS`.

**POST send-email (gửi lại):**
- Luôn gửi tới email **hiện tại** trên hồ sơ. Không nhận địa chỉ khác.
- Lỗi: `CUSTOMER_NO_EMAIL` (422), `EMAIL_SEND_FAILED` (502), `PROMOTION_EXPIRED` / `PROMOTION_CANCELLED` (voucher hết hiệu lực thì không gửi).

**Response `Pass`:**

```json
{ "id": "…", "voucherCode": "OCT30-G8GFF9", "qrPayload": "https://<admin>/admin/promotions/scan?t=<token>",
  "status": "ACTIVE", "effectiveStatus": "ACTIVE", "statusReason": null,
  "campaign": { "id": "…", "name": "October +30 Minutes", "campaignCode": "OCT_FREE30_2026", "status": "ACTIVE" },
  "customer": { "id": "CUS-1", "name": "Charlotte Nguyen", "phone": "09…", "email": "c@…" },
  "benefit": { "type": "FREE_MINUTES", "value": 30, "serviceId": "KM0001" },
  "usage": { "type": "UNLIMITED", "limit": null, "usedCount": 3, "maxPerOrder": 1, "lastUsedAt": "…" },
  "lastUsedAt": "…", "validFrom": "…", "validUntil": "…", "issuedAt": "…", "issueSource": "MANUAL", "issuedBy": "admin",
  "sourceBookingId": null,
  "emailStatus": "SENT", "emailTo": "c@…", "emailLang": "vi", "emailSentAt": "…", "emailLastError": null,
  "reminderStatus": "NONE", "reminderSentAt": null }
```

`customer` là **chủ voucher**. Voucher dùng được cho đơn của người khác (mục 4).

### 3.1 Lọc hồ sơ khách và phát hàng loạt (v4)

**`GET /api/admin/promotions/campaigns/:id/customer-candidates`**

Tham số query:
`q`, `onlyQualified`, `qualifiedFrom`, `qualifiedTo`, `visitFrom`, `visitTo`, `minVisits`, `minSpent`, `tier`, `vipMenu`, `guestType`, `gender`, `nationality`, `language`, `hasEmail`, `limit`, `offset`.

- `tier` chỉ có `NEW` hoặc `RETURNING` (≥ 2 lượt). **Không có `VIP`**: muốn lọc khách dùng menu VIP thì dùng `vipMenu=USED`. Gửi `tier=VIP` → `400 VALIDATION_ERROR`, `field = tier`.
- `hasEmail`: `1` (mặc định) hoặc `0`. Email ảo `…@guest.com` **không được tính là có email**.
- `limit` tối đa 50.
- `onlyQualified` cần `qualifiedFrom` + `qualifiedTo` (ngày VN, tối đa 93 ngày). Điều kiện "đạt" kiểm bằng chính hàm của engine: đơn DONE trong khoảng, đạt ngưỡng phút của campaign và thuộc menu áp dụng.

Response:

```json
{ "rows": [ { "id": "CUS-1", "name": "…", "phone": "…", "email": "…|null", "gender": "MALE|FEMALE|OTHER|null",
              "nationality": "Korea", "language": "kr", "visitCount": 3, "totalSpent": 1700000,
              "lastVisitAt": "2026-10-03T09:00:00", "vipMenuCount": 1, "vipMenuUsed": true,
              "guestType": "SINGLE|GROUP", "tier": "NEW|RETURNING", "qualifyingOrderCount": 1, "alreadyHasPass": false } ],
  "total": 120, "limit": 50, "offset": 0, "excludedNoEmail": 14, "nationalities": ["Korea", "Vietnam"],
  "qualificationIgnored": false, "qualifyingComputed": true }
```

Cách tính chỉ số:
- `visitCount` = **đơn cha đã hoàn tất** (user chốt 03/10). CRM đang đếm mọi đơn không huỷ, nên có thể lệch với khách đang có đơn mở.
- `totalSpent` và `guestType` khớp CRM.
- `lastVisitAt` là giờ VN, không có offset.
- `alreadyHasPass = true`: nên làm mờ hoặc bỏ tick, vì phát lại sẽ trả `ALREADY_EXISTS`.
- `qualificationIgnored = true`: campaign dạng `MANUAL_ASSIGNMENT` không có điều kiện nên bộ lọc "đạt điều kiện" không áp dụng.

**`POST /api/admin/promotions/passes/bulk`**

Body: `{ "campaignId": "…", "customerIds": ["…"] }`, tối đa 50, server tự bỏ id trùng. Thành công trả `201`.

```json
{ "results": [ { "customerId": "CUS-1", "status": "ISSUED", "passId": "…", "voucherCode": "OCT30-…", "emailDelivery": { "status": "SENT" } },
               { "customerId": "CUS-2", "status": "ALREADY_EXISTS", "passId": "…", "voucherCode": "…" },
               { "customerId": "CUS-9", "status": "FAILED", "errorCode": "CUSTOMER_NOT_FOUND" } ],
  "summary": { "issued": 1, "alreadyExists": 1, "failed": 1, "emailSent": 1, "emailFailed": 0, "emailSkipped": 0, "emailQueued": 0 } }
```

- `emailDelivery.status` có thêm giá trị **`QUEUED`**: email chưa kịp gửi trong 40 giây, cron sẽ gửi trong khoảng 5 phút. B cần thêm `QUEUED` vào `PromotionEmailOutcome`, đọc `summary.emailQueued`, và hiện "đang chờ gửi N".
- Khách đã có voucher (`ALREADY_EXISTS`) thì không gửi lại email.
- Lỗi cả request:
  - `PROMOTION_INACTIVE` / `PROMOTION_EXPIRED`: campaign không chạy.
  - `VALIDATION_ERROR`: danh sách rỗng hoặc quá 50.

### 3.2 Theo dõi voucher và phát lại (v5)

> Endpoint danh sách menu: xem mục 2.1. QR `qrPayload` trỏ tới `/voucher?t=`: xem mục 6 và 6.1.

**Trạng thái `USED_UP`:**
- Voucher `ONE_TIME` / `LIMITED` đã dùng đủ số lượt.
- Tính theo thời gian thực: huỷ một lượt dùng thì voucher quay lại `ACTIVE`.
- Áp vào đơn bị chặn với `PROMOTION_USAGE_LIMIT_REACHED`.
- Không gửi email hay nhắc hạn (`PROMOTION_USED_UP`).
- Trang `/voucher` hiện "Đã dùng hết lượt", không có QR.

**Tab theo dõi** — `GET /api/admin/promotions/passes?group=ACTIVE|PAST` (kết hợp được với `campaignId`, `q`):

| Tab | Gồm | Sắp xếp |
|---|---|---|
| `ACTIVE` (đang hiệu lực) | `ACTIVE`, `NOT_STARTED`, `SUSPENDED`, `INACTIVE` (vẫn mở lại được, hiện badge riêng) | Sắp hết hạn trước |
| `PAST` (đã qua) | `EXPIRED`, `USED_UP`, `CANCELLED` | Mới kết thúc trước |

- Pass có thêm `endedAt` (lúc huỷ, lần dùng cuối khi đã dùng hết, hoặc ngày hết hạn), cùng `supersededAt` / `supersededBy`.
- Overview có thêm `pastPasses`.

**Phát lại (user chốt 03/10/2026):**
- Khách **đang giữ** voucher còn dùng được của chương trình (`ACTIVE` / `NOT_STARTED` / `SUSPENDED` / `INACTIVE`) thì không phát thêm: `409 PASS_ALREADY_EXISTS` hoặc `ALREADY_EXISTS` khi phát hàng loạt. Voucher tạm khoá thì dùng "Kích hoạt lại".
- Voucher cũ đã `CANCELLED` / `EXPIRED` / `USED_UP` thì **phát lại được**:
  - Voucher mới có mã và QR mới.
  - Voucher cũ ở lại lịch sử. Voucher `EXPIRED` / `USED_UP` bị đánh dấu `supersededBy` và đóng hẳn, kể cả khi sau đó có lượt dùng bị huỷ.
- Kết quả phát hàng loạt có thêm `reissued: true` khi đây là lần phát lại.

**Danh sách lọc khách (`customer-candidates`):**
- `alreadyHasPass` = đang giữ voucher còn dùng được (không tick được). Các khách này **xếp cuối** danh sách.
- `passHistory`: tối đa 10 voucher hồ sơ từng có, ở mọi chương trình, mới nhất trước. Mỗi dòng gồm `{ passId, voucherCode, campaignId, campaignName, effectiveStatus, issuedAt }`.

## 4. Quầy: scan và áp voucher (`dispatch_board`)

| Method | Endpoint |
|---|---|
| GET | `/api/promotion-passes/lookup?t=<token hoặc nguyên URL quét được>` hoặc `?code=<mã voucher>` |
| GET | `/api/promotion-passes/:id/active-orders?q=` |
| POST | `/api/promotion-passes/:id/apply` `{ bookingId }` |
| POST | `/api/promotion-usages/:id/cancel` `{ reason? }` |
| GET | `/api/customers/:customerId/promotions` → `{ active, past, usages }` |

**lookup:** trả Pass kèm `qrPayload`. Token sai → `404 PROMOTION_NOT_FOUND`.

**active-orders:**
- Trả **mọi đơn đang mở của cả spa** (`NEW` / `PREPARING` / `IN_PROGRESS`) trong **ngày làm việc hiện tại**. Ngày làm việc cắt theo `spa_day_cutoff_hours`, mặc định 7h.
- `q` tìm theo mã đơn, tên khách, SĐT, phòng.
- Đơn của chủ voucher xếp đầu. Tối đa 50 đơn.

```json
{ "id": "…", "billCode": "NH-021026-001", "displayCode": "NH", "status": "IN_PROGRESS",
  "customerId": "CUS-2", "customerName": "Bạn của khách", "customerPhone": "…",
  "bookingTime": "14:00", "roomLabel": "P202", "totalAmount": 800000, "createdAt": "…", "source": "VIP_MENU",
  "items": [ { "id": "…", "serviceId": "NHP0003", "serviceName": "VIP 90", "durationMinutes": 90, "price": 800000, "status": "IN_PROGRESS", "isPromotion": false } ],
  "totalDurationMinutes": 90, "paidMinutes": 90, "promotionMinutes": 0,
  "isPassOwnerOrder": false, "canApply": true, "blockedReasonCode": null, "blockedReason": null, "alreadyAppliedThisPass": false }
```

- `canApply` và `blockedReasonCode` do **cùng hàm** `promo_check_apply` tính, hàm này cũng được dùng khi apply thật. UI chỉ làm mờ đơn bị chặn và hiện `blockedReason`.
- `items[].price` là thành tiền (giá × số lượng). Dòng giảm giá có giá âm.

**apply:**
- Voucher **dùng chung được**: áp được cho đơn của bất kỳ khách nào, kể cả đơn chưa gắn khách.
- Lượt dùng ghi `customer` = khách của đơn và `passOwner` = chủ voucher.
- Response `201`:
  ```json
  { "usageId": "…", "bookingItemId": "…", "appliedMinutes": 30, "discountAmount": 0,
    "benefit": { … }, "booking": { …như item ở active-orders, đã có dòng KM… }, "pass": { …usedCount mới… } }
  ```

**cancel:** chỉ huỷ được khi dịch vụ KM chưa được điều phối. Ngược lại trả `PROMOTION_ITEM_IN_SERVICE`; khi đó quầy huỷ dịch vụ ở màn Điều phối.

**`usages` trong lịch sử khách:** gồm lượt dùng trên đơn của khách **và** lượt người khác dùng voucher của khách.

### 4.1 Áp ngoại lệ khi đơn chưa đủ điều kiện (v8)

**Màn quét** — `GET /api/promotion-passes/:id/active-orders` trả mỗi đơn thêm:

| Field | Ý nghĩa | Gợi ý UI |
|---|---|---|
| `eligibility` | `ELIGIBLE` / `NOT_ELIGIBLE` / `BLOCKED` | Badge xanh "Đủ điều kiện" / vàng "Chưa đủ điều kiện" / xám "Không áp được" |
| `canOverride` | `true` khi **chỉ** thiếu điều kiện | Cho bấm chọn đơn, sẽ hiện popup |
| `unmetReasons` | Các dòng tiếng Việt do server dựng sẵn | Hiện làm ghi chú dưới đơn **và** trong popup |

Ví dụ `unmetReasons`:
- `"Cần Menu VIP · từ 90 phút — dịch vụ phù hợp dài nhất của đơn là 60 phút"`
- `"Cần QMS · một trong: Body A, Body B · từ 90 phút — đơn không có dịch vụ nào phù hợp"`
- `"Cần tổng đơn từ 1.000.000đ — đơn hiện 900.000đ"`
- Với `ANY`: dòng đầu là `"Cần đạt một trong các điều kiện sau:"`, sau đó mỗi điều kiện một dòng.

**Áp** — `POST /api/promotion-passes/:id/apply`, body `{ bookingId, overrideConditions?, overrideNote? }`:
1. Gửi bình thường. Nếu đơn thiếu điều kiện → `422 ORDER_CONDITION_NOT_MET`, kèm `error.data = { unmetReasons, canOverride: true }`.
2. Quầy xác nhận trong popup, **bắt buộc nhập lý do**, rồi gửi lại `{ bookingId, overrideConditions: true, overrideNote: "Khách quen, quản lý duyệt" }`.
   - Lý do dưới 3 hoặc trên 500 ký tự → `422 OVERRIDE_REASON_REQUIRED` (trên 500 thì zod chặn trước với 400).
3. Thành công `201`: `conditionsOverridden: true`, `overrideReasons: [...]`.

**Không vượt được** (chặn cứng, kể cả khi gửi `overrideConditions`):
- Voucher hết hạn / chưa tới ngày / tạm dừng / tạm khoá / đã huỷ / hết lượt.
- Voucher đã áp cho đơn này.
- Đơn đã xong, đã huỷ, hoặc không có dịch vụ.

Những đơn này có `eligibility = BLOCKED`, `canOverride = false`.

**Ghi vết và ưu đãi:**
- Mỗi lượt áp ngoại lệ lưu: người áp (`staffId` / `staffName`, lấy từ session), lý do không đủ điều kiện tại lúc áp (`overrideReasons`), lý do quầy ghi (`overrideNote`).
- Gửi `overrideConditions` cho đơn **đủ** điều kiện thì áp bình thường, không ghi là ngoại lệ.
- Giảm % khi áp ngoại lệ tính trên **cả đơn**.

**Lịch sử dùng:**
- `GET /api/admin/promotions/usages?overridden=1` lọc các lượt áp ngoại lệ.
- Mỗi lượt có `conditionsOverridden`, `overrideReasons`, `overrideNote` để làm nhãn "Áp ngoại lệ".

## 5. Lịch sử sử dụng (`promotions`)

`GET /api/admin/promotions/usages?from=yyyy-MM-dd&to=yyyy-MM-dd&campaignId&status&q&passId`
- `from` / `to` là ngày VN, tính cả 2 đầu. Tối đa 500 dòng, mới nhất trước.
- `q` tìm theo mã voucher, mã đơn, tên khách, SĐT.

```json
{ "id": "…", "appliedAt": "…", "status": "COMPLETED", "benefit": { "type": "FREE_MINUTES", "value": 30 },
  "appliedMinutes": 30, "discountAmount": 0, "passId": "…", "voucherCode": "OCT30-…",
  "campaignId": "…", "campaignName": "October +30 Minutes",
  "customer": { "id": "CUS-2", "name": "…", "phone": "…", "email": "…" },
  "passOwner": { "id": "CUS-1", "name": "…" },
  "booking": { "id": "…", "billCode": "…", "displayCode": "…" },
  "staffId": "NH001", "staffName": "Lễ tân A", "completedAt": "…", "cancelledAt": null, "cancelReason": null }
```

## 6. E-voucher qua email

- **Lúc gửi:**
  - Admin phát voucher thì gửi ngay.
  - Nút "Gửi lại" gọi `send-email`.
  - Cron `/api/cron/promotion-emails` (5 phút / lần) gửi email cho voucher phát tự động (khi công tắc bật) và thử lại email lỗi, tối đa 5 lần.
- **Nhắc hạn:** cron gửi 1 email nhắc khi voucher còn `promotion_expiry_reminder_days` ngày (mặc định **3**). Chỉ áp cho voucher còn ACTIVE và đã gửi email phát.
- **Nội dung:**
  - 5 ngôn ngữ `vi` / `en` / `cn` / `jp` / `kr`, theo ngôn ngữ trên hồ sơ khách. Ngôn ngữ là `customerLang` xuất hiện nhiều nhất trong các đơn của khách, cùng quy tắc với CRM.
  - Thương hiệu, hotline, địa chỉ lấy từ cấu hình email đang có.
  - Ảnh QR tạo ngay trên server (package `qrcode`) và đính kèm dạng `cid`. Token không đi qua dịch vụ bên ngoài.
- **QR = `qrPayload`** = `${PROMOTION_SCAN_BASE_URL || APP_URL}/voucher?t=<token>` (mục 6.1).
- **Email là một thẻ e-voucher tĩnh:**
  - Mặt trước gồm thương hiệu, chương trình, ưu đãi, tên khách, hạn dùng, số lần dùng.
  - QR nằm ở phần cuống vé, ngăn bằng đường chấm.
  - Nút **"Xem E-Voucher"** mở thẻ 3D trên trang `/voucher`. Email không chạy được 3D/JavaScript nên chỉ có bản tĩnh.

### 6.1 Trang e-voucher công khai `/voucher?t=` — B làm giao diện, A cấp dữ liệu và logic

QR trên thẻ 3D, trong email và trên Web Booking History đều trỏ tới trang này. Trang nằm **ngoài `/admin`**, không yêu cầu đăng nhập.

```tsx
// app/voucher/page.tsx (Server Component)
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { resolveVoucherView } from '@/lib/promotion-voucher-view';
import { PROMOTION_VOUCHER_PAGE_I18N, pickVoucherLang } from '@/lib/promotion-voucher.i18n';

const view = await resolveVoucherView(searchParams.t);
if (view.mode === 'STAFF') redirect(view.redirectTo);           // nhân viên có dispatch_board → trang quét
const lang = pickVoucherLang(searchParams.lang, (await headers()).get('accept-language'));
const t = PROMOTION_VOUCHER_PAGE_I18N[lang];
// view.mode === 'CUSTOMER' → <VoucherCard3D data={…view.voucher} /> + t.contactToApply(view.contact.brandName)
//                             + hotline / địa chỉ (view.contact)
// view.mode === 'INVALID'  → t.invalidTitle / t.invalidBody(brand)
```

- **`view.voucher.menuLabels`** (v6): tên phạm vi áp dụng để hiện cho khách, ví dụ `["Menu VIP"]`, `["Menu Standard · Body"]`, hoặc `["Lấy ráy tai"]` khi chọn dịch vụ lẻ. Mảng rỗng nghĩa là mọi menu.
  - Tên menu lấy từ `SystemConfigs.promotion_menu_labels`. Category phủ hết menu thì không hiện đuôi category (NHP + VIP_MENU → "Menu VIP").
  - Campaign cũng trả `applicableMenus.labels` cùng giá trị.
- **`view.voucher`** khớp `VoucherCardData` của B: `campaignName`, `benefit`, `usage { type, limit, maxPerOrder, usedCount }`, `validFrom`, `validUntil`, `voucherCode`, `voucherPrefix`, `customerName`, `status`, `effectiveStatus`, `applicableMenus`, `qrPayload`.
  - `qrPayload` là `null` khi voucher không còn dùng được.
  - **Không có** SĐT, email, đơn hàng hay nhân viên.
- **Kiểm nhân viên** dùng `sessionHasPermission('dispatch_board')`. Hàm này không có nhánh "cho qua khi cờ tắt", nên khách không bao giờ bị chuyển nhầm sang trang quét.
- **Chữ 5 ngôn ngữ** ở `lib/promotion-voucher.i18n.ts`.
  - Câu vi: **"Vui lòng liên hệ Oria Spa để áp dụng."** (tên spa lấy từ cấu hình email).
  - Có sẵn nhãn trạng thái, hạn dùng, hotline, địa chỉ, "Áp dụng cho" / "Tất cả menu".
  - Ngôn ngữ chọn theo `?lang=` trước, sau đó theo ngôn ngữ trình duyệt, mặc định `vi`.
- **Trang quét của quầy:** `lookup?t=` nhận nguyên URL `/voucher?t=…`. Máy quét chỉ đọc `t`, không cần đổi gì.
- **Công tắc:** `SystemConfigs.promotion_email_enabled` (mặc định bật).
- **Env:**
  - `PROMOTION_SCAN_BASE_URL`: domain admin; để trống thì dùng `APP_URL`.
  - SMTP dùng chung với email đặt lịch.
  - `CRON_SECRET`.

## 7. Field thêm so với `promotion-client.ts`

| Đối tượng | Field thêm |
|---|---|
| Campaign | `validity`, `benefit.config` / `benefit.serviceId`, `usage.maxPerCustomer`, `onePassPerCustomer`, `benefitServiceId` |
| Pass | `effectiveStatus` (nên dùng thay `status`), `email*`, `reminder*`, `issuedBy`, `campaign.status` |
| Order | `billCode`, `customerId`, `customerPhone`, `paidMinutes`, `promotionMinutes`, `blockedReason`, `alreadyAppliedThisPass`, `source`, `items[].serviceId`, `items[].status` |
| Usage | `passOwner`, `discountAmount`, `campaignId`, `staffId`, `completedAt` / `cancelledAt` / `cancelReason` |

**B cần bổ sung vào form:**
- `validityType` + `validityDays` (theo ngày).
- **`applicableMenus`** (multi-select từ `GET /api/admin/promotions/menus`): dùng field này thay cho `qualificationConfig`. Không gửi thì áp **mọi** menu.
- **Trang `/voucher`** (mục 6.1).

## 8. Web Booking History (Đợt 2) — RPC, không phải HTTP

Web Booking dùng chung project Supabase. Repo NganHa-WebBooking gọi RPC từ **server route** bằng service role. Route đó nên có rate limit theo IP.

```ts
const { data } = await supabaseAdmin.rpc('promo_public_vouchers_by_email', { p_email: email });
// data = { success, data: { active: [...có qrToken], past: [...] } }
```

- Mỗi voucher gồm: `id`, `voucherCode`, `effectiveStatus`, `campaign.name`, `customerName`, `benefit`, `usage { type, limit, usedCount }`, `validFrom`, `validUntil`, `issuedAt`. Riêng voucher trong `active` có thêm `qrToken`.
- **Không có** SĐT, nhân viên hay lịch sử đơn.
- QR hiển thị trên History = `${ADMIN_URL}/voucher?t=${qrToken}`, giống hệt QR trong email. Khi bấm vào sẽ mở thẻ 3D.

**wrb-noi-bo:** dùng các RPC `promo_lookup_pass`, `promo_order_candidates(p_pass_id, p_q, p_limit)`, `promo_apply_pass(p_pass_id, p_booking_id, p_staff_id)`, `promo_cancel_usage`, `promo_customer_promotions`. Response giống API ở trên, nhưng:
- RPC trả `qrToken` thay cho `qrPayload`; wrb-noi-bo tự dựng URL như trên.
- RPC trả `billCode`; `displayCode` do lớp TS dựng.

## 9. Mã lỗi

| Code | Khi nào |
|---|---|
| `PROMOTION_NOT_FOUND` | Không có voucher / token sai |
| `PROMOTION_INACTIVE` / `PROMOTION_NOT_STARTED` / `PROMOTION_EXPIRED` | Campaign tạm dừng / chưa tới ngày / quá hạn (kiểm theo giờ thực) |
| `PROMOTION_SUSPENDED` / `PROMOTION_CANCELLED` | Voucher bị khoá / huỷ |
| `PROMOTION_USED_UP` | Gửi email cho voucher đã dùng hết lượt (v5) |
| `PROMOTION_ALREADY_APPLIED` | Voucher đã áp cho đơn này (kể cả khi 2 quầy bấm cùng lúc) |
| `PROMOTION_USAGE_LIMIT_REACHED` | Hết lượt (`LIMITED` / `ONE_TIME` / `maxUsagePerCustomer` theo khách của đơn) |
| `PROMOTION_ITEM_IN_SERVICE` | Huỷ khuyến mãi khi dịch vụ KM đã điều phối |
| `ORDER_NOT_FOUND` / `ORDER_NOT_ACTIVE` / `ORDER_NOT_ELIGIBLE` | Không có đơn / đơn không mở / đơn chưa có dịch vụ hoặc giá trị |
| `ORDER_CONDITION_NOT_MET` | Đơn chưa đạt điều kiện áp dụng (v7; thay `ORDER_MENU_NOT_ELIGIBLE`). Quầy có thể áp ngoại lệ (v8) |
| `OVERRIDE_REASON_REQUIRED` | Áp ngoại lệ nhưng thiếu lý do (3–500 ký tự) |
| `BENEFIT_NOT_SUPPORTED` | Loại ưu đãi chưa hỗ trợ |
| `PASS_ALREADY_EXISTS` | Phát trùng (pass cũ nằm ở `error.data`) |
| `CUSTOMER_NOT_FOUND` / `CUSTOMER_NO_EMAIL` | Phát tay hoặc gửi email |
| `EMAIL_SEND_FAILED` | Lỗi SMTP khi gửi lại |
| `CAMPAIGN_LOCKED` / `CAMPAIGN_ENDED` / `CAMPAIGN_INVALID` / `CAMPAIGN_CODE_EXISTS` / `CAMPAIGN_NOT_FOUND` | Quản lý campaign |
| `VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN` / `ACCOUNT_LOCKED` / `INTERNAL_ERROR` | Lỗi chung |

> `ORDER_CUSTOMER_MISMATCH` **không còn được trả về** (voucher dùng chung). B có thể giữ mã này trong type để tương thích.
> Backend không dùng `INVALID_QR`; token sai trả `PROMOTION_NOT_FOUND`.
