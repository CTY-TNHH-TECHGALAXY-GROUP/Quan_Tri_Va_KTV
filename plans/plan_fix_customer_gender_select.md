# Kế hoạch sửa lỗi bổ sung customerGender vào getDispatchData

## Vấn đề
Hàm `getDispatchData` trong `app/reception/dispatch/actions.ts` đang thiếu `customerGender` trong câu lệnh `.select(...)` từ bảng `Bookings`, khiến cho giao diện điều phối luôn bị fallback về giới tính mặc định là `'male'`.

## Giải pháp
1. Bổ sung `customerGender` vào chuỗi `.select(...)` của query `Bookings` trong `app/reception/dispatch/actions.ts`.
2. Tăng `APP_VERSION` và mô tả trong `lib/version.ts`.
