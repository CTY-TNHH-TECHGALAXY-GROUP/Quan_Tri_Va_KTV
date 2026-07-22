# Phân tích Rủi ro & Chiến lược Triển khai (Hotfix Múi Giờ)

Bản phân tích rủi ro khi tiến hành thay đổi logic xử lý thời gian (`formatToHourMinute`, `getDynamicEndTime`) trên môi trường Production (Vercel) trong thời gian Spa đang vận hành (có KTV và Lễ tân đang dùng).

## 1. Phạm vi tác động (Impact Area)
Các sửa đổi nằm hoàn toàn ở **Tầng Logic / Giao diện (Logic & Presentation Layer)**, bao gồm:
- **Lễ tân:** File `KanbanBoard.tsx`, `page.tsx`, `dispatch-timeline.ts` (Hiển thị Lộ trình và Timeline).
- **Admin/Lễ tân (Server Actions):** File `actions.ts` (Chia chặng, thêm dịch vụ).
- **KTV (API Backend):** File `route.ts` (Truy xuất Lộ trình thực hiện cho màn hình KTV).

> **Lưu ý quan trọng:** Chúng ta KHÔNG thay đổi cấu trúc Database. Dữ liệu gốc trong DB (cột `timeStart`) vẫn luôn lưu ở chuẩn UTC/ISO. Do đó, **không có rủi ro mất mát hay hỏng dữ liệu**.

## 2. Các rủi ro tiềm ẩn khi Deploy trong giờ vàng (Runtime Risks)

| Rủi ro | Mức độ | Nguyên nhân | Hậu quả |
|--------|--------|-------------|----------|
| **Lệch pha Client/Server (Data Mismatch)** | Vừa | API Backend (`route.ts`) vừa deploy code mới trả về `11:15`, nhưng App trên máy KTV hoặc Lễ tân chưa kịp tải code mới (vẫn dùng hàm cũ tính ra `04:15`). | Màn hình Lễ tân có thể bị chớp/nhảy giờ liên tục; Timeline hiển thị không khớp thực tế cho đến khi tải lại trang. |
| **Lỗi Hydration (Next.js)** | Vừa | Giao diện Lễ tân (`KanbanBoard`) được render trên Server với code mới (`11:15`), nhưng Client/Trình duyệt vẫn chạy JS cũ. | Giao diện bị khựng nhẹ hoặc tự động reload lại trang một lần để đồng bộ. |
| **Nhảy số Timer của KTV đang làm** | Thấp | KTV đang trong chặng (Đang làm), timer dựa vào `actualStartTime`. | Vì timer đếm ngược dùng thời gian Epoch (UTC gốc) trừ đi thời gian hiện tại, nên bộ đếm lùi **vẫn chạy đúng từng giây**. Chỉ có phần Text "Lộ trình" (04:45) sẽ tự nhảy về đúng 11:45 ngay khi hệ thống đồng bộ lại. Không làm hỏng tiến độ ca làm. |

## 3. Đánh giá độ an toàn thuật toán
- Thuật toán mới dùng toán học tuyệt đối (`dVn = d.getTime() + 7 tiếng` và `h = h + m/60`) không sử dụng `.getHours()` của Server. Nó bảo đảm 100% không dính bất kỳ ảnh hưởng nào từ thiết lập múi giờ (Timezone) của môi trường Host (Vercel hay Máy trạm).
- Việc vòng lặp qua 24 giờ (`h = h % 24`) xử lý rất mượt các trường hợp **Ca làm đêm (Cross-midnight)**. Ví dụ: KTV bắt đầu lúc `23:30` và làm 60 phút, hệ thống sẽ tính ra `23:30 -> 00:30` chuẩn xác mà không gây ra lỗi Invalid Date.

## 4. Chiến lược triển khai an toàn (Mitigation & Deployment Strategy)

Do lỗi này khiến Lễ tân và KTV bị "mù thông tin" về giờ giấc chuẩn (gây rối loạn vận hành), việc **Hotfix ngay lập tức là cần thiết và an toàn**, với các bước kiểm soát sau:

1. **Deploy Background:** Việc đẩy code lên Vercel không làm gián đoạn hệ thống. Server cũ vẫn chạy cho đến khi Vercel build xong (khoảng 1 phút).
2. **Force Refresh:** Sau khi Vercel báo xanh (Deploy thành công), bạn chỉ cần thông báo Lễ tân: **"Nhấn F5 / Ctrl+R để làm mới bảng Lễ tân"**.
3. **KTV Dashboard:** Vì KTV App có cơ chế realtime (poll data liên tục), ngay khi API Backend trả về code mới, các con số Lộ trình của KTV sẽ **tự động** được điều chỉnh từ `04:45` thành `11:45` mà KTV không cần thao tác gì thêm.
4. **Không hỏng hóa đơn:** Do tiền và thời gian đếm ngược dựa vào Epoch tuyệt đối, việc sửa đổi hiển thị chuỗi text không tác động đến tài chính hay dữ liệu hóa đơn của khách.

**Tóm lại:** Rủi ro rất thấp. Hoàn toàn có thể (và nên) triển khai ngay trong giờ vận hành để giải quyết bức xúc hiển thị giờ giấc.
