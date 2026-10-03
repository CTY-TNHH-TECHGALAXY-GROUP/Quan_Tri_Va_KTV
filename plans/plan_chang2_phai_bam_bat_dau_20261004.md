# Plan Mức 2 — Chặng 2 (cùng KTV, cùng đơn) phải bấm "Bắt đầu" thật

> Ngày: 04/10/2026 · Trạng thái: **ĐÃ DUYỆT + ĐÃ CODE (04/10)** — mô phỏng `scripts/qa/qa_chang2_bat_dau.cjs` 12/12 đạt (cả TZ=UTC), tsc 0 lỗi. Chưa test tay trên TEST.
> Nhánh: `test/sequential-two-slot-handoff-20260928`, sửa ngay trên bản merge phase1 → test đang dở (chưa commit).
> Vì sao Mức 2: sửa handler dispatch `app/api/ktv/booking/_handlers/handleStartTimer.ts` và luồng lõi `app/ktv/dashboard/KTVDashboard.logic.ts` (mục 8, 9 CLAUDE.md).

## 0. Quyết định đã chốt (04/10/2026)

| # | Câu hỏi | Chốt |
|---|---|---|
| a | Khi nào được bấm chặng 2 (sửa 04/10) | **Theo giờ dự kiến bắt đầu admin gán cho chặng 2** (giống chặng 1: không bấm sớm hơn giờ gán), và chặng 1 phải đã đóng (KTV không làm 2 chặng một lúc). **Giờ ghi nhận luôn là giờ thực tế lúc KTV bấm.** |
| b | KTV quên bấm | **Nhắc**: nhắc KTV trên app sau 5 phút, báo quầy sau 10 phút. |
| c | Ảnh dép (sửa 04/10) | Chặng 2 chỉ có trong **cùng một đơn**, mà một đơn = một khách (nhiều khách đã tách đơn con; TEST 60 ngày: 46 đơn đã điều phối, 0 đơn lẫn khách). Nên chặng 2 **dùng lại ảnh dép chặng trước**. Khác khách = đơn khác: chụp dép mới. Đơn cũ lẫn nhiều khách (nếu có): coi như khác khách, chụp mới. |
| d | Lượt B nối tiếp (sửa 04/10) | B vẫn phải bấm, chỉ bấm được khi A đã bắt đầu. **B nhận lại ảnh dép của A** (cùng đơn, cùng khách), B chỉ chụp ảnh bắt đầu của mình. A chưa có ảnh dép (đơn cũ) thì B chụp mới. |

| e | Đổi KTV giữa chừng (người vào thay) (chốt 04/10) | Làm như B: người vào thay **nhận lại ảnh dép** của người trước, chỉ chụp ảnh bắt đầu của mình. |
| f | Phạm vi thời gian (chốt 04/10) | **Chỉ áp dụng cho lần bấm từ khi deploy trở đi. Không sửa / không backfill dữ liệu đơn quá khứ.** |

Luật ảnh dép gộp: KTV bắt đầu một chặng mà **trong cùng đơn (cùng khách) đã có ảnh dép** thì dùng lại ảnh đó; chưa có thì bắt buộc chụp mới. Áp chung cho chặng 2, lượt B, người vào thay.

Luật chung: **không chặng nào có giờ bắt đầu nếu KTV chưa bấm "Bắt đầu" và chưa có ảnh bắt đầu.** Máy chủ quyết định, điện thoại chỉ hiển thị theo máy chủ.

## 1. Hiện trạng & nguyên nhân gốc

