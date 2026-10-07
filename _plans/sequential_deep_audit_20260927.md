# Rà soát sâu lần 2 — nối tiếp A/B và các luồng liên quan

## Kết luận

**Chưa đủ điều kiện phát hành.** Bộ test nghiệm thu trước chứng minh các ca đã kiểm; chưa chứng minh mọi tổ hợp vận hành. Lượt này tìm thấy thêm 12 nhóm vấn đề có bằng chứng code hoặc tái hiện local, gồm sai trạng thái, tạo giờ thực chưa làm, mất metadata, phân công trùng và crash. Không thay đổi runtime source, không migrate hoặc gọi DB dùng chung trong lượt phân tích này.

Nền: `bc06814f`, branch `feat/sequential-two-slot-handoff-20260926`. Phạm vi: admin dispatch/save/assign, SQL nối tiếp/audit/atomic FINISH, GET/PATCH nhân viên, START/FINISH/RELEASE, Dashboard/Timer và demo. Không phải audit toàn hệ thống tài chính hay hạ tầng triển khai.

P0 = chặn phát hành do kiểm soát truy cập; P1 = có thể ghi dữ liệu sai/mất dữ liệu hoặc sai vận hành; P2 = crash/hiển thị sai trong điều kiện cụ thể. P2 không có nghĩa là được bỏ qua.

## Quy tắc ngày dịch vụ user chốt trong lượt audit

- Ngày trong đơn/ID là ngày khách sẽ đến, cũng là ngày service. Không thêm thao tác quầy chọn ngày A/B riêng.
- Gán trước ngày khách đến là điều phối sớm; ngày thao tác không được thay ngày service của đơn.
- Source hiện có `Bookings.bookingDate` (timestamp without time zone), dispatch board lọc theo trường này tại `actions.ts:237–240`. Khi sửa cần lấy ngày từ đơn ở server, giữ đúng đơn con/đơn cha; không suy từ Date.now, createdAt hoặc chỉ tin ngày client gửi.
- Quầy nhập giờ B. Timestamp có ngày vẫn cần lưu nội bộ để phân biệt 23:50 và 00:10 ngày kế tiếp trong cùng lượt; hệ thống tính rollover theo ngày service và mốc đã lưu. Việc này không yêu cầu user gán ngày mới.
- Vì vậy finding8 là lỗi cho payload/date lệch khỏi ngày service của đơn, không phải đề nghị cho phép gán B vào ngày tùy ý. Ngoại lệ qua 0h cần giữ đúng business-day của lượt, không coi mọi ngày khác đều hợp lệ.

## Các phát hiện

### 1. P0 — API nhân viên chưa gắn quyền thao tác với tài khoản đăng nhập

- `middleware.ts:67`: request API thiếu user chỉ log rồi vẫn cho qua.
- `app/api/ktv/booking/route.ts:68`: lấy technicianCode từ query/body, dùng admin client ở dòng73; không kiểm người gọi có phải nhân viên đó hoặc quầy có quyền.
- GET cũng nhận bookingId/techCode trực tiếp tại `_handlers/handleGetBooking.ts:43`.
- Schema ở `lib/schemas/ktv.schema.ts:107` kiểm hình dạng cơ bản, không thay thế xác thực/ủy quyền; status/action là string tự do, handler đọc các trường body gốc ngoài schema.
- Hệ quả trong repository: có thể đọc thông tin đơn khác hoặc gửi FINISH/RELEASE dưới mã người khác nếu biết ID/mã. Đây là thiếu kiểm soát có sẵn, không phải do atomic RPC mới tạo ra. Chưa thử request không đăng nhập trên deployment; chưa xác minh có lớp bảo vệ bên ngoài repository.
- Sửa ở ranh giới API: xác thực session, suy ra employeeCode từ session; admin override có permission riêng. Kiểm action/status/target IDs và chỉ dùng body đã validate. Không chỉ sửa UI.

### 2. P1 — START/NEXT chưa atomic, không idempotent và cập nhật sai item

- `_handlers/handleStartTimer.ts:270`: gán actualStartTime lại ngay cả khi đã có mốc, trên item thường trước khi bật nối tiếp.
- Dòng332–350 ghi từng item; lỗi item thứ2 để item thứ1 đã bắt đầu. Dòng335 đặt tất cả currentItems IN_PROGRESS dù item thứ2 không có actualStartTime và shouldMerge=false.
- Dòng371 và cuối handler bỏ qua error của child update/TurnQueue update; các SELECT trong handler cũng chưa kiểm hết error/null.
- Tái hiện: START hai dịch vụ khác phòng, chỉ chọn chặng0 → dịch vụ2 chưa bắt đầu nhưng IN_PROGRESS; lỗi TurnQueue vẫn trả handler thành công. Lỗi item2 → HTTP500, item1 đã lưu. START lặp trên A thường → mốc cũ bị thay bằng giờ request mới.
- Tác động: Kanban ghi đang làm dù chưa làm; timer/quầy/sổ tua lệch; retry có thể đổi giờ thực và ảnh minh chứng.
- Sửa: giao dịch START với snapshot/target segmentId; chỉ đổi item thực sự bắt đầu; request lặp trả mốc đã lưu. Đồng bộ child và TurnQueue trong cùng boundary hoặc trả cảnh báo chính xác.

