# Plan và giải thích diff — nối tiếp A/B, 27/09/2026

> Cập nhật sau yêu cầu commit để test: patch đã được áp vào source branch test. Trạng thái/kiểm tra ở các mục dưới ghi nhận lúc soạn đề xuất. Xem `sequential_branch_test_handoff_20260927.md` để có kết quả source thực và các bước chạy môi trường test.

## Trạng thái và phạm vi

- Nền: `bc06814f`, branch `feat/sequential-two-slot-handoff-20260926`.
- Đã soạn **patch đề xuất cho 14 file**, kiểm trên bản ứng viên trong `/tmp/sequential-deep-proposal-20260927`.
- **Chưa áp patch vào runtime source**, chưa migrate DB dùng chung, chưa push/merge/deploy.
- Patch: `sequential_deep_fixes_20260927.patch`. Sinh lại bằng `python3 _plans/build_sequential_deep_proposal_20260927.py`.
- Plan này thay thứ tự sửa trong audit lần 2 theo các quyết định mới của user. Audit cũ là bằng chứng trạng thái trước sửa, không phải danh sách yêu cầu còn nguyên sau quyết định này.
- Quyền API: **không thêm ràng buộc mã KTV với tài khoản đăng nhập** trong đợt này. Giữ gán tay và KTV ngoài. Không coi yêu cầu này là điều kiện chặn nghiệm thu đợt sửa này; cũng không ghi nhận vấn đề quyền cũ là đã được sửa.

## 1. Làm rõ bàn giao và nợ 2 phòng

### Quy tắc giữ nguyên

**Hoàn tất phần dịch vụ của KTV** khác **bàn giao/dọn phòng**, và khác **toàn đơn đã DONE**.

Ví dụ: A đã làm xong 30 phút; phòng chưa dọn, hoặc trong đơn vẫn còn B chưa làm. A có thể được giải phóng phần phân công đã xong để nhận đơn mới qua luồng bỏ qua bàn giao hiện có. Đơn/phòng cũ vẫn giữ phần việc/nợ tương ứng. Không yêu cầu cả Booking phải DONE mới giải phóng A.

Hạn mức nợ/bỏ qua hiện được xử lý bởi `HandoverService.skipHandover` và RPC `skip_handover_with_quota`. Patch **không thay hạn mức, không xóa luồng bỏ qua, không gắn tài khoản cho KTV ngoài**. Ca nghiệm thu cấu hình 2 khoản nợ phải vẫn nhận được phân công mới.

### Lỗi thực sự cần sửa

1. B chưa bắt đầu nhưng fallback hiện có vẫn đánh dấu assignment ACTIVE thành COMPLETED.
2. Chặng B cũ đã voided có thể bị dùng làm bằng chứng hoàn tất cho chặng B mới chưa làm.
3. Lỗi upload/UPDATE/promote bị bỏ qua; client nhận success, xóa ảnh và báo hết nợ dù chưa lưu đủ.
4. Trả nợ đơn cũ có thể gọi promote cho ngày đang thao tác, ảnh hưởng đơn mới thay vì đúng ngày của assignment cũ.

### Thay đổi trong diff

- `RELEASE_KTV` đi thẳng vào RPC giao dịch riêng; không chạy FINISH một lần nữa trước khi bàn giao.
- Chỉ chọn **chặng còn hiệu lực, đúng mã KTV, có actualStartTime và actualEndTime** trong booking cần bàn giao.
- Hoàn tất assignment theo `booking_id + booking_item_id + employee_id + segment_id`; không fallback đóng mọi ACTIVE khi không có bằng chứng.
- Assignment legacy thiếu segment_id chỉ được đóng nếu có đúng một chặng hoàn tất và không còn chặng mở của cùng KTV trong item.
- Không ảnh: chỉ giải phóng khi việc đã xong và đã dùng luồng SKIPPED có quota, hoặc chặng đã có bàn giao lưu trước đó. **Giữ SKIPPED/nợ; không tạo handoverTime giả.**
- Có ảnh: chỉ lưu PENDING sau khi tất cả upload thành công; ghi URL, feedbackTime và handoverTime vào đúng các chặng hoàn tất. Giữ ảnh của nhân viên khác và dữ liệu legacy của item.
- Cập nhật item, assignment, trạng thái booking và promote trong một transaction. Lỗi ở bất kỳ bước nào không trả success.
- Promote dùng business_date của assignment vừa đóng. Nếu đang có ACTIVE khác hoặc TurnQueue đang giữ booking khác thì không clear/promote booking đó.
- Nộp ảnh trả nợ đơn cũ không trả thưởng lần nữa; thông báo đổi thành “đã lưu ảnh, đang chờ duyệt”, tránh khẳng định đã được duyệt.
- Client giữ ảnh và màn bàn giao khi RPC thất bại/không xác nhận được commit.

