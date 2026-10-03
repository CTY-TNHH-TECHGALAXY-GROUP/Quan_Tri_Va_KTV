# Plan Mức 2 — Journey WRB nội bộ: thang đánh giá 4/5 sao theo cấu hình admin

> Ngày: 03/10/2026 · Trạng thái: **CHỜ DUYỆT** · Repo sửa: `web_noi_bo/wrb-noi-bo-dev` (WRB) · Repo tham chiếu: admin `Quan_Tri_Va_KTV` (nhánh `test/sequential-two-slot-handoff-20260928`)
> Vì sao Mức 2: route `api/journey/update` ghi điểm khách chấm → trigger DB tính lại tiền tua / khấu trừ / thưởng KTV (tiền, điểm).

## 1. Hiện trạng (đã khảo sát, chỉ đọc)

| Chỗ | Hiện tại |
|---|---|
| Màn chấm thật | `src/components/Journey/ServiceList.tsx` (thẻ "Toàn bộ liệu trình… Trải nghiệm của bạn?") — 4 ô emoji 😡😐🙂🤩 lấy từ `RATING_OPTIONS` |
| Nhãn | `Journey.constants.ts` `RATING_LABELS` cố định mức 1..4 cho vi/en/kr/jp/cn |
| Số 4 cứng | `ServiceList.tsx`: `getMaxRating` (≥3 lỗi→1, ≥2→2, ≥1→3, không lỗi→4) dòng 285–291 & 420; mở tip khi `rating === 4` (328); `handleTipClose` gửi cứng `4` (364); `grid-cols-4` + màu theo value (494–499, 547, 588–626); bỏ qua gửi `0` (sentinel) |
| Ghi DB | `src/app/api/journey/update/route.ts` PATCH: ghi `BookingItems.itemRating`, `ktvRatings`, `itemFeedback`, `status`. Nhiều KTV → `itemRating = Math.round(trung bình)` khi đủ người. **Không ghi `rating_scale`**, không kẹp giá trị. Báo "Xuất sắc" (`StaffNotifications` FEEDBACK + REWARD + web push) khi `itemRating === 4` (dòng 157) |
| Lịch sử khách | `src/app/[lang]/old-user/history/page.tsx` vẽ cứng 4 sao (dòng 432, 471, 486); `api/orders/route.ts` chỉ đọc điểm |
| Không dùng | `Feedback.tsx` chỉ còn trang `journey/demo` dùng; `handleFeedbackComplete` trong `journey/[bookingId]/page.tsx` là code chết |
| Cấu hình admin | `SystemConfigs.customer_rating_scale` (4\|5), `SystemConfigs.rating_labels` = `{ "4": { "1": {internal,VN,EN,KR,JP,ZH}, … }, "5": {…} }` (nguồn: admin `lib/services/RatingScaleService.ts`) |

Dữ liệu tiền hiện **an toàn**: điểm WRB ghi vào nhận `rating_scale` mặc định = 4 → admin tính theo bảng thang 4.

## 2. Rủi ro chặn deploy (phải xử lý trước)

1. **Production chưa có cột `rating_scale`.** Migration `20261002110000_rating_scale_columns.sql` mới chỉ có ở nhánh test (chưa có trên `main` / `feat/bit-lo-hong-phase1`), DB production (`adzfohfdindovfcpaizb`) chưa chạy. WRB ghi cột này lên production → PostgREST lỗi PGRST204 → **khách không gửi được đánh giá**.
   → Route chỉ ghi `rating_scale` khi dò thấy cột tồn tại (cùng cách admin làm với `violations`). Thiếu cột → ghi như cũ, chấm theo thang 4.
2. **Thứ tự ghi:** `rating_scale` phải nằm **cùng một lệnh update** với `itemRating` / `ktvRatings`, để trigger tính lại sổ tua đọc đúng thang. Ghi tách hai lệnh thì có một khoảnh khắc điểm 5 bị hiểu theo thang 4.
3. **WRB `main` có thể là bản production** → làm trên nhánh riêng `feat/journey-rating-scale` của WRB, không đẩy `main` khi chưa có lệnh.

## 3. Thiết kế

**Đọc cấu hình (1 chỗ, phía server WRB):**
- Thêm `src/lib/ratingScale.ts`:
  - `DEFAULT_RATING_LABELS`: chép từ admin (thang 4 + thang 5 theo file PDF).
  - `normalizeScale`, `mergeLabels`, `ratingLabelFor(score, scale, labels, lang)`: map ngôn ngữ `vi→VN, en→EN, kr→KR, jp→JP, cn→ZH`; ô trống thì lấy `internal`.
  - `isTopRating(r, scale)`, `clampRating`.
  - Chỉ chứa thang / nhãn / kẹp điểm. **Không có công thức tiền**: tiền vẫn chỉ tính ở admin / DB.
- Thêm route `GET src/app/api/config/rating/route.ts`, theo mẫu `api/config/menu-vip`: `getSupabaseAdmin`, `.in('key', ['customer_rating_scale', 'rating_labels'])`, `dynamic = 'force-dynamic'`. Trả `{ scale, labels }` đã ghép mặc định.
- Hook `useRatingScale()`: trả `{ scale, labels, loaded }`. Chưa `loaded` thì hiện khung chờ, không cho chấm (bài học từ kiosk: tránh chấm nhầm thang mặc định).