### 3. P1 — FINISH tự coi dịch vụ chưa bắt đầu là đã làm

- `_handlers/handleFinishService.ts:149–182`: cùng phòng + nhiều item + chưa có end → tự merge, không đòi actualStartTime của mọi chặng và không dựa vào isMergedRun/ý định merge đã lưu.
- Tái hiện actual handler: item1 đã bắt đầu, item2 cùng phòng chưa bắt đầu → FINISH tạo actualStartTime/actualEndTime cho item2, chuyển CLEANING.
- Trường hợp chỉ có một item chưa bắt đầu: handler bỏ qua stamp nhưng vẫn trả bookingPersisted=true; `KTVDashboard.logic.ts:2187` chuyển REVIEW theo success, không kiểm lượt riêng thực sự đã xong.
- Tác động: chứng cứ thời gian/hoàn thành sai, khách mất phần dịch vụ, lịch sử và đầu vào tính công có thể sai. Atomic chỉ bảo đảm lưu cùng nhau; không bảo đảm logic nghiệp vụ đúng.
- Sửa: xác định tập segment thuộc phiên đang chạy; chỉ FINISH segment đã bắt đầu, merge theo dấu phiên đã lưu. Trả kết quả trạng thái riêng cho nhân viên; không chuyển REVIEW khi chưa hoàn tất lượt của họ.

### 4. P1 — Đồng bộ item con sao chép trạng thái cha, bỏ qua công việc riêng

- `_handlers/handleFinishService.ts:290–300` chép status parent vào mọi mergedIntoId child, không xét chặng riêng của B, status CANCELLED/DONE hoặc phần việc chưa làm.
- Tái hiện handler: cha của A hoàn thành; child có B chưa bắt đầu → child CLEANING nhưng không có actualStartTime.
- Với child nối tiếp còn B mở, guard SQL có thể từ chối cả transaction. Với child thường, có thể lưu trạng thái sai. Cần phân biệt child chỉ làm dòng phụ với child còn phân công thật; không dùng một quy tắc cho cả hai.
- Sửa: chỉ mirror các dòng phụ không có công việc độc lập; child có segment riêng tính trạng thái riêng và giữ terminal status.

### 5. P1 — RELEASE có thể giải phóng phân công chưa làm hoặc báo bàn giao thành công giả

- `_handlers/handleReleaseKTV.ts:69–84`: ktvMatchesSeg gồm cả voided; gán handoverTime cho chặng chưa bắt đầu/chặng cũ.
- Dòng119–139 hoàn tất theo itemId, không theo segmentId hiện hành; fallback đánh dấu ACTIVE COMPLETED khi không tìm thấy chặng hoàn thành.
- Dòng112/121/141 bỏ qua error của ghi item, ghi assignment, promote RPC. Handler resolve bình thường; route trả success, client có thể xóa ảnh tại `KTVDashboard.logic.ts:2420` và sang REWARD.
- Tái hiện: chỉ có B chưa bắt đầu → vẫn gửi COMPLETED assignment. Lỗi SELECT/UPDATE/RPC → vẫn resolve, promote vẫn được gọi. Fixture có voided B đã end + B mới → cả hai được gắn bàn giao và assignment item hiện tại bị hoàn tất; cấu hình này cần dữ liệu lịch sử/import, không phải đổi B đã bắt đầu qua RPC mới.
- Sửa: live + started + ended + đúng segmentId; không fallback giải phóng khi thiếu bằng chứng. Kiểm lỗi và transaction bàn giao/assignment/queue; chỉ xóa ảnh local sau xác nhận lưu đầy đủ.

### 6. P1 — Reload admin có thể mất ghi chú và tên riêng của người khác

- `useDispatchBoard.logic.ts:359,388`: đọc notes từ bi.options thô, trong khi options có thể là JSON string và parsedOptions đã có sẵn.
- Dòng360,389 tra serviceNamesForKtvs bằng khóa case-sensitive; helper nhân viên tra không phân biệt hoa/thường.
- Tái hiện: options JSON có ghi chú B → noteForKtv admin là rỗng. Khóa `demo-b` lưu tên B → nhân viên thấy đúng nhưng admin trường B trống; thao tác sửa tên A qua Quick thật tái tạo map và xóa tên B.
- Tác động: sai yêu cầu lực/ghi chú; đổi A có thể mất thông tin B, trái yêu cầu tên độc lập của user.
- Sửa: parse metadata chung và tra mã nhất quán; giữ các giá trị đã lưu khi serialize form. Kiểm cả clear chủ đích để không khôi phục tên đã xóa.

