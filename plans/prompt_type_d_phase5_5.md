# 🛠️ PROMPT THỰC THI (EXECUTOR) - PHASE 5.5: ĐĂNG KÝ LỊCH, BÁO VẮNG, BÁO TRỄ (TYPE D)

**Chào Agent Thợ Xây, bạn được giao nhiệm vụ thực thi Phase 5.5.**
Nhiệm vụ của bạn là hiện thực hóa toàn bộ nghiệp vụ trong file `plans/plan_type_d_bao_vang_bao_tre.md`. Hãy làm theo từng bước một cách cẩn thận và hỏi ý kiến User (hoặc xin duyệt) trước khi thay đổi diện rộng.

## 📜 TÀI LIỆU CẦN ĐỌC TRƯỚC KHI BẮT ĐẦU
1. **`plans/plan_type_d_bao_vang_bao_tre.md`**: Đọc thật kỹ Mục 12, 13 và 14 để nắm rõ quy tắc chốt mới nhất từ Chủ dự án.
2. **`TableInSupabase.md`**: Kiểm tra cấu trúc DB hiện tại và tuân thủ nguyên tắc thiết kế database. Không giả định bất cứ bảng nào, phải check trước.
3. Tham khảo qua `app/api/ktv/attendance/route.ts` để hiểu luồng điểm danh gốc.

---

## 🚀 CÁC BƯỚC TRIỂN KHAI

### BƯỚC 1: DATABASE & TYPES
1. **Migration SQL**: Tạo script SQL migration để thêm bảng `KTVDailyRegistration`. 
   - Đảm bảo có các cột: `id`, `staff_id`, `work_date`, `expected_time` (Giờ đăng ký đến tiệm), `registered_at`, `status` (`REGISTERED`, `OFF_REGISTERED`, `ABSENT_REPORTED`, `LATE_REPORTED`, `COMPLETED`), `absent_reported_at`, `late_reported_at`, `late_expected_time`, `late_report_count`, `check_in_at`, `penalty_applied`.
   - Cần có khóa `UNIQUE("staff_id", "work_date")`.
2. Cập nhật file `TableInSupabase.md` bổ sung tài liệu cho bảng mới này.
3. Cập nhật file kiểu dữ liệu TypeScript của Supabase (nếu hệ thống dùng tự sinh hoặc gõ tay, hãy search và cập nhật `supabase.ts` hoặc các file `types` tương ứng).

### BƯỚC 2: API ĐĂNG KÝ LỊCH & ĐIỀU CHỈNH
1. **API Đăng ký / Hủy lịch**: 
   - Bắt buộc đăng ký ngày mai: Chọn Đi làm (nhập `expected_time`) HOẶC Nghỉ (`OFF_REGISTERED`).
   - KTV được quyền **hủy tự do** (xóa/đổi bản ghi) trước 00:00 của ngày làm việc.
2. **API Điều chỉnh (Báo Vắng / Báo Trễ)** (chỉ chạy từ 00:01 của ngày làm việc): 
   - **Báo vắng**: CHỈ lưu mốc thời gian vào `absent_reported_at`. **TUYỆT ĐỐI KHÔNG TRỪ GIỜ PHẠT NGAY** (Theo chốt Mục 14).
   - **Báo trễ**: Lưu mốc thời gian vào `late_reported_at`, KTV nhập giờ đến dự kiến -> cập nhật `late_expected_time`. Giới hạn nút bấm này **1 lần/ngày**.

### BƯỚC 3: CẬP NHẬT UI KTV APP
1. **Màn `/ktv/schedule`** (Theo Mục 12): 
   - Tái sử dụng màn này để KTV TYPE_D có thể chọn Ngày và **Đăng ký đi làm (Nhập giờ đến) / Đăng ký nghỉ**.
2. **Màn `/ktv/attendance`**:
   - Hiển thị thông tin "Giờ đã đăng ký đi làm hôm nay" ngay trên UI.
   - Thêm nút **"Điều chỉnh"** (Mục 2).
   - Logic hiển thị trong Modal "Điều chỉnh":
     - *Trước 07:00*: Hiện cả 2 tùy chọn Báo Vắng & Báo Trễ.
     - *Từ 07:00 trở đi*: CHỈ còn tùy chọn Báo Trễ (Báo vắng bị ẩn).

### BƯỚC 4: LOGIC ĐIỂM DANH (CHECK-IN) & PHẠT ĐI TRỄ
1. Tìm và cập nhật endpoint duyệt/nhận điểm danh (có thể là `app/api/ktv/attendance/route.ts` hoặc logic tương tự).
2. Khi KTV check-in (có mặt tại tiệm):
   - Cập nhật `check_in_at` vào bảng `KTVDailyRegistration`.
   - Check xem KTV có đến trễ hơn so với `expected_time` hoặc `late_expected_time` (nếu có báo trễ) không?
   - Nếu trễ, lập tức kích hoạt `KtvTypeDDisciplineService` trừ **-5h** (Lỗi Đi Trễ) và lưu `penalty_applied`.

### BƯỚC 5: CRON JOB CHỐT SỔ (23:59)
1. Tạo một API Cron mới: `POST /api/cron/daily-absence-check` (lưu ý múi giờ VN / UTC).
2. Logic quét cuối ngày:
   - Quét toàn bộ KTV TYPE_D.
   - Bỏ qua các KTV có bản ghi điểm danh (check-in) hợp lệ trong ngày.
   - Đối chiếu với bảng `KTVDailyRegistration` để xét phạt các KTV KHÔNG ĐIỂM DANH:
     - Nếu đã bấm **[Báo Vắng] trước 07:00** -> Gọi service phạt **-5h** (`ABSENT_EARLY_NOTICE`).
     - Nếu đã bấm **[Báo Vắng] từ 07:00 trở đi** HOẶC **Không báo vắng** -> Phạt nặng **-10h** (`ABSENT_NO_NOTICE`).
   - **Đặc biệt (Khóa tài khoản)**: Các KTV không đăng ký làm, không đăng ký nghỉ, và cũng không đi làm trong ngày đó -> Đổi trạng thái KTV thành KHÓA TÀI KHOẢN (cần logic đánh dấu isActive = false hoặc đổi trạng thái để App chặn đăng nhập).

---

**⚠️ YÊU CẦU DÀNH CHO EXECUTOR:**
- Thực hiện từng bước một.
- Sau mỗi bước hoặc trước khi sửa file cốt lõi (như `attendance/route.ts`), hãy trình bày `.diff` hoặc kế hoạch sửa để hỏi User: *"Bạn có duyệt sửa file này không?"*.
- Tuyệt đối tuân thủ quy tắc "Không làm hỏng các luồng đang chạy ổn định". Code thêm logic mới cho TYPE_D không được ảnh hưởng đến A, B, C.
