# Plan — Lọc hồ sơ khách và phát e-voucher hàng loạt (Agent A)

> Mức 2: RPC mới, đọc dữ liệu khách có SĐT/email, ghi pass hàng loạt, gửi email.
> Trạng thái: **ĐÃ TRIỂN KHAI** (03/10/2026), migration `20261003090500_promotion_engine_v4.sql`. Đã test trên local và Supabase test. Chưa commit.
> Ngày: 02/10/2026. Nhánh: `feat/promotion-engine`.
> Đầu vào: yêu cầu số 4 của B. Contract phía B: `lib/types/promotion-client.ts` (`CustomerCandidateFilter`, `CustomerCandidate`, `CustomerCandidatePage`, `BulkIssueItem`, `BulkIssueResult`), `lib/services/promotionApi.ts` (`getCustomerCandidates`, `bulkIssue`, `BULK_ISSUE_MAX = 50`).

## 1. Kết quả kiểm tra yêu cầu của B

| # | Điểm | Thực tế trong code | Kết luận |
|---|---|---|---|
| K1 | "Lượt ghé chỉ đếm đơn đã hoàn tất" (`minVisitsHint`) | CRM (`app/api/customers/route.ts:54`, `:146`): `visitCount` = đơn cha **không huỷ**, nên vẫn đếm đơn đang mở NEW / PREPARING / IN_PROGRESS. *(Bản đầu của plan ghi CRM đếm cả đơn huỷ — sai, đã sửa sau smoke 03/10)* | Lệch CRM **chỉ với khách đang có đơn mở**. User chốt: chỉ đếm đơn hoàn tất |
| K2 | `tier` NEW / RETURNING / VIP | Chưa có định nghĩa chung. VIP = `visitCount > 10`, viết cứng 3 lần trong `app/reception/crm/page.tsx` (231, 687, 876). "Khách cũ" = `visitCount > 1` ở page.tsx, nhưng `isReturningCustomer` trong `lib/customer.logic.ts` lại là `> 0` | ⚠️ **Công thức đang lặp và tự lệch nhau ngay trong CRM.** Đề xuất gom về một chỗ (mục 3.1). Câu 2 |
| K3 | "Hàm `promo_paid_qualifying_minutes` dùng chung" | Không có hàm tên này. Hàm thật là `promo_order_minutes` và `promo_evaluate_booking_for_campaign` | Chỉ sai tên. Plan dùng hàm thật, vẫn một nguồn công thức |
| K4 | Phát 50 khách và gửi email ngay trong một request | Gửi SMTP tuần tự 1–2 giây/email, 50 email có thể vượt timeout của route Vercel | ⚠️ Đổi cách gửi (mục 3.3). Response thêm `emailQueued` |
| K5 | `onlyQualified` + khoảng ngày | Phải đánh giá từng đơn trong khoảng, nặng nếu khoảng dài | Bắt buộc có khoảng ngày, tối đa 93 ngày |
| K6 | Bỏ "Tự động" khỏi form | Khớp quyết định D4 (công tắc tự phát đang tắt). Backend vẫn giữ `AUTO` | OK, không đổi backend |
| K7 | Quyền: chỉ `promotions` | Danh sách có SĐT và email | OK. Không log PII, giới hạn số dòng mỗi trang |

### 🐞 Lỗi phát hiện thêm trong phần A đã làm (sẽ sửa cùng đợt)

- Khách vãng lai được hệ thống gán email ảo `guest…@guest.com` (`makeGuestEmail`, `lib/customer.logic.ts`).
- `promo_insert_pass` và `promo_claim_pass_email` hiện coi mọi email không rỗng là email thật, nên **sẽ gửi e-voucher tới địa chỉ ảo**.
- Cách sửa: thêm hàm SQL `promo_real_email(email)` theo đúng quy tắc của `isDummyEmail` (rỗng, không có `@`, hoặc đuôi `@guest.com` → không phải email thật). Dùng hàm này cho cả bộ lọc `hasEmail` lẫn khi gửi.

## 2. API (đúng contract B đã viết)

### 2.1 `GET /api/admin/promotions/campaigns/:id/customer-candidates`

