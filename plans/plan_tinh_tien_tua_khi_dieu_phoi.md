# Kế Hoạch Sửa Lỗi Tiền Tua & Sửa Lỗi Skip Màn Hình KTV

## 1. Đồng Bộ Tiền Tua / Số Tua Ngay Khi Điều Phối
Theo chính sách của công ty: KTV được tính tua ngay sau khi Lễ Tân điều phối.
- **Hiện tại**: Database đã lưu `TurnLedger` lúc phân công, nhưng API chưa tính toán lại để đưa lên giao diện.
- **Giải pháp**: Sửa hàm `syncTurnsForDate` trong `lib/turn-sync.ts`. Hàm này sẽ đọc số lượng tua từ `TurnLedger` và gom nhóm (`GROUP BY`) để cập nhật trường `turns_completed` của mỗi KTV trong hàng đợi (`TurnQueue`). Như vậy ngay khi Lễ Tân bấm điều phối, số tua trên màn Lễ Tân và điện thoại KTV sẽ nhảy lập tức.

## 2. Sửa Lỗi Tự Động Skip Màn Hình Đánh Giá Khách Hàng (REVIEW) & Dọn Phòng (HANDOVER)
Bạn quan sát thấy trên iPhone bị skip qua bước Đánh giá KH và Dọn phòng. Nguyên nhân kỹ thuật là:
- Khi dịch vụ kết thúc (Timer chạm 0), trạng thái tổng của đơn hàng được hệ thống cập nhật tự động thành `CLEANING` (Dọn phòng).
- Screen Engine (Bộ định tuyến màn hình) của KTV đang có một quy tắc: *Nếu trạng thái là CLEANING thì bắt buộc nhảy thẳng sang màn HANDOVER và đánh dấu là đã review xong.* -> Điều này gây ra lỗi nhảy cóc (skip) màn hình Review.
- Nếu bạn đăng nhập trên nhiều thiết bị (Computer + iPhone), một thiết bị chạy trước sẽ làm thiết bị kia bị đồng bộ nhảy cóc.

**Giải pháp**:
- Sửa lại Screen Engine trong `app/ktv/dashboard/KTVDashboard.logic.ts`.
- Bắt buộc KTV phải đi theo đúng luồng: `TIMER` ➡️ `REVIEW` ➡️ `HANDOVER` ➡️ `REWARD`. 
- Nếu trạng thái là `CLEANING` mà KTV chưa gửi Review, hệ thống KHÔNG ĐƯỢC ép nhảy sang `HANDOVER`, mà phải ưu tiên hiển thị màn `REVIEW` trước.
- Không tự động ép `setHasSubmittedReview(true)` sai logic nữa.
