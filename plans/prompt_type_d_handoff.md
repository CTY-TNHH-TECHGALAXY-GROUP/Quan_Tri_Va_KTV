# Prompt bàn giao — Triển khai chế độ KTV TYPE_D

> Copy toàn bộ phần dưới đây gửi cho trợ lý tiếp theo.

---

Tôi cần bạn triển khai chế độ KTV mới **TYPE_D** cho dự án này.

## Tài liệu

- Kế hoạch đầy đủ: `plans/plan_che_do_type_d.md` — **đọc hết trước khi làm**, đặc biệt §14 (16 quyết định nghiệp vụ đã chốt) và §15 (checklist).
- Bảng giá đã chốt: `plans/bao_cao_bang_gia_type_d.md` — đây là nguồn đúng về công thức tính tiền.
- Schema DB: `TableInSupabase.md`

## Ràng buộc kỹ thuật ĐÃ KIỂM CHỨNG trên code + DB production (31/08/2026)

Đừng suy diễn lại mấy điểm này, đã xác minh rồi:

1. **`Staff.work_type` bị khoá bằng CHECK constraint** `CHECK (work_type IN ('TYPE_A','TYPE_B','TYPE_C'))` — constraint đang sống thật trên DB. Phải DROP rồi ADD lại kèm `TYPE_D` **trước mọi thứ khác**, nếu không seed tài khoản test fail ngay dòng đầu.

2. **Migration phải đặt ở `supabase/migrations/`**, không phải thư mục `migrations/` ở gốc (folder cũ, đã ngừng dùng từ 08/2026).

3. **Tên feature flag phải khớp `FEATURE_FLAG_DEFS`** trong `app/admin/settings/system/KtvFeatures.logic.ts`. Tên đúng là `laundry_deduction`, `bonus_wallet`, `savings_wallet`, `maintenance_fee`, `sudden_leave_penalty`. Đặt sai tên thì ghi vào jsonb vẫn thành công nhưng **không code nào đọc** → tính năng im lặng không chạy. Nhớ thêm nhánh `case 'TYPE_D'` vào `getDefaultFlagsForType()`.

4. **Quy ước key `_TYPE_D` chỉ áp dụng cho nhóm key đi qua `KtvCommissionService.getCommissionConfig()`** (deposit, bonus, shift bonus, bonus rate). Phí giặt đồ và phí bảo trì đọc key global bằng `.eq()` cứng (`laundry_fee` tại `app/api/ktv/attendance/route.ts:452`, `maintenance_fee_amount` tại `lib/services/KtvLedgerSyncService.ts:136-156`). §14 câu 14 đã chốt TYPE_D phải có mức phí **riêng** → phải sửa 2 chỗ đọc cứng này thành resolve theo `work_type`. **Đây là code dùng chung với A/B/C → bắt buộc test hồi quy phí của A/B/C.**

5. **Logic ví nằm ở service, không phải ở route.** `app/api/ktv/wallet/balance/route.ts` chỉ 31 dòng, gọi thẳng `lib/services/KtvWalletService.ts`. Sửa route là sửa nhầm chỗ.

6. **`KtvWalletService.getBalance()` tính số dư theo mô hình lai**: quá khứ đọc từ `KTVDailyLedger`, phần từ ngày cuối có ledger tới hiện tại thì **tính lại trực tiếp từ `Bookings` bằng `work_type` hiện tại**. Temporal tagging chỉ phủ được nửa đầu. Xem §2.2.

7. **`KTVDailyLedger` upsert với `onConflict: 'date, staff_id'`** — mỗi KTV chỉ 1 dòng/ngày, nên 1 ngày chỉ chứa được 1 giá trị `work_type_snapshot`.

8. **`TurnQueue` có `UNIQUE(employee_id, date)`** — dòng mới mỗi ngày, tạo lúc duyệt điểm danh (`app/api/ktv/attendance/confirm/route.ts:103`). Vì vậy §2.4 đã chốt **KHÔNG lưu giờ tích lũy lên TurnQueue**, mà JOIN sang `KTVServiceHoursLedger` lúc đọc.

