# Plan — Ngày OFF: hiện "Bật nhận đơn" trước, bật rồi mới hiện "Oria Xin chào" (KTV Loại D)

> **Mức 2** — sửa `KtvTypeDOnlineService.goOnline` (quyết định KTV có bị cron phạt/khoá hay không).
> **Trạng thái**: ✅ Đã duyệt & đã làm (14/09/2026). **Nhánh**: `feat/bit-lo-hong-phase1`
>
> **Kết quả kiểm thử**: mô phỏng hiện nút 7/7 đạt · thử thật `goOnline` trên T079 ngày OFF (chụp ảnh → thử → hoàn trả): bật được, `online_status = ONLINE`, đăng ký **vẫn** `OFF_REGISTERED` → cron không phạt · `tsc` 0 lỗi.
> Ca "bấm Oria Xin chào đổi OFF → REGISTERED" là code **có sẵn, không sửa** (`attendance/route.ts:220-224`) — đã đọc, chưa chạy thật (sẽ tạo bản ghi chấm công).

---

## 0. User chốt (14/09/2026)

| # | Chốt |
|---|---|
| 1 | Nghiệp vụ: KTV đã đăng ký **OFF** mà muốn **đi làm thêm** thì **cho phép**. |
| 2 | **Phương án B**: bấm "Bật nhận đơn" ngày OFF → ngày đó **vẫn giữ `OFF_REGISTERED`**. Chỉ khi bấm **"Oria Xin chào"** (tới tiệm) mới đổi thành ngày đi làm. Bật mà không tới → **không bị phạt**. |
| 3 | Ngày OFF: chỉ hiện nút **Bật nhận đơn**; bật xong mới hiện **Oria Xin chào**. |

## 1. Hiện trạng + nguyên nhân gốc (đã đọc code)

| Nút ngày OFF | Hiện nay |
|---|---|
| Bật nhận đơn | ❌ **Máy chủ từ chối**: `KtvTypeDOnlineService.goOnline` trả *"Hôm nay bạn đã đăng ký nghỉ, không thể nhận đơn."* khi `status = OFF_REGISTERED` (`lib/services/KtvTypeDOnlineService.ts:62-64`). |
| Oria Xin chào | ✅ Cho qua, `attendance/route.ts:220-224` đổi `OFF_REGISTERED → REGISTERED`, `expected_time = giờ bấm`. |

- Màn `AttendanceTypeD.tsx:300-321` (`isOffline`) hiện **cả hai nút cùng lúc**.
- **Lỗi sẵn có**: banner ngày OFF (`AttendanceTypeD.tsx:229-231`) ghi *"Nếu đổi ý, bấm bật nhận đơn để đi làm bình thường"* — nhưng bấm vào bị từ chối. Màn hình hướng dẫn một việc không làm được.
- Chặn OFF chỉ nằm **một chỗ** (service). Route `app/api/ktv/type-d/on-call/route.ts` chỉ gọi service, không chặn thêm. Người gọi `KtvTypeDOnlineService.goOnline`: **duy nhất** route đó.
- Cron `daily-absence-check/route.ts:139`: `OFF_REGISTERED` → đóng sổ `COMPLETED`, **không phạt**. Không cần sửa cron.

## 2. Thay đổi

| File | Sửa |
|---|---|
| `lib/services/KtvTypeDOnlineService.ts` `goOnline` | **Bỏ** nhánh chặn `OFF_REGISTERED`. **Không** ghi gì vào `KTVTypeDDailyRegistration` (giữ OFF — phương án B). Giữ nguyên kiểm tra `allow_on_call`, loại D, thời gian di chuyển. |
| `app/ktv/attendance/_components/AttendanceTypeD.tsx` nhánh `isOffline` | `isOffToday && canOnCall` → **chỉ** nút *Bật Nhận Đơn* (ẩn *Oria Xin chào*). Ngày thường, hoặc `!canOnCall` → giữ nguyên như nay. Nhánh `isOnline` giữ nguyên (đã có *Oria Xin chào* + *Tắt Nhận Đơn*). |
| `AttendanceTypeD.tsx` banner ngày OFF | `canOnCall`: *"Muốn đi làm thêm hôm nay? Bấm Bật nhận đơn."* · `!canOnCall`: giữ câu hiện có (*"bấm Oria Xin chào"*). Chữ đưa vào `*.i18n.ts`. |

**Người không có quyền nhận đơn ngoài giờ** (`allow_on_call = false`, hiện chỉ **T027**): không có nút *Bật Nhận Đơn*. Nếu ẩn *Oria Xin chào* thì họ không còn nút nào → **giữ nguyên *Oria Xin chào* cho nhóm này**.

## 3. Bảng hệ quả (CLAUDE.md §13) — sự kiện "Bật nhận đơn vào ngày OFF"

Một vai: KTV đó. Hai nhánh: **(i)** chỉ bật, không tới · **(ii)** bật rồi bấm Oria Xin chào.

