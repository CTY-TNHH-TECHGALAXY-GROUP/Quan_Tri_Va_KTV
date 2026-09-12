# Kế hoạch Đồng bộ Timer Đa Chặng (KTV & Khách hàng)

## Nguyên nhân gốc rễ (Root Cause)
Hiện tại tính năng tính giờ cho các đơn hàng nhiều chặng (VD: Chặng 1 = 60p, Chặng 2 = 30p) đang gặp lỗi bất đồng bộ vì:
1. **Phía KTV**: Khi KTV bấm chuyển từ Chặng 1 sang Chặng 2, code frontend chỉ cập nhật biến local `activeSegmentIndex` và tự tính bù trừ thời gian. Thông tin chuyển chặng này **không được lưu xuống Database**.
2. **Phía Khách hàng**: Web khách hàng luôn lấy tổng thời gian (60 + 30 = 90 phút) và đếm ngược liên tục từ mốc thời gian bắt đầu (`timeStart`). Do không có data báo chuyển chặng, nếu KTV xong chặng 1 sớm hoặc trễ, web khách vẫn đếm một mạch 90 phút, gây sai lệch nghiêm trọng.

## Open Questions
> [!IMPORTANT]
> Câu hỏi thiết kế (Dành cho User): 
> Với web khách hàng, khi KTV bấm vào **Chặng 2 (30p)**, bạn muốn vòng tròn Timer hiển thị đếm ngược của **riêng Chặng 2 (30p)**, hay vẫn hiển thị vòng tròn **tổng 90p** nhưng nhảy số còn 30p? 
> 
> *Đề xuất của tôi: Nên hiển thị vòng tròn theo thời lượng của Chặng hiện tại (30p) để đồng bộ hoàn toàn UI với máy KTV. Khách hàng sẽ thấy rõ ràng: "Đang làm chặng 2 (30 phút)".*

## Proposed Changes

### 1. Backend (`Quan_Tri_Va_KTV`)
Sử dụng trường `segments` (kiểu JSONB) của `BookingItems` để lưu vết thời gian thực tế:
- Khi bắt đầu (`START_TIMER`): Gắn `actualStartTime = now()` cho Segment đầu tiên.
- Khi chuyển chặng (`RESUME_TIMER` / `NEXT_SEGMENT`): Gọi API lên server để lưu `actualEndTime` cho chặng vừa xong, và gắn `actualStartTime = now()` cho chặng tiếp theo. Lưu mảng `segments` mới vào DB.

#### [MODIFY] `app/api/ktv/booking/route.ts`
- Cập nhật logic xử lý `action: 'RESUME_TIMER'`: Lấy data `segments` hiện tại, cập nhật timestamp (`actualStartTime`, `actualEndTime`) dựa theo `activeSegmentIndex` được truyền từ client lên, và update vào table `BookingItems`.

### 2. Frontend KTV (`Quan_Tri_Va_KTV`)
#### [MODIFY] `app/ktv/dashboard/KTVDashboard.logic.ts`
- Khi lấy data từ DB, ưu tiên xác định `activeSegmentIndex` dựa vào dữ liệu `actualStartTime` và `actualEndTime` trong mảng `segments` thay vì tự ước lượng bằng thuật toán đếm phút.
- Cập nhật hàm `handleFinishTimer` để truyền `currentIdx` lên API khi chuyển chặng.
- Sửa lại tính toán `timeRemaining` để đếm ngược chính xác theo thời lượng của chặng hiện tại và `actualStartTime` của nó.

#### [MODIFY] `app/ktv/dashboard/page.tsx`
- Cập nhật `displayDuration` và biến truyền vào timer circle để hiển thị thời lượng của chặng hiện tại thay vì thời lượng tổng (`totalAssignedMins`).

### 3. Frontend Khách hàng (`wrb-noi-bo-dev`)
#### [MODIFY] `src/components/Journey/Journey.logic.ts`
- Sửa hook `groupItemsByTech` để phát hiện xem dịch vụ hiện tại đang ở segment (chặng) số mấy thông qua việc đọc JSON `segments`.
- Tính `totalDuration` và `computedTimeStart` cho Timer dựa trên Segment đang chạy, thay vì sum toàn bộ mảng.

#### [MODIFY] `src/components/Journey/ServiceList.tsx`
- Cập nhật giao diện `TabTimerView` để hiển thị rõ tên Chặng hiện hành (nếu có nhiều chặng), và hiển thị đếm ngược thời gian của riêng chặng đó để đồng bộ 100% với KTV.

## Verification Plan
### Automated Tests
- Kiểm tra cú pháp TypeScript.
### Manual Verification
- Dùng trình duyệt mở KTV Dashboard, nhận 1 đơn hàng 2 chặng (VD: 60p và 30p).
- Bấm Bắt đầu. Kiểm tra timer ở web Khách hàng hiển thị đếm ngược 60p.
- Bấm "XONG CHẶNG 1 -> CHẶNG 2".
- Kiểm tra web Khách hàng (cùng lúc) lập tức cập nhật sang đếm ngược 30 phút.
- F5 trang KTV Dashboard, đảm bảo KTV vẫn ở Chặng 2 và timer tiếp tục đếm chuẩn xác, không bị reset.