- Cả phase1 lẫn test: khi KTV xong chặng 1, app gửi `NEXT_SEGMENT` và **máy chủ ghi `actualStartTime` cho chặng 2 ngay lúc đó** (`handleStartTimer`: `entry.seg.actualStartTime = now` cho `run = [target]`).
- Phase1 thêm "Cách B" ở `KTVDashboard.logic.ts` (`handleStartTimer`, nhánh `activeSegmentIndex > 0`): dừng đồng hồ, KTV bấm Bắt đầu, nhưng chỉ chạy đồng hồ **trên điện thoại**. Lệnh `START_TIMER` gửi đi không chờ kết quả, lỗi bị nuốt.
- Sau merge, `START_TIMER` chặng 2 tới máy chủ (bản test) thì gặp `target.seg.actualStartTime` đã có, nên trả thành công mà **không lưu ảnh bắt đầu**. Đồng hồ điện thoại tính từ lúc bấm, DB tính từ lúc xong chặng 1, nên khi tải lại thì đồng hồ nhảy.
- Ảnh dép dùng lại được gửi dưới dạng URL. `upload()` của máy chủ chỉ nhận base64, nên sẽ báo "Ảnh phải là JPEG…".
- Guard "Ca trước chưa bàn giao" (`ktv_start_service_atomic`) chỉ chặn khi `TurnQueue.current_order_id` **khác** đơn. Chặng 2 cùng đơn không bị chặn (đã kiểm tra trong migration 20260929010000).

## 2. Thay đổi

### S1. Máy chủ: `handleStartTimer.ts` (handler duy nhất được sửa; đọc header trước khi sửa, mục 9.2)
1. **`NEXT_SEGMENT`**: chỉ đóng chặng trước (`previous.seg.actualEndTime = now`), **không** ghi `actualStartTime` cho chặng đích. Không tải ảnh. Trạng thái item tính như cũ: item chặng 1 xong hết → CLEANING (nếu không phải nối tiếp 2 slot). Item chặng 2 giữ nguyên trạng thái chờ.
   - TurnQueue: giữ `working` cho KTV (vẫn đang trong đơn), `estimated_end_time` chưa cập nhật cho tới khi bấm chặng 2.
2. **`START_TIMER` cho chặng đích không phải chặng đầu tiên của KTV trong đơn**:
   - Bắt buộc **chặng trước của chính KTV này trong cùng đơn đã đóng** (`actualEndTime`). Chưa đóng thì báo: "Chặng {n} chưa kết thúc."
   - **Giữ chặn giờ giao** (`allowedAt` = `plannedStartAt` / `startTime` admin gán, sai số 5 giây) như chặng 1 (quyết định a).
   - `actualStartTime` = giờ máy chủ lúc nhận lệnh bấm (giờ thực tế), không lấy giờ gán.
   - Ví dụ: chặng 2 gán 15:00.
     - Chặng 1 xong 14:50 → nút Bắt đầu chặng 2 khoá tới 15:00. KTV bấm 15:02 → ghi 15:02.
     - Chặng 1 xong muộn 15:10 → bấm được ngay. KTV bấm 15:11 → ghi 15:11.
   - **Ảnh bắt đầu: bắt buộc**, ảnh base64 mới.
   - **Ảnh dép**: có base64 mới thì dùng. Không có thì lấy `guestSlipperPhotoUrl` từ chặng trước gần nhất **trong cùng đơn** của cùng khách (`guest_id`). Không tìm thấy thì bắt buộc chụp mới.
   - Chặng đã có `actualStartTime` thì giữ hành vi cũ: trả thành công, không ghi đè (chống bấm 2 lần).
3. Lượt B nối tiếp (`sequenceSlot === 2 && isTwoSlotSequential`): giữ mọi điều kiện cũ (A đã bắt đầu, B còn được gán). Chỉ đổi phần ảnh: **ảnh dép lấy lại từ chặng A** (`sequenceSlot === 1`, không voided) nếu B không gửi ảnh mới. Ảnh bắt đầu của B vẫn bắt buộc.
   - App KTV của B: màn bắt đầu hiện "✓ Đã có ảnh dép (từ lượt 1)", chỉ còn ô ảnh bắt đầu.
4. Không sửa handler khác, không inline vào `route.ts` (mục 9.1, 9.3).

