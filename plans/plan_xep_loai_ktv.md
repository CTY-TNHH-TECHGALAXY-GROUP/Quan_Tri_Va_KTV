# Kế Hoạch Đã Chốt: Bảng Xếp Loại KTV (KTV Ranking Dashboard)

Tính năng: Thêm một Tab "KTV" (hoặc "Nhân Viên") vào trang **Báo Cáo Doanh Thu** để xem xếp hạng thành tích, hiệu suất làm việc của toàn bộ KTV trong hệ thống (dành cho Quản lý / Kế toán).

## Vị trí (UI/UX)
- Nằm trong trang `app/finance/revenue/page.tsx`.
- Thêm một Tab mới bên cạnh "Phòng" có tên là "KTV" (Icon Users).
- Giao diện gồm 1 Dropdown để chọn **Tiêu chí xếp hạng**. KTV nào tốt nhất theo tiêu chí đó sẽ lên Top 1, Top 2, Top 3...

## Các Chỉ Số Hiển Thị & Công thức
1. **Doanh thu:** Tổng số tiền dịch vụ KTV đó mang lại.
2. **Tiền Tua:** Tổng tiền tua KTV nhận được.
3. **Thời gian làm việc TB / Ngày:** 
   - Công thức: `(Tiền tua / 100.000 VNĐ) / Số ngày công`.
   - Ví dụ: 10 triệu tiền tua / 100k = 100 giờ làm tua. Làm 25 ngày -> TB 4 giờ/ngày.
4. **Bonus:** Tổng tiền thưởng KTV đạt được.
5. **Ngày Công:** Số ngày đi làm (Status = PRESENT).
6. **Ngày Nghỉ:** Số ngày vắng mặt.
7. **Ca Tự Do / Khách Yêu Cầu:**
   - Phân tích từ các chuyến làm việc, chia làm 2 loại: Khách chỉ định (Yêu cầu) vs Hệ thống tự xếp (Tự do).

## Tiêu Chí Xếp Hạng (Dropdown Sort)
Người dùng có thể chọn một trong các tiêu chí sau để sắp xếp danh sách (từ cao xuống thấp hoặc ngược lại tuỳ tiêu chí):
- **Doanh thu cao nhất** (Mặc định)
- **Tiền tua cao nhất**
- **Ngày công nhiều nhất**
- **Ngày nghỉ nhiều nhất / ít nhất**
- **Giờ làm việc TB cao nhất**
- **Ca yêu cầu nhiều nhất**

## Cấu trúc File (Architecture)
- **Frontend:**
  - Cập nhật `app/finance/revenue/page.tsx` (Thêm state `activeTab = 'ktv'`).
  - Tạo Component mới `app/finance/revenue/components/RevenueKTVRanking.tsx` và `RevenueKTVRanking.logic.ts`.
- **Backend (API):**
  - Tạo `app/api/finance/reports/ktv-ranking/route.ts` để lấy và gộp dữ liệu từ nhiều bảng (Bookings, TurnLedger, KTVAttendance, KTVBonusLedger).
