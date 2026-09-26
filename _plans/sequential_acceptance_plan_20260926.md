# Nghiệm thu bổ sung nối tiếp A/B

Phê duyệt sửa file ổn định đã có trong session. Thực hiện trong branch feature, không migrate DB dùng chung.

## Lỗi đã tái hiện và diff dự kiến
```diff
- demo thêm row B mới mỗi lần quay lại; merge stamp theo employee
+ tái sử dụng row B, giữ segment lịch sử; merge stamp theo segment id
- tên fallback nhân viên ưu tiên generatedDisplayName
+ ưu tiên displayName hiện tại như admin
- confirmOverlap dùng chung cho mọi item/đơn con
+ xác nhận theo item, reset mỗi payload, hỏi lại từng xung đột
- orchestrator bỏ qua lỗi đọc/ghi Booking
+ trả lỗi khi lưu hoặc safety recompute thất bại
- FINISH ghi từng item riêng
+ RPC giao dịch lưu batch, kiểm snapshot dưới lock, rollback khi một item lỗi
```

## Kiểm bắt buộc
1. Demo B → C → B, đổi tên/giờ và actual stamps không lấy lượt cũ.
2. Fallback displayName giống admin và nhân viên.
3. Hai item overlap và hai đơn con phải xác nhận riêng; không lưu một phần khi bị từ chối.
4. PATCH lỗi Booking SELECT/UPDATE/safety phải trả failure.
5. FINISH nhiều item atomic, lỗi item thứ hai rollback, stale bị chặn, retry giữ timestamp.
6. Chạy lại bộ nghiệm thu 6 lỗi + 5 flow + tài khoản A/B + TypeScript/lint.

Báo cáo cuối phân biệt test local SQL/handler/component với browser, full migration chain và push ngoài môi trường.

## Hoàn thành

Đã triển khai và nghiệm thu bổ sung tại `sequential_acceptance_results_20260926.md`. Diff thực tế tại `sequential_acceptance_implemented_20260926.patch`. RPC đã kiểm thêm với native BookingStatus enum và các trigger nối tiếp/audit thật; smoke test Safari hoàn thành.
