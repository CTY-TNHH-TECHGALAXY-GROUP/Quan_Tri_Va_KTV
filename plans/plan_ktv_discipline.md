# Kế hoạch triển khai: Hệ thống Điểm Chuyên Cần KTV (FINAL)

## Tổng quan
Hệ thống cấp **100 điểm chuyên cần/tháng** cho mọi KTV (Loại A & B). Điểm bị trừ khi vi phạm (cài đặt được). 
- KTV Loại B: Xuống dưới 80đ → tự động giáng xuống Loại A. 
- KTV Loại A: Vẫn bị trừ điểm và lưu lịch sử (chế độ mở để quản lý hoặc áp dụng hình phạt khác trong tương lai).
Bổ sung cơ chế **Miễn Phạt** khi KTV đã làm việc liên tục quá ngưỡng cấu hình.

---

## PHẦN 1: QUY TRÌNH PHỤC HỒI / THĂNG CẤP LẠI (MỚI)

**Vấn đề**: Sau khi KTV Loại B bị giáng xuống Loại A, làm thế nào để họ lên lại Loại B?
**Giải pháp**: Sử dụng cơ chế **"Phục hồi thủ công bởi Quản lý"**.

1. **Tháng tiếp theo**: KTV (lúc này đang là Loại A) vẫn sẽ được hệ thống cấp quỹ 100 điểm mới. 
2. **Theo dõi và Đánh giá**: Trong tháng đó, Quản lý/Lễ tân sẽ theo dõi thái độ và điểm chuyên cần của KTV này. Nếu họ giữ được điểm cao và thái độ tốt, họ sẽ được cân nhắc thăng cấp lại.
3. **Thao tác Thăng cấp (Set bằng tay)**: 
   - Quản lý vào màn hình **Quản trị Nhân sự (Hồ sơ KTV)**.
   - Chỉnh sửa trường `Loại KTV` từ `Loại A` quay trở lại `Loại B` và lưu lại.
   - *(Hệ thống hiện tại đã có sẵn chức năng sửa Hồ sơ này, không cần code thêm, chỉ cần Admin nắm rõ quy trình vận hành).*

---

## PHẦN 2: DATABASE

### 2.1. Bảng `KTVDisciplinePoints` (ĐÃ TẠO)
Lưu quỹ điểm theo tháng. Mỗi tháng mới → Lazy init 100đ.

### 2.2. Bảng `KTVDisciplineLedger` (ĐÃ TẠO)
Sổ cái ghi lại từng lần trừ điểm — minh bạch 100%. Bất kể Loại A hay B đều ghi nhận vào đây.

### 2.3. Config keys trong `SystemConfigs` (BỔ SUNG)
Thêm 4 key mới vào bảng `SystemConfigs` hiện có:

| Key | Giá trị mặc định | Mô tả |
|-----|-------------------|-------|
| `ktv_discipline_rules` | JSON (3 rules) | Danh sách lỗi & điểm trừ |
| `ktv_discipline_demotion_threshold` | `80` | Ngưỡng điểm để giáng chức |
| `ktv_continuous_work_gap_mins` | `30` | Khoảng cách để nối tua (phút) |
| `ktv_continuous_work_exempt_hours` | `4` | Giờ liên tục → miễn phạt |

---

## PHẦN 3: BACKEND (Service Layer + API)

### 3.1. `KtvDisciplineService.ts`
- Cập nhật logic: KTV Loại A và Loại B đều bị trừ điểm bình thường.
- Tuy nhiên, hàm `checkAndDemote()` chỉ thực thi lệnh đổi `work_type = 'TYPE_A'` nếu KTV đó đang là `TYPE_B`. 

### 3.2. Cảnh báo sát ngưỡng
- Khi điểm của KTV Loại B tụt xuống mức **sát ngưỡng** (Ví dụ: <= 85đ).
- Hệ thống sẽ bắn 1 Notification đẩy thẳng về App của KTV: 
  > ⚠️ "CẢNH BÁO: Điểm chuyên cần đang là 80/100. Vi phạm 1 lần nữa bạn sẽ bị giáng chức!"

---

## PHẦN 4: UI/UX (Chi tiết từng màn hình)

### 4.1. KTV Dashboard — Nút "Từ chối đơn"
- Text link: `Tạm thời không thể nhận đơn này?`
- Vuốt lên Bottom Sheet. Báo miễn phạt nếu đủ điều kiện "Làm quá sức", ngược lại cảnh báo trừ điểm.

### 4.2. KTV Dashboard — Cảnh báo "Vùng Đỏ"
- Widget Gamification (Thanh tiến trình).
- Nếu điểm của KTV <= 85đ: Dòng chữ đỏ đậm: **"CHÚ Ý: Bạn sắp rớt hạng!"** sẽ nhấp nháy trên Dashboard.

### 4.3. Admin Settings — Cài đặt thông số
Bổ sung Section "⚙️ Cài đặt Điểm Chuyên Cần" trong `features/page.tsx` cho 4 thông số.

### 4.4. Dispatch & Review Handover (Màn hình Lễ tân)
- Thêm menu 3 chấm để Lễ tân chọn "Nhận xét / Báo cáo sự cố".
- Thêm Toggle `Trừ điểm lỗi bàn giao` trong modal duyệt ảnh bàn giao.

---

## ⚡ Thứ tự triển khai

| Bước | Việc cần làm |
|------|-------------|
| 1 | Lưu plan vào `plans/plan_ktv_discipline.md`. |
| 2 | Code `calculateContinuousWorkMins()` và hàm Cảnh báo sát ngưỡng. |
| 3 | Khởi tạo 2 API Endpoints (`deduct`, `reject-order`). |
| 4 | Làm UI Admin Settings để cấu hình thông số. |
| 5 | Làm UI KTV Dashboard (Cảnh báo điểm, Widget Sức bền, Nút Từ chối). |
| 6 | Làm UI Lễ tân (Bảng Kanban, Modal Duyệt ảnh). |
