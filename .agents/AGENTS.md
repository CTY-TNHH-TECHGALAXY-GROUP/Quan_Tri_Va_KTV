# Global Projec

## 11. Stable Code Protection (BẢO VỆ FILE ỔN ĐỊNH)
- **Quy tắc:** Khi User yêu cầu sửa đổi các file đã chạy ổn định (Core/Stable files), AI KHÔNG ĐƯỢC tự ý dùng lệnh sửa file ngay lập tức để tránh lỗi hồi quy (Regression Bug).
- **Quy trình bắt buộc (Protocol):**
  1. AI phải tạo một file báo cáo phân tích (Markdown Artifact) hiển thị cấu trúc `.diff` rõ ràng (dòng nào bị xóa đi, dòng nào thêm vào).
  2. Dừng lại và yêu cầu User xác nhận bằng câu lệnh: *"Duyệt sửa file ổn định"*.
  3. Chỉ khi User gõ chính xác từ khóa đồng ý, AI mới được phép thực thi lệnh sửa file.
