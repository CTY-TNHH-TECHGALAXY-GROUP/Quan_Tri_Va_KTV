# Plan — Thang đánh giá 4/5 sao chọn trong Cài đặt + khấu trừ theo sao cho Loại A/B/C (02/10/2026)

Mức 2: chạm tiền (hoa hồng A/B/C, tiền Loại D), thưởng, DB và trigger. Chờ duyệt. Làm theo từng giai đoạn, giai đoạn nào xong cũng chạy được.

## 1. Hiện trạng (khảo sát 02/10)

- **Không lưu thang ở đâu cả.** Số 4 bị viết cứng ở UI, ở service TypeScript và trong trigger SQL.
- **Chỗ nhập đánh giá:**
  - Kiosk feedback: 4 mức emoji, có vi phạm thì tối đa 3.
  - Kanban: quầy chấm bằng các nút `[1,2,3,4]`.
  - Các action `submitCustomerRating`, `submitGuestRating`, `submitFeedbackAction`: không chặn giá trị trên/dưới.
  - **Trang hành trình khách (QR) nằm ở app khác** (`nganha.vercel.app/.../journey`), không thuộc repo này.
- **Tiền:**
  - Loại D trừ % theo bảng `ktv_type_d_rating_deduction` (0–4). Sao không có trong bảng thì trừ 0%. Bảng mặc định đang bị chép ở **7 chỗ**.
  - **A/B/C hiện không bị trừ theo sao.** Hoa hồng (`calcCommission`) chỉ theo mốc thời lượng; số sao chỉ ảnh hưởng điểm thưởng (dưới 4 sao thì 0 điểm). Cột `KTVDailyLedger.rating_deduction` luôn bằng 0.
  - Hoa hồng A/B/C được tính lại ở khoảng **14 chỗ** (ví, lịch sử, báo cáo, sync ledger, dashboard KTV).
- **Ngưỡng viết cứng:**
  - Thưởng ≥ 4: `BONUS_MIN_RATING`, `KtvCommissionService`, `KtvTypeDBonusService`.
  - "Xuất sắc" ≥ 4: Kanban, feedback, `lib/rating-label.ts`.
  - Trigger thông báo SQL: REWARD khi ≥ 4, cảnh báo khi = 1.
  - Báo cáo xếp hạng chia 4 mức.
  - Cron `sync-daily-ledger-type-d` **dùng số 5 với nghĩa "chưa có đánh giá"** → sẽ hiểu sai khi khách thật chấm 5 sao.

## 2. Thiết kế

### 2.1 Cấu hình (SystemConfigs, trang Cài đặt hệ thống)

| Key | Giá trị | Mặc định |
|---|---|---|
| `customer_rating_scale` | `4` hoặc `5` | `4` (không đổi gì so với hôm nay) |
| `ktv_abc_rating_deduction` | `{ "4": {"1":..,"2":..,"3":..,"4":0}, "5": {"1":..,..,"5":0} }`: % trừ hoa hồng A/B/C theo sao, **tách bảng cho từng thang** | **toàn bộ 0%** (A/B/C không bị trừ cho tới khi admin nhập) |
| `ktv_type_d_rating_deduction` | giữ key cũ cho thang 4; thêm bảng thang 5 (`{"4": {...}, "5": {...}}`, đọc được cả dạng cũ) | thang 4 = bảng hiện tại; thang 5 = **chờ anh/chị chốt** |
| `rating_bonus_min` | ngưỡng sao được thưởng, theo thang: `{"4": 4, "5": ?}` | thang 4 = 4 (như hiện tại) |

Giao diện:
- Chọn thang: **4 sao / 5 sao**.
- Bảng khấu trừ hiện đúng số dòng của thang đang chọn, cho cả Loại D và A/B/C.
- Ghi chú rõ: "Đổi thang chỉ áp dụng cho đánh giá mới".

### 2.2 Mỗi đánh giá ghi kèm thang lúc chấm (chống đọc sai đánh giá cũ)

- Migration thêm cột `rating_scale smallint` vào `Bookings`, `BookingItems`, `BookingGuests`.
  - Mặc định **4**: toàn bộ đánh giá cũ tự hiểu là thang 4, nên lịch sử tiền, thưởng và báo cáo cũ giữ nguyên.
