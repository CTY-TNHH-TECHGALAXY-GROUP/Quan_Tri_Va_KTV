Câu hỏi của bạn cực kỳ sắc bén! Và đây chính là **bằng chứng thép** chứng minh lỗi nằm ở hàm cập nhật `TurnQueue`.

Để tôi giải thích tại sao "Lần đầu lưu thì không được, nhưng chuột phải gửi lại thì lại được":

### Quá trình diễn ra như sau:

1. **Lần 1 (Khi bạn bấm "Lưu" hoặc "Điều phối lẻ"):**
   - KTV lúc này **chưa có tên trong `TurnQueue`** (chưa điểm danh hoặc là mã lạ).
   - Hệ thống chạy hàm RPC `dispatch_confirm_booking`, lệnh `UPDATE "TurnQueue"` chạy qua KTV này nhưng **không tìm thấy dòng nào để cập nhật**, nên nó bỏ qua (Thất bại ngầm). Đơn hàng không được gán cho KTV.
   - Nhưng hàm RPC này có 1 tác dụng khác là ghi nhận **TurnLedger** (Sổ cái).
   - Ngay sau đó, tiến trình đồng bộ ngầm của hệ thống (`syncTurnsForDate`) quét thấy sổ cái có KTV này, nên nó **tự động tạo 1 dòng trống trong `TurnQueue`** cho KTV (nhưng không có mã đơn hàng).
   - Kết quả Lần 1: KTV không thấy đơn.

2. **Lần 2 (Khi bạn chuột phải chọn "Gửi đơn ngay"):**
   - Lúc này, nhờ Lần 1, KTV **đã có sẵn một dòng trong `TurnQueue`** rồi!
   - Hàm RPC lại được chạy lần nữa. Lần này lệnh `UPDATE "TurnQueue"` tìm thấy KTV, và **cập nhật thành công** mã đơn hàng vào dòng đó.
   - Kết quả Lần 2: KTV nhận được đơn!

### Kết luận
Chính vì vậy, nếu chúng ta sửa hàm RPC thành lệnh **UPSERT** (Nếu có rồi thì Cập nhật, nếu chưa có thì Tạo mới kèm theo đơn hàng luôn), thì Lần 1 sẽ **thành công ngay lập tức**, không cần bạn phải thao tác "Chuột phải gửi đơn" thêm lần nào nữa!

Bạn có duyệt phương án Upsert để tôi tiến hành sửa Database luôn không?
