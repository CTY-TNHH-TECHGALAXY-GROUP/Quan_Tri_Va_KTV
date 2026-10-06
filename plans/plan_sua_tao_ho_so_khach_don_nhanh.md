# Plan — Sửa tạo hồ sơ khách ở "Thêm đơn nhanh" & gom cờ VAT về một nguồn

- **Mức**: 2 (chạm `lib/services/BookingModificationService.ts` dùng chung, ghi dữ liệu thật ở bước backfill).
- **Ngày**: 2026-10-06. **Trạng thái**: Bước 1–4b, 6 **đã code** (06/10), QA `scripts/qa/qa_20_quick_booking_customer.ts` đạt 7/7 ca ở local TZ và `TZ=UTC`. Bước 5 đã dry-run (15 nhóm: 3 LINK_GUEST, 1 LINK, 1 MANUAL, 9 CREATE, 1 AMBIGUOUS). **User chốt 06/10: chỉ gắn đơn Danny** `NDK-002-06102026` → `CUS-1791272255378-197` (đã ghi, file lùi `scripts/backfill_output/link_danny_1791284414316.json`). Các nhóm CREATE (dữ liệu test, `aa@gmail.com`) không cần; nhóm `concarne1996@gmail.com` không đụng. Script `backfill_quick_booking_customers.ts` giữ lại ở chế độ dry-run để tham khảo, không `--apply`.
- **File mới**: `lib/services/CustomerVatService.ts`, `lib/services/QuickBookingCustomerService.ts`, `app/api/reception/tax-lookup/route.ts`, `app/reception/dispatch/_components/AddOrderModal.i18n.ts`, `scripts/qa/qa_20_quick_booking_customer.ts`, `scripts/backfill_quick_booking_customers.ts`.
- **Nhánh**: `feat/bit-lo-hong-phase1`.

---

## 1. Nguyên nhân gốc

| # | Vấn đề | Bằng chứng |
|---|---|---|
| 1 | `BookingModificationService.createQuickBooking` INSERT `Customers` kèm cột `vatRequested`, nhưng bảng `Customers` **không có cột này** (chỉ `Bookings` có, migration `20260821164210`). PostgREST trả lỗi, code nuốt lỗi ("non-blocking") → `customerId = null`. | Hồ sơ cuối cùng do luồng này tạo: 21/08 16:30. Commit `62514cc8` (22/08) thêm `vatRequested`. Từ 22/08: 15 đơn cha `NDK-*` không huỷ thiếu `customerId`. |
| 2 | `AddOrderModal.handleSelectCustomer` chỉ copy tên + SĐT, **không truyền `customerId`**. Nếu SĐT là `GUEST-…` (hồ sơ do WRB/WebBooking sinh), service bỏ qua khớp → cố tạo mới → đổ theo #1. | Đơn `NDK-002-06102026` (Danny), `NDK-001-04102026` (Cho daeun), `NDK-001-22092026` (Hsiu Hau). |
| 3 | Nút "Hồ sơ" (i) trên Dispatch coi `GUEST-…` là SĐT thật: `phoneIdentity('GUEST-1791272255378')` → `1791272255378` → tìm không ra → báo "Không tìm thấy hồ sơ" (sai thông điệp, đúng ra là "đơn chưa liên kết khách"). | `app/reception/dispatch/page.tsx:3098-3129`. |
| 4 | Hai cách thể hiện "khách cần VAT": WRB dùng `Customers.taxCode` + 5 cột công ty (đang chạy, admin đọc được); admin dùng cờ `vatRequested` có/không (chưa chạy). Vi phạm rule 4.2 (một nguồn). | WRB `src/lib/bookingCustomer.ts:56-61`; admin `getDispatchData` `hasVat = !!taxCode`; `CustomerDetailModal` hiện VAT theo `taxCode`. |

## 2. Hướng đã chốt (user OK 06/10)

Không thêm cột `vatRequested` vào `Customers`. Form Thêm đơn đi theo cơ chế sẵn có; cờ "đơn này cần VAT" ghi vào `Bookings.vatRequested` (cột có thật).

## 3. Các bước

### Bước 1 — `lib/services/BookingModificationService.ts` (lõi, dùng chung)
1. Bỏ `vatRequested` khỏi payload INSERT `Customers`.
2. Thêm tham số `customerId?: string | null` vào `createQuickBooking`. Nếu có → `select id` xác nhận tồn tại → dùng thẳng, **bỏ qua** nhánh tìm/tạo. Không tồn tại → rơi về luồng cũ.
3. Khi `phone` bắt đầu bằng `GUEST-` và không có `customerId`: tìm `Customers.phone = phone` (exact) trước khi tạo mới, tránh tạo trùng với hồ sơ WRB/WebBooking đã có.
4. Ghi `vatRequested: data.vatRequested || false` vào INSERT `Bookings`.
5. Lỗi tạo `Customers` **không nuốt im lặng nữa**: vẫn không chặn tạo đơn, nhưng trả `warning: 'CUSTOMER_NOT_CREATED'` trong kết quả để UI báo quầy.

