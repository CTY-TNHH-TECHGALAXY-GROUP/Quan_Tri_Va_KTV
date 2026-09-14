# Kế hoạch Triển khai: Phân loại Nhân sự (Type A / Type B) & Fix lỗi hiển thị tên KTV ngoài

Dựa trên ý tưởng tuyệt vời của bạn về việc phân loại chế độ làm việc (Loại A: Có lương, điểm danh / Loại B: Tự do, hợp tác), đây là bản kế hoạch kỹ thuật để thực thi.

## 1. Cập nhật Database (Bảng `Staff`)
- Tạo migration SQL thêm cột `work_type` vào bảng `Staff`.
  - Kiểu dữ liệu: `text`.
  - Giá trị mặc định: `'FULLTIME'` (Loại A).
  - Các giá trị cho phép: `'FULLTIME'` (Loại A), `'FREELANCE'` (Loại B).
- Chạy script cập nhật lại toàn bộ nhân viên cũ thành `FULLTIME` (Loại A).
- Cập nhật lại file `TableInSupabase.md` để ghi nhận cột mới.

## 2. Sửa luồng gán KTV ngoài (Dispatch Actions)
- Xóa bỏ logic dùng mã `EXT01` (vì gây lỗi Cache không đổi được tên).
- Khi Lễ tân gõ tên KTV ngoài (VD: "Lan"), hệ thống sẽ kiểm tra xem đã có `FREELANCE` nào tên "Lan" chưa.
  - Nếu CÓ: Tái sử dụng ID của người đó.
  - Nếu CHƯA: Tự động tạo 1 record mới trong bảng `Staff` với tên là "Lan", `status = 'FREELANCE'`, và **`work_type = 'FREELANCE'`** (Loại B).
- Cập nhật lại `technicianCode` thành ID của tài khoản Loại B này.

## 3. Chống rác màn hình Admin (Ẩn KTV Loại B)
- Quét các màn hình Admin liên quan đến Danh sách nhân sự, Chấm công, Lương (ví dụ: `app/admin/staff/`, `app/admin/attendance/` nếu có).
- Thêm bộ lọc để các màn hình này chỉ hiển thị nhân viên có `work_type = 'FULLTIME'`.
- Kết quả: Dù hệ thống có tạo ra thêm 100 tài khoản KTV Loại B (từ việc Lễ tân gõ tên ngoài), danh sách nhân sự của Quản lý vẫn sạch sẽ và chỉ hiện KTV Loại A.

## 4. Chấm công và Hàng đợi
- Đảm bảo KTV Loại B vẫn vào `TurnQueue` bình thường khi được điều phối.
- Màn hình điểm danh sẽ bỏ qua KTV Loại B (Vì họ là hợp tác, không điểm danh theo ca).

> [!NOTE]
> Bạn hãy đọc file `analysis_staff_classification.md` tôi vừa tạo (ở khung bên phải) để xem phân tích chi tiết tại sao giải pháp này lại là chuẩn mực nhất.

Bạn xem kế hoạch này có đúng với định hướng "hướng đi mới" của bạn không? Nếu chốt thì tôi sẽ bắt tay vào code!