- Mọi chỗ ghi đánh giá (kiosk, Kanban, 3 action) ghi kèm `rating_scale` = thang hiện tại, và chặn giá trị trong khoảng `1..thang`.
- Mọi chỗ **đọc** đánh giá diễn giải theo `rating_scale` **của chính đánh giá đó**, không theo cấu hình hiện tại.
  - Ví dụ: đổi sang thang 5 xong, một đánh giá cũ 4/4 vẫn là "Xuất sắc, trừ 0%".
  - Khi ledger Loại D tính lại một ngày cũ, kết quả cũng không bị đổi.
- Cập nhật `TableInSupabase.md`.

### 2.3 Một nguồn duy nhất cho mọi diễn giải (mục 4.2 CLAUDE.md)

`lib/services/RatingScaleService.ts`:
- `getRatingConfig(supabase)`: thang hiện tại, các bảng khấu trừ, ngưỡng thưởng.
- `ratingDeduction(kind: 'D'|'ABC', rating, scale)` → %.
- `isExcellent(rating, scale)` = `rating === scale`.
- `qualifiesForBonus(rating, scale)`.
- `maxWithViolation(scale)` = `scale - 1`.
- `ratingLabel(rating, scale)`.
- Thay 7 bản chép bảng mặc định và các số 4 viết cứng bằng service này.
- Phía SQL: thêm hàm `rating_is_excellent(rating, scale)` để trigger thông báo dùng.

### 2.4 Khấu trừ A/B/C (đổi tiền)

- Thêm `calcCommissionWithRating(...)` trong `KtvCommissionService`: hoa hồng theo mốc × (1 − % trừ theo sao của KTV đó, lấy qua `resolveRating`).
- **Cả 14 chỗ gọi** chuyển sang dùng hàm này, để ví KTV, lịch sử KTV, báo cáo tài chính và sync ledger ra **cùng một con số**.
- `KTVDailyLedger.rating_deduction` bắt đầu ghi số tiền bị trừ thật.
- Chưa có đánh giá → không trừ (giống Loại D hiện tại). Đánh giá đến muộn → sync ledger ghi lại.
- Không trừ cho chặng bị void / KTV bị đổi ra (mục 13.3).

### 2.5 Sửa các chỗ dễ vỡ

- Cron Loại D: bỏ quy ước "5 = chưa có đánh giá", dùng `null`.
- Kanban: bỏ `Math.min(rating,4)`; vẽ số sao theo `rating_scale` của từng đánh giá.
- Báo cáo xếp hạng / doanh thu: chia mức theo thang (thêm mức 5). Điểm trung bình tính theo **% của thang** (`rating / scale`) để không trộn 4/4 với 4/5. Hiển thị "★ x/5" hoặc "★ x/4" theo từng đánh giá.
- Trigger thông báo REWARD: dùng `rating_is_excellent(rating, rating_scale)`.

### 2.6 Trang hành trình khách (QR, app khác)

- Repo này không sửa được. Đề xuất: app đó đọc `customer_rating_scale` (qua API công khai chỉ đọc), vẽ đúng số sao, rồi gửi kèm `rating_scale`.
- **Cho tới khi app đó cập nhật,** đánh giá từ QR được hiểu theo cột mặc định = 4.
- Vì vậy **không nên bật thang 5 trước khi app QR sẵn sàng**. Cài đặt sẽ hiện cảnh báo này.

## 3. Giai đoạn

| GĐ | Nội dung | Đổi tiền? |
|---|---|---|
| 1 | Migration `rating_scale` + config + `RatingScaleService` + gom 7 bảng mặc định + sửa cron "5 = chưa có" | Không (thang 4, A/B/C 0%) |
| 2 | Cài đặt: chọn thang, bảng khấu trừ D và A/B/C theo thang; chỗ nhập đánh giá theo thang + chặn khoảng | Không, cho tới khi admin nhập % |
| 3 | `calcCommissionWithRating` + 14 chỗ gọi + `KTVDailyLedger.rating_deduction` | **Có** (khi admin đặt % > 0) |
| 4 | Hiển thị: Kanban, lịch sử KTV, báo cáo, nhãn, trigger thông báo | Không |

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Lịch sử, ví, đồng hồ thưởng, thông báo REWARD | Cài đặt hệ thống, kiosk feedback, Kanban, báo cáo doanh thu / xếp hạng / KTV | `RatingScaleService`, `KtvCommissionService`, `KtvDLedgerEngine`, trigger thông báo | Sửa |
| Số liệu tiền / thưởng | Ví, lịch sử (hoa hồng sau trừ) | Báo cáo tài chính, sync ledger | `calcCommissionWithRating` (một nguồn) | Phải **khớp 2 phía**: mô phỏng trước khi bật |
| Realtime | như cũ | như cũ | BookingGuests / Items | Không đổi |
| Quyền | KTV chỉ thấy % của mình | Chỉ admin sửa cấu hình | SystemConfigs | Không lộ |

