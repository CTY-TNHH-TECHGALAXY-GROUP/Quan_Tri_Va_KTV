# Plan — Quầy áp voucher cho đơn **chưa đủ điều kiện** (có xác nhận)

> Mức 2: đổi luồng áp voucher (`promo_apply_pass`), thêm cột vào `PromotionUsages`.
> Trạng thái: **ĐÃ TRIỂN KHAI** (03/10/2026), migration `20261003210000_promotion_engine_v8.sql`. Đã test trên local và Supabase test. Chưa commit.
> Ngày: 03/10/2026. Nhánh `feat/promotion-engine`.

## 1. Yêu cầu (user)

Quầy quét voucher → thấy các đơn đang mở, **mỗi đơn có ghi chú đủ / không đủ điều kiện**. Quầy vẫn có thể chọn đơn không đủ điều kiện, khi đó hiện popup xác nhận *"Đơn không đủ điều kiện: … (ghi rõ thiếu gì)"*. Bấm xác nhận thì vẫn áp.

## 2. Phân loại lý do chặn

Chỉ **điều kiện áp dụng** mới cho quầy vượt qua sau khi xác nhận. Các lỗi còn lại vẫn chặn cứng, vì vượt qua sẽ làm sai voucher hoặc sai đơn.

| Mã | Nghĩa | Quầy vượt qua sau xác nhận? |
|---|---|---|
| `ORDER_CONDITION_NOT_MET` | Đơn chưa đạt điều kiện (menu / dịch vụ / số phút / số tiền) | ✅ **Có** |
| `PROMOTION_EXPIRED` / `NOT_STARTED` / `INACTIVE` / `SUSPENDED` / `CANCELLED` | Voucher không còn dùng được | ❌ Không |
| `PROMOTION_USAGE_LIMIT_REACHED` | Hết lượt | ❌ Không |
| `PROMOTION_ALREADY_APPLIED` | Đã áp cho đơn này | ❌ Không |
| `ORDER_NOT_ACTIVE` / `ORDER_NOT_FOUND` | Đơn đã xong, huỷ hoặc không tồn tại | ❌ Không |
| `ORDER_NOT_ELIGIBLE` | Đơn chưa có dịch vụ nào | ❌ Không |

## 3. Thay đổi backend

### 3.1 Danh sách đơn sau khi quét (`GET /api/promotion-passes/:id/active-orders`)

Mỗi đơn có thêm:
- `eligibility`: `ELIGIBLE` (đủ điều kiện) / `NOT_ELIGIBLE` (thiếu điều kiện, **vẫn chọn được** sau khi xác nhận) / `BLOCKED` (không áp được).
- `canOverride`: `true` khi chỉ thiếu điều kiện.
- `unmetReasons`: danh sách chữ tiếng Việt do server dựng, đúng nội dung để hiện ở ghi chú và popup. Ví dụ:
  - *"Cần Menu VIP từ 90 phút — dịch vụ VIP dài nhất của đơn là 60 phút"*
  - *"Cần một trong: Body A, Body B — đơn không có dịch vụ nào trong số này"*
  - *"Cần tổng đơn từ 1.000.000đ — đơn hiện 900.000đ"*
  - Điều kiện `ANY`: *"Cần đạt một trong các điều kiện sau: …"*
- Vẫn giữ `canApply`, `blockedReasonCode`, `conditionResult` như cũ.

### 3.2 Áp vượt điều kiện (`POST /api/promotion-passes/:id/apply`)

- **Body:** `{ bookingId, overrideConditions?: true }`.
  - Không gửi `overrideConditions` mà đơn thiếu điều kiện → vẫn trả `422 ORDER_CONDITION_NOT_MET`, `error.data.unmetReasons` có lý do để hiện popup.
  - Gửi `overrideConditions: true` → server **kiểm lại toàn bộ**, chỉ bỏ qua đúng bước kiểm điều kiện. Các lỗi ở bảng mục 2 vẫn chặn.
- **Ghi vết trên `PromotionUsages`** (cột mới):
  - `conditions_overridden boolean`
  - `override_reasons jsonb`: lý do lúc áp, chụp lại tại thời điểm đó
  - `staff_id`: đã có sẵn
- **Ưu đãi khi áp vượt:**
  - +phút: gắn vào dịch vụ đầu tiên của đơn như bình thường.
  - Giảm %: tính trên **cả đơn**, vì không có dịch vụ nào đạt điều kiện để làm gốc tính.
