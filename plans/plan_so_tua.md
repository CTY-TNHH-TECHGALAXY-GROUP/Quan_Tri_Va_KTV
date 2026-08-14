# Tối Ưu Bảng Sổ Tua: Quản Lý Người Châm Nước, Trạng Thái & Số Tua KTV

Nhằm đáp ứng yêu cầu linh hoạt trong việc vận hành, tối ưu hiển thị ở cả 2 màn hình Sổ Tua (Điều Phối & Quản Lý KTV) và đồng bộ sang thiết bị của KTV, dưới đây là kế hoạch triển khai chi tiết:

## Proposed Changes

---

### 1. Phân Quyền UI (TurnQueueBoard)

- **Kiểm soát tính năng sửa Số Tua**: Tính năng "Sửa số tua thủ công" sẽ bị **khóa** ở trang *Điều Phối & Giám Sát*. Nó sẽ **chỉ xuất hiện** ở trang *Quản Lý KTV*.
- Chúng ta sẽ thực hiện điều này bằng cách bổ sung thuộc tính `allowEditTurns` (Cờ phân quyền) vào component dùng chung `TurnQueueBoard`. Trang Điều Phối truyền giá trị `false`, trang Quản lý truyền `true`.

---

### 2. Cấu hình Backend & Logic (Sổ Tua)

#### [MODIFY] [TurnQueueBoard.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/components/shared/TurnQueueBoard/TurnQueueBoard.logic.ts)
- **State Người Châm Nước**: `waterRefiller` (lưu trữ thông tin KTV đang được gán).
- **Fetch Logic**: Tải cấu hình `daily_water_refiller` từ `SystemConfigs` khi load ngày mới và lắng nghe Realtime thay đổi.
- **Action 1 (Gán châm nước)**: Thêm hàm `assignWaterRefiller(employeeId)` để lưu/xóa thông tin vào `SystemConfigs`.
- **Action 2 (Cập nhật trạng thái & thời gian)**: 
  - Thêm hàm `updateKtvStatus(turnId, newStatus, estimatedEndTime?)`. 
  - Khi cập nhật thành `working` (Đang làm), hệ thống sẽ lưu luôn `estimated_end_time` xuống database (`TurnQueue`) để bảng Sổ Tua đồng bộ hiển thị sang màn hình VIP Menu.
- **Action 3 (Điều chỉnh Số Tua)**:
  - Thêm hàm `updateTurnsCompleted(turnId, newTurns)` để cho phép điều chỉnh thủ công số lượt phục vụ (`turns_completed`). 
  - Lắng nghe realtime sẽ tự động gọi trigger sắp xếp lại Sổ Tua dựa trên số tua mới ngay lập tức.

---

### 3. Giao diện Sổ Tua (UI của Lễ Tân)

#### [MODIFY] [TurnQueueBoard.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/components/shared/TurnQueueBoard/TurnQueueBoard.tsx)
- **A. Điều chỉnh Số Tua thủ công** (Chỉ ở trang Quản lý KTV):
  - Badge `"Đã làm X tua"` sẽ có thể click vào để nhập liệu (hoặc có icon nút chỉnh sửa ✏️).
  - Khi click vào, Lễ tân nhập số mới, sau đó bấm `Enter` để lưu. Sổ tua sẽ tự động nhảy KTV đó đến vị trí đúng.
- **B. Đổi Trạng thái KTV** (Áp dụng chung): 
  - Đổi Badge trạng thái hiện tại từ text tĩnh thành một **Nút bấm** (Dropdown).
  - Chọn `Đang làm`: Hệ thống mở hộp thoại Popup yêu cầu **nhập giờ xong dự kiến (VD: 15:30)** trước khi lưu.
  - Chọn `Sẵn sàng`, `Tạm nghỉ/Off`: Lưu trực tiếp và cập nhật DB.
- **C. Quản lý Người châm nước** (Áp dụng chung):
  - Bổ sung nút Icon 💧 bên cạnh tên của KTV.
  - **Mặc định**: Nếu chưa ai được gán, hệ thống hiển thị text `"Tua đầu: Kiểm tra châm nước"` chớp nháy cho người đứng số 1 hàng đợi.
  - **Ghi đè thủ công**: Lễ tân click icon 💧 của ai thì người đó sẽ nhận nhiệm vụ. Click lại lần nữa để huỷ gán (Reset về mặc định).

---

### 4. Đồng bộ sang Ứng dụng KTV (UI của KTV)

#### [MODIFY] [KTVDashboard.logic.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/dashboard/KTVDashboard.logic.ts) & [page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/ktv/dashboard/page.tsx)
- Hiện tại giao diện KTV chỉ hiển thị thông báo *tự động* dựa trên biến `isFirstInQueue`. 
- **Cập nhật Logic**: Đọc thêm `SystemConfigs` realtime để tạo biến `isWaterRefiller`.
- Biến này sẽ ưu tiên người được Lễ Tân gán thủ công (từ `TurnQueueBoard`), nếu không ai được gán thì fallback về `isFirstInQueue`.
- Hiển thị Cảnh báo châm nước to, rõ trên điện thoại của ĐÚNG KTV được phân công để họ biết việc.
