# Plan — Sửa 2 lỗi vận hành: (1) đổi KTV giữa ca, (2) huỷ dịch vụ khi KTV chưa bắt đầu / đang chờ

- **Mức**: 2 (đổi KTV, tua, phân công, `app/reception/dispatch/actions.ts`). **Ngày**: 08/10/2026. **Trạng thái**: ĐÃ DUYỆT 08/10 → ĐÃ CODE + TEST trên DB TEST (qa_28 301/301, cả TZ=UTC), chưa commit, chưa deploy.
- **Phát hiện bởi**: `scripts/qa/qa_28_e2e_van_hanh_test_db.ts` (E2E DB TEST, 08/10) — luồng F07 và F09b. Cả 2 lỗi **có sẵn trên phase1** (bản đang chạy), không do thay đổi 06–08/10.
- **Quyết định của user (08/10)**:
  - Lỗi 1: KTV vào thay dùng **mã chặng mới, ghép từ mã chặng của người bị thay** (không dùng lại nguyên mã).
  - Lỗi 2: **người chưa bắt đầu mà bị huỷ thì không nhận được gì** — áp dụng cho cả huỷ 1 dịch vụ lẫn huỷ cả đơn.
- **Nhánh làm**: tách từ `origin/feat/bit-lo-hong-phase1` (bản đang chạy), không làm trên nhánh `feat/chuan-hoa-segments-20261007`.

---

## 1. Lỗi 1 — Đổi KTV giữa ca: người vào thay không bấm Bắt đầu được

### 1.1 Logic đang chạy
1. Quầy: Tạm ngưng → hộp "Đổi KTV" → `POST /api/ktv/pause-swap-resume` `{action:'SWAP'}` (`page.tsx` `handleConfirmPauseSwap`).
2. `BookingItemPauseService.swapKtvOnPausedItem`:
   - Chặng của A: chốt `actualEndTime`, `endTime`, `voidSegment(...,'CHANGED')` (tước tiền/giờ, vẫn ghi phút đã làm). A mất tua (`is_punished`) trừ khi quầy chọn giữ tua.
   - B: `TurnLedger` upsert (`SWAP_KTV`, chỉ A/B/C), `TurnQueue` → working, `KtvAssignments` upsert ACTIVE (`dispatch_source:'SWAP_KTV'`, **không có `segment_id`**).
   - Chặng mới của B: `{ ktvId, startTime, endTime:null, duration, customCommissionDuration, note:'TAKEOVER' }` — **không có `id`**, cố ý không có `actualStartTime` (chốt 10/09: đồng hồ B chạy khi B bấm Bắt đầu + ảnh).
3. B bấm Bắt đầu → `handleStartTimer` (dòng 62): `if (!target || !target.seg.id || ...) return fail('Chặng đã thay đổi hoặc đã hoàn tất; tải lại.')` → **kẹt vĩnh viễn**.

### 1.2 Nguyên nhân gốc
Điều kiện `!target.seg.id` thêm ngày 27/09 (`c18f3910`, để đơn nối tiếp bắt đầu đúng chặng KTV bấm). Chặng TAKEOVER chưa bao giờ có `id` → trước 27/09 vẫn bắt đầu được (prod 09–17/09: chặng TAKEOVER không id vẫn có giờ bắt đầu), từ 27/09 thì không. Prod: chưa có lần đổi giữa ca nào kể từ 27/09 → chưa ai gặp; lần đổi tiếp theo sẽ kẹt. Đơn nối tiếp A/B đi đường `performSequentialLifecycle` có tạo `id` → không dính (`test_sequential_live_segments` ĐẠT).

