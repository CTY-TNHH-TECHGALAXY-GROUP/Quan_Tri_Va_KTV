# Plan — Promotion Engine: việc còn mở sau đối chiếu với B (03/10/2026)

> Mức 2: đổi UNIQUE index của pass, thêm trạng thái hiệu lực mới, đổi RPC đọc.
> Trạng thái: **ĐÃ TRIỂN KHAI** (03/10/2026), migration `20261003120000_promotion_engine_v5.sql`. Đã test trên local và Supabase test. Chưa commit.
> Nguồn yêu cầu: `.worktrees/promotion-frontend/plans/promotion_frontend_yeu_cau_backend.md` mục 7, và ghi chú của user cho B (màn theo dõi voucher đang hiệu lực / đã qua).

## 1. Trả lời 4 câu B hỏi

| # | Câu B hỏi | Trả lời / cách làm |
|---|---|---|
| 1 | Khách có voucher **đã huỷ** có được phát lại cho cùng chương trình không? | Hiện **không**: UNIQUE `(customer_id, campaign_id)` tính cả pass CANCELLED. **Đề xuất cho phép phát lại** (mục 2.1). Cần user chốt |
| 2 | Xếp khách `alreadyHasPass` xuống cuối danh sách lọc | Đồng ý. `ORDER BY alreadyHasPass, last_visit_at DESC`. Tổng số và phân trang không đổi |
| 3 | Contract chưa ghi `/menus` và QR trỏ `/voucher?t=` | **Đã có** trong `plans/promotion_engine_api_contract.md` bản v4: mục 2.1 (`GET /api/admin/promotions/menus`), mục 6 và 6.1 (`qrPayload` = `…/voucher?t=`, trang công khai). B đang đọc bản cũ. Sẽ thêm một dòng tham chiếu ở mục 3 cho dễ tìm |
| 4 | Trang `/voucher` dùng lại `VoucherCard3D` | Đồng ý. Đúng như đã chốt: **B làm trang** bằng `VoucherCard3D`; A cấp `resolveVoucherView()` + chữ 5 ngôn ngữ. `PromotionPublicVoucherDto` đã khớp `VoucherCardData` |

## 2. Thay đổi backend

### 2.1 Phát lại sau khi huỷ (nếu user đồng ý)

- **UNIQUE index:** `(customer_id, campaign_id) WHERE one_pass_per_customer AND status <> 'CANCELLED'`.
  - Pass đã huỷ giữ nguyên để truy vết, pass mới có mã và QR mới.
  - QR của pass cũ vẫn trả "Đã huỷ".
- **`promo_insert_pass`:** khi kiểm "đã có voucher", bỏ qua pass CANCELLED.
- **Bộ lọc khách:** `alreadyHasPass` chỉ tính pass chưa huỷ. Thêm `passState`: `NONE` / `ACTIVE` / `EXPIRED` / `SUSPENDED` / `CANCELLED_ONLY`, để UI ghi rõ lý do.
- **Không đổi:**
  - Pass **SUSPENDED**: dùng nút "Kích hoạt lại", không phát pass mới.
  - Pass **EXPIRED**: chỉ phát lại được nếu campaign còn hạn. Thực tế hết hạn thường do campaign kết thúc, nên phát lại sẽ bị chặn `PROMOTION_EXPIRED`.

### 2.2 Màn theo dõi voucher "đang hiệu lực" và "đã qua" (ghi chú của user)

- **Lỗ hổng hiện tại:** voucher `LIMITED` / `ONE_TIME` đã dùng hết lượt vẫn mang `effectiveStatus = ACTIVE`. Lúc apply có chặn, nhưng màn theo dõi sẽ xếp nhầm vào "đang hiệu lực".
- **Đề xuất:** thêm `effectiveStatus = USED_UP` (đã dùng hết lượt).
  - Dùng chung một hàm cho apply, danh sách đơn, trang công khai, email (không gửi nhắc hạn cho voucher đã dùng hết) và overview.
- **Bộ lọc nhóm** `GET /api/admin/promotions/passes?group=ACTIVE|PAST`:
  - `ACTIVE` = `ACTIVE` + `NOT_STARTED`.
  - `PAST` = `EXPIRED` + `USED_UP` + `CANCELLED`.
  - `SUSPENDED` / `INACTIVE` nằm ở nhóm `ACTIVE`, có badge riêng, vì admin vẫn mở lại được.
