# Kế hoạch Cải tiến Hiển thị Ví KTV (Thay Gross Income bằng Net Balance)

## 1. Phân tích vấn đề hiện tại
- **Giao diện hiện tại:** Đang hiển thị trường **"Tổng thu nhập" (Gross Income)**. Đây là tổng số tiền KTV đã cày được kể từ đầu tháng/ngày chốt sổ, nó **chỉ tăng chứ không bao giờ giảm** dù có rút tiền.
- **Sự bối rối của người dùng:** Khi KTV cày được 1tr7, rút đi 700k, thì Khả dụng về 0đ (do bị giam cọc 1tr). NHƯNG con số "Tổng thu nhập" vẫn chình ình 1tr7. KTV nhìn vào sẽ thắc mắc: *"Ủa mình rút 700k rồi sao trong ví vẫn báo 1tr7?"*.
- **Ý tưởng của bạn (Hoàn toàn chính xác):** KTV chỉ quan tâm **"Hiện tại trong ví tôi thực tế đang có tổng bao nhiêu tiền?"** (Số dư hiện tại). Nếu rút hết phần khả dụng, thì số dư hiện tại phải tụt xuống đúng bằng con số 1 Triệu tiền cọc. 

## 2. Giải pháp thực hiện (Chỉ cần đổi UI)
Do API backend của chúng ta đã tính sẵn biến `net_balance` (Số dư thực tế sau khi trừ tiền đã rút), nên ta chỉ cần sửa giao diện (Front-end) ở file `app/ktv/wallet/page.tsx`.

- **Thay đổi 1:** Đổi chữ to nhất thành `Số dư khả dụng` (Lược bỏ dòng chữ "(Đã trừ cọc)" cho gọn).
- **Thay đổi 2:** Đổi chữ `Tổng thu nhập` thành `Số dư hiện tại`.
- **Thay đổi 3:** Đổi biến `walletBalance.gross_income` thành `walletBalance.net_balance`.

**Mô phỏng luồng tiền sau khi sửa:**
1. KTV cày được 1.700.000đ.
   -> **Số dư hiện tại:** 1.700.000đ
   -> **Số dư khả dụng:** 700.000đ (Do giam 1tr cọc).
2. KTV làm lệnh rút 700.000đ và được Duyệt.
   -> **Số dư hiện tại:** Tụt xuống còn **1.000.000đ** (đúng bằng tiền cọc như bạn muốn).
   -> **Số dư khả dụng:** 0đ.
3. KTV làm thêm 1 tua được 100.000đ.
   -> **Số dư hiện tại:** Tăng lên **1.100.000đ**.
   -> **Số dư khả dụng:** 100.000đ.

## 3. Các bước triển khai
- Sửa file `app/ktv/wallet/page.tsx` dòng 88-89.

---
**Bạn xem qua luồng logic này đã đúng ý bạn chưa? Nếu OK thì gõ "Duyệt" để tôi sửa code cái một nhé!**
