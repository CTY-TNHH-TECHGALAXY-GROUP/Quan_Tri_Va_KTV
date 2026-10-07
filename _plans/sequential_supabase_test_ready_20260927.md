# Supabase riêng đã sẵn sàng test

## Chỉnh thời lượng A đang làm ngày 27/09/2026

- Đã áp `20260927230000_adjust_running_sequential_duration.sql` trên project TEST. Nút “Giao trọn” bị loại bỏ; sửa số phút của A trong form rồi Lưu hoặc Cập nhật điều phối. B chỉ đóng khi số phút A đạt thời lượng dịch vụ từ `Services.duration` hoặc override `options.vipDuration` / `options.duration`.
- Kiểm thử rollback: dịch vụ 60 phút, A45 giữ B mở và A60 đóng B; dịch vụ 90 phút, A60 giữ B mở và A90 đóng B. Cả hai luồng Lưu/Điều phối cập nhật assignment và sổ tua; lỗi revision của dịch vụ khác rollback toàn bộ. PostgREST đã nhận `dispatch_commit_form`.
- Không ghi thay đổi lên `SEQ_TEST_ORDER_5` trong các ca kiểm thử tự động.

## Sửa START của KTV ngày 28/09/2026

- Ảnh `IMG_5904.png` là `SEQ_TEST_ORDER_2`, KTV `SEQ_TEST_B`: phân công mới `ACTIVE` nhưng `TurnQueue` vẫn trỏ `SEQ_TEST_ORDER_3` đã hoàn thành và bàn giao. Guard cũ từ chối mọi `current_order_id` khác, nên START trả thông báo chung.
- Đã áp `20260928010000_start_after_completed_queue.sql` trên TEST. START chỉ chuyển sổ tua sang đơn mới khi phân công đích còn `ACTIVE` và mọi chặng đã làm ở đơn cũ có giờ kết thúc lẫn bàn giao. Ca cũ chưa bàn giao tiếp tục bị chặn.
- Kiểm thử synthetic rollback qua cả nhánh chặn/cho phép, và mô phỏng START đúng `SEQ_TEST_ORDER_2` trong transaction rollback thành công. Không ghi giờ bắt đầu thật cho đơn này.

## Sửa lỗi RPC ngày 27/09/2026

- Lỗi Điều phối `SEQ_TEST_ORDER_5` do DB test mới ghi migration đến `20260927190000`, trong khi app gọi `dispatch_commit_form` ở `20260927200000`.
- Đã áp `20260927200000_dispatch_form_commit.sql` và `20260927210000_turn_queue_edits.sql` vào đúng project test `eknggruuiuadwldacpmb`; postcheck đủ 11 RPC, quyền service_role và hai trigger.
- Gọi RPC qua Supabase API với mã đơn giả trả `P0001 Không tìm thấy đơn`, xác nhận PostgREST đã nhận hàm. `SEQ_TEST_ORDER_5` vẫn `NEW`, revision 0; lần lỗi trước không điều phối nửa chừng.
- `node scripts/test_dispatch_form_remote.cjs` PASS trên DB thật với `dispatch_commit_form`; dữ liệu kiểm thử được rollback. Tải lại trang local rồi thử Điều phối đơn 5.

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

## Bổ sung sau khi test A only

- Phòng test có `prep_procedure=[]`, `clean_procedure=[]`; biểu thức `[] || DEFAULT` giữ mảng rỗng nhưng nút xác nhận lại yêu cầu checklist có ít nhất một mục. Sửa hook để mảng rỗng/không hợp lệ dùng quy trình mặc định: 5 mục chuẩn bị, 4 mục dọn phòng. Checklist riêng có cấu hình vẫn giữ nguyên.
- Thêm regression thực thi biểu thức thật trong hook; toàn bộ 17 script + live guard + TypeScript PASS.
- DB test thiếu toàn bộ bucket Storage. Bổ sung seed tạo bucket `attendance` khi chưa có, phục vụ ảnh bắt đầu/bàn giao theo handler hiện tại. Không reset đơn A đang test.
- Storage đã kiểm thực tế: upload PNG nhỏ, đọc public URL trả 200/đúng bytes, xoá chính ảnh probe thành công. Chưa xác minh toàn bộ luồng ảnh qua UI điện thoại.
- Theo yêu cầu hiển thị: helper tên KTV bỏ hậu tố thời lượng `(90P)`/`(45p)` ở tên dịch vụ (Dashboard, Timer, popup và API dùng chung helper). Giữ nguyên tên lưu trong DB và thời lượng từng chặng; regression render 90 chia 45/45 xác minh title không còn `(90P)` nhưng own minutes vẫn 45.
- B nối tiếp đã nhận đơn, A đã bắt đầu và cả hai cùng phòng: vào thẳng Timer để chụp ảnh dép/ảnh bắt đầu; khác phòng hoặc A chưa bắt đầu vẫn qua chuẩn bị phòng.
- Bỏ nút chữ `Lưu & điều phối B`; thêm icon Save từng hàng KTV. Server ghép đúng hàng đang lưu với bản DB mới nhất, giữ hàng còn lại và kiểm revision. Regression có trường hợp B đổi giờ/tên/ghi chú mà A không đổi, từ chối bản cũ và giữ giờ thực sau khi B bắt đầu.
- Sau A/B rồi đổi B thành C: đồng hồ C chưa bắt đầu giữ nguyên thời lượng chặng C, không tính từ `timeStart` của A. Regression gọi handler START của C với B cũ đã voided và xác minh ảnh/mốc bắt đầu chỉ gắn cho C.
- `+ Nối tiếp` sửa bản nháp trên màn quầy, không gọi RPC/tải lại đơn ngay. A và B được chọn/sửa cùng lúc; icon Save trên một trong hai hàng lưu cả cặp khi chưa điều phối, kể cả nháp DB còn nhân viên cũ hoặc revision cũ. Ca đang chạy bật nối tiếp/gán B khi bấm Save; nếu thao tác B cần xác nhận chồng giờ, bản nháp vẫn giữ nguyên. Chuyển tab/menu khi còn bản nháp hiện xác nhận bỏ thay đổi; refresh/đóng trang dùng cảnh báo gốc của trình duyệt. Kanban bỏ cặp nút Kết thúc/Huỷ ngoài thẻ, chỉ hiển thị cặp nút của trạng thái đã Dừng.

## Kiểm lại sau khi tiếp tục phiên

- Sửa regression Save cặp: kiểm cả icon A và B thay vì tìm nút đầu tiên theo cùng nhãn.
- Lưu cặp ca đang chạy nhận revision từ bản nháp và từ chối revision cũ trước khi bật nối tiếp/gán B. Nháp NEW/WAITING vẫn ghép với revision DB hiện tại.
- Khi bật nối tiếp thành công nhưng gán B cần xác nhận chồng giờ, cập nhật revision trên form trước khi hỏi. Huỷ xác nhận giữ nguyên hàng A/B và dấu chưa lưu; Save tiếp dùng revision mới. Regression thực thi cả server action và callback form, kiểm huỷ rồi lưu lại.
- Kết quả local: 18 script regression + live guard + TypeScript PASS; `git diff --check` PASS. Chưa nghiệm thu thao tác trực tiếp trên trình duyệt cho phần thay đổi này.