### 7. P1 — DISPATCH bị từ chối nhưng dữ liệu phụ đã được ghi

- `actions.ts:838` ghi guestCount; dòng856–861 ghi guest_id trước dispatch_apply_edit; các ghi này ở ngoài RPC transaction, một số bỏ qua error.
- Tái hiện actual processDispatch: RPC trả stale revision → success=false, không notification, nhưng guestCount và guest_id đã có lệnh UPDATE trước đó.
- Tác động: user tin không lưu gì nhưng số khách/nhóm khách đã đổi; FINISH và GET có thể chọn tập item khác vì guest_id đã thay. Tạo TurnQueue cho người chưa có row cũng diễn ra trước RPC, cần xác định side effect được phép hay không.
- Sửa: đưa các thay đổi nghiệp vụ thuộc payload vào cùng transaction có revision; side effect ngoài transaction phải có kết quả và thông báo rõ. Không chỉ sửa rollback UI.

### 8. P1 — Ngày B không bị ràng buộc với ngày service của đơn

- `20260925120000_live_sequential_handoff.sql:110–118` kiểm TurnQueue/ACTIVE theo business_date của A; dòng155+ ghi assignment/ledger/queue theo ngày A dù plannedStartAt của B có thể thuộc ngày khác.
- Tái hiện SQL: A ngày26; B có ACTIVE khác ngày27 lúc10–11h; gán B ngày27 lúc10:30 → success, tồn tại hai ACTIVE có giờ chồng nhau; assignment mới ghi business_date ngày26.
- Đây khác midnight trong cùng lượt đã được test. Modal datetime hiện cho chọn ngày bất kỳ; không có guard ngày theo đơn ở RPC. User đã chốt không cần chọn ngày riêng.
- Sửa: bỏ chọn ngày độc lập trên UI, lấy ngày service từ đơn ở server và tính timestamp từ giờ B/mốc phiên. Từ chối payload có ngày ngoài lượt service; điều phối sớm vẫn giữ ngày service. Rollover qua0h phải tính có kiểm soát theo mốc đã lưu và business-day, không theo ngày đang thao tác. Không mở luồng gán B tùy ý sang đơn/ngày khác.

### 9. P1 — Client parse hai lớp options, SQL chỉ một lớp

- `lib/ktvUtils.ts:44` và isTwoSlotSequential hỗ trợ double JSON; helper SQL thật ở `20260914120000_auto_complete_feedback_after_5m.sql:31` unwrap một lớp.
- Guard nối tiếp lấy v_old_options sau một unwrap tại `20260925120000_live_sequential_handoff.sql:241`, có thể không nhận ra sequentialSlots.
- Tái hiện SQL với row double-encoded từ import/restore: client nhận ra nối tiếp2 nhưng UPDATE DONE khi cả A/B chưa bắt đầu vẫn được guard cho qua.
- Chưa đo tỷ lệ double-encoded trên DB thật. Vì API/test đã chủ động hỗ trợ định dạng này, cần xử lý nhất quán hoặc kiểm dữ liệu và chuẩn hóa có kiểm soát trước phát hành.
- Sửa helper normalize server/client cùng hợp đồng; schema dữ liệu/guard không cho trạng thái sai bypass bởi kiểu encoding.

### 10. P2 — Hoàn thành sau A không cập nhật trạng thái Booking

- `20260925120000_live_sequential_handoff.sql:227` chỉ UPDATE BookingItems; wrapper FINISH_AFTER_A không recompute Booking.
- Tái hiện RPC: item CLEANING, Booking vẫn IN_PROGRESS. Chưa có trigger item→Booking trong fixture; source đang xét không cập nhật Booking ở đường này. Không khẳng định toàn bộ thẻ Kanban chắc chắn sai vì một số card dùng status item.
- Tác động: thông tin tổng đơn, lọc tab, API và thông tin item có thể bất nhất.
- Sửa: recompute Booking và đơn cha (nếu có) trong giao dịch cùng thao tác, tái dùng quy tắc utility/status hiện có.

### 11. P2 — Màn nhân viên crash với JSON segments hợp lệ nhưng sai shape

- `ScreenTimer.tsx:214` và `ScreenDashboard.tsx:252` JSON.parse thành công, sau đó filter mà không kiểm Array.isArray. KTVDashboard.logic và một số handler có pattern tương tự.
- Tái hiện render component thật với segments=`'{}'`: `filter is not a function` ở cả Dashboard/Timer.
- Đây là điều kiện dữ liệu legacy/import/realtime sai shape; chưa khẳng định DB production đang có row này.
- Sửa parser segment chung trả array an toàn, kiểm cấu trúc/mốc timestamp ở ranh giới server và UI. Không chỉ catch JSON syntax.