| # | Khía cạnh | (i) Bật, không tới | (ii) Bật → Oria Xin chào |
|---|---|---|---|
| 1 | Tiền tua | Không có đơn thì 0; có đơn thì tính bình thường | bình thường |
| 2 | Giờ tích luỹ (D) | theo đơn làm, bình thường | bình thường |
| 3b | Lượt tua (D) | không đổi luật | không đổi luật |
| 4 | Thưởng Xuất sắc | bình thường theo đơn | bình thường |
| 5 | Đánh giá khách tính cho | KTV đó | KTV đó |
| 6 | Dọn phòng / bàn giao | có nếu làm đơn | có |
| 7 | Nợ phòng / chặn tan ca | tính như ngày thường | tính |
| 8 | Hạn mức bỏ qua | tính | tính |
| 9 | Hàng đợi | Bật nhận đơn **không** tạo dòng TurnQueue (như ngày thường) | `arriveAtVenue` vào TurnQueue ⚠️ (phiên song song đang sửa hàm này — mục 5) |
| 10 | Màn app KTV | OFF + chưa bật → chỉ *Bật Nhận Đơn*; bật → *Oria Xin chào* + *Tắt* | → *Oria Xin cảm ơn* như thường |
| 11 | Đồng hồ | không áp dụng — vì không đổi luồng đơn | không áp dụng |
| 12 | Tự chốt | không áp dụng | không áp dụng |
| 13 | Thẻ Kanban | không đổi | không đổi |
| 14 | "Cùng làm với" | không áp dụng | không áp dụng |
| 15 | Lịch sử KTV | bình thường | bình thường |
| 16 | Nhật ký quầy | không đổi — vẫn bắn thông báo bật/tắt nhận đơn như ngày thường (`notifyOnCallChange`) | không đổi |
| 17 | Lý do bắt buộc | không | không |
| + | **Phạt vắng (cron)** | vẫn `OFF_REGISTERED` → **không phạt** ✅ | `REGISTERED`, `expected_time` = giờ bấm → **không phạt trễ** |

## 4. Ảnh hưởng chéo (CLAUDE.md §4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn / API | `ktv/attendance` (AttendanceTypeD), `api/ktv/type-d/on-call` | `reception/dispatch` — bảng KTV đang bật nhận đơn (`DispatchOnlineKtvTable` lọc `online_status = ONLINE`) | `KtvTypeDOnlineService`, `KTVTypeDDailyRegistration` | Sửa KTV; quầy **tự thấy** KTV OFF đang bật nhận đơn, không cần sửa |
| Số liệu | không đổi công thức | không đổi | không đổi | Khớp |
| Realtime | on-call GET poll 30s (sẵn có) | `Staff.online_status` (sẵn có) | `Staff` | Đồng bộ |
| Quyền | giữ kiểm tra `allow_on_call` | — | — | Không lộ |
| **Lời nhắc "phạt vắng"** | `CheckInReminder.i18n.ts` *"Loại D: không điểm danh trong ngày vẫn bị phạt vắng"* | `CheckinConfirm.i18n.ts` (popup gửi đơn) — câu y hệt | — | ⚠️ **Sai với người đăng ký OFF** (họ không bị phạt). Hai file này của **phiên song song**, chưa commit → **cần xác nhận** trước khi sửa. |

## 5. Rủi ro / phụ thuộc

1. **Trùng file với phiên song song** — `plan_dieu_phoi_ktv_chua_diem_danh.md` sửa `KtvTypeDOnlineService.arriveAtVenue` và `dispatch/actions.ts` (đang sửa dở, chưa commit). Plan này chỉ sửa `goOnline` (khác hàm) → làm **sau khi** phiên kia commit để tránh đè.
2. Câu "phạt vắng" ở mục 4 → đề nghị phiên kia bỏ vế đó cho KTV đang `OFF_REGISTERED`.

## 6. Kiểm thử (mô phỏng + tay)

| Ca | Mong đợi |
|---|---|
| D ngày OFF, có quyền, chưa bật | chỉ nút *Bật Nhận Đơn* |
| Bấm Bật Nhận Đơn ngày OFF | thành công, `online_status = ONLINE`, `DailyRegistration` **vẫn** `OFF_REGISTERED` |
| Đang ONLINE ngày OFF | hiện *Oria Xin chào* + *Tắt Nhận Đơn* |
| Bấm Oria Xin chào | `OFF_REGISTERED → REGISTERED`, không phạt trễ |
| Bật rồi không tới, cron chạy | `COMPLETED`, **không** phạt/khoá |
| T027 (không quyền) ngày OFF | vẫn thấy *Oria Xin chào* |
| D ngày thường | giữ nguyên cả hai nút như nay |
| Tắt Nhận Đơn ngày OFF | về trạng thái chỉ nút *Bật Nhận Đơn* |