**Màn chấm (`ServiceList.tsx`):**
- Thay 4 ô emoji bằng `scale` ô sao vàng: ô mức *n* tô *n* sao trên tổng `scale`, nhãn lấy từ cấu hình. Dùng class tĩnh (`grid-cols-4` / `grid-cols-5`), giữ tông tối hiện tại.
- Mức cao nhất (tip, nhãn "Top", màu nổi bật): `rating === scale` thay cho `=== 4`. `handleTipClose` gửi `scale` thay cho `4`.
- Trần khi khách tích góp ý (cần anh/chị chọn — mục 6, câu 1).
- Gửi kèm `ratingScale` trong body PATCH. Mức 0 (bỏ qua) giữ nguyên.

**Ghi DB (`api/journey/update/route.ts`):**
- Nhận `ratingScale`: chỉ chấp nhận 4|5, thiếu thì đọc cấu hình. Kẹp `itemRating` vào 1..scale (giữ 0 = bỏ qua).
- Có cột thì ghi `rating_scale` cùng lệnh update `BookingItems` (cả nhánh 1 KTV, nhiều KTV và nhánh retry không có `ktvRatings`).
- Báo "Xuất sắc": `itemRating >= scale` thay cho `=== 4`.
- Nhánh cấp bill (`Bookings.rating`, chỉ demo / code chết dùng): ghi thêm `rating_scale` khi có cột.

**Lịch sử khách (`old-user/history`):** vẽ số sao theo `rating_scale` của từng dòng (thiếu thì 4). `api/orders/route.ts` select thêm `rating_scale`.

**Không sửa:** `Feedback.tsx` và `journey/demo` (không có khách thật dùng). Ghi chú lại để dọn sau.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV (app admin) | Phía Quản lý (admin) | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Ví, lịch sử KTV: không sửa | Kiosk, Kanban, Cài đặt: không sửa | WRB `api/journey/update`, `SystemConfigs`, `BookingItems.rating_scale` | Sửa WRB 5–6 file; admin không đổi code |
| Số liệu tiền / điểm | Sổ Loại D đọc `rating_used` + `rating_scale` | Báo cáo đọc cùng sổ | Công thức ở admin `RatingScaleService` + trigger tính lại sổ | Khớp, với điều kiện ghi `rating_scale` cùng lệnh với điểm |
| Thông báo | KTV nhận REWARD khi "Xuất sắc" | Quầy nhận FEEDBACK | WRB tự insert `StaffNotifications`; trigger admin (migration `120000`) báo theo nhãn thang | Đổi điều kiện sang `>= scale`; kiểm tra không báo trùng (mục 7) |
| Realtime | App KTV subscribe `BookingItems` | Kanban subscribe `BookingItems` | Không đổi | Đồng bộ |
| Quyền xem | Không đổi | Không đổi | Route config chỉ trả thang + nhãn, không trả bảng khấu trừ | Không lộ % khấu trừ cho khách |

## 5. Vận hành & deploy

- Deploy WRB **sau** khi migration `rating_scale` đã lên DB production. Nhờ dò cột nên deploy sớm cũng không vỡ, chỉ là vẫn chấm theo thang 4.
- Khách quét QR: sau khi bật thang 5 sẽ thấy 5 sao thay cho 4 emoji. Không cần hướng dẫn quầy.
- Đổi thang chỉ áp dụng cho lần chấm mới. Điểm cũ giữ `rating_scale` lúc chấm.
- Cách lùi: revert commit WRB. Điểm đã ghi kèm `rating_scale` = 5 vẫn được admin hiểu đúng thang.

## 6. Cần anh/chị quyết

1. **Trần điểm khi khách tích góp ý.** Kiosk đang dùng "có lỗi → tối đa thang − 1". WRB đang trừ dần theo số lỗi (1 lỗi → 3, 2 lỗi → 2, 3 lỗi → 1).
   **Khuyến nghị:** giữ cách trừ dần của WRB, nâng mức 1 lỗi theo thang. Thang 5: 1 lỗi → 4, 2 lỗi → 2, 3 lỗi → 1. Thang 4 giữ y như hôm nay. Như vậy không nới lỏng luật đang chạy.
   (Muốn kiosk và WRB giống hệt nhau thì phải sửa thêm kiosk — ngoài phạm vi plan này.)
2. Có đổi nhãn mặc định của WRB theo admin không? VD thang 4 mức 2: WRB đang là "OK", admin là "Bình thường". **Khuyến nghị:** có, lấy nhãn admin để kiosk và QR thống nhất.

## 7. Kiểm thử (sau khi duyệt)

- Chạy WRB local trỏ TEST (đã làm được, cổng 3110, `next dev --webpack`). Dùng đơn demo có `accessToken`.
- Chụp 5 ngôn ngữ × thang 4/5. Chọn từng mức. Tích 1/2/3 lỗi → kiểm tra trần.
- Gửi thật trên TEST cho KTV Loại D giả: 1★…5★ thang 5. Đối chiếu sổ `KTVDTurnLedger` (`rating_used`, `rating_scale`, khấu trừ, thưởng) với kiosk chấm cùng mức → **2 phía phải bằng nhau**.
- Các ca: 1 KTV, 2 KTV (trung bình làm tròn), bỏ qua (0), mức cao nhất + tip.
- Dò cột: giả lập thiếu cột `rating_scale` → vẫn gửi được, ghi như cũ.
- Thông báo: "Xuất sắc" ra đúng 1 lần cho quầy và KTV, không trùng với trigger admin.
