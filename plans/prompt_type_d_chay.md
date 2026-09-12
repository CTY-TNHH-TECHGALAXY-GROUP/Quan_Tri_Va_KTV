# Prompt khởi động thi công TYPE_D

> Copy toàn bộ phần trong khung dưới, gửi cho anti.

---

Bắt đầu thi công chế độ KTV **TYPE_D** cho dự án này.

## Đọc trước khi làm (bắt buộc, theo thứ tự)

1. `plans/prompt_type_d_handoff.md` — bối cảnh + 13 ràng buộc kỹ thuật **đã kiểm chứng trên code và DB production**. Đừng suy diễn lại những điểm này.
2. `plans/huong_dan_thi_cong_type_d.md` — quy trình 9 phase, mỗi phase có mục Nghiệm thu. **Làm đúng theo file này.**
3. `plans/plan_che_do_type_d.md` — đặc tả đầy đủ. §14 là 16 quyết định nghiệp vụ đã chốt, §5.1 là công thức giá.

**Không dùng `plans/bao_cao_bang_gia_type_d.md`** — file đó tính theo công thức cũ, đã đóng dấu hết hiệu lực. Công thức đúng duy nhất nằm ở §5.1.

## Việc cần làm ngay

Chạy **Phase 0** và **Phase 1** theo hướng dẫn thi công:

- **Phase 0**: tạo nhánh `feature/type-d-regime`, viết migration, seed config, seed 11 tài khoản test.
- **Phase 1**: types & constants.

Hai phase này không phụ thuộc câu hỏi nào đang treo nên làm được ngay.

Làm xong Phase 0 thì chạy 3 câu SQL nghiệm thu trong hướng dẫn, dán kết quả thật ra cho tôi xem. Làm xong Phase 1 thì chạy `npx tsc --noEmit` và dán output.

**Dừng lại ở đó, báo cáo, chờ tôi duyệt rồi mới sang Phase 2.**

## Ba câu hỏi phải hỏi tôi trước khi vào Phase 2

Đừng tự quyết, cũng đừng hỏi ngay bây giờ — hỏi khi báo cáo kết quả Phase 0–1:

1. **Rate phổ thông**: giữ `1667` đ/phút (60p ra 100.020đ, lệch +20đ/giờ so với mức "100k/60p" trong quy chế, và mọi số tiền phổ thông sẽ lẻ đến hàng chục) — hay lưu `100000` rồi tính `phút × rate / 60` để 60p ra đúng 100.000đ? Vẫn nhân theo phút, không milestones, không làm tròn. VIP không bị vấn đề này (3.000 × 60 = 180.000 tròn).
2. **Mốc 1/9/2026** (§14 câu 4): là ngày áp dụng chính sách với nhân viên hay ngày hệ thống phải chạy được?
3. **§14 câu 16**: lỗi "nghỉ không đăng ký OFF" đang chịu 3 tầng phạt chồng nhau (−10 giờ + khoá tài khoản + 1.000.000đ). §2.3 và §5.3 nói cùng một lỗi hay hai lỗi khác nhau?

## Bốn điều không được làm sai

1. **PHASE 0 của migration phải chạy đầu tiên.** `Staff.work_type` đang bị CHECK constraint khoá ở 3 giá trị A/B/C — constraint này sống thật trên DB production. Không mở trước thì seed tài khoản test fail ngay dòng đầu.
2. **Migration đặt ở `supabase/migrations/`**, không phải `migrations/` ở gốc (folder cũ, đặt vào đó sẽ không được apply).
3. **Tên feature flag phải khớp `FEATURE_FLAG_DEFS`** trong `app/admin/settings/system/KtvFeatures.logic.ts:6` — đúng là `laundry_deduction`, `bonus_wallet`, `savings_wallet`, `maintenance_fee`, `sudden_leave_penalty`. Đặt sai tên vẫn ghi vào jsonb thành công nhưng không code nào đọc.
4. **Đừng đụng logic A/B/C** ở giai đoạn này. Chỉ Phase 4 mới được sửa code dùng chung, và khi đó bắt buộc test hồi quy.

## Cách báo cáo

Báo kết quả thật, kể cả khi fail — dán output nguyên văn. Không nói "đã xong" khi chưa chạy thử. Nếu gặp chỗ trong tài liệu mâu thuẫn nhau hoặc không khớp code thực tế, dừng lại hỏi thay vì tự đoán.
