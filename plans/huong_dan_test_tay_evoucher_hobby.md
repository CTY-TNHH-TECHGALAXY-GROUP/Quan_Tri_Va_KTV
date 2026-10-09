# Hướng dẫn test tay: E-Voucher web trên Vercel Hobby + Supabase TEST

> Nhánh admin: `test/evoucher-web-20261009` (project Hobby `test-98d3c5e6/quan-tri-va-ktv`, env Preview trỏ Supabase TEST).
> Dữ liệu tạo bằng `scripts/qa/seed_evoucher_hobby_test.mjs`, dọn bằng `--cleanup`. **Không dùng DB thật.**
> Phần "khách lưu voucher trên web" (mục C) cần WebBooking chạy local với env TEST, sau khi cửa sổ B xong W1–W12.

## A. Dữ liệu đang có (tạo 09/10/2026)

Chương trình **QA Hobby Oria Booking Rewards** (`QAHOBBY-MV0RQD9Q`), giảm 10%, 8 suất, đường dẫn `qa-hobby-mv0rqd9q`.

| Kịch bản | Mã đơn | Voucher | Ngày hẹn | Tạm tính → Tổng |
|---|---|---|---|---|
| S1 VIP | `WB-10102026-116` | `HOBBY-2RSHRF` | 10/10 10:00 | 500.000 → 450.000 |
| S2 Tách đơn | `WB-10102026-117` (2 khách) | `HOBBY-P7WEJA` | 10/10 11:00 | 600.000 → 540.000 |
| S3 Huỷ hết dịch vụ | `WB-10102026-118` | `HOBBY-EE6S7A` | 10/10 13:00 | 600.000 → 540.000 |
| S4 Không đến | `WB-08102026-001` | `HOBBY-KNQC3G` | 08/10 15:00 | 300.000 → 270.000 |
| S5 Làm trọn vẹn | `WB-09102026-046` | `HOBBY-PVJMZT` | 09/10 17:00 | 300.000 → 270.000 |

Tạo lại bộ mới: `set -a; source <env TEST>; set +a; node scripts/qa/seed_evoucher_hobby_test.mjs` (mã đơn / voucher sẽ khác, script in bảng mới).

## B. Phía quầy + admin (làm được ngay, không cần bật công tắc)

Ghi ✅/❌ vào cột cuối. "Thẻ Web" = trang Admin → Khuyến mãi → chương trình QA Hobby → thẻ **Phát trên Web Booking**.

| # | Làm gì | Phải thấy | Kết quả |
|---|---|---|---|
| 1 | Mở Thẻ Web | Tổng 8 · Còn 4 · Đang dùng 4 · Đã huỷ 1 (S4 đã tự huỷ: khách không đến). Danh sách có `HOBBY-KNQC3G` lý do "Khách không đến" | |
| 2 | **S4**: mở đơn `WB-08102026-001` | Tổng **300.000** (giá gốc), dòng "Khuyến mãi giảm 10%" đã huỷ. Cron tự làm, không ai bấm | |
| 3 | **S1**: Quầy → Đơn web → xác nhận `WB-10102026-116` | Đơn thành **VIP** (không phải MIXED). Tổng 450.000, có dòng giảm −50.000 không có KTV | |
| 4 | **S5**: xác nhận `WB-09102026-046` → điều phối KTV → làm tới **Hoàn tất** | Đơn DONE, tổng 270.000. Thẻ Web: `HOBBY-PVJMZT` → **Đã dùng** (≤ 30 giây, hoặc bấm tải lại) | |
| 5 | **S5** tiếp: app KTV của KTV vừa làm | Tiền tua theo **60 phút** như đơn thường, dòng giảm không hiện | |
| 6 | **S5** tiếp: Tài chính → Báo cáo ngày 09/10 | Doanh thu tính 270.000. Số dịch vụ **không** đếm dòng giảm. Bảng dịch vụ có dòng "Khuyến mãi giảm 10%" tiền âm, số lượng 0 | |
| 7 | **S2**: xác nhận `WB-10102026-117` → điều phối → **tách đơn** 2 khách → làm xong cả 2 đơn con | Trong **≤ 2 phút** sau khi đơn con xong: `HOBBY-P7WEJA` → **Đã dùng** | |
| 8 | **S3**: xác nhận `WB-10102026-118` → huỷ **từng** dịch vụ đến hết → đơn tự đóng | `HOBBY-EE6S7A` → **Đã huỷ** (lý do: không thực hiện dịch vụ). Thẻ Web: Còn tăng 1. Dòng giảm đã huỷ | |
| 9 | Quầy áp voucher tại quầy: nhập `HOBBY-2RSHRF` vào một đơn walk-in bất kỳ (kể cả bật áp ngoại lệ) | Báo "Voucher web chỉ áp dụng khi khách đặt lịch qua Web Booking…", không áp được | |
| 10 | Admin → trang chi tiết pass của `HOBBY-2RSHRF` → bấm Huỷ | Báo "Voucher web đi theo đơn đặt lịch…", pass không đổi. Nguồn phát ghi **Web Booking** | |
| 11 | Admin → chương trình **October** (tặng phút) → Thẻ Web | Không có nút "Bật", có câu "Chỉ chương trình giảm % hoặc giảm tiền…" | |
| 12 | Admin → tạo chương trình mới giảm 10%, phát thủ công → Thẻ Web → Bật → nhập cấu hình → Lưu | Hiện hộp hỏi "Bật phát trên Web Booking?" trước khi lưu. Sau khi bật: không phát tay được mã của chương trình này | |
| 13 | Thẻ Web QA Hobby: Tạm dừng / Tiếp tục | Nhãn đổi Tạm dừng ↔ Đang phát | |

## C. Đầu-cuối với WebBooking (sau khi cửa sổ B xong, hẹn giờ vì phải bật công tắc trên TEST)

1. Báo cửa sổ A bật `promotion_web_claim_enabled` trên TEST (B không chạy QA lúc này).
2. WebBooking local (env TEST) → trang Pure Relaxation: thấy thẻ "Còn X" của QA Hobby. Mở Thẻ Web admin bên cạnh.
3. Điện thoại 1 bấm Lưu → admin thấy "Đang giữ" +1 **ngay** (realtime). Hết suất → máy khác thấy "Đã hết".
4. Đặt lịch có voucher → checkout Áp dụng thấy giảm → Đặt → quầy thấy đơn WB- có dòng giảm → làm như B.4.
5. Đặt lịch với ngày hẹn **sau 16/10** (chương trình hết hạn) → bị từ chối, hỏi "Đặt không kèm voucher?".
6. Tắt công tắc → thẻ web ẩn, đặt lịch không voucher vẫn chạy.

## D. Dọn

`node scripts/qa/seed_evoucher_hobby_test.mjs --cleanup`: xoá chương trình QA Hobby, đơn, khách, dịch vụ tạm `NHPQA01`. Đơn đã điều phối có dữ liệu KTV kèm theo thì script chuyển đơn sang CANCELLED thay vì xoá.