Nếu “chưa hoàn tất đơn cũ” có nghĩa là **chưa dọn phòng/chưa đóng toàn booking**, luồng này vẫn được phép. Nếu chặng dịch vụ riêng vẫn chưa làm xong thì không được tự tạo mốc hoàn tất bằng RELEASE; thao tác bắt đầu/hoàn thành phần dịch vụ vẫn là bước riêng.

## 2. Làm rõ timeline và giờ sửa tay

### Hai vấn đề khác nhau

- Giờ gợi ý khi chưa nhập/lưu: hợp lệ, vẫn cho sửa tay.
- Sau khi lưu, màn nhân viên lấy mốc chặng đầu cộng duration để hiển thị chặng sau: sai vì bỏ qua giờ riêng của chặng sau.

Lỗi đã tái hiện: cùng nhân viên có chặng 1 bắt đầu 10:00/30 phút, chặng 2 thực tế bắt đầu 11:00/30 phút. Timeline cũ hiển thị chặng 2 thành 10:30–11:00.

### Hợp đồng hiển thị mới

| Thông tin | Nguồn ưu tiên | Khi không có |
|---|---|---|
| Giờ phân công từng chặng | plannedStartAt/plannedEndAt đã lưu; kế tiếp startTime/endTime đã lưu | Hiện “—”; không lấy giờ chặng khác |
| Giờ thực tế từng chặng | actualStartTime/actualEndTime của chính chặng đó | Chưa bắt đầu thì không hiện như đã làm |
| Kết thúc ước tính khi đang làm | actualStartTime riêng + duration hiện hành | Gắn rõ “dự kiến kết thúc” |
| Phiên gộp | Chỉ gộp khi START đã lưu isMergedRun và cùng mergedRunId/mốc phiên | shouldMerge gợi ý chưa đủ để gộp dữ liệu thực |

Ví dụ B được gán 10:30, sửa thành **11:15–11:45**, đã lưu; B thực tế bắt đầu 11:00:

- Admin và tài khoản B đều giữ **giờ phân công 11:15–11:45**.
- Timeline B hiện thêm **thực tế 11:00**, kết thúc thực khi có hoặc kết thúc dự kiến khi đang làm.
- Không dùng giờ A để thay giờ B, không ghi actual đè lên planned.
- Sửa tên/giờ lần 2 đọc bản lưu mới nhất, revision cũ bị từ chối và không ghi dữ liệu phụ.

Cho B bắt đầu sớm theo cơ chế đã duyệt vẫn giữ. Không thêm điều kiện buộc B chờ A hoàn tất. Xác nhận chồng giờ A/B vẫn áp dụng cho thao tác sửa kế hoạch như trước.

## 3. Ngày service theo đơn

