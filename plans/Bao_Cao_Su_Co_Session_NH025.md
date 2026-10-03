# BÁO CÁO PHÂN TÍCH SỰ CỐ KỸ THUẬT (INCIDENT REPORT)
**Ngày báo cáo:** 12/07/2026
**Mã sự cố:** INC-20260711-KTV-SESSION
**Hệ thống ảnh hưởng:** KTV App (Mobile/Web) & Hệ thống Điều phối Lễ Tân

---

## 1. MÔ TẢ HIỆN TƯỢNG (SYMPTOMS)
Vào ca tối ngày 11/07/2026, KTV mang mã số **NH025** đăng nhập vào KTV App trên điện thoại. Khi Lễ Tân tiến hành thao tác điều phối đơn hàng và bấm "Xác nhận", hệ thống máy tính Lễ Tân báo thành công, Database có ghi nhận dữ liệu giao việc (Mã đơn: `11NDK-010-11072026` - lúc 19h41 tối). 

Tuy nhiên, **App KTV trên điện thoại của NH025 hoàn toàn không nhận được đơn (không ting ting, màn hình trống)**. Hậu quả là Lễ Tân phải bấm nút *"Bắt đầu làm (Thay KTV)"* thủ công trên máy tính để hệ thống tiếp tục chạy.

## 2. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE)
Sau khi trích xuất Database và phân tích luồng code, xác định sự cố xảy ra do **Lỗi dây chuyền 3 bước (Domino Effect)** xuất phát từ cơ chế cấp phát Session đăng nhập:

* **Mắt xích 1 - Khuyết thiếu Payload trong Session:** 
  Khi KTV đăng nhập thành công, API trả về dữ liệu User, nhưng module `auth-context.tsx` đã "quên" không trích xuất và đóng gói trường `code` (Mã KTV gốc) từ Database vào bộ nhớ Session lưu trên điện thoại.
* **Mắt xích 2 - Cơ chế Fallback (Dự phòng) sai lầm:**
  Tại màn hình Dashboard KTV (`KTVDashboard.logic.ts`), biến định danh `ktvId` được thiết kế để kết nối API và Realtime theo cơ chế: 
  `ktvId = user?.code || user?.name || ''`
  Do `user.code` bị rỗng (từ lỗi mắt xích 1), hệ thống tự động trượt xuống Ưu tiên 2: Sử dụng `user.name`.
* **Mắt xích 3 - Xung đột định danh (Identity Mismatch):**
  Trong lõi xác thực, `user.name` lại được định nghĩa là Ưu tiên lấy Họ tên thật (`fullName`). KTV NH025 đã cập nhật Họ tên thật trên hệ thống là **"Rose"**. 
  -> App KTV của NH025 lấy tên **"Rose"** để đi hỏi Server xem có đơn nào không. Trong khi Lễ Tân lại giao việc đích danh cho mã **"NH025"**. Hai mã định danh bất đồng nhất khiến Server chặn luồng dữ liệu, App KTV bị "mù" tạm thời.

> [!WARNING]
> Về mặt kỹ thuật, **lỗi này ảnh hưởng đến TẤT CẢ các nhân viên có điền trường `fullName` (Tên hiển thị)** (VD: NH021-Liễu, NH027-Sunny). Tuy nhiên sự cố chỉ được báo cáo trên NH025 do bạn này là người duy nhất chủ động theo dõi điện thoại, trong khi các KTV khác có thể đang nhờ Lễ Tân thao tác hộ hoặc giữ được session cũ chưa hết hạn.

## 3. GIẢI PHÁP KHẮC PHỤC (RESOLUTION)

### 3.1. Hành động đã thực hiện (Đã hoàn thành sáng 12/07)
* **Khắc phục lõi Session (Critical Fix):** Đội ngũ DEV đã bổ sung trực tiếp dòng `code: dbUser.code` vào đối tượng `finalUser` tại file `lib/auth-context.tsx`. Việc này ép App KTV luôn luôn tải chính xác Mã định danh gốc của hệ thống (VD: `NH025`), triệt tiêu hoàn toàn khả năng App đi lấy nhầm "Họ tên thật" để tìm đơn.
* **Chuẩn hóa Casing (Hotfix):** Bổ sung hàm ép kiểu `.toUpperCase()` tại Frontend (Dashboard KTV) và Backend (API Route) để đảm bảo dù KTV có lỡ lưu ID chữ thường trên thiết bị, hệ thống vẫn tự ép lên CHỮ IN HOA (CHUẨN), đảm bảo đồng bộ với Database.

### 3.2. Đề xuất hành động tiếp theo (Next Action)
* **Khóa lỗi Lễ Tân gõ tay (Input Sanitization):** Bổ sung hàm `.toUpperCase()` tại file `app/reception/dispatch/actions.ts` của Lễ Tân. Ngăn chặn triệt để trường hợp Lễ Tân gõ tay mã KTV (VD: `Nh025`) khiến Server từ chối lệnh giao việc như sự cố đã ghi nhận vào sáng 12/07.

## 4. BÀI HỌC KINH NGHIỆM (LESSONS LEARNED)
1. **Thiết kế API / WebSocket:** Cấm tuyệt đối việc sử dụng các trường dữ liệu có khả năng thay đổi (như Tên hiển thị, Nickname) để làm biến định danh (Identity / Channel ID) khi Query dữ liệu hoặc thiết lập kênh Realtime. Bắt buộc phải dùng Khóa chính (Primary Key) hoặc Mã nhân viên (Staff Code).
2. **Kiểm soát tính toàn vẹn (Data Integrity):** Luôn phải có bước *Sanitize Input* (Làm sạch dữ liệu đầu vào: Cắt khoảng trắng, Ép chữ in hoa) ở cấp độ Backend Route trước khi ghi xuống Database (PostgreSQL phân biệt hoa/thường nghiêm ngặt).
