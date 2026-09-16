# Kế Hoạch Sửa Lỗi Hiển Thị Ví Tua & Hiểu Nhầm Tiền Giặt Đồ (KTV-Summary)

## 🔍 Phân Tích Vấn Đề
Vấn đề 'hiểu nhầm hệ thống chưa thanh toán tiền phạt 20k' xuất phát từ việc thiếu tính năng hiển thị **Số tiền dư từ tháng trước chuyển sang (Carry-over balance / Nợ Cũ)**.
Khi lọc dữ liệu của một tháng mới, thuật toán cũ chỉ hiển thị doanh thu và khoản phạt của tháng đó, nhưng lại giấu đi số dư cũ. Do đó, khi KTV dùng số dư cũ để thanh toán khoản phạt của tháng mới (thông qua việc rút tiền), Quản lý ở Quầy không thấy được sự cấn trừ này nên hiểu nhầm là khoản phạt chưa được thanh toán.

Đồng thời, cột 'Tiền khả dụng' bị lỗi hiển thị 0đ do hệ thống lấy Thu nhập trong kỳ trừ đi Tổng tiền đã rút (All Time).

## 🛠 Giải Pháp Triển Khai (Sổ Quỹ Kế Toán)

Chúng ta sẽ đập bỏ cách tính cũ và xây dựng lại công thức Sổ Quỹ hiển thị minh bạch từng đồng.

### 1. Nâng cấp thuật toán Backend (`app/api/finance/ktv-summary/route.ts`)
- Tính toán thêm trường `previous_balance` (Dư Nợ Cũ / Tiền dư tháng trước): Là tổng thu nhập trừ tổng đã rút **tính đến trước ngày `fromDate`**.
- Sửa lại trường `total_withdrawn` (Đã rút / Chờ): Sẽ **chỉ tính các lệnh rút nằm trong khoảng thời gian lọc** (thay vì lấy All Time như hiện tại).

### 2. Nâng cấp giao diện ở Quầy (`app/finance/ktv/page.tsx`)
Thay đổi các cột trên bảng thống kê để tạo thành 1 phương trình toán học hoàn hảo từ trái sang phải:

*   **[NEW]** Cột **'Nợ Cũ'**: Hiển thị `previous_balance`. (VD: `3.720.000đ` mang từ tháng 6 sang).
*   **[MODIFY]** Cột **'Tiền Tua'**: Hiển thị doanh thu trong kỳ lọc. 
*   **[MODIFY]** Cột **'Thưởng/Phạt'**: Hiển thị phạt trong kỳ lọc.
*   **[MODIFY]** Cột **'Đã rút (Trong kỳ)'**: Đổi tên từ 'Đã rút / Chờ', và chỉ hiện số đã rút trong kỳ lọc.
*   **[MODIFY]** Cột **'Tiền Khả Dụng'**: Công thức = `Nợ Cũ` + `Tiền Tua` + `Thưởng/Phạt` - `Đã Rút` - `Cọc`. Sẽ hiển thị chính xác số dư thực tế khớp 100% với App KTV.

## 🧪 Kế Hoạch Kiểm Thử
- Vào Admin Dashboard, lọc từ ngày 01/07 đến 13/07.
- Kiểm tra xem cột 'Nợ Cũ' có xuất hiện và hiển thị số tiền từ tháng 6 chuyển sang không.
- Kiểm tra cột 'Tiền khả dụng' xem có hiển thị đúng số dư hiện tại không, thay vì 0đ.
- Đảm bảo công thức toán học chạy ngang trên từng dòng KTV cộng trừ nhân chia khớp 100%.
