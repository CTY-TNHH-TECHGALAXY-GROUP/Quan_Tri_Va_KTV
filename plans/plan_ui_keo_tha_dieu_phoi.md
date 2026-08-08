# Kế hoạch Bổ Sung Kéo Thả (Drag & Drop) & Accordion UI + Tự Động Nối Giờ

## Phân tích Yêu cầu
Để việc điều phối dễ dàng hơn, đặc biệt khi 1 KTV làm nhiều dịch vụ (VD: làm T trước, V1 sau), ta sẽ thiết kế lại UI khu vực điều phối chi tiết của đơn hàng.
- **Accordion (Thu/gọn):** Các dịch vụ sẽ hiển thị dạng thanh gọn gàng (chỉ hiện tên, thời lượng, và nút mở rộng). Khi cần điều phối chi tiết mới "sổ ra".
- **Drag & Drop (Hỗ trợ Mobile):** Cho phép cầm các thanh dịch vụ này kéo thả lên xuống để đổi thứ tự trực quan. Hỗ trợ **nhấn giữ để kéo thả** trên thiết bị cảm ứng (điện thoại/tablet).
- **Auto-link Time (Nối giờ tự động):** Ngay sau khi kéo thả đổi thứ tự xong, hệ thống sẽ quét từ trên xuống, nếu thấy KTV nào làm nhiều dịch vụ thì **tự động nối giờ** (Lấy giờ kết thúc của DV trên áp ngay vào giờ bắt đầu của DV dưới).

## Chi tiết Triển khai

### 1. [MODIFY] `app/reception/dispatch/page.tsx`
- **Sử dụng Framer Motion (`Reorder`):** Dự án đã có sẵn thư viện `motion`, ta sẽ dùng component `<Reorder.Group>` và `<Reorder.Item>` để tạo list kéo thả. `Reorder` hỗ trợ mượt mà cả chuột trên PC và thao tác **chạm/nhấn giữ trên Mobile** mà không cần cài thêm thư viện phức tạp.
- Thêm state lưu ID dịch vụ đang mở (expand). Mặc định thu gọn lại thành dạng thanh (Bar).
- Viết hàm `recalculateAllTimes(order)`:
  - Hàm này được gọi mỗi khi thứ tự mảng `services` thay đổi (sau khi thả tay).
  - Lặp qua mảng `services`, track thời gian làm việc của từng KTV (`ktvLastEndTime`).
  - Cập nhật lại `startTime` và `endTime` cho tất cả các chặng phía dưới một cách tự động.

### 2. Triển khai tiếp `plan_sap_xep_chang.md` (Đã duyệt)
- Vì UI Điều phối (Reception) đã sắp xếp thứ tự và tính giờ chuẩn xác, Backend và KTV Dashboard chỉ việc lấy đúng `startTime` này để sort.
- Sửa `app/ktv/dashboard/KTVDashboard.logic.ts` và `app/api/ktv/booking/route.ts` để gộp và sắp xếp các `segments` theo thời gian `startTime`, đảm bảo KTV Dashboard hiển thị chính xác tiến trình làm việc.

> [!TIP]
> Việc dùng `Framer Motion Reorder` mang lại cảm giác cực kỳ "Premium" nhờ các hiệu ứng Animation mượt mà và xử lý cảm ứng (Touch) trên Mobile cực kỳ tốt, đúng chuẩn App cao cấp.

## User Review Required
Mình đã bổ sung giải pháp xử lý thao tác nhấn giữ kéo thả trên điện thoại vào Plan rồi nhé. Bạn xem lại, nếu **OK / Duyệt** thì mình bắt tay vào code!
