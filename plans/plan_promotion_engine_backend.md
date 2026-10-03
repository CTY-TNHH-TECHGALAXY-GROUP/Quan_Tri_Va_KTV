# Plan — Promotion Engine (Backend / Agent A) — v3

> Mức 2: có migration DB, trigger trên `Bookings`, và thêm dịch vụ vào đơn (ảnh hưởng timer KTV, tiền tua, hoa hồng).
> Trạng thái: **ĐÃ TRIỂN KHAI, CHƯA COMMIT** (02/10/2026). Đã test trên local và Supabase test (`eknggruuiuadwldacpmb`). **Chưa lên production.**
> Worktree: `.worktrees/promotion-engine`, nhánh `feat/promotion-engine`, tạo từ `feat/bit-lo-hong-phase1` @ `3d15d13f`.
> API cho Agent B: `plans/promotion_engine_api_contract.md`.

## v3: thay đổi so với v2 (user chốt 02/10/2026)

| # | Quyết định |
|---|---|
| 7 | Nhánh gốc là `feat/bit-lo-hong-phase1`. Test local trước, sau đó test trên Supabase test. |
| 8 | Dịch vụ KM do engine tạo **dynamic theo loại ưu đãi**, không phải lúc nào cũng 0đ (VD giảm 10%, giảm 50.000đ). |

**Cách triển khai cho ưu đãi giảm giá:**
- Dịch vụ `KM####` có `is_utility = true` và `duration = 0`.
- Khi áp voucher, engine thêm 1 dòng BookingItem **giá âm**, trạng thái `DONE`, không có KTV, rồi trừ `Bookings.totalAmount` đúng số tiền đó. Nhờ vậy Σ giá item vẫn bằng tổng đơn.
- Luồng huỷ dịch vụ có sẵn (`cancelBookingItem` trừ `price × qty`) tự cộng lại tiền.
- Mọi chỗ tính lại trạng thái đơn đều bỏ qua dịch vụ tiện ích, nên dòng giảm giá không chặn việc chốt đơn.
- `PERCENT_DISCOUNT` tính trên tổng tiền các dịch vụ đã trả (hoặc chỉ các dịch vụ đủ điều kiện, nếu `benefit_config.discountScope = 'QUALIFYING_ITEMS'`), có trần `maxDiscountAmount`, và không giảm quá tổng đơn.
- `FREE_SERVICE` / `FREE_UPGRADE` chỉ giữ chỗ trong enum, apply sẽ trả `BENEFIT_NOT_SUPPORTED`.

**Điều chỉnh khi code (khác v2):**
- `Bookings."updatedAt"` ghi theo **UTC**, cùng quy ước với RPC cron và `dispatch/actions.ts`. Code đang chạy ghi lẫn giờ VN và UTC.
- Ẩn dịch vụ KM ở **`AddServiceModal.tsx`** (chỉ phần hiển thị), không lọc trong `dispatch/actions.ts`. Danh sách `allServices` ở đó còn dùng để tra tên dịch vụ cho item KM đã có trên đơn.
- Quyền mới `promotions` (`lib/constants.ts`, `lib/types.ts`).

## 0. Quyết định đã chốt (user, 02/10/2026)

| # | Quyết định |
|---|---|
| 1 | KTV **được tính tiền tua** cho phút khuyến mãi (KM). Phút KM được thêm vào đơn **bằng một dịch vụ KM**. Dịch vụ này do **Promotion Engine tự tạo trong `Services`** khi tạo campaign, nên không phải tạo tay. Mã dịch vụ có prefix **`KM`**. |
| 2 | Điều kiện 90 phút **chỉ tính dịch vụ menu VIP**. Đơn đã là 1 khách / 1 đơn (có sẵn cơ chế tách khách, gộp đơn), nên xét theo từng đơn. |
| 3 | Phát pass khi đơn chuyển sang `DONE`. |
| 4 | Làm trên nhánh mới. |
| 5 | Chưa làm API cho Web Booking. Trước mắt chỉ áp dụng cho **wrb-noi-bo** và **admin hiện tại**. |
| 6 | **Không seed** campaign và **không backfill** đơn cũ. Chỉ phát khi admin tạo campaign hoặc voucher để assign. |

---

## 1. Kết quả khảo sát (khác giả định trong prompt)

