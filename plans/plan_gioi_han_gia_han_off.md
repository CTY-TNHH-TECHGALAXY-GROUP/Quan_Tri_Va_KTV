# Kế Hoạch Triển Khai: Giới Hạn Gia Hạn Đăng Ký Nghỉ (Off)

## 1. Yêu Cầu Bài Toán
*   **Quy định:** Mỗi KTV được phép "gia hạn" lịch nghỉ một số lần nhất định trong tháng (cài đặt trong `SystemConfigs`).
*   **Định nghĩa "Gia hạn":** 
    *   Lần 1 đăng ký nghỉ ngày 2, 3. Sau đó đăng ký tiếp ngày 4, 5 -> Liền kề với ngày 3 -> **Tính là 1 lần gia hạn**.
    *   Nếu lần 1 đăng ký ngày 2, 3. Đi làm ngày 4. Đăng ký ngày 5, 6 -> Có khoảng hở (gap) đi làm -> **Đợt nghỉ mới, KHÔNG tính là gia hạn**.
*   **Cảnh báo & Xử lý vượt hạn mức:**
    *   **Trước khi trừ:** Khi KTV chọn ngày, nếu hệ thống nhận diện đây là lệnh "Gia hạn", sẽ hiện thông báo: *"Bạn đang thao tác đăng ký gia hạn ngày nghỉ. Số lần gia hạn còn lại trong tháng là: X lần."*
    *   **Hết lượt:** Nếu KTV đã hết số lần gia hạn (X = 0), cảnh báo: *"Bạn đã hết lần gia hạn. Nếu tiếp tục đăng ký, ngày nghỉ này sẽ bị tính là Nghỉ Đột Xuất."*
    *   Nếu KTV bấm "Tiếp tục", hệ thống sẽ lưu đơn nghỉ này với trạng thái là **Nghỉ Đột Xuất (Sudden Off)**.

## 2. Giải Pháp Kỹ Thuật (Database & API)

### 2.1. Cập nhật Database (Supabase)
*   **Bảng `SystemConfigs`:** Thêm/sử dụng key `max_leave_extensions_per_month` (Số lần gia hạn tối đa 1 tháng, mặc định = 1).
*   **Bảng `KTVLeaveRequests`:** Thêm 2 cột:
    *   `is_extension` (Kiểu: `boolean`, Mặc định: `false`): Đánh dấu đây là ngày gia hạn.
    *   `is_sudden_off` (Kiểu: `boolean`, Mặc định: `false`): Đánh dấu KTV cố tình nghỉ khi đã hết lượt gia hạn.

### 2.2. Logic Xử Lý Frontend (Màn hình đăng ký OFF)
*   **Kiểm tra trước khi submit (Pre-check):** 
    *   Khi KTV chọn ngày và bấm "Đăng ký", Frontend gọi API `POST /api/ktv/leave/check` để kiểm tra.
    *   API trả về: `isExtension` (true/false), `extensionsRemaining` (int).
    *   Nếu `isExtension = true` và `extensionsRemaining > 0`: Hiển thị Popup xác nhận *"Đang đăng ký gia hạn. Còn lại X lần. Đồng ý?"*
    *   Nếu `isExtension = true` và `extensionsRemaining <= 0`: Hiển thị Popup cảnh báo *"Hết lượt gia hạn. Tiếp tục sẽ bị tính là Nghỉ Đột Xuất. Đồng ý?"*
*   **Gửi xác nhận:** KTV bấm đồng ý, Frontend gửi API `POST /api/ktv/leave` kèm theo biến `confirmExtension=true` hoặc `confirmSuddenOff=true`.

### 2.3. Logic Xử Lý Trong API (`POST /api/ktv/leave`)
**Bước 1: Quét và nhận diện gia hạn**
*   Lấy ngày sớm nhất trong danh sách đăng ký. Kiểm tra ngày liền trước đó KTV có đang nghỉ hay không. Nếu có -> Gắn nhãn `isExtension = true`.

**Bước 2: Xử lý dựa trên Confirm Flags**
*   Nếu không có cờ `confirm`, API ném lỗi yêu cầu Frontend bật Popup.
*   Nếu có cờ `confirmExtension`: Lưu vào DB với `is_extension = true`.
*   Nếu có cờ `confirmSuddenOff`: Lưu vào DB với `is_extension = true` và `is_sudden_off = true`.
*   Tạo thông báo (Notification) tương ứng cho Admin (VD: *"KTV A đã đăng ký NGHỈ ĐỘT XUẤT do hết lượt gia hạn"*).

## 3. Các Bước Thực Hiện Cụ Thể
1.  Chạy Migration thêm cột `is_extension`, `is_sudden_off` vào `KTVLeaveRequests`.
2.  Cập nhật file `TableInSupabase.md`.
3.  Thêm biến config `max_leave_extensions_per_month` vào bảng `SystemConfigs` (hoặc set cứng mặc định nếu chưa có DB UI).
4.  Viết API `/api/ktv/leave/check` để check trước số lượt.
5.  Sửa đổi luồng của UI Đăng ký Nghỉ để hỗ trợ Popup xác nhận.
6.  Cập nhật API `POST /api/ktv/leave` để ghi nhận các flags mới.
