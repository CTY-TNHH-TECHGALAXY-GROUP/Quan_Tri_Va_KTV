# Kế hoạch triển khai (V3): Xử lý hiển thị đúng ca tạm thời & giữ trạng thái OFF

## 1. Mô tả vấn đề
- Khách hàng yêu cầu: Khi KTV (như 02, 27) đã đăng ký OFF nhưng vẫn đi làm và bấm "Điểm danh" chọn "Ca tự do", họ **PHẢI** được gán vào "Ca tự do" trên màn hình Lịch OFF & Ca trong ngày hôm đó.
- Cùng lúc đó, hệ thống **VẪN PHẢI** giữ họ ở danh sách "Nhân sự OFF" để tránh hiểu nhầm.
- Sang ngày mai, ca "Ca tự do" tự động biến mất và trở về ca gốc.

## 2. Quá trình xử lý & Kết quả
- **Bảo lưu danh sách OFF**: Mã lệnh `selectedLeaves` không bị thay đổi, do đó 02 và 27 vẫn xuất hiện trong khung màu hồng "NHÂN SỰ OFF".
- **Hiển thị vào ca làm việc thực tế**: Đã chỉnh sửa bộ lọc `activeShifts` trong `app/reception/ktv-hub/page.tsx`. Thay vì loại bỏ hoàn toàn người đã đăng ký OFF, hệ thống sẽ kiểm tra: Nếu người này có khai báo điểm danh "Tự chọn ca lúc điểm danh", hệ thống sẽ **đồng thời** hiển thị họ vào khung "NHÂN SỰ LÀM VIỆC" theo đúng ca vừa chọn (Ca tự do / Khách yêu cầu).
- **Thêm Badge phân biệt**: Kế bên tên của 02 và 27 trong khu vực "NHÂN SỰ LÀM VIỆC", hệ thống gắn thêm 1 nhãn nhỏ `OFF` màu đỏ đô, giúp Quản lý/Lễ tân nhìn vào hiểu ngay là: "Nhân sự này có đăng ký nghỉ nhưng hôm nay vẫn đi làm Ca tự do".

## 3. Hoàn tất
- Dữ liệu hiển thị ngày 7/5 sẽ đáp ứng 100% nhu cầu (hiện trong cả 2 danh sách OFF và Làm Việc).
- Thuật toán ở backend vẫn tự động xoá "Ca tự do" này khi sang ngày 8/5.