| Giả định prompt | Thực tế codebase | Thích nghi |
|---|---|---|
| Order có OPEN / CONFIRMED / IN_SERVICE / COMPLETED | `Bookings.status`: NEW → PREPARING → IN_PROGRESS → CLEANING → FEEDBACK → DONE, cùng CANCELLED và SPLIT | OPEN = `NEW`, CONFIRMED = `PREPARING`, IN_SERVICE = `IN_PROGRESS` |
| Có `paid_duration` | Không có cột này. Phút mỗi item lấy theo thứ tự `options.vipDuration` → `options.duration` → `Services.duration`. Timer KTV và hoa hồng đọc `segments[].duration` | Dùng **một hàm SQL** tính `paid_qualifying_minutes` |
| Chỉ một chỗ set COMPLETED | Có ≥10 writer TS, cộng **pg_cron SQL** `auto_complete_unrated_feedback()` set DONE mà không qua TS | Hook bằng **DB trigger** |
| — | Khi mọi item CANCELLED, `recomputeBookingStatus` vẫn trả **DONE** (`lib/dispatch-status.ts:157`) | Đơn không còn phút VIP thì không phát pass |
| Nhận diện VIP | Không có cờ riêng. Code đang nhận diện bằng `serviceId` bắt đầu bằng `NHP` / `VIP_` (dispatch `page.tsx:2345`, wrb-noi-bo `menu.ts`), `Services.category = 'VIP_MENU'` (wrb-noi-bo `vip-appointment`), và `options.vipDuration` | Đưa điều kiện vào **cấu hình campaign** (`qualification_config`), không hard-code (mục 3) |
| Supabase có transaction | Supabase JS không có transaction | Các mutation nhiều bước viết thành **RPC plpgsql** (`SECURITY DEFINER`, `FOR UPDATE`, chỉ `service_role`) |

---

## 2. Data model

Migration: `supabase/migrations/<ts>_promotion_engine.sql`. Bảng đặt tên PascalCase, cột snake_case. RLS bật, không policy.

### 2.1 `PromotionCampaigns`
- Cột: `id uuid PK`, `campaign_code UNIQUE`, `name`, `description`, `benefit_type`, `benefit_value`, `benefit_service_id text FK → Services` (dịch vụ KM tự tạo), `valid_from`, `valid_until`, `usage_type`, `usage_limit`, `max_usage_per_customer`, `max_usage_per_order DEFAULT 1`, `qualification_type`, `qualification_value`, `qualification_config jsonb`, `assignment_mode`, `one_pass_per_customer DEFAULT true`, `voucher_prefix`, `status`, `created_by`, `created_at`, `updated_at`.
- Enum dùng `text` + `CHECK`, theo đúng danh sách giá trị của prompt.
- CHECK:
  - `valid_until > valid_from`
  - `max_usage_per_order >= 1`
  - `benefit_value > 0`
  - nếu `PERCENT_DISCOUNT` thì `benefit_value <= 100`
  - nếu `LIMITED` thì `usage_limit >= 1`

### 2.2 `CustomerPromotionPasses`
- Cột:
  - `id`, `campaign_id`, `customer_id FK → Customers`
  - `voucher_code UNIQUE`, `qr_token UNIQUE`
  - `status` (ACTIVE / EXPIRED / SUSPENDED / CANCELLED)
  - snapshot lúc phát: `benefit_type`, `benefit_value`, `usage_type`, `valid_from`, `valid_until`, `one_pass_per_customer`
  - `source_booking_id`, `issue_source` (AUTO / MANUAL), `issued_at`, `issued_by`, `status_reason`, `created_at`, `updated_at`
- Partial UNIQUE `(customer_id, campaign_id) WHERE one_pass_per_customer`.
- UNIQUE `(source_booking_id, campaign_id)`.
- `voucher_code` = `<prefix>-<6 ký tự Crockford base32>`. Gặp trùng thì sinh lại.
- `qr_token` = 32 byte `gen_random_bytes`, mã hoá base64url. Không chứa id, SĐT hay email.

### 2.3 `PromotionUsages`
- Cột:
  - `id`, `promotion_pass_id`, `campaign_id`, `customer_id`
  - `booking_id`, `booking_item_id` (item KM đã thêm vào đơn)
  - `benefit_type`, `benefit_value`, `applied_minutes`
  - `staff_id`, `status` (APPLIED / COMPLETED / CANCELLED)
  - `applied_at`, `completed_at`, `cancelled_at`, `cancel_reason`, `created_at`, `updated_at`
- Partial UNIQUE `(promotion_pass_id, booking_id) WHERE status <> 'CANCELLED'`. Khi 2 staff apply cùng lúc thì chỉ 1 người thành công.

### 2.4 `PromotionIssueErrors`
Log lỗi của trigger: `booking_id`, `error`, `created_at`. Trigger không bao giờ làm hỏng việc chốt đơn.

### 2.5 `Services`: thêm cột `is_promotion boolean NOT NULL DEFAULT false`
- Đây là tag nhận diện dịch vụ KM, dùng cho:
  - loại khỏi phút đủ điều kiện (60 + 30 KM không thành 90)
  - ẩn khỏi picker dịch vụ của quầy và admin menu (mục 6)
  - hiển thị nhãn "KM"
- Không thêm cột vào `Bookings`. Phút KM của đơn = Σ phút item KM, phút tổng = paid + KM.
- Cập nhật `TableInSupabase.md` trong cùng thay đổi.

---

## 3. Dịch vụ KM do engine tạo

Khi **tạo campaign** với `benefit_type = FREE_MINUTES` (RPC `promo_create_campaign`, một transaction):

