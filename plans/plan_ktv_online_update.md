# Cập nhật Hệ thống Nhận Đơn Online KTV Loại B

Kế hoạch này nhằm thực hiện các yêu cầu mới nhất của bạn liên quan đến tính năng KTV Loại B (Hợp tác) làm việc từ xa (Online).

## 1. Cập nhật đã hoàn thành ngay lập tức
- Đã sửa cấu hình mặc định: **Tiền cọc duy trì KTV Loại A là 1.000.000 VNĐ** (thay vì 3.000.000 VNĐ).
- Đã giới hạn **Thời gian di chuyển tối đa là 60 phút** (nhỏ nhất là 5 phút) theo yêu cầu.
- Đã sửa lỗi hiển thị bảng Cấu hình hệ thống (JSX parsing error).

## 2. Kế hoạch thay đổi Giao diện (Đang chờ duyệt)

### 2.1. App/Dashboard KTV (Giao diện làm việc)
- **Bỏ Popup chờ:** Sau khi KTV (Loại B) điền form nhận đơn Online (Thời gian di chuyển, Giờ bắt đầu/kết thúc), thay vì hiện Popup chặn màn hình, hệ thống sẽ đưa KTV vào màn hình chờ (trông giống như đang làm tua, nhưng với thông báo: "🚕 Đang trực Online (Sẵn sàng nhận khách)" kèm thời gian khả dụng).
- KTV có thể tắt ca trực bất cứ lúc nào.
- *Lưu ý:* Chỉ KTV có `work_type === 'TYPE_B'` mới thấy nút Bật ca trực ngoài giờ.

### 2.2. Bảng Lễ Tân (Dispatch Board) & Modal Chọn KTV
- **Huy hiệu "Ngoài giờ":** Khi mở bill và bấm "Thêm KTV", danh sách KTV sẽ hiển thị các KTV Loại B đang bật Online ở trạng thái **Sẵn sàng** (không bị chìm), kèm theo huy hiệu màu xanh: `🚕 Ngoài giờ (+X phút)`.
- Khi Lễ tân chọn KTV này, hệ thống sẽ không chặn mà sẽ cho phép xếp tua như bình thường (KTV sẽ nhận được đơn và thông báo).

### 2.3. Sổ Tua (Turn Queue Board)
- Sẽ có **3 bảng** hiển thị trong Sổ Tua thay vì 2:
  1. KTV Đang Làm
  2. KTV Sẵn Sàng (Tại cơ sở)
  3. **[MỚI] KTV Đang Trực Online:** Hiển thị danh sách các bạn đang bật chế độ ngoài giờ, hiển thị số phút di chuyển và khung giờ trực để Lễ tân/Quản lý nắm tổng quan.

### 2.4. Menu VIP Khách Hàng (Dự án `wrb-noi-bo-dev`)
- API hiện tại sẽ cung cấp thêm thông tin `online_status` và `travel_minutes` để phía Web/App Khách Hàng có thể hiển thị huy hiệu `🚕 Ngoài giờ (+X phút)` trên thẻ KTV. (Bạn sẽ cần update UI bên repo khách hàng, API bên này sẽ support xuất data chuẩn).

## Hướng dẫn Test (List Test)
Sau khi triển khai, các bước test sẽ là:
1. **Test KTV Dashboard:** Đăng nhập KTV Loại B, bật Online, nhập 30 phút. Kiểm tra không còn popup mà chuyển sang giao diện "Đang trực". KTV Loại A không được phép thấy nút này.
2. **Test Lễ Tân xếp đơn:** Đăng nhập Lễ Tân, vào Dispatch, chọn 1 bill, bấm "Thêm KTV", tìm KTV Loại B vừa bật. Xác nhận có huy hiệu `🚕 Ngoài giờ (+30 phút)` và thêm thành công vào Bill.
3. **Test Sổ Tua:** Xem bảng Sổ Tua, xác nhận KTV Loại B nằm ở mục "KTV Đang Trực Online".
4. **Test Tự động Offline:** Chỉnh giờ kết thúc là thời điểm hiện tại + 1 phút, chờ 1 phút, refresh để xem hệ thống có tự động Offline KTV không.
