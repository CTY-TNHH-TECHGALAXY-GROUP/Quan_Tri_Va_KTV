# Rà soát vận hành nối tiếp A/B — 26/09/2026

> Báo cáo này ghi lỗi trước sửa, nền f206bfb8. Sau triển khai, script cùng tên đã chuyển thành entry point kiểm thử hồi quy cho hành vi đúng. Kết quả mới ở sequential_six_fixes_results_20260926.md.

Branch: `feat/sequential-two-slot-handoff-20260926`, code nền `f206bfb8`.
Đợt này chỉ phân tích và dựng ca tái hiện, chưa sửa code vận hành hoặc migrate DB.

## Kết luận
Có lỗi còn lại ảnh hưởng vận hành và hiển thị admin/nhân viên. Những ca thông thường đã PASS không bao phủ đổi B quay lại cùng người, ca đêm, dữ liệu options dạng chuỗi và lỗi ghi DB/notification.

P1: cần sửa trước test vận hành trên DB thật. P2: cần sửa để tránh hiển thị sai hoặc báo thành công thiếu thông tin.

| Ưu tiên | Vấn đề | Tình huống và ảnh hưởng |
| --- | --- | --- |
| P1 | Lượt B cũ đã hủy vẫn được chọn | B → C → B trong cùng dịch vụ. Admin và Dashboard/Timer dùng `segments[0]` hoặc lọc theo mã người nhưng không loại `voided`. Hiện giờ cũ, cộng cả thời lượng cũ; START_TIMER có thể chọn segment cũ rồi DB guard từ chối. |
| P1 | Hoàn thành bỏ qua lỗi ghi DB | DB trả lỗi lúc lưu `actualEndTime`; handler vẫn trả kết quả thường. Nhân viên có thể chuyển màn tiếp trong khi admin còn thấy đang làm, giờ kết thúc không được lưu. |
| P2 | Sửa giờ B qua 0h giữ ngày cũ | B 23:50 ngày 26 → 00:10 bằng ô giờ; helper ghép ngày 26 với 00:10. Nếu xác nhận overlap, DB lưu 00:10 ngày 26 thay vì ngày 27. HH:mm nhìn đúng nhưng ngày thực sai, ảnh hưởng lịch/đồng hồ. Modal datetime cho phép chọn ngày đúng; lỗi thuộc ô giờ inline. |
| P2 | Tên riêng bị fallback khi options là chuỗi JSON | Admin parse options nhưng API enrich `service_name` lấy `i.options` thẳng. Tên B đã sửa vẫn có trong options, tiêu đề nhân viên có thể hiện tên danh mục. Có điều kiện: dữ liệu legacy/double-encoded dạng chuỗi; object bình thường không lỗi này. |
| P2 | Realtime nhận options mới nhưng tiêu đề giữ tên cũ | Payload DB cập nhật options/segments, không có trường enrich `service_name`. Tiêu đề một dịch vụ dùng `item.service_name`, nên chưa đổi cho đến fetch API enrich. Bình thường fetch debounce khắc phục; trong REVIEW/HANDOVER/REWARD handler chặn fetch nên có thể lâu hơn. |
| P2 | Điều phối báo thành công dù notification không lưu | Helper chỉ log lỗi insert rồi return; caller không biết thất bại. Riêng cập nhật B xóa notification chưa đọc trước khi insert; nếu insert lỗi, bản cũ cũng mất, B không nhận thông báo cập nhật. Dữ liệu phân công vẫn đã lưu. |

## Bằng chứng trong code

### 1. Chặng cũ / B quay lại
- `app/reception/dispatch/useDispatchBoard.logic.ts:351`: staffList chứa mọi segment cùng mã người, gồm voided.
- `app/reception/dispatch/_components/KanbanBoard.tsx:1074`: hiển thị theo segment đầu; một người quay lại có segment cũ nằm trước segment mới.
- `app/ktv/dashboard/_screens/ScreenDashboard.tsx:255` và `ScreenTimer.tsx:218`: lọc mã người, không lọc voided.
- `app/api/ktv/booking/_handlers/handleGetBooking.ts:552,620`: chỉ số chặng/dispatchStartTime cũng lấy chặng cũ.
- `app/api/ktv/booking/_handlers/handleStartTimer.ts:150`: target lấy từ mảng chứa voided.
- Đã render Dashboard/Timer thật: cùng hiện B cũ 10:45 và B mới 11:15.
- Đã chạy SQL thật trong PGlite: B được gán lại thành công, ghi bắt đầu vào chặng B cũ bị guard từ chối.

