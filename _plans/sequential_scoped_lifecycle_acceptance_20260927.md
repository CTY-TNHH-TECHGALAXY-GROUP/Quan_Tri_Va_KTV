# Nghiệm thu thao tác A/B trên branch riêng

Branch: `feat/sequential-two-slot-handoff-20260926`.

## Đã sửa

- Kanban thể hiện nối tiếp A → B, giờ/tình trạng riêng; bấm hàng chưa gán B để mở điều phối. Icon đổi người thay chữ “Sửa B”; icon thùng rác bỏ nhân viên khỏi nháp khi được phép.
- Nhân viên đang làm bấm tạm dừng: dịch vụ tạm dừng, chỉ mở khoảng nghỉ cho người đang chạy. A đã hoàn thành không bị đổi sang tạm dừng khi B dừng. Tiếp tục giữ nguyên giờ bắt đầu thực tế.
- Kết thúc/huỷ bắt buộc admin chọn chỉ A, chỉ B hoặc cả hai. Không chọn sẵn. Huỷ có lựa chọn cộng giờ đã làm; chọn cả hai không cộng giờ có thể tước công A đã hoàn thành, với cảnh báo trước xác nhận.
- Đổi người giữ đúng slot, tên và mốc giờ A; người thay thế có giờ/phút riêng, không tự ghi giờ bắt đầu thực tế.
- Giữ mốc giờ đã ghi và lịch sử sửa. Snapshot/revision cũ bị từ chối; lỗi DB không báo thành công. Các thao tác của một dịch vụ commit trong một RPC.
- Huỷ người đã bắt đầu vẫn giữ phân công để dọn/bàn giao; tước công/tua là việc riêng. Ảnh hoặc quota nợ phòng hiện có mới cho giải phóng. Huỷ chỉ A khi chưa gán B vẫn cho gán B về sau, không khôi phục công hoặc lượt A đã đóng. Bàn giao không mở lại slot đã đóng, không ghi đè đơn mới đang làm. Người chưa bắt đầu/đã đổi ra không có quyền bàn giao lượt cũ.
- Demo dùng cùng helper nghiệp vụ; loại bỏ bản segments dư có thể khiến Kanban đọc trạng thái cũ. Tài khoản bị huỷ sau khi làm vẫn thấy giờ riêng và trách nhiệm bàn giao.

## Bộ kiểm tự động

Lệnh: `node scripts/test_sequential_branch.cjs`.

Kết quả: PASS 15 script, dispatch live guard và TypeScript. `git diff --check`: PASS. Demo local `/reception/dispatch/sequential-demo` trả HTTP 200.

| Ca lifecycle | Nội dung được xác minh | Kết quả |
|---|---|---|
| 1 | A tạm dừng/tiếp tục: đồng hồ trừ nghỉ; B không đổi; popup dùng snapshot cũ bị từ chối | PASS |
| 2 | A xong, B tạm dừng, kết thúc chỉ B: giữ A; chốt B tại giờ dừng; giữ bước bàn giao | PASS |
| 3 | Huỷ chỉ B không cộng giờ: giữ công A; tước công B; B vẫn bàn giao; thiếu ảnh/quota bị chặn; release không hồi về đang làm | PASS |
| 4 | Huỷ cả hai gồm A đã xong: giữ giờ đối soát, xử lý công theo lựa chọn; bàn giao giữ trạng thái huỷ; không xoá đơn mới đang phục vụ | PASS |
| 5 | Đổi B sang KTV ngoài loại C: đúng slot/giờ riêng; KTV không tồn tại rollback; người bị đổi ra không release; kết thúc chỉ A để B chờ | PASS |

Các gate trước đó còn kiểm: A30/B30; A full60 đổi A30 rồi thêm B; A trước/B trống chọn sau; B→C→B; chỉnh riêng tên/giờ hai lần và refresh; midnight; RPC lỗi; notification lỗi; own timeline của admin/A/B.

## Còn lại trước test vận hành thật

1. Checkout branch, chạy demo bằng dữ liệu localStorage ở 3 tab cùng browser profile: admin, `?account=DEMO-A`, `?account=DEMO-B`.
2. DB test phải có schema gốc và migration phụ thuộc. Áp các migration còn thiếu theo thứ tự; file mới là `20260927150000_sequential_scoped_lifecycle.sql`. Chưa áp migration nào vào Supabase trong lượt này.
3. Test PostgreSQL đủ schema/trigger với nhiều connection, auth/Storage, realtime/push và hai thiết bị thật. PGlite fixture và component/hook tests chưa xác minh những phần này.
4. Huỷ cả hoá đơn nhiều dịch vụ vẫn theo các transaction từng dịch vụ của luồng cũ; không khẳng định toàn hoá đơn atomic. RPC mới bảo vệ cặp A/B của một dịch vụ.

Chưa nghiệm thu giao diện bằng trình duyệt tương tác; HTTP 200 chỉ xác nhận trang local tải được. Chưa merge hoặc deploy production.

## Bổ sung ca NHS1006 90 phút chia T016/NH018 45/45

- Báo cáo DB do người dùng cung cấp được dùng làm ca tái hiện; chưa truy vấn hoặc sửa DB thật của bill này trong lượt hiện tại.
- API `handleGetBooking` trả duration theo các segment của chính tài khoản, chỉ dùng thời lượng gói khi không có segments. Có segments mà không có chặng của tài khoản hoặc phút bằng 0 thì không fallback về 90/60.
- Dashboard/Timer và popup chọn dịch vụ từ chối dùng cùng helper. Backend từ chối loại D loại bỏ chặng đã thay/huỷ, dùng phút được gán; thiếu dữ liệu hợp lệ trả lỗi thay vì tính phạt theo gói.
- RPC điều phối ban đầu chuẩn hoá KtvAssignments và TurnQueue từ segment đã lưu trong cùng transaction; B 16:05 + 45 = 16:50, có xử lý qua nửa đêm khi chưa có ISO. Nếu nhân viên còn dịch vụ khác cùng đơn, sổ tua giữ khoảng phân công bao phủ các dịch vụ đó; không rút giờ dự kiến rảnh về riêng chặng vừa sửa. Gán/sửa B riêng tiếp tục dùng durationMinutes của B.
- Test tái hiện cố ý cho dispatcher cũ ghi 90 phút, sau đó kiểm RPC sửa về 45; chạy đoạn duration API thật, render Dashboard/Timer và bắt props popup; chạy đoạn tính phút backend từ chối thật.
- Record cũ 17:35 chưa được cập nhật tự động. File `sequential_assignment_duration_audit_20260927.sql` chỉ đọc để đối soát trước khi lập thao tác sửa có phạm vi; không thay giờ thực tế hoặc thời lượng danh mục 90 phút.
