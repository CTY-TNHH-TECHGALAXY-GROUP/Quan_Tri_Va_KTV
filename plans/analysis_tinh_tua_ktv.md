# Phân tích Yêu cầu: Tính Tua KTV (Chung 1 Đơn / Chung 1 Khách = 1 Tua)

Theo yêu cầu của hệ thống, luật tính tua cho KTV (Kỹ thuật viên) là:
1. **Chung 1 đơn (Booking):** Dù KTV có làm 2, 3 dịch vụ cho khách trong cùng 1 bill thì vẫn chỉ tính là **1 tua**.
2. **Chung 1 khách hàng:** Nếu cùng 1 khách hàng đó tạo 2 đơn khác nhau (bill khác nhau) trong cùng 1 ngày và đều do 1 KTV phục vụ, thì KTV đó cũng chỉ được tính **1 tua**.

---

## 1. Đánh giá hiện trạng hệ thống (As-Is)

Hiện tại, việc đếm tua của KTV đang được chốt cứng thông qua bảng Sổ Cái Tua (`TurnLedger`). 

* **Yêu cầu 1 (Chung 1 đơn = 1 tua):** Đã được xử lý triệt để. Bảng `TurnLedger` đang có ràng buộc Database là `UNIQUE(date, booking_id, employee_id)`. Nghĩa là hệ thống chống trùng lặp dựa trên mã đơn. Dù KTV làm bao nhiêu dịch vụ trong mã đơn đó, Database cũng chỉ cho phép insert đúng 1 dòng. **(Đạt yêu cầu)**
* **Yêu cầu 2 (Chung 1 khách = 1 tua):** Hiện tại **CHƯA** đáp ứng. Ràng buộc hiện tại chỉ dựa vào `booking_id`. Nếu lễ tân tách thành 2 bill (Ví dụ: Bill 1 massage chân, Bill 2 gội đầu) cho cùng 1 chị khách "Nguyễn Văn A" và đều do KTV "NH025" làm, hệ thống sẽ thấy 2 mã đơn khác nhau nên sẽ sinh ra 2 dòng trong `TurnLedger` ➡️ KTV được tính **2 tua** (Sai nghiệp vụ).

---

## 2. Giải pháp kỹ thuật đề xuất (To-Be)

Để giải quyết bài toán "Chung 1 khách = 1 tua", chúng ta cần chuyển trục chống trùng lặp từ `booking_id` sang **định danh khách hàng**.

### Phương án A: Sửa tận gốc tại RPC Database (Khuyến nghị 🌟)
Hiện tại, tua được chốt thông qua Stored Procedure (RPC) `dispatch_confirm_booking`. 
1. **Bước 1:** Trong RPC này, trước khi Insert vào `TurnLedger`, ta sẽ query bảng `Bookings` để lấy ID Khách Hàng (`customerId`) hoặc số điện thoại (`customerPhone`).
2. **Bước 2:** Kiểm tra trong bảng `TurnLedger` xem hôm nay KTV này đã phục vụ khách hàng này chưa:
   ```sql
   -- Nếu khách vãng lai (không nhập tên/sđt): Vẫn đếm theo booking_id
   -- Nếu có khách hàng: Check trùng lặp theo Khách hàng
   IF v_customer_id IS NOT NULL THEN
       SELECT EXISTS(
           SELECT 1 FROM "TurnLedger" 
           WHERE date = CURRENT_DATE 
           AND employee_id = p_employee_id 
           AND customer_id = v_customer_id
       ) INTO v_is_duplicated;
   END IF;
   ```
3. **Bước 3:** Nếu đã tồn tại ➡️ **KHÔNG** insert thêm vào Sổ cái (hoặc insert với đánh dấu `is_counted = false`) ➡️ KTV không bị cộng dư tua.

**Ưu điểm:** Dữ liệu chuẩn ngay từ Database, không sợ bị lệch giữa các màn hình thu ngân/điều phối.
**Nhược điểm:** Phải cẩn thận với "Khách vãng lai". Lễ tân bắt buộc phải nhập sđt/tên khách để hệ thống nhận diện.

### Phương án B: Giữ nguyên DB, sửa hàm đếm Tua (`syncTurnsForDate`)
Bảng `TurnLedger` cứ ghi nhận mọi đơn. Nhưng khi hệ thống chạy hàm đếm tua (`syncTurnsForDate` trong file `lib/turn-sync.ts`), thay vì đếm số dòng (`COUNT(id)`), ta sẽ dùng logic gom nhóm:
1. Nối (Join) bảng `TurnLedger` với bảng `Bookings`.
2. Đếm các đơn hàng có `customerId` khác nhau. Những đơn cùng 1 `customerId` do 1 KTV làm sẽ bị gom (`DISTINCT`) thành 1 tua duy nhất.

**Ưu điểm:** Dễ triển khai, không đụng vào Database.
**Nhược điểm:** Lịch sử ghi nhận (Ledger) nhìn có vẻ KTV được 2 tua, nhưng lên dashboard chỉ hiện 1 tua ➡️ Dễ gây hiểu lầm khi xuất báo cáo đối soát cuối tháng cho KTV.

---

> [!IMPORTANT]
> **Câu hỏi chờ xác nhận từ Lễ Tân / Quản Lý:**
> 1. Anh chọn **Phương án A** (Chặn ngay từ DB, sổ cái luôn đúng) hay **Phương án B**?
> 2. Khách hàng tới Spa đôi khi Lễ Tân nhập "Khách Lẻ" và không lưu sđt. Với những đơn "Khách lẻ" này, hệ thống sẽ mặc định tính tua theo "Mã Đơn" (Tức là 2 mã đơn Khách Lẻ = 2 tua). Chỗ này anh thấy hợp lý chưa ạ?
