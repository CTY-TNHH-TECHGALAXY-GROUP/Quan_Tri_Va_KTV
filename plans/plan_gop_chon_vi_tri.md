# Kế hoạch: Gộp tuỳ chọn "Vị Trí Tập Trung" vào cấu hình "Custom For You"

## Mô tả
Hiện tại, tuỳ chọn bật/tắt **"Chọn Vị trí (Focus/Avoid)"** và danh sách các vị trí **"Vị Trí Tập Trung (Focus Area)"** đang bị tách rời thành 2 khu vực khác nhau trong giao diện cấu hình dịch vụ. Theo yêu cầu, cần gộp danh sách các vị trí vào ngay bên dưới nút bật/tắt để người quản lý dễ nhìn và dễ thiết lập (chỉ khi bật tính năng thì mới cho phép tích chọn các vị trí chi tiết).

## Chi tiết thay đổi

**File:** `app/admin/service-menu/EditServiceDrawer.tsx`

1. **Di dời khối UI**: 
   - Lấy toàn bộ khối render `FOCUS_AREAS` (Đầu, Cổ, Vai, Gáy...) từ phần dưới.
   - Đưa vào ngay bên dưới checkbox `Chọn Vị trí (Focus/Avoid)`.

2. **Cập nhật logic hiển thị**:
   - Chỉ hiển thị các ô checkbox vị trí khi tính năng `Chọn Vị trí` được bật.
   - Thêm thụt lề (margin/padding) và border để thể hiện rõ cấu trúc phân cấp cha - con.

3. **Dọn dẹp mã nguồn**:
   - Xóa bỏ khối `FOCUS AREAS` dư thừa ở phía dưới.

## Yêu cầu người dùng
Vui lòng xem qua kế hoạch này. Nếu bạn đồng ý, hãy phản hồi **"Duyệt"** hoặc **"OK"** để tôi tiến hành sửa code.
