# Kế hoạch Tích hợp Câu Nhắc Nhở vào Màn hình Điều Phối

## 1. Phân tích Yêu cầu (Hiểu ý User)
- **Vị trí**: Tại màn hình Điều phối KTV (Dispatch Board), nơi Lễ tân/Admin ghi chú hoặc phân tài cho KTV.
- **Tính năng**: Khi người điều phối trỏ chuột (hoặc click) vào ô nhập "Ghi chú/Nhắc nhở", hệ thống sẽ hiển thị một danh sách gợi ý (Dropdown/Popover) xổ ra các câu từ bảng `Reminders`.
- **Thao tác**: Người điều phối có thể tick chọn **nhiều câu** cùng lúc (Multi-select).
- **Kết quả đầu ra**: Các câu được chọn sẽ được tự động nối lại với nhau thành một chuỗi, cách nhau bằng dấu `" - "`.
  - *Ví dụ:* Chọn 3 câu: "TẮT THIẾT BỊ", "ĐỌC KỸ BILL", "ĐỔ XÔ NƯỚC Ở PG".
  - *Kết quả sinh ra ở ô text:* `TẮT THIẾT BỊ - ĐỌC KỸ BILL - ĐỔ XÔ NƯỚC Ở PG`.

## 2. Giải pháp Kỹ thuật & UI/UX
1. **Data Fetching (Hook)**:
   - Viết một hook `useReminders()` để fetch dữ liệu từ bảng `Reminders` (chỉ lấy các dòng `is_active = true`, sắp xếp theo `order_index`).
2. **UI Component (Ví dụ: `ReminderPopover.tsx` hoặc `ReminderSelect`)**:
   - Gắn một nút nhỏ (icon bóng đèn 💡 hoặc danh sách) bên cạnh ô Textarea ghi chú lúc điều phối. Hoặc khi focus/trỏ vào ô Textarea, sẽ hiện Popover.
   - Bên trong Popover là danh sách các Checkbox để người dùng tick chọn.
3. **Logic Nối chuỗi**:
   - Khi tick/bỏ tick, mảng các câu chọn sẽ được xử lý: `selectedReminders.join(' - ')`.
   - Chuỗi này sẽ được tự động chèn/cập nhật vào state của ô Input/Textarea ghi chú hiện tại để chuẩn bị gửi/lưu lại.

## 3. Các bước triển khai (Các file cần sửa)
- [ ] **Tạo/Sửa Logic Fetch Data**: Viết function lấy dữ liệu từ Supabase bảng `Reminders`.
- [ ] **Tạo UI Component Gợi Ý**: Component chứa danh sách checkbox, xử lý logic nối chuỗi `join(' - ')`.
- [ ] **Tích hợp vào Màn hình Điều phối**: Tìm component Modal phân ca/điều phối (Dispatch/Assign Modal) và nhúng component Gợi ý này vào ô nhập ghi chú.

*(Sau khi hoàn thành, KTV nhận được thông báo điều phối sẽ đọc được chuỗi nhắc nhở được nối với nhau rất rõ ràng).*
