# Checklist go-live: E-Voucher giới hạn số lượng trên Web Booking

> Plan gốc: `plans/plan_evoucher_webbooking_gioi_han.md`. **Mức 2:** mỗi bước có ghi dữ liệu thật đều cần user duyệt riêng.
> Viết 08/10/2026. Trạng thái: **chưa chạy bước nào trên DB thật.**

## 0. Điều kiện trước khi bắt đầu (tất cả phải ✅)

| # | Điều kiện | Trạng thái 08/10 |
|---|---|---|
| 0.1 | GĐ1–2 (DB v15, Admin) PASS trên TEST | ✅ `qa_promotion_web_claim.ts` |
| 0.2 | GĐ4 phần DB (v16: writer bọc, xem trước) PASS trên TEST | ✅ W1–W10, P1–P7 |
| 0.2b | v17 (siết sau rà soát 09/10: tự chữa ACTIVE kẹt, chặn phát lách, ngày hẹn) PASS trên TEST | ✅ V1–V11; engine QA 213/3 (3 lỗi cũ có từ trước) |
| 0.3 | GĐ3 + GĐ4 phía WebBooking (cửa sổ B) xong, user OK, `npm run build` đạt | ⏳ |
| 0.4 | Test tay trên preview TEST: lưu voucher, checkout, Áp dụng, đặt; admin thấy số thay đổi trực tiếp | ⏳ |
| 0.5 | Preflight DB thật (chỉ đọc, chạy lại ngay trước khi go-live, xem mục 1) | ✅ 08/10 (phải chạy lại) |
| 0.6 | Code admin (thẻ Web Booking + API) đã merge vào nhánh mà quầy/admin đang dùng | ⏳ |
| 0.7 | Env `VOUCHER_IP_HASH_SECRET` đã thêm trên Vercel project WebBooking (Production) | ⏳ |
| 0.8 | GĐ3 + GĐ4 nằm trong **cùng một lần** merge vào `master` WebBooking (plan GĐ4: `plans/plan_gd4_webbooking_checkout_voucher.md`) | ⏳ |

## 1. Preflight DB thật (chỉ đọc). Kết quả 08/10/2026

- [x] Chưa có object v15/v16: `promo_web_*`, `PromotionWebClaims`, `PromotionCampaignStock`, cột `distribution_channel`…
- [x] `webbooking_commit_booking` **trùng khớp** với `plans/sql/baseline_webbooking_commit_booking_20261008.sql`.
- [x] Các hàm engine (`promo_apply_pass`, `promo_check_apply_ex`, `promo_evaluate_conditions`, `promo_on_booking_status`, `webbooking_commit_booking`) có **md5 giống hệt TEST**. Vì vậy kết quả QA trên TEST áp dụng được cho DB thật.
- [x] Có `pg_cron`, `pgcrypto` và publication `supabase_realtime`.
- [x] Migration mới nhất đã ghi nhận: `20261005120000` (v14).
- [x] Chương trình đang ACTIVE: `WB_OCT_2026` (PERCENT) và `OCT_VIP` (FREE_MINUTES). Cả hai là `ADMIN_ISSUE` và **không bị v15 đổi hành vi**. Riêng `promo_compute_discount_ex` được tách thân hàm sang `promo_compute_discount_core`, thân hàm giữ nguyên; bộ test engine cho kết quả giống hệt bản v14.

> Ngay trước khi go-live, chạy lại mục này. Nếu `webbooking_commit_booking` khác bản mốc, **DỪNG**: có người đã sửa writer, v16 phải được xem lại.

## 2. Thứ tự go-live (không đảo)

| Bước | Việc | Ai | Lùi lại |
|---|---|---|---|
| **1** | Chạy `20261008100000_promotion_web_claim_v15.sql`, `20261008150000_webbooking_commit_with_voucher_v16.sql`, rồi `20261009100000_promotion_web_claim_hardening_v17.sql` lên DB thật (chạy bằng lệnh có kiểm URL, **không** dùng `scripts/apply_migration_file.ts` vì nó đọc `.env.local` của repo), ghi vào `schema_migrations`. **Công tắc `promotion_web_claim_enabled` vẫn TẮT** (không có dòng = tắt). | Cửa sổ A, **user duyệt** | `rollback_promotion_web_claim_v17.sql` rồi `rollback_promotion_web_claim_v15.sql` |
| **2** | Probe sau migration (chỉ đọc): đủ hàm v15–v17 (`promo_web_heal_claims`, `promo_has_real_items`…), CHECK `promo_campaign_web_claim_kind_chk` và trigger `tr_promo_web_guard_pass_insert` có mặt; `WB_OCT_2026`/`OCT_VIP` vẫn `ADMIN_ISSUE` và áp tại quầy bình thường; cron `promo_web_expire_job` chạy `*/2`; anon chỉ đọc được `PromotionCampaignStock`; `webbooking_commit_booking` vẫn khớp bản mốc. | Cửa sổ A | — |
| **3** | Deploy code admin. Thẻ "Phát trên Web Booking" hiện ra; chương trình cũ vẫn hiện "đang phát theo cách thường". | User | Revert commit admin. Thẻ tự ẩn nếu DB chưa có v15 |
| **4** | Deploy WebBooking (`master` → oria-spa.vercel.app). Công tắc tắt nên khách **chưa thấy gì**; đặt lịch không voucher vẫn chạy y như cũ. | User | Revert commit WebBooking |
| **5** | Tạo chương trình thử **nội bộ**: 3 suất, giảm 10%, đường dẫn `test-noi-bo`, hạn 1 ngày. Bật công tắc. Bấm Lưu trên **điện thoại thật mở từ Zalo và Facebook** (kiểm BotID không chặn nhầm; chặn nhầm → revert BotID). Nhân viên dùng SĐT nội bộ đặt thật 1 đơn rồi **huỷ**: kiểm suất quay về kho, admin thấy số đổi trực tiếp, hoá đơn ở WRB đúng tổng. | User + cửa sổ A theo dõi | Tắt công tắc |
| **6** | Kết thúc chương trình thử. Tạo chương trình thật (VD 20 suất "Oria Booking Rewards"), kích hoạt. | Admin | Tạm dừng phát / Kết thúc |
| **7** | Theo dõi 48 giờ (mục 4). | Cửa sổ A | — |

