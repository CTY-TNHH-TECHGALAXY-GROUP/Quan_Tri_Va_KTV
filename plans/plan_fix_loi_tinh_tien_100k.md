# S?a l?i hi?n th? 100k thay vì 180k cho KTV Lo?i B (NHP0001 - 60p)

## Phân tích nguyên nhân g?c r? (Root Cause)
1. **D? li?u Backend (ÐÚNG)**: H? th?ng sync-daily-ledger (ch?t s? lúc 3h sáng) và các API tài chính c?a admin d?u dã tính dúng 180k cho ca NHP0001 (t?ng s? cái ngày 23/08 c?a NH027 là 445k, kh?p hoàn toàn).
2. **L?i hi?n th? trên app KTV lúc hoàn thành (SAI)**:
   - Khi KTV b?m "Giao phòng xong", UI App KTV (file KTVDashboard.logic.ts) s? tính toán nhanh m?t con s? d? hi?n th? popup thu?ng (+{commission}d).
   - L?i 1: Do hàm API.KTV.BOOKING (finish service) tr? v? thông tin Booking NHUNG L?I THI?U BookingItems, UI KTV dã update dè state ooking, làm m?t m?ng BookingItems.
   - L?i 2: ? màn hình Handover, vì BookingItems b? r?ng -> serviceItems.length === 0 -> App KTV nh?y vào lu?ng **fallback**.
   - L?i 3: Lu?ng fallback truy?n serviceId = ''. Khi serviceId r?ng, logic xét isPremiumService b? alse, khi?n KTV Lo?i B b? r?t xu?ng xài b?ng giá c?a Lo?i A (TYPE_A).
   - L?i 4: B?ng giá Lo?i A cho 60 phút là **100.000d**. Do dó KTV nhìn th?y 100k trên màn hình lúc dó.
3. **Bug ti?m ?n (ratePer60 fallback)**: Trong c? backend KtvCommissionService.ts và frontend, n?u thi?u key c?u hình atePer60 c?a Lo?i B, nó dang b? fallback nh?m v? atePer60 c?a Lo?i A (100k).

## Proposed Changes

### pp/ktv/dashboard/KTVDashboard.logic.ts
- **Fix l?i state dè m?t BookingItems**: ? do?n x? lý k?t qu? API, n?u payload backend tr? v? không ch?a BookingItems (do co ch? API orchestrator không join d? tang t?c), c?n ph?i g?p l?i BookingItems cu t? state hi?n t?i d? không b? m?t thông tin tính ti?n tua lúc handover.
- **Fix fallback config**: Hàm uildCommConfig c?n uu tiên default rate c?a TYPE_B (180k) tru?c khi l?t xu?ng rate c?a h? th?ng (100k).

### lib/services/KtvCommissionService.ts
- **Fix fallback config**: Trong getCommissionConfig, c?p nh?t th? t? fallback d? TYPE_B s? roi v? 180000 n?u DB chua có, KHÔNG l?y giá tr? 100000 c?a TYPE_A.

## User Review Required
- Admin luu ý: Báo cáo tài chính Admin (Báo cáo KTV) và S? cái (Wallet timeline) c?a ngày hôm qua hi?n t?i ÐÃ LUU ÐÚNG VÀ HI?N TH? ÐÚNG s? t?ng (445k). S? 100k ch? là con s? xu?t hi?n sai trên màn hình KTV lúc v?a làm xong ca.
- User có d?ng ý v?i nguyên nhân và gi?i pháp s?a 2 file trên không?