### 1.3 Vì sao KHÔNG dùng lại nguyên mã chặng của A
Chặng của A vẫn nằm trong cùng dịch vụ (đã chốt + `voided`). Trùng mã trong 1 dịch vụ làm sai các chỗ coi `id` là duy nhất:
| Chỗ | Hệ quả khi trùng mã |
|---|---|
| `ktv_release_work_atomic_base` (DB) — đánh dấu bàn giao theo `s->>'id'` | B bàn giao → chặng đã tước của A cũng bị đánh dấu, hồ sơ A sai |
| `guard_sequential_item_update` (DB) — tìm chặng cũ theo `id` `LIMIT 1` | có thể so chặng B với chặng đã kết thúc của A → chặn lệnh Bắt đầu của B |
| `protect_running_ktv_assignment` (DB) — so phân công theo `segment_id` | phân công A và B lẫn nhau |
| `lib/dispatch-live-guard.ts` dòng 8 — `find(s => s.id === current.id)` không xét KTV | quầy lưu form báo lỗi / ghi sai |

### 1.4 Sửa (1 file: `lib/services/BookingItemPauseService.ts`)
1. Chặng TAKEOVER thêm:
   - `id`: `` `${oldSeg?.id || bookingItemId}-takeover-${Date.parse(pauseTime)}` ``; nếu (rất hiếm) đã có chặng cùng mã trong item → thêm hậu tố `-2`, `-3`… Đổi lần 2 (B → C) tự ra mã mới từ mã chặng của B.
   - `replacesSegmentId: oldSeg?.id ?? null` — để tra "B thay chặng nào".
2. `KtvAssignments` upsert của B thêm `segment_id` = mã chặng mới (để `protect_running_ktv_assignment` và bàn giao khớp đúng chặng).
3. **Không** sửa `handleStartTimer`, không nới điều kiện bắt buộc `id`.
4. Dữ liệu cũ: prod hiện **0** chặng TAKEOVER đang dở không có `id` (đọc 08/10) → không cần sửa dữ liệu. Trước deploy chạy lại truy vấn chỉ đọc; nếu có → đưa SQL cho user chạy (gán `id` theo đúng công thức trên).

---

## 2. Lỗi 2 — Huỷ dịch vụ / huỷ đơn khi KTV chưa bắt đầu hoặc đang chờ

### 2.1 Logic đang chạy
- **Huỷ 1 dịch vụ** (`POST /api/bookings/cancel-item` → `BookingModificationService.cancelBookingItem`): chỉ tìm KTV qua `TurnQueue` có `current_order_id = đơn này` **và** `booking_item_ids` chứa dịch vụ. Với từng dòng: nhả `TurnQueue`, `punishTurnIfIdle` nếu không công, đóng `KtvAssignments` của dịch vụ + `promote_next_assignment`.
- **Huỷ cả đơn** (`cancelBooking` trong `app/reception/dispatch/actions.ts`): cũng chỉ duyệt `TurnQueue` có `current_order_id = đơn này`; chưa bắt đầu → xoá `TurnLedger` (hoàn tua), đã bắt đầu + không công → `punishTurnIfIdle`; đóng `KtvAssignments` + promote.

### 2.2 Nguyên nhân gốc
KTV đang bận đơn khác thì `TurnQueue.current_order_id` trỏ sang đơn kia → **cả 2 hàm huỷ bỏ sót KTV đang chờ**: `KtvAssignments` QUEUED còn treo, `TurnLedger` còn nguyên → xong đơn đang làm, `promote_next_assignment` kéo KTV sang đúng dịch vụ đã huỷ, app KTV hiện đơn đã huỷ (F09b: 4 mục HỎNG). Huỷ cả đơn: suy ra từ code, **chưa có test riêng** → thêm ca test F09c.

Thêm một điểm lệch luật: người **đã nhận nhưng chưa bắt đầu** — huỷ cả đơn thì hoàn tua, huỷ 1 dịch vụ không công thì bị tước tua (`is_punished`). User chốt: chưa bắt đầu = không nhận gì → thống nhất một luật.

