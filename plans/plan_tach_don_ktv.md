# Kế hoạch xử lý Đa KTV trên 1 Dịch vụ (Đúng Insight Thực Tế)

## 1. Phân loại ngữ cảnh (Theo đúng thực tế vận hành)
Dựa trên phân tích, ta có 2 tình huống hoàn toàn khác nhau khi Lễ tân gán 2 KTV vào 1 dịch vụ:

- **Tình huống 1: Làm chung / Song song (VD: Dịch vụ 4 tay)**
  - Đặc điểm: 2 KTV bắt đầu cùng lúc, kết thúc cùng lúc.
  - Giải pháp: **Giữ nguyên như hiện tại (Không tách)**. Hai KTV dùng chung 1 `BookingItem` (lưu trong mảng `technicianCodes`). Chỉ cần 1 KTV bấm "Bắt đầu" thì KTV kia cũng tự động được cập nhật. Không phải bàn cãi.

- **Tình huống 2: Làm nối tiếp / Chia ca (VD: Đổi người giữa chừng)**
  - Đặc điểm: 1 dịch vụ chia làm 2 giai đoạn nối tiếp nhau. Ví dụ dịch vụ 120p, KTV 1 làm phần đầu (X phút), KTV 2 làm phần sau (Y phút). Bắt đầu và kết thúc ở các khung giờ khác nhau.
  - Giải pháp: **Tách dịch vụ (Split Service)**. Tách thành 2 dòng `BookingItem` riêng biệt (dòng 1 thời lượng X phút, dòng 2 thời lượng Y phút) để quan sát được trọn vẹn tiến trình trên Dispatch Board và KTV bấm nút độc lập.

## 2. Giao diện UX thông minh cho Lễ Tân (Theo gợi ý tự suy luận)
Thay vì bắt Lễ tân phải bấm nút chọn "Làm chung" hay "Làm nối tiếp" một cách cứng nhắc, hệ thống sẽ **nhìn vào số phút Lễ tân nhập** để tự động quyết định. Cách này là trực quan và dễ nhìn nhất.

- **Quy trình thao tác:**
  1. Khi Lễ tân kéo thả KTV thứ 2 vào một dịch vụ (Ví dụ Combo 90p), một Popup sẽ hiện lên: **"Phân bổ thời gian KTV"**.
  2. Mặc định, Popup sẽ điền sẵn full thời gian cho cả hai:
     - KTV 1: `[ 90 ]` phút
     - KTV 2: `[ 90 ]` phút
  3. Lễ tân có thể giữ nguyên hoặc sửa lại theo thực tế (VD sửa thành KTV 1: 30p, KTV 2: 60p).
  4. **Hệ thống tự suy luận khi bấm Lưu:**
     - **Nếu thời gian nhập = Full thời gian dịch vụ (VD: KTV1 90p, KTV2 90p):** Hệ thống hiểu là 2 người **Làm chung**. Sẽ nhét cả 2 vào mảng `technicianCodes` của cùng 1 Item như logic hiện tại. 
     - **Nếu thời gian nhập khác nhau / chia nhỏ ra (VD: KTV1 30p, KTV2 60p):** Hệ thống hiểu là **Làm nối tiếp**. Sẽ tự động TÁCH dịch vụ này thành 2 dòng `BookingItem` riêng biệt (dòng 1: 30p gán KTV1, dòng 2: 60p gán KTV2, item sau giá = 0đ).

## 3. Implementation Plan
- **Bước 1 (UI Dispatch):** Thêm tính năng/Menu chuột phải "Tách ca KTV / Split Service". Thiết kế Popup nhập thời gian (số phút) muốn chia cho KTV mới.
- **Bước 2 (API):** Viết RPC/API `POST /api/dispatch/split-item` nhận vào ID của Item gốc và số phút chia `new_duration`. 
  - API sẽ cập nhật `duration` của Item gốc.
  - Tạo 1 Item mới (nhân bản) với `duration = new_duration`, `price = 0`, `technicianCodes = [ktv_moi]`.
- **Bước 3 (Timeline Kanban):** Đảm bảo UI Kanban vẽ đúng 2 thanh tiến trình nối tiếp nhau cho 1 dịch vụ.

---
> **Trạng thái:** Đã hoàn tất (Đã triển khai Popup và Server Action splitBookingItem).