### 12. P2 — Timeline nhiều chặng hiển thị giờ suy từ chặng đầu

- `ScreenTimer.tsx:18–68` WorkingTimeline dùng actualStartTime của segments[0], cộng duration cho mọi chặng kể cả shouldMerge=false, không dùng actualStartTime riêng của chặng2.
- Tái hiện SSR: chặng1 bắt đầu10h/30p; chặng2 thực tế11h/30p → timeline chặng2 hiển thị10:30–11h thay vì11–11:30.
- Không phải lỗi tài khoản B lấy giờ A của single-item đã sửa; đây là nhiều chặng của cùng nhân viên có khoảng nghỉ/chuyển phòng.
- Sửa: nonmerged dùng mốc riêng mỗi chặng, gắn nhãn giờ dự kiến khi chưa có actual; chỉ tịnh tiến khi thực sự thuộc phiên gộp.

## Bằng chứng chạy lại

Chạy một lệnh: `node _plans/sequential_deep_audit_20260927.cjs`.

Năm script mới thực thi handler/component/action/migration thật với fixture local. Các assert **xác nhận lỗi hiện tại**, không phải assert bản sửa; kết quả thành công của script nghĩa là lỗi đã tái hiện. Các log PASS từ harness cũ vẫn đi qua: lỗi mới không phủ định các ca chuẩn đã đạt.

- `audit_sequential_lifecycle_second.cjs`: START partial/false status/retry; FINISH fabricate/child/no-start success.
- `audit_sequential_employee_second.cjs`: RELEASE errors/target, malformed segments crash, timeline.
- `audit_sequential_admin_metadata.cjs`: loader note loss, case-variant name loss qua Quick thật.
- `audit_sequential_dispatch_second.cjs`: pre-writes trước stale RPC.
- `audit_sequential_sql_second.cjs`: FINISH_AFTER_A tổng trạng thái; cross-business-day overlap; encoding bypass. SQL chạy cùng guard/audit/atomic migrations.

Phát hiện quyền API xác minh bằng source, không gọi thử API thật với quyền người khác. Dữ liệu/ràng buộc migration toàn chain, push webhook và mất mạng sau commit chưa được kiểm trên Supabase test thật.

## Rủi ro cần kiểm tiếp, chưa coi là lỗi đã tái hiện

- Notification được giữ lịch sử và không có idempotency key: gửi lại có thể có nhiều message; cần phân biệt lịch sử sửa hợp lệ với duplicate do retry. INSERT thành công vẫn chưa chứng minh push giao tới máy.
- Lưu service/phân công và notification khác transaction: crash sau commit trước INSERT có thể không tạo tin và không trả warning. Realtime có thể bù dữ liệu nếu đang kết nối, chưa chứng minh giao tới người đang offline.
- Hoàn thành/bàn giao gần mốc đổi business day dùng today ở RELEASE thay vì business_date assignment; cần ca thật qua giờ cutoff với đủ TurnQueue ngày cũ/ngày mới.
- Lock Booking→items của atomic FINISH kết hợp các trigger rating/parent/ledger và promotion có thể cạnh tranh; chưa chạy concurrency nhiều connection với toàn bộ trigger thật. PGlite rollback không chứng minh không deadlock trên deployment.
- Ảnh Storage nằm ngoài DB transaction; timeout sau commit cần reconcile/retry dựa trên operation ID để không mất ảnh hoặc xóa ảnh đã được tham chiếu.
- Đổi B trong khi tài khoản cũ đang post-service có guard chuyển màn; cần test hai tài khoản thật, mạng chậm, raw realtime out of order và refresh pending handovers. Fixture hiện chưa chứng minh mọi tổ hợp.

## Thứ tự sửa đề nghị

1. Auth/authorization API; xác định rõ actor, target segment và action/status.
2. START + FINISH + RELEASE: cùng hợp đồng phiên làm việc, mốc idempotent, transaction và completion theo từng segment hiện hành.
3. Chuẩn hóa metadata/segments/options; chặn mất tên/ghi chú khi chỉnh người khác.
4. DISPATCH transaction đầy đủ, ngày service lấy từ đơn (không chọn ngày riêng), business-day guard và recompute Booking sau Hoàn thành A.
5. Timeline và malformed-data UX; sau đó chạy ma trận nhiều dịch vụ/khách/ngày/nhân viên với DB test thật, realtime và push.

Chưa áp sửa source trong lượt audit. Không nên coi bản `bc06814f` là đã xử lý toàn bộ vấn đề vận hành chỉ dựa vào 5 flow chuẩn.
