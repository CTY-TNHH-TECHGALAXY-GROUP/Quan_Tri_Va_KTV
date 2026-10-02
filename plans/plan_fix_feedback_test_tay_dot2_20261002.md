# Plan — Feedback test tay đợt 2 (02/10/2026)

Mức 2 (chạm `KTVDashboard.logic.ts`, `app/reception/dispatch/*`). Chờ duyệt.

## Gốc chung của việc "phải reload nhiều"

Trigger `keep_dispatch_edit_history` tăng `dispatchRevision` mỗi khi **bất kỳ** trường nào của chặng đổi:

- Thao tác của KTV: bấm bắt đầu, kết thúc, bàn giao.
- Một lần lưu của quầy thường tăng 2–3 bậc (lưu chặng, lưu tên dịch vụ, lưu metadata).

Mỗi thao tác của quầy (lưu, điều phối, gán B) gửi kèm revision lúc mở form hoặc popup. Lệch revision thì server từ chối với câu **"Dịch vụ đã có bản lưu mới. Tải lại đơn…"**. Vì vậy chỉ cần KTV bấm gì đó trong lúc quầy đang mở form, hoặc quầy bấm 2 lần, là lỗi xuất hiện. Server không sai: revision dùng để chống ghi đè. Cái thiếu là phía trình duyệt **không tự cập nhật lên revision mới** khi phần thay đổi chỉ là dữ liệu chạy của KTV.

## G1 — B bắt đầu trước khi A kết thúc ~20 giây: màn B quay lại khung chụp ảnh rồi mới chạy giờ

**Nguyên nhân** (`KTVDashboard.logic.ts`):

1. Khi START thành công, client xoá ảnh, đặt `timerStartMsRef` và bật đồng hồ, nhưng **bỏ qua `bookingData` server trả về**. Vì vậy bản đơn trong máy vẫn coi chặng B là chưa bắt đầu.
2. Đúng lúc đó A kết thúc, kéo theo realtime và một lần `fetchBooking()`. Lần fetch này có thể đọc DB **trước** khi START của B được ghi, nên trả về B "chưa bắt đầu".
3. Bản dữ liệu cũ đó đi vào dòng ~1328 (`timerStartMsRef.current = 0`), rồi dòng ~753 (`setIsTimerRunning(false)`). Màn TIMER hiện lại khung ảnh, vì khung ảnh hiện khi đồng hồ tắt (`ScreenTimer.tsx:461`).
4. Lần fetch sau có giờ bắt đầu của B, đồng hồ chạy lại.

**Sửa:**

- (a) Sau START, áp ngay `bookingData` server trả về vào `setBooking`.
- (b) Bỏ qua phản hồi fetch được gửi đi **trước** lần START gần nhất (ghi mốc thời gian vào một ref).
- (c) Không tắt đồng hồ hay reset `timerStartMsRef` khi đồng hồ đang chạy trong máy mà dữ liệu về lại cũ hơn.
- Không đổi đồng hồ tuyệt đối, không đổi 4 luồng lõi ở mục 8.

## G2 — A/B đã nhận đơn, quầy bỏ B và đổi giờ A: báo lỗi, reload cũng không thao tác được

**Đã kiểm trên TEST bằng server action thật** (`scripts/qa/probes_20261002/repro_g2_remove_b_edit_a.ts`):

- Cả 3 đường lưu (lưu theo hàng, Lưu, Điều phối) đều **lưu đúng** khi revision còn đúng: A 30→45 phút, B bị void, technicianCodes còn A.
- Lỗi nằm ở phía trình duyệt:
  - **Hàng B ma.** Sau khi lưu, `mergeSavedDispatchForm` dựng lại `staffList` từ **mọi** chặng, kể cả chặng B đã void. Form lại hiện B ở lượt B (đã kiểm: `A[S1] | B[S2(void)]`). Quầy tưởng chưa bỏ được B, thao tác lại; lần này gửi kèm hàng ma và revision của bản nháp cũ.
  - **Bản nháp sống qua reload.** Bản nháp được giữ trong `sessionStorage` (`persistDraftCache`), nên reload xong vẫn nạp lại đúng bản nháp lỗi đó, với revision cũ.
    - Banner "Bỏ bản nháp và xem bản mới" có hiện, nhưng nhỏ và dễ bỏ qua.

**Sửa:**

- (a) `mergeSavedDispatchForm` và bộ dựng `technicianCodes` của nút Lưu chỉ lấy hàng có chặng **chưa void**.
- (b) Khi nạp bản nháp từ cache: bản nháp **không có thay đổi của người dùng** so với bản đã lưu thì bỏ luôn. Nếu có thay đổi thì giữ và hiện banner rõ hơn.
- Sẽ kiểm lại bằng E2E đăng nhập thật bằng tài khoản `seq_admin` trên dev server local, để chắc rằng không còn câu lỗi nào khác.

