# Plan (Mức 2 — auth/middleware) — Trang hoá đơn `/invoice/[id]` cho khách không cần đăng nhập

Repo: `Quan_Tri_Va_KTV`, nhánh `feat/bit-lo-hong-phase1`. Ngày lập: 04/10/2026. Trạng thái: **đã duyệt 04/10, đã code, đã test local (mục 5: 1–3, 5, 6 pass), chờ commit**. Bổ sung khi code: whitelist cả trường của `items` (không trả `technicianCodes`, ảnh bàn giao, `ktvRatings`, `itemFeedback`). Script kiểm cột: `scripts/check_invoice_columns.cjs`.

## 1. Hiện trạng và nguyên nhân gốc rễ

Trang `app/invoice/[id]/page.tsx` là trang **khách** xem/in hoá đơn: quầy bấm "Hoá đơn" → `InvoiceLanguageModal`
hiện QR trỏ `${window.location.origin}/invoice/<id>?lang=..` cho khách quét bằng điện thoại (không có cookie đăng nhập).

Trang gọi 2 API qua `apiClient`:
1. `GET /api/admin/settings/system` (lấy `invoice_config`)
2. `GET /api/finance/invoice/<id>` (route tự gọi `requirePermission('dashboard')`)

Admin production đang bật `AUTH_ENFORCE_API=1` (kiểm chứng 04/10: `curl` không cookie tới
`admin-nganha.vercel.app/api/finance/invoice/<id>` → `401 Unauthorized`). `middleware.ts` chặn mọi `/api/*` không có JWT,
trừ `PUBLIC_API_PREFIXES`; `/api/finance/invoice` không nằm trong danh sách. Khi API trả 401, `lib/apiClient.ts` phát sự kiện
`session_expired` → `lib/auth-context.tsx:242` đẩy sang `/login?error=session_expired`. **Khách quét QR bị văng về màn đăng nhập**
("mất trang hoá đơn"). Quầy mở tab in trong cùng trình duyệt vẫn chạy vì có cookie.

Đây là hệ quả của việc siết API (phase 1), không phải lỗi dữ liệu. Phía WRB (`web_noi_bo/wrb-noi-bo-dev`) có lỗi khác cùng
triệu chứng (select cột `discountAmount` không tồn tại) — đã sửa riêng ngày 04/10, không nằm trong plan này.

## 2. Phương án đề xuất (một khuyến nghị)

Mở **đúng một** API hoá đơn công khai, trả **đúng các trường hoá đơn** + cấu hình hoá đơn; trang khách không gọi API nội bộ nào khác.
Không mở `/api/admin/settings/system` (trả toàn bộ cấu hình thưởng/hoa hồng nội bộ).

| File | Việc làm |
|---|---|
| `app/api/finance/invoice/[id]/route.ts` | (a) Bỏ `requirePermission('dashboard')`. (b) Resolve đơn bằng 2 query `.eq('accessToken', id)` rồi `.eq('id', id)`, `maybeSingle()` — bỏ `.or()` nội suy chuỗi người dùng. (c) `select` whitelist cột **có thật** trong `Bookings` (TableInSupabase.md §1): `id, billCode, customerName, customerPhone, customerEmail, customerLang, createdAt, bookingDate, timeStart, timeEnd, paymentMethod, totalAmount, status, source, parent_booking_id, roomName, bedId, accessToken`; response **không** trả `accessToken`, `notes`, `violations`, `reception_feedback`, `technicianCode`. (d) Đọc `SystemConfigs.key = 'invoice_config'` bằng secret key, trả thêm `invoiceConfig` trong `data`. (e) `discountAmount` cố định 0 (bảng không có cột). Giữ cộng tiền đơn con qua `parent_booking_id`. |
| `middleware.ts` | Thêm `'/api/finance/invoice'` vào `PUBLIC_API_PREFIXES` kèm chú thích: "hoá đơn khách quét QR — route tự whitelist trường, chỉ GET". |
| `app/invoice/[id]/page.tsx` | Bỏ gọi `API.ADMIN.SETTINGS_SYSTEM`; lấy `invoiceConfig` từ response hoá đơn. Dùng `fetch` thường (không `apiClient`) để lỗi 404/500 không phát `session_expired` đá khách về `/login`. |
| `app/admin/settings/invoice/InvoiceSettingsCard.tsx:43` | Không đổi — vẫn gọi được route (giờ công khai), chỉ dùng để xem trước. |
| `app/reception/dispatch/_components/InvoiceLanguageModal.tsx` | Không đổi. (Tuỳ chọn sau: truyền `accessToken` thay `id` vào QR để mã không đoán được — cần thêm trường vào `invoiceLangModal` ở `dispatch/page.tsx:3771`; để ngoài plan này cho gọn.) |

