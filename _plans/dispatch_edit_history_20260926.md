# Giữ bản chỉnh gần nhất và nhật ký thời gian/tên dịch vụ

Branch: feat/sequential-two-slot-handoff-20260926. Tiếp tục theo phê duyệt “Duyệt sửa file ổn định” đã có và xác nhận “ĐÚNG VẬY” cho báo cáo. Không áp dụng migration lên DB dùng chung.

## Diff dự kiến
```diff
- return recalculateAllTimes({ ...o, services: mergedServices }, roomTransitionTime);
+ return { ...o, services: mergedServices };
- serviceNameForKtv: bi.options?.serviceNamesForKtvs?.[tCode] || ''
+ serviceNameForKtv: parsedOptions.serviceNamesForKtvs?.[tCode] ?? ''
- supabase.rpc('dispatch_confirm_booking', ...)
+ supabase.rpc('dispatch_apply_edit', { action: 'DISPATCH', actor, payload })
- BookingItems.update({ segments, options }) // lưu nháp từng dòng
+ dispatch_apply_edit('DRAFT', payload) // khóa, kiểm phiên bản, cập nhật cả lô
+ options.dispatchRevision / options.dispatchHistory: DB trigger nối lịch sử cũ, giá trị trước/sau
+ modal B giữ phiên bản lúc mở; bản cũ trả lỗi, không tự lấy phiên bản mới để ghi đè
+ fingerprint gồm toàn bộ chặng, tên chung, revision; realtime không đổi nền bản đang edit
+ demo local dùng cùng dạng lịch sử, kiểm phiên bản trước khi áp dụng sửa
+ mục lịch sử trong điều phối và demo
```

## Kiểm tra bắt buộc
1. Sửa lần 1 → lưu → tải lại → sửa lần 2: before của lịch sử bằng after lần 1.
2. Sửa tên A không đổi B/giờ; cùng KTV nhiều dịch vụ không bị nối lại giờ khi đổi tên.
3. Sửa B hai lần giữ giờ/phút B gần nhất; đổi B vẫn giữ nhật ký B cũ.
4. Hai tab/bản cũ: từ chối và không đổi dữ liệu/lịch sử; batch lỗi không lưu nửa chừng.
5. Fallback chỉ dùng khi tạo chặng mới; chặng đã lưu thiếu giờ không tự gán giờ hiện tại.
Chạy lại 5 flow demo, SQL PGlite, tài khoản A/B, inline UI và TypeScript.

## Kết quả thực hiện
- Bỏ gọi recalculateAllTimes trong callback cập nhật bảng; sửa tên không chạy phép nối giờ. Giữ các chặng còn lại khi đồng bộ hàng nhân viên, khớp giờ thực tế theo segment ID ở server.
- Fingerprint gồm chặng đầy đủ/tên chung/revision. Realtime hoãn làm mới đơn khi đang mở form; đóng form hoặc lưu thành công tải lại bản DB. Không tự chép revision mới vào nền form cũ.
- Giữ plannedStartAt/plannedEndAt từ bản nháp vừa được máy chủ xác nhận khi gửi điều phối tiếp; chặng thay giờ không mang theo ISO cũ.
- Lưu nháp, điều phối, bật nối tiếp, sửa/gán B, hoàn thành và TimeEditorModal đi qua dispatch_apply_edit. Khóa Booking và các BookingItems trước, so phiên bản, rồi cập nhật; lịch sử trước/sau nối từ OLD trong trigger.
- Đồng bộ KtvAssignments planned start/end và TurnQueue khi sửa nháp A chưa chạy. Ca A full60 đã điều phối → lưu nháp30 → gán B10:30 không tham chiếu A11:00 cũ.
- Giờ thực tế nhập tay kiểm ISO/múi giờ/thứ tự bắt đầu-kết thúc; không sửa lượt voided. RPC khóa và kiểm dữ liệu phải giống bản hiện tại ngoài hai actual stamps; chặn xóa mốc, đổi chặng/kế hoạch, sửa lượt voided và giờ kết thúc trước bắt đầu. Không sửa migration sequential cũ.
- Lịch sử hiển thị dưới dạng mục mở rộng ở điều phối/demo, gồm nhân viên, trước/sau, giờ VN, người sửa, thao tác. Background tự cập nhật không xác định được người sửa ghi actor null, không giả mạo người thao tác.

### Kiểm thử
- 5 flow vận hành demo + tên riêng: PASS.
- 5 ca UI lịch sử/phiên bản (handler/hooks thật + SSR lịch sử): PASS.
- 12 ca SQL cũ + 5 nhóm lịch sử/khóa bằng PGlite, dùng migration/RPC thật: PASS. Trong nhóm có thêm ca A60→nháp30→B và hai lần sửa actual timestamps/chặn bản cũ.
- 5 ca tài khoản A/B, 5 ca inline + nhập tay giờ B/Kanban/tên riêng: PASS.
- test_dispatch_actual_time (thân server action thật với DB/auth stub, không dùng DB thật): PASS.
- test_dispatch_live_guard, TypeScript --noEmit, git diff --check: PASS.
- ESLint file mới và file UI đã sửa: 0 errors; còn cảnh báo dependency useEffect có sẵn ở QuickDispatchTable và TimeEditorModal.

### Phạm vi nghiệm thu
Không chạy migration hoặc truy vấn DB dùng chung. SQL chạy PGlite trong bộ nhớ, giao diện kiểm qua component/hooks/SSR; chưa nghiệm thu trình duyệt và API KTV ảnh thật. Demo local dùng LocalStorage, tự lưu bản nháp và lịch sử. Luồng DB cần cả migration sequential và migration history trước khi sử dụng. Không tái dựng được người/thời điểm của các lần sửa trước khi tính năng lịch sử được áp dụng.

Diff đầy đủ: dispatch_edit_history_20260926.patch (kèm file mới).
