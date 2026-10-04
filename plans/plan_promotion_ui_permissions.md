# Plan — Phân quyền Khuyến mãi theo thao tác trên UI (Agent B)

> **Mức 2** (phân quyền). Trạng thái: **ĐÃ DUYỆT 04/10/2026**.
> Ngày: 04/10/2026. Nhánh `feat/promotion-frontend` (đã merge backend A ở `6ee5ea6c`).
> Nguồn: contract A v9 §0.1 (`plans/promotion_engine_api_contract.md`), `lib/constants/promotion.ts` (`PROMOTION_PERMISSIONS`, `PROMOTION_ACTION_PERMISSIONS`, `promotionCan`).

## 1. Vấn đề

- **Backend (A) kiểm quyền theo từng thao tác.** UI (B) vẫn kiểm theo `promotions` / `dispatch_board`. Hậu quả khi nối API thật:
  - Lễ tân chỉ có `dispatch_board` mở được trang quét, nhưng mọi thao tác trả **403**.
  - Nút **Áp ngoại lệ**, **Tạo chương trình**, **Phát voucher**… hiện cả với người không có quyền. Server vẫn chặn, nên không lộ dữ liệu, nhưng người dùng bấm vào sẽ gặp lỗi.
- **5 mã quyền mới chưa có trong `MODULES`**, nên trang Phân quyền **không tick được**. Hiện chỉ cấp được `promotions` (toàn quyền).

## 2. Bảng quyền (lấy nguyên của A, không đổi)

| Mã quyền | Tên hiển thị | Thao tác (action) |
|---|---|---|
| `promotions_scan_apply` | KM: Quét & áp voucher | `scan.apply` |
| `promotions_override` | KM: Áp ngoại lệ | `apply.override` |
| `promotions_view` | KM: Xem voucher & lịch sử | `pass.view`, `campaign.read`, `customer.pii` |
| `promotions_issue` | KM: Phát voucher | `pass.issue`, `campaign.read`, `customer.pii` |
| `promotions_campaign_manage` | KM: Quản lý chương trình | `campaign.manage`, `campaign.read` |
| `promotions` | Khuyến Mãi (toàn quyền) | tất cả |

UI **chỉ gọi `promotionCan(permissions, action)`** của A. Không viết lại bảng này ở frontend, để UI và server luôn dùng một nguồn.

## 3. Thay đổi

### 3.1 Đăng ký quyền (`lib/types.ts`, `lib/constants.ts`)
- Thêm 5 mã vào `ModuleId` và `MODULES`, nhóm **"Khuyến Mãi"**. Tên lấy từ `PROMOTION_PERMISSIONS` của A.
  - Mục `promotions` cũ đổi tên hiển thị thành "Khuyến Mãi (toàn quyền)". Mã giữ nguyên.
- Thêm field tuỳ chọn `menu?: false` vào `ModuleDefinition`: 5 quyền con chỉ hiện ở trang Phân quyền, **không thành 5 mục riêng** trên Sidebar.

### 3.2 Sidebar (`components/layout/Sidebar.tsx`)
- Chỉ **một** mục "Khuyến Mãi", hiện khi người dùng có **bất kỳ** quyền KM nào.
- Đích của mục này theo quyền:
  - Có `pass.view`, `pass.issue` hoặc `campaign.read` → `/admin/promotions`.
  - Chỉ có `scan.apply` (lễ tân) → **thẳng `/admin/promotions/scan`**.
- Không đổi gì với các mục menu khác.

### 3.3 Trang & nút (`components/promotions/*`, `app/admin/promotions/*`)
- **`PromotionsShell`:** nhận `action: PromotionAction | PromotionAction[]` (có một trong số đó là được), thay cho `permission`.
- **Tab, nút đầu trang và các nút trong trang** ẩn hoặc hiện theo quyền:

| Chỗ | Cần thao tác |
|---|---|
| Tổng quan · tab Voucher đã phát · Lịch sử áp dụng | `pass.view` |
| Tab Chương trình KM · chi tiết chương trình | `campaign.read` |
| Nút "Tạo chương trình" · Sửa · Kích hoạt / Tạm dừng / Kết thúc | `campaign.manage` |
| Bảng lọc hồ sơ khách + nút "Phát voucher" | `pass.issue` |
| Gửi lại email · Tạm khoá / Huỷ / Mở lại voucher | `pass.issue` |
| Nút "Quét voucher" · trang quét · nút "Huỷ lượt áp dụng" | `scan.apply` |
| Nút / popup "Áp ngoại lệ…" | `apply.override`. Đơn `NOT_ELIGIBLE` vẫn hiện badge và lý do; thiếu quyền thì hiện "Cần quyền áp ngoại lệ", không có nút |

