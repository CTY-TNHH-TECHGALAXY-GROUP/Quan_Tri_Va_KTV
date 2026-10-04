# Plan — Chạy migration Promotion Engine (v1 → v12) lên DB thật

> **Mức 2** (DB thật, dùng chung cho 3 app: admin, NganHa-WebBooking, web nội bộ). Yêu cầu user ngày 04/10/2026.
> Trạng thái: **ĐÃ CHẠY lên DB thật ngày 04/10/2026** (user duyệt: đổi tên 3 file, chạy ngay, B chạy bằng script).

## 1. Kiểm tra chỉ đọc trên DB thật (`adzfohfdindovfcpaizb`, ngày 04/10/2026)

| Mục | Kết quả |
|---|---|
| Bảng / hàm `promo_*` | Chưa có (0 bảng, 0 hàm), tức DB sạch |
| `pg_cron`, `pgcrypto`, `jsonb_unwrap_string` | Có |
| Cột `Services` mà engine dùng (`is_utility`, `service_group`, `min_ktv_required`, `code`, `tags`, `description`) | Có. Chỉ thiếu `is_promotion`, migration sẽ thêm |
| `BookingItems.options` (jsonb), `Bookings.status` (enum `BookingStatus`) | Đúng kiểu engine cần |
| Dịch vụ `KM####`, key `promotion_*` trong `SystemConfigs` | Chưa có |
| Trigger đang có trên `Bookings` / `BookingItems` | 10 trigger (thông báo, KTV loại D, dispatch…). Engine thêm 3 trigger mới, không đụng các trigger cũ |

## 2. Lỗi phải sửa trước: trùng mã version migration

| File promotion | Trùng với | Ở đâu |
|---|---|---|
| `20261002120000_promotion_engine.sql` | `20261002120000_rating_notifications_by_scale` | **DB thật đã ghi**; nhánh `bit-lo-hong-phase1`, `sequential…` |
| `20261003090000_promotion_engine_v4.sql` | `20261003090000_unschedule_broken_photo_jobs` | **`main`**, `bit-lo-hong-phase1`, `sequential…` |
| `20261004150000_promotion_engine_v11.sql` | `20261004150000_fix_orphan_assignment_blocks_release` | `bit-lo-hong-phase1` |

**Cách sửa:** đổi tên 3 file promotion sang version chưa ai dùng (đổi tên, nội dung giữ nguyên), rồi kiểm lại không còn trùng trên mọi nhánh:
- `20261002120500_promotion_engine.sql`
- `20261003090500_promotion_engine_v4.sql`
- `20261004150500_promotion_engine_v11.sql`

## 3. Migration làm gì với dữ liệu đang chạy

- **Bảng mới:** `PromotionCampaigns`, `CustomerPromotionPasses`, `PromotionUsages`.
  - Bật RLS và thu hồi mọi quyền của `anon` / `authenticated`.
  - Hàm chỉ cấp quyền cho `service_role`.
  - Bảng `PromotionIssueErrors` được tạo ở v1 rồi xoá ở v10.
- **`Services`:** thêm cột `is_promotion boolean NOT NULL DEFAULT false`.
  - Postgres 11+ chỉ ghi metadata, không viết lại bảng.
  - Lúc chạy migration **không** thêm hay sửa dòng dịch vụ nào. Dịch vụ `KM####` chỉ sinh ra khi admin tạo chương trình.
- **3 trigger mới:**
  - `tr_promo_on_booking_status`: đơn chuyển `DONE` hoặc `CANCELLED`.
  - `tr_promo_on_item_cancel`, `tr_promo_on_item_delete`: chặng khuyến mãi bị huỷ hoặc xoá.
  - Bản v10 bọc toàn bộ trong `EXCEPTION WHEN OTHERS → RAISE WARNING`, nên **lỗi khuyến mãi không thể chặn quầy đổi trạng thái đơn**.
  - Khi chưa có chương trình nào, mỗi lần đơn chuyển `DONE` / `CANCELLED` trigger chỉ đọc thêm 1–2 câu SELECT rỗng.
- **`pg_cron`:** thêm job `promo_expire_passes_job`, chạy lúc 00:05 giờ VN mỗi ngày, chỉ cập nhật bảng khuyến mãi.
- **`SystemConfigs`:** thêm các key `promotion_*` (`ON CONFLICT DO NOTHING`), không đè key nào đang có.
- **Không** sửa hay xoá dữ liệu `Bookings`, `BookingItems`, `Customers`, `Staff`, ví, tua.

## 4. Cách chạy

