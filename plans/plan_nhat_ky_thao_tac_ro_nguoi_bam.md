# Plan — Nhật ký "Thao tác" trên thẻ Kanban: rõ AI bấm, bấm NÚT GÌ

> Mức 2 (chạm danh tính đăng nhập + `KTVDashboard.logic.ts` + luồng tạm dừng). **Đã duyệt & đã code 14/09/2026** — chưa commit.
> Nhánh: `feat/bit-lo-hong-phase1`. Ngày khảo sát: 14/09/2026.
> Cập nhật sau góp ý: **không** gắn nhãn vai (KTV / quầy); thêm cách cứu dữ liệu cũ (đơn 11/09).
>
> **Kết quả kiểm thử:** `tsc --noEmit` sạch; mô phỏng Node trên log thật (006-11092026, WB-10092026-013/014, WB-11092026-003/004, 021/024-14092026) → đơn 11/09 hiện `23:30 T069 Khẩn cấp`; 7 ca mock của luật gộp đúng mong đợi. Preview: trang điều phối compile sạch (200, không lỗi console) — chưa chụp được thẻ vì cần đăng nhập.
> Logic thuần nằm ở `app/reception/dispatch/_components/KanbanBoard.counterLog.logic.ts` để chạy lại được bằng Node.

## 1. Hiện trạng — đo trên DB thật

Script chỉ đọc quét `BookingItems.options.counterLog` (toàn bộ):

| Hành động | Tổng | `by = null` (không rõ) | mã NV | id văn phòng |
|---|---|---|---|---|
| FINISH_EARLY | 15 | **6** | 0 | 9 |
| PAUSE | 33 | **6** | 14 | 13 |
| RESUME | 7 | 1 | 0 | 6 |
| CANCEL | 7 | 1 | 0 | 6 |
| KTV_EARLY_EXIT / KTV_EMERGENCY | **0** | – | – | – |

**Đơn 11/09 (006-11092026, WB-11092026-004…)** — "T069 Tạm dừng" dù T069 bấm Khẩn cấp:
- `StaffNotifications` có `EMERGENCY by=T069 23:30`, nhưng `counterLog` chỉ có `PAUSE by=T069 23:30`.
- Việc ghi dòng `KTV_EMERGENCY` / `KTV_EARLY_EXIT` (`logKtvReport`) chỉ có từ commit `357b3b3f` lúc **13:03 ngày 14/09** — sau khi các đơn 11/09 được tạo. Dữ liệu 11/09 ghi bằng code cũ nên không bao giờ tự hiện đúng, **trừ khi** thẻ đọc thêm `StaffNotifications` (mục 3.3).
- Từ 13:03 14/09 tới giờ chưa có lượt bấm nào của KTV trên bản nhánh → code mới **chưa được chứng minh** bằng dữ liệu thật.

**Đơn 021-14092026 (NH025)** — "không rõ người bấm":
- 22:06:32 tạm dừng (mốc chốt tiền) → **không có dòng nhật ký nào**, chặng không có `pauses[]` → bấm trên **bản live** (`origin/main` chưa có nhật ký thao tác; app KTV live còn nút "TẠM DỪNG" riêng).
- 22:09:32 `FINISH_EARLY by=null` → bấm trên bản nhánh nhưng request **không mang JWT**.
- NH025 **không** bấm Khách về sớm / Khẩn cấp (không có thông báo nào).
- Cùng máy cùng phút, đơn 024: `PAUSE 22:09 by=null`, `RESUME 22:10 by=null` → máy đó đang mất phiên.

## 2. Nguyên nhân gốc rễ