### 2.3 Luật sau sửa (user chốt 08/10)
| Vai | Tiền | Giờ | Tua | Phân công |
|---|---|---|---|---|
| Chưa bắt đầu (đang chờ QUEUED / đã nhận nhưng chưa bấm Bắt đầu) | 0 | 0 | gỡ dòng tua của bill này (trừ khi còn dịch vụ khác cùng bill) | đóng CANCELLED, kéo đơn kế tiếp |
| Đã bắt đầu, huỷ **không công** | 0 | 0 | mất tua (`is_punished`) — **giữ như hiện tại** | giữ tới khi dọn phòng/bàn giao — **như hiện tại** |
| Đã bắt đầu, huỷ **có công** | như hiện tại | như hiện tại | giữ tua | như hiện tại |

Công tắc "có công" của quầy **không** áp cho người chưa bắt đầu (chưa làm phút nào).

### 2.4 Sửa
1. Hàm dùng chung mới trong `lib/services/BookingModificationService.ts`: `releaseUnstartedStaffBeforeCancel(supabase, bookingId, itemIds, actor)`:
   - Mỗi dịch vụ: lấy KTV có chặng **sống** (không `voided`) và **chưa** có `actualStartTime`/`actualEndTime`.
   - Gọi **đúng RPC quầy đang dùng khi bỏ phân công**: `dispatch_unassign_unstarted_staff(p_booking_id, p_item_id, p_ktv_id, p_expected_revision, p_actor, p_reject=false)` — đã có trên prod (đọc 08/10), đã chạy qua trong luồng KTV từ chối đơn (F12 ĐẠT). RPC tự: tước chặng (`UNASSIGNED`, 0 phút), đóng `KtvAssignments`, xoá `TurnLedger` nếu KTV không còn phân công khác trong bill, `promote_next_assignment`.
   - Gọi tuần tự, mang `revision` trả về sang lần gọi sau. RPC lỗi → **dừng huỷ, không ghi gì thêm**, trả lỗi "Đơn vừa thay đổi; tải lại rồi huỷ lại" (fail-closed, không để nửa vời).
2. `cancelBookingItem`: gọi hàm trên **trước** khi đổi dịch vụ sang CANCELLED. Phần xử lý người đã bắt đầu giữ nguyên.
3. `cancelBooking` (`actions.ts`): gọi hàm trên cho mọi dịch vụ sắp huỷ, **trước** vòng `TurnQueue` hiện có. Vòng cũ giữ nguyên cho người đã bắt đầu (người chưa bắt đầu lúc này đã được RPC gỡ, vòng cũ gặp lại thì `TurnLedger` đã trống → không đổi kết quả).
4. Không đổi RPC, không migration.

---

## 3. Ảnh hưởng chéo (4.1)
| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Lỗi 1: nút Bắt đầu của KTV vào thay chạy được. Lỗi 2: app KTV không còn nhận dịch vụ đã huỷ | Hộp Đổi KTV, nút Huỷ dịch vụ / Huỷ đơn — **không đổi giao diện** | `BookingItemPauseService`, `BookingModificationService`, `cancelBooking`, RPC `dispatch_unassign_unstarted_staff` | Sửa |
| Số liệu (tiền, tua, giờ) | Ví / lịch sử đọc chặng + `TurnLedger` | Sổ tua, tài chính đọc cùng nguồn | Lỗi 1: `customCommissionDuration` của TAKEOVER **không đổi** → tiền B không đổi. Lỗi 2: người chưa bắt đầu 0 tua thay vì `is_punished` | Khớp 2 phía (cùng nguồn) |
| Realtime | KTV nghe `BookingItems`/`KtvAssignments` | Bảng điều phối nghe `BookingItems` | không thêm kênh | Đồng bộ |
| Quyền | Không đổi | Không đổi | — | Không lộ dữ liệu |

