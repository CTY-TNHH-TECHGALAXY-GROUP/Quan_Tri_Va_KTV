# Điều phối nối tiếp trực tiếp dưới hàng KTV

## Ý định vận hành

Quầy gán một người trước, chỉnh phòng/giường/giờ/phút rồi gửi phân công ngay. Không phải chọn “A làm toàn bộ” hay “nối tiếp” ở một bước riêng. Chỉ khi quầy cần người tiếp theo mới bấm `+ Nối tiếp` dưới hàng A.

## Luồng đề xuất

1. Chưa gán người: chỉ có ô chọn KTV.
2. Đã gán một người: hiện hàng A và khung nét đứt `+ Nối tiếp` bên dưới; không hiện bộ chọn Song song/Nối tiếp.
3. Bấm khung: giữ nguyên giờ/phút/phòng/giường A, mở hàng B trống. Không tự chia lại thời lượng A.
4. Đã chốt với người dùng: hỗ trợ cả chọn B ngay trước khi gửi phân công và để B trống, gửi A trước rồi chọn B sau. B đã chọn trong nháp chưa giữ tua; B trống không tạo phân công giả.
5. Khi chọn B: cùng phòng/giường A, giờ dự kiến bằng giờ kết thúc dự kiến A, phút mặc định bằng phần gói chưa phân công; cho phép quầy sửa trước khi xác nhận.
6. A xong trong đơn đã mở nối tiếp: còn chờ B. Khách không làm tiếp thì dùng `Kết thúc sau A`.

### Gợi ý thời lượng

`phút còn lại = max(0, tổng phút dịch vụ − phút đã phân công của A)`.

- Gói 60 / A 60: khung `+ Nối tiếp` trung tính, không nhắc thiếu phút.
- Gói 60 / A 30: khung `Còn 30 phút · + Nối tiếp` nổi bật nhẹ.
- Gói 60 / A 45: mặc định B 15 phút.
- A vượt gói: không sinh phút âm hoặc mặc định B bằng 0; khi mở B yêu cầu nhập phút hợp lệ.
- Chỉ thiếu phút không đồng nghĩa đã chọn nối tiếp. Không tự mở B, không tự sửa A và không chặn gửi A vì gợi ý.

### Quy tắc dữ liệu

- Hàng trống là vị trí chờ trên UI; không tạo `Staff` giả, `KtvAssignments` hoặc `TurnLedger` cho người chưa biết.
- B chưa gửi là kế hoạch; B đã gửi là phân công. Cần phân biệt để không hiển thị một KTV là “đã gán” trước khi server xác nhận.
- Nháp chưa gửi được sửa A/B; sau khi đã gửi, gán/đổi B qua RPC khóa dữ liệu hiện có.
- Mở B không được thay giờ thực của A. B đã bắt đầu không được đổi qua thao tác nháp.
- B chỉ được một lượt hiện hành; người B cũ vẫn giữ lịch sử `Đã đổi`.
- Dịch vụ 4 tay và nhóm nhiều dịch vụ vẫn giữ luồng nhiều người cùng làm; không tự suy luận nối tiếp từ việc có hai KTV.
- Sau `Kết thúc sau A`, ẩn cả khung thêm B lẫn nút kết thúc lặp lại.

## Điểm cần chỉnh trong code hiện tại

`QuickDispatchTable.tsx` đang hiện selector ngay khi có một KTV. Nút nối tiếp hiện ở tiêu đề thay vì dưới hàng A. `SequentialDemo.tsx` lại yêu cầu chọn mode riêng. `openLiveHandoff` đang mặc định phút B theo phút A và giờ B theo thời điểm mở modal; cần dùng phần còn lại và giờ cuối A. Luồng nháp hiện bị bảo vệ ngay khi lưu cờ nối tiếp, nên phải kiểm tra nháp trước khi cho chọn B trước lúc gửi.

## Diff dự kiến để review

Người dùng đã duyệt bằng “Duyệt sửa file ổn định”. Các thay đổi dưới đây đã được triển khai trên branch test riêng.

```diff
--- QuickDispatchTable.tsx: bộ chọn cách làm
- {state.selectedKtvIds.length > 0 && !state.confirmedSequential && (groupItems.length === 1 || state.selectedKtvIds.length > 1) && (
+ {state.selectedKtvIds.length > 1 && !state.confirmedSequential && (
```

```diff
--- QuickDispatchTable.tsx: dưới danh sách hàng nhân viên
- Nút “Xác nhận nối tiếp” và “B · Chưa gán KTV” ở tiêu đề Nhân viên
+ Một khung nét đứt dưới A: “+ Nối tiếp” hoặc “Còn {remainingMinutes} phút · + Nối tiếp”
+ Sau khi bấm: một hàng B trống để chọn KTV hoặc để chờ chọn sau
+ Khi B đã được gán: thay hàng trống bằng hàng nhân viên B thật
```