1. **Bản live chưa có nhật ký thao tác** — hết khi nhánh lên main. Không sửa hiển thị nào cứu được lần tạm dừng 22:06.
2. **"Không rõ người bấm" = request không mang JWT Supabase.** `requirePermission` ở "Compatibility Phase": thiếu JWT vẫn cho làm, nhưng `currentCounterActor()` chỉ đọc JWT → `null`. Xảy ra khi JWT hết hạn mà tab vẫn nhớ user, hoặc máy chung bị KTV đăng nhập đè cookie (cookie theo tên máy, không theo tab).
3. **Dữ liệu trước 13:03 14/09 không có dòng "KTV bấm nút gì"** — code ghi ra đời sau. Nguồn duy nhất còn lại là `StaffNotifications` (type `EARLY_EXIT` / `EMERGENCY`, `employeeId`, `createdAt`).
4. **App KTV "Khách về sớm" bắn 2 request song song** (`logic.handlePause(); handleEarlyExit();` không `await`) → cả hai đọc–sửa–ghi `options.counterLog`, request sau đè mất dòng request trước. Nút Khẩn cấp đã chạy tuần tự, nút này thì chưa.
5. **Luật gộp giấu nhầm thao tác quầy**: ẩn mọi `PAUSE` có `by` rỗng trong 2 phút quanh báo của KTV → quầy mất phiên bấm tạm dừng ngay sau khi KTV báo thì dòng quầy biến mất.

## 3. Đề xuất (một phương án)

### 3.1. Danh tính dự phòng theo TAB (dùng chung)
- `lib/apiClient.ts`: mọi request gắn header `x-spa-actor` = `encodeURIComponent(JSON.stringify({ id: user.code || user.id, name: user.name }))` đọc từ `sessionStorage` (`spa_auth_user`) — theo từng tab nên tab admin và tab KTV không lẫn. **Chỉ 2 trường này, tuyệt đối không gửi `password`.** Export `getActorHeaders()` cho chỗ còn dùng `fetch` thô.
- `lib/counter-action-log.ts` → `currentCounterActor()`: có JWT → như cũ, `verified: true`; không JWT → đọc header `x-spa-actor` (qua `next/headers`) → `verified: false`. Header **chỉ để ghi nhật ký**, không dùng cho kiểm tra quyền.
- `CounterLogEntry` thêm `verified?: boolean` (tuỳ chọn, dữ liệu cũ vẫn đọc được).
- `app/reception/dispatch/page.tsx`: lời gọi `fetch('/api/ktv/finish-early-paused')` thêm `...getActorHeaders()` (chỗ duy nhất gọi route có ghi nhật ký mà không qua apiClient).

### 3.2. App KTV — "Khách về sớm" chạy tuần tự, 1 lần xác nhận
- `KTVDashboard.logic.ts` → `handleEarlyExit`: `confirm` một lần → `await handlePause({ skipConfirm: true, silentIfPaused: true })` → `await handleInteraction('EARLY_EXIT')`. Giống nút Khẩn cấp.
- `ScreenTimer.tsx`: `onClick={handleEarlyExit}` (bỏ `logic.handlePause()` gọi song song).
- Không đổi 4 luồng lõi (mục 8 CLAUDE.md), không đụng timer / `postServiceBookingId` / `fetchBooking`.

### 3.3. Thẻ Kanban đọc thêm `StaffNotifications` — cứu đơn cũ, và là lưới an toàn
- `actions.ts` → `getDispatchData`: sau khi có danh sách booking, truy vấn thêm một lần `StaffNotifications` (`bookingId in (...)`, `type in ('EARLY_EXIT','EMERGENCY')`, chọn `bookingId, type, employeeId, createdAt`) và gắn `b.ktvReports = [...]` — y hệt cách đang làm với `ktvReviewsOfReception`.
- `useDispatchBoard.logic.ts` + `types.ts`: đưa `ktvReports` vào `PendingOrder`.
- `KanbanBoard.tsx`: đổi mỗi thông báo thành dòng `{ action: 'KTV_EMERGENCY' | 'KTV_EARLY_EXIT', by: employeeId, byName: employeeId, at: createdAt }`, **chỉ lấy của KTV có mặt trên thẻ** (dùng `ktvTrenThe` sẵn có, để thẻ tách nhiều KTV không lẫn), trộn vào `counterLog` rồi mới sắp và gộp. Luật lặp 30 giây sẵn có sẽ khử trùng với dòng `logKtvReport` đã ghi (khi có).
- Kết quả: đơn 11/09 hiện `23:30 T069 Khẩn cấp` thay vì `23:30 T069 Tạm dừng`; đơn mới cũng đúng kể cả khi `logKtvReport` lỗi âm thầm (hàm này cố ý không throw).
- Không cần script ghi dữ liệu, không backfill.

### 3.4. Hiển thị trên thẻ (KanbanBoard.tsx) — không gắn nhãn vai
Mỗi dòng: **giờ · người · việc · ghi chú** (như hiện tại).

