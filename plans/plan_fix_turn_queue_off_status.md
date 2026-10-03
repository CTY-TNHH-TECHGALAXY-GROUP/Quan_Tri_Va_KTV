# Sửa lỗi KTV đã tan ca nhưng vẫn hiển thị trên Sổ Tua

## Vấn đề đã xác định
Khi kiểm tra DB cho trường hợp KTV NH021:
1. Lúc KTV bấm "Tan ca", hệ thống điểm danh đã cập nhật trạng thái của KTV trong bảng `TurnQueue` thành `status = 'off'` (thành công).
2. Tuy nhiên, sau đó KTV hoặc Lễ tân bấm **Hoàn tất** đơn hàng cuối cùng mà KTV vừa làm xong.
3. Hành động "Hoàn tất" gọi đến hàm RPC `promote_next_assignment` trong Database để tìm đơn hàng tiếp theo cho KTV. 
4. Vì KTV không còn đơn nào khác, hàm RPC đã tự động gán lại trạng thái của KTV thành `'waiting'` (Chờ việc).
5. **Hậu quả:** Trạng thái `'off'` bị ghi đè thành `'waiting'`, khiến KTV hiển thị lại lên màn hình Lễ tân (Sổ Tua) thay vì bị ẩn mờ ở cuối.

## Giải pháp (Proposed Changes)
Tạo một file Migration mới trong thư mục `supabase/migrations/` để cập nhật lại 2 hàm RPC (Stored Procedures) đang gây ra lỗi ghi đè này:
- `promote_next_assignment`
- `dispatch_confirm_booking`

**Thay đổi cụ thể trong Logic SQL:**
Thay vì viết cứng lệnh reset:
```sql
UPDATE "TurnQueue"
SET "status" = 'waiting', ...
```
Sẽ sửa thành:
```sql
UPDATE "TurnQueue"
SET "status" = CASE WHEN "status" = 'off' THEN 'off' ELSE 'waiting' END, ...
```
Và giữ nguyên vị trí Queue (`queue_position`) nếu đang là `'off'`, thay vì tự động xếp họ xuống cuối hàng như KTV đang rảnh.

## Verification Plan
1. Chạy lệnh áp dụng Migration SQL (`npx supabase db push` hoặc chạy trực tiếp file SQL).
2. Viết script test nhỏ (hoặc kiểm tra trực tiếp) để mô phỏng:
   - Gán trạng thái một KTV thành `off`.
   - Gọi `promote_next_assignment` cho KTV đó.
   - Kiểm tra xem trạng thái có bị đổi thành `waiting` nữa hay không. NẾU VẪN LÀ `off` thì Fix thành công.

> [!NOTE]
> Xin anh/chị duyệt kế hoạch này để em tiến hành tạo file Migration SQL và vá lỗi vào Database ạ.
