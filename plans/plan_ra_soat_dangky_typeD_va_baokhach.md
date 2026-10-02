# Rà soát: Đăng ký lịch TYPE_D + Nút Báo Khách (Dispatch)

Ngày: 2026-09-02 · Nhánh: feat/bit-lo-hong-phase1

Phạm vi đọc: `app/api/ktv/daily-registration`, `attendance-adjustment`, `attendance` (+`status`),
`app/api/cron/daily-absence-check`, `app/ktv/schedule`, `app/api/reception/guest-arrival`,
`app/reception/dispatch/page.tsx`, `dispatch-timeline.ts`.

---

## A. LUỒNG ĐĂNG KÝ OFF / ĐI LÀM (KTVTypeDDailyRegistration)

### Hiện trạng
- Bảng đã đổi tên đúng (`20260902103002_rename...`); mọi truy vấn đều dùng `KTVTypeDDailyRegistration`. OK.
- POST `/api/ktv/daily-registration`: `type` = WORKING | OFF | CANCEL, nhận `dates[]`,
  upsert onConflict `staff_id,work_date`, chặn `d <= todayStr`.
- UI: tab "Đăng Ký Làm" (tab shift khi `work_type === TYPE_D`) → chọn nhiều ngày → nhập 1 giờ → **gửi thẳng**.

### Lỗ hổng

**A1 — THIẾU BƯỚC XÁC NHẬN.** [P0 – tính năng bạn mô tả, chưa có code]
`app/ktv/schedule/page.tsx:396` bấm là POST luôn. Không có màn review
"các ngày đã chọn + giờ đi làm" trước khi gửi. Tab OFF cũng vậy (`:361`).

**A2 — Timezone lệch, thủng rào chặn đăng ký.** [P0]
`daily-registration/route.ts:36` và `attendance-adjustment/route.ts:26` dùng
`format(new Date(), ...)` = giờ **UTC** trên Vercel, trong khi `status` route và cron dùng VN offset (+7).
Hệ quả trong khung **00:00–07:00 giờ VN**:
- `todayStr` = ngày hôm qua → KTV **đăng ký/hủy được lịch của CHÍNH HÔM NAY**, phá quy tắc "chỉ trước 00:00".
- `attendance-adjustment` đọc bản ghi **sai ngày** → `.single()` lỗi → "Bạn chưa đăng ký lịch hôm nay".
- Chốt chặn "không báo vắng sau 07:00" (`:51`) dùng `hour` UTC → thực tế mở tới **14:00 VN**.

**A3 — `check_in_at` KHÔNG BAO GIỜ ĐƯỢC GHI.** [P0]
Grep toàn repo: chỉ có nơi **đọc** (`cron:73`, `attendance-adjustment:46`), không nơi nào ghi.
Hệ quả: KTV đã điểm danh xong vẫn **báo vắng / báo trễ được**. Cron còn sống nhờ nhánh dự phòng
tra `KTVAttendance`, nên chưa phạt sai — nhưng chốt chặn đang mục.

**A4 — Upsert xóa trắng cột trạng thái.** [P1]
`route.ts:69` upsert full-row → đăng ký lại 1 ngày đã có bản ghi sẽ reset
`absent_reported_at / late_reported_at / late_report_count / penalty_applied / check_in_at` về default.
Hiện chỉ áp cho ngày tương lai nên rủi ro thấp; cộng với A2 (sửa được ngày hôm nay) thì thành
đường **xóa dấu vết báo trễ**.

**A5 — Không hủy được ngày đã đăng ký OFF.** [P0 — xem D5]
`page.tsx:263` chỉ bắt `status === "REGISTERED"`. Ngày `OFF_REGISTERED` không tô màu,
không có nút hủy → bấm lại chỉ upsert OFF đè lên. **Sai nghiệp vụ**: OFF phải hủy/đổi được
trong cửa sổ chỉnh sửa (D5).

