# Bỏ trạng thái Chờ Duyệt Phòng (Hold Salary)

Theo yêu cầu của User, hệ thống sẽ bỏ qua bước "Duyệt phòng" của Lễ tân để tính lương. Sau khi KTV bàn giao phòng (chụp ảnh dọn phòng xong) và bấm Hoàn tất, tiền tua sẽ được cộng thẳng vào ví, không bị "Hold" (Giữ lại) với lý do "Phòng chưa được duyệt" nữa. Lễ tân vẫn có thể xem được ảnh dọn phòng, nhưng việc duyệt/từ chối không còn ảnh hưởng đến việc cộng tiền vào ví KTV.

## Thay đổi Logic Tính Tiền Tua

#### [MODIFY] `lib/services/KtvCommissionService.ts`
- **Logic:** Vô hiệu hóa khối lệnh kiểm tra `item.handover_status !== 'APPROVED'` trong hàm `checkIsItemPassed(item, booking, ktvId)`.
- **Kết quả:** Khi hàm tính lương chạy, nó sẽ không còn gán lý do "Phòng chưa được duyệt (hoặc bị từ chối)" nữa. Do đó, nếu KTV không bị khách chê hoặc lễ tân phạt, trạng thái `isPassed` mặc định bằng `true` và tiền tua sẽ cộng thẳng vào số dư "Đã cộng" ngay lập tức.
