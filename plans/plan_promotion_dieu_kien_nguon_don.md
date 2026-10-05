# Plan — Điều kiện voucher theo NGUỒN ĐƠN (Web Booking / Walk-in / Đặt trước)

> **Mức 2**: đổi luật áp voucher trong engine SQL (đơn nào được giảm tiền hoặc tặng phút). User yêu cầu gấp ngày 05/10/2026.
> Trạng thái: **đã làm (05/10/2026)**. Migration v13 đã chạy trên TEST và DB thật; code đang ở nhánh `feat/promotion-frontend`.

## 1. Dữ liệu thật (DB thật, chỉ đọc)

`Bookings.source` **không đủ để phân loại**. Từ khoảng 23/09, đơn web lưu `source = STANDARD_WALK_IN` nhưng mang mã bill `WB-…`. Đơn đặt trước tạo ở quầy thì có ghi chú `WEB_ADVANCE_BOOKING`.

| `source` | Tổng | Đơn gần nhất | Mã bill `WB-` | Ghi chú `WEB_ADVANCE_BOOKING` |
|---|---|---|---|---|
| STANDARD_WALK_IN | 4396 | 04/10 | 71 | 38 |
| VIP_WALK_IN | 198 | 04/10 | 0 | 25 |
| WEB_BOOKING | 64 | 16/09 | 62 | 1 |
| STANDARD_BOOKING | 26 | 24/09 | 0 | 17 |
| MIXED_WALK_IN | 22 | 27/09 | 0 | 2 |
| STANDARD_MENU | 17 | 02/09 | 3 | 0 |
| WebBooking | 10 | 23/09 | 10 | 0 |
| VIP_BOOKING / MIXED_BOOKING / VIP_MENU / BOOKING_WALK_IN | 8 / 2 / 3 / 1 | cũ | 0 | 4 / 2 / 0 / 0 |

## 2. Quy tắc phân nguồn (một hàm SQL dùng chung)

`promo_booking_channel(booking)` trả về **đúng một** nguồn, xét theo thứ tự:

1. **WEB_BOOKING**: mã bill bắt đầu `WB-`, hoặc `source` thuộc `WEB_BOOKING`, `WebBooking`, `HOME_BOOKING`.
2. **ADVANCE_BOOKING** (đặt trước tại quầy): `notes` có `WEB_ADVANCE_BOOKING`, hoặc `source` kết thúc bằng `_BOOKING` (`VIP_`, `STANDARD_`, `MIXED_BOOKING`).
3. **WALK_IN**: các đơn còn lại (`*_WALK_IN`, `NDK-…`, `*_MENU`…).

Màn quét voucher, bộ lọc khách "có đơn đạt điều kiện" và câu điều kiện trên thẻ đều gọi chung hàm này.

## 3. Thay đổi

### DB (migration v13, chạy TEST trước, rồi DB thật)
- Hàm `promo_booking_channel(b "Bookings")`, `IMMUTABLE`, đặt ở `SECURITY DEFINER` giống các hàm khác.
- Mỗi điều kiện trong `apply_conditions` nhận thêm `sources text[]`, tuỳ chọn. Rỗng nghĩa là mọi nguồn.
  - Đơn chỉ đạt điều kiện khi `promo_booking_channel(b)` nằm trong `sources`, cộng thêm các tiêu chí cũ (menu / nhóm / dịch vụ / phút / tiền) theo logic AND như hiện nay.
- Bộ đánh giá điều kiện (dùng chung cho áp voucher, danh sách đơn ở màn quét, lọc khách) thêm lý do không đạt `ORDER_SOURCE_NOT_ALLOWED`, ví dụ "Đơn không đến từ Web Booking".
  - Quầy vẫn **áp ngoại lệ** được, có ghi lý do, như các điều kiện khác.
- `promo_conditions_summary`: thêm `sources` (mã nguồn).
- Không đổi dữ liệu cũ. Chương trình đang có không có `sources`, tức áp mọi nguồn như trước.

