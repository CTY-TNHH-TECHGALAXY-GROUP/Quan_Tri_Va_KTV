# 📄 Hướng Dẫn Tích Hợp: Tính Bonus Cho Đơn Tách (Split Booking)

Tài liệu này mô tả chi tiết về cơ chế **Tách Đơn (Split Booking)** ở phía Database và Logic Điều Phối, giúp các Developer (Đội phát triển tính năng Tính Bonus / Hoa hồng) hiểu rõ cấu trúc dữ liệu để tính toán chính xác thù lao cho Kỹ thuật viên (KTV).

---

## 1. Tổng Quan Cơ Chế Tách Đơn (Split Booking)

Trước đây, hệ thống cho phép **gộp chung** nhiều khách hàng (nhiều dịch vụ) vào cùng 1 Đơn Hàng (Booking). 
Tuy nhiên, để tối ưu quy trình điều phối và tính tiền, hệ thống đã hỗ trợ **Tách Đơn (Split)**: 
Một Đơn Gốc (Parent Booking) có thể được tách thành nhiều Đơn Con (Child Bookings), mỗi đơn con đại diện cho 1 khách hàng / nhóm dịch vụ riêng biệt.

### Các thay đổi chính trong Schema `Bookings`:
- **`status` Enum:** Bổ sung thêm trạng thái `'SPLIT'`.
- **`parent_booking_id` (text):** Khóa ngoại trỏ ngược về ID của Đơn Gốc. Nếu là đơn bình thường hoặc Đơn Gốc, giá trị này là `null`. Nếu là Đơn Con, nó chứa ID của Đơn Gốc.
- **`sub_suffix` (text):** Hậu tố của đơn con (VD: `A`, `B`, `C`).

---

## 2. Luồng Dữ Liệu Khi Tách Đơn

Khi Lễ tân thực hiện tách đơn (Gọi RPC `split_booking_into_sub_bookings`), hệ thống sẽ:

1. **Giữ nguyên Đơn Gốc:** Đơn Gốc **không bị xóa**, nhưng trạng thái (status) của nó sẽ bị đổi thành `'SPLIT'`. 
2. **Tạo các Đơn Con:** Sinh ra các record `Bookings` mới.
   - `id` của đơn con = `[ID Đơn Gốc]-[Suffix]` (VD: `12345-A`).
   - `billCode` của đơn con = `[BillCode Đốc Gốc]-[Suffix]`.
   - `customerName` của đơn con = `[Tên khách gốc] - Khách [Suffix]` (VD: `Nguyễn Văn A - Khách A`).
   - `parent_booking_id` = `[ID Đơn Gốc]`.
3. **Di chuyển Dịch vụ (BookingItems):** 
   - Các dịch vụ (`BookingItems`) được gán cho khách nào sẽ được **chuyển `bookingId`** sang ID của Đơn Con tương ứng.
   - Do đó, Đơn Gốc (sau khi tách) sẽ **không còn `BookingItems`** nào liên kết trực tiếp tới nó nữa.
4. **Tính toán lại Tiền:** `totalAmount` của từng đơn con được tính lại dựa trên giá trị các `BookingItems` mà nó chứa.

---

## 3. Lưu Ý Cốt Lõi Khi Tính Bonus (Hoa Hồng)

Khi viết Query hoặc Logic tính Bonus / Lương / Tua cho KTV, Developer cần lưu ý các điểm sinh tử sau:

> **Bỏ qua Đơn Gốc (status = 'SPLIT')**
> Đơn gốc đã tách CHỈ ĐÓNG VAI TRÒ LỊCH SỬ. Tuyệt đối **KHÔNG** tính bonus cho các đơn hàng có `status = 'SPLIT'`. Việc tính bonus chỉ thực hiện trên các đơn hàng có trạng thái hợp lệ (VD: `DONE`, `COMPLETED`, `FEEDBACK`).

> **Đơn Con hoạt động như một Đơn Độc Lập**
> Về mặt tính toán Bonus, Đơn Con (`parent_booking_id IS NOT NULL`) được xử lý **hoàn toàn giống như một Đơn Hàng bình thường**. KTV được điều phối vào Đơn Con sẽ có `KtvAssignments`, `TurnLedger` liên kết với `id` của Đơn Con đó.

### Flow Query Tham Khảo (Giả mã SQL):
```sql
-- Lấy danh sách KTV được hưởng bonus trong ngày
SELECT 
    ka.employee_id,
    b.id as booking_id,
    b.parent_booking_id, -- Có thể dùng để hiển thị UI "Đơn thuộc nhóm nào"
    b."billCode",
    bi.price,
    ...
FROM "KtvAssignments" ka
JOIN "Bookings" b ON ka.booking_id = b.id
JOIN "BookingItems" bi ON ka.booking_item_id = bi.id
WHERE 
    b.status IN ('DONE', 'COMPLETED') -- Bỏ qua 'SPLIT', 'CANCELLED'
    AND ka.status = 'COMPLETED'
    AND b."business_date" = '2026-08-15';
```

---

## 4. Cơ Chế "Hủy Gộp/Tách" (Undo Split)

Hệ thống có cơ chế `undo_split_booking`. Lễ tân có thể "Hủy tách đơn".
Nếu việc này xảy ra:
1. Tất cả các Đơn Con sẽ bị **XÓA** (Hard Delete).
2. Các `BookingItems` sẽ được gán ngược lại cho Đơn Gốc.
3. Đơn Gốc sẽ chuyển trạng thái từ `'SPLIT'` về lại `'NEW'` (hoặc `pending`).

**Tác động tới Bonus:** 
Bởi vì việc Hủy Tách chỉ được phép thực hiện khi đơn hàng **chưa được KTV hoàn thành** (chưa ra tiền), nên nó sẽ không ảnh hưởng tới bảng tính Bonus cuối ngày. (Chỉ những đơn `DONE` mới được tính bonus, mà đơn `DONE` thì Lễ tân không thể Hủy Tách được nữa).

---

## 5. Tóm Lược Checklist Cho Dev Bonus
- [ ] Lọc bỏ toàn bộ `Bookings` có `status = 'SPLIT'`.
- [ ] Truy vấn Bonus dựa vào ID của Đơn Hàng hiện tại (Đơn Con hoặc Đơn Thường đều nằm ở bảng `Bookings`).
- [ ] (Tùy chọn) Nhóm các Đơn Con lại với nhau trên UI Báo cáo dựa vào trường `parent_booking_id` để Quản lý dễ đọc báo cáo hơn.
- [ ] Ghi nhận `customerName` của đơn con (đã có sẵn hậu tố `- Khách A`) để in ra bill trả lương cho KTV chính xác.
