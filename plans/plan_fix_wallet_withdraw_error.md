# Kế hoạch khắc phục lỗi rút tiền KTV (Lỗi lấy thông tin số dư)

## 📌 Nguyên nhân gốc rễ (Root Cause)
1. KTV khi thực hiện rút tiền trên app di động sẽ gọi API `/api/ktv/wallet/withdraw` (phương thức `POST`).
2. API này gọi hàm RPC PostgreSQL `get_ktv_wallet_balance` trong Database để lấy số dư ví khả dụng hiện tại của KTV.
3. Trong database, hàm `get_ktv_wallet_balance` (cùng với hàm `get_ktv_wallet_timeline`) thực hiện phép `LEFT JOIN` với bảng `Services` (viết tắt là `s`) và cố gắng truy vấn trường `s.name`.
4. Tuy nhiên, trong cấu trúc database hiện tại, bảng `Services` không có cột `name` mà sử dụng các cột dịch ngôn ngữ cụ thể như `nameVN`, `nameEN`, `nameCN`, `nameJP`, `nameKR`. Do đó, câu lệnh SQL bị lỗi: `column s.name does not exist` (Mã lỗi PostgreSQL `42703`).
5. Ở local, file SQL migration `migrations/20260603170000_fix_wallet_commission_calculation.sql` đã được sửa thành `s."nameVN"`. Tuy nhiên, các hàm này chưa được deploy/apply lại lên Database Supabase thực tế.
6. **[MỚI PHÁT HIỆN]**:
   - Trong cả hai hàm, câu truy vấn có sử dụng `i.is_utility` từ bảng `BookingItems` (alias `i`), nhưng cột này thực tế thuộc bảng `Services` (alias `s`), gây lỗi `column i.is_utility does not exist`.
   - Trong hàm `get_ktv_wallet_timeline`, do hàm trả về bảng (TABLE) chứa cột `id`, khi thực hiện câu lệnh `SELECT id, ...` từ các bảng con như `WalletAdjustments`, `KTVWithdrawals` mà không có alias cụ thể sẽ gây lỗi nhập nhằng biến: `column reference "id" is ambiguous` (Mã lỗi `42702`).

---

## 🛠️ Giải pháp đề xuất (Proposed Changes)

Chúng ta sẽ deploy bản sửa lỗi SQL lên database Supabase đang chạy:

### 1. Cập nhật file SQL: [20260603170000_fix_wallet_commission_calculation.sql](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/migrations/20260603170000_fix_wallet_commission_calculation.sql)
- Đổi `i.is_utility` thành `s.is_utility` ở cả 2 hàm.
- Sửa hàm `get_ktv_wallet_timeline`: Đổi các cột `id` trong các câu `SELECT` thành alias cụ thể không trùng với cột trả về của hàm (ví dụ: `wa.id as adj_id`, `kw.id as w_id`, `b.id as item_id`), và chỉ định alias bảng đầy đủ để tránh lỗi ambiguous.

### 2. Thực thi file [run_migration.js](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/run_migration.js) để deploy:
- Chạy lệnh `node run_migration.js` để thực thi cập nhật các hàm trên Database Supabase.

---

## 🧪 Kế hoạch kiểm thử (Verification Plan)

### 1. Viết Script kiểm tra RPC:
- Chạy script `scratch_query.js` để gọi thử cả 2 RPC `get_ktv_wallet_balance` và `get_ktv_wallet_timeline`.
- Xác nhận dữ liệu trả về chính xác mà không gặp bất kỳ lỗi PostgreSQL nào.

### 2. Kiểm tra API Route:
- Gọi API `/api/ktv/wallet/withdraw` bằng script test với tài khoản KTV `NH001` và kiểm tra phản hồi.