- Quyền: `promotions`.
- Tham số query: `q`, `onlyQualified`, `qualifiedFrom` / `qualifiedTo`, `visitFrom` / `visitTo`, `minVisits`, `minSpent`, `tier`, `vipMenu` (`USED` / `NOT_USED`), `guestType` (`SINGLE` / `GROUP`), `gender`, `nationality`, `language`, `hasEmail` (mặc định `1`), `limit` (≤ 50), `offset`.
- Response: `{ items: CustomerCandidate[], total, limit, offset, excludedNoEmail, nationalities[] }`.
  - Mỗi item có thêm `alreadyHasPass` (đã có voucher của campaign này), để UI làm mờ.
  - `excludedNoEmail` = số khách khớp mọi điều kiện khác nhưng không có email thật.

### 2.2 `POST /api/admin/promotions/passes/bulk`

- Body: `{ campaignId, customerIds[] }`, tối đa 50, server tự bỏ id trùng.
- Response: `{ results: BulkIssueItem[], summary: { issued, alreadyExists, failed, emailSent, emailFailed, emailSkipped, emailQueued } }`.
- `emailQueued` là field **mới** (mục 3.3).
- Campaign không ACTIVE hoặc đã hết hạn → lỗi cho cả request. Khách không tồn tại → item `FAILED` / `CUSTOMER_NOT_FOUND`.

## 3. Thiết kế

### 3.1 Một nguồn cho chỉ số khách: `promo_customer_stats` (view SQL)

Mỗi khách một dòng, tính trên đơn của khách:

- **Cách ghép đơn với khách:** `customerId`, hoặc (đơn chưa có `customerId` + cùng tên + cùng email thật). Giống `app/api/customers/route.ts:100-140`.
- **Các chỉ số:**
  - `visit_count` (theo câu 1)
  - `completed_count`
  - `total_spent`: đơn COMPLETED / DONE / FEEDBACK / CLEANING, giống CRM
  - `last_visit_at`: `bookingDate` của đơn mới nhất, giống CRM
  - `vip_menu_count`: `source` có chữ VIP, giống CRM
  - `guest_type`: `max(guestCount) > 1` thì là GROUP, giống CRM
  - `nationality`: lấy từ hồ sơ, không có thì lấy từ đơn mới nhất
  - `language`: `promo_customer_language`
  - `real_email`
- **Hạng khách:** NEW / RETURNING / VIP tính theo ngưỡng ở `SystemConfigs.customer_tier_thresholds`, ví dụ `{"returningMinVisits":2,"vipMinVisits":11}`. Không viết cứng.
- ⚠️ Theo mục 4.2, CRM hiện tự tính các số này trong TS. Plan này **không** sửa CRM, vì nằm ngoài phạm vi. Thay vào đó:
  - Test so khớp từng chỉ số với kết quả `GET /api/customers` cho cùng khách.
  - Báo user để làm một task riêng: chuyển CRM sang dùng `promo_customer_stats`, và bỏ ngưỡng 10 / 1 đang viết cứng trong `crm/page.tsx`.

### 3.2 `promo_customer_candidates(p_campaign_id, p_filter jsonb, p_limit, p_offset)`

- Lọc set-based trên `promo_customer_stats`.
- **`onlyQualified`:** khách có ít nhất 1 đơn DONE trong `[qualifiedFrom, qualifiedTo]` (ngày VN, ≤ 93 ngày) mà `promo_evaluate_booking_for_campaign(...).eligible` = true. Dùng **đúng** hàm của engine, nên đồng bộ với phạm vi menu và ngưỡng phút.
  - Riêng campaign `MANUAL_ASSIGNMENT` không có điều kiện, nên `onlyQualified` bị bỏ qua và response trả cờ `qualificationIgnored`.
- Trả `total` và `excludedNoEmail` trong cùng một lần chạy.

### 3.3 Phát hàng loạt: `promo_issue_bulk(p_campaign_id, p_customer_ids text[], p_staff_id)`

- Mỗi khách đi qua `promo_insert_pass` (idempotent, khoá UNIQUE). Một khách lỗi thì khách đó `FAILED`, các khách khác không bị ảnh hưởng (savepoint riêng cho từng khách).
- **Email:**
  - Route gửi ngay với tối đa 5 email song song, trong **ngân sách 40 giây** (`maxDuration = 60`).
  - Email chưa kịp gửi giữ trạng thái `PENDING`, cron `/api/cron/promotion-emails` (5 phút) gửi tiếp.
  - Khi đó item trả `emailDelivery: { status: 'QUEUED' }` và được đếm vào `emailQueued`.
  - Kết quả: không mất email, không timeout, và không gửi trùng (đã có cơ chế `promo_claim_*` SKIP LOCKED).
