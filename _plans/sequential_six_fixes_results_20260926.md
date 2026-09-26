# Kết quả sửa 6 lỗi nối tiếp A/B — 26/09/2026

Branch: `feat/sequential-two-slot-handoff-20260926`, nền trước sửa `f206bfb8`.
Đã thực hiện bằng 4 sub-agent theo yêu cầu; root tích hợp, bổ sung ca đêm/metadata và chạy bộ kiểm tra chung.

## Phân công
| Agent | Phần thực hiện |
| --- | --- |
| runtime_segments | predicate segment còn hiệu lực, START, admin loader/Quick/Kanban, chặn thao tác từ B cũ |
| finish_persistence | FINISH kiểm lỗi DB, loại voided, giữ actualStart/End khi retry, test ghi một phần |
| employee_consistency | API GET, Dashboard/Timer, tên/options/realtime, client FINISH bắt HTTP/network lỗi |
| notification_delivery | INSERT notification trả kết quả, giữ tin cũ, saved-success warnings ở ASSIGN_B/DISPATCH |
| root | guard giờ qua 0h, metadata + datetime trong transaction, parser options dùng chung admin/nhân viên, tích hợp/regression/report/commit |

Giới hạn đồng thời 4 agent tính cả root: 3 sub-agent đầu chạy cùng root, agent notification thứ 4 khởi chạy khi finish_persistence hoàn tất.

## Đã sửa
| Lỗi | Kết quả |
| --- | --- |
| B → C → B hiện giờ/chọn chặng cũ | Runtime API và màn nhân viên chỉ dùng chặng còn hiệu lực; admin ưu tiên chặng mới, giữ chặng cũ cho lịch sử, không mở sửa từ B đã hủy |
| Hoàn thành bỏ qua lỗi DB | Handler trả lỗi đọc/ghi/sync; client bắt response thất bại hoặc HTTP/network exception, nhả loading/transition, không REVIEW giả; reload phần đã lưu |
| Inline 23:50 → 00:10 giữ sai ngày | Chặn thay đổi giờ có khả năng chuyển ngày, mở Sửa B datetime; SQL cũng chặn confirmOverlap bypass; ngày giờ đầy đủ lưu chính xác |
| Options JSON string làm tên fallback | Parser chung object/chuỗi/double JSON/malformed; API trả tên gốc và tên riêng đúng tài khoản; admin cũng dùng parser chung |
| Realtime giữ tiêu đề cũ | Tiêu đề derive từ options mới, kể cả post-service; xóa tên riêng về tên gốc, không điều hướng màn |
| Notification lỗi nhưng báo thành công trọn vẹn | Giữ dữ liệu đã lưu, giữ notification cũ; trả warnings “đã lưu, chưa tạo được thông báo” cho quầy; áp cả live B và phân công thường |

### Bổ sung bảo vệ metadata
Khi đang đổi tên/ghi chú B rồi mở Sửa B, payload ASSIGN_B chứa hai map metadata từ bản form hiện tại. RPC khóa/version-check lưu datetime và hai map trong cùng transaction. Không nhận status/history/actual stamps qua metadata. Bản cũ, metadata sai kiểu hoặc overlap chưa xác nhận không được ghi một phần.

## Kiểm thử đã PASS
- `scripts/test_sequential_live_segments.cjs`: actual START handler B quay lại, ảnh và actual stamp đúng lượt mới; A/chặng cũ giữ nguyên; người C đã bị thay không bắt đầu được.
- `scripts/test_sequential_finish_persistence.cjs`: lỗi đọc/ghi DB, sync item con, lỗi item thứ hai; reload/retry giữ timestamp đã lưu; A đợi B, Hoàn thành sau A, voided B, network.
- `scripts/test_sequential_employee_consistency.cjs`: options variants, case-insensitive own names/clear; Dashboard/Timer thật; actual realtime callback trên TIMER/REVIEW/HANDOVER/REWARD; actual client FINISH exceptions.
- `scripts/test_sequential_midnight_metadata.cjs`: handler modal thật gửi next-day ISO cùng tên/ghi chú chưa lưu, retry overlap giữ metadata; ngày sai/bản cũ giữ khả năng sửa.
- `scripts/test_sequential_notifications.cjs`: actual helper/action INSERT success/error/network/missing client, saved success + warnings, tin cũ còn; hai đường UI có cảnh báo.
- `scripts/test_sequential_inline_ui.cjs`: 5 ca inline, Kanban Chưa gán B, giờ/tên riêng; crossing midnight mở khung ngày và không ghi thay đổi vào draft cũ.
- `scripts/test_sequential_sql.cjs`: 12 ca SQL + 5 history + 5 update B và ca midnight/metadata; SQL thật trong PGlite.
- `scripts/test_sequential_flows.cjs`: 5 flow vận hành + 5 lịch sử UI + sửa B lần 1/lần 2/reload giữ bản mới nhất.
- `scripts/test_sequential_accounts.cjs`: 5 ca giờ riêng/đồng hồ/các tab và reload.
- `scripts/test_sequential_b_redispatch.cjs`: 5 server redispatch + notification warning + checkin rồi overlap.
- `scripts/test_dispatch_actual_time.cjs`, `scripts/test_dispatch_live_guard.ts`: PASS.
- `tsc --noEmit --incremental false`: PASS sau tích hợp cuối, gồm parser dùng chung và metadata modal.
- ESLint tất cả source chạm: 0 errors, 21 warnings (hooks/img hiện có). `git diff --check`: PASS.

Chạy các nhóm 6 lỗi bằng một lệnh:
```sh
node _plans/sequential_operational_audit_20260926.cjs
```
Các log error trong test lỗi DB/network là lỗi chủ động giả lập; assertion và exit status kiểm tra xử lý đúng, không phải kết nối tới DB thật.

## Giới hạn và triển khai
- Không migrate, merge, push hoặc deploy DB dùng chung. Đường server thật cần bản migration nối tiếp + `20260926120000_dispatch_edit_history.sql` đã cập nhật trên branch này.
- SQL test dùng PGlite/schema fixture, chưa chạy toàn bộ migration chain của DB thật. Auth/RLS, thiết bị nhân viên, Supabase realtime/webhook và push delivery còn cần kiểm thử tích hợp trên DB test riêng.
- CUA trả `No browser is available`; chưa thực hiện E2E trực quan hai tài khoản. Đã render component SSR, chạy hooks/callback và handler thật với DB stubs.
- Demo LocalStorage: `http://localhost:3001/reception/dispatch/sequential-demo`; tài khoản thêm `?account=DEMO-A` / `?account=DEMO-B`.
- FINISH nhiều item vẫn ghi từng item. Nếu item sau lỗi, item trước có thể đã lưu; response báo lỗi và client reload/retry, giữ mốc thực đã lưu. Chưa có transaction hoàn thành cả lô. Đây là giới hạn đã kiểm thử, không phải cam kết atomic.
- Notification INSERT thành công chỉ xác nhận tin đã lưu; không bảo đảm push đã tới thiết bị. Giữ tin cũ có thể khiến lịch sử chứa nhiều thông báo cập nhật; không xóa tin trước khi xác nhận INSERT.
