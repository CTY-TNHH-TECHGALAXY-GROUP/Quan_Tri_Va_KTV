# Plan — Phân quyền khuyến mãi theo thao tác (cấu hình động)

> Mức 2: phân quyền / bảo mật (đổi quyền kiểm ở mọi route promotion).
> Trạng thái: **ĐÃ TRIỂN KHAI** (04/10/2026). Không có migration (phân quyền nằm ở code + `Users.permissions`). Chưa commit.
> Ngày: 04/10/2026. Nhánh `feat/promotion-engine`.

## 1. Yêu cầu (user)

Admin tự cấu hình được từng tài khoản / vai trò làm được gì với khuyến mãi, **không hard-code**. Ví dụ: tài khoản lễ tân **chỉ được quét và áp voucher vào đơn**, không được tạo, sửa chương trình, cũng không được xem voucher đã gửi cho khách nào.

## 2. Hiện trạng

- **Hệ thống quyền đã động sẵn:**
  - Mỗi quyền là một mã trong `MODULES` (`lib/constants.ts`).
  - Admin tick theo **vai trò** hoặc **từng tài khoản** ở trang Phân quyền (`app/admin/roles`).
  - Quyền lưu ở `Users.permissions`. Server kiểm bằng `requirePermission` / `requirePermissionAny`.
- **Khuyến mãi hiện chỉ có 2 mức thô:**
  - `promotions` (B khai báo): mọi API admin.
  - `dispatch_board`: quét / áp voucher.

  Nghĩa là ai có quyền điều phối thì áp được voucher, còn ai có `promotions` thì làm được tất cả.
- **Lộ dữ liệu khách khi quét:** kết quả quét (`lookup`) đang trả cả SĐT và email của chủ voucher. Lễ tân chỉ quét không nên thấy những thông tin này.

## 3. Đề xuất: tách 6 quyền con

Theo đúng cơ chế hiện có: thêm vào `MODULES`, nhóm "Khuyến mãi", hiện thành ô tick ở trang Phân quyền.

| Mã quyền | Tên hiển thị | Cho phép | API |
|---|---|---|---|
| `promotions_scan_apply` | Quét & áp voucher | Quét / tra mã voucher, xem đơn đang mở, áp voucher cho đơn **đủ điều kiện** | `lookup`, `active-orders`, `apply` |
| `promotions_override` | Áp ngoại lệ | Áp cho đơn **chưa đủ điều kiện** (bắt buộc lý do) | `apply` khi gửi `overrideConditions` |
| `promotions_usage_cancel` | Huỷ lượt áp | Huỷ khuyến mãi đã áp trên đơn | `promotion-usages/:id/cancel` |
| `promotions_view` | Xem voucher & lịch sử | Tổng quan, danh sách voucher **đã phát cho khách nào** (SĐT / email), chi tiết voucher, lịch sử dùng, lịch sử khuyến mãi của khách | `overview`, `passes` GET, `passes/:id` GET, `usages`, `customers/:id/promotions`, `campaigns` GET |
| `promotions_issue` | Phát voucher | Lọc khách, phát lẻ / hàng loạt, gửi lại email, khoá / mở / huỷ voucher | `customers`, `customer-candidates`, `passes` POST, `passes/bulk`, `send-email`, `passes/:id` PATCH |
| `promotions_campaign_manage` | Quản lý chương trình | Tạo / sửa / kích hoạt / dừng / kết thúc chương trình, chọn menu & điều kiện | `campaigns` POST / PATCH, `campaigns/:id/status`, `menus` |

- **`promotions`** (quyền cũ của B) = **toàn quyền khuyến mãi**, gồm cả 6 quyền con. Giữ lại để tài khoản đang có quyền này không mất gì.
- **Ví dụ của user:** lễ tân chỉ tick `promotions_scan_apply`. Có thể tick thêm `promotions_override` nếu muốn cho áp ngoại lệ.
- **Màn quét không lộ dữ liệu khách:**
  - Người **không** có `promotions_view` / `promotions_issue`: chỉ thấy tên chủ voucher. SĐT và email bị ẩn ở `lookup`, `active-orders`, kết quả `apply`.
  - Có `promotions_view` thì thấy đủ.

### Cách làm (không hard-code thao tác ↔ người)

