# Báo Cáo & Kế Hoạch Fix Lỗi AutoFinish KTV NH027

## Bối cảnh (Context)
Sáng nay KTV NH027 được điều phối vào đơn hàng bình thường. Sau khi bấm "Bắt đầu", khoảng 0.8 giây sau hệ thống tự động nhảy sang trạng thái hoàn tất (CLEANING -> FEEDBACK). 

## Nguyên nhân gốc rễ (Root Cause)
Lỗi xảy ra do tính năng **AutoFinish (Tự động hoàn tất khi hết giờ)**. 
Trong quá trình xử lý bất đồng bộ giữa React State (`timeRemaining`) và việc nhận tín hiệu Realtime từ DB, có một khoảnh khắc khoảng mili-giây biến `timeRemaining` mang giá trị `0` (hoặc tính toán bị lỗi/race condition) trước khi nó được cập nhật lại thành `5400` giây (90 phút).
Bộ hook AutoFinish thấy `timeRemaining === 0` nên đã gọi ngay hàm `handleFinishTimer`, ép đơn hàng hoàn thành dù mới chạy được vài mili-giây.

## Kế hoạch sửa đổi (Implementation Plan)
Thêm một lớp **Hard Guard** bên trong Hook AutoFinish:
- Ngay khi phát hiện `timeRemaining === 0`, tính toán thời gian `timerRunningForMs = Date.now() - timerStartMsRef.current`.
- Nếu thời gian đồng hồ mới chạy chưa quá 10 giây (`< 10000 ms`), hệ thống sẽ nhận định đây là lỗi Race Condition và cảnh báo ra Console, chặn lệnh AutoFinish thay vì để đơn tự hoàn thành.

## Các file chỉnh sửa
- `[MODIFY] app/ktv/dashboard/KTVDashboard.logic.ts`