### Bước 2 — `app/reception/dispatch/_components/AddOrderModal.tsx` + `page.tsx` + `actions.ts`
1. State `selectedCustomerId`; `handleSelectCustomer` set id; gõ tay vào ô tên/liên hệ → reset `null`.
2. `onConfirm` truyền thêm `customerId`. Chữ ký `createQuickBooking` ở `actions.ts` và `handleCreateQuickBooking` ở `page.tsx` nhận thêm trường.
3. Có `warning` → `alert` chữ từ `DispatchConfirm.i18n.ts`: "Đã tạo đơn nhưng chưa tạo được hồ sơ khách. Kiểm tra trang Khách Hàng."

### Bước 3 — Nhãn VAT trên Kanban: `app/reception/dispatch/actions.ts` (`getDispatchData`)
1. Thêm `vatRequested` vào select `Bookings` (dòng ~282).
2. `hasVat: !!taxCodeMap[b.customerId] || !!b.vatRequested`.
Không đổi UI Kanban (`order.hasVat` giữ nguyên).

### Bước 4 — Nút "Hồ sơ" ở `app/reception/dispatch/page.tsx` (~3098)
1. SĐT bắt đầu bằng `GUEST-` → **không** đưa qua `phoneIdentity`; dùng chuỗi nguyên bản làm `q` và so khớp exact với `c.phone`. **Hồ sơ chỉ có SĐT `GUEST-…` (không có SĐT thật) vẫn được chấp nhận và mở bình thường** (user chốt 06/10).
2. Không `customerId`, không liên hệ thật, không `GUEST-` → thông điệp mới: "Đơn chưa liên kết hồ sơ khách. Mở trang Khách Hàng để tạo hoặc gán." (đưa vào `DispatchConfirm.i18n.ts`).

### Bước 4b — Mở rộng "Yêu cầu VAT" ở Thêm đơn giống WRB (user chốt 06/10)
Thay checkbox có/không bằng khối nhập hoá đơn công ty, cùng dữ liệu với WRB `VatInvoiceSection`:
1. **UI** `AddOrderModal.tsx`: bật "Xuất hoá đơn VAT" → hiện ô **Mã số thuế** + nút "Tra cứu", kết quả tự điền **Tên công ty**, **Địa chỉ** (cho sửa tay), thêm **Email nhận hoá đơn**, **SĐT công ty** (tuỳ chọn). Chữ vào `AddOrderModal.i18n.ts` (file mới).
2. **API tra cứu** `app/api/reception/tax-lookup/route.ts` (mới, admin chưa có): port từ WRB `src/app/api/tax-lookup/route.ts` — gọi VietQR `api.vietqr.io/v2/business`, dự phòng `esgoo.net/api-mst`; chỉ cho quyền `dispatch_board`; không có env mới.
3. **Service**: `createQuickBooking` nhận `vatInvoice?: { taxCode, companyName, companyAddress, companyEmail?, companyPhone? }`. Có `taxCode` → ghi 5 cột vào `Customers` (tạo mới hoặc **cập nhật hồ sơ cũ** khi có `customerId`/khớp), đúng như WRB `saveBookingCustomer`; đồng thời `Bookings.vatRequested = true`. Không có `taxCode` nhưng quầy bật VAT → chỉ `Bookings.vatRequested = true` (khách hứa đưa MST sau).
4. **Nhãn VAT Kanban** vẫn theo Bước 3 (`taxCode` hoặc `vatRequested`). CRM `CustomerDetailModal` đã hiển thị đủ 5 cột, không sửa.
5. **Một nguồn** (rule 4.2): hàm chuẩn hoá `vatInvoice` → 5 cột `Customers` đặt ở `lib/services/CustomerVatService.ts` (mới) để sau này CRM cho sửa VAT dùng lại; WRB là repo khác nên không gom được, ghi chú đối chiếu trong file.

### Bước 5 — Backfill dữ liệu (ghi DB thật, cần OK riêng trước khi chạy)
Script `scripts/qa/backfill_quick_booking_customers.ts`, chạy `--dry-run` in bảng trước:
- 15 đơn cha `NDK-*` (không huỷ) từ 22/08 thiếu `customerId`, kèm đơn con `parent_booking_id` của chúng (tổng 20 dòng):
  - **6 đơn** có SĐT/email thật → tìm `Customers` khớp exact; có → gán; không → tạo `CUS-<ts>-<n>` theo đúng format service.
  - **4 đơn** SĐT `GUEST-…` → khớp `Customers.phone` exact; không khớp (Danny đã đổi SĐT) → gán tay theo bảng đối chiếu in ra (Danny → `CUS-1791272255378-197`).
  - **5 đơn** không liên hệ → tạo hồ sơ mới `GUEST-<ts>` như service làm cho khách vãng lai.