### 2. Hoàn thành
- `app/api/ktv/booking/_handlers/handleFinishService.ts:266`: await update nhưng không đọc error.
- Gọi handler thật với Supabase stub trả lỗi update: không có earlyResponse lỗi, handler vẫn trả bookingUpdatePayload thường. Không có actualEndTime được lưu.
- Đây là lỗi có sẵn ở handler chung, không giới hạn riêng nối tiếp.

### 3. Qua 0h
- `supabase/migrations/20260926120000_dispatch_edit_history.sql:139-142`: ngày lấy từ plannedStartAt cũ, ghép với HH:mm mới.
- Đã chạy DRAFT thực qua wrapper trong PGlite: B 23:50 ngày 26, sửa 00:10, confirmOverlap=true → assignment lưu `2026-09-25T17:10:00Z` (= 00:10 ngày 26 VN), thay vì `2026-09-26T17:10:00Z` (= ngày 27 VN).
- Demo cũng giữ ngày cũ khi sửa inline nên không tự phát hiện lỗi này.

### 4–5. Tên riêng
- `app/api/ktv/booking/_handlers/handleGetBooking.ts:419,485`: enrich thiếu parse options trước khi lấy tên.
- Cùng expression API thật: options object → tên B mới; options JSON string → tên danh mục.
- `app/ktv/dashboard/KTVDashboard.logic.ts:1471,1495`: merge raw payload giữ service_name cũ.
- `app/ktv/dashboard/_screens/ScreenTimer.tsx:303` và Dashboard: tiêu đề một dịch vụ lấy service_name thay vì tên riêng trong options.
- SSR thật với options mới, service_name cũ: tiêu đề vẫn cũ. Đây là tái hiện trạng thái sau raw realtime merge, không phải kiểm thử truyền realtime trên DB thật.

### 6. Thông báo
- `lib/notification-helper.ts:39-41`: insert lỗi chỉ log rồi return.
- `app/reception/dispatch/actions.ts:893-896`: xóa tin chưa đọc trước khi tạo tin cập nhật B.
- Chạy helper thật với insert stub lỗi: trả undefined giống kết quả thành công; processDispatch không có trạng thái notification thất bại để báo quầy.
- Chưa kiểm chứng DB webhook/push giao nhận thật.

## Thứ tự sửa đề xuất / diff định hướng
```diff
- UI/API/START_TIMER chọn mọi chặng cùng mã hoặc segments[0]
+ dùng chặng hiện hành không voided cho thao tác/giờ; chặng đã đổi chỉ ở lịch sử
- Hoàn thành await update rồi tiếp tục dù error
+ kiểm tra error; trả lỗi và giữ màn hiện tại khi chưa lưu được
- inline HH:mm luôn ghép ngày cũ
+ cho phép xem/chọn ngày B, dùng datetime hiện có cho ca qua 0h
- tiêu đề lấy service_name enrich cũ, options không normalize
+ normalize options; ưu tiên tên riêng của chính tài khoản từ bản mới nhất
- xóa notification cũ rồi insert; helper nuốt lỗi
+ tạo tin mới thành công trước khi dọn tin cũ; báo riêng lưu thành công/gửi tin thất bại
```
Trước hết sửa 2 P1; tiếp theo ca đêm và tên riêng; cuối cùng thông báo. Phê duyệt “Duyệt sửa file ổn định” đã có trong session; báo cáo này làm rõ diff trước khi sửa nếu tiếp tục triển khai.

## Kiểm thử và giới hạn
- Tái hiện: `node _plans/sequential_operational_audit_20260926.cjs`.
- Các assertion tái hiện lỗi ban đầu đã chuyển sang regression assertions trong scripts/test_sequential_*.cjs.
- SQL baseline: 12 ca, 5 history, 5 update B vẫn PASS; thêm 2 ca phát hiện lỗi chặng quay lại/ngày qua 0h.
- Không truy cập DB dùng chung, không migrate, không gửi thông báo thật. Không khẳng định tỷ lệ phát sinh ở dữ liệu production.
- Chưa chứng minh hết toàn bộ luồng: trình duyệt hai tài khoản thật, mạng mất/reconnect, xác thực/RLS, webhook/push và toàn bộ migration chain cần test tích hợp sau khi sửa trên DB test riêng.
