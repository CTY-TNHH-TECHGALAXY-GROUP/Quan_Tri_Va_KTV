Phân tích Kiến trúc Trang Điều Phối vs Trang Giám Sát Kanban
Dựa trên cấu trúc mã nguồn hiện tại (KanbanBoard.tsx và QuickDispatchTable.tsx), hệ thống đang áp dụng 2 góc nhìn hoàn toàn khác nhau để giải quyết 2 bài toán vận hành độc lập tại quầy Lễ tân.

1. Trang Điều Phối (Dispatch) - Góc nhìn "Đơn Hàng Mẹ" (Customer Journey)
Đây là nơi dùng để LẬP KẾ HOẠCH và PHÂN BỔ TÀI NGUYÊN.

Đơn vị xử lý: Toàn bộ một đơn hàng (Booking).
Cách thức hoạt động:
Giao diện gộp các dịch vụ giống nhau lại (gom theo serviceName và thời gian).
Cho phép Lễ tân nhét các KTV (staffList), chọn phòng, chọn giường (segments) vào từng dịch vụ đó.
Vẫn giữ nguyên khối Đơn Hàng Mẹ, không chia cắt.
Mục đích: Phục vụ Lễ tân lúc khách mới tới. Khách mua 3 dịch vụ, Lễ tân nhìn vào tổng thể 3 dịch vụ đó để biết phải bố trí khách đi lộ trình như thế nào (Vào phòng nào trước, KTV nào làm trước).
2. Trang Giám Sát Kanban - Góc nhìn "Tiến độ KTV" (Operational Workflow)
Đây là nơi dùng để THEO DÕI THỰC TẾ và ĐẨY TRẠNG THÁI.

Đơn vị xử lý: Thẻ công việc chia theo nhóm KTV (SubOrder).
Cách thức hoạt động (Cơ chế Tách Đơn):
Hệ thống sẽ quét toàn bộ dịch vụ trong đơn mẹ. Nó sẽ gom nhóm các dịch vụ dựa trên ktvSignature (chữ ký KTV - tức là KTV nào được gán).
Nếu Đơn Mẹ có 2 dịch vụ, nhưng gán cho 2 KTV khác nhau ở 2 khung giờ khác nhau, hệ thống sẽ TỰ ĐỘNG TÁCH thành 2 thẻ trên Kanban (và hiển thị chữ (Tách) bên cạnh mã bill).
Trạng thái (Chuẩn bị, Đang làm, Dọn phòng, Hoàn tất) được tính toán RIÊNG BIỆT cho từng thẻ tách này.
Mục đích: Phục vụ lúc khách đang làm dịch vụ. Giả sử khách mua combo 2 tiếng (Tiếng 1 gội đầu với KTV A, tiếng 2 massage với KTV B). Lễ tân cần biết KTV A đã làm xong chưa để chuyển khách sang phòng massage cho KTV B. Nếu để 1 đơn mẹ, trạng thái sẽ bị dính cục, không biết ai đang làm, ai đã xong.
3. Tại sao lại có sự khác biệt này? (Ưu điểm kiến trúc)
Kiến trúc này rất thông minh ở điểm: Database chỉ lưu 1 Đơn Mẹ duy nhất (Booking), trong đó chứa nhiều Dịch vụ con (BookingItems).

Trang Điều phối thực hiện lệnh UPDATE vào các Dịch vụ con của Đơn mẹ đó.
Trang Kanban thực hiện lệnh SELECT và dùng logic frontend (useMemo với ktvGroups) để xé nhỏ Đơn Mẹ ra hiển thị thành nhiều SubOrder dựa trên sự phân bổ KTV.
Điều này giải quyết triệt để bài toán: Một khách đi qua nhiều phòng, nhiều KTV trong 1 lần đến Spa, Lễ tân có thể giám sát chi tiết từng công đoạn mà không làm rác Database bằng cách tạo ra hàng chục order giả.

4. Vấn đề có thể phát sinh (Rủi ro cần lưu ý)
Vì 2 bảng này view dữ liệu theo 2 cách khác nhau, một số lỗi đồng bộ có thể xảy ra:

Lỗi Trạng Thái Đơn Mẹ: Nếu 1 thẻ (Tách) hoàn tất, nhưng thẻ (Tách) còn lại vẫn đang làm, trạng thái tổng của Đơn Mẹ phải được tính toán cực kỳ cẩn thận. Nếu không, Đơn Mẹ có thể bị nhảy sang "Hoàn tất" sớm trước khi thẻ thứ 2 xong.
Auto-Finish Xung Đột: Tool tự động chuyển trạng thái (như tự chuyển sang Dọn phòng khi hết giờ) phải chọc đúng vào BookingItem của thẻ tách đó, chứ không được chọc vào Booking tổng, nếu không sẽ phá hỏng toàn bộ các dịch vụ chưa làm của thẻ còn lại. (Đây chính là lý do code hiện tại ở Kanban truyền itemIds khi gọi onUpdateStatus).