- **Một bảng duy nhất trong code:** `lib/constants/promotion.ts`, ghi thao tác → quyền. Mọi route promotion đọc bảng này qua `authorizePromotion(action)`. Muốn đổi thao tác nào cần quyền nào thì sửa một chỗ.
- **Ai có quyền gì** do admin tick hoàn toàn trên trang Phân quyền, không có chỗ nào viết cứng.
- **Kiểm ở server mỗi request.** UI của B chỉ ẩn / hiện nút theo cùng mã quyền (`hasPermission`).
- **Chặn khoảng hở hiện có:**
  - Hiện `requirePermission` **cho qua khi chưa có phiên đăng nhập** nếu `AUTH_ENFORCE_API` tắt (đang tắt). Như vậy ai gọi thẳng API vẫn làm được mọi thao tác khuyến mãi.
  - Đề xuất: các route promotion **luôn bắt đăng nhập và đúng quyền**, không phụ thuộc cờ này (giống cách trang `/voucher` đã dùng `sessionHasPermission`).
  - ⚠️ Hệ quả: tài khoản đăng nhập kiểu cũ, chưa có phiên Supabase, sẽ nhận 401 ở các API khuyến mãi. Xem câu hỏi 3.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — KTV không có quyền khuyến mãi | Trang Phân quyền: nhóm "Khuyến mãi" 6 ô tick. Màn khuyến mãi ẩn / hiện nút theo quyền (B) | `MODULES` / `ModuleId` (B đang giữ), `lib/promotion-route.ts`, `lib/auth-server.ts` | A: kiểm quyền ở server + bảng thao tác; B: thêm mã vào `MODULES` + UI |
| Số liệu | Không ảnh hưởng | Không ảnh hưởng | — | — |
| Realtime | — | — | — | — |
| Quyền | — | Lễ tân chỉ quét / áp nếu admin chỉ tick quyền đó; không thấy SĐT / email khách | `Users.permissions` | Đúng yêu cầu, giảm lộ dữ liệu |

## 5. Phối hợp với B

- `MODULES` / `ModuleId` đang do **B** sửa (đã thêm `promotions`). Để tránh conflict khi merge, **B thêm 6 mã mới** vào `MODULES` (nhóm "Khuyến mãi"). **A** chỉ khai báo bảng thao tác → quyền và kiểm ở server.
- B ẩn / hiện menu và nút theo đúng các mã này.

## 6. Test

- Từng quyền mở đúng nhóm API của mình, các nhóm khác trả 403. Chạy qua smoke HTTP với các tài khoản test có tổ hợp quyền khác nhau.
- `promotions` vẫn làm được mọi thứ.
- Chỉ có `promotions_scan_apply`:
  - quét / áp được;
  - gửi `overrideConditions` → 403;
  - không thấy SĐT / email chủ voucher;
  - gọi danh sách voucher / phát / tạo chương trình → 403.
- Không có phiên đăng nhập → 401 ở mọi route promotion (theo câu 3).

## 7. Cần user chốt

1. Danh sách **6 quyền** ở mục 3 đã đủ chưa, hay cần tách / gộp thêm? Ví dụ gộp "Huỷ lượt áp" vào "Quét & áp".
2. **Quyền điều phối (`dispatch_board`) còn tự động cho quét / áp voucher không?**
   - **Khuyến nghị: không.** Phải tick `promotions_scan_apply` thì mới quét / áp được, đúng tinh thần "admin cấu hình".
   - Khi deploy, admin tick quyền này cho vai trò Lễ tân một lần.
3. **Các route khuyến mãi luôn bắt đăng nhập**, kể cả khi cờ `AUTH_ENFORCE_API` đang tắt? Khuyến nghị: **có**. Nếu không bật thì việc phân quyền không có tác dụng với ai gọi thẳng API.

## 8. Quyết định của user (04/10/2026) — ĐÃ DUYỆT

1. **Gộp "Huỷ lượt áp" vào "Quét & áp".** Còn 5 quyền con: `promotions_scan_apply`, `promotions_override`, `promotions_view`, `promotions_issue`, `promotions_campaign_manage`. `promotions` = toàn quyền.
2. `dispatch_board` **không** còn tự cho quét / áp voucher.
3. Route khuyến mãi **luôn bắt đăng nhập**, không phụ thuộc `AUTH_ENFORCE_API`.

## 9. Kết quả

- **Code:**
  - `lib/constants/promotion.ts`: `PROMOTION_PERMISSIONS`, `PROMOTION_ACTION_PERMISSIONS`, `promotionCan`.
  - `lib/auth-server.ts`: `getSessionAccess`, không có nhánh cho qua khi thiếu phiên.
  - `lib/promotion-route.ts`: `authorizePromotion(action)`.
  - 17 route khuyến mãi gắn thao tác.
  - Ẩn SĐT / email chủ voucher ở `lookup` / `apply`.
  - Chặn áp ngoại lệ khi thiếu quyền.
- **Test:**
  - `qa_promotion_permissions.ts`: 12 case, gồm kiểm tĩnh mọi route có guard.
  - Smoke HTTP với **phiên đăng nhập thật**: 15 case, 3 tài khoản tạm trên Supabase test, đã xoá sau khi chạy.
- **Việc B:** thêm 5 mã quyền vào `MODULES` / `ModuleId` (nhóm "Khuyến mãi"), ẩn / hiện UI theo quyền.
- **Lưu ý:** admin / dev / quản lý chi nhánh có danh sách quyền **rỗng** thì được mọi mã trong `MODULES`. Sau khi B thêm 5 mã, họ tự có quyền khuyến mãi; trước đó cần có quyền `promotions`.
