# Phân tích Ki?n trúc: X? lý Link QR cho nhóm khách hàng

## Bài toán
Khi t?o don t? Web (Group Booking), database sinh ra 1 Mã Ðon (Booking ID) duy nh?t.
T?i b?ng Kanban, n?u L? tân b?m l?y Link QR cho Khách A, Khách B tru?c khi di?u ph?i/luu nháp, h? th?ng ch? có 1 Mã Ðon cha, d?n d?n vi?c trang Customer App s? hi?n th? toàn b? d?ch v? c?a c? nhóm thay vì c?a riêng t?ng ngu?i.

## Các hu?ng gi?i quy?t

### Hu?ng 1: Thay d?i quy trình L? tân (Không s?a Customer App)
- L? tân ph?i m? modal Ði?u Ph?i, kéo th? d?ch v?, b?m "Luu Nháp".
- Backend g?i hàm split_booking_into_sub_bookings d? tách v?t lý 1 don cha thành nhi?u don con (ID-A, ID-B).
- **Nhu?c di?m Chí m?ng:** 
  - Gây phân m?nh d? li?u (Data Fragmentation). Vi?c tách don quá s?m làm m?t tính nguyên v?n c?a 1 Group Booking.
  - S? r?t ph?c t?p khi khách nhóm mu?n g?p chung thanh toán ho?c dùng chung 1 voucher.
  - L? tân m?t di s? linh ho?t kéo th? d?ch v? qua l?i gi?a các khách sau khi dã tách don v?t lý.

### Hu?ng 2: Thay d?i Customer App (Best Practice)
- D? li?u ? DB gi? nguyên 1 Mã Ðon cha.
- Khi t?o Link QR trên Kanban, truy?n thêm tham s? ?guestId=Khach_A.
- Customer App d?c guestId t? thanh URL, t? d?ng filter (l?c) và ch? render ra nh?ng d?ch v?/KTV thu?c v? Khách A.
- **Uu di?m:**
  - Single Source of Truth: Ðon trên DB là 1 c?c nguyên v?n.
  - Tr?i nghi?m L? tân mu?t mà (ch? c?n b?m là có QR, không ép thêm thao tác th?a).
  - Tr?i nghi?m Khách hàng c?c t?t (m? link là xem du?c dúng thông tin c?a mình).

## Quy?t d?nh c?a AI Sparring Partner
=> **Ch?n Hu?ng 2**. Ðây là hu?ng gi?i quy?t dúng d?n nh?t v? m?t ki?n trúc ph?n m?m (tách b?ch gi?a Data Storage và View).

