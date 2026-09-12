# Kế hoạch Triển Khai: Bộ Lọc Mốc Doanh Thu Trên Biểu Đồ

## 1. Mục tiêu (Goal)
- Thêm chức năng cho phép Kế toán/Quản lý chọn các **Mốc Doanh Thu Mục Tiêu** (Ví dụ: 5 triệu, 10 triệu, 15 triệu, 20 triệu...) trực tiếp trên phần Biểu đồ Doanh Thu.
- Hệ thống sẽ tự động đếm và báo cáo có **bao nhiêu ngày (hoặc giờ/tháng)** trong chu kỳ hiện tại đạt hoặc vượt mốc doanh thu đó.
- Vẽ thêm một "Đường ranh giới" (Reference Line) ngang qua biểu đồ để có cái nhìn trực quan nhất về các ngày vượt mốc.

---

## 2. Các thay đổi dự kiến (Proposed Changes)

### 2.1 Cập nhật State Logic (`app/finance/revenue/RevenueReport.logic.ts`)
- Thêm state `revenueThreshold` (kiểu số, mặc định có thể là `null` hoặc `0` để không lọc).
- Cung cấp hàm `setRevenueThreshold` ra ngoài component UI.

### 2.2 Nâng cấp Giao diện Biểu Đồ (`app/finance/revenue/page.tsx`)
- **[MODIFY] file**: `app/finance/revenue/page.tsx`
- **Khu vực hiển thị**: Ngay dưới tiêu đề "Doanh Thu Theo Ngày" (cạnh cụm nút Giờ / Ngày / Tuần / Tháng), thêm một nhóm bộ lọc "Mốc Mục Tiêu":
  - Các nút hoặc Dropdown chọn nhanh: `Không dùng`, `5 Triệu`, `10 Triệu`, `15 Triệu`, `20 Triệu`, `30 Triệu`.
- **Logic đếm**: Nếu Kế toán chọn "15 Triệu", dùng lệnh lọc (filter) trên `chartData` đang hiển thị để đếm số cột có Doanh thu >= 15.000.000.
- **Khu vực báo cáo nhanh**: Sẽ hiện một dòng Text màu nổi bật: *"🎉 Chúc mừng! Có X ngày đạt mốc doanh thu trên 15,000,000đ trong kỳ này."*
- **Biểu đồ (Recharts)**: Bổ sung thẻ `<ReferenceLine y={revenueThreshold} stroke="#ff4d4f" strokeDasharray="3 3" label="Mốc Mục Tiêu" />` để kẻ một đường vạch ngang trên biểu đồ, nhìn vào là thấy cột nào cao hơn đường đỏ, cột nào thấp hơn.

---

## 3. Các câu hỏi cần anh xác nhận (Open Questions)

> [!WARNING]
> Anh cần duyệt qua một vài điểm nhỏ trước khi em tiến hành code:

1. **Các Mốc Cố Định**: Anh muốn em làm sẵn các mốc cố định nào? (VD: `5tr`, `10tr`, `15tr`, `20tr`, `30tr`, `50tr`) hay muốn làm 1 ô nhập số linh hoạt để mình tự gõ mốc tùy ý? (Em đề xuất kết hợp cả 2: Vừa có nút bấm nhanh, vừa có ô tự nhập).
2. **Kẻ Đường Ngang Biểu Đồ**: Việc em thêm một đường nét đứt màu đỏ hoặc cam nằm ngang biểu đồ tương ứng với mốc đã chọn có phù hợp với thẩm mỹ không anh? (Nhìn sẽ rất giống biểu đồ chứng khoán/KPI chuyên nghiệp).

---

## 4. Kế hoạch xác minh (Verification Plan)
- Mở trang Báo cáo Doanh Thu, chọn hiển thị "Theo ngày".
- Bấm chọn mốc 15 Triệu.
- Kiểm tra xem đường kẻ chỉ tiêu 15 triệu có hiện lên cắt ngang các cột không.
- Kiểm tra câu báo cáo: *"Có 4 ngày đạt mốc trên 15 Triệu"* xem đếm đúng số cột vượt đường đỏ không.