1. Sinh `Services.id` = `KM` + 4 số tăng dần (VD `KM0001`). Lấy số kế tiếp bằng `MAX(id) LIKE 'KM%'` trong lúc khoá advisory.
2. Insert dịch vụ:
   - `nameVN` "Khuyến mãi +30 phút", `nameEN` "Promotion +30 mins"
   - `duration = benefit_value`, `priceVND = 0`, `priceUSD = 0`
   - `category = 'PROMOTION'`, `service_group = 'ADDON'`, `is_promotion = true`, `isActive = true`
   - `min_ktv_required = 1`, `strengthConfig` mặc định
3. Gắn `PromotionCampaigns.benefit_service_id`.

Ràng buộc:
- Campaign đã ACTIVE thì không cho đổi `benefit_value`. Muốn đổi thì tạo campaign mới, để dịch vụ và lịch sử không lệch.
- Campaign ENDED thì dịch vụ KM giữ nguyên, vì đơn cũ vẫn tham chiếu tới nó.

Ở wrb-noi-bo, prefix `KM` cho `menuType = 'unknown'` (`src/services/menu.ts`), nên dịch vụ KM tự **không hiện trên menu khách**. Đã kiểm tra, không cần sửa repo đó.

**Điều kiện đủ (cấu hình, không hard-code):**

```json
qualification_type = "MIN_PAID_DURATION", qualification_value = 90
qualification_config = { "serviceIdPrefixes": ["NHP", "VIP_"], "serviceCategories": ["VIP_MENU"] }
```

Hàm `promo_paid_qualifying_minutes(p_booking_id, p_config)` cộng phút các item thoả mọi điều kiện sau:
- item không `CANCELLED`
- dịch vụ không phải tiện ích (`is_utility`, `NHS0900`)
- `is_promotion = false`
- không phải item gộp hiển thị (`options.mergedIntoId`)
- nếu là add-on thì phải đã trả tiền (`options.isPaid` không phải `false`)
- khớp `serviceIdPrefixes` hoặc `serviceCategories`; config rỗng nghĩa là mọi dịch vụ

Phút mỗi item = (`vipDuration` → `duration` → `Services.duration`) × `quantity`. Đơn `SPLIT` tính 0 phút.

---

## 4. Engine — các RPC (một nguồn công thức, TS chỉ gọi)

| RPC | Việc |
|---|---|
| `promo_create_campaign(payload)` / `promo_update_campaign` / `promo_set_campaign_status` | Validate, tạo dịch vụ KM (mục 3) |
| `promo_paid_qualifying_minutes`, `promo_evaluate_booking` | Tính điều kiện, trả lý do (cho test và debug) |
| `promo_issue_for_booking(booking_id)` | Chạy khi DONE. Chọn campaign `ACTIVE`, `AUTO`, có giờ hoàn tất nằm trong khoảng hiệu lực và đủ điều kiện, rồi `INSERT … ON CONFLICT DO NOTHING` |
| `promo_issue_manual(campaign_id, customer_id, staff_id)` | Admin assign. Nếu khách đã có pass thì trả `{conflict: true, pass}` |
| `promo_apply_pass(pass_id, booking_id, staff_id)` | Một transaction. Khoá pass và booking `FOR UPDATE`, validate toàn bộ, **insert BookingItem KM** rồi insert usage |
| `promo_cancel_usage(usage_id, staff_id, reason)` | Usage → CANCELLED. Item KM → CANCELLED nếu chưa bắt đầu. **Đang làm hoặc đã xong thì từ chối** với `PROMOTION_ITEM_IN_SERVICE`; quầy xử lý như huỷ dịch vụ bình thường |
| `promo_expire_passes()` | pg_cron hằng ngày đổi ACTIVE → EXPIRED. Apply vẫn luôn kiểm `now()` |

**Item KM khi apply:**
- `serviceId = benefit_service_id`, `price = 0`, `quantity = 1`, `status = 'WAITING'` (giống add-on `addAddonServices`)
- `guest_id` lấy theo guest của item VIP đầu tiên
- `options = { isPromotion: true, promotionUsageId, promotionPassId, duration: 30, isPaid: true }`

Quầy điều phối item này như một dịch vụ nối tiếp. Timer, tua và hoa hồng chạy theo luồng có sẵn (đúng quyết định 1). Engine **không** tự gán KTV và **không** sửa segments của item khác.

**Trigger** `tr_promo_on_booking_status` (`AFTER UPDATE OF status ON "Bookings"`, chỉ chạy khi status thực sự đổi):
- Khi → `DONE`: usage APPLIED → COMPLETED (item KM đã CANCELLED thì usage → CANCELLED), sau đó `promo_issue_for_booking`.
- Khi → `CANCELLED`: usage APPLIED → CANCELLED.
- Bọc `EXCEPTION WHEN OTHERS`, lỗi ghi vào `PromotionIssueErrors`.

**Mã lỗi apply:**

