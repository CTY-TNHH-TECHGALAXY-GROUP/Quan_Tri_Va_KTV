# Kế hoạch Triển khai: Bảng Quản lý Toàn bộ SystemConfigs

## Đề xuất Giải pháp Giao diện
Vì trang Cài Đặt Hệ Thống hiện tại đã có một số Card (Thẻ) với giao diện tuỳ chỉnh rất đẹp (cho Tiền thưởng, Quỹ KTV, Web Booking...), tôi sẽ **GIỮ NGUYÊN** các Card này ở phía trên để dễ dùng cho các tác vụ thường ngày.

Ở phía dưới cùng của trang, tôi sẽ bổ sung một khu vực mới: **"Bảng Cấu hình Nâng cao (Raw Configs)"**. Khu vực này sẽ hiển thị toàn bộ dữ liệu thực tế từ Database dưới dạng Bảng (Table).

## Tính năng của Bảng Cấu hình
1. **Hiển thị danh sách (Read):** Lấy toàn bộ các dòng từ bảng `SystemConfigs` hiển thị lên (Gồm các cột: `Key`, `Value`, `Mô tả`, `Lần cập nhật cuối`).
2. **Thêm mới (Create):** Có nút "Thêm Cấu hình", mở một form nhỏ để bạn nhập Key, Value và Mô tả mới.
3. **Chỉnh sửa (Update):** Bạn có thể bấm vào một dòng bất kỳ để sửa giá trị (Value) hoặc sửa Mô tả (Description) trực tiếp. Hệ thống sẽ tự nhận dạng dữ liệu nhập vào (nếu là số thì lưu số, nếu là chữ thì lưu chữ).
4. **Xóa (Delete):** Có nút thùng rác để xóa những cấu hình không còn dùng đến.

## Các bước kỹ thuật
- **Bước 1:** Bổ sung API CRUD độc lập (`GET`, `POST`, `PATCH`, `DELETE`) tại `app/api/admin/settings/system/advanced/route.ts` để thao tác trực tiếp với bảng `SystemConfigs` theo từng hàng.
- **Bước 2:** Tạo Component `SystemConfigsTable.tsx` chứa giao diện bảng và logic quản lý state (thêm, sửa, xóa).
- **Bước 3:** Gắn Component này vào cuối trang `app/admin/settings/system/page.tsx`.