9. **Không có auto-assign KTV ở bất kỳ đâu.** Lễ tân chọn tay; thứ tự sort chỉ là gợi ý hiển thị. `QuickDispatchTable.tsx:1142` hiện sort **trộn chung mọi loại KTV** theo `turns_completed` ASC — bắt buộc tách 2 danh sách riêng, nếu không luật xếp tua của TYPE_D mất hiệu lực trên thực tế. Có **23 file** đụng `turns_completed`.

10. **Heo đất không cần sửa cron.** `PiggyBank.service.ts` chỉ quét bảng `KTVPiggyBank` với `status='ACTIVE'`, mà sổ đó do Admin tạo tay. Chỉ cần không tạo sổ cho TYPE_D + đặt `savings_wallet: false` + ẩn tab.

11. **Cron mới phải khai báo trong `vercel.json`** (hiện chỉ có 3 entry). Vercel cron chạy giờ UTC và không hỗ trợ `L`.

12. **11 tài khoản test đã kiểm chứng**: NH001, NH002, NH011, NH014, NH016, NH018, NH021, NH025, NH027, NH069, NH079 — tồn tại đủ, đều `status = 'ĐANG LÀM'`, đều có avatar. Không có Staff nào id bắt đầu bằng `T` nên dải T001–T079 an toàn. Lưu ý NH027 và NH079 đang là TYPE_B (9 mã kia TYPE_A) → **đừng copy nguyên `feature_flags`**, ghi đè bằng defaults của TYPE_D.

13. **`.env.local` đang trỏ host pooler cũ** `aws-0-ap-southeast-1...`, phải đổi thành `aws-1-...` ở cả `DATABASE_URL` và `DIRECT_URL`, nếu không mọi script node chạy local đều fail.

## Bẫy cần tránh

Bốn lỗi nặng nhất tìm được ở khâu rà plan đều thuộc loại **"chạy không báo lỗi nhưng không có tác dụng"**: sai tên feature flag, sai quy ước key config, lưu số liệu tháng lên bảng theo ngày, và key config nằm chết không ai đọc. Khi code, với mỗi config/flag mới hãy tự hỏi: *đoạn code nào thực sự đọc cái này?* — rồi mở file đó ra xác nhận.

Thêm một bẫy nữa: TYPE_D dùng **thang 4 sao**, nhưng cột `Bookings.rating` là numeric 1–5 và dùng chung với TYPE_C (thang 5 sao). Giá trị `5` vẫn có thể lọt vào đơn của KTV TYPE_D. Bắt buộc viết `const d = table[rating] ?? 0;` — nếu để `undefined` lọt vào phép nhân sẽ ghi `NaN` thẳng vào ví KTV.

## Cần làm rõ trước khi bắt đầu

§14 câu 4 ghi **"ngày 1/9/2026 áp dụng"**, tức ngày mai tính từ lúc viết prompt này. Hiện chưa có dòng code TYPE_D nào và 2 bảng mới chưa tồn tại trên DB; riêng Phase 3 đã ước lượng 400–600 dòng logic lõi. Hãy hỏi lại chủ dự án: mốc 1/9 là ngày **áp dụng chính sách với nhân viên** (giai đoạn đầu tính tay, hệ thống theo sau), hay ngày **hệ thống phải chạy được**? Câu trả lời quyết định nên làm đủ hay làm tối thiểu trước.

## Thứ tự triển khai

Theo §13 của plan. Bắt đầu bằng §15 checklist, rồi Phase 0 (nhánh `feature/type-d-regime` + tài khoản test), Phase 1 (migration), Phase 2 (types/constants), Phase 3 (4 service class — phần lõi).

Làm xong mỗi phase thì chạy test và báo kết quả thật, kể cả khi fail. Đừng báo hoàn thành khi chưa verify.