**A10 — Rào 19h chỉ tồn tại ở client, và sai phạm vi.** [P0 — xem D5]
`page.tsx` (`handleDateClick`) chặn `dateStr === tomorrowStr && nowHour >= 19` — **chỉ ở UI**,
**chỉ cho tab OFF**, **chỉ cho ngày mai**, và dùng `new Date().getHours()` (giờ máy KTV → đổi
timezone điện thoại là lách được). Server (`daily-registration/route.ts:36`) **không có** rào 19h nào.
Tab "Đăng ký làm" không bị chặn 19h. Hệ quả: 20h tối 02/09 vẫn POST được lịch cho 03/09.

**A6 — Chỉ 1 giờ chung cho mọi ngày.** [P1 – cần chốt nghiệp vụ]
`expected_time` là 1 state duy nhất áp cho cả `dates[]`. Nếu cần giờ riêng từng ngày thì payload
phải là `[{work_date, expected_time}]`.

**A7 — Validate lỏng ở API.** [P2]
Không giới hạn số ngày/request, không chặn ngày quá xa, không regex `expected_time` (HH:mm),
không chặn `BLOCKED_HOLIDAYS` phía server (chỉ chặn ở UI).

**A8 — Cron khóa tài khoản quá tay, không tự phục hồi.** [P1]
`daily-absence-check:60`: không đăng ký + không điểm danh → `Staff.status = KHÓA_TÀI_KHOẢN` +
`Users.is_active = false`. **Không notification, không audit log, không loại trừ** nhân sự mới tạo
trong ngày, và **không có route mở khóa**.

**A9 — Rác code trong `Schedule.logic.ts`.** [P2]
- `:104-111` gọi `DAILY_REGISTRATION` **2 lần trùng nhau** (copy-paste).
- `fetchLeaveList` useCallback thiếu dep `user?.work_type`.
- Chuỗi tiếng Việt hỏng encoding: `"C� l?i x?y ra"`, `"B?n c� ch?c mu?n H?Y..."` (`:190`, `:200`).

---

## B. NÚT "BÁO KHÁCH" (GuestArrivalEvents)

### Phần đang làm ĐÚNG
- Bật/tắt thủ công có confirm 2 chiều (`dispatch/page.tsx:249-262`).
- Enforce **server-side** thật: `attendance/route.ts:159-179` chặn CHECK_OUT của TYPE_D → không bypass bằng UI được.
- Unique partial index `GuestArrivalEvents_single_active` → không thể có 2 khóa cùng lúc.
- Realtime channel đồng bộ cả Dispatch lẫn màn KTV.

### Lỗ hổng

**B1 — Auto-OFF phụ thuộc snapshot của 1 tab trình duyệt.** [P0]
`dispatch/page.tsx:225` yêu cầu `prevPendingCount > 0`. F5 / mở tab mới sau khi đơn cuối đã điều phối
→ `prevOrdersRef` rỗng → điều kiện không bao giờ đúng → **khóa treo vĩnh viễn**, KTV không tan ca được.
Tương tự khi bật khóa lúc đang có 0 đơn chờ (đúng kịch bản "khách xếp hàng nhưng chưa nhập đơn"
ghi trong confirm dialog) → không có gì tự tắt.

**B2 — Không có cơ chế nhả khóa phía server.** [P0]
Không cron, không timeout, không `expires_at`. Quầy đóng máy = khóa còn nguyên qua đêm.
(`plans/plan_bit_lo_hong_van_hanh_v16_phase1.md:60` mô tả đếm ngược `mm:ss` — **chưa implement**.)

**B3 — Đổi ngày trên Dispatch Board làm tắt khóa oan.** [P1]
`orders` phụ thuộc `selectedDate`. Bấm xem ngày khác → `currentPending.length === 0` +
`prevPendingCount > 0` (của ngày cũ) → **tự động DELETE khóa** dù hôm nay vẫn còn khách đợi.

**B4 — Nút bật không kiểm tra feature flag.** [P1]
Server chỉ chặn tan ca khi `SystemConfigs.guest_arrival_lock_enabled === 'true'` (`attendance/route.ts:166`).
Dispatch Board **không đọc flag này** → flag tắt/xóa thì quầy vẫn bấm được, nút vẫn sáng,
nhưng **KTV vẫn tan ca bình thường** — quầy tưởng đã khóa.

