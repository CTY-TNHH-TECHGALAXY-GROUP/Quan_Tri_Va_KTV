# Báo cáo nghiệm thu nối tiếp A/B — 26/09/2026

## Kết luận

Code và demo local đạt các gate đã chạy. Đã sửa các lỗi còn sót tái hiện trong lượt nghiệm thu này. Chưa nghiệm thu môi trường vận hành thật: DB dùng chung chưa migrate; chưa kiểm realtime/RLS/push trên DB test đủ schema.

Branch: `feat/sequential-two-slot-handoff-20260926`, nền `2c71a214`. Plan: `sequential_acceptance_plan_20260926.md`; diff thực tế: `sequential_acceptance_implemented_20260926.patch`.

## Phần còn sót đã hoàn thành

| Lỗi | Sửa / bằng chứng | Kết quả |
| --- | --- | --- |
| Demo B → C → B có hàng B trùng, lấy giờ/tên/stamp lượt cũ | Tái sử dụng hàng; giữ segments lịch sử; merge stamp theo segment ID; phục hồi snapshot LocalStorage cũ | PASS flow/reload/history |
| Tên fallback nhân viên khác admin | Ưu tiên displayName hiện tại trước generatedDisplayName; AccountDemo dùng helper chung | PASS API/realtime/Dashboard/Timer/demo |
| Xác nhận overlap lan sang item/đơn con khác | RPC trả itemId; hỏi từng item; reset mỗi payload; chặn blanket boolean cho batch nhiều item | PASS SQL rollback và UI retry loop |
| PATCH bỏ qua lỗi Booking/shared SELECT/safety | Kiểm error/null và trả failure; không ghi tiếp sau lỗi | PASS 14 ca PATCH |
| Hoàn thành nhiều item có thể lưu một phần | RPC transaction all items + merged children + Booking status/updatedAt; khóa và kiểm snapshot; route không ghi đè kết quả atomic | PASS 7 nhóm SQL + handler + tích hợp trigger |
| Demo segment rỗng/voided dạng chuỗi vẫn được nhận | Predicate live chung | PASS accounts |
| RPC FINISH gặp BookingStatus enum | Populate record theo native type trước UPDATE | PASS fixture enum cùng migration nối tiếp/audit |

## Năm flow thực tế bắt buộc

1. Dịch vụ mới → A30/B30 → gửi cùng lúc → giờ riêng → A/B xong → đánh giá → DONE.
2. A full60 đã gửi → sửa A30 trước bắt đầu; A đang chạy dừng thực ở30 → B30 → DONE.
3. A làm trước/B trống → A xong vẫn chờ → gán B sau, giữ mốc A → DONE.
4. Đổi phút/người trong nháp → gửi → nhập giờ B → đổi B live → tài khoản bị thay bị chặn → DONE.
5. Hoàn thành sau A → hủy B chưa làm → chặn callback cũ → reload giữ kết quả → DONE.

Cả 5 PASS qua actual demo hooks; SQL kiểm phân công/ledger/tua tương ứng. Ngoài ra PASS returning B, tên riêng độc lập, lưu lần2 từ lần1, stale revision, midnight datetime và notification failure.

## Lệnh test đã chạy

- `node _plans/sequential_operational_audit_20260926.cjs`: các nhóm 6 lỗi ban đầu + atomic FINISH + PATCH.
- `node scripts/test_sequential_flows.cjs`: 5 flow và lịch sử/returning B.
- `node scripts/test_sequential_accounts.cjs`: 5 ca tài khoản A/B và guards/title.
- `node scripts/test_sequential_b_redispatch.cjs`: 5 redispatch và overlap từng item/đơn con.
- `node scripts/test_dispatch_actual_time.cjs`: thời gian thực và revision.
- `ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/test_dispatch_live_guard.ts`: PASS.
- `tsc --noEmit --incremental false`: PASS, 0 lỗi.
- ESLint 9 file TS/TSX thay đổi: PASS, 0 lỗi.
- `git diff --check`: PASS.

SQL dùng PGlite chạy migration thật trên fixture local; handler/component tests dùng source thật với DB/clock/transport giả lập. Đây chưa phải full Supabase integration. Ca tích hợp cuối chạy cả guard nối tiếp, audit history và atomic FINISH với BookingStatus enum: A xong chờ B, B xong cùng child CLEANING, revision/history đúng, stale bị chặn, retry không thêm lịch sử giả.

## Nghiệm thu trực quan Safari local

Demo `http://localhost:3001/reception/dispatch/sequential-demo` trả HTTP200 và tải giao diện. Đã thao tác:

- Chọn A: không có selector cách làm; có nút khung gạch đứt `+ Nối tiếp`.
- Nhập A30/60: gợi ý `Còn 30 phút · + Nối tiếp`; bấm mở hàng B trống.
- Gửi A khi B trống: Kanban có `Chưa gán B · + Điều phối`.
- Bấm nút Kanban: mở modal gán/sửa B; chọn và lưu B thành công.
- Đổi tên B thành `Nghiệm thu B · lần 1`, cập nhật và điều phối: Kanban/tài khoản B cập nhật, A giữ tên cũ.
- Mở riêng B: giờ `23:23 → 23:53`, tên riêng đã lưu. Mở A: giờ `22:53 → 23:23`, tên dịch vụ chung giữ nguyên.

Đây là smoke test trực quan một flow; 5 flow đầy đủ được kiểm tự động ở trên. Mẫu còn trong LocalStorage Safari để test tiếp.

## Các bước còn lại trước vận hành thật

1. Áp migration trên DB test riêng; chạy full migration chain/constraints/triggers/RLS. Cần RPC `ktv_finish_service_atomic` trước khi chạy FINISH của branch mới. RPC thiếu trả failure, không fallback ghi từng item.
2. Kiểm hai tài khoản thật cùng admin: realtime, retry sau cạnh tranh snapshot, notification INSERT và webhook/push đến thiết bị. INSERT thành công chưa chứng minh push đã giao.
3. Sau các gate DB test, quyết định migrate DB dùng chung và phát hành cùng code. Chưa merge/push/deploy ở lượt này.

## Giới hạn kỹ thuật còn biết

- Storage upload ngoài transaction PostgreSQL; DB lỗi sau upload có thể để ảnh chưa được tham chiếu. Không tự xóa khi transport lỗi vì transaction có thể đã commit nhưng response mất. Reconciliation Storage riêng nếu ảnh rác phát sinh đáng kể.
- Hai FINISH/dispatch cùng snapshot: một request có thể bị từ chối vì dữ liệu đã đổi; tải lại và thử lại giữ timestamp đã commit.
- Chưa thử mất kết nối sau DB commit trên Supabase thật; retry local SQL đã chứng minh không reset timestamp.
