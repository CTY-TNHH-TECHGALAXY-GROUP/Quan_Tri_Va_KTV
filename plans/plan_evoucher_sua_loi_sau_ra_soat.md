# Plan sửa lỗi E-Voucher web sau rà soát (09/10/2026)

> Rà soát chỉ đọc 3 mảng: SQL v15/v16, WebBooking (`f7db031` GĐ3 + `fd66dae` GĐ4), phía quầy/admin/KTV/tài chính.
> Lỗi agent nghi ngờ đã được A tự kiểm lại trên code + TEST. **Mức 2** (SQL, trigger, luồng quầy). Chưa sửa gì.

## 0. Kết luận chung

- **Không có đường bán vượt số suất.** Mọi chỗ đổi suất đều khoá dòng campaign trước; reserve đếm lại sau khi khoá.
- **Đơn không mã trên web, KTV, hoa hồng, tua, giờ, doanh thu: không bị ảnh hưởng** (đã kiểm: dòng KM không KTV, bị lọc vì `is_utility=true` với loại giảm tiền; doanh thu dùng `totalAmount` net).
- **Vấn đề thật:** (1) suất bị **kẹt ACTIVE mãi** ở vài luồng quầy, (2) **luật "chỉ web" và giới hạn suất có thể bị lách** qua đường phát của admin, (3) một số lỗi hiển thị/UX ở WebBooking.
- Đã loại: "đơn web bị nhảy sang đang làm do dòng KM `DONE`": các chỗ tính lại trạng thái đã lọc dịch vụ `is_utility` (đúng cho PERCENT/FIXED; KM của FREE_MINUTES không phải utility → xem A3).

## 1. Quyết định (user chốt 09/10/2026: cả 3 theo khuyến nghị)

- **D1:** cuối ngày hẹn 23:59 giờ VN, đơn vẫn NEW/PREPARING → tự huỷ voucher của đơn, trả suất.
- **D2:** ngày hẹn phải trong thời gian chương trình → `BOOKING_DATE_OUT_OF_RANGE`.
- **D3:** chỉ chương trình mới (chưa có pass, PERCENT/FIXED, phát thủ công) được chuyển sang phát trên web.

Bảng gốc:

| # | Câu hỏi | Khuyến nghị |

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| D1 | Đơn web có voucher mà khách **không đến**, quầy không bấm huỷ: khi nào tự trả suất? (DB không có trạng thái NO_SHOW) | Cuối ngày hẹn (23:59 giờ VN), đơn vẫn NEW/PREPARING → tự huỷ voucher của đơn (đơn giữ nguyên, dòng giảm bị huỷ, tổng về giá gốc), trả suất. Khách đến trễ sau đó thì trả giá gốc |
| D2 | Khách đặt **ngày hẹn sau khi chương trình kết thúc** (đặt hôm nay cho tháng sau): cho giảm không? | **Không.** Ngày hẹn phải nằm trong thời gian chương trình. Mã lỗi mới `BOOKING_DATE_OUT_OF_RANGE` |
| D3 | Có cho chuyển **chương trình đang chạy** (đã phát mã kiểu cũ, VD `WB_OCT_2026`) sang phát trên web? | **Không.** Chỉ chương trình chưa có mã nào, loại giảm % hoặc giảm tiền, chế độ phát thủ công |

## 2. Lỗi phía DB (A sửa, migration v17, chỉ TEST trước)