### API / TS (A + B)
- `promotion.schema.ts`: `sources?: ('WEB_BOOKING'|'WALK_IN'|'ADVANCE_BOOKING')[]`. Điều kiện chỉ có nguồn vẫn hợp lệ.
- `formatPromotionConditions`: câu 5 ngôn ngữ, ví dụ
  - EN: "Web Booking orders · Menu VIP · 90 min or longer"
  - VI: "Đơn Web Booking · Menu VIP · từ 90 phút"
- Danh sách đơn ở màn quét trả thêm `channel`, thẻ đơn hiện nhãn nguồn.

### Giao diện admin (B)
- Bộ soạn điều kiện thêm hàng chip **"Nguồn đơn"**: Web Booking · Khách tại quầy · Đặt trước. Không chọn nghĩa là mọi nguồn.
- Thẻ đơn ở màn quét có nhãn nguồn. Đơn sai nguồn hiện "Chưa đủ điều kiện" kèm lý do.
- Mock + QA thêm các ca: `WB-` → web, `notes` đặt trước → advance, `*_WALK_IN` → walk-in, `sources` rỗng → mọi nguồn.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng: KTV không áp voucher | Form chương trình, màn quét, lọc khách, thẻ voucher, email | Hàm SQL đánh giá điều kiện, `promo_booking_channel` | Sửa |
| Tiền / phút | Không đổi cách tính | Chỉ đổi **đơn nào được áp** | Engine | Khớp, vì mọi nơi dùng một hàm |
| Realtime | Không đổi | Không đổi | — | — |
| Quyền | — | Áp ngoại lệ vẫn cần quyền `promotions_override` | — | Không đổi |

## 5. Rủi ro

- Phân loại dựa vào **quy ước mã bill / ghi chú** (`WB-`, `WEB_ADVANCE_BOOKING`). Nếu WebBooking hoặc quầy đổi cách ghi sau này thì phải sửa **một hàm**.
- Đơn `*_MENU` (cũ, đơn gần nhất 02/09) xếp vào **Walk-in**. Chờ user xác nhận.

## 6. Cần user chốt

1. Đơn **web đặt cho ngày sau** (mã `WB-`, ngày hẹn sau ngày tạo) tính là **Web Booking** (khuyến nghị) hay **Đặt trước**?
2. "Đặt trước" = đơn **quầy tạo trước** (ghi chú `WEB_ADVANCE_BOOKING` / `*_BOOKING`), đúng không?
3. Đơn `STANDARD_MENU` / `VIP_MENU` (gọi món bằng QR tại spa, dữ liệu cũ) tính là **Walk-in**?


## 7. User chốt và kết quả (05/10/2026)

**User chốt:**
1. Đơn web đặt cho ngày sau tính là **Web Booking**.
2. **Đặt trước** = đơn đặt trước nội bộ, mã đơn bắt đầu `BK-`. Kiểm tra trên DB thật: cả 89 đơn có ghi chú `WEB_ADVANCE_BOOKING` đều mang mã `BK-`.
3. `*_MENU` tính là **Walk-in**.
4. Không đụng cron.

**Kết quả:**
- **Quy tắc trên DB thật (30 ngày):** Walk-in 773, Web Booking 83, Đặt trước 10.
- **Migration v13 `20261005090000`:**
  - Chạy thử trên TEST, rồi COMMIT trên TEST.
  - Trên DB thật: rollback thử, rồi COMMIT trong 783 ms và ghi vào `schema_migrations`.
  - 2 chương trình đang có vẫn hợp lệ.
- **Kiểm tra trên DB thật:** đơn `WB-…` gặp điều kiện chỉ Walk-in thì không đạt, lý do *"Cần đơn Khách tại quầy — đơn này là Web Booking"*.
- **QA frontend:** 178/178.
