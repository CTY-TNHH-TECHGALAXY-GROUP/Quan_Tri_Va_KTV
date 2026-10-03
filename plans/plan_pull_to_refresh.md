# Kế hoạch triển khai: Pull To Refresh (Vuốt & Giữ để Reload)

Tính năng "Pull To Refresh" sẽ được xây dựng dưới dạng một Wrapper Component, có thể bọc ngoài bất kỳ danh sách hay trang nào cần tính năng tải lại cục bộ. Để giải quyết vấn đề "tránh hiểu nhầm/vuốt nhầm", component sẽ yêu cầu người dùng **vuốt xuống vượt qua một ngưỡng nhất định và GIỮ (hold) trong một khoảng thời gian** trước khi thực sự gọi lệnh refresh.

## User Review Required

> [!IMPORTANT]
> **Xác nhận về hành vi UX:**
> - **Ngưỡng vuốt (Drag Threshold):** Người dùng phải vuốt xuống tối thiểu `100px`.
> - **Thời gian giữ (Hold Duration):** Sau khi vuốt qua ngưỡng `100px`, người dùng phải giữ tay trên màn hình trong `800ms` (0.8 giây) thì tiến trình tải lại mới được kích hoạt. Nếu thả tay ra trước 800ms, trang sẽ nảy về vị trí cũ và không tải lại.
> Bạn thấy các thông số `100px` và `800ms` này đã hợp lý chưa? Mình có thể dễ dàng điều chỉnh ở biến hằng số.

> [!NOTE]
> Component này sẽ nhận một hàm `onRefresh: () => Promise<void>`. Điều này có nghĩa là mỗi trang (như trang Lịch đặt, Dashboard KTV) khi dùng component này sẽ cần truyền một hàm gọi API (hoặc `router.refresh()`) vào. Nó sẽ không tự động `window.location.reload()` để tránh làm màn hình chớp trắng. Mình sẽ làm component này thật mượt với Framer Motion và Tailwind.

## Proposed Changes

### Component PullToRefresh

Chúng ta sẽ tạo một thư mục component mới dành riêng cho tính năng này.

#### [NEW] [PullToRefresh.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/components/PullToRefresh/PullToRefresh.tsx)
- Chứa giao diện (UI) của wrapper.
- Sẽ có một thanh chỉ báo (indicator) hiển thị phía trên. Khi vuốt xuống, nó sẽ hiện ra. Khi giữ, nó sẽ hiển thị tiến trình (vòng xoay vòng hoặc thanh ngang lấp đầy) và đổi text thành "Giữ để tải lại...".
- Sau khi giữ đủ thời gian, hiển thị spinner xoay tròn trong lúc chờ `onRefresh` hoàn tất.

#### [NEW] [PullToRefresh.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/components/PullToRefresh/PullToRefresh.logic.ts)
- Quản lý trạng thái: `pullY` (độ dài vuốt), `isPulling`, `isHolding`, `isRefreshing`.
- Lắng nghe các sự kiện: `onTouchStart`, `onTouchMove`, `onTouchEnd`.
- Xử lý logic hẹn giờ (`setTimeout`) khi người dùng kéo qua ngưỡng và giữ. Nếu thả tay ra sớm (`onTouchEnd`) thì `clearTimeout`.

## Verification Plan

### Manual Verification
1. Dùng công cụ DevTools (hoặc thiết bị di động thật) chuyển sang chế độ Mobile.
2. Thử vuốt xuống nhẹ (< 100px) và thả ra -> Không có gì xảy ra (bounce back về 0).
3. Vuốt xuống qua ngưỡng (> 100px) nhưng thả tay ra ngay -> Không refresh, bounce back.
4. Vuốt xuống qua ngưỡng và giữ đủ 0.8 giây -> Trigger tải lại, hiển thị Spinner và Loading text.
5. Sau khi spinner hoàn tất, indicator tự động cuộn lên trên và mất đi, trả lại trạng thái ban đầu.
