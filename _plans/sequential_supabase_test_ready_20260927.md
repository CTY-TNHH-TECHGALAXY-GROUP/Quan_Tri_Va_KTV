# Supabase riêng đã sẵn sàng test

Project test: `eknggruuiuadwldacpmb`. Branch: `feat/sequential-two-slot-handoff-20260926`.
App local: http://localhost:3002/login — chạy từ worktree, đọc `.env.local` riêng.

## Đã thực hiện

- Xác nhận URL khác cấu hình thư mục chính; DATABASE_URL khớp chính project test.
- Preflight thật trong transaction READ ONLY: đủ cột, 4 hàm nền, index uniqueness, 3 role.
- Mốc preflight riêng của DB test: `2026-09-27T08:43:07.876Z` (15:43:07.876 VN). Không thay mốc production đã ghi nhận.
- Áp đúng 5 migration nối tiếp trong một transaction và ghi migration history. Postcheck đủ 9 RPC, quyền service_role, hai trigger bật, không duplicate ACTIVE.
- Lưu định nghĩa/ACL các public function trước migrate tại `/private/tmp/sequential-test-functions-before-eknggruuiuadwldacpmb.json`. Đây là bản chụp function, không phải backup toàn DB.
- Tạo 4 tài khoản `seq_admin`, `seq_a`, `seq_b`, `seq_c` trong Users và Supabase Auth; đăng nhập thật thành công.
- Tạo A/B/C TYPE_A, điểm danh CONFIRMED ngày test, TurnQueue waiting; một phòng, ba giường và hai dịch vụ test 60/90 phút. Giữ nguyên 44 dịch vụ có sẵn.
- Tạo 5 đơn `SEQ_TEST_ORDER_1` đến `SEQ_TEST_ORDER_5`, trạng thái NEW, chưa gán nhân viên; chọn ngày 27/09/2026 ở Kanban.
- Login/điều phối/API KTV local HTTP 200; truy vấn Booking của Kanban đúng schema.
- Server cũ cổng 3001 đã dừng để tránh cấu hình DB cũ/cache dùng chung.

## 5 ca PostgreSQL thật — PASS

| Ca | Kiểm |
|---|---|
| 1 | Đơn mới A45/B45; cố ý gửi giờ kết thúc B theo 90 phút; RPC sửa đúng B16:05–16:50, own minutes 45 |
| 2 | A60 từ đầu, sửa A30, mở nối tiếp và gán B30; assignment mỗi người 30 |
| 3 | A bắt đầu khi B trống; pause/resume A; gán B sau, giữ giờ thực tế A, B chưa có start giả |
| 4 | B→C→B; sửa riêng tên/giờ B hai lần; A không đổi; lưu revision cũ bị từ chối |
| 5 | A hoàn thành; B bắt đầu/pause/huỷ riêng B; A giữ nguyên; không release nếu thiếu ảnh/quota; release B có ảnh |

Các ca chạy trong transaction rollback, không để lại đơn `SEQ_AUTO_CHECK_*` và giữ năm đơn NEW cho test UI. Ca ảnh chỉ kiểm hợp đồng RPC với URL giả, chưa xác minh tải ảnh Storage.

## Tài khoản và chạy lại

Mật khẩu chung của bốn tài khoản test được sinh ngẫu nhiên, lưu ngoài repo trong:
`/private/tmp/sequential-test-accounts-eknggruuiuadwldacpmb.json`.
Không commit `.env.local`, mật khẩu hoặc secret key.

```sh
node scripts/setup_sequential_test_db.cjs
node scripts/setup_sequential_test_db.cjs --migrate --seed
node scripts/test_sequential_remote.cjs
npm run dev -- --port 3002
```

Hai script cố định project test và kiểm DATABASE_URL khớp; từ chối chạy trên project khác. Seed không reset đơn đã sửa; nếu chạy ngày khác, năm đơn ban đầu vẫn giữ ngày đã tạo.

## Chưa xác minh

- Không có browser automation khả dụng trong phiên này; HTTP 200 chưa chứng minh nghiệm thu UI.
- Storage upload, delivery realtime/push, thao tác hai thiết bị và concurrency nhiều connection vẫn cần test.
- Chưa chạy production build. Các kết quả này không thay thế điều kiện rollout production.
- Chưa thực hiện cơ chế giới hạn phiên bản theo T0 trên production; không migrate hay sửa dữ liệu production trong lượt này.
