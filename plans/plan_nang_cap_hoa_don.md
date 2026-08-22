# Nâng Cấp Tính Năng Hóa Đơn (Đa Ngôn Ngữ, Cấu Hình & Giao Diện)

Kế hoạch này giải quyết 4 yêu cầu mới của bạn về việc hoàn thiện chức năng in hóa đơn.

## Các tính năng chính sẽ thực hiện:

### 1. Chuẩn hóa Phương thức thanh toán
- Map các giá trị raw từ Database thành tên chuẩn để in lên hóa đơn.
- `CASH` ➔ **Tiền Mặt**
- `USD` ➔ **USD**
- `CARD` ➔ **CARD**
- `TRANSFER` ➔ **TRANSFER**

### 2. Tích hợp Popup Chọn Ngôn Ngữ In
- Ở màn hình Lễ Tân (Sổ tua), khi click phải chọn **Hiện Hóa Đơn**, thay vì mở tab mới ngay lập tức, hệ thống sẽ hiện ra một Popup (Modal).
- Popup sẽ có 5 nút chọn ngôn ngữ: Tiếng Việt, Tiếng Anh (English), Tiếng Trung (中文), Tiếng Nhật (日本語), Tiếng Hàn (한국어).
- Khi chọn xong, hệ thống mới mở tab in hóa đơn và truyền ngôn ngữ đã chọn sang.

### 3. Hóa đơn Đa Ngôn Ngữ (5 Ngôn ngữ)
- **Dịch toàn bộ giao diện:** Dịch các tiêu đề (HÓA ĐƠN, Thông tin Spa, Mã hóa đơn, Thành tiền, v.v...) sang 5 ngôn ngữ.
- **Tên dịch vụ đa ngôn ngữ:** Nâng cấp API `route.ts` để lấy thêm `nameEN`, `nameCN`, `nameJP`, `nameKR` từ bảng `Services`. Hóa đơn sẽ ưu tiên hiển thị tên dịch vụ theo ngôn ngữ đã chọn, nếu không có sẽ tự động lùi về tên Tiếng Việt.

### 4. Bổ sung cấu hình Email và cập nhật SĐT
- Thêm trường **Email** vào cấu hình Hóa Đơn trong cài đặt hệ thống (mặc định: `cskhoria@techgalaxygroup.com`).
- Cập nhật số điện thoại mặc định thành `0964090277`.
- Hóa đơn in ra sẽ hiển thị thêm dòng Email bên dưới số điện thoại trong phần "Thông tin Spa".

---

## Chi tiết Thay đổi Kỹ thuật

### Component Hóa đơn (`PrintableInvoice.tsx`)
- [MODIFY] Thêm prop `lang` (mặc định 'vi').
- [MODIFY] Thêm từ điển (dictionary) chứa bản dịch cho 5 ngôn ngữ.
- [MODIFY] Thêm trường `email` vào `InvoiceConfig`.
- [MODIFY] Áp dụng logic dịch thuật và hiển thị Phương thức thanh toán chuẩn.

### API Lấy dữ liệu hóa đơn (`app/api/finance/invoice/[id]/route.ts`)
- [MODIFY] Sửa câu query bảng `Services` lấy thêm `nameEN`, `nameCN`, `nameJP`, `nameKR`.
- [MODIFY] Trả về đầy đủ các tên này trong `enrichedItems` để Frontend tùy chọn hiển thị.

### Cấu hình Hệ thống (`InvoiceSettingsCard.tsx`)
- [MODIFY] Thêm ô nhập Email.
- [MODIFY] Đổi giá trị mặc định của Phone.

### Màn hình Lễ Tân (`dispatch/page.tsx`)
- [MODIFY] Thêm state `invoiceLangModal`.
- [MODIFY] Thay đổi logic click "Hiện Hóa Đơn".
- [MODIFY] Vẽ thêm UI Popup chọn ngôn ngữ ở cuối file.

### Trang In Hóa Đơn (`app/invoice/[id]/page.tsx`)
- [MODIFY] Đọc parameter `lang` từ URL (ví dụ: `?lang=en`) và truyền vào `PrintableInvoice`.

---

> [!IMPORTANT]
> **Câu hỏi cần bạn xác nhận:**
> 1. Hiện tại ở màn hình Cấu hình hóa đơn (Settings) cũng có nút **"IN HÓA ĐƠN"**. Khi bấm nút này thì bạn muốn hệ thống hiện bảng chọn ngôn ngữ, hay cứ in mặc định tiếng Việt luôn (vì đây là màn hình test cấu hình)?
> 2. Kế hoạch này sẽ mất một chút thời gian để code phần giao diện 5 ngôn ngữ. Bạn có đồng ý triển khai theo luồng này không?