```diff
--- SequentialDemo.tsx: gửi phân công
- Bắt buộc _demoMode và hai nút “A làm toàn bộ” / “Nối tiếp: A trước, B chọn sau”
+ Chọn A và thông tin hợp lệ là gửi được ngay
+ Dùng chính thao tác “+ Nối tiếp” trong QuickDispatchTable để mở B
+ Giữ mô phỏng giờ thực, localStorage, Kanban và đánh giá hiện có
```

```diff
--- page.tsx: openLiveHandoff
- plannedStartAt mặc định theo thời điểm mở modal
- durationMinutes: existingB?.duration || segment.duration || item.duration || 60
+ B đã có: giữ kế hoạch B hiện tại
+ B mới: giờ cuối A; phút còn lại của gói sau A
+ Quầy xác nhận trước khi gửi phân công B
```

## 5 trường hợp phải tự test sau chỉnh

| Case | Thao tác | Kỳ vọng |
| --- | --- | --- |
| 1 | Gói 60, A 60, gửi ngay | Không selector/bước chọn mode; gửi được; A hoàn tất chuyển dọn phòng |
| 2 | Gói 60, A 30 | Gợi ý còn 30; chưa tự biến thành nối tiếp; A giữ đúng 30 |
| 3 | Bấm + Nối tiếp, để B trống, gửi A | Hàng B tồn tại; không giữ tua giả; A xong vẫn chờ B |
| 4 | Chọn B ngay trong nháp rồi gửi A+B; sau đó đổi B trước khi bắt đầu | Trước gửi không giữ tua; sau gửi B có phân công thật; B mặc định phần còn lại/giờ cuối A; đổi B giữ lịch sử người cũ |
| 5 | Tải lại nháp/đã gửi; kết thúc sau A | Phục hồi đúng hàng B; kết thúc sau A không còn thao tác thêm B; không gọi DB từ demo |

## Phạm vi triển khai

Giữ branch `feat/sequential-two-slot-handoff-20260926`, kiểm tra trên demo local và SQL cô lập. Chưa migrate DB chung. Sửa nháp phải đi cùng kiểm tra guard trước khi đưa ra vận hành.

## Kết quả kiểm tra

- `node scripts/test_sequential_inline_ui.cjs`: 5/5 PASS. Render component thật và gọi handler mở nối tiếp/chọn B: một A không có selector; A 30/60 chỉ gợi ý; mở B trống; chọn B trong nháp giữ A 30 và mặc định B 30, cùng giường, giờ sau A; sau gửi chọn B qua callback riêng; kết thúc sau A không còn thêm B.
- `node scripts/test_sequential_sql.cjs`: 7/7 PASS trên PostgreSQL PGlite trong bộ nhớ. Ngoài 5 case bảo vệ ca đang chạy, có 2 case gọi RPC `dispatch_confirm_booking` thật: gửi A+B trong nháp và gửi A với B trống rồi gán B sau. Kiểm tra segment ID, assignment, ledger và chặn ghi stale sau gửi.
- `../../node_modules/.bin/ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/test_dispatch_live_guard.ts`: PASS, gồm phần phút còn lại, giờ qua nửa đêm, sửa nháp và khóa ca có giờ thực.
- `tsc --noEmit --pretty false`: PASS. Lint các component/helper thay đổi không có lỗi; còn cảnh báo dependency `syncToServices` có sẵn.
- Thao tác trình duyệt đã xác nhận A 60 gửi ngay không chọn mode, bắt đầu và hoàn tất sang CLEANING. Chưa hoàn thành lại toàn bộ 5 flow bằng click trình duyệt: công cụ Safari lỗi `elementHasNoFrame`/`noWindowsAvailable`; Chrome bị chậm. 5 case giao diện ở trên là kiểm tra component/handler, không phải 5 flow browser end-to-end.
- Demo tiếp tục dùng `dispatch-sequential-demo-v2` trong localStorage, không kết nối DB. Nhánh vận hành thật cần migration trên DB test trước UAT nhiều máy; chưa áp dụng migration ở môi trường chung.

## Chỉnh tay giờ bắt đầu B

