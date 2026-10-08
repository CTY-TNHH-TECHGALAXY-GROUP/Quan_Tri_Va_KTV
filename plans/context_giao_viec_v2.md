# Context — Module Giao việc v2 (Oria Spa)

> Tài liệu bối cảnh để brainstorm thêm ý tưởng nâng cấp. Cập nhật 08/10/2026.
> Plan kỹ thuật chi tiết: `plans/plan_nang_cap_giao_viec.md`.

---

## 1. Bối cảnh doanh nghiệp

- **Oria Spa**: spa (massage, gội đầu dưỡng sinh, facial), có sảnh, sân ngoài, phòng gội, phòng VIP, toilet nhiều lầu.
- **Hệ thống**: web app nội bộ (Next.js + Supabase, chạy trên điện thoại nhân viên dạng PWA). Đã có: điều phối đơn, KTV nhận đơn, chấm công (check-in/out có ảnh + wifi), nghỉ phép, ví/hoa hồng KTV, hiệu suất, kỷ luật, dọn phòng/bàn giao phòng sau dịch vụ.
- **Người dùng của module giao việc**:
  - **Nhân viên thực hiện**: nhân viên quầy hỗ trợ (VD NH01/NH001), nhân viên hậu cần, một số KTV. Dùng điện thoại, bận tiếp khách, mạng 4G/wifi spa.
  - **Giám sát / quản lý**: giao việc, duyệt ảnh, theo dõi.
- **Mục tiêu**: giao việc cho đúng người có trách nhiệm theo checklist, **đảm bảo đủ trách nhiệm** (làm đủ, có ảnh bằng chứng, được duyệt). Không nhất thiết ép giờ cứng — tuỳ việc.

## 2. Lịch sử

- **07–08/2026**: module "Hậu cần / Giao việc" chạy thật. Tháng 8: 3.495 việc, 2.586 hoàn thành, 705 được duyệt, 3.083 ảnh (gần hết do 1 nhân viên).
- **Cuối 08/2026**: nhân viên bỏ dùng. Lý do (quản lý xác nhận): **giao diện bất tiện**. Tháng 9: 468 việc sinh ra, 0 hoàn thành.
- **10/2026**: dựng thử artifact "Checklist vận hành NH01" (HTML độc lập): 43 việc/ngày chia 7 khung giờ + 13 việc/tuần theo thứ; mỗi thẻ có **ảnh mẫu cạnh ảnh nộp**, giám sát duyệt / không duyệt kèm lý do + ảnh lỗi, lịch sử vòng. Quản lý thích giao diện này → **giao diện v2 theo artifact**.

## 3. Ví dụ checklist thực tế (quầy NH01)

- *Trước 09:00 — Sân ngoài*: quét sân, setup bàn ghế, menu đứng, kệ dép theo size, quay mái hiên ra, mở đèn sân (3 ảnh), tưới cây.
- *09:00 — Sảnh & phòng gội*: mở máy lạnh, nhạc, sạc tab/POS, tủ nóng, cầu dao nước nóng, châm bình thuỷ, đếm đủ 5 ghế tròn.
- *09:00–09:30*: lau bàn thờ, nấu trà (3 lá vối + 1,8L nước), máy sấy (2 ảnh: phòng gội + sảnh), móc treo/giỏ đồ (3 ảnh).
- *Xuyên ca*: lau kính, nồi xông thảo dược, **thay khăn lau tay 4 khu vực × 3 mốc 09:00/13:00/17:00 (12 ảnh)**.
- *Linh hoạt*: kiểm kê vật tư (báo số lượng để đặt hàng), dọn tủ lạnh, châm tinh dầu, nước rửa tay, giấy/khẩu trang/cồn, thay thảm.
- *15:00*: quay mái hiên vào. *Từ 17:00*: đèn bảng hiệu, bàn giao dụng cụ vệ sinh, gom đồ dơ đi giặt, thay bao rác.
- *Tuần*: T2/T6 thay khăn trải giường + áo gối; T3 vệ sinh máy xông mặt, dụng cụ facial; T4/CN thay áo gối sảnh.

## 4. Module hiện có (sẽ nâng cấp, không làm lại từ đầu)

- **Bảng**: `TaskCategories` (danh mục), `TaskTemplates` (việc mẫu: tên, mô tả, số ảnh tối thiểu, lặp ngày/thứ), `EmployeeRoutines` (gán từng việc mẫu cho từng người — 234 dòng), `RoomTaskTemplates` (việc theo phòng), `Tasks` (việc thực tế mỗi ngày, FIXED/AD-HOC), `TaskPhotos`, `TaskReviews` (duyệt theo vòng), `TaskNotifications`.
- **Đã có và chạy**: thư viện việc, gán theo người, việc theo phòng, chụp ảnh có kiểm tra độ sáng, duyệt hàng loạt, việc tồn 1 ngày, **chặn tan ca khi còn việc chưa được duyệt** (bật/tắt theo loại nhân viên trong cài đặt hệ thống).
- **Lỗi đã phát hiện**: việc chỉ sinh khi mở trang (không mở = không bị chặn tan ca); việc tồn không chặn; sinh trùng khi nhiều server; sai ngày lúc 0–7h; không kiểm đủ ảnh ở server; API thiếu xác thực; trả lại thì xoá sạch ảnh cũ; không ghi người duyệt; nút giao việc đột xuất hỏng; tự xoá việc ngầm.

