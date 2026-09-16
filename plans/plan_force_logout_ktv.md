# Kế hoạch Thêm Tính Năng Ép Đăng Xuất (Force Logout) cho KTV

**Mô tả vấn đề:**
Hiện tại khi Quản lý/Admin chuyển trạng thái tài khoản KTV sang "Đã nghỉ" (Inactive), hoặc đổi mật khẩu tài khoản của họ, KTV đó vẫn có thể tiếp tục sử dụng app nếu phiên đăng nhập (session) trên trình duyệt của họ vẫn còn. Hệ thống chưa có cơ chế ép họ văng ra ngoài.

## Proposed Changes

Chúng ta sẽ sử dụng tính năng **Supabase Realtime** để giám sát liên tục (realtime) trạng thái của tài khoản đang đăng nhập. Việc này được xử lý ngay tại tầng `AuthContext` để áp dụng toàn hệ thống.

### [MODIFY] `lib/auth-context.tsx`
Thêm một `useEffect` hook để lắng nghe sự thay đổi dữ liệu của user đang đăng nhập:

1. **Lắng nghe bảng `Staff`**:
   - Nếu `status` của nhân viên bị chuyển thành `'ĐÃ NGHỈ'`, lập tức gọi hàm `logout()` đẩy user về màn hình đăng nhập.
2. **Lắng nghe bảng `Users`**:
   - Nếu trường `password` bị thay đổi (bởi Admin), lập tức gọi hàm `logout()`.

Việc sử dụng Realtime giúp hệ thống phản ứng ngay lập tức (chưa tới 1 giây) sau khi Admin bấm Lưu, tăng cường tối đa tính bảo mật. KTV đang mở app sẽ ngay lập tức bị đẩy ra màn hình Login và bị thu hồi token/phiên làm việc.

## User Review Required
> [!IMPORTANT]
> Phương pháp này áp dụng cơ chế Realtime để ép đăng xuất ngay lập tức thay vì chỉ kiểm tra lúc tải lại trang. Anh/Chị vui lòng xem và **DUYỆT** kế hoạch này để em tiến hành cập nhật code nhé.
