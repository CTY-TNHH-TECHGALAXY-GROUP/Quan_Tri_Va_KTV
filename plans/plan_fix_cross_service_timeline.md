# Phân Tích Lỗi & Kế Hoạch Xử Lý "Nối Tiếp Giữa Các Dịch Vụ Khác Nhau"

## 1. Phân Tích Nguyên Nhân Gốc Rễ (Root Cause)
Sau khi kiểm tra toàn bộ mã nguồn và luồng logic, em đã phát hiện ra chính xác tại sao "người thứ 2 bị reset giờ" (hoặc không nhận được giờ của người thứ 1).

**Sự kiện đã xảy ra:**
1. Lễ tân đã làm đúng theo lời khuyên của chúng ta trước đó: **Tạo thành 2 dòng dịch vụ độc lập** (Ví dụ: Dịch vụ A cho NH007, Dịch vụ B cho NH016) thay vì nhét chung vào 1 dòng.
2. Vì nằm ở 2 dòng dịch vụ khác nhau, chúng trở thành **2 BookingItems độc lập** trong Database.
3. Code hiện tại của Kanban (bản vá vừa rồi) **chỉ tính toán thời gian nối tiếp nếu 2 KTV nằm chung trong 1 BookingItem**. Nó hoàn toàn bỏ qua việc liên kết thời gian giữa các BookingItems khác nhau!
4. Kết quả: Khi NH007 (Dịch vụ A) bấm "Bắt đầu làm", giờ của NH007 nhảy đúng. Nhưng NH016 (Dịch vụ B) không hề được liên kết với NH007, nên giờ của NH016 bị trả về giờ tạo đơn gốc (07:04 UTC / 14:04 Local) thay vì nối tiếp sau NH007.

## 2. Kế Hoạch Triển Khai (Implementation Plan)

Để giải quyết bài toán này một cách triệt để nhất (không cần Lễ tân phải tự tính toán giờ tay), chúng ta sẽ thiết lập **Sợi Dây Liên Kết Thời Gian Xuyên Suốt Đơn Hàng (Cross-Service Timeline Chaining)**.

### Bước 1: Tính toán Timeline Mở Rộng Ở Cấp Độ Đơn Hàng (Order Level)
Trong file `KanbanBoard.tsx`, em sẽ viết lại thuật toán tính giờ động (`dynamicStartTimes`). Thay vì chỉ tính bên trong nội bộ 1 Dịch Vụ, em sẽ tính **xuyên qua toàn bộ các Dịch vụ của Đơn hàng đó**.

*   Sắp xếp toàn bộ KTV của tất cả các dịch vụ trong Đơn hàng theo thứ tự thời gian.
*   Nếu phát hiện KTV sau bắt đầu trễ hơn KTV trước (Dù khác dịch vụ nhưng chung 1 khách/1 đơn), tự động lấy `End Time` của người trước làm `Start Time` của người sau.

### Bước 2: Cập Nhật UI Kanban Để Bắt Tín Hiệu
*   Khi người thứ 1 bấm "Bắt đầu làm", trạng thái thực tế (`actualStartTime`) của người thứ 1 được xác lập.
*   Thẻ Kanban của người thứ 2 sẽ tự động nhận diện `actualStartTime` của người 1 để đẩy giờ dự kiến của mình lên theo thời gian thực.
*   Nếu người 1 bấm "Hoàn tất" sớm, người 2 sẽ tự động thụt giờ lại sớm hơn!

### Bước 3: Đảm bảo độ mượt mà (Không lưu vào DB người 2)
Giống như anh nhận định: *"Có vẻ nó thiếu nơi lưu trữ"*. Thực tế, chúng ta **không nên lưu cứng (hardcode)** giờ của người thứ 2 vào Database ngay lúc này, vì giờ của người 1 còn có thể thay đổi (làm trễ, làm lố giờ). 
Thay vào đó, nơi lưu trữ chính là **Bộ Não Tính Toán (Memory/State)** của giao diện Kanban. Giao diện sẽ tự tính toán Real-time mỗi khi màn hình tải lại hoặc người 1 cập nhật trạng thái.

---
**Anh duyệt kế hoạch này để em tiến hành code thuật toán nối tiếp liên dịch vụ (Cross-Service) vào file `KanbanBoard.tsx` nhé!**
