# Merge `fix/shift-extension-phase1` → `feat/bit-lo-hong-phase1`

Ngày 24/09/2026. Merge trên checkout riêng, từ đích `eb50eae8` và nguồn `97eab07a`; repo làm việc gốc có thay đổi chưa commit nên không dùng để merge.

## Xung đột và cách giải

| File | Cách giải | Rủi ro nếu giải sai |
|---|---|---|
| `.env.example` | Giữ bản đích: đã có publishable/secret key mới và mẫu SMTP. | Thiếu SMTP khi cấu hình Preview. |
| `checkCustomer.js`, `fix_1505_data.mjs`, `scripts/setup-push-table.js` | Dùng Supabase URL từ env và secret key server; giữ nạp `.env.local`. | Script nhắm sai project hoặc không chạy. |
| `plans/plan_fix_type_d_subsecond_commission.md`, `plans/plan_wallet_root_cause_t007_45m.md` | Giữ bản đích có biên bản sửa T027/T007 mới hơn. | Mất lịch sử đối soát tài chính. |
| `repomix-output.md` | Giữ snapshot sinh tự động của đích; không dùng làm source runtime. | Chỉ ảnh hưởng tài liệu snapshot. |

Không có conflict marker trong API KTV, điều phối, WebBooking hay Supabase runtime. Merge tự động vẫn cần kiểm tra hành vi, đặc biệt hai ảnh lúc KTV bắt đầu dịch vụ và gia hạn ca.

## Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung / kết luận |
|---|---|---|---|
| Bắt đầu dịch vụ | Phải gửi ảnh dép khách và ảnh bắt đầu. | Thấy ảnh/chặng tương ứng sau ghi. | `BookingItems.segments`, Storage `attendance`; test mock 10/10 đạt. |
| Gia hạn ca | Type A/D chọn số phút trước giờ tan, kể cả qua nửa đêm. | Điều phối hiển thị giờ tan cập nhật. | `KTVAttendance`, `KTVTypeDDailyRegistration`, `KTVShifts`; cột `expected_end_time` đọc được trên DB hiện tại, unique index chưa đối chiếu trực tiếp. |
| WebBooking | Không đổi thao tác KTV ở bước xác nhận. | Mã WB đầy đủ; xác nhận lặp bị chặn, lỗi email được báo. | Cùng bảng `Bookings`/`BookingItems`; luồng đã được thử trên Preview nguồn trước merge. |
| Bảo mật | Phiên KTV vẫn phải khớp mã nhân viên. | Secret key chỉ ở server; mẫu SMTP giữ nguyên. | Cron fail-closed của nhánh đích không bị thay đổi bởi merge. |

## Gate trước cập nhật nhánh đích

- `npx tsc --noEmit` và `npm run build` đạt.
- 10 ca proof ảnh, test gia hạn ca/qua nửa đêm và self-check mã WB đạt.
- Sau push: kiểm tra Vercel Preview đúng merge SHA; KTV thử gia hạn, bắt đầu bằng hai ảnh, Admin xem điều phối và xác nhận WB; kiểm tra đăng nhập/quyền và email.
- Lùi code bằng revert merge commit nếu Preview lỗi. Dữ liệu đã ghi trong DB/Storage không tự lùi theo code.
