# Chuẩn hóa API Validation với Zod (Bước 1)

Kế hoạch này nhằm mục đích thiết lập tiêu chuẩn kiểm tra dữ liệu đầu vào (Validation) cho dự án bằng thư viện Zod, giúp tăng cường bảo mật, bắt lỗi chính xác và làm sạch code logic. Chúng ta sẽ lấy API **Điều chỉnh số dư ví (Finance Adjustment)** làm mẫu đầu tiên.

## Proposed Changes

---

### Cài đặt thư viện
Sử dụng lệnh để cài thư viện:
- `npm install zod`

---

### Thêm Schema Định Nghĩa Đầu Vào
Tạo thư mục/file mới để lưu trữ quy tắc kiểm tra dữ liệu, tách biệt khỏi logic của API.

#### [NEW] `lib/schemas/adjustment.schema.ts`
Tạo Zod Schema `AdjustmentRequestSchema` để kiểm tra các field:
- `staff_id`: Chuỗi, không được để trống.
- `amount`: Số, khác 0.
- `type`: Chỉ cho phép một trong 3 giá trị `'GIFT', 'PENALTY', 'ADJUST'`.
- `wallet_type`: Chuỗi, không được để trống.
- `reason`: Chuỗi, không được để trống.

---

### Refactor API Controller
Cập nhật lại file route để sử dụng Zod schema vừa tạo, bỏ đi các dòng if/else check tay cồng kềnh.

#### [MODIFY] `app/api/finance/adjustment/route.ts`
- Import `AdjustmentRequestSchema` từ `lib/schemas/adjustment.schema.ts`.
- Sử dụng `AdjustmentRequestSchema.safeParse(body)` để kiểm tra dữ liệu.
- Xử lý lỗi trả về nếu `success === false` (lấy message lỗi do Zod sinh ra).
- Dùng `parseResult.data` thay thế cho `body` (đảm bảo an toàn kiểu dữ liệu và tự động loại bỏ field thừa).
