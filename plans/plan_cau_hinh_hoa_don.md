# Kế hoạch: Cấu hình Mẫu hóa đơn (Invoice Settings)

**Trạng thái:** Đã duyệt.
**Vị trí triển khai:** `app/admin/settings/system`

## Thay đổi đề xuất

### 1. Database & API (Cấu hình hệ thống)

Sử dụng bảng `SystemConfigs` hiện có để lưu trữ cấu hình hóa đơn (áp dụng chung cho toàn hệ thống).
- **Key**: `invoice_config`
- **Value**: JSON `{ spaName, slogan, address, phone, hotline, note1, note2, logoUrl? }`

### 2. Thành phần Giao diện (UI Components)

#### [MODIFY] `app/admin/settings/system/page.tsx`
- Do trang này đã có sẵn cấu trúc các Card (ví dụ: Điểm thưởng), ta sẽ thêm một component mới là `<InvoiceSettingsCard />` vào layout. Hoặc tốt nhất là tạo một Tab mới (nếu trang đã chia tab) hoặc chỉ cần thêm Card ở dưới cùng. Theo code hiện tại, có các tab "TYPE_A, TYPE_B, TYPE_C" dùng chung cho nhân viên. Cấu hình Hóa đơn là chung hệ thống, nên ta sẽ tạo một Tab lớn ở cấp trên cùng (vd: Tab "Nhân sự", Tab "Cấu hình chung", Tab "Hóa đơn") hoặc đặt chung vào một khu vực. Tuy nhiên, dễ nhất là thêm thẻ Tab "Hóa đơn" bên cạnh các cấu hình hiện tại để tiện quản lý.

#### [NEW] `app/admin/settings/system/InvoiceSettingsCard.tsx`
- Gồm 2 phần chính:
  - **Form (Trái)**: Input nhập Tên Spa, Địa chỉ, Slogan, Điện thoại, Ghi chú 1, Ghi chú 2, và nút **Upload Logo** (Lưu URL ảnh logo).
  - **Preview (Phải)**: Sử dụng Component `PrintableInvoice` để live-preview.

#### [NEW] `components/invoice/PrintableInvoice.tsx`
- React Component chứa cấu trúc HTML/CSS của hóa đơn `preview-5.html`.
- Xóa `contenteditable`, thay bằng giá trị `props.config`.
- Xử lý render Logo (nếu có `logoUrl`) hoặc Tên Spa text (nếu không có logo).

### 3. Lưu trữ ảnh (Storage)
- Upload logo sẽ lưu vào bucket `public/invoices` hoặc dùng Supabase Storage (nếu đã config) và lấy public URL.

## Các bước thực hiện
1. Tạo component `PrintableInvoice.tsx`.
2. Tạo component `InvoiceSettingsCard.tsx`.
3. Tích hợp `InvoiceSettingsCard` vào `app/admin/settings/system/page.tsx`.
4. API tự động lưu vào `SystemConfigs` khi người dùng bấm Lưu.
