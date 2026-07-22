# Kế hoạch đồng bộ UI phiếu in ở điều phối nhanh

## Vấn đề hiện tại
- Trong hình 1 (Điều phối nhanh), phiếu in (modal xem trước) **không hiển thị** phần mô tả chi tiết của dịch vụ (subtitle).
- Trong hình 2 (Điều phối chi tiết), phiếu in hiển thị rõ phần mô tả dịch vụ bên dưới tên dịch vụ dưới dạng text chữ màu xám, không có viền.
- Hiện tại code trên repository đang có một box xám bao quanh description, nhưng UI gốc trong ảnh 2 của User chỉ là chữ plain text.

## Mục tiêu
1. Đảm bảo mô tả dịch vụ (`serviceDescription`) luôn hiển thị đầy đủ trên phiếu in của bảng "Điều phối nhanh".
2. Đồng bộ style của phần mô tả này giữa `QuickDispatchTable.tsx` và `DispatchStaffRow.tsx` để nó giống hệt với ảnh 2 (không có box xám, chỉ là text màu xám đậm, font chữ vừa phải).

## Các bước triển khai

### 1. Chỉnh sửa `QuickDispatchTable.tsx`
- Sửa lại phần render `serviceDescription` trong modal in phiếu.
- Đổi style từ `<div className="mt-2 bg-slate-50 border border-slate-100 rounded-xl p-3">` thành dạng text plain giống ảnh 2: `<p className="mt-1.5 text-sm font-bold text-gray-600 leading-relaxed">`.

### 2. Chỉnh sửa `DispatchStaffRow.tsx`
- Sửa lại phần render `serviceDescription` trong modal in phiếu tương tự như trên để đồng bộ hoàn toàn 100% giữa 2 giao diện.

Bạn có đồng ý với kế hoạch này không để mình tiến hành code?