## 5. Test (mục 10, 4.3)

- Mô phỏng bằng mock data, in **so sánh 2 phía** (ví KTV vs báo cáo tài chính) cho cùng KTV và cùng ngày:
  - A/B/C với bảng trừ > 0: 1 sao, 3 sao, 4/4, 4/5, 5/5, chưa đánh giá, đánh giá đến muộn.
  - Loại D: thang 4 cũ không đổi; thang 5 mới.
  - Đổi thang 4 → 5 giữa ngày: đánh giá cũ giữ thang 4.
  - Có vi phạm: tối đa = thang − 1.
  - KTV bị đổi ra: không trừ, không hưởng.
  - Ca đêm, `TZ=UTC`.
- Hồi quy: 10 đơn, ledger Loại D (probe sẵn có), báo cáo.

## 6. Cần anh/chị chốt trước khi làm

1. **Bảng trừ mặc định cho thang 5** (Loại D và A/B/C). Đề xuất Loại D: 5★ 0% · 4★ 0% · 3★ 25% · 2★ 50% · 1★ 75%. A/B/C mặc định 0% hết cho tới khi admin nhập.
2. **Ngưỡng thưởng ở thang 5:** từ 4★ hay chỉ 5★? Đề xuất **≥ 4★**, giữ gần với hôm nay: hôm nay "đủ thưởng" là 4/4, tức mức cao nhất.
3. **"Xuất sắc" ở thang 5:** chỉ 5★? Đề xuất **5★ = Xuất sắc, 4★ = Tốt**.
4. **Trang QR khách** (app khác): ai sửa, và khi nào được bật thang 5.
5. Bảng trừ A/B/C dùng **chung cho A, B, C**, hay **tách riêng từng loại**? Đề xuất **chung**, tách sau nếu cần.

## 7. Đã chốt (02/10/2026)

1. Bảng trừ mặc định ở thang 5:
   - Loại D: 5★ 0% · 4★ 0% · 3★ 25% · 2★ 50% · 1★ 75%.
   - A/B/C: 0% hết cho tới khi admin nhập.
2. Ngưỡng thưởng ở thang 5: **chỉ 5★**. Thang 4 giữ như hiện tại: 4★, mức cao nhất.
3. "Xuất sắc" = mức cao nhất của thang (5★ ở thang 5).
4. Bảng trừ A/B/C dùng **chung** cho A, B, C.
5. **Bổ sung:** admin **đổi được nhãn chữ** của từng mức sao.
   - Config `rating_labels`: `{ "4": { "1": { "internal": "Tệ", "VN": "Tệ", "EN": "Bad", "KR": .., "JP": .., "ZH": .. }, ... }, "5": {...} }`.
     - `internal` là nhãn quầy và KTV thấy (Kanban, lịch sử, ví, báo cáo).
     - VN/EN/KR/JP/ZH là chữ khách thấy trên kiosk feedback.
   - Mặc định lấy đúng chữ đang dùng hôm nay.
   - Thang 5 thêm một mức. Đề xuất nhãn: 1 Tệ · 2 Chưa hài lòng · 3 Bình thường · 4 Tốt · 5 Xuất sắc. Admin sửa lại được.
   - `ratingLabel(rating, scale)` và kiosk đọc từ config. Ô trống thì dùng mặc định.
   - Không áp dụng cho trang QR của app khác, cho tới khi app đó đọc cùng config.
6. Trang QR khách (app khác): **chưa chốt**. Cài đặt hiện cảnh báo "Trang QR vẫn chấm 4 sao" khi chọn thang 5.

## 8. Đã làm (02–03/10/2026)

**Migration (đã áp TEST):**

- `20261002110000_rating_scale_columns`: cột `rating_scale` (4|5, mặc định 4, có CHECK) trên Bookings / BookingItems / BookingGuests.
- `20261002120000_rating_notifications_by_scale`: hàm `rating_is_excellent`, `rating_label_internal` (đọc `rating_labels`); 2 trigger thông báo theo thang.
- `20261002130000_ktvd_ledger_rating_scale`: cột `KTVDTurnLedger.rating_scale`; `ktvd_commit_recompute` ghi thêm cột này.

**Code:**