- **Lịch sử dùng** (`/usages`, lịch sử khách) trả `conditionsOverridden` + `overrideReasons`, để admin lọc và rà các lượt "áp ngoại lệ". Thêm bộ lọc `overridden=1`.
- **Chưa có giới hạn** số lần quầy được áp ngoại lệ; xem câu hỏi 2.

### 3.3 Không đổi

- Phát tự động vẫn bám điều kiện, không có ngoại lệ.
- Lượt dùng ngoại lệ vẫn tính vào số lượt của voucher (`LIMITED`, 1 lần / đơn).

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | KTV nhận dịch vụ KM như bình thường; không biết lượt áp có ngoại lệ hay không | Màn quét: ghi chú đủ / không đủ + popup (B). Lịch sử dùng: nhãn "Áp ngoại lệ" (B) | `promo_check_apply`, `promo_apply_pass`, `promo_order_candidates`, `PromotionUsages` | A: RPC + migration; B: UI |
| Số liệu | Phút KM vẫn tính tua như mọi lượt áp | Giảm % khi áp ngoại lệ tính trên cả đơn | `promo_compute_discount` | Ghi rõ trong contract |
| Realtime | Không ảnh hưởng | Tải lại danh sách sau khi áp | — | — |
| Quyền | — | `dispatch_board` được áp ngoại lệ | — | Theo câu 1 |

## 5. Test

- Đơn thiếu điều kiện:
  - Không gửi `overrideConditions` → 422 kèm lý do.
  - Gửi `overrideConditions: true` → áp được, usage ghi `conditions_overridden = true` + lý do.
- Đơn đủ điều kiện mà vẫn gửi `overrideConditions: true` → áp bình thường, **không** ghi là ngoại lệ.
- Voucher hết hạn / tạm khoá / hết lượt / đã áp / đơn đã xong: gửi `overrideConditions: true` vẫn bị chặn.
- Chữ trong `unmetReasons` đúng cho từng loại điều kiện (menu, dịch vụ, phút, tiền) và cho `ALL` / `ANY`.
- Giảm % khi áp ngoại lệ tính trên cả đơn.
- 2 quầy cùng áp ngoại lệ một đơn → chỉ 1 lượt thành công.
- Chạy trên local + Supabase test, cả `TZ=UTC`.

## 6. Cần user chốt

1. **Ai được áp ngoại lệ?**
   - **Khuyến nghị:** mọi lễ tân có quyền `dispatch_board`, chỉ cần bấm xác nhận, đúng như bạn mô tả. Mọi lượt đều ghi lại tên nhân viên.
   - Cách khác: chỉ quản lý được áp ngoại lệ.
2. **Có cần nhập lý do** khi áp ngoại lệ không (ví dụ "khách quen", "quản lý duyệt")? Khuyến nghị: **không bắt buộc**, có ô ghi chú tuỳ chọn.
3. Chỉ cho vượt **điều kiện áp dụng**, còn hết hạn / hết lượt / đã áp / đơn đã xong vẫn chặn cứng (bảng mục 2). Đồng ý không?

## 7. Quyết định của user (03/10/2026) — ĐÃ DUYỆT

| # | Quyết định | Cách làm |
|---|---|---|
| O1 | Mọi lễ tân có quyền `dispatch_board` được áp ngoại lệ, chỉ cần xác nhận; hệ thống ghi tên người áp | `staff_id` lấy từ session, có trong lịch sử dùng (`staffName`) |
| O2 | **Bắt buộc ghi lý do** khi áp ngoại lệ | `overrideNote` bắt buộc, 3–500 ký tự. Thiếu → `422 OVERRIDE_REASON_REQUIRED` |
| O3 | Chỉ vượt **điều kiện áp dụng**; hết hạn / hết lượt / đã áp / đơn đã xong vẫn chặn cứng | Chỉ bỏ qua bước kiểm `ORDER_CONDITION_NOT_MET` |

## 8. Kết quả

- **Test:** QA engine 209 case (local + Supabase test, cả `TZ=UTC`), có thêm 14 case áp ngoại lệ. QA email 31 case. Smoke HTTP 7 case.
- **Lỗi bắt được khi làm:**
  1. **Thứ tự kiểm tra:** voucher hết hạn mà quầy gửi áp ngoại lệ không lý do thì báo "thiếu lý do" thay vì "hết hạn". Đã đổi sang kiểm lỗi chặn cứng trước.
  2. **Lý do hiển thị lặp category:** ra "Menu VIP · Vip Menu · từ 90 phút". Đã bỏ category phủ hết menu trong `promo_conditions_summary`, nên email, thẻ voucher và trang khách cùng được sửa.
