# Kế hoạch áp dụng Time Cut-off cho Báo cáo Doanh thu

Vấn đề hiện tại: Báo cáo doanh thu đang chốt ngày theo mốc 00:00 - 23:59. Vì vậy, một đơn hàng hoàn thành vào lúc 01:00 sáng sẽ bị tính sang doanh thu của ngày hôm sau, thay vì tính vào ca làm việc của ngày hôm trước.

## Phân tích
Hệ thống đã có biến môi trường cấu hình `spa_day_cutoff_hours` (Giờ cắt ngày) trong bảng `SystemConfigs` (hiện tại đang là `6`, tức 06:00 sáng). 

## Phương án giải quyết

1. **Backend (API `/api/finance/reports/route.ts`)**:
   - Truy vấn `spa_day_cutoff_hours` từ bảng `SystemConfigs` ngay từ đầu.
   - Sửa hàm `startOfVnDayToUtc` và `endOfVnDayToUtc` để nhận `cutoffHours`.
     - Ví dụ: Ngày 17/07 với cutoff là 6h -> Bắt đầu từ `17/07 06:00` đến `18/07 05:59:59`.
   - Sửa hàm `getVnDateInfo` để nhóm dữ liệu:
     - Ngày (Date): Dịch lùi lại `cutoffHours` tiếng để nếu là `18/07 01:00` thì sẽ được nhóm vào `17/07`.
     - Giờ (Hour): Vẫn giữ đúng giờ gốc (01:00) để biểu đồ "Doanh thu theo giờ" hiển thị chính xác giờ thực tế khách tới.

2. **Frontend (`RevenueReport.logic.ts`)**:
   - Khi chọn các preset "Hôm nay", "Hôm qua", UI cần hiểu được khái niệm giờ cắt ngày.
   - Sẽ trừ đi 6 tiếng (mặc định) khi lấy ngày hiện tại: Nếu đang là 2h sáng ngày 18/07, UI sẽ tự động focus vào ngày 17/07 thay vì 18/07.

## User Review Required
> [!IMPORTANT]
> Phương án này sẽ thay đổi cách hiển thị doanh thu của mọi ngày. Đơn lúc 2h sáng sẽ chính thức được tính vào doanh thu của ngày hôm trước. Bạn xác nhận OK với logic này chứ?

## Các file cần sửa đổi
### [MODIFY] app/api/finance/reports/route.ts
Cập nhật logic lấy ngày và tính toán `cutoffHours`.

### [MODIFY] app/finance/revenue/RevenueReport.logic.ts
Điều chỉnh mặc định `getTodayVn` và `getYesterdayVn` lùi lại 6 tiếng.