- GĐ1:
  - `lib/services/RatingScaleService.ts` là nguồn duy nhất.
  - Bỏ 7 bản chép bảng trừ mặc định.
  - Cron Loại D bỏ quy ước "5 = chưa có đánh giá".
- GĐ2:
  - Khung "Thang đánh giá & khấu trừ theo sao" trong Cài đặt hệ thống: chọn thang 4/5, bảng trừ D và A/B/C theo thang, nhãn nội bộ + VN/EN/KR/JP/ZH. API kiểm dữ liệu.
  - Kiosk, Kanban và 3 action ghi đánh giá: kẹp `1..thang`, ghi `rating_scale`, có góp ý thì tối đa `thang − 1`.
- GĐ3:
  - Engine sổ Loại D đọc thang theo đúng nguồn sao.
  - Ngưỡng thưởng A/B/C và D = mức cao nhất của thang.
  - `KtvCommissionService.applyAbcRatingDeduction` dùng ở cả 18 chỗ tính hoa hồng A/B/C: ví, lịch sử, timeline, sổ ngày, 5 báo cáo tài chính, màn Thưởng KTV.
- GĐ4:
  - Kanban, Lịch sử KTV, ví timeline, trang feedback: nhãn / màu / số sao theo thang.
  - Báo cáo xếp hạng: 4 nhóm theo vị trí trong thang.
  - Điểm trung bình quy về hệ 4 điểm.

**Khác với plan (có chủ đích):**

1. Trừ A/B/C chỉ dùng sao **cấp dịch vụ** (ktvRatings / itemRating), không lùi về sao cấp bill. Lý do: route phía KTV không lấy `guest_id`, còn route báo cáo có lấy. Lùi về bill thì hai phía ra hai số (mục 4.3).
2. `KTVDailyLedger.rating_deduction` **không** dùng cho A/B/C, vì cron Loại D đang ghi **tỉ lệ** vào cột đó. Số tiền trừ của A/B/C nằm trong `commission_breakdown[].ratingDeduction`.

**Lỗi có sẵn phát hiện thêm (chưa sửa, cần quyết riêng vì đổi tiền):**

- `app/api/ktv/wallet/timeline/route.ts`: select `Bookings` thiếu `rating`, nên phần tiền Loại D realtime trên ví không trừ theo sao.
- Nhiều route select `BookingItems` thiếu `guest_id`, nên luật "không mượn sao cấp bill khi đã tách khách" của phần **thưởng** không có hiệu lực ở các route đó.

**Test:**

- `unit_rating_scale` 16/16, `sim_abc_deduction` 11/11 (2 phía khớp), `sim_type_d_scale` 9/9, `verify_rating_inputs` 9/9.
- Hồi quy: 10 đơn 165/165, F 50/50, V1/V3/T3 25/25, E2E 17/17, từ chối 24/24, G3/G5, H1, bàn giao 12/12.

**Trước khi bật thang 5:** trang QR khách (app khác) phải gửi kèm `rating_scale` và vẽ 5 sao.

## 9. Nhãn thang 5 theo bảng "KTV Rating Scale Multilingual" + kiosk dùng sao (03/10/2026)

- Nhãn mặc định thang 5 (nội bộ = tiếng Việt gốc):

  | Mức | VN | EN | KR | JP | ZH |
  |---|---|---|---|---|---|
  | 1 | Cực kỳ tệ | Very poor | 매우 나쁨 | 非常に悪い | 非常差 |
  | 2 | Thất vọng | Disappointing | 실망스러움 | 期待外れ | 令人失望 |
  | 3 | Chưa ổn lắm | Could be better | 아쉬움 | もう少し | 有待改进 |
  | 4 | Tuyệt vời | Great | 훌륭함 | 素晴らしい | 很好 |
  | 5 | Xuất sắc | Excellent | 최고 | 最高 | 非常出色 |

  Chữ CJK lấy theo bảng hiển thị. Phần text trích của PDF có ký tự bộ thủ (⾮…), không dùng.
- Thang 4 giữ nhãn cũ. Admin vẫn sửa được mọi nhãn trong Cài đặt hệ thống.
- `rating_label_internal` (SQL, nhãn thông báo KTV) cập nhật cùng bộ chữ (áp lại `20261002120000` trên TEST).
- Kiosk feedback: bỏ emoji, mỗi nút là hàng sao (`score` sao tô vàng trên tổng số sao của thang) + nhãn chữ theo ngôn ngữ khách.
