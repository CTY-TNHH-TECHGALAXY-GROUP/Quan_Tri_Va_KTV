# Plan — Điều kiện áp dụng voucher (nhiều tiêu chí)

> Mức 2: thêm cột + đổi RPC kiểm điều kiện áp (`promo_check_apply`, danh sách đơn, giảm %, trang khách).
> Trạng thái: **ĐÃ TRIỂN KHAI** (03/10/2026), migration `20261003180000_promotion_engine_v7.sql`. Đã test trên local và Supabase test. Chưa commit.
> Ngày: 03/10/2026. Nhánh `feat/promotion-engine`.

## 1. Yêu cầu

Admin đặt được điều kiện để voucher **áp được vào đơn**:
- Ví dụ: "menu VIP từ 90 phút trở lên".
- Tiêu chí xét theo **menu**, **category**, **dịch vụ**, **thời lượng**.
- Đặt được **1 hoặc nhiều** tiêu chí.

## 2. Hiện trạng

| Đã có | Thiếu |
|---|---|
| `applicableMenus` (menu / category / dịch vụ): đơn phải có ít nhất 1 dịch vụ thuộc phạm vi | **Không đặt được thời lượng tối thiểu** khi áp. Ngưỡng 90 phút hiện chỉ dùng cho **phát tự động** (`qualification_value`), mà phát tự động đang tắt |
| Chỉ một phạm vi duy nhất | Không ghép được nhiều điều kiện (VD "VIP ≥ 90 phút **hoặc** Deep Body ≥ 120 phút") |

## 3. Thiết kế đề xuất: danh sách điều kiện

Thêm cột `PromotionCampaigns.apply_conditions jsonb`:

```json
{
  "match": "ALL",
  "conditions": [
    { "menus": ["NHP"], "categories": [], "serviceIds": [], "minMinutes": 90, "minAmount": null }
  ]
}
```

- **Mỗi điều kiện** gồm:
  - **Phạm vi:** menu / category / dịch vụ. Dùng đúng quy tắc khớp đang có (`promo_service_in_scope`). Để trống nghĩa là mọi dịch vụ.
  - **Ngưỡng (tuỳ chọn):**
    - `minMinutes`: số phút đã trả của các dịch vụ thuộc phạm vi trong đơn. Không tính phút khuyến mãi, dịch vụ huỷ, hay add-on chưa trả tiền.
    - `minAmount`: tiền của các dịch vụ thuộc phạm vi.
  - Không đặt ngưỡng nghĩa là chỉ cần đơn có ít nhất 1 dịch vụ thuộc phạm vi (giống `applicableMenus` hiện nay).
- **`match`:**
  - `ALL`: đơn phải đạt **mọi** điều kiện.
  - `ANY`: đạt **một** điều kiện là đủ.
  - Không lồng nhóm, để form admin dễ hiểu.
- **Ví dụ:**

  | Mong muốn | Cấu hình |
  |---|---|
  | Menu VIP từ 90 phút | `[{menus:[NHP], minMinutes:90}]` |
  | Category Body từ 60 phút **và** có dịch vụ Lấy ráy tai | `ALL [{categories:[BODY], minMinutes:60}, {serviceIds:[NHS0012]}]` |
  | VIP ≥ 90 **hoặc** Deep Body ≥ 120 | `ANY [{menus:[NHP], minMinutes:90}, {menus:[NHT], minMinutes:120}]` |
  | Đơn từ 1.000.000đ | `[{minAmount:1000000}]` |

- **Một hàm đánh giá duy nhất:** `promo_evaluate_conditions(booking, apply_conditions)`. Hàm trả kết quả của từng điều kiện, ví dụ `{ met, minutes, required }`. Hàm này dùng chung cho:
  - `promo_check_apply` (áp thật).
  - Danh sách đơn ở quầy (`canApply`): khi bị chặn, trả mã mới **`ORDER_CONDITION_NOT_MET`** kèm `blockedReason` dễ hiểu, ví dụ *"Cần Menu VIP từ 90 phút — đơn đang có 60 phút"*.
  - Tiền tính giảm %: tổng các dịch vụ thuộc phạm vi của những điều kiện **đã đạt**.
  - Trang khách và email: dòng "Áp dụng cho" thay bằng mô tả điều kiện, ví dụ *"Menu VIP từ 90 phút"*, đủ 5 ngôn ngữ (`conditionLabels`).
- **Tương thích ngược:**
  - Campaign cũ có `applicableMenus` được chuyển sang 1 điều kiện không có ngưỡng; kết quả không đổi.
  - API vẫn nhận `applicableMenus`, server đổi sang `applyConditions`.
- **Khoá sửa:** campaign đã ACTIVE thì đổi điều kiện bị khoá (`CAMPAIGN_LOCKED`), giống các quy tắc khác.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — KTV không gọi API promo | Form campaign: khối "Điều kiện áp dụng" (B). Màn quét: lý do bị chặn rõ hơn. Trang khách / email: mô tả điều kiện | `promo_evaluate_conditions`, `promo_check_apply`, `promo_order_candidates`, `promo_compute_discount` | A: migration + RPC; B: UI |
| Số liệu | Phút KM vẫn tính tua khi áp; điều kiện chỉ quyết định **có áp được không** | Phút điều kiện = phút đã trả của dịch vụ thuộc phạm vi (cùng công thức `promo_order_minutes`) | `promo_order_minutes` | Một nguồn công thức |
| Realtime | Không ảnh hưởng | Danh sách đơn tải lại khi quét | — | — |
| Quyền | — | `promotions` sửa điều kiện; `dispatch_board` chỉ xem kết quả | — | Không đổi |

## 5. Test