## 4. Vùng nổ (4.5)
1. **Dùng chung gì?** `swapKtvOnPausedItem` chỉ gọi từ API đổi KTV. `cancelBookingItem` từ `/api/bookings/cancel-item`; `cancelBooking` từ bảng điều phối/Kanban. RPC unassign đang dùng ở bỏ phân công + KTV từ chối.
2. **Nếu sai thì sập gì?** Lỗi 1: tệ nhất KTV vào thay vẫn không bắt đầu được (= như hôm nay). Lỗi 2: RPC lỗi → huỷ bị chặn, quầy thấy thông báo, **không** để dữ liệu nửa vời; huỷ đơn không có KTV chưa bắt đầu đi đúng đường cũ.
3. **Luồng khách?** Không — WebBooking/WRB không gọi 3 hàm này; hoá đơn/journey đọc dịch vụ CANCELLED như cũ.
4. **Cô lập?** Mỗi sửa nằm trong đúng hàm của sự kiện; không chạm `getDispatchData`, `fetchBooking`, `handleStartTimer`.

## 5. Bảng hệ quả nghiệp vụ (mục 13)
**Lỗi 1 — Đổi KTV giữa ca (A bị đổi ra, B vào thay)** — chỉ đổi "B bắt đầu được"; mọi ô khác giữ như hôm nay:
| Khía cạnh | A (bị đổi ra) | B (vào thay) |
|---|---|---|
| Tiền tua | 0 (`voided`) — không đổi | theo `customCommissionDuration` — không đổi |
| Giờ tích luỹ (Loại D) | 0 — không đổi | theo chặng TAKEOVER — không đổi |
| Lượt tua | mất (`is_punished`) / giữ nếu quầy chọn — không đổi | +1 `SWAP_KTV` (A/B/C) — không đổi |
| Thưởng / đánh giá khách tính cho ai | không — không đổi | B — không đổi |
| Dọn phòng / bàn giao | không — không đổi | B bàn giao; giờ khớp đúng chặng nhờ `segment_id` |
| Nợ phòng / chặn tan ca | không | như dịch vụ thường |
| Hạn mức bỏ qua | không áp dụng — không phải bỏ qua | không áp dụng |
| Hàng đợi | về waiting / đơn kế — không đổi | ACTIVE, **thêm `segment_id`** |
| Màn app KTV | không còn đơn | **bấm Bắt đầu được** (hôm nay: kẹt) |
| Đồng hồ | đã dừng | chạy khi B bấm Bắt đầu + ảnh — không đổi |
| Tự chốt / Kanban / "cùng làm với" / lịch sử / nhật ký quầy / lý do | không đổi | không đổi (+ `replacesSegmentId` để tra) |

**Lỗi 2 — Huỷ dịch vụ / huỷ đơn (người chưa bắt đầu)**:
| Khía cạnh | Chưa bắt đầu (QUEUED hoặc đã nhận) | Đã bắt đầu |
|---|---|---|
| Tiền tua | 0 | không đổi |
| Giờ tích luỹ | 0 (chặng `UNASSIGNED`, 0 phút) | không đổi |
| Lượt tua | gỡ (không tính) | không đổi |
| Thưởng / đánh giá | không | không đổi |
| Dọn phòng / bàn giao | không phải làm | không đổi (vẫn dọn) |
| Nợ phòng / chặn tan ca | không | không đổi |
| Hạn mức bỏ qua | không áp dụng — quầy huỷ, không phải KTV bỏ qua | không áp dụng |
| Hàng đợi | đóng CANCELLED, kéo đơn kế tiếp; **không bao giờ được kéo sang dịch vụ đã huỷ** | không đổi |
| Màn app KTV | không hiện dịch vụ đã huỷ | không đổi |
| Đồng hồ | không áp dụng — chưa chạy | không đổi |
| Tự chốt | không áp dụng | không đổi |
| Thẻ Kanban | dịch vụ huỷ, không còn tên KTV này | không đổi |
| "Cùng làm với" | không tính | không đổi |
| Lịch sử KTV | không hiện dịch vụ này (giống quầy bỏ phân công) | không đổi |
| Nhật ký quầy | ghi "bỏ phân công" (RPC) + "huỷ dịch vụ" như hiện tại | không đổi |
| Lý do | lý do huỷ của quầy | không đổi |

