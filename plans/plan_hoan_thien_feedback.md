# Kế hoạch Hoàn thiện Feedback và Tách Đơn (Phòng Riêng)

## 1. Phân tích nguyên nhân vụ "B-B"
Về thắc mắc "tại sao thao tác chưa làm gì mà đơn lại thành B-B":
- **Giải thích:** Khi 1 đơn lớn có 3 dịch vụ lẻ (không có `customerGroupId` chung) được đẩy về màn hình Kanban, nếu bạn ấn **Lưu** hoặc dùng chức năng **Điều phối nhanh (Quick Dispatch)**, hệ thống sẽ nhận diện đây là 3 dịch vụ của 3 khách độc lập và **tự động gọi lệnh tách đơn**.
- **Về việc hiển thị `B-B`:** Có thể do trên màn hình Kanban, bạn nhìn thấy mã đơn đã được tách hiển thị là `002-16082026-B`. Việc nó tự sinh ra hậu tố `B` là hệ quả trực tiếp của việc bấm "Lưu" khiến hệ thống chia nhỏ hóa đơn thành `A`, `B`, `C`. Không có tình trạng lỗi nhân đôi `B-B` trong DB.

## 2. Xử lý chức năng Chọn ngày tại trang Feedback
Hiện tại trang `app/reception/feedback/page.tsx` đang bị fix cứng ngày `2026-08-15`.
**Giải pháp:**
- Thêm một `input type="date"` (Date Picker) ở thanh công cụ phía trên.
- Sử dụng `useState` để lưu trữ ngày được chọn.
- Truyền ngày này vào hook `useFeedbackDashboard(selectedDate)` để hệ thống tự động fetch lại danh sách khách hàng tương ứng với ngày đó.

## 3. Xử lý "Phòng riêng" khi Tách Đơn

> **Cần User Quyết Định (Open Question)**
> 
> Hiện tại, "Phòng riêng" (is_utility = true) đang được coi như một dịch vụ thông thường trong thuật toán tách đơn. Nghĩa là nếu đơn có 3 DV + 1 Phòng riêng, hệ thống sẽ tách thành 4 đơn con (Khách A, Khách B, Khách C, và 1 Khách "Phòng riêng"). 
> 
> Vui lòng chọn phương án xử lý Phòng riêng khi tách đơn:
> 
> - **Phương án 1 (Gộp vào Khách A):** Tự động nhét "Phòng riêng" vào chung hóa đơn của người đầu tiên (Khách A).
> - **Phương án 2 (Để riêng độc lập):** Giữ nguyên như hiện tại, "Phòng riêng" là 1 block độc lập (Khách D) để sau này ai trả tiền phòng thì tính riêng.
> - **Phương án 3 (Chia đều tiền phòng):** Không tách phòng riêng ra khỏi bill gốc, hoặc chia đều phí phòng riêng cho tất cả các khách. (Sẽ phức tạp hơn về mặt tính tiền).

## Đề xuất thực thi
- Tôi sẽ tiến hành làm phần DatePicker ngay sau khi bạn Duyệt plan này.
- Phần Phòng Riêng sẽ được code bổ sung ngay khi bạn chốt phương án 1, 2 hay 3.