- **Nút ← ở trang quét:** về Tổng quan nếu có `pass.view`, nếu không thì về Điều phối.
- **Số điện thoại / email bị ẩn** (`customer.pii` = false): server trả `null`, UI hiện "—". Phần này đã xử lý `null` sẵn; sẽ kiểm lại từng chỗ.

### 3.4 Mẫu vai trò (`app/admin/roles/Roles.logic.ts`)
- **Khuyến nghị:** thêm `promotions_scan_apply` vào **mẫu Lễ tân**. Mẫu chỉ được dùng khi admin chủ động áp mẫu, không tự đổi quyền của tài khoản đang có.
- **Không** sửa danh sách quyền mặc định (fallback) trong `auth-context.tsx` / `auth-server.ts`. Đó là lõi đăng nhập, và A khuyến nghị admin tick quyền tay.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng: KTV không có quyền KM; app KTV không đọc các mã này | Sidebar, trang Phân quyền (thêm 5 ô), mọi trang `/admin/promotions/*` | `MODULES`, `ModuleId`, `promotionCan` (A) | Sửa |
| Số liệu | Không đổi | Không đổi | — | Không ảnh hưởng: chỉ ẩn/hiện, không tính toán |
| Realtime / refresh | Không ảnh hưởng | Quyền được nạp lúc đăng nhập (`sessionStorage`); admin tick quyền mới thì người dùng **phải đăng nhập lại**, giống các quyền khác hiện nay | — | Đồng bộ như cũ |
| Quyền xem | KTV không thấy mục KM | Ai có quyền nào thấy đúng phần đó; SĐT / email ẩn khi thiếu `customer.pii` | Server là nơi chặn thật; UI chỉ ẩn | Không lộ dữ liệu |

**Fallback (đã có từ trước, không do plan này tạo ra):**
- Tài khoản admin/dev **không có danh sách quyền riêng** tự có mọi mục trong `MODULES`, nên sẽ có luôn 5 quyền mới, giống `promotions` hiện nay.
- `branch_manager` có fallback ở server nhưng **không có ở client** (`auth-context`), nên UI có thể ẩn mục mà server vẫn cho. Plan này chỉ báo, không sửa.

## 5. Kiểm thử

1. **Script không cần DB** (`scripts/qa/qa_promotion_frontend.ts`): với 5 vai mẫu, kiểm hàm ẩn/hiện trả đúng theo `promotionCan`, gồm Sidebar, đích của mục menu, tab và từng nút:
   - Lễ tân (`scan_apply`)
   - Lễ tân trưởng (`scan_apply` + `override`)
   - Marketing (`issue` + `view`)
   - Admin (`promotions`)
   - KTV (không có quyền KM)
2. **Trình duyệt (mock):** chụp màn hình 3 vai ở 390px và 1440px. Kiểm không còn nút nào bấm vào ra 403.
3. **Trang Phân quyền:** 5 ô mới hiện trong nhóm "Khuyến Mãi" và lưu được (thử trên mock, không ghi DB thật).
4. Chạy `qa_promotion_permissions.ts` của A; `tsc` báo 0 lỗi; kiểm responsive 6 khổ.

## 6. File dự kiến
- `lib/types.ts`, `lib/constants.ts`: 5 mã + field `menu`.
- `components/layout/Sidebar.tsx`: 1 mục KM, đích theo quyền.
- `components/promotions/PromotionsShell.tsx`, `promotion.paths.ts`, hook mới `usePromotionCan.ts`.
- `app/admin/promotions/**`, `CustomerCandidatesPanel.tsx`, `UsageHistoryList.tsx`, `OrderSelectCard.tsx`, `scan/*`: ẩn/hiện nút.
- `app/admin/roles/Roles.logic.ts`: mẫu Lễ tân (nếu bạn đồng ý mục 7.1).
- `scripts/qa/qa_promotion_frontend.ts`.
- **Không sửa:** `lib/auth-server.ts`, `lib/auth-context.tsx` (logic đăng nhập), route API của A.

## 7. Quyết định (user, 04/10/2026)

1. **Mẫu Lễ tân có `promotions_scan_apply`.** Admin vẫn tick/bỏ tick được sau khi áp mẫu.
2. **`promotions_override` không nằm trong mẫu nào**; admin tick tay cho người được duyệt.

### Câu hỏi ban đầu
1. **Mẫu vai trò Lễ tân** có thêm `promotions_scan_apply` không? Khuyến nghị: **có**.
2. **Quyền áp ngoại lệ (`promotions_override`)** không đưa vào mẫu nào; admin tick tay cho người được duyệt (VD quản lý ca). Đồng ý không?

## 8. Ảnh hưởng vận hành khi deploy
- Sau deploy, **admin phải tick quyền KM** cho từng vai trò hoặc tài khoản. Lễ tân chưa được tick thì không thấy mục Khuyến Mãi.
- Người được tick thêm quyền phải **đăng nhập lại** mới thấy thay đổi.
