# Phân tích Yêu cầu: Cho phép KTV Bỏ qua (Skip) quy trình khi có khách mới

## 1. Bối cảnh & Yêu cầu của User
- **Current State:** Khi hết giờ, KTV buộc phải trải qua 3 màn hình: Đánh giá khách (Review) -> Dọn phòng (Handover) -> Nhận tiền tua (Reward).
- **User Request:** Lễ tân có thể gán khách mới ngay lập tức. Nếu có khách mới, màn hình KTV hiện thông báo. KTV bấm vào thông báo có thể **skip (bỏ qua)** quy trình cũ và lập tức nhận đơn mới.
- **Mục tiêu:** Tối ưu hóa thời gian chờ của khách hàng trong giờ cao điểm (Rush Hour).

---

## 2. Biện luận & Phản biện (AI Sparring Partner)

### Ưu điểm (Pros)
- **Cực kỳ thực tế:** Phản ánh đúng nghiệp vụ tại Spa. Khi khách quá đông, Lễ tân thường bắt KTV "chạy sô" ngay lập tức. Việc dọn phòng sẽ do Tạp vụ hoặc KTV rảnh khác làm thay.
- **Tối đa hóa doanh thu:** Tránh việc khách VIP phải chờ 5-10 phút chỉ vì KTV đang bận bấm điện thoại check-list dọn phòng.

### Rủi ro & Điểm nghẽn (Bottlenecks / Cons)
1. **Mất dữ liệu CRM cực kỳ quan trọng (Review):** 
   - Việc thu thập tính cách khách ("Dê xồm", "Kỹ tính") là cốt lõi để nâng cao dịch vụ. Nếu KTV bấm skip luôn cả bước Đánh giá, Spa sẽ bị "mù" thông tin về khách hàng đó trong tương lai.
2. **Mất Tiền Tua của KTV (Bug tiềm ẩn):** 
   - Hiện tại, hàm tính tiền tua và lưu trạng thái `DONE` nằm ở nút "Xác nhận dọn xong". Nếu KTV skip nhảy qua đơn mới mà hệ thống không xử lý ngầm, KTV sẽ không được cộng tiền tua cho ca vừa làm -> Gây tranh cãi nội bộ.
3. **Lỗ hổng trạng thái Phòng (Room Status):** 
   - Nếu KTV skip dọn phòng, trên lý thuyết phòng đó đang "Bẩn". Dù hiện tại phần mềm chưa khắt khe vụ này, nhưng tương lai Lễ tân có thể xếp nhầm khách mới vào cái phòng chưa ai dọn.

---

## 3. Giải pháp Đề xuất (Best Practice)

Để dung hòa giữa tốc độ "Chạy sô" và "Quy trình hệ thống", tôi đề xuất mô hình **"FAST-TRACK" (Chuyển ca nhanh)** như sau:

1. **Bước 1: Giữ nguyên Bắt Buộc Đánh Giá (Review)**
   - Không cho phép skip bước Review. Nó chỉ tốn đúng 2 giây để bấm 1 icon ("Dễ thương" / "Khó tính"). Việc này bảo vệ tài sản data của Spa.
2. **Bước 2: Nút "Skip Dọn Phòng" thông minh (Tại màn hình Handover)**
   - Hệ thống sẽ lắng nghe realtime. Nếu KTV đang ở màn hình Handover mà có đơn mới được Lễ tân gán, một Banner nổi bật sẽ hiện lên: *"🚨 Lễ tân đã gán khách mới cho bạn! [Bỏ qua dọn phòng & Nhận khách ngay]"*.
3. **Bước 3: Xử lý ngầm tự động (Auto-complete)**
   - Khi KTV bấm nút Skip:
     - Hệ thống tự động đẩy trạng thái đơn cũ thành `DONE`.
     - Tự động tính tiền tua và lưu lại ngầm (Bỏ qua luôn màn hình pháo hoa Reward).
     - Reset `localStorage` và chuyển ngay KTV về `DASHBOARD` để hiện thông tin khách mới.

### Lợi ích của giải pháp này:
- Vẫn đáp ứng 100% tốc độ chạy sô của Lễ tân.
- KHÔNG mất data đánh giá khách hàng.
- KHÔNG làm mất tiền tua của KTV.
- Giao diện không bị loạn (tránh việc KTV bấm nhầm).