**B5 — POST check-then-insert không atomic.** [P0/P1]
`guest-arrival/route.ts:59-66`: 2 quầy bấm cùng lúc → unique index bắn lỗi → 500 "Có lỗi xảy ra"
dù khóa thực tế đã bật. Nên upsert hoặc bắt mã lỗi `23505`.

**B6 — Định nghĩa "còn đơn chờ" cần chốt lại.** [P1 – cần chốt nghiệp vụ]
Auto-OFF lọc trên `orders`, mảng này chứa **cả booking cha và con** (`parentBookingId` là dòng riêng)
⇒ đúng ý "không còn đơn cha hoặc con nào". Nhưng panel trái hiển thị theo `subOrders` tách theo phase
(`page.tsx:523`), và **dịch vụ phát sinh thêm** trên đơn đang chạy được gán `PREPARING` chứ không phải
`pending` (`dispatch-timeline.ts:406`) ⇒ không tính là đơn chờ.

**B7 — Audit yếu.** [P2]
`created_by_name` đang gán bằng `techCode` (`route.ts:47`, code tự thừa nhận trong comment);
`released_by` = `'SYSTEM'` nên không phân biệt được auto-off và người bấm.

---

## C. KẾ HOẠCH SỬA

### Đợt 1 — Bịt lỗ nghiêm trọng (P0)
1. **Chuẩn hóa giờ VN + cửa sổ chỉnh sửa** (A2, A5, A10 — theo D5): tạo `lib/vn-time.ts`
   (`vnNow()`, `vnToday()`, `vnHour()`, `canEditRegistration(workDate)`), thay toàn bộ `new Date()`
   nghiệp vụ trong `daily-registration` + `attendance-adjustment`; áp `canEditRegistration` cho
   **cả OFF / WORKING / CANCEL**, ở **cả client lẫn server**; bỏ `d <= todayStr` và bỏ rào 19h
   rời rạc ở client.
2. **Ghi `check_in_at`**: trong `attendance/route.ts`, sau khi CHECK_IN/LATE_CHECKIN của TYPE_D được
   confirm → update `KTVTypeDDailyRegistration.check_in_at`; đồng thời chặn CHECK_IN khi
   `status = 'OFF_REGISTERED'`. (A3)
3. **Auto-OFF Báo Khách đưa hẳn về server** (theo D2 + D3):
   - Tạo `lib/guest-arrival.logic.ts` → `hasPendingDispatch()` theo định nghĩa D3.
   - `GET /api/reception/guest-arrival`: nếu đang active mà `hasPendingDispatch() === false`
     → tự `released_at = now(), released_by = 'AUTO'`, trả `active: false`.
   - `POST /api/cron/guest-arrival-sweep` chạy mỗi 5 phút, gọi cùng hàm đó (để realtime đẩy
     xuống màn KTV kể cả khi không ai mở app).
   - `attendance/route.ts:159` gọi cùng hàm trước khi chặn CHECK_OUT → không chặn oan.
   - **Xóa toàn bộ effect auto-OFF phía client** (`dispatch/page.tsx:216-232`) → dứt điểm B1 và B3.
   - Không dùng `expires_at` / đếm ngược (D2).
4. **POST guest-arrival atomic**: bắt `23505` → trả về khóa hiện có thay vì 500. (B5)

### Đợt 2 — Đúng nghiệp vụ (P0/P1)
5. **Màn xác nhận đăng ký**: state `pendingSubmit` → modal liệt kê từng ngày + giờ,
   nút [Quay lại] / [Xác nhận gửi]. Áp cho cả OFF và Đăng ký làm. (A1)
6. **Giờ riêng từng ngày** (D1): state `Record<date, time>`, payload
   `entries: [{work_date, expected_time}]`, giữ tương thích ngược `dates[] + expected_time`,
   thêm nút "Áp giờ này cho tất cả ngày". (A6)
