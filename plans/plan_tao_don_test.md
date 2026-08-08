# Kế hoạch: Đơn Test, Đồng bộ mã đơn & Lỗi Bonus KTV B

Dựa trên yêu cầu của bạn, đây là phân tích và kế hoạch triển khai cho 2 vấn đề lớn.

## 1. Đồng bộ mã đơn và tính năng "Tạo Đơn Test"
Hiện tại Tạo Đơn Nhanh sinh mã ngẫu nhiên (`S260724-W686`), còn Web Booking sinh mã tịnh tiến (`WB-001-260724`). Bạn muốn 2 bên dùng chung 1 chuỗi mã tịnh tiến, và có thêm cờ "Tạo Đơn Test".

**Giải pháp:**
1. **Sửa UI `AddOrderModal.tsx`**: Thêm Checkbox `[ ] Tạo đơn test`.
2. **Sửa logic `BookingModificationService.createQuickBooking`**:
   - Nhận thêm tham số `isTestOrder`.
   - NẾU `isTestOrder == true`: Sinh mã ngẫu nhiên có tiền tố TEST (VD: `TEST-W686-260724`).
   - NẾU `isTestOrder == false`: Truy vấn DB đếm số đơn trong ngày (tương tự Web Booking) để sinh mã tịnh tiến dùng chung tiền tố (VD: `WB-003-260724`).
3. **Cập nhật Báo cáo (`app/api/finance/reports/*`)**:
   - Thêm điều kiện `AND billCode NOT LIKE 'TEST-%'` vào các truy vấn DB của trang báo cáo để loại bỏ đơn Test khỏi báo cáo.

> [!NOTE]
> Bằng cách đồng bộ này, nếu lễ tân tạo nhanh đơn 1 sẽ là `WB-001`, sau đó khách đặt qua web nội bộ sẽ thành `WB-002`, và lễ tân tạo tiếp sẽ là `WB-003`.

## 2. Vấn đề "Điểm Bonus KTV B chỉ có 10đ"
Theo source code hiện tại, điểm Bonus mặc định (Ca 1/2) là **20đ**. Điểm này bị chia / giảm trong các trường hợp sau:
- Bị chia đều nếu có nhiều KTV cùng làm (VD: 2 KTV thì mỗi người 10đ).
- **Bị phạt chia đôi (còn 10đ) nếu tổng thời lượng làm dịch vụ thực tế của KTV đó dưới 60 phút**.

> [!IMPORTANT] Open Question - Cần bạn xác nhận về KTV B
> Tài khoản NH079 (KTV B) nhận được 10đ. Điều này có phải do:
> 1. KTV B chỉ làm 1 dịch vụ ngắn (vd: 30 hoặc 45 phút) nên bị hệ thống tự động phạt chia đôi theo luật `< 60 phút`?
> 2. KTV này bị chia tua với người khác?
> 3. Hay bạn đang muốn **KTV Loại B (180k/h) phải có một mức điểm Bonus riêng biệt** (không phải 20đ mặc định)?
> Vui lòng cho biết luật tính Bonus đúng đối với KTV B để tôi điều chỉnh code tính điểm!

## Các file sẽ thay đổi

### 1. Tạo đơn Test & Mã tuần tự
#### [MODIFY] `app/reception/dispatch/_components/AddOrderModal.tsx`
- Thêm state và Checkbox `isTestOrder`.
#### [MODIFY] `app/reception/dispatch/actions.ts`
- Cập nhật tham số truyền vào service.
#### [MODIFY] `lib/services/BookingModificationService.ts`
- Bổ sung logic `generateBookingId` đếm số lượng đơn trong ngày để sinh mã `WB-xxx-ddmmyyyy`.

### 2. Bộ lọc Báo cáo
#### [MODIFY] `app/api/finance/reports/route.ts` (và các endpoint report liên quan)
- Loại trừ `billCode LIKE 'TEST-%'`.

### 3. Bonus KTV B
#### [MODIFY] `lib/services/KtvCommissionService.ts`
- (Sẽ điều chỉnh sau khi bạn trả lời câu hỏi bên trên).

---

Vui lòng bấm **Proceed / Duyệt** hoặc trả lời câu hỏi của tôi về Bonus KTV B để tôi chốt kế hoạch và bắt đầu code!
