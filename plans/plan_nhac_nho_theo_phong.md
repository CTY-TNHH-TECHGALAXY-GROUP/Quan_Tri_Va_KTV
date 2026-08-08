# Kế hoạch & Phân Tích: Tự động hóa Nhắc Nhở Theo Phòng (Room-based Reminders) - Cập Nhật Đồng Bộ

## 1. Đánh giá từ AI Sparring Partner (Phản biện & Tối ưu)
**Ý tưởng của bạn CỰC KỲ XUẤT SẮC!** Việc gán câu nhắc nhở mặc định theo từng phòng (VD: V3 auto báo đổ xô nước V3, PG auto báo PG) giải quyết triệt để lỗi "quên dặn dò" của Lễ tân, tối ưu hóa tốc độ điều phối.

**✅ Ưu điểm:**
- Lễ tân không cần nhớ thuộc lòng đặc tính từng phòng.
- Tự động hóa 80% công việc nhập liệu khi điều phối. Lễ tân chỉ can thiệp bằng tay nếu có ngoại lệ.

**⚠️ Rủi ro nhỏ cần chú ý (Edge Case):**
- **Đổi phòng đột xuất:** Nếu trên modal điều phối, Lễ tân lỡ chọn phòng V3 (hệ thống auto-tick nhắc nhở V3), nhưng sau đó đổi ý chọn phòng V4. **Giải pháp:** Cần code logic "lắng nghe" (watch) sự thay đổi của ô Chọn Phòng. Hễ đổi phòng là hệ thống tự reset lại danh sách tick mặc định cho đúng phòng mới.

## 2. Kiến trúc Database cần bổ sung
Thay vì hardcode, chúng ta sẽ liên kết bảng `Rooms` với bảng `Reminders`:
- **Thêm cột vào bảng `Rooms`**: Bổ sung thêm field `default_reminders` (kiểu `jsonb` chứa mảng các ID hoặc UUID của `Reminders`).
- *Ví dụ dữ liệu trong DB*: Phòng V3 sẽ có `default_reminders = ["uuid-cua-cau-v3", "uuid-cua-cau-tat-thiet-bi"]`.

## 3. Quy trình hoạt động & Đồng bộ (Workflow)
Hệ thống sẽ đồng bộ tính năng này ở cả 2 chế độ trên Dispatch Board:

### A. Chế độ Điều phối Nhanh (Fast Dispatch)
- Khi Lễ tân click nhanh vào một giường hoặc chọn KTV để gán phòng:
- Hệ thống tự động lấy danh sách `Reminders` của phòng đó.
- Điền sẵn vào ô Ghi chú nhanh (Quick Note) mà không cần Lễ tân phải gõ.
- Vẫn cho phép click vào icon gợi ý để tick thêm/bớt nhanh.

### B. Chế độ Điều phối Chi tiết (Detailed Dispatch)
- Khi mở Modal/Sheet chi tiết để chỉnh sửa nhiều thông tin:
- Ngay khi chọn Phòng (Room Select), field Ghi chú sẽ tự động cập nhật chuỗi nhắc nhở của phòng đó.
- Sử dụng Popover Multi-select để Lễ tân tùy chỉnh thêm các câu nhắc nhở khác một cách chi tiết.

## 4. Kế hoạch Code
- **Bước 1 (DB)**: Tạo migration thêm cột `default_reminders` vào bảng `Rooms`.
- **Bước 2 (Admin UI)**: Sửa giao diện Quản lý Phòng (thêm mục chọn nhắc nhở).
- **Bước 3 (Dispatch UI)**: 
  - Cập nhật logic đồng bộ cho cả `FastDispatch` và `DetailedDispatch` components.
  - Viết hook `useRoomReminders` dùng chung cho cả 2 chế độ để đảm bảo tính nhất quán.