### S2. App KTV: `KTVDashboard.logic.ts` (không tách file, mục 8)
1. "Cách B" (`activeSegmentIndex > 0`): **chờ** máy chủ trả lời (`await`), gửi `targetSegmentId` của chặng đích, **không** gửi ảnh dép dạng URL (gửi base64 nếu KTV chụp mới, không thì bỏ trống để máy chủ dùng lại).
   - Thành công: lấy mốc `actualStartTime` từ máy chủ, đồng hồ theo Absolute Time (`Date.now() + offset - timerStartMsRef.current`), không dùng `prev - 1`.
   - Lỗi: báo KTV, **không** chạy đồng hồ, tải lại đơn.
   - Thời lượng chặng 2 lấy theo phút được giao (`ktvAssignedMinutes` / `seg.duration`), **bỏ** mặc định 60.
2. Auto-advance (`handleFinishTimer`, còn chặng sau): giữ logic phase1 (dừng đồng hồ, chờ KTV bấm). Đảm bảo lần fetch Realtime sau đó **không** tự chạy đồng hồ chặng 2 vì chặng chưa có `actualStartTime`. Kiểm `justStartedLocally()` và guard `isTimerRunningRef`.
3. Giữ 4 luồng lõi mục 8: Commission Flow, Continuous Receiving, State Integrity (`postServiceBookingId`), Smart Sync.

### S3. Nhắc khi quên bấm (quyết định b), phía client, không cần cron
- Mốc tính trễ = **thời điểm được phép bấm** = muộn hơn giữa *giờ dự kiến bắt đầu chặng (admin gán)* và *giờ chặng trước đóng*.
- **App KTV**: quá **5 phút** sau mốc mà chưa bấm thì hiện nhắc "Bạn chưa bắt đầu chặng {n}", lặp mỗi 5 phút, kèm âm báo nếu app đang bật âm. Trước mốc thì nút khoá, kèm chữ "Bắt đầu lúc {giờ gán}".
- **Quầy** (Điều phối / Kanban): quá **10 phút** sau mốc thì thẻ đơn hiện nhãn đỏ "KTV {mã} chưa bắt đầu chặng {n} · trễ {x} phút so với giờ gán", và toast 1 lần cho mỗi chặng.
- Hằng số `REMIND_KTV_AFTER_MIN = 5`, `ALERT_COUNTER_AFTER_MIN = 10` khai báo đầu file. Chữ hiển thị đặt trong `*.i18n.ts`.

### S4. Hiển thị trên quầy
- Kanban / Điều phối: chặng đã đóng nhưng chặng sau chưa bấm thì hiện "**Chờ bắt đầu chặng {n}**", không hiện "Đang làm".

## 3. Bảng hệ quả nghiệp vụ (mục 13)

Vai: **KTV làm chặng 1 + chặng 2** (cùng đơn). Không có vai thứ hai, vì quyết định d giữ nguyên lượt B.

| Khía cạnh | Kết quả |
|---|---|
| Tiền tua | **Không đổi.** Hoàn tất bình thường trả theo thời lượng giao (`computeMinutes`). Chặng chưa bấm, sau đó quầy huỷ thì theo luật huỷ hiện có. |
| Giờ tích luỹ | Chặng 2 tính từ **giờ thực tế bấm**, không gồm khoảng chờ. Vẫn chặn trần ở thời lượng giao. |
| Lượt tua | Không đổi (vẫn 1 đơn). |
| Thưởng | Không đổi (theo đánh giá khách, mục thang sao). |
| Đánh giá khách tính cho ai | Không đổi. |
| Dọn phòng / bàn giao | Phòng chặng 1 cần bàn giao như cũ. **Không chặn** bắt đầu chặng 2 vì cùng đơn. |
| Nợ phòng / chặn tan ca | Không đổi. |
| Hạn mức bỏ qua | Không áp dụng (không có thao tác bỏ qua mới). |
| Hàng đợi (TurnQueue / KtvAssignments) | KTV giữ `working` giữa 2 chặng. `estimated_end_time` cập nhật khi bấm chặng 2. |
| Màn app KTV | Xong chặng 1 thì hiện màn bắt đầu chặng 2: ảnh dép đã có, chụp ảnh bắt đầu, bấm. |
| Đồng hồ | Theo mốc máy chủ, không nhảy khi tải lại. |
| Tự chốt | Chặng chưa bắt đầu thì không tự chốt. Có nhắc (S3). |
| Thẻ Kanban | "Chờ bắt đầu chặng {n}", quá 10 phút thì nhãn đỏ. |
| "Cùng làm với" | Không đổi. |
| Lịch sử KTV | Giờ chặng 2 đúng giờ bấm. Có ảnh bắt đầu chặng 2. |
| Nhật ký quầy | Không đổi. |
| Lý do | Không áp dụng. |

