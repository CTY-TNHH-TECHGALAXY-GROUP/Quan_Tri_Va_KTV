# 🗺️ Ngan Ha Spa: Architecture & Technical Debt Roadmap v2

> **Ngữ cảnh:** Tài liệu này định hướng lộ trình tái cấu trúc hệ thống (Refactor) dựa trên việc phân tích các lỗ hổng phát sinh từ luồng KTV Review và cơ chế xác thực hiện tại. Mục tiêu: Tiến tới trạng thái **Production-Grade**.

---

## 🚀 Pha 1: Khóa lỗi và Ổn định (Sinh tồn)
**Trạng thái:** `HOÀN THÀNH` (Đã có phương án, đang test)

**Mục tiêu:** Xử lý dứt điểm tình trạng KTV bị kẹt ở màn hình Review/Handover do phụ thuộc vào state ảo của frontend và lỗi ghi dữ liệu rỗng.

- **Tách biệt Endpoints:** Tách luồng Đánh giá thành API chuyên trách (`POST /api/ktv/review`), không còn piggyback vào API cập nhật trạng thái đơn hàng (`PATCH /api/ktv/booking`).
- **Nguồn sự thật bền vững (Durable State):**
  - Chặn ghi đè dữ liệu (`segs = []`) khi parse JSON bị lỗi corrupt.
  - Tự động sinh `fallback segment` nếu thiếu dữ liệu, đảm bảo cờ `reviewTime` luôn có chỗ lưu.
- **Idempotent Retry:** Lợi dụng tính kháng lặp (Idempotent) của việc cập nhật `notes` và `reviewTime` để tự chữa lành (Eventual Consistency) nếu DB update dở dang.
- **Frontend Strict Guard:** Chỉ cho KTV chuyển màn hình khi `res.success === true`.
- **Test coverage:** Cần verify 4 cases (Có note, Không note, Segments rỗng, Segments corrupt).

---

## 🛡️ Pha 2: Tái cấu trúc nền tảng Auth & Security (Bảo vệ)
**Trạng thái:** `LÊN KẾ HOẠCH`

**Mục tiêu:** Xóa bỏ hoàn toàn "Technical Debt P0" liên quan đến việc lưu password plain-text ở client, giả danh user và hở sườn toàn bộ các API route do sử dụng `service-role` vô tội vạ.

### Lỗ hổng hiện tại:
- Hệ thống chỉ đang duy trì phiên bằng `localStorage`/`sessionStorage`.
- Không sử dụng JWT / HttpOnly Cookie, dẫn đến các API không thể xác minh danh tính người gọi.
- Server Actions đang so sánh trực tiếp password plain-text.

### Chiến lược Triển khai & Deliverables:
1. **Lựa chọn công nghệ:** Chuyển sang sử dụng **Supabase Auth (với SSR / Cookies)** thay vì tự build hệ thống session.
2. **Authorization Mapping (Auth User ↔ Business User):** 
   - **Mục đích:** Đảm bảo luồng KTV hiện tại (gọi `techCode: user.id` và lọc `BookingItems.technicianCodes`) không bị gãy khi chuyển sang ID của JWT.
   - **Giải pháp:** Cấu trúc lại bảng `public.Users`, thêm cột khóa ngoại `auth_user_id` map với `auth.users`. Trong giai đoạn chuyển tiếp, sử dụng username/email để thực hiện lookup (chuyển đổi ID Auth thành Business ID `techCode` như `NH016`).
3. **Server-side Authorization Matrix (Authentication vs Authorization):**
   - **Tách bạch tầng Auth:** Sử dụng Next.js Edge Middleware *chỉ để xử lý Authentication* (verify JWT session hợp lệ). Việc xử lý *Authorization (Ownership/Role)* bắt buộc phải nằm ở Route-level helpers (VD: `requireRole()`, `requireBusinessUser()`).
   - **Tuyệt đối không tin tưởng Client Body:** Các route như `/api/ktv/review` không còn đọc `techCode` từ body do client gửi lên. Mã `techCode` bắt buộc phải được derive (nội suy) từ quá trình lookup session mapping ở backend để đảm bảo Ownership (ông A không thể review hộ ông B).
4. **Compatibility Phase (Adapter pattern):** 
   - Không đập bỏ đột ngột để tránh gãy toàn bộ UI. 
   - Viết một Adapter ở `lib/auth-context.tsx` để UI vẫn đọc được `user.id`, `role`, `permissions` theo shape JSON cũ trong giai đoạn chuyển giao.
5. **Deliverable 1:** Viết Migration Script đồng bộ `public.Users` sang `auth.users` (tạo tài khoản, cấp lại password).
6. **Deliverable 2:** Triển khai cấu trúc Auth 2 lớp: Middleware chặn xác thực JWT toàn hệ thống `app/api/*`, và thư viện Helper Route-level (`requireRole`, `requireBusinessUser`) để enforce Authorization tại từng điểm cuối.
7. **Deliverable 3:** Xóa xổ hoàn toàn cột password dạng plain-text khỏi DB, loại bỏ flow gửi password từ server xuống frontend.

---

## 🏗️ Pha 3: Làm sạch Dữ liệu và Kiến trúc nâng cao (Mở rộng)
**Trạng thái:** `LÊN KẾ HOẠCH`

**Mục tiêu:** Đảm bảo tính ACID của cơ sở dữ liệu và dọn dẹp các mảng JSON phình to.

- **Chuẩn hóa Segments (Normalization):** 
  - Gỡ bỏ mảng JSON `segments` trong bảng `BookingItems`.
  - Thiết kế bảng riêng `BookingItemSegments` với schema chính thức (có `ktvId`, `actualStartTime`, `actualEndTime`, `feedbackTime`, `reviewTime`).
  - Lợi ích: Khai thác sức mạnh của Foreign Key, Indexing, ngăn chặn triệt để lỗi Parse Corrupt JSON.
- **Migration Runbook (Cho bảng Segments):**
  - Do `segments` đang được sử dụng realtime để tính toán trạng thái (actualEndTime, feedbackTime), quá trình tách bảng cần chiến lược Zero-Downtime Migration chặt chẽ:
    1. **Backfill:** Chạy script ngầm copy toàn bộ dữ liệu từ JSON `segments` sang bảng `BookingItemSegments` mới.
    2. **Dual-write:** API sẽ đồng thời ghi vào cả JSON cũ và bảng mới.
    3. **Read-switch:** Đổi các hàm truy vấn API (như tính time) sang đọc hoàn toàn từ bảng mới.
    4. **Cleanup:** Xóa bỏ cột JSON `segments` cũ sau khi hệ thống ổn định.
    5. **Rollback Plan:** Khôi phục về chế độ đọc JSON nếu có lỗi trong bước Read-switch.
- **Tích hợp Transaction / RPC:**
  - Viết các hàm Postgres RPC (ví dụ: `complete_ktv_step()`) để gom các nhóm update rải rác lại thành một thao tác duy nhất (Atomic Transaction), chấm dứt cảnh cập nhật dở dang.
- **Log / Metrics cho API:**
  - Bổ sung tracking cho các route trọng yếu (như Review, Handover, Release). Thay vì chỉ nhận được phản hồi "KTV bị kẹt", team dev có thể truy ngược đúng dòng lỗi ở API.
- **Audit toàn bộ Service Role:** Rà soát và giới hạn lại việc sử dụng hàm `getSupabaseAdmin()`. Các thao tác người dùng bình thường phải gọi qua client Supabase được khởi tạo với token của họ, kích hoạt Row Level Security (RLS) của Database.
