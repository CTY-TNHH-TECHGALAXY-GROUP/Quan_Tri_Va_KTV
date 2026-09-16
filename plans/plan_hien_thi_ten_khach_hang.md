# 🎯 Kế hoạch sửa lỗi Lịch sử đơn hàng KTV

**1. Sửa lỗi không xem được lịch sử từ 1/8 (Bug mới phát hiện)**
- **Nguyên nhân:** API Lịch sử KTV (`app/api/ktv/history/route.ts`) hiện đang bị gắn cứng `.limit(300)`. Khi bạn chọn khoảng thời gian dài (từ 1/8 đến nay có hơn 500 đơn toàn hệ thống), API chỉ lấy 300 đơn gần nhất rồi mới lọc ra đơn của KTV đó. Dẫn đến các đơn cũ bị cắt bỏ hoàn toàn.
- **Cách xử lý:** Bỏ giới hạn `.limit(300)` khi query theo thời gian, để KTV có thể lấy đầy đủ dữ liệu trong khoảng ngày họ đã chọn.

**2. Sửa hiển thị Tên Khách Hàng & Mã Đơn (Đã thống nhất)**
- Tại Lịch sử đơn hàng, hiển thị mã đơn đầy đủ (vd: `003-24082026-A`).
- Bổ sung `customerName` vào API, lấy đúng tên khách gốc từ DB (vd: `Quỳnh Như - Khách A`) để hiển thị dưới mã đơn. Nếu khách vãng lai không có tên thì để "Khách vãng lai".
- Trên Dashboard (phần Đang làm & Nợ bàn giao): Cắt bỏ đoạn chữ ` - Khách A` dư thừa, chỉ hiển thị đúng tên thật của khách (vd: `[Khách A] Quỳnh Như`).

> [!IMPORTANT]
> Đây là các file Cốt lõi (Core/Stable files) của ứng dụng KTV. Để mình tiến hành code khắc phục ngay 2 vấn đề trên, bạn vui lòng phản hồi đúng câu lệnh: **"Duyệt sửa file ổn định"** nhé!