- Không thêm ô chọn ngày A/B. Modal B đổi `datetime-local` thành `time`.
- Server lấy ngày từ `Bookings.bookingDate`, là ngày khách đến/ngày service; không lấy ngày đang thao tác hay Date.now.
- Gán sớm vẫn ghi ngày service tương lai của đơn.
- Nội bộ giữ ISO timestamp để phân biệt qua 0h. Quy tắc đề xuất: giờ B nhỏ hơn giờ bắt đầu A được hiểu là qua 0h của cùng lượt. Ví dụ A 23:50, B 00:10 → B ngày lịch kế tiếp, business_date vẫn ngày service của đơn.
- B trước giờ kết thúc A nhưng sau giờ bắt đầu A vẫn là chồng giờ trong ngày, giữ thao tác xác nhận chồng giờ.
- B sửa từ 00:10 về 23:55 với A 23:50 quay về đúng ngày service; không giữ nhầm ngày rollover của bản trước.
- RPC từ chối ISO thuộc ngày tùy ý khác lượt service. Kiểm overlap thêm theo khoảng timestamp, tránh bỏ sót assignment có business_date lệch do dữ liệu cũ.
- DISPATCH/DRAFT nhận ngày khớp ngày của đơn; ngày client lệch phải tải lại, không âm thầm điều phối sang ngày khác.
- Khi thiếu mốc A hợp lệ, yêu cầu sửa/lưu A; bỏ fallback Date.now của modal.

## 4. Thứ tự triển khai

### Bước 1 — Chuẩn hóa dữ liệu và giữ metadata

- Dùng parser segments chung ở GET, FINISH, Dashboard, Timer và logic nhân viên.
- UI không crash với JSON hợp lệ nhưng sai shape. Mutation không coi `{}` là “không còn việc”; phải từ chối dữ liệu sai. Null/empty của dòng phụ không gán người vẫn được xử lý như chưa có chặng.
- SQL unwrap cùng tối đa 2 lớp với client, giữ đúng tên tham số hàm cũ để migration CREATE OR REPLACE chạy được.
- Admin đọc notes từ parsedOptions, tra mã KTV nhất quán hoa/thường.
- Khi serialize tên/ghi chú, giữ giá trị nhân viên khác, chuẩn hóa alias của người đang sửa, và lưu chuỗi rỗng khi user chủ động xóa.

### Bước 2 — START/NEXT và FINISH

- START/NEXT đọc snapshot, chọn segmentId; hỗ trợ activeSegmentIndex cho client cũ.
- START lặp giữ mốc thực/ảnh đã lưu, không upload/lưu lại khi chặng đã bắt đầu.
- Chỉ ghi item có chặng thực sự đổi. NEXT hoàn tất chặng trước đã bắt đầu và bắt đầu chặng sau trong cùng transaction.
- Tái dùng `ktv_finish_service_atomic` cho kiểm snapshot/khóa/commit item; wrapper START bổ sung booking.timeStart và TurnQueue trong cùng giao dịch.
- Merge chỉ theo thao tác được lưu, cùng phòng, không kéo chặng đã bắt đầu/xong vào phiên mới; lưu mergedRunId.
- FINISH chỉ hoàn tất chặng đã bắt đầu; không suy “cùng phòng” thành phiên gộp; không đổi status item chưa bắt đầu.
- Không có chặng nào bắt đầu thì trả lỗi, client không chuyển REVIEW theo success giả.
- Chỉ mirror child không có công việc độc lập; child còn segment thật và terminal status giữ nguyên.
- Storage ngoài giao dịch DB: sau khi RPC đã được gọi, timeout không chứng minh rollback, nên không xóa ảnh có khả năng đã được DB tham chiếu. Cleanup ảnh mồ côi cần xác minh trạng thái commit trước.

### Bước 3 — RELEASE giữ nợ 2 phòng

Áp các quy tắc mục 1. Giữ quota hiện có; test riêng trả nợ booking cũ khi tài khoản đã nhận booking mới.

### Bước 4 — Điều phối và trạng thái tổng

- Hàm resolveGuestIdsForUpdate thành bước đọc/lập payload, không INSERT/UPDATE trước RPC.
- Guest mới, guest_id item, guestCount, guestUpdates và tạo dòng cuối TurnQueue đều nằm trong dispatch_apply_edit.
- Revision được kiểm trước các ghi nghiệp vụ này; lỗi RPC rollback toàn bộ.
- Cả DRAFT và DISPATCH dùng cùng hợp đồng. Không báo thành công nếu RPC trả data rỗng.
- Ngày theo mục 3, FINISH_AFTER_A recompute trạng thái booking trong cùng transaction.
- Giữ booking cha SPLIT/CANCELLED khi recompute; nghiệm thu đơn con phải theo cơ chế tổng hợp cha hiện có, không đổi cha SPLIT thành NEW chỉ vì item đã chuyển sang con.
- Tạo danh mục KTV ngoài từ NEW_EXT vẫn theo cơ chế hiện có; bản ghi danh mục có thể còn lại nếu điều phối bị từ chối. Không coi bản ghi danh mục này là một assignment đã lưu.