| # | Mức | Lỗi (đã xác nhận) | Sửa |
|---|---|---|---|
| A1 | **Cao** | **Suất kẹt ACTIVE mãi**: (a) quầy **tách đơn** (`split_booking_into_sub_bookings`): usage vẫn trỏ đơn cha `SPLIT`, đơn con xong không ai cập nhật; (b) khách không đến (D1); (c) đơn dừng ở FEEDBACK/CLEANING không lên DONE; (d) trigger promo bọc `EXCEPTION WHEN OTHERS → WARNING` nên lỗi trong trigger web (deadlock khi 1 giao dịch đổi 2 đơn cùng campaign) bị nuốt. Hậu quả: mất suất + SĐT bị khoá vì "đang có 1 voucher mở" | Thêm **bước tự chữa** vào `promo_web_expire_all` (cron 2 phút): với claim ACTIVE: đơn CANCELLED → huỷ usage; đơn DONE → REDEEMED; đơn SPLIT → theo đơn con (có con DONE → REDEEMED, tất cả huỷ → huỷ); đơn NEW/PREPARING quá hạn D1 → huỷ usage. Thêm cột cảnh báo "ACTIVE > 3 ngày" vào stats admin |
| A2 | Trung bình | **Huỷ hết dịch vụ thì voucher bị "đốt"**: quầy huỷ/xoá từng dịch vụ đến hết → trạng thái tính lại ra DONE (`BookingModificationService.ts:386-388` fallback về chính dòng KM) → usage COMPLETED, claim REDEEMED, mất suất | Trong nhánh DONE của `promo_on_booking_status`: không còn dòng dịch vụ thật nào chưa huỷ → **huỷ usage** thay vì hoàn tất. Áp dụng chung cho cả voucher admin (cũng đúng cho họ) |
| A3 | Trung bình-cao | **Lách "chỉ web" và giới hạn suất**: `promo_issue_manual/bulk`, phát AUTO, áp tại quầy không xét `distribution_channel`. Chuyển chương trình AUTO/đang có mã sang web → phát vô hạn. `promo_web_configure` nhận cả FREE_MINUTES (dòng KM cần KTV/phòng, sai với đơn web) | `promo_web_configure`: chỉ PERCENT/FIXED, không AUTO, không có pass cũ (D3). `promo_insert_pass`: campaign WEB_CLAIM chỉ nhận nguồn WEB_CLAIM. `promo_check_apply_ex`: pass WEB_CLAIM chỉ áp từ `promo_web_activate` → `WEB_BOOKING_REQUIRED` |
| A4 | Trung bình | Admin bấm **Huỷ pass** web đang ACTIVE: usage và dòng giảm vẫn còn, đơn xong vẫn REDEEMED | `promo_set_pass_status`: pass WEB_CLAIM có usage APPLIED → từ chối, chỉ dẫn "Giải phóng/thu hồi trên thẻ Web Booking" (đã có `promo_web_release`) |
| A5 | Thấp | Thẻ "còn X" có thể **cũ** sau khi tự hết hạn (reserve trả RATE_LIMITED/PAUSED…, configure lỗi) vì không refresh kho; trạng thái kho không có "chưa mở" và "công tắc tắt" | Refresh kho ở mọi nhánh trả về sau khi expire; thêm trạng thái `NOT_STARTED` (trước `valid_from`) |
| A6 | Theo D2 | `promo_web_activate` không xét ngày hẹn | Ngày hẹn (giờ VN) phải ≤ `valid_until` → `BOOKING_DATE_OUT_OF_RANGE`. `promo_web_preview` trả cùng lý do |
| A7 | Thấp | Mã web trùng mã cũ (xác suất cực nhỏ) → lỗi 23505 thô | Khi sinh mã, kiểm thêm `CustomerPromotionPasses.voucher_code` |

## 3. Lỗi phía admin/quầy (A sửa, code TS)

| # | Mức | Lỗi | Sửa |
|---|---|---|---|
| C1 | Trung bình | **Một cú bấm chuyển chương trình đang chạy sang web**, không hỏi lại, không có đường quay lại (`CampaignWebClaimCard.tsx:271-283`) | Chỉ hiện nút "Bật phát trên web" khi chương trình đủ điều kiện D3; hộp xác nhận. DB chặn thêm (A3) |
| C2 | Trung bình | **Quầy xác nhận đơn web VIP có voucher → thành `MIXED_WALK_IN`** vì dòng `KM####` bị tính là dịch vụ thường (`app/reception/web-booking/actions.ts:300-311`). Gán `guest_id` xoay vòng cũng tính dòng KM (`:393-397`) | Bỏ qua dòng `options.isPromotion` ở cả hai chỗ |
| C3 | Thấp | Báo cáo: tổng số dịch vụ và bảng dịch vụ đếm dòng KM ("60p" do fallback) (`finance/reports/route.ts:332`, `reports/services/route.ts:46`, `FinanceReportService.ts:139`) | Lọc dòng isPromotion khỏi số đếm và bảng dịch vụ. **Doanh thu không đổi** |
| C4 | Thấp | Pass web hiện nhãn "Thủ công" (`issueSource` chỉ có AUTO/MANUAL) | Thêm `WEB_CLAIM` vào type + nhãn "Web Booking" |
| C5 | Thấp | Thẻ admin: đổi bộ lọc nhanh có thể bị kết quả cũ ghi đè; claim ACTIVE→REDEEMED chỉ thấy sau 30s | Đánh số request; nghe thêm realtime trên `PromotionWebClaims`? → **Không** (bảng không public). Giữ poll 30s, thêm nút tải lại |

