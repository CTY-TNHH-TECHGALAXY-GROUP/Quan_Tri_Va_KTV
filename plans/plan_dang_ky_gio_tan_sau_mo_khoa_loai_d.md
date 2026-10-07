# Plan: Đăng ký giờ về trong ngày được mở khoá — KTV Loại D

> Mức 2 — chạm bảng đăng ký lịch mà cron kỷ luật đọc + luồng điểm danh (đường nóng).
> Ngày: 07/10/2026 · Nhánh: `feat/bit-lo-hong-phase1` · Bản 2 · **Đã duyệt 07/10/2026.**
>
> Quyết định: ngày được mở khoá, KTV **được phép không đi làm**, không phạt (đã liên hệ admin trực tiếp). Đăng ký giờ về chỉ bắt buộc khi KTV đi làm hôm đó. Vẫn đăng ký lịch ngày mai bình thường.

## 1. Tình huống (user mô tả)

- Ngày 9, quá 23:59 KTV quên đăng ký lịch ngày 10.
- 00:00 ngày 10: cron khoá tài khoản (luật "chưa đăng ký lịch cho ngày mới").
- Ngày 10 KTV đến tiệm, liên hệ admin mở khoá.
- **Yêu cầu:** mở khoá xong, KTV phải **đăng ký giờ về của ngày 10**, để quầy / admin biết hôm nay KTV làm đến mấy giờ.

Hiện tại KTV **không làm được**: màn Lịch chỉ cho tạo lịch ngày tương lai (`canCreateRegistration`), API `daily-registration` cũng chặn. Ngày 10 không có dòng lịch → quầy không thấy giờ về, màn điều phối trống giờ tan, gia hạn giờ làm báo lỗi.

## 2. Giải pháp

### 2.1. Ngoại lệ "ngày được mở khoá" — một hàm dùng chung
`KtvTypeDDisciplineService.duocMoKhoaHomNay(supabase, staffId)` → có `SecurityAuditLogs.event_type = 'MANUAL_UNLOCK'` từ 00:00 **ngày lịch VN** hôm nay (cùng cách cron dùng để miễn xử). Query riêng, lỗi thì trả `false`.

### 2.2. Gắn vào nút "Oria Xin chào" (bản cuối, theo ý user 07/10/2026)
Không có thẻ / màn đăng ký riêng. Dùng lại luồng "ngày OFF mà vẫn đi làm":
- **Client** (`app/ktv/attendance/page.tsx`): form điểm danh Loại D bắt buộc ô "Dự kiến về lúc mấy giờ?" khi lịch hôm nay là OFF **hoặc** (chưa có lịch **và** `unlockedToday`). Thiếu giờ về → không gửi được.
- **Server** (`app/api/ktv/attendance/route.ts`, Loại D `CHECK_IN` / `LATE_CHECKIN`): không có lịch hôm nay + `duocMoKhoaHomNay` → bắt buộc giờ về hợp lệ, sau giờ hiện tại (dùng chung hàm kiểm với luồng OFF). Điểm danh xong → tạo lịch hôm nay `REGISTERED` (giờ đến = lúc điểm danh, giờ về = giờ đã chọn, `check_in_at`), cập nhật `Staff.available_until`, báo quầy "T018 vừa được mở khoá, vào làm hôm nay từ 10:05, dự kiến về 22:00". Lỗi tạo lịch / gửi tin chỉ log, không làm hỏng điểm danh.
- Không có giờ hẹn trước → không xét đi trễ (nhánh xét trễ chỉ chạy khi đã có lịch).
- `app/api/ktv/attendance/status/route.ts` trả cờ `unlockedToday` (chỉ query khi chưa có lịch, lỗi → false).

### 2.5. Phía quản lý
Không sửa màn nào: mọi màn đang đọc `KTVTypeDDailyRegistration` (lịch đăng ký, Office, điều phối qua `lib/shift.constants.ts`) tự thấy giờ về.