### Bước 5 — Nghiệm thu UI và DB test

Áp patch trên branch test riêng, migrate vào DB cô lập, chạy ma trận dưới đây trước khi đề nghị phát hành. Không fallback về các ghi từng item cũ khi thiếu RPC mới.

## 5. Các file trong patch

| File | Thay đổi chính |
|---|---|
| lib/ktvUtils.ts | Parser segments; đọc/lưu metadata theo mã; clock rollover |
| ScreenTimer.tsx | Parser; giờ planned/actual riêng; chỉ gộp phiên đã lưu |
| ScreenDashboard.tsx | Parser chống filter trên object |
| KTVDashboard.logic.ts | Parser ở các luồng; target item khi bàn giao; thông báo nộp ảnh |
| handleGetBooking.ts | Parser ở các nhánh GET/recovery |
| handleFinishService.ts | Chặn giả mốc; bỏ ghi item chưa bắt đầu; child có việc riêng |
| useDispatchBoard.logic.ts | Notes đã parse; tên/notes tra mã nhất quán |
| QuickDispatchTable.tsx | Giữ metadata người khác và explicit clear |
| dispatch/page.tsx | Modal time; bỏ now fallback; serializer metadata |
| handleStartTimer.ts | START/NEXT snapshot, idempotence, transaction |
| handleReleaseKTV.ts | Upload đủ ảnh, gọi RPC; lỗi không success |
| booking/route.ts | RELEASE trực tiếp; bỏ FINISH trước RELEASE |
| dispatch/actions.ts | Guest resolver không ghi sớm; chuyển guest/count/queue vào RPC |
| 20260927120000_sequential_operational_consistency.sql | Forward migration: parser, START/RELEASE, ngày B, trạng thái tổng, dispatch transaction |

Không sửa nội dung migrations lịch sử. Migration mới ghi đè các function cần sửa; các function RPC mới chỉ cấp EXECUTE cho service_role như atomic FINISH hiện có. Không thêm package/dependency.

## 6. Kiểm tra đã chạy trên bản đề xuất

Lệnh:

```sh
python3 _plans/build_sequential_deep_proposal_20260927.py
git apply --check _plans/sequential_deep_fixes_20260927.patch
node _plans/test_sequential_deep_proposal_20260927.cjs
/tmp/sequential-deep-proposal-20260927/node_modules/.bin/tsc --noEmit --incremental false -p /tmp/sequential-deep-proposal-20260927/tsconfig.json
```

| Nhóm | Đã kiểm | Kết quả |
|---|---|---|
| 1 | Parser shape/double JSON; sửa A giữ B; clear chủ đích; rollover; render WorkingTimeline thật dùng planned/actual riêng | PASS |
| 2 | KTV ngoài; 2 khoản SKIPPED còn nợ sau release; trả nợ cũ khi đơn mới đang làm không clear queue; chặn release chặng chưa bắt đầu | PASS |
| 3 | SQL START lỗi TurnQueue rollback item + booking; commit đầy đủ; handler START chỉ ghi item đã bắt đầu và retry không upload lại; RELEASE lỗi trả failure; FINISH thật không tạo mốc cho item chưa làm/child độc lập | PASS |
| 4 | Từ chối B ngày tùy ý; gán B đúng ngày service; Hoàn thành sau A đồng bộ Booking; replace helper SQL một lớp bằng hai lớp | PASS |
| 5 | DISPATCH bị từ chối rollback guestCount, khách mới, guest_id, TurnQueue; stale revision bị từ chối | PASS |