- **Thứ tự sắp xếp:**
  - `ACTIVE`: sắp hết hạn trước.
  - `PAST`: mới kết thúc trước. Mốc kết thúc là ngày hết hạn, ngày huỷ, hoặc lần dùng cuối khi đã dùng hết.
- **Overview:** thêm `pastPasses`. `activePasses` đổi sang không tính `USED_UP`.

### 2.3 Ghi chú cho B (UI, không cần backend)

- "Chọn khách → hiện nút Phát theo ngữ cảnh": dùng sẵn `POST /passes/bulk`. Chọn 1 khách cũng gọi được (`customerIds: [id]`), không cần nút "Phát lẻ" riêng.
- Hộp xác nhận lấy tên chương trình và ưu đãi từ campaign đang mở.

## 3. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — KTV không gọi API promo | Danh sách lọc khách (thứ tự, `passState`), màn theo dõi voucher (`group`), badge `USED_UP` | `promo_pass_effective_status`, `promo_customer_candidates`, `promo_search_passes`, UNIQUE index | A sửa RPC + migration v5; B thêm badge / tab |
| Số liệu | Không ảnh hưởng tiền tua — pass mới chỉ là quyền dùng | Overview: `activePasses` giảm khi tách `USED_UP` | `promo_overview` | Khớp, một nguồn |
| Realtime | Không ảnh hưởng | Bấm lọc thì tải lại | — | — |
| Quyền | KTV không thấy | Chỉ quyền `promotions` | — | Không đổi |

## 4. Test bổ sung

- Huỷ pass → phát lại → pass mới có mã mới; QR cũ trả CANCELLED; 2 lần phát đồng thời vẫn chỉ ra 1 pass.
- `LIMITED 2` dùng đủ 2 lần → `USED_UP` ở mọi nơi; huỷ 1 lượt dùng → về lại `ACTIVE`.
- `group=ACTIVE` / `group=PAST` đúng thành phần và đúng thứ tự.
- Danh sách lọc khách: khách đã có voucher nằm cuối.
- Chạy trên local + Supabase test, cả `TZ=UTC`.

## 5. Cần user chốt

1. Voucher đã **huỷ** có cho phát lại cho cùng khách không? Khuyến nghị: **có**.
2. Đồng ý thêm trạng thái **`USED_UP` (đã dùng hết lượt)** và chia màn theo dõi thành "đang hiệu lực / đã qua" như mục 2.2?

## 6. Quyết định của user (03/10/2026)

- **Phát lại:** cho phép khi voucher cũ đã huỷ, hết hạn hoặc dùng hết lượt. Khách **đang giữ** voucher còn dùng được thì không phát thêm. Hồ sơ hiện lịch sử các voucher từng có.
- **`USED_UP` + tab đang hiệu lực / đã qua:** đồng ý.

**Cách làm đã chọn:** cột `superseded_at` / `superseded_by`, và UNIQUE index chỉ tính pass đang mở. Pass đã bị thay thì đóng hẳn, kể cả khi sau đó huỷ một lượt dùng của nó, để không bao giờ có 2 pass còn dùng được song song.

**Test:** `qa_promotion_engine.ts` 175 case (local + Supabase test, cả `TZ=UTC`); `qa_promotion_email.ts` 26 case; smoke HTTP v5 6 case.

## 7. Bổ sung v6 (03/10/2026): tên menu cho trang khách — ĐÃ TRIỂN KHAI

Yêu cầu B (`promotion_frontend_yeu_cau_backend.md`): public voucher chỉ có mã menu (`NHP`).

- **Cách làm:** migration `20261003150000_promotion_engine_v6.sql`, hàm `promo_scope_labels`. Trả thêm `menuLabels` (public voucher) và `applicableMenus.labels` (campaign).
- **Quy tắc nhãn:**
  - Có chọn menu: tên menu lấy từ `SystemConfigs`. Thêm " · <Category>" chỉ khi category thực sự thu hẹp menu.
  - Chỉ chọn category: hiện tên category (bỏ `_`, viết hoa chữ đầu).
  - Chọn dịch vụ lẻ: hiện tên dịch vụ.
  - Phạm vi rỗng: `[]`.
  - Cấu hình nhãn bị hỏng thì trả lại mã menu, không làm lỗi trang khách.
- **Test:** QA 177 case (local + Supabase test, cả `TZ=UTC`).
