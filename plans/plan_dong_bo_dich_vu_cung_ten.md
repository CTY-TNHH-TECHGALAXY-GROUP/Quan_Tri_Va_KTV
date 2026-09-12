# Kế hoạch tính năng: Đồng bộ nhanh các dịch vụ cùng tên (Khác thời gian)

**Vấn đề:** 
Hệ thống đang lưu các khoảng thời gian (60p, 90p, 120p) thành các dòng Dịch vụ riêng biệt trong Database. Tuy nhiên, nội dung dịch vụ (tên đa ngôn ngữ, mô tả, quy trình, tags) của chúng là hoàn toàn giống nhau. Việc phải sửa đi sửa lại bằng tay cho từng mốc thời gian là cực kỳ tốn công cho Admin.

## Giải pháp đề xuất: "Đồng Bộ Hàng Loạt" (Bulk Sync)
Thay vì gộp cấu trúc DB (sẽ ảnh hưởng rất lớn đến toàn bộ App, Lễ tân và App khách), ta sẽ làm một tiện ích ở màn hình chỉnh sửa:

1. **Thêm tuỳ chọn "Đồng bộ" ở Drawer Chỉnh sửa:**
   - Ngay trên nút "Lưu thay đổi" ở góc dưới cùng, sẽ có một ô checkbox: 
     `[x] Áp dụng các nội dung Ngôn ngữ, Mô tả, Quy trình & Tags cho tất cả dịch vụ cùng tên "[Tên DV]"` (Mặc định chọn).
   - Nếu check ô này, khi bấm Lưu, hệ thống sẽ tự động đem các trường cấu hình ngôn ngữ/thông tin để đè lên toàn bộ các dịch vụ có cùng gốc tên (vd: đè nội dung lên tất cả dịch vụ đang có tên VN là "Aroma").

2. **Các trường dữ liệu sẽ được đồng bộ:**
   - **Được đồng bộ (Giống nhau hoàn toàn):** `nameVN, nameEN, nameCN, nameJP, nameKR`, `description`, `service_description`, `procedure`, `tags`, `focusConfig`, `imageUrl`.
   - **Giữ nguyên (Tuỳ biến theo từng mốc thời gian):** `duration`, `priceVND`, `priceUSD`, `isBestSeller`, `isBestChoice`, `isActive`.

3. **Cập nhật Backend (`actions.ts`):**
   - Viết thêm hàm API Server Action xử lý gom nhóm và update dựa trên tên gốc `nameVN`.

## Đánh giá
Giải pháp này giải quyết 100% nỗi đau nhập liệu của Admin (nhập 1 lần ăn luôn cả 60p, 90p, 120p), lại cực kỳ an toàn vì không làm thay đổi hay phá vỡ cấu trúc cơ sở dữ liệu hiện tại đang vận hành ổn định.

## Open Questions
- Bạn thấy danh sách "Các trường được đồng bộ" (Ngôn ngữ, hình ảnh, tag, quy trình...) như vậy đã hợp lý chưa? Có muốn loại trừ hay bổ sung trường nào không?