| Mã | Điều kiện |
|---|---|
| `PROMOTION_NOT_FOUND` | Không tìm thấy pass |
| `PROMOTION_INACTIVE` | Campaign không ACTIVE |
| `PROMOTION_SUSPENDED` | Pass bị tạm khoá |
| `PROMOTION_CANCELLED` | Pass đã huỷ |
| `PROMOTION_NOT_STARTED` | Chưa tới ngày hiệu lực |
| `PROMOTION_EXPIRED` | Đã hết hạn (kiểm theo `now()` ở cả pass lẫn campaign) |
| `ORDER_NOT_FOUND` | Không tìm thấy đơn |
| `ORDER_NOT_ACTIVE` | Đơn không ở NEW / PREPARING / IN_PROGRESS |
| `ORDER_CUSTOMER_MISMATCH` | Đơn không thuộc khách của pass |
| `PROMOTION_ALREADY_APPLIED` | Đơn đã dùng pass này |
| `PROMOTION_USAGE_LIMIT_REACHED` | Hết lượt dùng |
| `BENEFIT_NOT_SUPPORTED` | Loại ưu đãi chưa hỗ trợ (giai đoạn này chỉ FREE_MINUTES) |
| `ORDER_NOT_ELIGIBLE` | Đơn không có guest hoặc item hợp lệ |

Server **không tin** customerId, benefit, duration hay status gửi từ client. `staff_id` lấy từ session.

---

## 5. API (repo này) — contract cho Agent B

Response: `{ success: true, data }` hoặc `{ success: false, error: { code, message } }`. Giờ trả ISO, offset `+07:00`.

| Method | Endpoint | Quyền |
|---|---|---|
| GET / POST | `/api/admin/promotions/campaigns` | `promotions` (quyền mới) |
| GET / PATCH | `/api/admin/promotions/campaigns/[id]` | `promotions` |
| POST | `/api/admin/promotions/campaigns/[id]/status` (`ACTIVATE` / `DEACTIVATE` / `END`) | `promotions` |
| POST | `/api/admin/promotions/passes` (`{campaignId, customerId}`, trùng → 409 `PASS_ALREADY_EXISTS` kèm pass) | `promotions` |
| PATCH | `/api/admin/promotions/passes/[id]` (suspend / cancel / reactivate) | `promotions` |
| GET | `/api/promotion-passes/lookup?t=` hoặc `?code=` | `dispatch_board` |
| GET | `/api/promotion-passes/[id]/active-orders` | `dispatch_board` |
| POST | `/api/promotion-passes/[id]/apply` (`{bookingId}`) | `dispatch_board` |
| POST | `/api/promotion-usages/[id]/cancel` | `dispatch_board` |
| GET | `/api/customers/[id]/promotions` (Active / Past / Usage history) | `dispatch_board` |

**wrb-noi-bo:** repo riêng, dùng chung DB. Có 2 cách tích hợp:
- **Cách khuyến nghị:** wrb-noi-bo gọi **chính các RPC `promo_*`** từ server route của nó, bằng service role nó đang dùng. Không cần thêm API công khai, logic vẫn một nguồn.
- Cách còn lại: gọi API của repo này, nhưng phải thêm cơ chế xác thực chéo app.

Hợp đồng chi tiết sẽ ghi ở `plans/promotion_engine_api_contract.md` khi code xong.

---

## 6. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | KTV nhận item "Khuyến mãi +30 phút" như dịch vụ nối tiếp. Dashboard đọc `segments` sẵn có | Dispatch / Kanban: item 0đ cần điều phối. Admin campaign. CRM | `Services` (+`is_promotion`), `BookingItems`, trigger mới trên `Bookings` | Sửa backend. UI do Agent B làm |
| Số liệu | Tiền tua / giờ cho 30 phút: **có**, chạy qua `KtvCommissionService` như dịch vụ thường | Doanh thu không đổi (item 0đ). Báo cáo dịch vụ có thêm dòng KM giá 0 | `FinanceReportService`, `app/api/finance/reports/services` | Khớp. Cần rà báo cáo theo dịch vụ có lọc `is_promotion` không (chỉ hiển thị) |
| Picker dịch vụ | — | Picker ở `app/reception/dispatch/actions.ts:328` và admin service-menu sẽ thấy `KM0001` | `Services` | **Cần lọc** `is_promotion` khỏi picker, để quầy không thêm tay ngoài engine. Đây là 1 dòng ở dispatch actions (vùng Mức 2, nằm trong plan này) |
| Realtime | Đã subscribe `BookingItems`, nên item KM tự hiện | Như bên KTV | Bảng promo không cần realtime | Đồng bộ |
| Quyền | KTV không gọi được API promo | Quầy cần `dispatch_board`, admin cần `promotions` | RLS bật | Không lộ token hay email |

