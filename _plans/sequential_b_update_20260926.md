# Cập nhật tên và giờ B sau khi A đã điều phối
Tiếp tục trên branch riêng, theo phê duyệt file ổn định đã có. Không migrate DB dùng chung.

## Diff dự kiến
```diff
- Giờ B giữ trong bStartDrafts riêng, không vào payload Lưu/Điều phối
+ Giờ B vào bản chỉnh của hàng B, cùng tên riêng B
- processDispatch bỏ dịch vụ nối tiếp đã gửi và trả lỗi
+ dịch vụ nối tiếp đã gửi dùng RPC khóa để cập nhật B/metadata; không chạy lại phân công A
+ Lưu nháp và Điều phối đều lưu tên/giờ B mới; Điều phối thông báo cập nhật cho B
+ Xác nhận nếu giờ B trước mốc kết thúc A; rollback cả lô nếu chưa xác nhận
+ giữ lịch sử, phiên bản, segment ID, assignment A và ledger/tua; chặn sửa giờ B đã bắt đầu
```

Kiểm thử: A gửi trước → gán B sau → sửa tên/giờ B → lưu/điều phối → reload → sửa lần 2; B nhận tên/giờ mới, A không đổi. Kiểm thêm overlap, dữ liệu cũ, B đã bắt đầu, metadata vẫn sửa được.

## Đã thực hiện
- Giờ B vào cùng payload với tên riêng B. Lưu thông tin giữ bản mới; “Lưu & điều phối B” lưu và gửi cập nhật B.
- DRAFT/DISPATCH dùng RPC khóa và kiểm phiên bản cho dịch vụ nối tiếp đã gửi. Không chạy lại phân công A; không đồng bộ tua toàn ngày khi chỉ sửa dịch vụ nối tiếp.
- Giữ segment ID B, ngày phân công hiện tại, assignment/tua/ledger A. Tính lại giờ kết thúc B từ thời lượng.
- B chưa bắt đầu được sửa giờ dự kiến. B đã bắt đầu vẫn sửa tên được; không đổi giờ dự kiến qua thao tác này.
- Giờ B trước mốc kết thúc A cần xác nhận; chưa xác nhận thì rollback cả cập nhật tên và giờ. Xử lý cả thứ tự điểm danh → overlap.
- Lịch sử thời gian/tên dùng trigger audit hiện có, bản lưu mới nhất là nền lần sửa sau; bản cũ bị từ chối.

## Kết quả kiểm thử
| Ca | Kết quả |
| --- | --- |
| A đã gửi, gán B sau, sửa tên/giờ B rồi Lưu | PASS: assignment B và tên B mới; A/tua/ledger giữ nguyên |
| Điều phối lại, reload, sửa B lần thứ hai | PASS: giữ bản gần nhất và lịch sử trước → sau |
| Gửi payload có revision cũ | PASS: từ chối, không ghi đè hoặc gửi thông báo thành công |
| B trước giờ kết thúc A | PASS: rollback khi chưa xác nhận; xác nhận mới lưu |
| B đã bắt đầu | PASS: chặn sửa giờ dự kiến; sửa tên riêng và điều phối lại được |

- `scripts/test_sequential_sql.cjs`: 12 kiểm tra SQL, 5 lịch sử, 5 cập nhật B đều PASS; chạy migration trong PGlite local.
- `scripts/test_sequential_flows.cjs`: 5 flow vận hành, 5 lịch sử UI và flow sửa B lần 1/lần 2/reload PASS.
- `scripts/test_sequential_inline_ui.cjs`: 5 ca inline, Kanban và tên riêng PASS.
- `scripts/test_sequential_b_redispatch.cjs`: 5 ca hàm server thật với Supabase/notification stub PASS; chỉ B nhận thông báo, kiểm thêm retry điểm danh rồi overlap PASS.
- `scripts/test_sequential_accounts.cjs`: 5 ca giờ/đồng hồ/tài khoản riêng A/B PASS.
- `scripts/test_dispatch_live_guard.ts`, `scripts/test_dispatch_actual_time.cjs`: PASS.
- TypeScript `tsc --noEmit --incremental false`: PASS. `git diff --check`: PASS.
- ESLint các component/helper sửa: 0 lỗi; còn 1 cảnh báo dependency `syncToServices` tại effect hiện có của QuickDispatchTable.

## Test local và giới hạn
- Demo: http://localhost:3001/reception/dispatch/sequential-demo
- Tài khoản: thêm `?account=DEMO-A` hoặc `?account=DEMO-B`.
- Demo lưu LocalStorage và hiển thị bản mới ở tài khoản tương ứng; không gửi notification ra hệ thống thật.
- Chưa migrate DB dùng chung. Đường server thật cần migration nối tiếp và migration `20260926120000_dispatch_edit_history.sql` đã cập nhật ở branch này.
- Các kiểm tra dùng component/hooks/SSR, hàm server với stub và SQL thật trong PGlite. Chưa kiểm thử E2E trình duyệt hoặc giao nhận push trên DB dùng chung.
