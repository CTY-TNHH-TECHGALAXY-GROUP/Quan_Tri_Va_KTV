# Kế Hoạch Triển Khai: Khóa Nút Tan Ca & Thuế 10% (Đã Duyệt)

## 1. Khóa Nút Tan Ca Khi Lễ Tân Báo "Có Khách"

**Quy trình hoạt động:**
1. Khách vào tiệm đông, Lễ tân chưa kịp điều phối → Lễ tân **BẬT (ON)** nút **[🔔 Thông báo có khách]** (dạng công tắc/toggle) trên màn hình Điều Phối.
2. Ngay lập tức, nút **[Orica Xin Cảm Ơn]** (nút Tan ca) trên App KTV của **TẤT CẢ** các KTV trong danh sách tua sẽ bị **ẨN ĐI**. Màn hình sẽ hiện thông báo "Quầy vừa báo có khách. Vui lòng giữ máy."
3. Bất chấp KTV đó đã hết giờ ca hay chưa (Ngoại lệ hết ca: Vẫn phải làm), miễn là có cờ này đang ON, KTV không thể tan ca. Các thao tác khác (như Xin tạm nghỉ) vẫn được phép bình thường.
4. **Mở khóa (OFF):** Lễ tân sẽ phải bấm TẮT (OFF) công tắc này thủ công sau khi xử lý xong xuôi khách để các KTV không dính khách có thể tan ca. KHÔNG tự động nhả.

**Cấu trúc kỹ thuật:**
- Tạo bảng `GuestArrivalEvents` bằng Supabase Migration để lưu trạng thái khóa (chỉ lưu 1 record active).
- Viết API `POST/DELETE /api/reception/guest-arrival` để Lễ tân BẬT/TẮT khóa.
- Thêm nút Toggle trên `app/reception/dispatch/page.tsx`.
- Cập nhật App KTV (`app/ktv/attendance/page.tsx`) để **ẩn** (hide) component nút Tan ca thay vì disable khi API báo đang có khóa.
- API status của KTV trả về cờ `guestArrivalLock`.

## 2. Tính Thuế 10% Thu Nhập Của KTV (Tiền Tua + Bonus)

**Đối tượng áp dụng:** Trước mắt chỉ áp dụng cho KTV thuộc cơ chế **TYPE_D**.

**Công thức áp dụng:**
`Tổng thực nhận = (Tiền tua + Bonus) - 10% * (Tiền tua + Bonus)`
Ví dụ: Tua 100k + Bonus 20k = 120k. Thuế = 12k. Thực nhận = 108k.

**Quy trình hoạt động:**
1. Việc tính toán thuế sẽ diễn ra ở bước cuối cùng, tức là **khi Khách hàng hoàn thành đánh giá** (Review) và hệ thống chốt tiền tua + bonus để cộng vào Ví KTV.
2. Hệ thống sẽ tự động trích 10% từ tổng thu nhập của đơn đó.
3. Trong màn hình **Lịch sử (History)** của KTV, giao diện sẽ được bổ sung thêm một dòng ghi rõ tiền Thuế đã trừ để KTV nắm được chi tiết dòng tiền (vd: `Thuế (10%): -12,000đ`).

**Cấu trúc kỹ thuật:**
- Cập nhật `KtvTypeDWalletService.ts` để áp dụng mức trừ 10% trước khi tạo giao dịch cộng tiền vào Ví (`KTVWalletTransactions`). 
- Cập nhật payload lưu trữ của transaction (trường `metadata`) để chứa `{ taxDeducted: 12000, preTaxAmount: 120000 }` giúp UI dễ dàng hiển thị.
- Cập nhật giao diện màn hình `app/ktv/history/page.tsx` và `app/ktv/wallet/page.tsx` để render dòng Thuế 10% trong chi tiết từng đơn hàng.
