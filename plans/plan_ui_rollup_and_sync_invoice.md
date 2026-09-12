# K? Ho?ch C?p Nh?t UI Kanban (Roll-up) & Ð?ng B? Code Hóa Ðon

## 1. C?p Nh?t Màn Hình Kanban (Roll-up Ðon Tách)
**File:** `app/reception/dispatch/page.tsx`
- S?a nút **Chia s? l? trình** (QR Code): Ð?i `orderId` thành `order?.parentBookingId || contextMenu.orderId` d? khách quét QR luôn m? Ðon Cha.
- B?ng Chi Ti?t (Drawer): N?u `selectedSubOrder` có `originalOrder.parentBookingId`, thêm m?t Banner/Nút c?nh báo: *"Ðon này thu?c nhóm don g?c... [Xem Hóa Ðon Nhóm]"*. B?m vào s? m? InvoiceLangModal cho Parent Booking.

## 2. Ð?ng B? 7 L?i T? Web N?i B?
**File:** `app/api/finance/invoice/[id]/route.ts`
- Thêm `export const fetchCache = "force-no-store";`.
- B? c?t `discountAmount` kh?i query c?a Bookings.
- S?a query tìm Booking: Dùng `.or("id.eq.${id},accessToken.eq.${id}")`.

**File:** `app/invoice/[id]/page.tsx`
- Xóa `window.print()` trong `useEffect` d? t?t t? d?ng in.

**File:** `components/invoice/PrintableInvoice.tsx` & CSS
- S?a timezone: C?ng `"Z"` vào chu?i th?i gian khi render ngày gi?.
- Hi?n th? c?t "Th?i gian" (duration) thay vì ch? Giá ti?n.
- Ða ngôn ng? (i18n): D?ch phuong th?c thanh toán (`CASH_VND`, `CASH_USD`) và "Câu C?m On" (note1, note2) d?a vào bi?n `lang`.

