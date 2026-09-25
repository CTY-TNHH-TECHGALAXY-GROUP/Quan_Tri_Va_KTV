# Kế hoạch Xử Lý Thứ Tự Các Chặng / Dịch Vụ 

## Nguyên nhân gốc rễ
Khi Lễ tân (Admin) điều phối 1 KTV làm nhiều dịch vụ (VD: Đơn 006, làm T trước rồi đến V1), mỗi chặng (segment) đều được Lễ tân gán một **Giờ bắt đầu** (`startTime`) riêng.
Tuy nhiên, hiện tại KTV Dashboard và Backend đang gộp các dịch vụ theo thứ tự mà chúng được lưu vào Database, **KHÔNG sắp xếp theo thời gian (`startTime`)**. Điều này dẫn đến việc thứ tự trên màn hình KTV bị đảo lộn, không khớp với ý đồ điều phối của Lễ tân.

## Hướng giải quyết (Proposed Changes)

Để giải quyết, chúng ta sẽ bắt hệ thống ưu tiên "Thời gian bắt đầu (`startTime`)" để quyết định thứ tự của các chặng. Cụ thể:

1. **[MODIFY] `app/ktv/dashboard/KTVDashboard.logic.ts`**
   - Tại 5 vị trí thu thập danh sách chặng (`allMySegs`), thêm logic `.sort(...)` để tự động sắp xếp các chặng làm việc theo trình tự thời gian (`startTime` tăng dần).
   - Đảm bảo KTV luôn nhìn thấy chặng nào làm trước, chặng nào làm sau một cách chuẩn xác theo thứ tự Lễ tân đã lên lịch.

2. **[MODIFY] `app/ktv/dashboard/page.tsx`**
   - Tại 2 vị trí lấy dữ liệu render UI (`allKtvSegments`), cũng áp dụng `.sort(...)` tương tự để đồng bộ hiển thị ngoài màn hình Timer và Dashboard.

3. **[MODIFY] `app/api/ktv/booking/route.ts`**
   - Sắp xếp mảng `allGlobalSegs` theo `startTime` trước khi áp dụng `activeSegmentIndex`. 
   - Đảm bảo API cũng hiểu đúng "chặng đầu tiên" là chặng có thời gian sớm nhất, thay vì chặng được tạo ra đầu tiên trong Database.

> [!TIP]
> Việc dựa vào thời gian `startTime` để xếp thứ tự là chính xác nhất vì đó chính là thông số do Lễ tân chủ động cấu hình lúc điều phối, không phụ thuộc vào việc cái nào gán trước, cái nào gán sau.

## User Review Required
Bạn xem hướng giải quyết này đã hợp lý và giải quyết đúng vướng mắc của đơn 006 chưa nhé. Nếu **OK / Duyệt**, mình sẽ tiến hành triển khai cập nhật vào code.
