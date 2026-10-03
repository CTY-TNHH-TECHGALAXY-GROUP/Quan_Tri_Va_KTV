# Kế hoạch triển khai hệ thống theo Chính sách KTV Oria Spa 
> Nguồn: `Oria Spa KTV.html` (chính sách áp dụng từ 01/09/2026).
> Mục tiêu: đọc từng mục chính sách trong file HTML, suy ra hệ thống cần xây cái gì để chính sách đó *thật sự vận hành được* trên phần mềm, không chỉ nằm trên giấy.

---

## Cách đọc bảng

Mỗi dòng trong các bảng dưới đi từ **một điều khoản chính sách** → **hệ quả kỹ thuật cần xây**. Cột "Nhóm việc" phân theo 5 lớp hệ thống:

- **DB** — bảng/cột dữ liệu mới
- **Backend** — logic tính toán, service, cron
- **Admin UI** — màn hình cấu hình cho quản lý
- **KTV App** — màn hình cho kỹ thuật viên
- **Vận hành** — không cần phần mềm, chỉ cần quy trình/Zalo/giấy tờ

---

## 1. Tính thu nhập tua (mục "Thu nhập" trong HTML)

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Đơn giá 100.000đ/60p (PT), 180.000đ/60p (VIP), tính theo phút thực tế không làm tròn | Bảng rate cấu hình được + công thức `phút × (rate/60)` | DB, Backend, Admin UI |
| Bonus +20.000đ khi đạt 4★, không cộng nếu đơn có KTV khác chế độ | Service tính bonus tách biệt, đọc danh sách KTV cùng đơn để biết có "khác chế độ" hay không | Backend |
| Khấu trừ 25%/bậc dưới 4★ (3★=75%, 2★=50%, 1★=25%) | Bảng khấu trừ theo sao, cấu hình được, có fallback an toàn nếu rating ngoài thang | DB, Backend, Admin UI |
| "Tính chính xác theo thời gian thực tế đã thực hiện" | Lấy `min(thời gian thực, thời gian gán)` từ dữ liệu chấm công/segment của đơn | Backend |
| Bảng tham chiếu 4 mức sao hiển thị cho KTV tự tra | Màn hình tính thử/tra cứu trong app KTV (giống công cụ trong HTML)SSee f  | KTV App |

---

## 2. Tiêu chuẩn & quyền lợi (mục "Quy chế" §2, §3)

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Có chứng chỉ hành nghề hợp lệ | Trường lưu trạng thái chứng chỉ trên hồ sơ KTV (đủ điều kiện tham gia hay không) | DB, Admin UI |
| Đóng quỹ nội bộ 250.000đ/tháng | Cấu hình số tiền + công tắc bật/tắt, cron trừ hàng tháng | DB, Backend, Admin UI |
| Không lương cứng, không chiết khấu — nhận trọn đơn giá | Không có nhánh khấu trừ ẩn nào khác ngoài rating — cần rà lại các cron dùng chung (phí giặt đồ, bảo trì) để không áp nhầm luật chiết khấu của chế độ khác | Backend |
| Rút tiền phải đăng ký ngay khi điểm danh ca đầu ngày | Form đăng ký rút tiền gắn với thao tác điểm danh, chặn đăng ký ngoài khung giờ đó | Backend, KTV App |
| Rút tiền khẩn cấp (tính năng sắp ra mắt, có phí) | Không làm ngay — đánh dấu "chưa triển khai" trong roadmap, chỉ cần feature flag tắt sẵn để bật sau | Backend (flag), ghi chú roadmap |

---