TypeScript toàn dự án trên overlay và kiểm tra patch áp dụng: PASS. Đây là **5 nhóm kiểm tra local có fixture**, không phải 5 phiên vận hành đầy đủ trên Supabase thật. SQL chạy PGlite với bảng/trigger phụ tối thiểu; một số RPC phụ được stub để tiêm lỗi. Render timeline dùng component thật, phần icon/motion được stub. Chưa chứng minh toàn bộ RLS, trigger, realtime và push deployment.

## 7. Bộ test bắt buộc sau áp patch

1. **Đơn mới 60 phút:** A 30 phút → gợi ý + nối tiếp → B trống → gửi A → bấm “Chưa gán B” trên Kanban → gán B → sửa tên/giờ B lần 1, lưu nháp/điều phối → sửa lần 2 từ bản lần 1. Refresh admin/A/B giữ đúng mỗi người; A không đổi tên theo B.
2. **A full rồi chuyển 50%:** A ban đầu full 60, sửa A còn 30, mở B; đổi B→C→B trước bắt đầu. Mỗi tài khoản chỉ chọn chặng live, không có giờ/tên của chặng voided; lịch sử còn đủ bản sửa.
3. **A làm trước chưa có B:** START retry/mạng chậm giữ ảnh và giờ; A hoàn thành, item vẫn chờ B; sau đó gán B hoặc bấm “Hoàn thành” sau A. Booking và item đồng bộ; B chưa làm không có mốc thực/tính công giả.
4. **Nợ 2 phòng:** hoàn tất phần việc, dùng quota bỏ qua, nhận đơn mới; nộp ảnh trả nợ đơn cũ trong lúc đơn mới TIMER. Queue/assignment/timer đơn mới không đổi; trả nợ không thưởng lại. Thử ảnh upload lỗi, UPDATE lỗi, promote lỗi, timeout sau commit; không báo hết nợ/xóa ảnh khi chưa xác nhận.
5. **Kỹ thuật/multi-item:** START chọn một item khác phòng, NEXT, phiên gộp, item thêm sau START, child độc lập, child CANCELLED/DONE, dữ liệu segments/options lỗi shape/double JSON, stale draft/dispatch và guest creation. Hoàn tất một phần không hoàn tất nhân viên khác.
6. **Ngày và qua 0h:** điều phối trước ngày khách đến, A 23:50/B 00:10, sửa B về 23:55, trả nợ sau cutoff ngày mới, assignment legacy sai business_date, đơn con. Ngày service theo đơn; ISO rollover đúng; không bỏ sót overlap theo khoảng thực.
7. **Đồng thời và đồng bộ:** hai tài khoản A/B cùng thao tác, admin đổi B cùng START, FINISH cùng rating/handover, retry và realtime đến sai thứ tự. Với full trigger/schema, không deadlock không xử lý được, không mất tên/giờ, không notification success giả.

Chạy lại bộ chuẩn hiện có: sequential_flows/accounts/b_redispatch/dispatch_actual_time/live_guard và bộ atomic FINISH/SQL; sửa fixture hợp lệ cho các hợp đồng mới, không nới assertion chỉ để test xanh.

## 8. Phần còn lại trước phát hành

- Áp patch vào branch test và xác nhận thứ tự migration trên DB cô lập có schema/trigger thật; refresh schema cache cho RPC mới.
- Chạy bộ nghiệm thu UI admin và hai tài khoản, đặc biệt ảnh bàn giao và phiên gộp cũ có timestamp legacy.
- Đo concurrency/lock với nhiều connection PostgreSQL; PGlite không thay kiểm deadlock thực.
- Xác minh push/realtime ngoài mạng ổn định. Rủi ro notification trùng/mất do crash sau commit chưa có ca tái hiện, nên chưa thêm outbox/idempotency hạ tầng vào patch này.
- Xác minh xử lý ảnh sau timeout và cleanup ảnh mồ côi; không xóa tự động khi chưa biết DB đã commit hay chưa.
- Chưa có kết luận “đã sửa hết/đủ điều kiện phát hành” chỉ từ bộ kiểm tra bản đề xuất.