7. **Menu sửa lịch trên ô đã đăng ký** (D5): tô màu ô `OFF_REGISTERED`; bấm vào ô trong cửa sổ
   sửa → menu [Đổi giờ] / [Chuyển sang OFF] / [Chuyển sang đi làm] / [Hủy đăng ký];
   ô ngoài cửa sổ → khóa + tooltip lý do. Thay `window.confirm` hiện tại. (A5, A10)
8. **Upsert không phá cột kỷ luật**: chỉ update cột đăng ký, hoặc chặn khi đã có
   `check_in_at` / `penalty_applied`. (A4)
9. **Dispatch đọc `guest_arrival_lock_enabled`**: flag off → disable nút + tooltip. (B4)
10. ~~Xử lý `selectedDate`~~ → **đã giải quyết trọn ở bước 3** (client không còn quyết định tắt khóa). (B3)

### Đợt 3 — Củng cố (P1/P2)
11. Validate API: regex `^([01]\d|2[0-3]):[0-5]\d$` cho **mọi** `expected_time`, giới hạn số ngày/request,
    chặn ngày lễ phía server. (A7)
12. Cron khóa tài khoản (D4 — **giữ khóa ngay lần đầu**): thêm audit log, notification cho admin
    và KTV, loại trừ nhân sự mới tạo trong ngày, endpoint `POST /api/admin/staff/unlock`. (A8)
13. Dọn `Schedule.logic.ts`: xóa block fetch trùng, sửa dep useCallback, sửa chuỗi hỏng encoding. (A9)
14. Audit khóa: lưu tên thật người bấm, phân biệt `released_by = 'AUTO'`. (B7)

---

## D. QUYẾT ĐỊNH NGHIỆP VỤ (đã chốt 2026-09-02)

### D1. (A6) Giờ đến tiệm — **riêng từng ngày**
Mỗi ngày chọn có ô giờ riêng. Kéo theo thay đổi:
- State: `expectedTime: string` → `expectedTimes: Record<string, string>` (key = `yyyy-MM-dd`).
- Payload: `{ type: 'WORKING', entries: [{ work_date, expected_time }] }`.
  Giữ tương thích ngược `dates[] + expected_time` (áp chung) cho client cũ.
- Validate server: **mọi** entry phải có `expected_time` khớp `^([01]\d|2[0-3]):[0-5]\d$`.
- Modal xác nhận (A1) hiển thị bảng `ngày → giờ`, cho sửa giờ ngay trong modal.
- UX: thêm nút "Áp giờ này cho tất cả ngày" để không phải nhập lặp.

### D2. (B2) Nhả khóa — **KHÔNG timeout cố định**
Bỏ phương án `expires_at` + đếm ngược. Khóa chỉ nhả khi:
1. Quầy bấm tắt thủ công, **hoặc**
2. **Server** xác định không còn đơn chờ điều phối (định nghĩa ở D3).

⇒ Thiết kế lại mục C.3: thay vì cron hết hạn, làm **`GET /api/reception/guest-arrival` tự đánh giá lại**
(lazy release) + một sweep định kỳ:
- Mọi lần GET (KTV mở màn điểm danh, dispatch poll, realtime) → server đếm đơn chờ; nếu = 0 thì
  `released_at = now(), released_by = 'AUTO'` rồi trả về `active: false`.
- Chốt chặn CHECK_OUT (`attendance/route.ts:159`) dùng **cùng một hàm** → không bao giờ chặn oan
  khi thực tế đã hết đơn chờ.
- Thêm cron 5 phút gọi sweep để realtime kịp cập nhật màn KTV kể cả khi không ai mở app.
- Hệ quả tốt: xóa sạch lỗ B1 (không còn phụ thuộc snapshot trình duyệt) và B3 (không còn phụ thuộc
  `selectedDate`) vì client **không còn là nơi quyết định** tắt khóa.

### D3. (B6) "Còn đơn chờ" — **tính cả dịch vụ addon chưa gán KTV, TRỪ tiện ích**
Hàm dùng chung `lib/guest-arrival.logic.ts → hasPendingDispatch(bookings)`:

```
Còn đơn chờ  ⟺  tồn tại ít nhất 1 BookingItem thỏa mọi điều kiện:
  • booking (cha HOẶC con) của NGÀY HÔM NAY, status ∉ {DONE, CANCELLED}
  • item.status ∉ {DONE, CANCELLED}
  • item chưa có KTV nào trong staffList  (kể cả addon thêm giữa chừng)
  • KHÔNG phải tiện ích → dùng isUtilityService(item) từ lib/booking.logic (đã có sẵn)
```

Lưu ý: không dùng `dispatchStatus === 'pending'` nữa — vì addon trên đơn đang chạy bị gán
`PREPARING` (`dispatch-timeline.ts:406`) nên sẽ bị bỏ sót. Phải xét ở **cấp service item**.
Phòng riêng / tiện ích (`isUtilityService`) bị loại khỏi phép đếm.

### D5. (A5 + A10) Cửa sổ chỉnh sửa — **đến 19:00 của ngày liền trước**

**Một quy tắc duy nhất cho mọi thao tác** (đăng ký OFF, đăng ký đi làm, đổi giờ, hủy):

```
Được sửa lịch của ngày D  ⟺  vnNow() < 19:00:00 giờ VN của ngày (D - 1)
```

Ví dụ: 18:59 ngày 02/09 → **còn sửa được** lịch ngày 03/09 (kể cả hủy OFF, đổi giờ).
19:00 ngày 02/09 → 03/09 **đóng băng**; từ lúc đó chỉ còn sửa được 04/09 trở đi.

Hệ quả — quy tắc này **thay thế toàn bộ** các rào rời rạc hiện có:
- Bỏ `d <= todayStr` ở `daily-registration/route.ts:36` (đã bị bao hàm: với D = hôm nay thì
  mốc 19:00 hôm qua luôn đã trôi qua).
- Bỏ điều kiện `dateStr === tomorrowStr && nowHour >= 19` ở client — chuyển thành hàm dùng chung.
- Áp **cả 3 loại**: `OFF`, `WORKING`, `CANCEL`. Không còn ngoại lệ "OFF không hủy được".

Triển khai:
- `lib/vn-time.ts` → `canEditRegistration(workDate: string): boolean` — **hàm dùng chung
  client + server**, tính theo giờ VN (+7), không dùng giờ máy KTV.
- Server `daily-registration` validate **từng** ngày trong `entries[]`; ngày nào ngoài cửa sổ thì
  báo lỗi rõ: `Ngày 03/09 đã khóa lúc 19:00 ngày 02/09, không thể chỉnh sửa.`
- Client: ô lịch ngoài cửa sổ → hiển thị khóa (icon `Lock`), không bấm được, tooltip nêu lý do.
- Ô đã đăng ký **trong** cửa sổ (cả `REGISTERED` lẫn `OFF_REGISTERED`) → bấm mở menu nhỏ:
  **[Đổi giờ]** (chỉ với WORKING) / **[Chuyển sang OFF]** / **[Chuyển sang đi làm]** / **[Hủy đăng ký]**.
  Thay cho `window.confirm` hiện tại (`Schedule.logic.ts:200`).
- Cột lịch sử: mỗi lần sửa ghi `registered_at` mới; cân nhắc thêm cột `updated_at` + `edit_count`
  để đối chiếu khi tranh chấp.

### D4. (A8) Quên đăng ký — **khóa tài khoản ngay từ lần đầu**
Giữ nguyên hành vi hiện tại của `daily-absence-check:60`. Vẫn bổ sung phần thiếu:
- Ghi `AuditLog` (ai/khi nào/lý do) trước khi khóa.
- Bắn notification cho admin + KTV bị khóa (biết lý do, biết liên hệ ai).
- Loại trừ nhân sự có `createdAt` trong ngày chạy cron (chưa kịp đăng ký).
- Thêm `POST /api/admin/staff/unlock` để admin mở khóa (có audit).
- **Không** thêm cơ chế cảnh báo/ân hạn.