## 3. Ảnh hưởng chéo (4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn / API | Form điểm danh (Oria Xin chào); `attendance`, `attendance/status` | Không sửa; thêm 1 thông báo cho quầy | `KTVTypeDDailyRegistration`, `SecurityAuditLogs` | Sửa phía KTV |
| Giờ về | KTV thấy giờ về đã đăng ký, gia hạn chạy được | Quầy / điều phối thấy giờ về (trước đây trống) | `lib/shift.constants.ts` đọc `expected_end_time` | Khớp — cùng 1 dòng |
| Giờ tích luỹ / tiền | Không đổi | Không đổi | — | Không ảnh hưởng — không ghi sổ phạt |
| Realtime | Không thêm | Thông báo quầy qua `StaffNotifications` sẵn có | — | Đồng bộ |
| Quyền | KTV chỉ tạo lịch của chính mình (danh tính từ phiên đăng nhập) | Không đổi | — | Không lộ dữ liệu |

## 4. Vùng nổ (4.5)
1. **Dùng chung**: `attendance` POST (điểm danh mọi KTV). Màn Lịch và `daily-registration` không sửa. Code mới chỉ chạy khi Loại D + không có lịch hôm nay; mọi trường hợp khác đi nhánh cũ.
2. **Nếu sai sập gì**: query mở khoá lỗi → coi như không được mở khoá → hành vi cũ (không đăng ký được hôm nay, điểm danh vẫn qua). Không chặn ai làm việc.
3. **Luồng khách**: Không — không đụng booking, WebBooking, WRB, email, hoá đơn.
4. **Cô lập**: query mở khoá riêng, không chèn vào select chính.

## 5. Hệ quả với cron kỷ luật
- 00:00 ngày 11, chốt ngày 10: vẫn miễn như cũ (`vuaMoKhoa`), nay đóng sổ dòng ngày 10 thành `COMPLETED`.
- Được mở khoá mà không đi làm: không có lịch, cron miễn ngày 10 như cũ — chấp nhận, vì người đó đã gặp admin trong ngày.
- Ngày 11: cron 00:00 ngày 11 **miễn toàn bộ** người được mở khoá ngày 10 (`vuaMoKhoa` → `continue` trước mọi luật), kể cả luật "chưa đăng ký ngày mới". Đây là hành vi sẵn có, không đổi. Nếu ngày 11 vẫn không có lịch thì 00:00 ngày 12 xử `NO_REGISTRATION` cho ngày 11. KTV vẫn đăng ký lịch ngày 11 ở màn Lịch như thường.
- Người **không** được mở khoá mà không đăng ký: giữ nguyên luật 14/09 (khoá kể cả có đi làm).

## 6. Edge case
1. Admin mở khoá lúc 00:00–06:59 ngày 10 → vẫn tính ngày lịch 10 (đúng ngày bị khoá); giờ về so theo phút trong ngày làm việc.
2. Mở khoá 2 lần trong ngày → chỉ 1 dòng lịch (upsert `staff_id, work_date`); đã có dòng thì không cho tạo lại.
3. Giờ về trước giờ hiện tại / qua nửa đêm → chặn như luồng OFF đi làm.
4. KTV có lịch hôm nay từ trước khi bị khoá (bị khoá vì lỗi khác) → không hỏi giờ về, đi luồng thường.
5. Muốn đổi giờ về sau khi đăng ký → dùng nút gia hạn giờ làm hiện có.

## 7. Kiểm thử
- Mock Node: (có lịch / không lịch) × (mở khoá hôm nay / không) × (giờ về hợp lệ / thiếu / đã qua / qua nửa đêm), cả `TZ=UTC`; kiểm cron đóng sổ ngày được mở khoá.
- Probe DB thật (chỉ đọc): `SecurityAuditLogs` cột `event_type, employee_id, created_at`; vài dòng `MANUAL_UNLOCK` gần nhất.

## 8. File dự kiến sửa
- `lib/services/KtvTypeDDisciplineService.ts` (hàm `duocMoKhoaHomNay`)
- `app/api/ktv/attendance/route.ts`, `app/api/ktv/attendance/status/route.ts`
- `app/ktv/attendance/page.tsx`, `app/ktv/attendance/Attendance.logic.ts`
- `scripts/qa/qa_24_dang_ky_sau_mo_khoa.ts` (mới) — 11/11, cả `TZ=UTC`
