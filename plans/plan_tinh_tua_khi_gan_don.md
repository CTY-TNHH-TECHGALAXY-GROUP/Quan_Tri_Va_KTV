# Phân tích & Kế hoạch: Tính tua ngay khi gán KTV

## 1. Phân tích bài toán (Góc nhìn AI Sparring Partner)

Hiện tại, hệ thống đang tính tua theo **"Kết quả"** (Đợi đơn `DONE/COMPLETED` mới cộng 1 tua). 
Bạn đang đề xuất chuyển sang tính tua theo **"Hành động phân bổ"** (Chỉ cần Lễ tân gán KTV vào đơn là cộng 1 tua ngay lập tức).

### Ưu điểm (Pros):
- **Phân bổ công bằng hơn ngay thời gian thực:** Tránh tình trạng 1 KTV A làm đơn 120 phút chưa xong (tua vẫn là 0), Lễ tân nhìn vào tưởng đang ế khách lại ưu tiên gọi tiếp cho ca sau. Nếu cộng ngay, KTV A sẽ bị đẩy xuống dưới cùng, nhường cơ hội cho KTV B.
- **Phản ánh đúng số lượng khách đã tiếp:** Con số `turns_completed` sẽ đại diện cho "Tổng số khách đã nhận trong ngày" thay vì "Số khách đã phục vụ xong".

### Rủi ro / Bottlenecks (Cons):
> **CẢNH BÁO**
> Nếu áp dụng cách này, chúng ta BẮT BUỘC phải xử lý triệt để 2 Edge Cases sau, nếu không KTV sẽ bị thiệt thòi và khiếu nại:
> 1. **Khách huỷ ngang / Khách đổi người:** Nếu gán xong cộng 1 tua, nhưng 10 phút sau khách đổi ý không làm nữa (chuyển sang `CANCELLED`) hoặc đổi KTV khác -> **Phải có cơ chế tự động TRỪ đi 1 tua đã cộng**.
> 2. **Gán thêm dịch vụ (Add-on):** Đang làm massage, khách mua thêm gội đầu (vẫn chung 1 Bill). Lễ tân gán tiếp KTV đó vào dịch vụ gội đầu -> **Tuyệt đối KHÔNG được cộng thành 2 tua** (vẫn phải giữ quy tắc 1 Bill = 1 Tua).

---

## 2. Kế hoạch triển khai (Implementation Plan)

Để giải quyết bài toán và né được các rủi ro trên, chúng ta không cần viết lại toàn bộ, mà chỉ cần **mở rộng phễu đếm tua** trong API.

### Các thay đổi dự kiến:

#### [MODIFY] `app/api/turns/route.ts`
*   **Hiện tại:** Chỉ đếm các item/booking có trạng thái `['COMPLETED', 'DONE']`.
*   **Thay đổi:** Mở rộng danh sách trạng thái được đếm thành `['NEW', 'PREPARING', 'IN_PROGRESS', 'COMPLETED', 'DONE']`.
*   **Giữ nguyên chặn huỷ:** Tiếp tục giữ chặt điều kiện `if (bookingStatus === 'CANCELLED') continue;` (Điều này tự động xử lý rủi ro số 1: Nếu đơn chuyển sang huỷ, hàm đồng bộ chạy lại sẽ tự động không đếm đơn đó nữa -> Số tua tự động bị trừ đi 1, trả lại sự công bằng cho KTV).
*   **Giữ nguyên giỏ `Set`:** Giữ thuật toán đếm theo `bookingId`. (Điều này tự động xử lý rủi ro số 2: Dù gán 10 dịch vụ cho 1 bill từ lúc đang `PREPARING`, nó vẫn chỉ đếm là 1 tua).

---

## 3. Câu hỏi cho bạn (User Review Required)

> **QUYẾT ĐỊNH CỦA BẠN**
> Bạn có đồng ý với rủi ro và hướng giải quyết này không?
> Lưu ý: Trang **Lịch sử KTV (History)** sẽ KHÔNG bị ảnh hưởng. Tức là tua thì đếm trước để xếp hàng, nhưng **Tiền hoa hồng** thì vẫn đợi làm xong (`DONE`) mới được cộng vào ví. Điều này là tối ưu nhất.
