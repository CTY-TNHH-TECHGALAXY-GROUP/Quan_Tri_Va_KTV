# Kế hoạch Triển khai: Autocomplete Khách Hàng trong AddOrderModal

**Mục tiêu**: Giúp Lễ tân tìm kiếm và chọn lại thông tin khách hàng cũ dễ dàng, chính xác hơn thay vì phải gõ tay toàn bộ tên và số điện thoại.

## 1. Backend (actions.ts)
- Tạo một hàm Server Action tên là `searchCustomers(query: string)`.
- Query vào bảng `Customers`.
- Điều kiện tìm kiếm (`or`):
  - `fullName.ilike.%query%`
  - `phone.ilike.%query%`
- Sắp xếp ưu tiên hiển thị và lấy tối đa 10 kết quả (`limit(10)`).
- Dữ liệu trả về: `id`, `fullName`, `phone`, `email`.

## 2. Frontend (AddOrderModal.tsx)
- Bổ sung logic Debounce Custom bằng `useEffect` (chờ ~300ms sau khi ngừng gõ).
- Mở rộng state:
  - `suggestions`: Mảng lưu kết quả search.
  - `showSuggestions`: Cờ điều khiển ẩn/hiện popup dropdown.
  - `isSearching`: Loading spinner nhỏ trong ô input khi gọi API.
- Cập nhật UI ô "Tên khách hàng":
  - Dùng relative wrapper.
  - Hiển thị absolute dropdown chứa danh sách khách hàng.
- Logic Auto-fill:
  - Click vào khách -> `setCustomerName(fullName)`, `setContactValue(phone)`, `setContactType('phone')`, `setShowSuggestions(false)`.
- Click-outside: Đóng dropdown khi ấn ra ngoài.
