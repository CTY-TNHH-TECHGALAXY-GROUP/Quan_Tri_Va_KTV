# Tóm Tắt Logic Bảng Chấm Công & Tính Lương (Cập nhật T7/2026)

Tài liệu này ghi nhận lại toàn bộ công thức và logic tính Bảng Chấm Công hiện đang được áp dụng trên hệ thống sau các đợt tinh chỉnh theo chuẩn của Spa.

## 1. Tổng Ngày Công (Chỉ số dùng để tính lương)
- **Công thức:** `Tổng Ngày Công = [Ngày chuẩn của tháng] - [Số ngày Nghỉ Có Phép] - [Số ngày Nghỉ Đột Xuất]`.
- **Ngày chuẩn của tháng:** 
  - Mặc định các tháng tính chuẩn là **30 ngày** (Bất kể tháng thực tế có 31 ngày).
  - Riêng tháng 2, hệ thống tự động kiểm tra năm nhuận để mốc chuẩn là **28 hoặc 29 ngày**.
- **Đặc điểm:** "Tổng Ngày Công" bị trừ trực tiếp bởi các ngày nghỉ. Việc KTV lỡ quẹt thẻ đi làm vào ngày đã xin nghỉ sẽ không làm tăng hay bù thêm số ngày công cơ bản này.

## 2. Nghỉ Có Phép
- **Cách đếm:** Chỉ cần KTV có giấy đăng ký Nghỉ Phép (OFF) vào ngày hôm đó thì hệ thống đếm là 1.
- **Quyền ưu tiên tuyệt đối:** Trạng thái Nghỉ Phép sẽ đè lên mọi dữ liệu khác. Cho dù hôm đó KTV có lỡ quẹt thẻ check-in, hệ thống vẫn kiên quyết ghi nhận hôm đó là "Nghỉ Có Phép" và không đổi thành "Có mặt". Điều này đảm bảo số lượng ngày nghỉ trên Bảng Lương luôn khớp với số đơn xin nghỉ.

## 3. Nghỉ Đột Xuất (Vắng mặt không phép)
- **Điều kiện kích hoạt:** Tự động chốt sổ khi đồng hồ qua mốc **11:05 sáng** mỗi ngày.
- **Nhận diện:** Nếu qua 11:05 sáng mà hệ thống rà soát thấy KTV đó **KHÔNG có đơn xin Nghỉ Phép** và cũng **KHÔNG có dữ liệu Check-in**, hệ thống tự động gán nhãn ngày hôm đó là "Nghỉ Đột Xuất".

## 4. Ca Tự Do & Ca Yêu Cầu (Thống kê độ chăm chỉ)
- **Mục đích:** Dùng để đếm số lần nhằm vinh danh mức độ chăm chỉ của nhân sự. **KHÔNG** làm thay đổi hay cộng/trừ vào "Tổng Ngày Công".
- **Cách đếm:** Bất cứ khi nào KTV có **nhấn nút Check-in** và lịch làm việc gốc ghi nhận hôm đó là Ca Tự Do / Ca Yêu Cầu, hệ thống sẽ cộng 1 vào thống kê. Kể cả khi ngày hôm đó KTV đã đăng ký Nghỉ Phép nhưng vẫn lên spa cống hiến, hệ thống vẫn ghi nhận sự nỗ lực này vào 2 thẻ thống kê xanh/tím.

## 5. Đi Trễ & Quên Check-out
- **Đi Trễ:** Chỉ áp dụng kỷ luật đối với các **Ca Cố Định** (Ca 1/2/3). Khi làm các Ca Tự Do hoặc Ca Yêu Cầu, KTV được miễn trừ hoàn toàn việc bị phạt đi trễ (luôn được tính là đúng giờ).
- **Quên Check-out:** Đếm số lần KTV có giờ Check-in nhưng đến lúc qua ngày hôm sau vẫn bỏ trống giờ Check-out.

---
*Lưu ý: Logic này đã được chốt và đồng bộ hoàn toàn với dữ liệu thực tế. Yully tháng 5 có 13 ngày Nghỉ Phép, 0 đột xuất => Tổng Ngày Công: `30 - 13 - 0 = 17 ngày`.*
