# Phân tích luồng dữ liệu đơn TEST-260818-9WP8 và Fix Lỗi Hiển Thị Thời Gian

## 1. Cập nhật theo insight của anh
Anh hoàn toàn chính xác! Nguyên gốc 2 dịch vụ là:
- Lấy ráy tai: **30 phút**
- Chăm sóc da mặt: **45 phút**
-> **Tổng thời lượng thực tế là 75 phút**.
Vậy `10:06 + 75 phút = 11:21` (như KTV Timeline hiển thị) mới là **KẾT QUẢ ĐÚNG**.

## 2. Nguyên nhân gốc rễ (Root Cause)
Khi lễ tân thao tác gộp (merge) dịch vụ trên UI, hệ thống ĐÃ TỰ ĐỘNG cộng dồn thời gian (30 + 45 = 75) và gán 75 phút này làm `segment.duration` cho dịch vụ cha rồi.
- **KTV Timeline (`dispatch-timeline.ts`)**: Đọc thẳng `segment.duration` = 75p -> Vẽ thanh block kết thúc lúc **11:21** (Chuẩn).
- **Thẻ Kanban (`KanbanBoard.tsx`)**: Lại có một đoạn code "cầm đèn chạy trước ô tô". Nó đọc thấy dịch vụ cha có 75p, sau đó nó vòng lặp (loop) qua các dịch vụ con và **cộng thêm lần nữa** (Double-count). 
  - Khách A: Cộng thêm child 45p -> Thành 120p -> Kết thúc **12:06**.
  - Khách B: Cộng thêm child 30p -> Thành 105p -> Kết thúc **11:52**.

## 3. Kế hoạch Fix (Implementation Plan)

### [Component: Kanban Board]

#### [MODIFY] `app/reception/dispatch/_components/KanbanBoard.tsx`
- Xóa bỏ dòng code cộng dồn `duration += Number(childSeg?.duration) ...` ở line 693. 
- Giữ nguyên logic cập nhật `maxActualEndTime` để đề phòng trường hợp dịch vụ con kết thúc trễ.
- Do `segment.duration` đã chứa TỔNG thời gian gộp từ lúc Dispatch, Thẻ Kanban sẽ chỉ sử dụng thời lượng gốc này. Kết quả sẽ hiển thị thống nhất là `11:21` (giống hệt thanh KTV Timeline).

## 4. Verification Plan
- Sửa code và lưu lại.
- Reload trang Dispatch.
- Kiểm tra thẻ Kanban cho KTV NH079 và LISA: Cả hai thẻ sẽ hiển thị `10:06 -> 11:21` và `10:07 -> 11:22`. KTV Timeline và Kanban Board sẽ đồng bộ 100%.