Không cần migration, không đổi `TableInSupabase.md`.

## 3. Rủi ro và lý do chấp nhận

- **Lộ thông tin khách theo mã đơn đoán được** (`11NDK-006-04102026`): ai biết mã đơn xem được tên / SĐT / email / tổng tiền.
  Mức lộ **bằng đúng** WRB `oriaspa.vercel.app/api/finance/invoice/<id>` đang mở công khai theo quyết định
  `web_noi_bo/.../plans/plan_siet_token_api_journey_wrb.md` (duyệt 04/10). Không tạo lỗ mới so với hiện trạng toàn hệ thống.
  Nếu muốn khép, làm bước tuỳ chọn ở bảng trên (QR dùng `accessToken`) — khi đó route có thể bỏ nhánh `.eq('id')`.
- **Route công khai dùng secret key** → chỉ GET, chỉ 3 bảng `Bookings`/`BookingItems`/`Services`, whitelist tường minh.
- Lùi: revert commit; `AUTH_ENFORCE_API` không đổi.

## 4. Ảnh hưởng chéo KTV ↔ Quản lý

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không gọi `/api/finance/invoice` và không có trang `/invoice` — Không ảnh hưởng | `reception/dispatch` (modal hoá đơn, QR), `admin/settings/invoice` (xem trước), `/invoice/[id]` (khách) | `Bookings`, `BookingItems`, `Services`, `SystemConfigs.invoice_config` | Sửa 3 file, không đổi schema |
| Số liệu hiển thị | — | Tổng tiền = `totalAmount` cha + các con (`parent_booking_id`), giảm giá = 0 | Cùng công thức với WRB route sau sửa 04/10 | Khớp |
| Realtime / refresh | — | Trang hoá đơn tải 1 lần, không subscribe | — | Không cần |
| Quyền xem | KTV không thấy gì thêm | Khách thấy: tên, SĐT, email, mã bill, dịch vụ, giá, phương thức thanh toán; **không** thấy ghi chú quầy, vi phạm, mã KTV, token hành trình | Route whitelist | Không lộ dữ liệu nội bộ |

## 5. Kiểm thử sau khi code

1. `curl` không cookie `GET /api/finance/invoice/<id thật>` → 200, body không có `accessToken|notes|violations|reception_feedback|technicianCode`, có `invoiceConfig`.
2. `curl` không cookie `GET /api/admin/settings/system` → vẫn 401.
3. Mở `/invoice/<id>?lang=en` ở cửa sổ ẩn danh → hiện hoá đơn, không bị đẩy sang `/login`.
4. Quầy: bấm Hoá đơn → in (tab mới) và QR quét bằng điện thoại — cả 5 ngôn ngữ.
5. Đơn tách (có `parent_booking_id`) → tổng tiền gồm đơn con. Mã sai → trang báo "Không tìm thấy đơn hàng", không về `/login`.
6. Script kiểm cột: select whitelist bằng REST trả 200 (tương tự `scratch/check_invoice_columns.cjs` bên WRB).
