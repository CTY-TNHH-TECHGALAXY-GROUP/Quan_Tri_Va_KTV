# Kế hoạch Triển khai: Refactor KTV Dashboard & Khắc phục lỗi Data Integrity (Guest Logic V3)

Tài liệu này phân tích và đề xuất giải pháp kỹ thuật cho 2 yêu cầu:
1. Đưa cấu trúc "Guest Card" lên KTV Dashboard.
2. Khắc phục triệt để lỗi Data Integrity liên quan đến `service_name` và `duration` bị mất/sai.

---

## 1. Khắc Phục Lỗi Data Integrity (Nguyên nhân gốc rễ)

### 🔬 Root Cause Analysis (Phân tích nguyên nhân)
Sau khi AI khảo sát mã nguồn, phát hiện ra lý do tại sao `service_name` và `duration` thỉnh thoảng bị mất:
- Bảng `BookingItems` **chưa hề có** 2 cột `service_name` và `duration`. 
- KTV Dashboard (`handleGetBooking.ts`) đang lấy thông tin này bằng cách **tính toán on-the-fly (tức thời)**: Mỗi khi KTV mở App, API lại quét mã `serviceId`, chui vào bảng `Services` để lấy `nameVN` và `duration` lắp vào.
- **Tại sao bị lỗi?** Nếu Lễ tân đổi mã dịch vụ, sửa tên dịch vụ, hoặc xóa dịch vụ trong Database, toàn bộ đơn hàng (kể cả lịch sử cũ) sẽ bị "mù" tên dịch vụ, hiển thị chữ `Dịch vụ null` hoặc thời gian sai lệch.

### 🛠 Giải pháp (Data Snapshot - Tối ưu 0 Migration)
AI Giám sát đã phát hiện ra một giải pháp cực kỳ thông minh:
- **KHÔNG CẦN CHẠY MIGRATION**: Bảng `BookingItems` đã có sẵn cột `options` (kiểu `jsonb`). Mã nguồn KTV Dashboard hiện tại đã có logic ưu tiên lấy `options.displayName` và `options.duration` nếu có.
- Chúng ta chỉ cần sửa API lúc **Tạo Đơn (Insert)**:
   - Sửa hàm `createQuickBooking` (trong `BookingModificationService.ts`).
   - Sửa API thêm dịch vụ (`addAddonServices` trong `actions.ts`).
   - Khi tạo Item, lấy `nameVN` và `duration` từ bảng `Services` và **LƯU CỨNG (Snapshot)** vào trường `options` (`{ displayName: "Tên", duration: 60 }`) lúc insert.
- Phương pháp này an toàn tuyệt đối, không đụng chạm đến cấu trúc Database, mà vẫn khóa vĩnh viễn được dữ liệu lịch sử.

---

## 2. Refactor KTV Dashboard (Guest Card Structure)

### 🔬 Vấn đề hiện tại
Hiện tại, khi Lễ tân gộp chung 2 dịch vụ (ví dụ: Massage VIP + Gội đầu) và gán cho 1 KTV, màn hình KTV Dashboard chỉ hiển thị gộp tên dịch vụ:
`Massage VIP + Gội đầu` (dùng hàm `formatMultiServiceNames`).
KTV không biết rõ mình đang làm cho "Khách 1" hay "Khách 2" trong các Đơn có nhiều khách (Group Booking).

### 🛠 Giải pháp (Guest Card UI)
1. **API Enrich Guest Label**:
   - Sửa API `/api/ktv/booking/_handlers/handleGetBooking.ts`.
   - Bổ sung logic fetch bảng `BookingGuests` dựa trên `guest_id` của các `BookingItems`.
   - Gắn thuộc tính `guest_label` (VD: "Khách 1", "Khách 2") vào từng item trả về cho KTV.
2. **UI Refactor (`page.tsx`)**:
   - Thay vì chỉ hiển thị `Massage VIP + Gội đầu`, giao diện sẽ hiển thị thêm: 
     `👨 Khách 1: Massage VIP + Gội đầu`
   - Hiển thị rành mạch để KTV biết đang phục vụ Khách thứ mấy trong nhóm.

---

## 3. Các bước Thực thi (Dành cho Executor Teams)

Nếu User đồng ý với thiết kế này, các Executor AI sẽ làm theo thứ tự sau:

### Phase 1: Backend (Data Integrity) - Tối ưu 0 Migration
- [ ] Sửa `BookingModificationService.ts` (`createQuickBooking`): Nhồi `displayName` và `duration` vào cột `options`.
- [ ] Sửa `actions.ts` (`addAddonServices` / upsell): Nhồi `displayName` và `duration` vào cột `options`.
- [ ] (Tùy chọn) Viết 1 script nhỏ để update cột `options` cho các đơn hàng cũ trong DB.

### Phase 2: KTV Dashboard API
- [ ] Sửa `handleGetBooking.ts`:
  - Fetch thêm `BookingGuests` để lấy `guest_label`.
  - Gắn `guest_label` vào payload `BookingItems`.
  - Thay đổi logic lấy tên/thời lượng: Ưu tiên lấy từ bản ghi `BookingItems`.

### Phase 3: KTV Dashboard UI
- [ ] Sửa `app/ktv/dashboard/page.tsx`:
  - Lấy `item.guest_label` và hiển thị nổi bật trên thẻ Active Booking Card.
  - Cập nhật hàm `formatMultiServiceNames` để hỗ trợ hiển thị Guest Label.