**Theo mục 13 CLAUDE.md** (thêm item vào đơn là sự kiện nghiệp vụ):
- **Tiền tua:** KTV làm item KM được tính như dịch vụ 30 phút.
- **Giờ tích luỹ:** cộng 30 phút.
- **Lượt tua:** theo luồng add-on hiện tại.
- **Đánh giá:** item KM đi qua FEEDBACK như dịch vụ thường.
- **Huỷ usage:** chỉ được khi item chưa bắt đầu. Sau đó áp dụng quy tắc huỷ dịch vụ có sẵn.

Sẽ đối chiếu `plans/nghiep_vu_tam_dung_doi_huy.md` khi code, rồi cập nhật bảng tra.

---

## 7. Test: `scripts/qa/qa_promotion_engine.ts`

Chạy trên Supabase test (cần chốt môi trường), fixture đúng định dạng DB.

**16 case của prompt**, cộng thêm:
- 90 phút menu thường → không phát
- 60 VIP + 30 thường → không phát
- add-on VIP chưa trả tiền
- đơn DONE nhưng mọi item CANCELLED
- đơn SPLIT
- DONE bị ghi 2 lần
- DONE qua pg_cron `auto_complete_unrated_feedback`
- biên `31/10 23:59:59 +07` và `01/11 00:00:00 +07`
- chạy dưới `TZ=UTC`
- 2 apply đồng thời → đúng 1 thành công
- tạo 2 campaign đồng thời → không trùng `KM000x`
- huỷ usage khi item KM đang làm → bị chặn

---

## 8. File dự kiến

- `supabase/migrations/<ts>_promotion_engine.sql`, `TableInSupabase.md`
- `lib/types/promotion.ts`, `lib/schemas/promotion.schema.ts`, `lib/constants/promotion.ts`, `lib/services/PromotionEngineService.ts`
- Các route ở mục 5, cùng việc khai báo quyền `promotions`
- `app/reception/dispatch/actions.ts`: lọc `is_promotion` ở picker (1 dòng). Admin service-menu: lọc hoặc gắn nhãn
- `scripts/qa/qa_promotion_engine.ts`, `plans/promotion_engine_api_contract.md`
- **Không sửa** dispatch handlers, `KTVDashboard.logic.ts`, `KtvCommissionService`

---

## 9. Còn cần chốt

1. **Nhánh gốc.** Local `main` (927f4070, 17/09) **chậm 411 commit** so với `feat/bit-lo-hong-phase1`. Những thứ plan dựa vào (`lib/auth-server.ts`, cron `auto_complete_unrated_feedback`, `ktv_start_work_atomic`, …) chỉ có trên nhánh đó.
   - Khuyến nghị: tạo `feat/promotion-engine` **từ `feat/bit-lo-hong-phase1`** (hoặc từ nhánh đang chạy production, nếu khác).
   - Worktree hiện đang dựng từ `main`. Mình sẽ dựng lại theo câu trả lời.
2. **Môi trường test DB:** Supabase local, branch hay staging?
3. **wrb-noi-bo** gọi RPC trực tiếp (khuyến nghị) hay gọi API repo này?

---

# v4 — Đáp ứng yêu cầu của Agent B (`.worktrees/promotion-frontend/plans/promotion_frontend_yeu_cau_backend.md`)

> Trạng thái: **ĐÃ TRIỂN KHAI v4** (02/10/2026), theo quyết định v4.9. Đã test trên local và Supabase test. Chưa commit.
> Migration mới: `20261002180000_promotion_engine_v2.sql`. Bản 20261002120000 đã apply lên Supabase test nên không sửa lại, chỉ thêm ALTER.

## v4.1 Voucher dùng chung (U1)

- Bỏ kiểm `ORDER_CUSTOMER_MISMATCH` trong `promo_apply_pass`. Mã lỗi vẫn giữ trong enum để không phá frontend.
- `PromotionUsages.customer_id` = **khách của đơn** (`Bookings.customerId`), cho phép NULL khi đơn chưa gắn khách. Thêm cột `pass_owner_id` để truy vết chủ voucher.
- `max_usage_per_customer` đếm theo **khách của đơn**. Đơn không có khách thì bỏ qua giới hạn này.
- Vẫn giữ nguyên: `max_usage_per_order`, khoá `FOR UPDATE`, partial UNIQUE (pass, booking), `LIMITED`/`usage_limit` (U3).
- ⚠️ **Rủi ro:** voucher `UNLIMITED` mà dùng chung được thì chỉ còn chặn 1 lần mỗi đơn. Một QR bị chia sẻ rộng sẽ dùng được không giới hạn đến hết tháng. User đã chấp nhận. Admin có thể chuyển sang `LIMITED` hoặc `SUSPEND` pass bất cứ lúc nào.

## v4.2 Danh sách đơn mở để áp voucher (U2)

`promo_order_candidates(p_pass_id, p_q)` thay cho `promo_active_orders_for_pass`. Route giữ nguyên `GET /api/promotion-passes/[id]/active-orders?q=`.

