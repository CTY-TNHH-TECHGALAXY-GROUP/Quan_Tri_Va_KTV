# Phân Tích Ki?n Trúc: Gom D? Li?u Ðon Con (Roll-up Billing)

## V?n Ð? Hi?n T?i
Khi m?t don hàng cha (VD: 4 khách) du?c th?c hi?n thao tác **Tách Ðon**, toàn b? d?ch v? (`BookingItems`) b? phân b? d?i di sang các don con (A, B, C, D) theo co ch? **Move** d? d?m b?o KTV nh?n vi?c chính xác và không b? nhân dôi doanh thu. 
H? qu?: Ðon cha lúc này tr?ng r?ng (Ti?n = 0). L? tân và Khách hàng không th? in Bill ho?c xem Hoá don t?ng d?i di?n cho c? nhóm.

## Hu?ng Gi?i Quy?t Ð? Xu?t (Best Practice)
Thay vì sao chép (copy) d?ch v? gây rác DB và l?i tính toán, h? th?ng s? s? d?ng thu?t toán **On-the-fly Aggregation (Gom d? li?u th?i gian th?c)** t?i t?ng API ho?c Frontend Logic.

### Thu?t toán Logic
1. **Trigger:** Khi Client (App Khách ho?c L? Tân) yêu c?u l?y thông tin c?a Ðon Cha (có `status = 'SPLIT'`).
2. **Query:** 
   - L?y thông tin metadata c?a Ðon Cha (th?i gian, thông tin ngu?i d?t).
   - Truy v?n t?t c? Ðon Con d?a vào `parent_booking_id = parent_id`.
   - L?y toàn b? `BookingItems` và `BookingGuests` c?a các Ðon Con dó.
3. **Merge (Gom nhóm):**
   - C?ng d?n toàn b? ti?n (`totalAmount`) c?a các Ðon Con thành T?ng ti?n Ðon Cha m?i nh?t.
   - Tr?i ph?ng (flatten) t?t c? danh sách D?ch V? c?a các Ðon Con vào m?ng D?ch V? c?a Ðon Cha.
4. **Response:** Tr? v? m?t Object Ðon Cha "?o" d?y d? d?ch v? và t?ng ti?n y nhu lúc chua tách (bao g?m c? các d?ch v? Add-on m?i thêm vào don con sau khi tách).

## L?i Ích
- **Single Source of Truth:** D? li?u du?i Database (`BookingItems`) luôn là duy nh?t.
- **Linh ho?t:** B?t k? thay d?i (Thêm/B?t d?ch v?, Áp mã gi?m giá) ? Ðon Con A d?u s? l?p t?c ph?n ánh chính xác lên Hoá Ðon T?ng c?a Ðon Cha.
- **An toàn KTV:** Không làm ?nh hu?ng d?n lu?ng chia tua, tính hoa h?ng c?a KTV (vì KTV ch? làm vi?c v?i Ðon Con).

## Các Noi C?n C?p Nh?t
1. **L? Tân (Admin Portal):** Nút in hoá don (Print Bill) / Xem chi ti?t don ? màn L?ch S? ho?c Dispatch c?n g?i hàm Aggregate này.
2. **Khách Hàng (Customer App):** API tr? v? d? li?u cho Web Khách Hàng (`?guestId=...`) c?n h? tr? tr? v? Bill t?ng n?u URL truy?n ID Ðon Cha.