- Chỉ `update customerId`; không đụng `customerPhone/Email`.

**Phạm vi ảnh hưởng của bước 5** (những nơi đọc `Bookings.customerId`, đã grep):
| Nơi | Thay đổi sau backfill | Đánh giá |
|---|---|---|
| CRM `/api/customers` (lượt ghé, tổng chi, KTV quen, ngôn ngữ) | 15 khách có thêm lịch sử đúng; 5 khách vãng lai mới xuất hiện trong danh sách | Mong muốn |
| Dispatch "khách quen" (`getDispatchData` đếm theo `customerId`) | Lần ghé sau của các khách này được nhận diện | Mong muốn |
| Báo cáo tài chính theo khách `/api/finance/reports/customers` (bỏ qua đơn không `customerId`) | Doanh thu 15 đơn được cộng vào đúng khách; **tổng doanh thu không đổi** (báo cáo tổng không lọc theo `customerId`) | Chấp nhận, báo kế toán |
| Khuyến mãi (`promo_*` RPC so `b."customerId" = owner`) | Chỉ ảnh hưởng thứ tự ưu tiên đơn khi quét voucher; không tự phát hành/áp dụng gì | Không đáng kể |
| Export khách hàng, upload avatar, identify | Đọc theo khách, không tính toán | Không ảnh hưởng |
| Phía KTV, tua, giờ, ví | Không đọc `customerId` | Không ảnh hưởng |

### Bước 6 — Tài liệu
- `TableInSupabase.md`: ghi chú `Bookings.vatRequested` được ghi bởi tạo đơn nhanh; `Customers` **không có** cột này (tránh tái phát).

## 4. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — `app/ktv/*`, `app/api/ktv/*` không đọc `customerId`, `hasVat`, `vatRequested`, `taxCode` (đã grep). | Dispatch (AddOrderModal, Kanban nhãn VAT, nút Hồ sơ), CRM (hồ sơ mới xuất hiện trở lại). | `BookingModificationService.createQuickBooking`; cột `Bookings.vatRequested`; RPC `split_booking_into_sub_bookings` đã copy `vatRequested` xuống đơn con. | Sửa phía Quản lý + service. |
| Số liệu hiển thị | Không có số liệu tiền/tua/giờ liên quan. | Nhãn VAT: `taxCode` **hoặc** `Bookings.vatRequested`. Lượt ghé/khách quen ở Dispatch & CRM sẽ đúng trở lại khi có `customerId`. | Công thức `hasVat` ở một chỗ (`getDispatchData`). | Khớp. |
| Realtime / refresh | Không ảnh hưởng. | Dispatch đã `fetchData()` sau tạo đơn; không cần subscribe thêm. | `Bookings` | Đồng bộ. |
| Quyền xem | KTV không thấy thông tin VAT/công ty. | Quầy thấy nhãn VAT như hiện tại. | | Không lộ dữ liệu nội bộ. |
| App khác (WRB, WebBooking) | — | Không sửa. WRB không đọc `Bookings.vatRequested` (đã grep). Hồ sơ `GUEST-…` do WRB/WebBooking tạo nay được admin **tái dùng** thay vì tạo trùng. | `Customers` | Không ảnh hưởng, có lợi. |

## 5. Test / mô phỏng (mục 10)

Mock Supabase in-memory, in bảng kết quả cho 5 ca:
1. Khách mới, không liên hệ → tạo `Customers` thành công, `customerId` khác null, `Bookings.vatRequested` theo checkbox.
2. Chọn khách cũ có SĐT `GUEST-…` (truyền `customerId`) → dùng đúng id, không INSERT `Customers`.
3. Gõ tay SĐT `GUEST-…` trùng hồ sơ có sẵn (không `customerId`) → khớp exact, không tạo trùng.
4. INSERT `Customers` lỗi giả lập → đơn vẫn tạo, kết quả có `warning`.
5. Nút Hồ sơ với `GUEST-…` → tìm exact ra hồ sơ; không có → thông điệp "chưa liên kết".
Chạy thêm dưới `TZ=UTC` (bookingDate dùng `Asia/Ho_Chi_Minh`, không đổi).

## 6. Rủi ro & cách lùi
- Bước 1–4: revert commit, không có migration.
- Bước 5: script ghi `customerId`; lưu file JSON `before/after` để lùi bằng update ngược.
- Deploy: nhánh phase1 đang là bản người dùng chạy → lên ngay khi merge; không cần migration/cấu hình.