## 4. Lỗi phía WebBooking (B sửa trên `feat/web-evoucher`)

| # | Mức | Lỗi | Sửa |
|---|---|---|---|
| W1 | Trung bình | Kết quả xem trước **cũ/đảo thứ tự**: bấm Áp dụng rồi đổi giỏ trước khi có kết quả → hiện số giảm của giỏ cũ (`CheckoutVoucher.logic.ts:91-132`). Tiền ghi vẫn đúng (writer tính lại) nhưng màn hình/modal lệch | Gắn `cartKey`/request id, bỏ kết quả không khớp giỏ hiện tại |
| W2 | Trung bình | **Mất voucher âm thầm**: xem lại khi đổi giỏ gặp 429/500/mất mạng → `setApplied(null)` → đặt giá gốc mà không hỏi | Lỗi tạm thời: giữ mã, hiện "chưa cập nhật được số giảm", để writer quyết |
| W3 | Thấp-TB | Nhánh replay trả `voucherCode` lấy từ request → client xoá nhầm mã khỏi ví | Chỉ xoá khỏi ví sau khi `/api/vouchers/{code}` báo ACTIVE/REDEEMED |
| W4 | Thấp | Sau VOUCHER_REJECTED chọn "Quay lại" → mã vẫn áp → lặp lỗi; khối voucher ẩn nhưng mã vẫn gửi | Xoá `applied` khi bị từ chối; không gửi mã khi khối ẩn |
| W5 | Thấp | Thẻ không xét `validUntil` → chương trình hết hạn vẫn hiện "Đang phát" đến khi có ghi DB | So `validUntil`/`validFrom` với giờ hiện tại |
| W6 | Thấp | `version` kho reset về 1 khi dòng kho bị xoá rồi tạo lại → tab đang mở bỏ qua mọi cập nhật | DELETE/ẩn → reset version đang giữ |
| W7 | Thấp | `%` lẻ trong URL → 500 (`api/vouchers/[code]:22`, `v/[code]/page.tsx:43`) | try/catch `decodeURIComponent` |
| W8 | Thấp | Preview: `BOOKING_ITEMS_LIMIT`, `CATALOG_INVALID` ra 500 | Map như lỗi SERVICE_ |
| W9 | Thấp | Email giảm 100% mất dòng Tổng (`totalAmount > 0`) | Hiện Tổng khi có giảm |
| W10 | Thấp | Thiếu env `VOUCHER_IP_HASH_SECRET` → thẻ vẫn hiện nhưng Lưu luôn 500 | Route danh sách kiểm env, thiếu thì trả `[]` |
| W11 | Thấp | Thiếu `import 'server-only'`; `/api/vouchers` và `/v` trả nguyên `benefit_config` | Thêm `server-only`; chỉ trả field cần |
| W12 | Theo D2 | i18n mã `BOOKING_DATE_OUT_OF_RANGE` | 5 ngôn ngữ |

## 5. Ảnh hưởng chéo & vùng nổ (4.1/4.5)

- **KTV:** không đổi (không sửa `app/ktv/*`, dispatch handler).
- **Quầy:** C2 sửa `confirmWebBooking` (đường dùng hằng ngày): chỉ bỏ qua dòng `isPromotion`, đơn không voucher **không đổi**. A2 đổi trigger DONE: chỉ khác khi đơn **không còn dịch vụ thật** (trước đây ghi nhận dùng voucher, nay huỷ). A1 cron chỉ đụng claim web ACTIVE.
- **Tài chính:** C3 chỉ đổi số đếm dịch vụ, không đổi doanh thu.
- **Admin:** A3/A4/C1 chặn thêm thao tác sai; voucher admin cũ (`ADMIN_ISSUE`) không đổi hành vi, trừ A2 (đúng hơn) và A3 nhánh `promo_check_apply_ex` (chỉ chặn pass WEB_CLAIM).
- **Khách:** WebBooking W1–W12; đơn không mã vẫn không đổi.
- **Cô lập:** v17 là `CREATE OR REPLACE`, rollback = chạy lại thân hàm v15/v16/v10 (sẽ dump bản mốc trước khi sửa).

## 6. Thứ tự làm & test

1. Anh/chị chốt D1–D3.
2. A: migration v17 + C1–C5 → chạy lên **TEST**, mở rộng `qa_promotion_web_claim.ts` (tách đơn, huỷ hết dịch vụ, khách không đến, phát lách, huỷ pass, ngày hẹn ngoài hạn) + chạy lại `qa_promotion_engine.ts` (kỳ vọng 213/3 lỗi cũ như trước).
3. B: W1–W12 trên `feat/web-evoucher` (commit mới, không sửa commit cũ).
4. **Test tích hợp trên nhánh mới + DB TEST** (mục 7).

