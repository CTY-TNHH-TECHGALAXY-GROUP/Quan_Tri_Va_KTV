# Tối ưu giao diện KTV và Logic in phiếu tua

Kế hoạch này nhằm giải quyết 3 yêu cầu cải thiện trải nghiệm cho KTV và Lễ tân:

## 1. Tăng kích thước vùng Tập trung & Tránh (KTV Dashboard)
**File**: `app/ktv/dashboard/page.tsx`
- **Thay đổi**: Cập nhật phần UI hiển thị `item.focus` và `item.avoid` trong component `CollapsibleRequirements`.
- **Chi tiết**: Tăng font size từ `text-[10px]` lên `text-[13px]`, tăng icon size từ `12` lên `16`, và tăng padding để các yêu cầu quan trọng này đập ngay vào mắt KTV.

## 2. Ẩn Giới tính yêu cầu trên Phiếu Tua
**Files**: 
- `app/reception/dispatch/_components/QuickDispatchTable.tsx` (In nhanh)
- `app/reception/dispatch/_components/DispatchStaffRow.tsx` (In chi tiết)
- **Thay đổi**: Xóa phần render badge giới tính (`genderReq`) trên modal In Phiếu Tua. KTV chỉ cần biết phòng và giờ làm, phần lọc giới tính Lễ tân đã lo khi điều phối.

## 3. Ẩn Mô tả dịch vụ khi tên dịch vụ bị sửa đổi tay
**Files**: 
- `app/reception/dispatch/_components/QuickDispatchTable.tsx`
- `app/reception/dispatch/_components/DispatchStaffRow.tsx`
- **Thay đổi**: Cập nhật logic hiển thị `serviceDescription` trên Phiếu Tua.
- **Logic**: Chỉ hiển thị mô tả dịch vụ NẾU tên dịch vụ hiển thị trên bill (`displayName` / `tName`) TRÙNG KHỚP với tên dịch vụ gốc (`serviceName`). Nếu Lễ tân đã gõ tên khác (vd: "Massage Cổ Vai Gáy" thay vì "Massage Thái"), mô tả cũ sẽ bị ẩn đi để tránh KTV đọc bị nhầm lẫn.

> [!IMPORTANT]
> Bạn vui lòng xem qua các thay đổi. Nếu bạn duyệt, tôi sẽ tiến hành cập nhật ngay lập tức và lưu plan này lại vào thư mục `plans/`.
