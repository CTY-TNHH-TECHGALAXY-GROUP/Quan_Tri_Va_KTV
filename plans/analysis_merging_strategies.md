# 🧠 BIÊN BẢN HỌP BÀN KIẾN TRÚC: CHUYỂN ĐỔI BOOKING GUESTS
**Chủ đề:** Làm thế nào để giữ nguyên thói quen "Gộp dịch vụ" của Lễ tân, nhưng bên dưới DB lại chuẩn hóa thành `BookingGuests` một cách tinh tế nhất?
**Thành phần tham gia:** 
- 🧑‍💻 **AI Kiến Trúc Sư (Researcher):** Người đề xuất giải pháp kỹ thuật dựa trên luồng hiện tại.
- 🥋 **AI Phản Biện (Sparring Partner):** Đóng vai trò soi lỗ hổng, edge cases (Gộp chung KTV, Gộp khách KTV, Co-working).

---

## 🛑 VÒNG 1: ĐỀ XUẤT TỪ AI KIẾN TRÚC SƯ
Dựa trên gợi ý của User: *"Cứ để quầy gộp đi, sau khi gán KTV và điều phối thì hệ thống tự hiểu mỗi cái gộp đó là 1 khách."*

**Đề xuất giải pháp (Under-the-hood Translation):**
1. **Frontend (Bảng Điều Phối):** TUYỆT ĐỐI KHÔNG SỬA UI. Vẫn cho Lễ tân giữ thói quen kéo thả, ấn nút "Gộp dịch vụ" (dùng cơ chế `mergedIntoId` ở memory Frontend).
2. **Backend (`actions.ts` - Lúc ấn Lưu):**
   - Viết một "Bộ Thông Dịch" (Interpreter) ngay trước khi lưu vào DB.
   - Nó sẽ quyét qua bảng điều phối: Cứ thấy 1 nhóm dịch vụ đang bị gộp chung -> Nó tự động **tạo ra 1 `BookingGuest` mới**.
   - Sau đó, nó móc ID của tất cả dịch vụ trong nhóm đó trỏ vào `guest_id` mới này.
   - Nhét toàn bộ KTV của nhóm đó vào làm nhân viên phục vụ cho `BookingGuest` này.
3. **KTV Dashboard:**
   - Thay vì query `BookingItems`, App KTV sẽ query `BookingGuests`. Nếu Guest đó có 3 dịch vụ, KTV sẽ nhìn thấy 1 cục "Combo 3 dịch vụ". Bấm "Bắt đầu" là bắt đầu cả cụm.

---

## 🥊 VÒNG 2: AI PHẢN BIỆN (SPARRING PARTNER) TẤN CÔNG
*Khoan đã! Ý tưởng nghe rất mượt, nhưng hãy bóc tách các trường hợp (Edge Cases) thực tế tại Spa. Kiến trúc này đang có 3 LỖ HỔNG CHẾT NGƯỜI:*

### 💥 Lỗ hổng 1: "Gộp khách KTV" (1 KTV chạy show 2 khách)
Giả sử có 2 khách lẻ (Guest 1 và Guest 2). Mỗi khách làm 1 dịch vụ.
Lễ tân gán KTV "Thu Hằng" cho Guest 1 (14:00 - 15:00), và gán cũng "Thu Hằng" cho Guest 2 (15:00 - 16:00).
- **Phản biện:** Nếu App KTV chỉ query theo `BookingGuests`, Thu Hằng sẽ thấy 2 cục Guest hiện ra. Thu Hằng có được bấm "Bắt đầu" Guest 2 khi Guest 1 chưa xong không? Hiện tại hệ thống đếm timer dựa trên KTV hay dựa trên Guest? Nếu dựa trên Guest, KTV có thể hack time bằng cách chạy 2 timer cùng lúc!

### 💥 Lỗ hổng 2: Khách làm Combo nhưng MỖI DỊCH VỤ 1 KTV KHÁC NHAU!
Đây là ca kinh điển: Khách 1 mua "Ráy Tai" + "Chăm Sóc Da". 
- Lễ tân "Gộp dịch vụ" thành 1 cục (Guest 1).
- NHƯNG, Lễ tân kéo **KTV A** làm Ráy Tai, kéo **KTV B** làm Chăm Sóc Da. 
- **Phản biện:** Nếu bạn dồn hết KTV vào cái hộp `BookingGuests` chung, làm sao hệ thống biết KTV A làm dịch vụ nào, KTV B làm dịch vụ nào? Lúc tính tiền tua, kế toán sẽ tính hoa hồng Ráy Tai cho cả A và B à? CHẾT CHẮC!

### 💥 Lỗ hổng 3: Co-working (2 KTV làm chung 1 dịch vụ)
Khách 1 mua "Massage 4 tay" (1 dịch vụ duy nhất). KTV A và KTV B cùng vào phòng.
- **Phản biện:** Khi KTV A bấm "Bắt đầu", KTV B có bị tính là "Bắt đầu" luôn không? Nếu A bấm "Dọn phòng" mà B vẫn đang dọn, thì trạng thái phòng tính sao?

---

## 🛠️ VÒNG 3: GIẢI PHÁP CHỐT HẠ (KẾT HỢP TINH HOA)
Từ đòn phản biện trên, chúng ta chốt lại **Kiến trúc Lai (Hybrid Architecture)** hoàn hảo nhất, vừa đáp ứng ý tưởng của User, vừa né được mọi bug:

### 1. Phân định rõ 2 khái niệm:
- **`BookingGuest` = Thực thể Khách Hàng:** Quản lý quy trình đi lại của 1 con người (Check-in, Lên phòng, Xuống bill).
- **`BookingItem` = Thực thể Công Việc (Task):** Quản lý thù lao và KTV.

### 2. Luồng Xử Lý Khi Lễ Tân Ấn "Lưu":
- Cứ mỗi cụm dịch vụ được Gộp -> Sinh ra 1 `BookingGuest` (Guest).
- **TRỌNG TÂM:** Vẫn lưu KTV (`technicianCodes`) vào từng `BookingItem` riêng lẻ, **KHÔNG** dồn lên Guest. (Giải quyết triệt để Lỗ hổng 2 & 3 - Hoa hồng ai nấy nhận, KTV nào làm dịch vụ nào thì lưu đúng dịch vụ đó).
- Xóa bỏ `mergedIntoId`, thay bằng `guest_id` cho tất cả các Items.

### 3. Bí thuật ở KTV Dashboard (Giải quyết lỗi lùi trạng thái cũ):
- Khi KTV mở App, hệ thống sẽ query các `BookingItems` của KTV đó.
- Nếu KTV thấy Item A thuộc `Guest 1`, App sẽ **tự động gộp hiển thị (UI Merge)** tất cả các Items CỦA RIÊNG KTV ĐÓ thuộc `Guest 1` thành một nút bấm duy nhất.
- Khi KTV bấm **Bắt đầu**, hệ thống đẩy trạng thái của **Guest 1** lên `IN_PROGRESS`.
- Các Items bên dưới KHÔNG CẦN CẬP NHẬT TRẠNG THÁI NỮA. Trạng thái của Item tự động = Trạng thái của Guest! 
- Điều này có nghĩa: Không còn sự kiện "Thằng Cha kéo Thằng Con", "Thằng Con lùi Thằng Cha" nữa. Tất cả đều nhìn vào 1 cái biển số duy nhất là **Guest Status**.
