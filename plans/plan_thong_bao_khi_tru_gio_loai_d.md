# Plan: Gửi thông báo khi KTV Loại D bị trừ giờ tích luỹ

**Mức 2**: sửa `lib/services/KtvTypeDDisciplineService.ts`, là service ghi sổ phạt giờ.
**Trạng thái:** đã làm xong (14/09). User duyệt "OK làm luôn đi".

Kết quả test trên DB thật (nick T079, ngày 29/09, đã xoá lại dữ liệu test): trừ trễ lần 1 gửi 1 thông báo; lần 2 cùng lỗi không gửi thêm; từ chối 2 tua (3h, 1.5h) gửi thêm 2 thông báo với đúng số giờ từng lần; sổ phạt ghi 5h và 4.5h như cũ. `tsc --noEmit` không lỗi. Không test nhánh kỷ luật TẮT vì phải tắt công tắc chung trên DB thật; nhánh này không đổi code (service vẫn trả 0 trước khi ghi sổ).

## 1. Lỗi đang gặp

Khi KTV Loại D bị trừ giờ, sổ `KTVDPenaltyLedger` có ghi, nhưng không có dòng nào trong `StaffNotifications`. Chuông thông báo của KTV không báo gì, và lịch sử thông báo cũng không có.

Kiểm trên DB thật (14/09):
- T016 ngày 14/09 có phiếu `LATE_NO_UPDATE` −5h, ghi chú "Đến trễ không báo — đăng ký 20:20", điểm danh lúc 20:36. Không có thông báo nào.
- T016 ngày 13/09 cũng có phiếu −5h và cũng không có thông báo.
- T007 điểm danh lúc 21:10:32, giờ hẹn báo trễ là 21:10. Chưa trễ hơn giờ hẹn nên không bị trừ. Đúng luật.

## 2. Nguyên nhân gốc

Có 5 đường trừ giờ. Chỉ đường cron chốt sổ (`applyCasePenalty`) có tự gửi thông báo. Hàm `deductDailyViolation` chỉ ghi sổ, và các chỗ gọi nó cũng không tự gửi.

| # | Đường trừ giờ | File | Thông báo lưu lại | Màn KTV thấy lúc đó |
|---|---|---|---|---|
| 1 | Điểm danh trễ (so với giờ đăng ký hoặc giờ báo trễ) | `app/api/ktv/attendance/route.ts:248` | ❌ | ❌ Không thấy gì |
| 2 | Nghỉ đột xuất | `app/api/ktv/attendance/route.ts:639` | ❌ | ❌ |
| 3 | Bỏ ca đã đăng ký sau 00:00 | `app/api/ktv/daily-registration/route.ts:141` | ❌ | Chỉ toast lúc bấm (`Schedule.logic.ts:233`) |
| 4 | Từ chối tua đã gán | `app/api/ktv/discipline/reject-order/route.ts:162` | ❌ | Chỉ toast lúc bấm (`ScreenDashboard.tsx:155`) |
| 5 | Cron chốt sổ đêm (vắng mặt) | `KtvTypeDDisciplineService.applyCasePenalty` | ✅ `WARNING` | Có |

## 3. Cách sửa (khuyến nghị)

Gửi thông báo ngay trong service, sau khi ghi sổ thành công. Làm vậy thì mọi đường trừ giờ, kể cả đường thêm sau này, đều tự có thông báo mà không phải nhớ sửa từng route.

- `deductDailyViolation`: ghi sổ xong và `hoursPenalty > 0` thì gọi `createNotification({ type: 'WARNING', employeeId: staffId, message })`. Nội dung:
  `Bạn bị trừ {h} giờ tích luỹ ngày {dd/MM/yyyy}. Lý do: {note}.`
  Viết giống hệt câu trong `applyCasePenalty`.
- `deductOrderReject`: làm tương tự với `thisPenalty` (số giờ của lần từ chối này, không phải tổng cả ngày).
- Lỗi khi gửi thông báo thì chỉ ghi log, không `throw`. Thông báo hỏng không được làm hỏng việc trừ giờ hay điểm danh.
- Tách một hàm nội bộ `thongBaoTruGio()` để 3 chỗ dùng chung một câu, `applyCasePenalty` gọi luôn hàm này.
- Không thêm loại thông báo mới. `WARNING` đã có rule "Nhắc nhở / Trừ điểm - trừ giờ" với `include_target_employee: true`, và phiếu trừ điểm Office đang gửi cho KTV bằng đúng loại này.

**Gửi trùng:** sổ phạt dùng upsert theo `(staff_id, work_date, penalty_type)`. Nếu cùng một lỗi bị gọi 2 lần trong ngày (VD điểm danh lại), sổ không trừ thêm nhưng thông báo sẽ gửi 2 lần. Để chặn, chỉ gửi khi trước đó chưa có dòng phạt cùng loại trong ngày, hoặc số giờ thay đổi. Đường từ chối tua mỗi lần đều trừ thêm thật, nên lần nào cũng gửi.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Chuông thông báo, `/api/ktv/notifications` | Lịch sử thông báo (`app/admin/notifications`). Rule `WARNING` có `allowed_roles: admin, dev` nên admin cũng thấy | `StaffNotifications`, `NotificationProvider` | Sửa: thêm dòng thông báo |
| Số giờ | Không đổi | Không đổi | `KTVDPenaltyLedger` giữ nguyên cách ghi | Khớp, không đụng công thức |
| Realtime | KTV đã subscribe `StaffNotifications` | Admin đã subscribe | DB webhook tự gửi push | Đồng bộ, không cần thêm |
| Quyền xem | Chỉ đúng KTV bị trừ (lọc theo `employeeId`) | Admin, dev | | Không lộ cho KTV khác |

## 5. Hệ quả nghiệp vụ

Chỉ thêm thông báo, không đổi tiền, tua, giờ, khoá tài khoản hay hàng đợi.
- Toast lúc bấm ở đường 3 và 4 vẫn giữ. KTV sẽ thấy cả toast lẫn thông báo lưu lại, chấp nhận được vì toast chỉ hiện một lần.
- Kỷ luật đang tắt thì không trừ giờ, nên cũng không gửi thông báo (service trả 0 trước đó).

## 6. Test

1. Mô phỏng bằng dữ liệu thật: snapshot, gọi `deductDailyViolation` cho một KTV test, kiểm có đúng 1 dòng `WARNING` với đúng `employeeId` và nội dung, rồi khôi phục.
2. Gọi lần 2 cùng loại lỗi trong cùng ngày: không có thêm thông báo.
3. Kỷ luật tắt: không có phiếu, không có thông báo.
4. `deductOrderReject` 2 lần: 2 thông báo, mỗi thông báo ghi số giờ của lần đó.
5. `tsc --noEmit`.

Không tự bù thông báo cho các phiếu cũ (T016 ngày 13 và 14/09). Muốn bù thì làm riêng.
