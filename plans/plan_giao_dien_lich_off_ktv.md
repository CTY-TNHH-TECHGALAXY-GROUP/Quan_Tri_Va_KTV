# Refactor KTV Schedule Page

Mục tiêu: Đơn giản hoá trang lịch làm việc của KTV theo yêu cầu:
1. Đưa lịch (calendar) lên trên cùng và dùng chính nó để chọn ngày đăng ký OFF.
2. Loại bỏ hoàn toàn trường nhập "Lý do".
3. Xoá bỏ hoàn toàn tab "Cài đặt ca làm" (Shift Settings).

## Đề xuất thay đổi

### 1. `app/ktv/schedule/Schedule.logic.ts`
- **Xoá** toàn bộ logic liên quan đến `shift` (ca làm), `activeTab`.
- **Xoá** trường `reason`.
- Đổi state `dates` (array của form cũ) và `selectedDate` (single string của lịch) thành một state duy nhất: `selectedDates` (mảng các ngày được click chọn trên lịch).
- Hàm `handleSubmitOff`: Gửi mảng `selectedDates` đi với `reason` mặc định là `"Xin nghỉ"`. Sau khi gửi thành công thì xoá mảng `selectedDates`.

### 2. `app/ktv/schedule/page.tsx`
- **Xoá** `TabSwitcher` và `ShiftTab`.
- **Đưa `LeaveCalendar` lên đầu tiên**.
- Biến đổi cách tương tác với `LeaveCalendar`:
  - Khi KTV bấm vào một ngày trên lịch (từ hôm nay trở đi), ngày đó sẽ được đánh dấu (tô màu nổi bật).
  - Bấm lại lần nữa để huỷ chọn.
  - Phía dưới lịch sẽ hiện danh sách các ngày đã chọn và nút **"Gửi đăng ký OFF"**.
  - Đối với các ngày đã đăng ký OFF và được duyệt, lịch sẽ hiển thị màu xanh lá. Nếu đang chờ duyệt thì hiện màu vàng.
- Đồng thời, khi bấm vào một ngày, hệ thống vẫn sẽ hiển thị danh sách các KTV khác đang đăng ký OFF trong ngày đó (ở ngay bên dưới nút Đăng ký) để KTV biết trước tình hình nhân sự.

## User Review Required
- Bạn có muốn cho phép KTV chọn nhiều ngày cùng lúc trên lịch rồi bấm đăng ký 1 lần luôn không? (Ví dụ: click chọn ngày 12, 13, 14 rồi bấm Đăng ký). Theo đề xuất trên thì KTV có thể chọn nhiều ngày.
- Nếu KTV bấm vào ngày trong quá khứ (ví dụ ngày hôm qua), hệ thống sẽ chỉ hiển thị danh sách ai đã OFF ngày đó chứ không cho phép đăng ký. Bạn có đồng ý với logic này không?

Hãy phản hồi để tôi tiến hành code ngay nhé!
