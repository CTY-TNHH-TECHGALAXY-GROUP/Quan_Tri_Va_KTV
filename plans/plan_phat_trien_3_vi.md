# 📋 Kế Hoạch Cập Nhật "Hệ Sinh Thái 3 Ví KTV"

Chào bạn, tuyệt vời! Việc tiệm chốt có tới 3 loại ví cho thấy hệ thống lương thưởng rất đa dạng. Để tối ưu trải nghiệm và khả năng mở rộng (scale), tôi sẽ thiết kế lại kiến trúc **"Custom Tabs"** thay vì chỉ 1 nút Toggle cứng.

Dưới đây là kế hoạch đã được bổ sung đầy đủ theo yêu cầu chốt của bạn:

## 1. 🔍 Kiến trúc Giao diện (Custom UI Tabs)
- Sử dụng **Thanh Tab Menu (Trượt ngang)** ở trên cùng. Tích hợp tất cả vào 1 trang duy nhất để chuyển cảnh mượt mà:
  - 💰 **Ví Tua** (Mặc định)
  - ⭐ **Ví Bonus**
  - 🎁 **Ví Tích Luỹ** (Tạm thời là bộ khung chờ phát triển tiếp)

## 2. ⚙️ Quy tắc Logic Ví Bonus (Chốt theo ý Tiệm)

- **Giao diện KTV Hub:** Giao diện bên ngoài khi KTV nhận đánh giá vẫn hiển thị "Đánh giá xuất sắc / KTV được cộng điểm" như bình thường, không thay đổi.
- **Trải nghiệm trong Ví Bonus:**
  - Không bắt KTV phải tự nhân nhẩm điểm. Hệ thống tự động nhân: `Điểm x 1,000 = Số tiền hiển thị`.
  - Hiển thị to và nổi bật: **100,000đ**, bên dưới chú thích nhỏ *"Tương đương 100 điểm thưởng"*.
- **Điều kiện hiển thị:** KTV phải được Admin cấu hình bật cờ (tick true) `enable_bonus_wallet` trong bảng `Staff` thì tab Ví Bonus mới xuất hiện.
- **Quy đổi / Rút tiền:** Tương tự như ví tua, KTV nhập số tiền muốn rút (ví dụ 50,000đ). Hệ thống tự quy ra điểm (50đ) và gửi lệnh cho kế toán xử lý.

## 3. 🛠️ Quy trình Triển khai Code (Thực Thi)

### Bước 1: API Layer (Backend)
- `[NEW] app/api/ktv/wallet/bonus/balance/route.ts`: Tính tổng điểm (`SUM(points)` từ `KTVBonusLedger`). Trả về số lượng điểm tổng.
- `[NEW] app/api/ktv/wallet/bonus/timeline/route.ts`: Lấy lịch sử biến động điểm.

### Bước 2: Business Logic (`KTVWallet.logic.ts`)
- Mở rộng state: `activeTab: 'TUA' | 'BONUS' | 'TICH_LUY'`.
- Kiểm tra quyền: Fetch cấu hình `feature_flags` từ `Staff` để xác định quyền bật `Ví Bonus`.
- Hàm `handleRedeemBonus()` chuyên xử lý nhân tỷ giá x1000, cảnh báo, và gọi API gửi yêu cầu rút điểm.

### Bước 3: Giao diện (`page.tsx`)
- Tạo cụm **WalletTabs Component**: Chứa các nút tab có hiệu ứng chuyển cảnh mượt mà (Framer Motion).
- Tạo **BonusWalletView Component**: Giao diện màu Vàng Đồng/Cam, hiển thị rõ ràng số Tiền VNĐ tương đương với điểm tích luỹ.
