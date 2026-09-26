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
