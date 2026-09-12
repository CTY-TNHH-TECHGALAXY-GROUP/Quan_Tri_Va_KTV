# Kế Hoạch Sửa Lỗi Giao Diện Tạo Đơn Nhanh

## 🔍 Nguyên Nhân Gốc Rễ (Root Cause)
Khi mở modal "Tạo Đơn Nhanh" trên các màn hình có chiều cao hạn chế (ví dụ màn hình laptop tỷ lệ 16:9), các trường thông tin phía trên (Tên, Liên hệ, Ngôn ngữ) chiếm phần lớn chiều cao cố định. Do thẻ `<form>` bao ngoài đang được set `overflow-hidden` và khung chọn dịch vụ (Service Selection Board) đang được set `flex-1 min-h-0`, dẫn đến việc khung dịch vụ bị "ép" (shrink) xuống chiều cao `0px` và bị che khuất hoàn toàn.

## 🛠 Giải Pháp Kỹ Thuật (Solution)

Sửa đổi cấu trúc flexbox và overflow trong file `AddOrderModal.tsx`:

1. **Bố cục lại Form (Tách Body và Footer):**
   - **Form Body (Phần nội dung):** Thiết lập `overflow-y-auto` để cho phép người dùng cuộn xem nội dung nếu màn hình quá thấp.
   - **Form Footer (Phần nút bấm):** Tách phần "Checkbox Tạo đơn TEST" và "Nút TẠO ĐƠN NGAY" ra một vùng footer cố định (`shrink-0`) nằm ở dưới cùng của Modal. Đảm bảo nút luôn hiển thị mà không cần cuộn.
2. **Khóa chiều cao tối thiểu (Min-height Lock):**
   - Thay đổi `min-h-0` của khung "Chọn dịch vụ" thành `min-h-[350px]`. Nếu màn hình quá nhỏ, vùng này vẫn giữ được 350px và đẩy nội dung để người dùng có thể cuộn, không bao giờ bị bóp méo thành `0px` nữa.
3. **Responsive Spacing (Tinh chỉnh khoảng cách):**
   - Giảm nhẹ padding trên mobile/laptop nhỏ (từ `p-8` xuống `p-6 sm:p-8`) để tối ưu diện tích hiển thị.

## 📁 File Bị Ảnh Hưởng
- `app/reception/dispatch/_components/AddOrderModal.tsx`

---
*Đã được duyệt ngày 23/08/2026*