## 7. Test tích hợp (nhánh mới, DB TEST)

- **Admin:** nhánh mới `test/evoucher-web` tạo từ nhánh admin hiện tại + commit tính năng → deploy lên project Vercel Hobby (env TEST, crons rỗng).
- **WebBooking:** chạy `feat/web-evoucher` local với `.env.local` TEST (đã có). ⚠️ **Không dùng preview Vercel của WebBooking** trừ khi đã đặt env Preview trỏ TEST: env Preview mặc định có thể trỏ DB thật.
- Kịch bản tay (người thật, 2 điện thoại):
  1. Admin tạo chương trình 3 suất → web thấy "Còn 3/3" trực tiếp.
  2. 2 máy Lưu → "Còn 1/3"; máy 3 Lưu → hết; máy 4 thấy "Đã hết".
  3. Đặt đơn có voucher → quầy (WRB/admin TEST) thấy đơn WB- có dòng giảm, xác nhận đơn (VIP và thường), điều phối, hoàn tất → claim REDEEMED.
  4. Đơn khác: quầy **tách đơn** → hoàn tất đơn con → claim REDEEMED (A1).
  5. Đơn khác: quầy huỷ từng dịch vụ đến hết → suất quay về (A2).
  6. Đơn khác: không làm gì đến hết ngày hẹn → suất tự quay về (A1/D1, có thể chỉnh giờ để test).
  7. Hoá đơn WRB, báo cáo doanh thu, app KTV của đơn có voucher: số khớp.
  8. Tắt công tắc giữa chừng; tạm dừng; giải phóng.

## 8. Tiến độ (09/10/2026, cửa sổ A)

- ✅ **v17** `supabase/migrations/20261009100000_promotion_web_claim_hardening_v17.sql` chạy trên **TEST** (chạy lại lần 2 vẫn đạt). Gồm A1–A6. A7 không cần: `promo_web_reserve` đã kiểm trùng mã với `CustomerPromotionPasses`.
  - Khác plan: **A5 không thêm trạng thái kho `NOT_STARTED`** (đổi hợp đồng với WebBooking); thẻ web tự so `validFrom` (W5).
  - Bản mốc: `plans/sql/baseline_promo_functions_before_v17_20261009.sql`. Lùi: `plans/sql/rollback_promotion_web_claim_v17.sql` (đã chạy thử trên TEST trong transaction rồi huỷ).
- ✅ QA `scripts/qa/qa_promotion_web_claim.ts`: thêm V1–V11 (tách đơn, huỷ hết dịch vụ, khách không đến, trigger lỗi, ngày hẹn, huỷ pass web, áp mã web tại quầy, phát tay/hàng loạt/chèn thẳng, chuyển chương trình không đủ điều kiện, thẻ cũ sau khi hết hạn) → **PASS toàn bộ**. QA engine `qa_promotion_engine.ts`: 213 đạt / 3 lỗi cũ (giống trước v17).
- ✅ C1 thẻ admin: ẩn nút Bật + hiện lý do khi không đủ điều kiện; hộp xác nhận trước khi bật; cảnh báo `staleActive`; chống kết quả cũ ghi đè; reset version khi đổi chương trình.
- ✅ C2 `app/reception/web-booking/actions.ts`: bỏ dòng KM khi xác định VIP/MIXED và khi chia khách. `lib/booking-email.logic.ts`: email xác nhận bỏ dòng KM (không thành 1 dịch vụ + 1 khách); đã kiểm bằng script.
- ✅ C3 báo cáo: dòng KM không tính vào số dịch vụ, không tính vào phút giường (công suất); vẫn giữ tiền âm để doanh thu khớp.
- ✅ C4 nhãn nguồn pass "Web Booking". C5 xong (chống ghi đè). `tsc --noEmit` 0 lỗi.
- ⚠️ Sự cố: một phiên khác reset nhánh làm mất phần sửa chưa commit của `TableInSupabase.md` ([v15]/[v16]). Đã khôi phục [v15] từ lịch sử, viết lại [v16], thêm [v17].
- ⏳ WebBooking W1–W12 (cửa sổ B). Riêng W12/D2: preview nhận thêm `p_booking_at` = `${date}T${time}:00` (giờ VN, không múi giờ, giống `bookingDate` gửi writer).