## 3. Điểm danh, giờ có mặt & trạng thái (mục "Quy chế" §4)

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Báo giờ có mặt trước 00:00 hằng ngày (app + Zalo) | Form đăng ký lịch làm trong app, có mốc khóa giờ (deadline 00:00) | Backend, KTV App |
| Bật ứng dụng = điểm danh, sẵn sàng nhận điều phối | Trạng thái online/offline gắn với hàng đợi điều phối (đã có sẵn cơ chế chung, chỉ cần đúng luồng cho D) | Backend |
| Tắt ứng dụng giữa ca phải chụp màn hình xác nhận gửi Zalo, không được tắt khi đã có thông báo khách vào | Chặn nút tắt app khi đơn đang active/khách đã vào; nếu cho tắt thì log lại thời điểm để đối chiếu | Backend, KTV App, Vận hành (Zalo) |
| Đăng ký nghỉ (Off) qua form; nghỉ không đăng ký → khóa tài khoản tự động | Form Off có sẵn (dùng lại cơ chế chung), cần cron/job kiểm tra "hôm nay ai không có mặt và không có Off" → tự khóa | DB, Backend (cron), Admin UI |
| Phí kích hoạt lại 1.000.000 – 2.000.000đ | Cấu hình mức phí (khoảng, không phải số cố định), luồng admin duyệt mở khóa + ghi nhận thu phí | DB, Backend, Admin UI |

---

## 4. Sổ tua tích lũy & điều phối (mục "Quy chế" §5)

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Ưu tiên theo tổng giờ phục vụ khách, cập nhật liên tục trong ngày | Sổ giờ tích lũy theo ngày, cộng dồn realtime khi đơn hoàn tất | DB, Backend |
| Reset về mốc ban đầu cuối mỗi tháng | Cron chốt sổ cuối tháng, tính từ đầu tháng mới tự động (không cần lệnh reset thủ công nếu query đã lọc theo tháng) | Backend (cron) |
| Bảng điều phối cho lễ tân phải phản ánh đúng thứ tự ưu tiên này | Màn hình dispatch tách riêng nhóm KTV theo chế độ này khỏi các nhóm khác (nếu không tách, lễ tân nhìn thấy thứ tự sai và luật vô nghĩa trên thực tế) | Backend, Vận hành UI (Reception) |

---

## 5. Kỷ luật (mục "Quy chế" §6)

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Không phạt tiền — trừ giờ tích lũy | Sổ ghi nhận trừ giờ theo loại lỗi, không đụng vào ví tiền | DB, Backend |
| 4 mức lỗi cụ thể (bỏ lịch -10h, báo vắng đúng hạn -5h, trễ không báo -5h, từ chối tua -3× giờ gói) | Bảng cấu hình mức phạt, cấu hình được trên Admin, áp dụng đúng công thức nhân 3 cho lỗi từ chối tua | DB, Backend, Admin UI |
| Không hoàn thành đơn do tự ý đưa khách xuống sớm không bấm nút khẩn cấp → không tính tiền tua, công ty bồi hoàn khách | Nút báo cáo/khẩn cấp trong luồng thực hiện dịch vụ; nếu đơn kết thúc bất thường không qua nút này → chặn tính công cho KTV, gắn cờ cho admin xử lý bồi hoàn | Backend, KTV App |

---

## 6. Đánh giá chất lượng & khấu trừ tự động (mục "Quy chế" §7)

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Thang 4★, khấu trừ 25%/bậc | Đã liệt kê ở mục 1 — dùng lại | — |
| Hệ thống tự tính đến đúng thời điểm hoàn thành/dừng đơn, không làm tròn phút | Lấy timestamp thực tế bắt đầu/kết thúc dịch vụ, không quy đổi block 15-30 phút | Backend |

---

## 7. Quy trình công việc trong ca (mục "Office")

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Checklist trước tua: mở phòng, setup nhiệt độ, khăn, đèn... | Checklist số trong app, tick từng bước, ảnh xác nhận nếu cần | KTV App |
| Bấm "BẮT ĐẦU" trước mặt khách, nút báo cáo khẩn cấp khi có sự cố | Đã có nút bắt đầu dịch vụ trong luồng chung; cần thêm nút khẩn cấp riêng nếu chưa có, log rõ thời điểm bấm | Backend, KTV App |
| Bàn giao cuối ca: khử khuẩn, setup lại, viết feedback khách trên web app | Form bàn giao + form feedback khách gắn với đơn đã hoàn thành | Backend, KTV App |
| Bật/tắt app đầu-cuối ngày, chụp ảnh xác nhận gửi Zalo | Nút "Out ca" trong app + checklist bàn giao vật tư trước khi cho phép out | KTV App, Vận hành (Zalo) |
| Đồng phục, ngoại hình, tác phong, bảo mật thông tin khách | Không phải phần mềm — đưa vào checklist chấm điểm (mục 8) để đo lường, còn bản thân hành vi là vận hành/đào tạo | Vận hành |

