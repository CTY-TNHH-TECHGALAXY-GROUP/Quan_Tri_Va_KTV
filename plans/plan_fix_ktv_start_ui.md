# Cập nhật Kế hoạch sửa lỗi KTV không bắt đầu được (Thêm lỗi nút Lưu)

## 1. Vấn đề mới phát hiện (Nút Lưu chưa đồng bộ giờ)
Đúng như chị nói, khi chị sửa giờ thành **10:54** trên bảng điều phối và bấm **Lưu**, API `saveDraftDispatch` chỉ mới cập nhật dữ liệu `startTime: "10:54"` vào trong chi tiết dịch vụ (`BookingItems`).

**Tuy nhiên, nút Lưu đã BỎ QUÊN việc cập nhật lại giờ này sang Sổ tua (`TurnQueue`) của KTV.**
Do đó, sổ tua của NH001 vẫn giữ nguyên giờ cũ là **11:20**. Hệ thống kiểm tra thời gian lại lấy giờ 11:20 từ sổ tua để chặn KTV, khiến bạn ấy bấm nút Bắt đầu lúc 10:58 bị báo lỗi.

## 2. Kế hoạch khắc phục tổng thể

### A. Sửa lỗi nút Lưu (Backend)
- **File:** `app/reception/dispatch/actions.ts`
- **Thay đổi:** Trong hàm `saveDraftDispatch`, bổ sung thêm logic: Sau khi lưu giờ vào chi tiết dịch vụ, sẽ tự động tìm Sổ tua (`TurnQueue`) của KTV tương ứng đang nhận đơn này và **cập nhật lại cột `start_time`** cho khớp.

### B. Sửa lỗi nút Bắt đầu không đổi màn hình (Frontend - Như đã báo)
- **File:** `app/ktv/dashboard/KTVDashboard.logic.ts`
- **Thay đổi:** Thêm lệnh `setScreen('TIMER')` vào hàm `handleStartTimer` để màn hình KTV tự động chuyển ngay sang bộ đếm giờ khi bấm Bắt đầu thành công (tránh bị kẹt giao diện).

---
> [!IMPORTANT]
> **Đây chính xác là nguyên nhân sâu xa nhất khiến KTV bị kẹt sáng nay. Nếu chị Duyệt kế hoạch này, em sẽ tiến hành sửa cả 2 file ngay lập tức ạ!**
