# Kế hoạch Khắc Phục Lỗi Nhảy Sang Chặng 2 Khi Chưa Xong Chặng 1

## Vấn đề hiện tại (Root Cause)
Khi 1 KTV được gán 2 dịch vụ trong cùng 1 đơn hàng (ví dụ: Dịch vụ A 5 phút, Dịch vụ B 60 phút):
- **Frontend** gộp các chặng của cả 2 dịch vụ thành một mảng danh sách chặng làm việc chung (`allMySegs`), trong đó:
  - `activeSegmentIndex = 0` là Dịch vụ A.
  - `activeSegmentIndex = 1` là Dịch vụ B.
- Tuy nhiên, **Backend (API)** trong file `api/ktv/booking/route.ts` lại đang hiểu sai tham số này. Khi gọi `START_TIMER` với `activeSegmentIndex = 0`, Backend lặp qua **từng dịch vụ** và set `actualStartTime` cho phần tử đầu tiên của **mỗi dịch vụ**.
- Kết quả: Cả Dịch vụ A và Dịch vụ B đều nhận được `actualStartTime` ở cùng một thời điểm.
- Khi luồng đồng bộ `fetchBooking` trên Frontend chạy lại, nó tìm từ dưới lên trên xem chặng nào đã có `actualStartTime` để xác định chặng đang chạy (resume). Do Dịch vụ B (chặng 2) đã bị Backend gán nhầm giờ bắt đầu, hệ thống tưởng rằng KTV đang ở chặng 2 nên tự động nhảy sang chặng 2 ngay lập tức, bỏ qua bộ đếm ngược của chặng 1.

## Proposed Changes

### [MODIFY] app/api/ktv/booking/route.ts
Cần viết lại logic cập nhật `segments` trong API để nó hiểu `activeSegmentIndex` theo dạng danh sách gộp (global) giống y hệt Frontend.

1. **Gộp mảng chặng toàn cục:** Lặp qua tất cả `BookingItems`, parse `segments`, sau đó gộp tất cả các chặng thuộc về KTV này thành một mảng `allGlobalSegs` có chứa tham chiếu đến `item` gốc và vị trí index gốc (`localIdx`).
2. **Xử lý thời gian theo Global Index:**
   - **`START_TIMER`**: Set `actualStartTime` cho `allGlobalSegs[0]`.
   - **`NEXT_SEGMENT`**: Set `actualEndTime` cho `allGlobalSegs[activeSegmentIndex - 1]` và set `actualStartTime` cho `allGlobalSegs[activeSegmentIndex]`.
   - **`RESUME_TIMER`**: Set `actualStartTime` cho `allGlobalSegs[activeSegmentIndex]`.
3. **Lưu dữ liệu:** Sau khi đã cập nhật thời gian lên các biến tham chiếu, lặp qua danh sách `BookingItems` ban đầu và ghi đè (update) cột `segments` chứa dữ liệu mới bằng Supabase.

> [!TIP]
> Việc sửa API theo hướng này vừa giữ nguyên logic UI, vừa đảm bảo tính toàn vẹn dữ liệu cho dù là 1 dịch vụ nhiều chặng hay nhiều dịch vụ 1 chặng.

## User Review Required
Bạn hãy kiểm tra qua giải pháp này xem có hợp lý không nhé. Nếu bạn đồng ý, mình sẽ tiến hành triển khai sửa file `route.ts` ngay.
