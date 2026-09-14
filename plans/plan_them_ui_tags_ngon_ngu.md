# Kế hoạch thêm UI quản lý Tags Đa Ngôn Ngữ cho Dịch vụ

Vấn đề: Ở form chỉnh sửa Dịch vụ (`admin/service-menu/EditServiceDrawer.tsx`), hiện tại mới chỉ có UI cho Combo Tags (chọn bằng nút bấm) mà chưa có chỗ để Lễ tân/Admin gõ nội dung cho 2 Tag đa ngôn ngữ (vd: Mang thai, Dị ứng...).

## Giải pháp triển khai
1. **Phân tách Tags:** Trong mảng `tags` của DB, đang lưu trộn lẫn giữa chuỗi (Combo Tags: "body") và object (Tags ngôn ngữ: `{ vn: "Mang thai", en: "Pregnant"...}`). Ta sẽ tách 2 loại này ra khi load dữ liệu.
2. **Thêm UI nhập liệu:** 
   - Thêm một section mới dưới phần Tên Đa Ngôn Ngữ tên là "Tag Đặc Biệt (Tối đa 2 Tag)".
   - Cung cấp 2 ô nhập liệu cho mỗi tag, với 5 input cho mỗi ngôn ngữ (VN, EN, CN, JP, KR).
3. **Cập nhật Logic lưu dữ liệu:**
   - Khi ấn lưu, lọc bỏ các tag đa ngôn ngữ nếu để trống hoàn toàn.
   - Gộp chung (merge) lại với mảng Combo Tags (các chữ string như "body") trước khi đẩy lên Supabase.

## Lịch sử
- Đã được user phê duyệt lúc 22:04, ngày 20/04/2026.
