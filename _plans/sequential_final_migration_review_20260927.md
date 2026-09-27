# Kiểm tra cuối trước migrate tua nối tiếp

Ngày kiểm: 27/09/2026. Branch: `feat/sequential-two-slot-handoff-20260926`.
Bản chức năng trước lượt này: `ca367466`. Các bổ sung dưới đây nằm trong commit chứa báo cáo này.

## Kết luận

**GO để migrate DB test có đủ schema nền và nghiệm thu tích hợp.**
**Chưa GO cho DB vận hành:** chưa kiểm preflight trên DB đích, chưa chạy PostgreSQL nhiều connection/đủ trigger của DB thật, build với cấu hình DB test, Storage/realtime/push và giao diện hai tài khoản thật.

Chưa migrate Supabase, chưa sửa dữ liệu bill cũ, chưa merge/deploy production trong lượt này.

## Kết quả kiểm

| Phần kiểm | Kết quả / phạm vi |
|---|---|
| Regression | PASS 16 script + dispatch live guard + TypeScript |
| Migration chain | PASS cả 5 file đúng thứ tự trong PGlite, dùng trigger từ migration thật |
| Schema contracts bổ sung | PASS enum KtvAssignmentStatus, FK assignment → booking, unique employee/item và unique một ACTIVE/ngày |
| Quyền RPC | PASS 9 RPC có service_role EXECUTE, anon/authenticated không được gọi trực tiếp |
| Guard/audit | Hai trigger đúng tên, đang bật; stale revision bị chặn |
| 90 phút chia 45/45 | B 16:05 → 16:50; API/Dashboard/Timer/popup/backend từ chối lấy own minutes; catalogue vẫn 90 |
| Sửa lần 1/lần 2 | Chạy RPC redispatch thật sau full chain; B 35 → 40 phút, tên riêng và assignment cập nhật, revision tăng |
| Qua nửa đêm | B thuộc lịch service của booking, ISO sang ngày kế tiếp; sổ tua không rút mất dịch vụ khác |
| Pause/finish/cancel/swap | PASS 5 ca lifecycle; chọn rõ A/B/cả hai; không ghi đè giờ A đã xong |
| Nợ phòng | Huỷ người đã làm vẫn giữ bước bàn giao; ảnh/quota mới release; trả nợ không xoá đơn mới |
| Đường cập nhật trạng thái cũ | Chặn bắt đầu toàn ca nối tiếp, resume sai đường, huỷ/tạm dừng thiếu scope; lỗi đọc DB không ghi gì |
| Admin bắt đầu A | Test action thật với DB stub: chỉ ghi start A, B giữ nguyên; TurnQueue assigned của A chuyển working, giờ rảnh A tính theo own plan |
| Chất lượng source | git diff --check và ESLint actions.ts: PASS |

SQL preflight/postcheck được chạy kiểm cú pháp trên DB fixture. Đây không phải kết quả preflight của Supabase đích.

## Bổ sung trong lượt rà soát cuối

1. Thay test migration rời rạc bằng full chain, bỏ trigger giả tạo thêm; đưa enum/FK/ACTIVE unique thực vào fixture.
2. Sửa fixture nợ phòng: assignment cũ chuyển COMPLETED trước khi nhận ACTIVE mới, đúng quota/release hiện tại. Không bỏ unique index để cho hai ACTIVE.
3. Chặn đường cập nhật trạng thái chung chạy lệch luồng nối tiếp; từ chối start chặng đã bắt đầu/đã xong/đã thay, kiểm giờ đầu vào và lỗi đọc DB trước ghi.
4. Admin start có lọc đúng nhân viên, nhận cả TurnQueue assigned/ready; không tự kéo giờ B theo A.
5. Thêm hai file SQL chỉ đọc để kiểm schema nền và kiểm RPC/trigger/quyền sau migration.

## Thứ tự migrate

Chỉ áp file còn thiếu sau khi đối chiếu migration history và nội dung RPC của DB đích:

1. `20260925120000_live_sequential_handoff.sql`
2. `20260926120000_dispatch_edit_history.sql`
3. `20260926140000_ktv_finish_service_atomic.sql`
4. `20260927120000_sequential_operational_consistency.sql`
5. `20260927150000_sequential_scoped_lifecycle.sql`

DB trắng cần schema gốc và migration phụ thuộc trước đó; 5 file này không tạo đủ database.
Backup/snapshot DB được chọn trước rollout. Apply theo quy trình migration của project, không chạy lẫn từng đoạn SQL khi chưa xác minh kết nối. Sau apply, reload PostgREST schema cache (`NOTIFY pgrst, 'reload schema';`) nếu cần, rồi chạy postcheck trước bật app flow mới.

## Các bước bắt buộc trên DB test

1. Xác định đúng DB test và cấu hình app trỏ DB đó; chạy `sequential_migration_preflight_20260927.sql`: không thiếu cột, đủ hàm nền/role, đối chiếu uniqueness/index và migration history.
2. Áp các migration còn thiếu theo thứ tự trên, chạy `sequential_migration_postcheck_20260927.sql`: đủ 9 RPC, quyền đúng, hai trigger bật, không có hai ACTIVE cùng KTV/ngày.
3. Build/Preview với cấu hình DB test; test admin + A + B trên hai thiết bị/ba session thật.
4. Nghiệm thu 5 flow: A30/B30 từ mới; A60 sửa A30 rồi gán B; A làm trước B trống gán sau; B→C→B và sửa tên/giờ hai lần; nợ hai phòng/nhận đơn mới/trả nợ cũ. Kiểm thêm A xong B pause và popup finish/cancel từng người/cả hai.
5. Test thao tác đồng thời/stale popup, lỗi RPC/Storage, ảnh không tải được, realtime/push và refresh; xác minh UI không báo thành công khi DB chưa xác nhận.
6. Chạy `sequential_assignment_duration_audit_20260927.sql` đối soát bill 11NDK-004-26092026. Record NH018 17:35 không được tự sửa bởi migration; lập sửa dữ liệu riêng có phạm vi, giữ nguyên giờ thực tế.

## Giới hạn còn lại

- PGlite và DB stubs không chứng minh concurrency nhiều connection hoặc toàn bộ trigger/RLS của Supabase đích.
- Luồng huỷ cả hoá đơn nhiều dịch vụ và admin đổi trạng thái cũ vẫn ghi nhiều bước; không khẳng định toàn lô atomic. RPC lifecycle mới atomic cho một dịch vụ A/B. Cần chạy gate lỗi giữa bước/reload trên DB test.
- Chưa nghiệm thu bằng trình duyệt tương tác và thiết bị thật trong lượt này; HTTP 200 trước đó chỉ xác nhận demo tải được.
- Chưa chạy production build gắn DB test hoặc kiểm delivery push; không coi TypeScript PASS là build/preview PASS.

Không phát hiện lỗi còn tái hiện trong 16 regression gate hiện tại. Những phần chưa kiểm ở trên là điều kiện còn lại trước bật cho vận hành thật.