- **Ghi log:** dùng `PromotionUsages`? Không. `issued_by` + `issue_source = 'MANUAL'` + `issued_at` trên pass là đủ truy vết.

## 4. Câu hỏi cần chốt

1. **"Lượt ghé" tính thế nào?**
   - **Khuyến nghị:** chỉ đếm đơn cha đã hoàn tất (COMPLETED / DONE / FEEDBACK / CLEANING), đúng như B ghi.
   - Khi đó CRM hiện **đếm cả đơn huỷ / đơn mới**, nên số trên CRM sẽ cao hơn bộ lọc voucher cho tới khi CRM được sửa theo cùng hàm (task riêng).
   - Cách còn lại: theo đúng CRM hiện tại (đếm mọi đơn cha), hai màn khớp ngay nhưng khách huỷ đơn vẫn được tính là đã ghé.
2. **Ngưỡng hạng khách:**
   - Mặc định khớp CRM đang hiển thị: Khách cũ ≥ 2 lượt, VIP ≥ 11 lượt (`> 10`).
   - Ngưỡng lưu ở `SystemConfigs`, chỉnh được.
   - Đồng ý không, hay bạn muốn ngưỡng khác?
3. **Phát hàng loạt mà email chưa gửi kịp thì để cron gửi tiếp** (`emailQueued`), đúng không? B cần hiện thêm dòng "đang chờ gửi N".

## 5. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — KTV không gọi API promo | Trang chi tiết chương trình: bảng lọc khách + phát hàng loạt (B) | `promo_customer_stats`, `promo_customer_candidates`, `promo_issue_bulk` | A thêm RPC + 2 route |
| Số liệu | Phút tặng tính tua khi **áp vào đơn**, không tính lúc phát | Lượt ghé / chi tiêu / hạng tính ở server | `promo_customer_stats` (mới), `promo_evaluate_booking_for_campaign` (engine) | ⚠️ Lượt ghé có thể lệch CRM, theo câu 1 |
| Realtime | Không ảnh hưởng | Không cần, bấm lọc thì tải lại | — | — |
| Quyền | KTV không thấy | Chỉ quyền `promotions` | RPC chỉ `service_role` | Có SĐT / email, chỉ admin xem |

## 6. Test (mở rộng `qa_promotion_engine.ts`)

- Từng bộ lọc riêng và kết hợp.
- `excludedNoEmail` đếm đúng email rỗng **và** `@guest.com`.
- `onlyQualified` khớp `promo_evaluate_booking_for_campaign`.
- So khớp `promo_customer_stats` với `GET /api/customers`: spend, guestType, vipMenu, lastVisit; visitCount theo câu 1.
- Phát hàng loạt: trùng id, khách đã có voucher, khách không tồn tại, 2 request chạy đồng thời không tạo trùng, ngân sách email hết thì còn lại QUEUED.
- Chạy thêm dưới `TZ=UTC`, trên local và Supabase test.

## 7. Quyết định (user, 03/10/2026) và kết quả

| # | Quyết định | Cách làm |
|---|---|---|
| Q1 | Lượt ghé chỉ đếm đơn **đã hoàn tất** | `promo_customer_stats.visit_count` = đơn cha có trạng thái COMPLETED / DONE / FEEDBACK / CLEANING |
| Q2 | Khách cũ ≥ 2 lượt. **Không có hạng VIP**; dùng tag "đã dùng menu VIP" | `tier` chỉ có `NEW` / `RETURNING`, ngưỡng ở `SystemConfigs.customer_returning_min_visits = 2`. Gửi `tier=VIP` → 400. Tag dùng `vipMenuUsed` / bộ lọc `vipMenu` |
| Q3 | Phát hàng loạt = admin tick nhiều hồ sơ rồi phát. Email chưa kịp gửi để cron gửi tiếp | `promo_issue_bulk`, `PromotionEmailService.sendMany` (5 luồng, ngân sách 40 giây), `emailQueued` |

**Chênh lệch còn lại so với CRM** (đã báo user, CRM sẽ sửa ở task riêng):
- Lượt ghé, tag menu VIP, lần ghé gần nhất: bộ lọc voucher chỉ tính đơn đã hoàn tất. CRM tính mọi đơn không huỷ.
- Chi tiêu và kiểu khách lẻ / nhóm: **khớp** CRM (đã đối chiếu bằng smoke HTTP).

**Test:** `qa_promotion_engine.ts` 153 case (local + Supabase test, cả `TZ=UTC`). Smoke HTTP 10 case, có đối chiếu với `GET /api/customers`.