## 5. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Giao diện | Theo artifact NH01 (ảnh mẫu ↔ ảnh nộp, thẻ việc, lịch sử vòng) |
| Gán việc | **Template** (bộ việc mẫu) → gán cho người; **mỗi người được custom từ template** (thêm/bớt/sửa việc riêng) |
| Giao đột xuất | Có |
| Chế độ thời gian | Cấu hình theo từng việc: Tự do / Hạn chót / Khung giờ / Nhiều mốc / Bắt buộc trước khi tan ca |
| Bằng chứng | Mỗi việc có N **ô ảnh có nhãn** + ảnh mẫu từng ô; phải nộp đủ mới được gửi duyệt |
| Trạng thái | Tự tính, không tick tay: Chưa làm → Đang làm (2/3 ảnh) → Chờ duyệt → Đã duyệt / Bị trả lại |
| Chặn tan ca | Còn việc **chưa được duyệt** (kể cả **việc tồn hôm qua**) → không tan ca |
| Ngoại lệ | Báo off đột xuất **miễn chặn**; giám sát có nút **"Cho tan ca"** kèm lý do (ghi log) |
| Lịch sử | Nhật ký sự kiện chỉ ghi thêm (giao, nộp, duyệt, trả lại, cho qua…) — không bao giờ xoá bằng chứng |
| Sinh việc | Hàm trong DB + lịch tự chạy hằng ngày; app gọi lại khi check-in / tan ca để chắc chắn |
| Trả lại | Chỉ chụp lại **ô bị chê**, ảnh cũ giữ trong lịch sử |
| Ảnh | Nén trên điện thoại, xếp hàng gửi lại khi rớt mạng |
| Thông báo | Nộp → báo giám sát; trả lại → báo nhân viên; sắp hết ca còn việc chưa duyệt → nhắc giám sát |
| Không tự xoá | Bỏ cơ chế tự xoá việc khi đổi gán |

## 6. Ràng buộc

- Nhân viên dùng **điện thoại**, vừa làm vừa tiếp khách → thao tác phải cực ít, nút to, chụp nhanh.
- Giám sát **không ngồi máy cả ngày** → duyệt phải nhanh (lưới ảnh, duyệt hàng loạt), không để nhân viên kẹt cuối ca.
- Chấm công là **đường nóng**: lỗi module giao việc không được làm nhân viên không check-in/tan ca được (lỗi → cho qua + ghi log).
- Dữ liệu cũ (≈4.900 việc, ≈3.100 ảnh) giữ nguyên để tra cứu.
- Không đụng tiền / tua / hoa hồng KTV trong đợt này.
- Nhiều chi nhánh / nhiều quầy có thể có sau này.

## 7. Câu hỏi mở — vùng cần thêm ý tưởng

1. **Giảm ma sát cho nhân viên**: làm sao để 43 việc/ngày không thành gánh nặng? (gộp việc, chụp 1 ảnh cho nhiều việc, thứ tự theo lộ trình đi bộ trong spa, chế độ "đang làm khu Sảnh"…)
2. **Giảm tải duyệt cho giám sát**: duyệt mẫu ngẫu nhiên? tin cậy tự động cho người ít bị trả lại? AI so ảnh nộp với ảnh mẫu?
3. **Template & custom**: cấu trúc kế thừa (template gốc → template chi nhánh → custom cá nhân), khi template gốc đổi thì bản custom xử lý thế nào?
4. **Bàn giao ca**: ca sáng → ca chiều, việc dang dở, lưu ý cho người sau.
5. **Việc sinh ra từ sự kiện**: phòng dọn xong, khách phàn nàn, vật tư dưới mức tối thiểu, thiết bị hỏng → tự tạo việc.
6. **Đo lường & động lực**: điểm tuân thủ, % duyệt lần đầu, việc hay bị trễ / bị trả lại, gắn thưởng (sau).
7. **Kiểm kê vật tư**: biến việc "báo số lượng" thành form nhập số → cảnh báo đặt hàng.
8. **Đào tạo**: mỗi việc kèm hướng dẫn / video SOP, chế độ nhân viên mới.
9. **Chống gian lận nhẹ nhàng**: ảnh cũ, ảnh chụp lại màn hình, nộp hộ — mà không làm khó người làm thật.
10. **Báo cáo cho chủ**: một màn hình nhìn là biết hôm nay spa có "sẵn sàng đón khách" chưa.

## 8. Gợi ý prompt khi brainstorm

> "Dựa trên bối cảnh trên, đề xuất ý tưởng nâng cấp cho [vùng X], mỗi ý gồm: vấn đề giải quyết, cách hoạt động với nhân viên và giám sát, độ khó (thấp/vừa/cao), rủi ro. Ưu tiên ý giảm thao tác trên điện thoại."