- **Phạm vi:** đơn `NEW` / `PREPARING` / `IN_PROGRESS` **của cả spa** trong **ngày làm việc hiện tại**.
  - Ngày làm việc tính theo `SystemConfigs.spa_day_cutoff_hours`, mặc định 7h, cùng định nghĩa với `lib/business-date.ts`. Hàm SQL `promo_business_day_bounds()` đọc cùng key.
  - Mốc thời gian lấy theo `createdAt` (UTC).
- **`q`:** tìm theo `billCode` / tên khách / SĐT / phòng. Tối đa 50 dòng.
- **Thứ tự:** đơn của chủ voucher (`isPassOwnerOrder`) trước, sau đó đến đơn mới nhất.
- **`canApply` + `blockedReasonCode`:** tính bằng **một hàm chung** `promo_check_apply(pass, booking)`. `promo_apply_pass` gọi lại chính hàm này, nên danh sách hiển thị và thao tác apply không lệch nhau.

## v4.3 Khớp đúng shape `lib/types/promotion-client.ts` của B

Adapter của B không map lại response, nên backend trả **đúng shape B dùng**. Nhánh A chưa có ai tiêu thụ response, nên đổi được ngay.

**Campaign:**
- Trường lồng nhau: `benefit {type, value}`, `usage {type, limit, maxPerOrder}`, `qualification {type, value, config}`.
- Thêm `issuedPassCount`, `usageCount`.
- Giữ lại `benefitServiceId` (trường phụ).

**Form campaign:**
- `validFrom` / `validUntil` nhận `yyyy-MM-dd`. Server đổi thành `00:00:00+07` / `23:59:59+07`. Vẫn nhận ISO đầy đủ.
- `description: ""` → NULL.
- **PATCH gửi cả form:** chỉ báo `CAMPAIGN_LOCKED` khi field quy tắc **thực sự đổi giá trị**.

**Pass:**
- `campaign {id, name, campaignCode}`
- `customer {id, name, phone, email}` — chủ voucher, chỉ nhân viên có quyền mới xem được.
- `usage {type, limit, usedCount, maxPerOrder}`, `lastUsedAt`, `statusReason`, `issueSource`, `sourceBookingId`.
- `qrPayload` = URL QR, **chỉ có** ở detail / lookup / issue. Danh sách không trả.
- Thêm `emailStatus`, `emailSentAt`.

**Order candidate:**
- `id`, `displayCode` (đi qua `displayBookingCode` ở lớp TS), `customerName`, `status`.
- `bookingTime` (`timeBooking`), `roomLabel` (`roomName`), `totalAmount`.
- `totalDurationMinutes` (gồm cả item KM), `items[] {id, serviceName, durationMinutes, price, isPromotion}`.
- `isPassOwnerOrder`, `canApply`, `blockedReasonCode`.

**Apply result:** `usageId`, `booking {id, displayCode, items, totalDurationMinutes, totalAmount}` lấy **sau khi** đã thêm item KM, `appliedMinutes`, `pass`.

**Usage record:**
- `id`, `appliedAt`, `status`, `benefit`, `appliedMinutes`, `passId`, `voucherCode`, `campaignName`.
- `customer` (khách của đơn), `booking {id, displayCode}`.
- `staffName`: lấy `Users.fullName`, fallback `Staff.full_name`, cuối cùng là `staff_id`.
- Thêm `discountAmount`.

**Lỗi:**
- `VALIDATION_ERROR` kèm `error.data.field`.
- 401 / 403 / 423 trả `error.code` = `UNAUTHORIZED` / `FORBIDDEN` / `ACCOUNT_LOCKED`.

**Quyền `promotions`:** B đã khai báo trong `lib/constants.ts` / `lib/types.ts`. **A gỡ phần đã thêm** để tránh conflict khi merge; route vẫn kiểm `promotions`.

## v4.4 Endpoint mới (quyền `promotions`)

| Method | Endpoint | Nguồn |
|---|---|---|
| GET | `/api/admin/promotions/overview` | `promo_overview()` → `activeCampaigns`, `passesIssued`, `activePasses` (theo effective status), `usesThisMonth` (tháng VN, usage chưa huỷ) |
| GET | `/api/admin/promotions/passes?q&campaignId&status&expiry&limit&offset` | `promo_list_passes_v2` — `q` tìm tên / SĐT / email / mã voucher; `expiry` = `VALID` / `EXPIRING_7D` / `EXPIRED`; không trả `qrPayload` |
| GET | `/api/admin/promotions/passes/[id]` | Pass + `qrPayload` |
| GET | `/api/admin/promotions/usages?from&to&campaignId&status&q&passId` | `from` / `to` = ngày VN `yyyy-MM-dd`, giới hạn 500 dòng |
| GET | `/api/admin/promotions/customers?q` | `[{id, name, phone, email}]`, q ≥ 2 ký tự, tối đa 20 dòng, query nhẹ trên `Customers` |
| POST | `/api/admin/promotions/passes/[id]/send-email` | **Gửi lại** e-voucher, chỉ tới email của chủ voucher (không nhận địa chỉ từ body) |