## 6. Test (DB TEST, trước khi xin deploy) — bắt buộc ĐẠT hết
1. `qa_28` F07 (đổi A→B → B bắt đầu → hoàn tất → bàn giao → DONE) và F09b (huỷ dịch vụ đang chờ) phải ĐẠT.
2. Ca mới thêm vào `qa_28`:
   - F07b đổi 2 lần A→B→C: mã chặng không trùng, chỉ C bắt đầu được, bàn giao của C không đụng chặng A/B.
   - F07c đổi KTV trên đơn 2KTV-1DV (đổi một người): người còn lại không bị ảnh hưởng.
   - F07d đổi sang KTV Loại D: sổ tiền Loại D tính theo chặng TAKEOVER.
   - F09c **huỷ cả đơn** khi KTV đang chờ.
   - F09d huỷ 1 dịch vụ khi KTV đã nhận nhưng chưa bắt đầu (trước: mất tua; sau: không tính tua).
   - F09e KTV có 2 dịch vụ cùng bill, huỷ 1 dịch vụ chưa bắt đầu → vẫn giữ tua cho dịch vụ còn lại.
3. Hồi quy: toàn bộ `qa_28`, `test:flow-db`, `test:ghep-db`, `test:huy-gop-db`, `test:huy-gop-dang-lam-db`, 22 script nối tiếp (đối chiếu với kết quả 08/10: 12 ĐẠT), chạy thêm dưới `TZ=UTC` và ca đêm.
4. Đối chiếu 2 phía (4.3): tua/tiền của A, B, C ở app KTV = sổ tua + tài chính phía quản lý.

## 7. Lùi
- Revert commit. Không migration, không đổi RPC.
- Dữ liệu ghi sau deploy: chặng TAKEOVER có `id` — bản cũ vẫn đọc được (thêm trường không phá gì). Huỷ đã gỡ tua người chưa bắt đầu — đúng luật mới, không cần lùi.

## 8. Ảnh hưởng vận hành (dự kiến, trình lại trước commit — mục 5.1)
| Ai | Khác gì so với hôm nay | Nếu lỗi thì ai không làm việc được | Cần báo gì |
|---|---|---|---|
| Quầy | Đổi KTV giữa ca chạy trọn vòng; huỷ dịch vụ/đơn có KTV đang chờ thì KTV đó được giải phóng ngay | Huỷ có thể bị chặn kèm thông báo "tải lại rồi huỷ lại" | Không đổi thao tác |
| KTV | Người vào thay bấm Bắt đầu được; KTV đang chờ không còn bị kéo sang đơn đã huỷ; huỷ khi chưa bắt đầu = không tính tua | Người vào thay vẫn kẹt (= hôm nay) | Báo: "chưa bắt đầu mà khách huỷ thì không tính tua" |
| Admin / khách | Không | Không | Không |

## 9. Sau khi làm
Cập nhật mục 2 và 3 của `plans/nghiep_vu_tam_dung_doi_huy.md` (dòng Đổi KTV, Huỷ dịch vụ, Huỷ đơn).

## 10. Bổ sung 09/10/2026 (user: "fix lỗi này trước")
Test thêm (trigger bật/tắt, dữ liệu cũ dạng chuỗi, ca đêm) lộ lỗ cũ 14/09: đổi A → B rồi huỷ trước khi B bắt đầu → sổ tua B kẹt "đang làm" trên đơn đã huỷ. Hai nguyên nhân, cùng 2 file đã sửa:
1. `pullIncomingKtvToWorking` (dòng A/B có sẵn) không ghi `booking_item_ids` → hàm huỷ (`contains booking_item_ids`) không thấy B. Sửa: ghi `booking_item_ids`, **gộp** với dịch vụ B đang giữ trên cùng đơn (không làm mất dịch vụ khác của B — `qa_28` F07f).
2. `cancelBookingItem` xét "đã bắt đầu" theo **cả dịch vụ** → chặng đã bắt đầu của A làm B bị giữ "để dọn phòng". Sửa: xét theo **từng KTV** (`ktvMatchesSeg`).

