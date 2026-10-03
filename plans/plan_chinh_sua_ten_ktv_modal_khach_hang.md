# Kế hoạch sửa hiển thị tên và mã KTV ngoài

Khách hàng yêu cầu:
1. Sửa lỗi hiển thị ở "Chi tiết khách hàng": KTV cơ hữu (loại A, B như `NH001`) giữ nguyên hiển thị Mã KTV. KTV ngoài/làm tự do hiển thị Tên thật của KTV.
2. Đổi mã sinh tự động cho KTV ngoài: Từ `C_xxx` thành `EXT_xxx` để dễ hiểu hơn, nhưng không làm hỏng dữ liệu cũ.

## Đề xuất thay đổi

### [MODIFY] `app/api/customers/route.ts`
1. Sửa lại query fetch danh sách KTV:
```typescript
- supabase!.from('Staff').select('code, name')
+ supabase!.from('Staff').select('id, full_name')
```
2. Cập nhật logic tạo `staffMap` (Xử lý cho cả `C_` cũ và `EXT_` mới):
```typescript
- const staffMap = new Map((staff || []).map(s => [s.code, s.name || 'Unknown']));
+ const staffMap = new Map((staff || []).map(s => {
+     // Nếu là KTV ngoài (C_ hoặc EXT_), hiển thị tên. Nếu không, giữ nguyên mã ID.
+     if (s.id && (s.id.startsWith('C_') || s.id.startsWith('EXT_'))) {
+         return [s.id, s.full_name || s.id];
+     }
+     return [s.id, s.id];
+ }));
```

### [MODIFY] `app/reception/dispatch/actions.ts`
Cập nhật hàm sinh ID khi Lễ tân gõ tay tên KTV ngoài chưa có trong hệ thống:
```typescript
- const newId = `C_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
+ const newId = `EXT_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
```

## Kế hoạch Kiểm tra / Kết quả dự kiến (Verification Plan)
1. **Kiểm tra Sinh KTV Mới**: Khi Lễ tân gõ tên một KTV lạ trên bảng Dispatch (VD: "Lan Anh"), hệ thống sẽ sinh ra ID dạng `EXT_XXXXXX`.
2. **Kiểm tra KTV Loại Ngoài (Cũ & Mới)**:
   - KTV cũ mã `C_50LQFT` (Tên: "Thu Phương") -> Hiển thị "Thu Phương".
   - KTV mới mã `EXT_12ABCD` (Tên: "Lan Anh") -> Hiển thị "Lan Anh".
3. **Kiểm tra KTV Cơ Hữu**: Nếu KTV có mã là `NH001`, hệ thống vẫn tiếp tục hiển thị "NH001" như yêu cầu của người dùng.
4. **Tính Tương Thích**: Báo cáo hoa hồng, dữ liệu bảng chấm công hiện tại không bị ảnh hưởng do trong toàn bộ hệ thống đã có sẵn logic nhận diện cả `C_` và `EXT_`.
5. **Cập nhật Version**: Đánh dấu bản phát hành thành `1.7.16`.

> [!NOTE]
> Kế hoạch đã bao gồm cả việc chuyển sang mã `EXT_`. Bạn xem qua và bấm "Proceed" (Duyệt) để mình tiến hành sửa mã nguồn nhé!
