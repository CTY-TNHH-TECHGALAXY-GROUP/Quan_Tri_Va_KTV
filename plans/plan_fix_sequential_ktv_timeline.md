# Kế hoạch sửa lỗi hiển thị trùng giờ trên Kanban Lễ tân và lỗi KTV Dashboard chỉ hiện giờ DV1 đối với các chặng gộp tự động

## 🔍 Nguyên Nhân Gốc Rễ (Root Cause)
1. **Bất đồng bộ logic `shouldMerge` giữa UI và Logic ở KTV Dashboard**:
   * Phía Logic (`KTVDashboard.logic.ts` dòng 799): Kiểm tra `shouldMerge` bắt buộc phải chung phòng (`uniqueRoomIds.size === 1`) và chưa hoàn thành (`!hasFinishedSegment`).
   * Phía UI (`page.tsx` dòng 351, 854): Chỉ kiểm tra `shouldMerge = ktvSegments.length > 1 && uniqueItemIds.size === ktvSegments.length` mà không check phòng hay trạng thái hoàn thành.
   * Khi 2 dịch vụ liên tiếp có thông tin phòng/giường không đồng bộ hoàn chỉnh ở DB, Logic tính `shouldMerge = false` (không gộp chặng, chạy 60 phút) nhưng UI tính `shouldMerge = true` (gộp chặng, ẩn nút chuyển chặng). Kết quả: KTV chỉ thấy timer chạy 60 phút của DV1 và bị kẹt không thể bấm chuyển sang DV2 do nút bấm bị ẩn.
2. **Hiển thị trùng giờ trên Kanban Board của Lễ tân**:
   * Khi KTV bắt đầu đơn hàng, cơ chế `Merge Lock` trong `handleStartTimer.ts` tự động stamp `actualStartTime` cho toàn bộ các chặng gộp tự động (để server bảo vệ chặng khi hoàn tất).
   * Kanban Board của Lễ tân ưu tiên lấy `actualStartTime` trực tiếp từ DB để hiển thị. Vì chặng 2 cũng bị stamp `actualStartTime = 12:50`, Kanban Board hiển thị cả 2 dịch vụ trùng giờ bắt đầu `12:50 -> 13:50`.

---

## 🛠️ Giải pháp Đề xuất
1. **Đồng bộ hoàn toàn logic `shouldMerge` ở KTV Dashboard (cả UI và Logic)**:
   Cập nhật `page.tsx` của KTV Dashboard để có cùng điều kiện check `uniqueRoomIds.size === 1` và `!hasFinishedSegment` như `KTVDashboard.logic.ts`.
2. **Giữ nguyên luồng tự động gộp (không dùng nút chuyển chặng)**:
   Giữ nguyên cơ chế `Merge Lock` hiện tại ở backend và logic gộp ở logic file (không kiểm tra trùng `startTime` dự kiến) để đáp ứng đúng yêu cầu của KTV: tự động cộng tổng thời gian và tự động chạy liên tục không cần nút bấm chuyển chặng thủ công.
3. **Cải tiến logic hiển thị tịnh tiến trên Kanban Board (Lễ tân)**:
   Trong file `KanbanBoard.tsx`, khi tính toán `displayStart` cho dịch vụ, nếu phát hiện dịch vụ này thuộc nhóm gộp tự động (có cùng `actualStartTime` với dịch vụ trước đó trong cùng đơn hàng và chung KTV do Merge Lock stamp), hệ thống sẽ hiển thị tịnh tiến nối tiếp (`displayStart = currentCumulativeStr`) thay vì lấy `actualStartTime` trực tiếp.

---

## 📂 Các file cần sửa đổi

### 1. Phía Lễ tân (Kanban Board):
#### [MODIFY] [KanbanBoard.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/dispatch/_components/KanbanBoard.tsx)
Cập nhật cách tính `displayStart` tại dòng 521.

---

### 2. Phía KTV Dashboard UI:
#### [MODIFY] [page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/dashboard/page.tsx)
Đồng bộ logic `shouldMerge` tại hai vị trí render (Dashboard chính và Timer Screen).

---

## 🧪 Kế Hoạch Xác Minh (Verification Plan)
1. **Lễ tân điều phối**: Gán 2 dịch vụ liên tiếp cho KTV NH014 chung phòng P.V2 (VD: DV1 12:50 - 13:50, DV2 13:50 - 14:50).
2. **KTV bấm Bắt đầu (START_TIMER)**:
   * Hệ thống tự động gộp và chạy timer 120 phút đếm ngược (không hiển thị nút chuyển chặng).
3. **Kiểm tra hiển thị**:
   * **KTV Dashboard**: Hiển thị tổng thời gian 120 phút (thay vì 60 phút của DV1).
   * **Kanban Board (Lễ tân)**: DV1 hiển thị `12:50 -> 13:50`. DV2 tự động hiển thị nối tiếp `13:50 -> 14:50` (thay vì bị kéo về `12:50`).
