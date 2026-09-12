# Kế hoạch sửa lỗi hiển thị và tịnh tiến thời gian gộp DV

## 🔍 Nguyên Nhân Gốc Rễ (Root Cause)
1. **Chia thời gian không đều khi hoàn thành sớm (Backend)**: 
   Khi KTV gộp 2 dịch vụ (VD: 30p + 30p = 60p) nhưng hoàn thành sớm lúc 49p, thuật toán `handleFinishService` hiện tại đang phân bổ thời gian theo dạng "Nhồi đầy chặng trước, dư mới cho chặng sau" (Fill-first). Do đó, DV1 chiếm trọn 30p, DV2 bị gán thời lượng là 19p. Nhưng do Frontend không lưu vết, Lễ Tân (Kanban Board) tính toán lệch nên hiển thị DV2 bị "bẹp dúm" 14:04 -> 14:04 và gây hiểu lầm.
2. **KTV Reload bị mất trạng thái gộp (Frontend)**:
   Tại màn hình KTV Dashboard (lúc Review/Handover), hàm `shouldMerge` đang có điều kiện `!hasFinishedSegment`. Khi KTV bấm hoàn tất, `hasFinishedSegment` = true, dẫn đến `shouldMerge` = false. Do đó khi KTV F5, giao diện bị tách ra làm 2 đoạn (không hiển thị gộp nữa).
3. **Lễ tân Kanban mất dấu vết gộp (Frontend)**:
   Do Backend ghi đè `actualStartTime` mới (13:45) cho DV2 khi phân bổ, Kanban Board không còn nhận ra 2 DV có chung giờ bắt đầu ban đầu (13:15). Lễ tân mất dấu vết để hiển thị tịnh tiến liền mạch.

---

## 🛠️ Giải pháp Đã triển khai

### 1. Thuật toán phân bổ tỉ lệ - Proportional Allocation (Backend)
- Sửa `handleFinishService.ts`: Khi gộp DV và hoàn thành, thay vì ưu tiên thời gian cho chặng 1, chia thời gian thực tế (actualTimeSpentMs) theo **Tỉ lệ (Ratio)** của duration từng chặng so với tổng thời gian gộp.
- *Ví dụ:* DV1(30p) + DV2(30p), làm hết 49p -> DV1 được 24.5p (13:15 -> 13:39), DV2 được 24.5p (13:39 -> 14:04).
- Việc này giúp Lễ tân hiển thị timeline cực kỳ tự nhiên, nối tiếp nhau mượt mà và đúng thực tế công sức KTV đã bỏ ra.

### 2. Gắn Cờ "Khóa Gộp" (Merge Lock Flag)
- Trong `handleStartTimer.ts` và `handleFinishService.ts`, gán thêm thuộc tính `isMergedRun: true` vào segment khi chúng được gộp. 
- Flag này được lưu cứng vào Database, trở thành dấu vết bất biến.

### 3. Sửa UI KTV Dashboard & Kanban Board
- **KTV Dashboard (`page.tsx`, `KTVDashboard.logic.ts`)**: Bổ sung cờ `isMergedRun` hoặc dấu hiệu "chung actualEndTime" vào logic `shouldMerge`. Dù KTV đã hoàn thành hay tải lại trang, giao diện vẫn gộp các dịch vụ này thành 1 Timeline duy nhất hiển thị tổng thời gian.
- **Kanban Board Lễ Tân**: Đọc cờ `isMergedRun` và "chung actualEndTime" để tịnh tiến thời gian chính xác, khắc phục triệt để lỗi (14:04 -> 14:04).

---

## 📂 Các file đã sửa đổi

### Backend (API)
#### [MODIFY] `handleStartTimer.ts`
Thêm cờ `isMergedRun = true` vào các segment khi "Merge Lock".

#### [MODIFY] `handleFinishService.ts`
Sửa vòng lặp gán thời gian `actualStartTime` & `actualEndTime` theo tỉ lệ (Proportional Allocation) + thêm cờ `isMergedRun = true`.

### Frontend (UI)
#### [MODIFY] `KTVDashboard.logic.ts`
Bổ sung `isMergedRun` và `isFinishedMerge` vào biến tính `shouldMerge`.

#### [MODIFY] `page.tsx`
Đồng bộ logic `shouldMerge` tương tự logic.

#### [MODIFY] `KanbanBoard.tsx`
Cập nhật điều kiện check `isMergeGoiDau` để nhận diện các ca gộp dựa trên `isMergedRun` hoặc `actualEndTime`.
