# Plan — Voucher: cộng giá Phòng riêng vào tổng đơn + thời lượng phút tặng trên hàng điều phối

> **Mức 2**: đổi công thức tiền giảm trong engine SQL; đổi thời lượng KTV làm trên bảng điều phối. Yêu cầu user ngày 05/10/2026.

## A. Phòng riêng: tính vào tổng đơn; voucher giảm % giảm trên TỔNG ĐƠN — ĐÃ LÀM (05/10/2026)

**Hiện tại** (`promo_initial_items`, `promo_order_minutes`): tiện ích Phòng riêng (`NHS0900` / `Services.is_utility`) **bị loại khỏi tổng tiền**.
- Điều kiện "đơn từ X đồng" không tính giá phòng riêng.
- Giảm % chỉ tính trên dịch vụ đạt điều kiện (`discountScope` mặc định = dịch vụ đạt điều kiện), không gồm phòng riêng.

**User chốt:** giá Phòng riêng **được cộng vào tổng đơn**, và giảm % **giảm trên tổng đơn**.

**Thay đổi (migration v14):**
1. `promo_order_minutes.paidAmount`: cộng thêm tiền các dòng **tiện ích Phòng riêng** đã trả.
   - Vẫn **không** cộng dòng khuyến mãi (`KM####`), dòng đã huỷ, và dòng "không tính tiền" (`isPaid = false`).
2. `promo_evaluate_conditions`: `orderAmount`, dùng cho điều kiện "đơn từ X đồng", lấy theo **tổng đơn ở bước 1**, gồm phòng riêng.
3. `promo_compute_discount_ex`, voucher **giảm %**: tính trên **tổng đơn** (`paidAmount` ở bước 1), không còn chỉ trên dịch vụ đạt điều kiện.
   - Giảm tiền cố định không đổi.
   - Mức trần `maxDiscountAmount` vẫn áp dụng.
4. **Không đổi** cách xét menu / nhóm / dịch vụ / số phút: Phòng riêng không bao giờ làm một đơn "đạt điều kiện menu".

**Ví dụ:** VIP 90 phút 1.080.000đ + Phòng riêng 200.000đ, voucher giảm 10%.
- Trước: giảm 108.000đ.
- Sau: giảm **128.000đ**.

**Ảnh hưởng:**

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Tiền | Không đổi hoa hồng/tua: KTV tính theo dịch vụ, không theo tiền giảm | Hoá đơn: dòng giảm lớn hơn khi đơn có phòng riêng | Engine `promo_*` | Sửa |
| Voucher đã áp | Không đổi | Lượt đã áp **giữ nguyên số tiền** (đã ghi vào `PromotionUsages`) | — | Chỉ áp dụng cho lượt áp mới |

**Kiểm thử:** chạy trên TEST trước, đối chiếu số tiền giảm cho 4 trường hợp: có/không phòng riêng × voucher giảm % / giảm tiền cố định. Sau đó chạy lên DB thật (chạy thử rồi rollback, rồi mới COMMIT).

## B. Voucher tặng phút: thời lượng hàng điều phối = phút dịch vụ + phút tặng — ĐÃ LÀM (05/10/2026)

**User chốt:** không gộp vào dịch vụ chính; chỉ **hàng điều phối** có thời lượng mặc định = phút dịch vụ + phút tặng.

**Câu hỏi còn mở:**
1. Cộng vào hàng nào? Đề xuất: hàng dịch vụ chính **của cùng khách / giường** mà voucher đã gắn. Nếu khách đó có 2 dịch vụ thì cộng vào dịch vụ dài nhất.
2. Hàng "Tặng thêm 30 phút" xử lý thế nào? Đề xuất: **không điều phối riêng**, giống tiện ích. Nếu để cả hai thì bị cộng trùng.
3. KTV có được **tính giờ / tiền tua** cho phút tặng không? Đề xuất: **có**.

Sau khi chốt mới viết chi tiết phần B và các ca thử điều phối (mục 9 CLAUDE.md): 1 KTV 1 dịch vụ, 1 KTV 2 dịch vụ (gộp), 2 KTV 1 dịch vụ, ca qua nửa đêm.


## Kết quả (05/10/2026)

### A — đã làm
- Migration v14 `20261005120000` (hàm mới `promo_utility_amount`; sửa `promo_order_minutes`, `promo_evaluate_conditions`, `promo_compute_discount_ex`).
- Kiểm tra trên DB thật trong giao dịch rồi rollback, đơn `11NDK-011-05102026` (tổng 475.000đ, có phòng riêng 105.000đ):

  | | Tổng đơn (`paidAmount`) | Giảm 10% | Thời lượng |
  |---|---|---|---|
  | Trước v14 | 370.000đ | 37.000đ | 45p |
  | Sau v14 | 475.000đ | 47.500đ | 45p (không đổi) |

- Đã chạy thật: TEST COMMIT 1,98 giây, DB thật COMMIT 1,84 giây; đã ghi vào `schema_migrations`.

### B — đã làm
User chốt:
- Chặng khuyến mãi xem như một dịch vụ 30 phút.
- Khi "GỘP CHUNG KTV", hàng của nhân viên hiện phút dịch vụ + phút khuyến mãi.

Thay đổi:
- **Lỗi:** nút gộp không cộng phút chặng con vào thời lượng của KTV đã gán trên chặng cha, nên hàng KTV vẫn hiện 90p.
- **Sửa:** thêm `QuickDispatchTable.logic.ts` → `mergeServicesIntoParent`, cộng phút chặng con (trừ tiện ích) vào phân đoạn đầu của từng KTV trên chặng cha, theo đúng quy tắc của gộp kéo thả.
- **Mô phỏng 6/6 ca:** 1 KTV gán trước; chưa gán KTV; 2 KTV; có phòng riêng; qua nửa đêm 23:00→01:00; gộp 2 dịch vụ thường 90+60=150p.
