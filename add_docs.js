const fs = require('fs');
let content = fs.readFileSync('components/shared/ScheduleBoard/ScheduleBoard.tsx', 'utf8');

const comment = `  /**
   * [TÍNH NĂNG ĐẶT LỊCH HẸN TRƯỚC (PRE-BOOKING)]
   * - Quản lý việc tạo nhanh lịch hẹn cho khách gọi điện/đặt qua fanpage.
   * - Tự động nhận diện Khách Cũ (kiểm tra SĐT trong bảng Customers).
   * - Khi Lễ Tân bấm vào Thẻ Lịch Hẹn -> Hệ thống tạo link trỏ sang Web Nội Bộ (qua biến NEXT_PUBLIC_WEB_NOI_BO_URL).
   * - Dữ liệu (Tên, SĐT, Email, Khách) được truyền qua URL, Web Nội Bộ sẽ autofill khi Thanh Toán.
   */\n`;

if (!content.includes('[TÍNH NĂNG ĐẶT LỊCH HẸN TRƯỚC')) {
    // Try to find the state declaration
    const target = 'const [preBookings, setPreBookings] = React.useState';
    const parts = content.split(target);
    if (parts.length === 2) {
        content = parts[0] + comment + target + parts[1];
        fs.writeFileSync('components/shared/ScheduleBoard/ScheduleBoard.tsx', content, 'utf8');
        console.log('Added docs');
    } else {
        console.log('Could not find target string');
    }
} else {
    console.log('Already documented');
}