## v4.5 Gửi e-voucher qua email (U4)

- **Outbox trên pass:** thêm `email_status` (`PENDING` / `SENT` / `FAILED` / `SKIPPED`), `email_to`, `email_attempts`, `email_last_error`, `email_sent_at`.
  - Khi phát pass: khách có email → `PENDING`, không có → `SKIPPED`.
- **Phát tay:** route gửi ngay sau RPC. Gửi lỗi thì pass vẫn tạo xong, response có `emailStatus`.
- **Phát tự động** (trigger SQL không gửi được mail): Vercel cron `/api/cron/promotion-emails`, chạy mỗi 5 phút, xác thực `CRON_SECRET`.
  - Cron gọi `promo_claim_email_batch(20)` (`FOR UPDATE SKIP LOCKED`) nên 2 lần chạy chồng nhau không gửi trùng.
  - Tối đa 5 lần thử, sau đó → `FAILED`.
- **Template** `lib/promotion-email.ts`:
  - Dùng thương hiệu sẵn có (`getEmailConfig()`: logo, hotline, địa chỉ), song ngữ VI + EN trong một email.
  - Nội dung: tên chương trình, ưu đãi, mã voucher, hạn dùng, cách dùng ("đưa QR cho quầy quét").
  - **Ảnh QR tạo ngay trên server:** `qrcode.react` (SVG) chuyển sang PNG bằng `sharp`, cả hai đã có trong dependency. Ảnh đính kèm dạng `cid`, nên **token không đi qua dịch vụ QR bên thứ ba** (như api.qrserver.com).
- **Công tắc:** `SystemConfigs.enable_promotion_email` (mặc định bật), tách riêng khỏi công tắc email xác nhận đặt lịch.

## v4.6 Đợt 2 — Web Booking History (U5)

- Thêm RPC `promo_public_vouchers_by_email(p_email)` ngay trong migration v2.
  - Trả voucher **ACTIVE / NOT_STARTED** (kèm `qrPayload`) và voucher đã hết, của mọi `Customers` có `lower(email)` khớp.
  - Không trả SĐT, `staff_id`, lịch sử đơn.
- Repo `NganHa-WebBooking` gọi RPC này từ **server route** bằng service role. Route đó do Đợt 2 làm, kèm rate limit theo IP.
- Repo này không mở API công khai.
- Cần xác nhận NganHa-WebBooking dùng **cùng project Supabase** (câu hỏi 3).

## v4.7 Ảnh hưởng chéo (bổ sung)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Danh sách đơn mở | Không ảnh hưởng — KTV không gọi API promo | Quầy thấy đơn của cả spa trong ngày (tên khách, phòng, tổng tiền) | `promo_order_candidates` | Chỉ cho quyền `dispatch_board` |
| Usage theo khách của đơn | Không ảnh hưởng | Lịch sử khuyến mãi của khách tính theo đơn họ dùng | `PromotionUsages.customer_id` | Đổi nghĩa so với v3 |
| Email | Không ảnh hưởng | Khách nhận email, admin xem `emailStatus` và gửi lại được | Cron mới, SMTP sẵn có | Cần thêm `PROMOTION_SCAN_BASE_URL` |

## v4.8 Test bổ sung (`qa_promotion_engine.ts`)

- Voucher của A áp cho đơn của B: thành công, usage ghi `customer_id` = B.
- Đơn chưa gắn khách: thành công.
- `canApply` của danh sách luôn khớp kết quả apply thật. Mỗi `blockedReasonCode` có một case.
- Biên ngày làm việc (06:59 / 07:00 VN), có chạy dưới `TZ=UTC`.
- PATCH cả form khi campaign ACTIVE mà không đổi quy tắc: OK.
- Overview / list / usages / customers trả đúng filter.
- Email: claim batch đồng thời không trùng; email lỗi → retry → `FAILED`; khách không có email → `SKIPPED`. SMTP được mock ở test.
- Cập nhật `promotion_engine_api_contract.md` theo shape mới.

## v4.9 Quyết định của user (02/10/2026, sau v4) — ĐÃ DUYỆT

