# KẾ HOẠCH TRIỂN KHAI MENU VIP (REVISED: 14/05)

## 1. MỤC TIÊU & PHẠM VI (SCOPE)
- **Deadline**: 22/5 (Soft launch test tại tiệm).
- **Mục tiêu**: Tích hợp luồng chọn KTV (AI Avatar, Profile) -> Chọn Combo VIP (Giá 60k/70k) -> Đặt lịch (Xử lý Slot rảnh/bận) -> Đổ về hệ thống hiện tại.
- **Rủi ro chính**: Database Staff có thể thiếu dữ liệu, AI Avatar mất nhiều thời gian, Tính toán Slot dễ dính lỗi trùng lịch. 

---

## 2. TIMELINE ĐIỀU CHỈNH CHỐNG RỦI RO

### Ngày 14/5 - 15/5 (KHÔNG ĐỢI CODE - VẬN HÀNH CHỐT TRƯỚC)
- [ ] **Pricing & Profit**: Chốt chính xác công thức giá 60k/70k (Cạo + Ráy, Cạo + Body...). Xác định chi phí NV so với giá bán để tránh lỗ. Chốt kịch bản quy trình (SOP) cho các gói này.
- [ ] **Mở rộng Combo**: Chốt xem có cho chọn 3 dịch vụ trở lên không (VD: Cạo + Gội + Face = 85k).
- [ ] **Audit Data Staff**: Kỹ thuật kiểm tra bảng `Staff` xem các field `height, weight, birthday, skills` đã có dữ liệu thật chưa. Nếu trống, Vận hành phải điền gấp.
- [ ] **Khởi động AI Avatar**: Thu thập ảnh gốc của "người thử đầu tiên" (KTV làm pilot) để gen AI ngay từ hôm nay.

### Ngày 15/5 - 18/5 (UI DESIGN & AVATAR)
- [ ] **UI Design (Bản VN)**: Chỉ thiết kế giao diện Tiếng Việt trước cho Mobile-first. Không design 5 ngôn ngữ vội để tiết kiệm thời gian.
- [ ] **AI Avatar Pipeline**: Gen xong ảnh cho nhóm KTV đầu tiên. Thống nhất tỷ lệ ảnh (VD 3:4).

### Ngày 16/5 - 20/5 (BACKEND & DATABASE)
- [ ] **Seed Database**: Bổ sung các Combo 60k/70k vào bảng `Services`, gán `category = 'VIP_COMBO'`.
- [ ] **API Availability (Lịch ca/tua)**:
   - Đọc bảng `TurnQueue` (tua hiện tại) + `KTVAttendance` (chấm công ca làm) + `Bookings` (đơn đặt trước).
   - Viết thuật toán nhả ra các slot Rảnh (Available Slots) của KTV.
   - Thêm "Buffer Time" để tránh xung đột walk-in vs VIP.
- [ ] **API Profile Staff**: Lấy data từ `Staff` + tính trung bình sao từ `ktvRatings` ở `BookingItems`.

### Ngày 18/5 - 22/5 (INTEGRATION, FIX BUGS & TRAINING)
- [ ] **Ráp luồng FE + BE**: Tích hợp giao diện chọn KTV -> Chọn Combo -> Checkout.
- [ ] **Test Cục Bộ (Test "1 NV")**: Đặt thử 1 KTV xem Lễ tân có báo màu/chuông không, Slot KTV đó có bị ẩn khỏi giờ tiếp theo không.
- [ ] **Localization (i18n)**: Khi luồng tiếng Việt ổn định, mới đổ file i18n 4 ngôn ngữ còn lại (EN, CN, JP, KR) vào.

### Ngày 22/5: SOFT LAUNCH TEST TẠI TIỆM
- Test trên môi trường thật với 1-2 KTV VIP và khách hàng thật/khách quen.

---

## 3. CHECKLIST TRƯỚC NGÀY 22/5 (MANDATORY)
1. [x] Công thức pricing có lợi nhuận.
2. [x] Database nhân viên complete (không missing field).
3. [x] API lịch ca/tua stable (Đã phân loại chi tiết NOT_YET, AVAILABLE, BUSY, OFF_DUTY).
4. [x] UI responsive trên mobile (Đã thay bằng Popover lịch sang trọng, đồng bộ ID giống menu thường).
5. [ ] 5 ngôn ngữ dịch chính xác (Phase cuối).
6. [x] AI Avatar load nhanh (Tối ưu WebP).
7. [ ] Test "1 NV" UX mượt mà, không lag.
