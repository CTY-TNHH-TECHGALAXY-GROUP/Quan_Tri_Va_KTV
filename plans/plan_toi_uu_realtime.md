# Phân tích & Kế hoạch Tối ưu Realtime (Điều phối & Giám sát)

## 1. Phân tích Hiện trạng & Nút thắt (Bottleneck)
Việc sử dụng Supabase Realtime trên gói **Free Tier** có các giới hạn rất nghiêm ngặt:
- **Max 200 Concurrent Connections**: Nếu mỗi thiết bị nhân viên (KTV, Lễ tân) mở nhiều tab, giới hạn này sẽ bị vượt qua dễ dàng.
- **Max 100 Messages per second**: Gửi quá nhiều tín hiệu Realtime liên tục sẽ khiến kết nối bị bóp băng thông (Throttled) hoặc mất tín hiệu.
- **Lạm dụng `fetchData()`**: Hiện tại, mỗi khi bắt được một tín hiệu `postgres_changes`, frontend lại gọi hàm `fetchData()` để tải lại CỰC KỲ NHIỀU dữ liệu (Bookings, Services, TurnQueue...). Điều này làm phình to Data Egress và số lần gọi API, khiến trải nghiệm bị giật lag và hao tổn tài nguyên Free.

## 2. Mục tiêu Tối ưu
Ưu tiên **TỐC ĐỘ BÀN THỜ** và **CẬP NHẬT TỨC THÌ** cho 2 trang quan trọng nhất:
1. **Bảng Điều Phối (`app/reception/dispatch`)**: Nơi Lễ Tân thao tác chia việc.
2. **Bảng Giám Sát (`app/reception/monitor`)**: Nơi Quản lý theo dõi tiến độ tổng quan.

## 3. Đề xuất Kiến trúc Tối ưu (Dành riêng cho 2 trang này)

### Cách 1: Optimistic State Patching (Giảm Egress, Tăng Tốc độ UI)
Thay vì cứ có thay đổi là gọi `fetchData()` để tải lại toàn bộ danh sách, ta sẽ **cập nhật trực tiếp State của React** bằng payload trả về từ Realtime.
- **Insert**: Khi có đơn mới -> fetch đơn đó thôi, push vào mảng `orders`.
- **Update**: Khi trạng thái đơn thay đổi (Vd từ IN_PROGRESS sang DONE) -> Tìm ID trong `orders` và cập nhật `.status` ngay lập tức trên RAM mà không cần tải lại cục data DB.

### Cách 2: Debounce Realtime Fetch (Chống Spam API)
Trong những trường hợp bất khả kháng phải tải lại toàn bộ (Vd: Nhân viên khác chia lại Tua, tách đơn phức tạp), ta sẽ gom các tín hiệu Realtime (nếu có 10 tín hiệu bắn ra trong 1 giây) thành **1 lần gọi API duy nhất**.
- Triển khai bằng thư viện `lodash/debounce` hoặc dùng `useRef(setTimeout)` ngay tại `useEffect`.

### Cách 3: Lược bỏ Realtime ở các trang không cần thiết
- Tắt hoàn toàn `.channel().subscribe()` ở những trang như Báo Cáo, Lịch Sử, Cài Đặt. Các trang này chỉ nên dùng `fetch` truyền thống khi tải trang.
- Chỉ ưu tiên giữ kết nối WebSocket (Channel) ở: KTV Dashboard, Dispatch, Monitor.

---

## Ý Kiến Của Bạn (User Review Required)
> [!IMPORTANT]
> Giải pháp trên sẽ giúp 2 bảng **Điều phối** và **Giám sát** nhận dữ liệu **gần như ngay lập tức (0.1 giây)** mà không sợ tràn gói Free. 
> 
> Bạn có muốn tôi tiến hành áp dụng giải pháp **Optimistic State Patching + Debounce** ngay vào file `app/reception/dispatch/page.tsx` và `monitor` không? Hãy cho tôi biết để tôi bắt đầu code nhé!