| Dòng log | Hiển thị |
|---|---|
| KTV_EARLY_EXIT | `23:30 T069 Khách về sớm` |
| KTV_EMERGENCY | `23:30 T069 Khẩn cấp` |
| PAUSE của **đúng KTV đó** ≤ 2 phút quanh báo | ẩn (gộp vào dòng báo) |
| PAUSE / FINISH_EARLY / RESUME / CANCEL / SWAP từ quầy | `23:32 dev Kết thúc sớm · chốt tại mốc tạm dừng` |
| `verified: false` | tên kèm `*`, title "Phiên đăng nhập máy chủ đã hết — tên lấy theo tài khoản đang mở trên tab" |
| Dữ liệu cũ `by = null` | `22:09 Kết thúc sớm · không ghi được người bấm` |

- Sửa luật gộp: chỉ ẩn `PAUSE` khi `by` **khớp đúng** KTV đã báo (bỏ nhánh `!e.by`) → thao tác của quầy không bao giờ bị giấu.

### Không làm trong plan này
- Không bật chặn cứng "thiếu JWT → 401" (dễ nhốt quầy ngoài giữa ca nếu mật khẩu Auth lệch) — làm riêng.
- Không cứu được lần tạm dừng 22:06 của đơn 021 (bấm trên live, không có nguồn nào ghi).

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `ScreenTimer` nút Khách về sớm; `KTVDashboard.logic.ts` `handleEarlyExit` | Kanban khối THAO TÁC; `getDispatchData` thêm 1 truy vấn `StaffNotifications`; `page.tsx` gọi finish-early-paused | `apiClient.ts`, `counter-action-log.ts`; body của `pause-swap-resume`, `interaction`, `finish-early-paused`, `cancel-item` **không đổi** | Sửa |
| Số liệu tiền / tua / giờ | Không ảnh hưởng — chỉ ghi `options.counterLog`; `pauseStart`, `segments`, `pauses[]` giữ nguyên | Không ảnh hưởng | — | Khớp |
| Realtime / refresh | Không đổi | Kanban tải lại theo `BookingItems` như cũ; `ktvReports` đi cùng `getDispatchData` | `BookingItems`, `StaffNotifications` (chỉ đọc) | Đồng bộ |
| Quyền xem | KTV không xem nhật ký (không màn nào ở `app/ktv` đọc `counterLog`) | Quầy thấy tên người bấm + nút KTV đã bấm | Header chỉ để ghi log, không cấp quyền | Không lộ dữ liệu; không mở quyền mới |

Mục 13 (bảng hệ quả nghiệp vụ): **không áp dụng** — không thêm/đổi sự kiện làm thay đổi quyền lợi KTV; chỉ ghi và hiển thị nhật ký.

## 5. Rủi ro
- Header tự khai → có thể giả tên. Chấp nhận được: chỉ dùng khi thiếu JWT (lúc đó thao tác cũng đã được cho qua), dòng đánh dấu `*`.
- `next/headers` chỉ đọc được trong request context — `currentCounterActor` đã try/catch, lỗi thì về `null` như cũ.
- Thêm 1 truy vấn `StaffNotifications` mỗi lần tải bảng điều phối (~30 booking/ngày) — nhỏ.
- KTV thấy 1 hộp xác nhận thay vì 2 ở nút Khách về sớm.

## 6. Kiểm thử
1. Mô phỏng Node: hàm trộn + gộp mới chạy trên log thật của 006-11092026, WB-11092026-004, WB-10092026-014, 021/024-14092026 → in trước/sau.
2. `npx tsc --noEmit`.
3. Preview: (a) quầy có phiên bấm Tạm dừng / Kết thúc sớm; (b) quầy xoá cookie `sb-*` rồi bấm → tên có `*`; (c) KTV bấm Khách về sớm → 1 hộp xác nhận, đúng 1 dòng; (d) KTV bấm Khẩn cấp; (e) quầy bấm tạm dừng trong 2 phút sau báo → dòng quầy vẫn hiện; (f) mở ngày 11-09 → `23:30 T069 Khẩn cấp`.
4. Dưới `TZ=UTC`: giờ trên dòng log vẫn đúng giờ VN.