1. **Sửa version** (mục 2), commit và push nhánh. Không đụng `main`.
2. **Chạy thử trên DB thật trong một giao dịch rồi ROLLBACK:**
   - Đặt `SET lock_timeout = '5s'` và `statement_timeout = '120s'`. Nếu DB đang bận và không lấy được khoá thì dừng hẳn, **không chờ, không chặn quầy**.
   - Chạy đủ 12 file theo thứ tự.
   - Kiểm: 3 bảng, khoảng 85 hàm `promo_*`, 3 trigger, job cron, `promo_menu_catalog()`, `promo_overview()`.
   - `ROLLBACK`, rồi kiểm lại DB vẫn sạch.
   - Ghi thời gian giao dịch. Trên TEST mất dưới 3 giây.
3. **Chạy thật**, cùng script nhưng `COMMIT`:
   - Ghi 12 dòng vào `supabase_migrations.schema_migrations`, để sau này `supabase db push` không chạy lại.
   - Nên chạy **giờ vắng khách**. Lý do: `CREATE TRIGGER` giữ khoá `Bookings` trong vài giây, nên lượt ghi đơn trong lúc đó sẽ phải chờ.
4. **Kiểm sau khi chạy:**
   - Lặp lại các kiểm tra ở bước 2.
   - Xem log Postgres không có cảnh báo `promo trigger`.
   - Mở màn điều phối, xác nhận đơn vẫn chuyển `DONE` / huỷ bình thường.
5. **Sau khi DB đã có migration** mới deploy code khuyến mãi lên Vercel thật, làm thành bước riêng.
   - Cần env: `PROMOTION_SCAN_BASE_URL`, `CRON_SECRET`.
   - Nên đổi `SMTP_FROM_NAME` thành `OriaSpa`.

## 5. Cách lùi

Chuẩn bị sẵn `plans/sql/rollback_promotion_engine.sql`, chạy trong một giao dịch:
1. `cron.unschedule('promo_expire_passes_job')`.
2. Xoá 3 trigger.
3. Xoá các hàm `promo_*`.
4. Xoá 3 bảng khuyến mãi. Chỉ an toàn khi **chưa phát voucher thật**, nếu đã phát thì phải sao lưu trước.
5. Xoá cột `Services.is_promotion`, chỉ khi chưa có dịch vụ `KM####`.
6. Xoá các key `promotion_*` trong `SystemConfigs`.
7. Xoá 12 dòng trong `schema_migrations`.

**Lùi nhanh, không mất dữ liệu:** chỉ cần xoá 3 trigger. Engine khi đó không còn phản ứng với đơn.

## 6. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng: code đang chạy (`main`) chưa có khuyến mãi | Không ảnh hưởng cho tới khi deploy code khuyến mãi | `Bookings` / `BookingItems` thêm trigger tự bắt lỗi; `Services` thêm 1 cột | An toàn |
| Tiền, tua, giờ | Không đổi | Không đổi | Trigger chỉ ghi bảng khuyến mãi, không tính lại tiền hay tua | Khớp |
| Realtime | Không thêm kênh | Không thêm kênh | Bảng `Services` có thêm 1 cột | Không ảnh hưởng |
| Quyền | — | — | Bảng và hàm mới chỉ cho `service_role`; `anon` không đọc được | Không lộ dữ liệu |
| WebBooking / web nội bộ | — | — | Đọc `Services`: cột mới mặc định `false` | Không ảnh hưởng |

## 7. Cần user chốt

1. Đồng ý **đổi tên 3 file** để hết trùng version.
2. **Thời điểm chạy thật:** giờ nào quầy vắng nhất? Bước chạy thử (rollback) có thể làm ngay.
3. Ai chạy:
   - **Khuyến nghị:** B chạy bằng script (có chạy thử, `lock_timeout`, kiểm tra trước và sau).
   - Hoặc user dán từng file vào Supabase SQL Editor.


## 8. Kết quả chạy (04/10/2026)

- **Đổi tên version:** commit `fbc4e466`.
- **Chạy thử rồi ROLLBACK trên DB thật:**
  - 12/12 file qua, giao dịch 3,25 giây.
  - Sau rollback DB sạch: 0 bảng, 0 hàm, 0 trigger, 0 job cron.
- **Chạy thật:** COMMIT trong 2,67 giây, kết quả:
  - 3 bảng, 85 hàm `promo_*`, 3 trigger (đang bật).
  - Job cron `promo_expire_passes_job` (`5 17 * * *`, bật).
  - Cột `Services.is_promotion`, 4 key `promotion_*`.
  - 12 dòng trong `schema_migrations`.
- **`promo_menu_catalog`:** NHP 14, NHS 63. Thiếu NHT vì RPC còn lọc `isActive` (mục 13 của file yêu cầu cho A).
- **Quyền:** `anon` đọc bảng hoặc gọi RPC khuyến mãi đều bị từ chối (42501).
- **Chưa xác nhận lượt chạy thật của trigger:** 15 phút sau khi chạy chưa có đơn nào đổi trạng thái. Theo dõi đơn `DONE` / huỷ đầu tiên và log Postgres (`promo trigger`).
- **Code khuyến mãi chưa deploy lên bản đang chạy.**
