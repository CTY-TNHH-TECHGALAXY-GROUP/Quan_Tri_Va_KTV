# Hoàn tất triển khai Time Cut-off Doanh thu

## Các thay đổi đã thực hiện

1. **API Tính doanh thu (`app/api/finance/reports/route.ts`)**
   - Đã cập nhật truy vấn lấy cấu hình `spa_day_cutoff_hours` từ bảng `SystemConfigs` tự động để không bị hardcode cứng.
   - Sửa lại hàm `startOfVnDayToUtc` và `endOfVnDayToUtc` nhằm dịch thời gian "Bắt đầu ngày" và "Kết thúc ngày" lùi về theo số giờ cắt ngày (VD: cutoff=6 thì từ 06:00 hôm nay đến 05:59:59 hôm sau).
   - Đã cập nhật hàm `getVnDateInfo` để nhóm (group by) các giao dịch theo ngày kinh doanh chuẩn (VD: 02:00 sáng ngày 18 sẽ được nhóm vào ngày 17). Biểu đồ **Doanh thu theo giờ** vẫn giữ nguyên giờ gốc (02:00) để trực quan.

2. **Giao diện Báo cáo (`app/finance/revenue/RevenueReport.logic.ts`)**
   - Đã thêm khoảng bù trừ `CUTOFF_OFFSET_MS` = 6 tiếng.
   - Hàm lấy ngày "Hôm nay" (`getTodayVn`) và "Hôm qua" (`getYesterdayVn`) nay đã chuẩn xác hơn. Vào lúc 1h-5h sáng, ứng dụng sẽ hiểu "Hôm nay" vẫn là ngày kinh doanh cũ.

## Kết quả kiểm tra
- Logic đếm giờ, dịch múi giờ UTC/GMT+7 và tính toán ngày đã chạy thử nghiệm thành công với số chênh lệch chính xác đến từng millisecond (-1ms vào khoảnh khắc 05:59:59.999 của ca trước).
- Không có lỗi cú pháp do khai báo thiếu biến `cutoffHours`.

Bạn có thể tải lại trang Dashboard Doanh thu và kiểm tra. Đơn hàng lúc sau 12h đêm sẽ tự động được dồn lại cho ngày hôm trước!