---

## 8. Bảng tự chấm điểm cuối ca & miễn quỹ nội bộ (mục "Chấm điểm")

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Checklist 100 điểm theo 3 nhóm (Quy trình 40đ, Thời gian 30đ, Thái độ 30đ) | Đưa checklist này vào app KTV làm công cụ tự soát (không phải điểm chính thức) — có thể dùng lại giao diện đã có trong file HTML độc lập, tích hợp vào hệ thống chính thay vì file rời | KTV App |
| Điểm ngày = 100 − tổng điểm trừ (mỗi lỗi trừ 1 lần/ngày) | Cần một bảng "điểm chính thức" do quản lý ghi nhận riêng biệt với bảng tự chấm — không tự động hoá điểm chính thức từ tự chấm, tránh KTV tự cho điểm rồi hệ thống tin theo | DB, Admin UI |
| Điểm tháng = trung bình các ngày có làm việc | Cron tổng hợp điểm tháng từ điểm ngày quản lý ghi nhận | Backend (cron) |
| Miễn quỹ nội bộ theo bậc điểm tháng (100%/50%/30%/10%/0%) | Bảng bậc miễn cấu hình được, áp dụng khi cron trừ quỹ nội bộ hàng tháng (liên kết trực tiếp với mục 2) | DB, Backend, Admin UI |
| Lỗi lặp ≥3 lần/tháng bị trừ thêm 1 lần ngoài công thức trung bình | Logic đếm số lần lặp theo loại lỗi trong tháng, cộng thêm điều chỉnh khi tổng hợp điểm tháng | Backend |

---

## 9. Set up khu vực (mục "Set up")

| Điều khoản chính sách | Hệ quả cần xây | Nhóm việc |
|---|---|---|
| Phân team phụ trách khu vực (Team 1/4/5), có checklist việc ngày | Bảng phân công team-khu vực, checklist việc ngày theo team hiển thị đúng người | DB, Admin UI, KTV App |
| Checklist việc tuần (thứ 2/3/6) | Lịch checklist định kỳ theo thứ trong tuần | Backend, KTV App |
| Khu vực không đạt chuẩn ảnh hưởng điểm Office | Liên kết kết quả checklist setup với bảng chấm điểm mục 8 (nhóm "Quy trình công việc") | Backend |

---

## 10. Thứ tự triển khai đề xuất (nếu làm từ đầu)

Vì đây là giả định "chưa làm gì", thứ tự nên đi theo **cái gì chặn cái khác** chứ không theo thứ tự xuất hiện trong file HTML:

1. **Nền tảng dữ liệu**: cột/bảng work_type mới, sổ giờ tích lũy, sổ kỷ luật, cấu hình rate — không có cái này thì mọi phần sau không có chỗ lưu.
2. **Tính tiền tua + bonus + khấu trừ sao** (mục 1, 6) — đây là phần ảnh hưởng trực tiếp thu nhập, cần đúng và test kỹ nhất trước khi mở rộng.
3. **Kỷ luật trừ giờ + sổ tua ưu tiên** (mục 4, 5) — phụ thuộc sổ giờ tích lũy vừa có ở bước 1.
4. **Điểm danh/Off/khóa tài khoản** (mục 3) — có thể làm song song với bước 2-3 vì ít phụ thuộc.
5. **Admin UI cấu hình** cho tất cả các bảng ở trên — làm sau khi backend đã chạy đúng, để không phải sửa UI theo sau mỗi lần đổi logic.
6. **Quy trình Office + checklist bàn giao** (mục 7) — phần lớn là UI thao tác, ít phụ thuộc logic tiền.
7. **Chấm điểm + miễn quỹ nội bộ** (mục 8) — phụ thuộc mục 3 (quỹ nội bộ đã tồn tại) và cần điểm chính thức ổn định trước khi tính miễn trừ.
8. **Set up khu vực** (mục 9) — ít rủi ro nhất, có thể làm bất kỳ lúc nào, kể cả sau cùng, vì không ảnh hưởng tiền hay kỷ luật.
9. **Rút tiền khẩn cấp** — để cuối roadmap, chính sách ghi rõ "sắp ra mắt", không phải yêu cầu ngày 01/09.

