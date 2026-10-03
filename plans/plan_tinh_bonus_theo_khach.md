# Kế hoạch Điều chỉnh Logic Tính Bonus cho KTV

Theo yêu cầu của bạn, logic tính tiền Bonus (Điểm thưởng) hiện tại sẽ được thay đổi cốt lõi từ việc tính theo **Đầu dịch vụ (BookingItems)** sang tính theo **Số lượng khách hàng (guestCount)** trong mỗi đơn.

Mục tiêu chính: Tránh việc 1 khách làm nhiều dịch vụ gọi nhiều KTV khiến quỹ Bonus bị phình to bất thường. Quỹ Bonus sinh ra cho 1 khách phải bị giới hạn.

## ⚠️ User Review Required (Cần bạn duyệt)

> [!IMPORTANT]
> Dưới đây là công thức mới được đề xuất dựa trên ví dụ của bạn:
> **Điểm thưởng KTV = `Điểm Base của Ca` × (`Tổng số Khách (guestCount)` / `Tổng số KTV tham gia đơn`)**
> 
> Ví dụ bạn đã đưa: 
> Đơn 1 Khách, có 2 KTV (Ca 2 và Ca 3) cùng làm (chia ra 2 dịch vụ).
> - Tổng Khách = 1
> - Tổng KTV = 2
> - KTV Ca 2 (Base 20) sẽ nhận = `20 × (1 / 2) = 10 điểm`.
> - KTV Ca 3 (Base 30) sẽ nhận = `30 × (1 / 2) = 15 điểm`.
> Trùng khớp hoàn toàn với con số bạn muốn!

## ❓ Open Questions (Các trường hợp cần bạn chốt)

> [!WARNING]
> Công thức này cực kỳ hợp lý cho trường hợp nhiều KTV phục vụ 1 khách. Tuy nhiên, nó sẽ dẫn đến các trường hợp ngược lại (Ít KTV phục vụ nhiều Khách). Bạn hãy xem 2 trường hợp dưới đây và trả lời trực tiếp vào ô chat để chốt giúp mình nhé:
> 
> **Trường hợp 1: 1 KTV phục vụ 2 Khách trong cùng 1 Đơn (Ví dụ 1 KTV làm 2 suất massage liên tiếp)**
> - Tổng Khách = 2, Tổng KTV = 1.
> - Tính theo công thức: KTV đó sẽ nhận `Base × (2 / 1) = Nhân đôi Base`. (Ví dụ: Ca 2 sẽ nhận 40 điểm).
> - **Câu hỏi 1:** Bạn có đồng ý cho KTV nhận x2 (hoặc x3) Base nếu họ gánh nhiều khách trong cùng 1 đơn không? Hay bạn vẫn muốn dùng hàm Max để chặn không cho vượt qua Base (tức là dù làm 2, 3 khách thì trong 1 bill cũng chỉ nhận tối đa 20 điểm)?
> 
> **Trường hợp 2: Khách nhóm đông người, gọi KTV chia không đều**
> - Đơn 3 Khách, nhưng chỉ gọi 2 KTV (KTV A làm cho 2 khách, KTV B làm cho 1 khách).
> - Theo công thức trên, Tổng Khách = 3, Tổng KTV = 2 (Tỷ lệ 1.5).
> - Cả KTV A và KTV B đều nhận được `Base × 1.5`. Mặc dù KTV A làm cực hơn (phục vụ 2 khách) còn KTV B chỉ làm 1 khách. 
> - **Câu hỏi 2:** Tạm thời chia đều trung bình theo "Tổng số KTV trong đơn" như thế này có chấp nhận được không? Hay bắt buộc phải đếm xem KTV đó thực sự chạm tay vào bao nhiêu Khách (rất phức tạp vì cấu trúc data hiện tại của bạn không ghi rõ KTV nào làm cho đích danh ông khách nào trong nhóm)?

## Proposed Changes (Các thay đổi dự kiến)

### Thay đổi logic Backend

#### [MODIFY] [KtvCommissionService.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/lib/services/KtvCommissionService.ts)
- Cập nhật hàm `calculateBookingBonus`.
- Xóa bỏ vòng lặp `for (const item of booking.BookingItems)` dùng để chia điểm theo đầu dịch vụ.
- Thêm logic lấy `booking.guestCount` (mặc định = 1 nếu không có).
- Đếm tổng số lượng KTV duy nhất tham gia vào toàn bộ đơn hàng (Đã có sẵn biến `allKtvCodes.size`).
- Tính điểm bằng công thức: `adjustedBasePoints * (guestCount / totalUniqueKTVs)`.
- (Optional) Thêm hàm chặn Max tùy theo câu trả lời của bạn ở trên.

## Verification Plan

### Manual Verification
- Bạn cần chạy test thử tạo 1 Đơn hàng có 1 Khách nhưng 2 Dịch vụ. Phân cho 2 KTV (Ca 2 và Ca 3) và kiểm tra ví Bonus KTV xem có đúng ra 10đ và 15đ không.
- Tạo đơn 2 Khách phân cho 1 KTV để kiểm tra cận trên (Max cap).
