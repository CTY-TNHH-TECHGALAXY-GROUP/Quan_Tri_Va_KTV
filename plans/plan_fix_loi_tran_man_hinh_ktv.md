# Kế hoạch sửa lỗi mất nút "Chọn tất cả" trên KTV Dashboard

## 🎯 Nguyên nhân gốc rễ (Root Cause)
Qua việc phân tích 2 ảnh chụp màn hình và mã nguồn `app/ktv/dashboard/page.tsx`, nguyên nhân khiến nút **"Chọn tất cả"** bị mất / không bấm được là do **Lỗi tràn chiều ngang (Horizontal Overflow)**:
- Phần hiển thị tên khách hàng (vd: `Rose Huyen - ...`) và Mã Bill (`#003-240820...`) đang được đặt trong một `flex` container mà KHÔNG có thuộc tính tự động xuống dòng (`flex-wrap`).
- Khi tên khách hoặc mã bill quá dài, thay vì bị cắt bớt hoặc xuống dòng, chúng sẽ đẩy toàn bộ chiều rộng của thẻ (card) phình to ra.
- Hậu quả là phần bên phải của thẻ (bao gồm nút "Quy trình" và nút "Chọn tất cả") bị đẩy ra khỏi màn hình điện thoại (vượt quá chiều rộng thiết bị). Nút bị che đi một phần (như trong ảnh 1) hoặc che mất hoàn toàn, dẫn đến KTV không nhìn thấy toàn vẹn để bấm được.

## 🛠 Giải pháp kỹ thuật

Tôi sẽ thực hiện sửa lỗi trực tiếp trên file `app/ktv/dashboard/page.tsx`:

1. **Khắc phục tràn container hiển thị tên khách:**
   - Cập nhật dòng: `<div className="flex items-center gap-2 mt-1">`
   - Thêm `flex-wrap`: `<div className="flex items-center gap-2 mt-1 flex-wrap">` để khi dài quá giới hạn thiết bị, mã bill sẽ tự rớt xuống dòng dưới thay vì bành trướng ngang.
   - Bổ sung `flex-1 min-w-0` vào thuộc tính tên khách hàng để hỗ trợ cắt chữ (truncate) chính xác trên các màn hình hẹp.

2. **Bảo vệ nút "Chọn tất cả":**
   - Thêm thuộc tính `shrink-0 whitespace-nowrap` vào nút **"Chọn tất cả"** để đảm bảo nút này luôn giữ nguyên kích thước đầy đủ và chữ trên nút không bao giờ bị bóp méo hay che mất.

3. **Củng cố khu vực Phòng/Giường & Quy trình:**
   - Dòng `<div className="flex justify-between items-end mb-6">` cũng sẽ được bổ sung `flex-wrap gap-2` để đảm bảo khu vực hiển thị vị trí (Phòng, Giường) và nút "Quy trình" luôn nằm trong vùng an toàn, không bị tràn trên màn hình.

## 📝 Xác nhận
Sự thay đổi này chỉ tập trung vào UI/UX Responsive trên giao diện mobile của KTV, **không làm ảnh hưởng đến business logic, realtime hay bộ đếm giờ (timers)**.

Vui lòng gõ **"OK"** hoặc **"Duyệt"** để tôi tiến hành áp dụng bản sửa lỗi này!