- Trong nháp: nhập trực tiếp giờ B, giờ cuối B tính theo thời lượng; không sửa giờ A.
- Sau gửi, B chưa bắt đầu: ô giờ B cho nhập tay. `Lưu giờ B` mở phần xác nhận gán/sửa B với giờ vừa nhập; xác nhận để lưu qua RPC hiện có. Hủy xác nhận giữ kế hoạch cũ.
- B đã bắt đầu, bị thay hoặc ca đã đóng: không sửa giờ dự kiến bằng đường này.
- Kiểm tra handler đã pass: nhập 10:45 thay 10:30, giữ giờ A; truyền đúng giờ mới sang callback; khóa khi B đã bắt đầu. SQL pass khi sửa kế hoạch B cùng KTV/segment ID và giữ nguyên mọi mốc A.

## Demo tài khoản A/B và đồng hồ riêng

Tiếp tục trên branch test đã được duyệt. Mỗi link `?account=DEMO-A` / `?account=DEMO-B` chỉ hiện phân công của đúng tài khoản, không đăng nhập tài khoản thật. Các tab cùng origin đồng bộ bằng sự kiện localStorage. Đồng hồ dùng mốc thực của chính chặng, không lấy mốc của người kia. Theo phản hồi làm rõ: giữ cách xác nhận chồng giờ hiện có; không lấy giờ phân công A để hiển thị ở B và ngược lại.

```diff
--- SequentialDemo.tsx
- Chỉ có góc nhìn điều phối và nút bắt đầu chung
- localStorage chỉ nạp lúc mount
+ Link mở góc nhìn riêng tài khoản A và B, cùng dữ liệu local
+ Mỗi tài khoản chỉ được bắt đầu/kết thúc đúng chặng đã phân công cho mình
+ Đồng bộ các tab, đọc dữ liệu mới nhất trước mỗi thao tác
+ Đồng hồ riêng theo segment; mốc thực của A không bị ghi sang B và ngược lại
```

### Sửa nguồn giờ trên màn KTV đang dùng

```diff
--- ScreenTimer.tsx: WorkingTimeline (dùng chung màn dashboard/timer)
- actualStartTime nhận từ caller, có fallback giờ chung của booking
+ actualStartTime lấy từ segments[0] của đúng KTV đang xem
--- ScreenTimer.tsx: giờ trên đồng hồ
- currentSeg.actualStartTime || booking.dispatchStartTime || booking.timeStart
+ currentSeg.actualStartTime || currentSeg.plannedStartAt || currentSeg.startTime
+ Chỉ dùng fallback booking khi không có currentSeg
--- ScreenDashboard.tsx / ScreenTimer.tsx: caller timeline
- truyền giờ fallback booking vào WorkingTimeline
+ Timeline tự lấy mốc của các segment đã lọc theo tài khoản
```

### Kết quả demo tài khoản

- `node scripts/test_sequential_accounts.cjs`: 5/5 PASS. Render AccountDemo, ScreenTimer và ScreenDashboard thật với giờ chung booking cố tình đặt 10:00: A hiện 10:00–10:30, B hiện 10:45–11:00. Không dùng giờ A ở B; đồng hồ thực và thao tác kết thúc riêng. Chỉ mock dialog chưa mở và widget chấm công trong kiểm tra ScreenDashboard.
- Kiểm tra handler thật với hai trạng thái tab độc lập dùng chung localStorage: đọc bản mới nhất trước ghi, không xóa mốc A khi B thao tác, sự kiện storage cập nhật cả hai tab, reload giữ tài khoản và kế hoạch đúng.
- 5 case inline điều phối + chỉnh tay B + Kanban tiếp tục PASS. TypeScript PASS; lint không lỗi, chỉ hai cảnh báo img có sẵn trên ScreenTimer.
- URL demo B trả HTTP 200. Chưa xác nhận lại bằng click trình duyệt do công cụ Safari mất trạng thái điều khiển. Các kết quả 5/5 trên là component/handler, không phải browser end-to-end.
- Mở cùng trình duyệt, cùng origin `http://localhost:3001`, ba tab điều phối / `?account=DEMO-A` / `?account=DEMO-B`. Demo không tạo tài khoản Supabase hoặc ghi DB; không đồng bộ qua trình duyệt khác/máy khác.

## Nhãn nút theo yêu cầu vận hành

Người dùng yêu cầu dùng nhãn `Hoàn thành`. Tiếp tục theo phê duyệt sửa file ổn định đã có; chỉ đổi chữ, giữ nguyên callback và điều kiện A đã xong/B chưa bắt đầu.

```diff
--- SequentialDemo.tsx / KanbanBoard.tsx
- >Kết thúc sau A</button>
+ >Hoàn thành</button>
--- KanbanBoard.tsx / actions.ts: hướng dẫn nút
- Chọn hàng KTV hoặc Kết thúc sau A.
+ Chọn hàng KTV hoặc bấm Hoàn thành.
```