| # | Quyết định | Cách làm |
|---|---|---|
| D1 | Voucher dùng chung, nhưng phải biết chủ voucher | Theo v4.1: `PromotionUsages.customer_id` = khách của đơn, thêm `pass_owner_id` |
| D2 | Đơn được liệt kê: đơn mới (NEW), đơn đã điều phối (PREPARING), và đơn đang làm (IN_PROGRESS). Đơn menu VIP / Deep Body vào thẳng trạng thái đang làm | `promo_order_candidates` lấy NEW / PREPARING / IN_PROGRESS trong ngày làm việc |
| D3 | Admin chọn **hồ sơ khách** để phát; email lấy từ hồ sơ đó. Voucher hiện ở History của email đó và được gửi qua email | Phát tay → gửi email ngay. History tra bằng `promo_public_vouchers_by_email` |
| D4 | **Hiện chưa phát tự động**, nhưng vẫn để sẵn cấu hình, mặc định tắt | `SystemConfigs.promotion_auto_issue_enabled = false`. Trigger chỉ phát khi công tắc bật **và** campaign là `AUTO` |
| D5 | Template email có **5 ngôn ngữ**, gửi theo ngôn ngữ trong hồ sơ khách | Ngôn ngữ = `customerLang` xuất hiện nhiều nhất trong các đơn của khách — cùng quy tắc với `preferredLangCode` ở `app/api/customers/route.ts`. Map `vn`→`vi`. Mặc định `vi` |
| D6 | Kiểu hiệu lực: **theo lượt / theo ngày / theo tháng** | Theo lượt = `usage_type LIMITED` + `usage_limit`. Theo ngày = `validity_type DAYS_FROM_ISSUE` + `validity_days`: hết hạn cuối ngày VN thứ N kể từ ngày phát, không quá ngày kết thúc campaign. Theo tháng = `validity_type CAMPAIGN_PERIOD` với khoảng ngày của campaign |
| D7 | QR trong email là QR in trên e-voucher, để quầy quét | `qrPayload` = `${PROMOTION_SCAN_BASE_URL \|\| APP_URL}/admin/promotions/scan?t=<token>` |
| D8 | Nhắc trước khi hết hạn: có, trước **3 ngày** | `SystemConfigs.promotion_expiry_reminder_days = 3`. Cron gửi 1 lần cho pass còn ACTIVE |
| D9 | Web Booking dùng chung project Supabase | Gọi RPC bằng service role, không mở API công khai |

## v4.10 Ghi chú triển khai

- **Tạo ảnh QR:** dùng package `qrcode` (MIT), thêm vào `package.json`. Cách render `qrcode.react` qua `react-dom/server` bị Next chặn trong route handler.
- **`npm install`** ở worktree tự gộp key `server-only` đang bị trùng trong `package.json` (B cũng ra kết quả này).
- **Lỗi `ORDER_CUSTOMER_MISMATCH`** không còn trả về. Kiểm tra `canApply` và kiểm tra lúc apply dùng chung `promo_check_apply`.
- **Test:** `qa_promotion_engine.ts` (119 case) và `qa_promotion_email.ts` (23 case). Smoke HTTP 22 case trên Supabase test.

---

# v5 — Menu áp dụng dynamic + trang e-voucher công khai (user chốt 02/10/2026) — ĐÃ TRIỂN KHAI

| # | Quyết định | Cách làm |
|---|---|---|
| E1 | Admin tạo e-voucher và **chọn menu / category động**, không hard-code | Đọc từ `promo_menu_catalog()` + `GET /api/admin/promotions/menus`. Menu = prefix mã dịch vụ. Tên menu lấy từ `SystemConfigs.promotion_menu_labels`. Campaign lưu `applicableMenus` vào `qualification_config` |
| E2 | Deep Body = `NHT` | Seed nhãn `NHT` = "Menu Deep Body" (sửa được trong SystemConfigs) |
| E3 | Một lựa chọn menu dùng cho cả điều kiện phát, áp voucher và giảm % | Dùng `promo_service_in_scope` ở cả 3 chỗ; đơn không thuộc phạm vi bị chặn với mã mới `ORDER_MENU_NOT_ELIGIBLE` |
| E4 | QR là một phần của **e-voucher 3D**, không gửi QR rời | QR trỏ `/voucher?t=`: nhân viên → trang quét; khách → `VoucherCard3D` + "Vui lòng liên hệ Oria Spa để áp dụng" (5 ngôn ngữ). Email là thẻ e-voucher tĩnh có QR ở cuống vé + nút "Xem E-Voucher" |
| E5 | B làm giao diện trang `/voucher` | A cấp `resolveVoucherView()` (`lib/promotion-voucher-view.ts`), `sessionHasPermission()` (`lib/auth-server.ts`), chữ `lib/promotion-voucher.i18n.ts` |

**Khác so với v2:** `qualification_config` trước đây khớp theo prefix **HOẶC** category. Từ v3 là: dịch vụ chọn lẻ, **hoặc** (menu **VÀ** category, nếu có lọc category).

**Test:** `qa_promotion_engine.ts` 134 case (local + Supabase test, cả `TZ=UTC`); `qa_promotion_email.ts` 26 case; smoke HTTP v3 6 case.

---

## v10 (04/10/2026): bỏ `PromotionIssueErrors`, giữ 3 bảng (user chốt)

- Lý do giữ 3 bảng `PromotionCampaigns` / `CustomerPromotionPasses` / `PromotionUsages`: quan hệ 1 → nhiều → nhiều, và các ràng buộc UNIQUE chống trùng voucher / lượt áp nằm trên chúng.
- Lỗi của trigger chuyển sang `RAISE WARNING`, xem ở Postgres logs. Trigger vẫn không chặn việc chốt đơn.
