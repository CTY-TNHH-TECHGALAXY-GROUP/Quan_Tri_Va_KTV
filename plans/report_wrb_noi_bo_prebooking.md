# Báo cáo thay đổi: Cập nhật cơ chế nhận Khách Hẹn (wrb-noi-bo-dev)

**Project:** `wrb-noi-bo-dev` (Web Nội Bộ - Client)
**File đã sửa:** `src/app/[lang]/new-user/[menuType]/menu/page.tsx`

## 1. Mục đích thay đổi
Do tính năng "Khách liên hệ trước" (Pre-bookings) đã được chuyển về trang Giám sát Điều phối (`Quan_Tri_Va_KTV`), Web Nội Bộ không còn quản lý danh sách này nữa. Thay vào đó, Web Nội Bộ đóng vai trò **nhận** thông tin khách hàng được truyền sang từ Web Quản trị để tự động điền (auto-fill) ở bước thanh toán (Checkout).

## 2. Chi tiết logic đã thêm
Trong Component `MenuPage`, một hook `useEffect` đã được bổ sung nhằm mục đích:
1. **Bắt thông tin từ URL:** Ngay khi trang Menu tải xong ở phía client, hệ thống sẽ đọc query params (`?preBookingId=...&name=...&phone=...&guests=...&notes=...`).
2. **Lưu trữ cục bộ:** Nếu phát hiện có tham số `preBookingId`, hệ thống tự động lưu toàn bộ dữ liệu này vào `localStorage` với key `contactedFirstInfo`. 
3. **Kế thừa luồng cũ:** Ở trang Checkout (`checkout/page.tsx`), logic hiện có vẫn sẽ đọc key `contactedFirstInfo` này để auto-fill form như bình thường. Không cần sửa gì thêm ở Checkout.
4. **Clean up URL:** Sử dụng `window.history.replaceState` để xóa đi đoạn query params dài ngoằng, trả lại URL sạch (ví dụ: `/en/new-user/standard/menu`) để không làm ảnh hưởng UX của khách.

## 3. Mã nguồn đã thay đổi (Diff)

```tsx
// Thêm import useEffect
import React, { useEffect } from 'react';

export default function MenuPage() {
    const params = useParams();
    const router = useRouter();

    // [THÊM MỚI] Catch Auto-fill từ Web Quản Trị Dispatch Board
    useEffect(() => {
        if (typeof window !== 'undefined' && window.location.search) {
            const urlParams = new URLSearchParams(window.location.search);
            const preBookingId = urlParams.get('preBookingId');
            
            if (preBookingId) {
                localStorage.setItem('contactedFirstInfo', JSON.stringify({
                    preBookingId,
                    customerName: urlParams.get('name') || '',
                    customerPhone: urlParams.get('phone') || '',
                    guestCount: urlParams.get('guests') || 1,
                    notes: urlParams.get('notes') || ''
                }));
                // Xoá param trên thanh địa chỉ cho sạch
                window.history.replaceState(null, '', window.location.pathname);
            }
        }
    }, []);
    
    // ... code giữ nguyên bên dưới ...
}
```

## 4. Gợi ý thông điệp Commit (Dành cho nhánh Test)

```text
feat: add URL param catcher for PreBookings from Dispatch

- Bổ sung useEffect trong menu/page.tsx để bắt query params (preBookingId, name, phone, etc.)
- Lưu thông tin vào localStorage('contactedFirstInfo') để auto-fill khi checkout
- Xóa query params sau khi lưu để giữ URL sạch
- (Phục vụ luồng chuyển giao Khách hẹn từ Quan_Tri_Va_KTV)
```