## 4. Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `app/ktv/dashboard` (logic + ScreenTimer chặng 2) | `app/reception/dispatch` (Kanban, nhắc 10 phút) | `handleStartTimer`, RPC `ktv_start_service_atomic` (không sửa RPC) | Sửa |
| Số liệu (tiền / giờ) | Lịch sử, ví đọc ledger | Báo cáo đọc ledger | `KtvDLedgerEngine.computeMinutes` (không sửa) | Khớp. Tiền không đổi, giờ đúng hơn. |
| Realtime | `BookingItems` | `BookingItems`, `TurnQueue` | Không thêm kênh | Đồng bộ |
| Quyền xem | Không đổi | Không đổi | | Không lộ dữ liệu |

## 5. Kiểm thử (bắt buộc, mục 9.8 + 10)

Mô phỏng bằng mock (Node, định dạng giống DB, chạy thêm `TZ=UTC`), sau đó chạy thật trên TEST:
1. 1 KTV, 1 dịch vụ: không đổi.
2. 1 KTV, 2 dịch vụ cùng phòng (gộp): vẫn 1 chặng "(Gộp)", không có chặng 2.
3. 1 KTV, 2 chặng **khác phòng**, cùng khách: xong chặng 1, đồng hồ dừng, ảnh dép dùng lại, chụp ảnh bắt đầu, bấm, DB ghi đúng giờ bấm và ảnh.
4. 1 KTV, 2 chặng, **khác khách cùng đơn**: dùng ảnh dép chặng trước.
5. Bấm chặng 2 khi chặng 1 chưa đóng: bị từ chối.
5b. Chặng 1 xong sớm hơn giờ gán chặng 2: nút khoá tới giờ gán; bấm muộn hơn thì DB ghi đúng giờ bấm thực tế.
5c. Chặng 1 xong muộn hơn giờ gán chặng 2: bấm được ngay; nhắc tính từ lúc chặng 1 đóng.
6. Bấm 2 lần / mạng chập chờn: không ghi đè giờ, không mất ảnh.
7. Nối tiếp A/B (2 KTV, 1 dịch vụ): B vẫn phải chờ A bắt đầu; B chỉ chụp ảnh bắt đầu; DB của B có `guestSlipperPhotoUrl` = ảnh của A.
7b. Nối tiếp A/B mà A thiếu ảnh dép (đơn cũ): B bắt buộc chụp dép.
8. Ca qua nửa đêm: chặng 1 kết thúc 23:55, chặng 2 bấm 00:05.
9. Nhắc: 5 phút trên app KTV, 10 phút trên quầy.
10. Tiền / giờ: đối chiếu ledger 2 phía (mục 4.3), cùng một KTV và cùng khoảng ngày.

## 6. Rủi ro & deploy

- App KTV bản cũ còn cache sẽ vẫn chạy "Cách B" kiểu cũ (không chờ máy chủ). Máy chủ mới sẽ không còn tự bắt đầu chặng 2, nên KTV đó phải tải lại app. **Deploy máy chủ và app cùng lúc.** Báo KTV tải lại app sau deploy.
- Không có migration.
- Cách lùi: revert commit. Không có dữ liệu cần sửa.