- Từng loại điều kiện riêng lẻ: menu, category, dịch vụ, phút, tiền.
- `ALL` / `ANY`.
- Biên 89 / 90 phút.
- Phút KM không được tính vào điều kiện.
- Add-on chưa trả tiền không được tính.
- `canApply` khớp với kết quả apply thật.
- Giảm % chỉ tính trên phạm vi đã đạt.
- Campaign cũ (`applicableMenus`) cho kết quả không đổi.
- Nhãn 5 ngôn ngữ.
- Chạy trên local + Supabase test, cả `TZ=UTC`.

## 6. Cần user chốt

1. **"90 phút" tính thế nào?**
   - **Khuyến nghị:** tổng phút đã trả của các dịch vụ thuộc phạm vi trong đơn. VD VIP 60 + VIP add-on 30 đã trả tiền = 90 → đạt.
   - Cách còn lại: phải có **một** dịch vụ dài từ 90 phút.
2. **Ghép điều kiện:** chỉ cần `ALL` (tất cả) / `ANY` (một trong các) ở một cấp, không lồng nhóm. Đủ dùng không?
3. **Điều kiện tiền (`minAmount`):** có cần ngay đợt này không? Khuyến nghị: có, vì làm cùng không tốn thêm nhiều.
4. **Điều kiện phát tự động** (khi bật lại sau này): dùng chung bộ điều kiện này, tức đơn DONE đạt điều kiện thì được phát voucher? Khuyến nghị: có, để chỉ còn một kiểu cấu hình điều kiện.

## 7. Quyết định của user (03/10/2026) — ĐÃ DUYỆT, thay cho mục 3 ở những chỗ khác nhau

| # | Quyết định | Cách làm |
|---|---|---|
| C1 | Voucher xét theo **dịch vụ khách chọn khi gửi đơn**: khách gửi menu VIP 90 phút thì được tặng 30 phút | Điều kiện xét **từng dịch vụ**, không cộng dồn. Phút của dịch vụ = `vipDuration` → `duration` → `Services.duration`, **không nhân số lượng**. Chỉ xét dịch vụ gốc của đơn: bỏ add-on gọi thêm (`options.isAddon`), dịch vụ KM, dịch vụ tiện ích, dịch vụ huỷ, item gộp |
| C2 | Cần chọn được kiểu "menu Standard, **một trong** các dịch vụ đó, **từ 90 phút**" | Mỗi điều kiện = **VÀ** của các tiêu chí `menus` / `categories` / `serviceIds` / `minMinutes`. Mỗi tiêu chí là **một trong** danh sách. **Cùng một dịch vụ** phải thoả mọi tiêu chí. Các điều kiện ghép với nhau bằng `ALL` / `ANY` |
| C3 | Số tiền tối thiểu: có, không bắt buộc | `minOrderAmount` (tuỳ chọn) trong từng điều kiện = tổng tiền đã trả của đơn |
| C4 | Phát tự động dùng **chung một cấu hình** | `promo_evaluate_booking_for_campaign` dùng cùng `apply_conditions`. Campaign `AUTO` bắt buộc có ít nhất 1 điều kiện |

**Thay đổi so với hành vi cũ:**
- Ngưỡng 90 phút trước đây cộng dồn phút trong đơn và chỉ dùng cho phát tự động. Giờ xét theo từng dịch vụ, cho cả áp lẫn phát.
- `serviceIds` trước đây là "**hoặc**" với menu, giờ là "**và**".
- Campaign cũ được chuyển tự động: phạm vi + ngưỡng cũ → 1 điều kiện. Nếu có cả dịch vụ lẻ lẫn menu thì tách thành 2 điều kiện ghép `ANY`, để giữ nghĩa "hoặc" cũ.
- Mã chặn mới `ORDER_CONDITION_NOT_MET` thay cho `ORDER_MENU_NOT_ELIGIBLE`.

## 8. Kết quả

- **Test:**
  - `qa_promotion_engine.ts` 196 case (local + Supabase test, cả `TZ=UTC`), gồm các ví dụ của user: VIP 90 đạt / VIP 89 không / VIP 60 + gọi thêm 30 không; menu + một trong các dịch vụ + từ 90 phút; ALL / ANY; số tiền tối thiểu; giảm % theo dịch vụ đạt; phát tự động dùng chung cấu hình; chuyển đổi cấu hình cũ; khoá khi ACTIVE.
  - `qa_promotion_email.ts` 31 case.
  - Smoke HTTP 6 case.
- **Lỗi bắt được khi test:** `promo_update_campaign` nối chuỗi vào `text[]` thiếu ép kiểu (`'apply_conditions'::text`), làm hỏng việc báo khoá. Đã sửa.
- **Mục 9 của B:** pass trả thêm `conditionsSummary`, nên thẻ voucher thật hiện đúng "Menu VIP · từ 90 phút".

## 9. Sửa lỗi v11 (04/10/2026, B báo ở mục 12)

- **Lỗi:** `promo_customer_candidates` vẫn xét "có điều kiện" bằng `qualification_type`. Campaign tạo bằng `applyConditions` (mặc định `MANUAL_ASSIGNMENT`) bị `qualificationIgnored = true`, nên ô lọc "Có đơn đạt điều kiện" không lọc gì.
- **Sửa:** migration `20261004150500_promotion_engine_v11.sql`, xét "có điều kiện" bằng `apply_conditions` có ít nhất 1 điều kiện.
- **Rà soát:** không còn chỗ nào khác quyết định theo `qualification_type`. Trường này chỉ còn để hiển thị và để chuyển cấu hình cũ.
- **Test:** thêm 2 case. Đã xác nhận case mới **trượt trên hàm cũ** và đạt sau khi sửa. QA 216 case trên local + Supabase test, cả `TZ=UTC`.
