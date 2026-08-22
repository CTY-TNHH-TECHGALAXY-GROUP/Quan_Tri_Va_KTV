# Tách Biệt Hoàn Toàn Logic VIP Menu Khỏi App KTV

## Nhận định từ phản hồi của bạn
Mình đã hiểu ý bạn: **Cờ `is_active_vip_menu` là đặc quyền riêng của Quầy (Admin), tuyệt đối không để App KTV hay hệ thống tự động thò tay vào sửa.** 
Khi KTV Bật/Tắt nhận đơn, hệ thống sẽ **chỉ thay đổi trạng thái làm việc** (`online_status` chuyển thành ONLINE/OFFLINE) và **khung giờ trống** (`available_until`). Quầy nhìn vào trạng thái Offline (On Leave) là tự hiểu KTV đó đã nghỉ, không cần hệ thống phải tự động gạt tắt luôn cả cờ VIP Menu của Quầy. Tương tự, hệ thống quét quá giờ (cronjob) cũng chỉ đưa KTV về Offline (On Leave).

## Các thay đổi sẽ thực hiện (Execution Plan)

### 1. Xóa bỏ tự động cập nhật VIP Menu khi Bật/Tắt Nhận Đơn
#### [MODIFY] [app/api/ktv/on-call/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/on-call/route.ts)
- Xóa bỏ dòng code `updatePayload.is_active_vip_menu = true;` khi bật nhận đơn.
- Xóa bỏ dòng code hoàn trả lại trạng thái cũ / set về `false` khi tắt nhận đơn.
- **Kết quả:** KTV bật/tắt nhận đơn chỉ cập nhật `online_status` và giờ giấc.

### 2. Xóa bỏ tự động cập nhật VIP Menu khi KTV A Tan Ca
#### [MODIFY] [app/api/ktv/attendance/route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/ktv/attendance/route.ts)
- Xóa bỏ đoạn mã `is_active_vip_menu: false` khi KTV ấn "Báo Cáo Tan Ca" (CHECK_OUT).
- **Kết quả:** Tan ca giống hệt tắt nhận đơn -> KTV về trạng thái không hoạt động (isOnShift = false), cờ VIP Menu của Quầy vẫn giữ nguyên.

### 3. Xóa bỏ tự động cập nhật VIP Menu khi quá giờ (Cronjob)
#### [MODIFY] [lib/services/KtvOnlineService.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/lib/services/KtvOnlineService.ts)
- Trong hàm dọn dẹp ngầm `cleanupExpiredOnline`, hệ thống sẽ chỉ cập nhật `online_status: 'OFFLINE'` và xóa thời gian `available_until`, KHÔNG đụng đến `is_active_vip_menu`.

## Kế hoạch kiểm tra
1. Mình sẽ tự tiến hành sửa các file trên theo kế hoạch.
2. Mình sẽ test lại luồng để đảm bảo khi KTV Bật/Tắt nhận đơn, DB chỉ ghi nhận `online_status` thay đổi mà cờ VIP Menu do Quầy thiết lập không bị gián đoạn.