Kết quả: `qa_28` 378/378 (TZ=UTC, ca đêm), hồi quy ghép/huỷ gộp/luồng đạt, 22 script nối tiếp y hệt trước sửa.
**Còn lỗ có sẵn, chưa sửa:** đổi A → B rồi huỷ dịch vụ → chặng đã bắt đầu của A không ai bàn giao → đơn giữ FEEDBACK sau khi khách chấm. Cần chốt nghiệp vụ.
**Chưa test:** chuyển qua 00:00 (bắt đầu trước, đổi/huỷ sau) — script `QA_CROSS_MIDNIGHT=1`, khởi chạy 23:45–23:58.

## 11. Bổ sung 09/10/2026 — người bị đổi ra không phải bàn giao (user: "cho phép bỏ qua")
Tình huống: đơn 2 dịch vụ; A bắt đầu dịch vụ 2 → quầy đổi A sang B → khách bỏ dịch vụ 2 trước khi B bắt đầu → quầy huỷ dịch vụ 2. Khách chấm xong, đơn kẹt FEEDBACK vì hàm chốt đơn chờ A bàn giao (A đã bị đổi ra, không còn đơn trên app).
Sửa (`app/reception/dispatch/actions.ts`, `lib/services/BookingModificationService.ts`):
1. `submitCustomerRating`: xét "đã bàn giao hết" bỏ qua chặng `voided` + `note 'CHANGED'` (người bị đổi ra). Chặng huỷ không công đã bắt đầu (`CANCELLED_NO_CREDIT`) **vẫn** phải bàn giao — luật cũ giữ nguyên.
2. `cancelBookingItem`, `cancelBooking`: không tước lại chặng đã tước → giữ dấu `CHANGED` (trước: ghi đè thành `CANCELLED_NO_CREDIT`, tiền vẫn 0 như nhau).
3. `submitCustomerRating`: không đổi dịch vụ CANCELLED thành DONE (trước: dịch vụ huỷ có chặng đã kết thúc bị đổi thành DONE khi đơn chốt).
Lệch 2 phía ghi nhận: phía KTV (`segmentProgress`) đã bỏ qua mọi chặng `voided` khi xét bàn giao; phía quầy giờ bỏ qua chặng bị đổi ra. Chưa gom về một hàm (ngoài phạm vi).
Kiểm: `qa_28` 397/397 (TZ=UTC, ca đêm) — F07f đơn DONE, dịch vụ huỷ giữ CANCELLED, chặng A giữ `CHANGED`; F09f huỷ không công đã bắt đầu: chưa bàn giao thì đơn chưa chốt, bàn giao xong thì DONE. Hồi quy đạt; 22 script nối tiếp y hệt.

## 12. Quyết định 09/10/2026 — HƯỚNG 2 cho nhánh này
User chốt luật "người làm cuối cùng bàn giao phòng" nhưng luật đó còn nằm trong hàm DB `ktv_release_work_atomic_base` → làm riêng (hướng 1, `plans/plan_nguoi_lam_cuoi_ban_giao_phong.md`, test DB TEST + Vercel Hobby).
Nhánh này (hướng 2) **giữ luật hiện hành** cho "đã bắt đầu rồi bị huỷ không công": vẫn phải bàn giao, cả quầy lẫn DB — nhất quán cho mọi thứ tự bấm (`qa_28` F20: cả hai thứ tự đều chờ A, A bàn giao xong → Hoàn tất). Phần code tầng app của hướng 1 đã gỡ ra, lưu ở `plans/huong1_nguoi_lam_cuoi_ban_giao_app.patch`.
Kết quả cuối: `qa_28` 439/439 (TZ=UTC, ca đêm, trigger bật); test:ghep, ghep-db, flow-db, huy-gop-db, huy-gop-dang-lam-db ĐẠT; `qa_kanban_sequential_hold` 36/36; 22 script nối tiếp y hệt mốc trước sửa.
Ghi nhận có sẵn (không sửa): F20c — huỷ phần A khi A đang làm thì B (lượt 2) không bắt đầu được.
