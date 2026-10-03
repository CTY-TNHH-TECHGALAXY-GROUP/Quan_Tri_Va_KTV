# Kế hoạch: Tính năng cập nhật IP Wi-Fi tự động

## 1. Mục tiêu
Giải quyết tình trạng IP mạng thay đổi (do nhà mạng cấp IP động) khiến KTV không thể điểm danh do lỗi "Sai Wi-Fi". Cung cấp cho Lễ Tân/Quản lý một công cụ đơn giản để cập nhật lại IP mạng chỉ bằng 1 nút bấm.

## 2. Chi tiết triển khai

### Bước 1: Tạo API xử lý cập nhật IP
**File:** `app/api/admin/update-wifi-ip/route.ts` (Tạo mới)
- **Logic:** 
  - Đọc IP trực tiếp từ request header (`x-forwarded-for` hoặc `x-real-ip`).
  - Kết nối Supabase (bằng Admin Key để bypass RLS).
  - Cập nhật dòng có `key = 'spa_wifi_ips'` trong bảng `SystemConfigs` với giá trị là mảng chứa IP mới `[clientIp]`.
  - Trả về kết quả JSON báo thành công kèm địa chỉ IP mới.

### Bước 2: Thêm nút bấm trên giao diện Quản Lý Thiết Bị
**File:** `app/admin/devices/page.tsx`
- **Logic:** 
  - Thêm một nút **"🔄 Cập nhật IP Wi-Fi Spa"** (có màu sắc hoặc icon nổi bật, ví dụ dùng icon Wifi) đặt phía trên cùng bên phải, cạnh nút "Làm mới".
  - Khi người quản lý click vào nút này, hiện hộp thoại xác nhận: *"Bạn có chắc chắn thiết bị này đang kết nối đúng Wi-Fi của Spa? Việc này sẽ cập nhật lại IP cho toàn bộ hệ thống điểm danh."*
  - Gọi API `/api/admin/update-wifi-ip` bằng method POST.
  - Hiển thị thông báo `alert` thành công kèm IP mới, giúp quản lý biết quy trình đã hoàn tất.

## 3. Lợi ích & An toàn
- Tối ưu UI/UX: Quản lý không cần biết kỹ thuật hay IP là gì, chỉ cần kết nối Wi-Fi và bấm nút.
- An toàn: Tính năng này được tích hợp vào trang Admin, do đó đã được bảo vệ bởi phân quyền (chỉ tài khoản có quyền `device_management` mới truy cập được).