## G3 — Bật nhầm "Nối tiếp" mà chưa gán nhân viên → nút "x" tắt

- **Hiện tại:** chỉ có link nhỏ "Bỏ nối tiếp" lúc đơn còn nháp (`QuickDispatchTable.tsx:1891`). Sau khi đã điều phối thì không có cách nào; trigger DB còn cấm bỏ `sequentialSlots` khi lưu.
- **Sửa:** thêm nút **×** ở tiêu đề lượt B, hiện **chỉ khi B chưa có nhân viên**:
  - Đơn còn nháp → tắt nối tiếp ngay trên form (không gọi server).
  - Đơn đã điều phối, B trống → **đóng lượt B** (`performSequentialLifecycle` CANCEL `targetSlots:[2]`, lý do "Bật nhầm nối tiếp"). Không cần migration. A làm xong thì đơn hoàn tất bình thường.
  - B đã có người hoặc đã bắt đầu → không hiện nút × (dùng popup đổi/huỷ A/B như hiện tại).

## G4 — Popup "Gán B" ở Kanban: thêm ô "Nhập tên dịch vụ (nếu có thay đổi)"

- Popup ở `page.tsx:3456-3495`, lưu qua `handoffSequentialKtv` → ASSIGN_B. RPC này đã lưu sẵn `options.serviceNamesForKtvs`.
- **Sửa:** thêm ô nhập, placeholder mờ là tên dịch vụ hiện tại (`ktvServiceName`). Có nhập thì ghi `serviceNamesForKtvs[B] = tên`. Không đổi server.
  - App KTV hiện tên này cho B qua `ktvServiceName` có sẵn.

## G5 — Gán B khi A đã bắt đầu: lưu được nhưng vẫn báo lỗi; bấm lần 2 phải báo kết quả lần 1

**Nguyên nhân** (đơn SEQ_LIVE_10020033_3: r3 + r4 ASSIGN_B cùng giây 03:49:29):

- Nút Xác nhận chặn bấm đôi bằng state React (`liveHandoff.saving`). Hai cú bấm trong cùng một lần render đều qua được. Lần 1 lưu thành công (tăng revision 2 bậc), lần 2 mang revision cũ nên bị từ chối và hiện alert lỗi, dù B đã được gán.

**Sửa:**

- (a) Chặn gửi trùng bằng `useRef`, dùng cho popup gán B, Lưu, Điều phối và lưu theo hàng.
- (b) Lần gửi bị từ chối vì revision thì **đọc lại server**. Nếu server đã đúng như yêu cầu (B đã gán đúng KTV và giờ, hoặc bản lưu khớp form), báo **"Đã điều phối thành công (thao tác trước đã được lưu)"** thay vì báo lỗi.

## G6 — Giảm reload, cho cảm giác như app

Làm theo thứ tự rủi ro thấp trước:

1. **Tự cập nhật revision khi thay đổi chỉ là dữ liệu chạy của KTV** (giờ bắt đầu/kết thúc, bàn giao):
   - Popup gán B và lưu theo hàng lấy revision mới nhất từ realtime **lúc bấm**, không giữ số lúc mở.
   - Form đang có bản nháp thì rebase lên revision mới khi phần quầy sửa không đụng các trường đó. Hàm `runtimeOnly` đã có sẵn, chỉ dùng thêm ở các chỗ còn thiếu.
2. **Gặp xung đột thật** (người khác đổi kế hoạch) → hiện ngay trong form: "Đơn vừa được cập nhật — [Xem bản mới] / [Giữ bản đang sửa]". Không bắt reload trang.
3. **Sau khi lưu thành công, không tải lại cả bảng** (`fetchData()`). Áp ngay bản server trả về, realtime lo phần còn lại.
4. G2 (b) và G5 (b) như trên.

- **Không đề xuất** đổi trigger để KTV thao tác không tăng revision: revision đang chống ghi đè giờ thực tế. Đổi trigger là việc lớn, rủi ro cao hơn.

## Phát hiện thêm, cần quyết định riêng — giờ dự kiến của đơn sau nửa đêm lệch 1 ngày

- Đơn SEQ_LIVE_10020033_3, B 03:46 ngày 02/10 nhưng `plannedStartAt` = `2026-09-30T20:46Z`, tức 03:46 ngày **01/10**.
- RPC gán B và kế hoạch điều phối dựng giờ bằng `"bookingDate"::date + giờ (+07)`. `bookingDate` lưu theo UTC, nên đơn 00:00–07:00 giờ VN bị lệch sớm 1 ngày.
- Đây là P1-2 đã ghi trước đó. Hệ quả: B "đến giờ" sớm, thứ tự hàng chờ và kiểm tra chồng giờ sai cho ca đêm.
- Cần migration (Mức 2). Đề xuất làm thành một việc riêng sau đợt này.

## Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | G1: màn TIMER; G4: tên dịch vụ của B | G2–G6: trang điều phối, Kanban, popup gán B | `dispatch-form-draft.ts`; ASSIGN_B; lifecycle CANCEL | Sửa client, không đổi API / RPC |
| Số liệu (tiền, giờ, tua) | Không đổi | Không đổi | — | Không ảnh hưởng — vì không chạm công thức hay ledger |
| Realtime | G1 bỏ qua dữ liệu cũ hơn START | G6 rebase revision theo realtime | BookingItems | Đồng bộ hơn |
| Quyền | Không đổi | Không đổi | — | Không đổi |

## Test

- G1: E2E 2 trình duyệt (A, B), B bắt đầu trước khi A kết thúc 20 giây; ghi lại `isTimerRunning` không về false.
- G2: E2E đăng nhập `seq_admin`: bỏ B + đổi giờ A khi cả 2 đã nhận đơn; reload; thao tác tiếp.
- G5: bấm đôi Xác nhận gán B; bấm lại sau khi đã thành công.
- G3: bật nhầm nối tiếp ở đơn nháp và ở đơn đã điều phối, rồi bấm ×.
- G4: nhập tên dịch vụ cho B, kiểm app KTV.
- Hồi quy: unit 7/7, demo E2E 17/17, 10 đơn 165/165, probe từ chối 24/24, mô phỏng bàn giao 12/12. Edge case: 1KTV-1DV, 1KTV-2DV gộp, 2KTV-1DV, ca đêm, chạy dưới TZ=UTC.

## Đã làm (02/10/2026)

| Mục | Thay đổi | Kiểm |
|---|---|---|
| G5 | `page.tsx`: chặn gửi trùng bằng `liveHandoffBusyRef`; lượt B còn y như lúc mở popup thì dùng revision mới nhất; lần gửi lặp bị từ chối mà server đã có đúng B → toast "Đã điều phối thành công — đã lưu ở lần bấm trước". `actions.ts`: thêm `getDispatchItemState` (chỉ đọc). | `verify_g3_g5.ts`: lần 2 bị từ chối, client nhận ra đã lưu, B chỉ nhận 1 thông báo |
| G4 | Popup Gán B có ô "Nhập tên dịch vụ (nếu có thay đổi)", placeholder mờ là tên hiện tại → `serviceNamesForKtvs[B]` | `verify_g3_g5.ts`: tên riêng của B được lưu |
| G2 | `mergeSavedDispatchForm` bỏ chặng void **chưa từng bắt đầu** (B bị bỏ), vẫn giữ KTV bị đổi ra mà đã làm. Nút Lưu chỉ gửi `technicianCodes` của hàng còn chặng sống. Bản nháp cache không có thay đổi so với server thì bỏ khi nạp lại. | `sim_g2_saved_merge.ts` 2/2; `repro_g2_remove_b_edit_a.ts` (3 đường lưu ở server đều đúng) |
| G1 | `KTVDashboard.logic.ts`: `justStartedLocally()` (10 giây sau START) dùng chung cho 2 nhánh. Nhánh "B chưa bắt đầu" không reset / không tính lại đồng hồ theo `item.timeStart` của A. | Typecheck; cần kiểm tay trên Preview (2 máy) |
| G3 | Nút × ở "B · Chưa chọn nhân viên". Đơn nháp → tắt trên form, gửi `sequentialSlots: null` (trước gửi `undefined` nên server giữ lại 2). Đơn đã điều phối, B trống → lifecycle CANCEL `[2]`. | `verify_g3_g5.ts`: đóng B giữ A và KA; đơn nháp tắt được |
| G6 | Banner xung đột: câu mới, nút "Xem bản mới" và "Giữ bản đang sửa" (đưa bản nháp lên revision mới nhất rồi Lưu ghi đè). Revision mới nhất cho popup Gán B (G5). | Typecheck |

**Chưa làm (G6.3):** vẫn gọi `fetchData()` sau khi lưu / gán B / tắt nối tiếp. Bỏ bước này cần rà toàn bộ chỗ phụ thuộc vào việc tải lại cả bảng (sổ tua, Kanban, phòng), nên để làm riêng.

**Hồi quy:** unit 7/7, E2E trang demo 17/17, 10 đơn 165/165, từ chối 24/24, F 50/50, V1/V3/T3 25/25, bàn giao 12/12.