## 3. Ảnh hưởng vận hành (trình lại trước bước 1 và trước khi commit)

| Ai | Khác gì so với hôm nay | Nếu lỗi thì ai không làm việc được | Cần báo / hướng dẫn |
|---|---|---|---|
| **Quầy** | Đơn web có voucher đến với **giá đã giảm** và một dòng `KM####` âm. Không cần quét mã. Mã voucher web **không áp được** cho đơn tại quầy, kể cả khi có quyền áp ngoại lệ. Huỷ đơn thì suất tự quay về kho. | Lỗi trigger promo có thể chặn đổi trạng thái đơn có voucher. Đã test huỷ, xong và áp ở quầy trên TEST | Báo: "đơn web có dòng giảm giá là voucher web, không cần thu thêm; khách mang mã web đến quầy thì không áp được" |
| **KTV** | Không đổi. Dòng giảm không có KTV, hoa hồng tính theo phút | Không ảnh hưởng | Không cần |
| **Admin** | Thẻ mới trên trang chi tiết chương trình: cấu hình, số liệu trực tiếp, tạm dừng, giải phóng, thu hồi | Lỗi thẻ chỉ làm hỏng thẻ đó; trang vẫn dùng được | Hướng dẫn: Tạm dừng ≠ Kết thúc; nút giải phóng dùng khi nghi bot |
| **Khách (web)** | Thấy thẻ voucher, bấm Lưu, checkout tự nhận voucher, bấm Áp dụng thấy giá giảm | **Đặt lịch có mã** lỗi → khách được hỏi "Đặt không kèm voucher?". Đặt lịch **không mã** đi đường cũ, không đổi | Không |

**Rủi ro và cách lùi:**
- **Tắt công tắc tổng là đủ dừng mọi thứ ngay.** Web ẩn thẻ, writer không nhận mã nữa.
- **Voucher đã kích hoạt** là dòng engine bình thường trên đơn, nên **giữ nguyên** (cam kết với khách). Không xoá.
- **Rollback DB:** chạy `rollback_promotion_web_claim_v15.sql` sau khi WebBooking đã quay về writer cũ.

**Deploy:** v15 + v16 **chưa** có trên DB thật. Code admin đang ở nhánh `feat/bit-lo-hong-phase1`, chưa commit. WebBooking làm ở nhánh `feat/web-evoucher` (cửa sổ B).

## 4. Theo dõi 48 giờ sau khi bật

- [ ] `SELECT status, count(*) FROM "PromotionWebClaims" GROUP BY 1`: số đã cấp không vượt tổng.
- [ ] Thẻ admin: cảnh báo "voucher kích hoạt quá 3 ngày" (`staleActive`) phải là 0; khác 0 → xem đơn ở quầy.
- [ ] Lượt RESERVED quá hạn hơn 10 phút mà chưa EXPIRED phải là 0. Nếu khác 0 thì cron chết; các RPC vẫn tự dọn, nhưng cần xem `cron.job_run_details`.
- [ ] Log Vercel của WebBooking: tỉ lệ `VOUCHER_REJECTED:*` và lỗi 409/500 ở `/api/bookings` (so với trước khi bật).
- [ ] Lượt lưu tăng vọt từ một vài IP: dùng **Giải phóng mọi lượt giữ** và Tạm dừng phát.
- [ ] Đối chiếu một đơn có voucher: hoá đơn WRB = `Bookings.totalAmount` = báo cáo doanh thu.

## 5. Đã đóng

- **B18 (hiển thị tiền ở WRB nội bộ):** đã kiểm bằng đọc code, không sửa gì.
  - `src/components/invoice/PrintableInvoice.tsx:273-276` cộng mọi dòng, kể cả dòng âm, nên đơn 300.000 có voucher ra 270.000, khớp `totalAmount`.
  - Journey dùng `Bookings.totalAmount`.
  - Hoa hồng KTV và doanh thu báo cáo đã kiểm ở GĐ0.
