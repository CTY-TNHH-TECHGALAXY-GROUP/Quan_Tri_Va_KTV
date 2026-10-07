# Plan — Sửa nút "Gộp chung KTV" (ghép 2 dịch vụ) ở bảng điều phối

> **Thuật ngữ (user chốt 06/10):** đây là **ghép 2 dịch vụ** cho cùng một KTV làm liền — **không có dịch vụ trước / con, chỉ có TRƯỚC / SAU**.
> - **Dịch vụ trước** = dịch vụ đứng trước theo thứ tự trên đơn; giữ chặng (giờ, phòng, giường, KTV) với thời lượng = trước + sau. Tiện ích (Phòng riêng…) không bao giờ đứng trước vì không có thời lượng làm.
> - **Dịch vụ sau** = ghép nối tiếp vào dịch vụ trước, không có chặng riêng.
> - Tên hiển thị theo đúng thứ tự: "Ấn huyệt chân (60p) + Kết hợp 4 liệu trình (70p)".
> - Trong code/DB vẫn là `mergedIntoId` (ở dịch vụ sau, trỏ về dịch vụ trước) và `mergedServiceIds` (ở dịch vụ trước) — chỉ đổi cách gọi, không đổi dữ liệu.
> - Đổi cách chọn dịch vụ trước: hiện code chọn "dịch vụ trước" (bỏ qua khuyến mãi/tiện ích); sửa thành **theo thứ tự trên đơn**, chỉ bỏ qua tiện ích.

- **Mức**: 2 (chạm `app/reception/dispatch/actions.ts`, `handleSaveDraft`/`handleDispatch` trong `page.tsx`).
- **Ngày**: 2026-10-06. **Trạng thái**: user duyệt 07/10 (cho phép sửa thời lượng, có cảnh báo). **Đã code, chưa commit.** `npm run test:ghep` đạt (local + UTC).
- **Đã làm**: `lib/dispatch/merged-service.ts` (một nguồn); lớp server trong `applyDispatchEdit` (bỏ chặng/KTV dịch vụ sau + lỗi chi tiết chỉ khi DB đã từ chối); `saveDispatchForm` nhận `followingIds` (lưu từng dòng kèm dấu ghép, bỏ qua dịch vụ sau đã ghép đúng, chặn khác khách / đã bắt đầu); form chọn dịch vụ trước theo thứ tự, gỡ KTV dịch vụ sau + báo quầy, chuyển KTV sang trước nếu trước chưa có; trang bỏ chép KTV sang dịch vụ sau; hai nhánh lưu gửi dịch vụ sau không chặng; lưu thẻ kèm dịch vụ sau (`withFollowingServices`); timeline đọc `mergedIntoIdOf`; cảnh báo vàng khi ngắn hơn tổng; CLAUDE.md mục 9 thêm ca bắt buộc + `test:ghep`.
- **Chưa xác định**: đường nào đã lưu chặng 0 phút cho Phòng riêng ngày 02/10 (WB-02102026-001) và 03/10 (11NDK-003-03102026-A). Các đường ghi trực tiếp còn lại chỉ đổi trạng thái/giờ của chặng có sẵn; mọi đường qua form nay đều qua lớp server. 2 dòng kẹt đó chưa dọn (chờ user).
- **Ca thật**: đơn `11NDK-004-06102026` (Glenn, 2 khách, mỗi khách "Ấn huyệt chân 60p" + "Kết hợp 4 liệu trình 70p"), 3 lần thao tác 21:4x–21:54.

## 1. Nguyên nhân

### Lần 1 — "Giờ hoặc thời lượng không hợp lệ"
1. `mergeServicesIntoParent` (`QuickDispatchTable.logic.ts`) chỉ gắn `mergedIntoId` cho dịch vụ sau, **giữ nguyên dòng KTV** của nó.
2. `onUpdateServices` (`page.tsx` ~3233) còn **chép KTV của dịch vụ trước sang dịch vụ sau**.
3. Khi lưu, `handleSaveDraft` (~1544) và `handleDispatch` (~1913) gửi chặng của dịch vụ sau với `duration: isChild ? 0 : …`.
4. RPC `dispatch_commit_form_base` kiểm tra **mọi** chặng `duration BETWEEN 1 AND 600`, không trừ dịch vụ sau → RAISE, cả lần lưu bị từ chối.

User chốt: hai dịch vụ cùng một KTV thì gộp là hợp lệ, cộng thời lượng.

### Lần 2 — dịch vụ trước đổi tên + cộng giờ, dịch vụ sau vẫn còn
1. Gộp xong, dịch vụ sau mới có `svc.mergedIntoId` trong bộ nhớ, **chưa có `options.mergedIntoId`**.
2. `buildOrderTimeline` (`dispatch-timeline.ts` dòng 84, 156, 210, 356) chỉ đọc `options.mergedIntoId` → dịch vụ sau vẫn ở thẻ riêng của nó.
3. Lưu thẻ của dịch vụ trước: `targetSvcIds = selectedSubOrder.services` → dịch vụ sau **không nằm trong danh sách gửi lên** → DB chỉ nhận dịch vụ trước (tên gộp, 130p). Lịch sử: 21:50:15 chỉ item1, 21:51:08 chỉ item2.
4. Lần 3 (21:53:58) lưu cả đơn → 5 dịch vụ cùng ghi → mới gộp đúng.

## 2. Sửa

| # | File | Thay đổi |
|---|---|---|
| A | `QuickDispatchTable.logic.ts` `mergeServicesIntoParent` | Dịch vụ sau: `mergedIntoId` + `options.mergedIntoId`, **xoá staffList** (KTV của dịch vụ trước làm cả phần phút đã cộng). Con có KTV khác KTV của dịch vụ trước → vẫn gộp, trả về danh sách KTV bị gỡ để bảng hiện toast "Đã gỡ KTV X khỏi dịch vụ Y". |
| B | `page.tsx` `onUpdateServices` | Bỏ bước chép KTV của dịch vụ trước sang dịch vụ sau (dịch vụ sau không có chặng riêng). |
| C | `dispatch-timeline.ts` | Đọc `svc.mergedIntoId \|\| options.mergedIntoId` ở 4 chỗ → dịch vụ sau theo về thẻ của dịch vụ trước **ngay khi bấm gộp**, nên lưu theo thẻ cũng gửi kèm nó. |
| D | `page.tsx` `handleSaveDraft` + `handleDispatch` | Dịch vụ sau gửi `segments: []`, không gửi chặng duration 0. Lưu một thẻ thì **tự kèm mọi dịch vụ sau** có `mergedIntoId` trỏ vào dịch vụ trong thẻ. |
| E | `actions.ts` `saveDraftDispatch` | Phòng thủ ở server: item có `options.mergedIntoId` → bỏ `segments`, `technicianCodes = []` trước khi gọi RPC. Không sửa RPC. |

## 3. Ảnh hưởng chéo (4.1) + Vùng nổ (4.5)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình | KTV nhận 1 chặng gộp (đã như vậy sau lần 3); app KTV đọc `mergedServiceIds` để hiện "(Gộp)" — không đổi | Bảng điều phối: form gộp, thẻ Kanban | `BookingItems.options.mergedIntoId/mergedServiceIds`, RPC commit | Sửa phía quầy |
| Tiền/tua/giờ | Thời lượng tính trên chặng của dịch vụ trước (đã cộng) — không đổi công thức | — | `technicianCodes` của dịch vụ sau = [] (đã như vậy khi lưu thành công) | Khớp |
| 4.5-1 dùng chung | `buildOrderTimeline` nuôi cả Kanban và form | | | đường nóng |
| 4.5-2 nếu sai | Sai C → thẻ gộp hiển thị sai nhóm; không chặn tải bảng (không đổi query) | | | QA kỹ C |
| 4.5-3 luồng khách | Không — hoá đơn/journey đọc `BookingItems` theo dịch vụ, không theo thẻ | | | |
| 4.5-4 cô lập | Không thêm cột, không đổi select, không migration | | | |

## 4. QA (mục 9 — bắt buộc)
Mock `ServiceBlock`, in kết quả: 1KTV-1DV (không gộp), **1KTV-2DV gộp** (ca của đơn này: 60+70=130, con không chặng), 2KTV-1DV, 2 khách × 2DV gộp từng khách (đúng đơn 11NDK-004), dịch vụ sau có KTV khác dịch vụ trước, ca đêm qua 00:00 (21:50 + 130p → 00:00).


## 5. Kết quả test trên DB TEST (07/10/2026) — `npm run test:ghep-db`

Gọi server action thật (`saveDraftDispatch`, `saveDispatchForm`) và RPC tách khách thật trên Supabase TEST; dữ liệu `QA-GHEP-*` đã dọn.

| # | Nhóm | Cách lưu | Kết quả | Đồng hồ KTV |
|---|---|---|---|---|
| 1 | Gộp chung KTV, KTV ở dịch vụ trước | cả đơn | ĐẠT | A=130 |
| 2 | Gộp chung KTV, cùng KTV gán cả 2 DV rồi ghép (lỗi lần 1) | cả đơn | ĐẠT | A=130 |
| 3 | Gộp chung KTV, ghép rồi lưu từng dòng (lỗi lần 2) | từng dòng | ĐẠT | A=130 |
| 4 | Gộp chung KTV, 2 KTV trên dịch vụ trước | từng dòng | ĐẠT | A=130, B=130 |
| 5 | Gộp chung KTV, qua nửa đêm 23:30 → 01:40 | cả đơn | ĐẠT | A=130 |
| 6 | Gộp khác KTV, sau có B → gỡ B, báo quầy | cả đơn | ĐẠT | A=130, B=0 |
| 7 | Gộp khác KTV, trước chưa KTV → B chuyển sang trước | từng dòng | ĐẠT | B=130 |
| 8 | Tách khách trước rồi ghép từng thẻ (đơn Glenn) | từng dòng | ĐẠT | A=130, B=130 |
| 9 | Ghép trước rồi tách khách | cả đơn → tách | ĐẠT | A=130, C=60 |
| 10 | Payload kiểu cũ (dịch vụ sau chặng 0p) + lỗi 700p | lớp server | ĐẠT | A=130; lỗi nêu rõ dịch vụ + phút |

**Đối chứng:** cùng payload kiểu cũ gửi thẳng RPC (bỏ lớp server) → `Giờ hoặc thời lượng không hợp lệ` — xác nhận nguyên nhân lần 1.


## 6. Hồi quy 10 luồng vận hành bình thường trên DB TEST (07/10/2026) — `npm run test:flow-db`

| # | Luồng | Kết quả |
|---|---|---|
| F1 | Đơn thường 1KTV-1DV: lưu → bắt đầu → hoàn tất | ĐẠT |
| F2 | 2 DV 2 KTV không ghép (lớp server không đụng) | ĐẠT |
| F3 | Ghép → bắt đầu → hoàn tất, dịch vụ sau đi theo trạng thái | ĐẠT |
| F4 | Ghép → **bỏ ghép** → gán KTV riêng → lưu | **HỎNG — lỗi có từ trước** |
| F5 | Rút ngắn dịch vụ ghép 130 → 120, có cảnh báo | ĐẠT |
| F6 | Đổi KTV trên dịch vụ đã ghép; dịch vụ sau không bị ghi lại | ĐẠT |
| F7 | Nối tiếp A/B | ĐẠT |
| F8 | Tạo đơn nhanh: hồ sơ khách mới, chọn lại khách cũ + VAT | ĐẠT |
| F9 | Tải bảng điều phối: nhãn khách + VAT | ĐẠT |
| F10 | CRM + báo cáo khách + Web Booking | ĐẠT |

**F4 — lỗi có từ trước, KHÔNG do thay đổi này:** `unmergeServicesAction` ghi `segments` dạng **chuỗi** (`'[]'`, `JSON.stringify(...)`) vào cột jsonb. RPC `dispatch_commit_form` gặp chuỗi → `cannot extract elements from a scalar`. Tái hiện trực tiếp trên RPC TEST, bỏ qua code mới: mảng thật → lưu được; chuỗi `'[]'` → lỗi; chuỗi có chặng → lỗi. Không migration nào từ 27/09 xử lý chuỗi. Production: 70/135 dịch vụ tháng 10 lưu chặng dạng chuỗi (đa số do app KTV ghi lúc bắt đầu/kết thúc); 1 dịch vụ đang chờ: `11NDK-011-04102026-vip1`. Chưa thử RPC production (sẽ ghi dữ liệu thật). Đề xuất sửa riêng (Mức 2).

## 7. Nút "Hủy gộp" — kết quả rà soát 07/10/2026

Nút "Hủy gộp" trên thẻ ghép gọi `handleUnmergeSingle` (QuickDispatchTable) — **chỉ sửa trên form**, phải bấm lưu mới xuống DB.
Hàm server `unmergeServicesAction` + `page.handleUnmergeService` **không nút nào gọi** (code chết).

| # | Vấn đề | Có từ | Ảnh hưởng | Trạng thái |
|---|---|---|---|---|
| 1 | Lưu sau Hủy gộp **không xoá dấu ghép trong DB**: gửi `mergedIntoId: undefined` → JSON bỏ khoá → RPC giữ giá trị cũ (đã tái hiện trên RPC TEST) | trước 07/10 | Tải lại trang → dịch vụ lại hiện như đã ghép. Kết hợp lớp server mới sẽ **gỡ KTV vừa gán** ở lần lưu sau | **Đã sửa**: gửi `null` |
| 2 | `mergedIntoIdOf` (mới 07/10) đọc lại `options.mergedIntoId` cũ sau Hủy gộp | do bản sửa này | Hủy gộp không ăn trên form | **Đã sửa**: tầng trên quyết định |
| 3 | Hủy gộp **không trừ phút**: dịch vụ trước vẫn 130p, vẫn tên ghép | trước 07/10 | KTV dịch vụ trước bị tính 130p dù chỉ làm 60p (tiền tua/giờ) nếu quầy không tự sửa | **Đã sửa** (`unmergeFromLeading`): trừ phút, trả tên gốc; chỉ khi CHƯA bắt đầu (chặn ở form + server) |
| 4 | `unmergeServicesAction` ghi `segments` dạng chuỗi → lưu tiếp bị RPC từ chối (`cannot extract elements from a scalar`) | trước 07/10 | Không ảnh hưởng hiện tại (code chết) | Đề xuất xoá |
| 5 | RPC `dispatch_commit_form` (nhánh dịch vụ CHƯA bắt đầu) không đọc được `segments` dạng chuỗi. `addAddonServices` ghi `'[]'` dạng chuỗi → **quầy gán KTV cho dịch vụ phát sinh rồi lưu bị từ chối** (tái hiện trên DB TEST 07/10). Nhánh ca đang chạy đọc được chuỗi (H1); dịch vụ đã xong không lưu lại. Prod: 22 addon kẹt chờ điều phối, 2/172 addon từng lưu qua form. (Đính chính: con số 70/135 trước đây gồm 61 đã bắt đầu/xong + 7 huỷ — không có rủi ro) | trước 07/10 | Dịch vụ phát sinh không điều phối được qua form | Chưa sửa — đề xuất làm sớm (Mức 2) |


## 8. Hủy gộp — an toàn nhận đơn / gửi đơn / tài khoản (07/10/2026) — `npm run test:huy-gop-db`

| # | Ca | Kết quả |
|---|---|---|
| U1 | Hủy gộp trước điều phối, lưu cả đơn → gán KTV cho dịch vụ sau | ĐẠT: A 130→60p, tên gốc, B=70 |
| U2 | Hủy gộp rồi lưu từng dòng | ĐẠT: dịch vụ sau được nhả, A=60 |
| U3 | Hủy gộp sau điều phối (PREPARING), KTV chưa bắt đầu | ĐẠT: KTV nhận đơn giữ nguyên, đồng hồ 60 |
| U4 | Hủy gộp khi KTV đã bắt đầu | ĐẠT: form chặn; form để lọt thì server chặn; DB giữ 130p |
| U5 | Tách khách khi nhóm đang ghép | ĐẠT: 3 đơn con, A=60, C=60 |
| U6 | Cơ sở tiền tua (KtvCommissionService) | ĐẠT: 130 → 60 phút |
| U7 | 9 bảng sổ/hàng đợi KTV trước–sau U1–U6 | ĐẠT: không đổi; 0 thông báo tới KTV (9 "NEW_ORDER" cho admin do trigger khi tạo đơn test) |

Giới hạn: U3 đặt PREPARING thẳng trong DB (không chạy processDispatch thật vì cần KTV điểm danh), chưa bấm nhận đơn trên app KTV.

## 9. Sự kiện mới: HỦY GỘP KHI ĐANG LÀM (HG) — user duyệt "OK theo đề xuất" 07/10, ĐÃ CODE (CLAUDE.md mục 13, Mức 2)

**Yêu cầu user 07/10:** dịch vụ ghép đã bắt đầu vẫn cho hủy gộp sau popup xác nhận; admin chấp nhận thì hủy; gửi thông báo cho nhân viên.
**Cách làm:** đi đúng luồng sẵn có "đổi thời lượng dịch vụ đã bắt đầu" (popup `runningDurationChange` + `notifyAdjustedDurations` + RPC nhánh ca đang chạy, cần phân công đang làm), thêm bước nhả dịch vụ sau. Đã xong (CLEANING/FEEDBACK/DONE) → **vẫn chặn cứng** (tiền đã chốt — nguyên tắc 1.5).
**Ví dụ:** Ấn huyệt chân 60p + Kết hợp 4 liệu trình 70p = 130p, KTV A đã làm 40p.

Vai: **A** = KTV đang làm dịch vụ trước · **S** = dịch vụ sau (trả về chờ điều phối; nếu gán KTV mới B thì B như một đơn bình thường).

| # | Khía cạnh | A (đang làm, bị rút phút) | S / KTV mới B |
|---|---|---|---|
| 1 | Tiền tua | theo phút gán mới = **max(60, phút A đã làm thật lúc hủy)** — không bao giờ mất phút đã làm | S: chưa ai hưởng; B: như đơn mới |
| 2 | Giờ tích luỹ (D) | cùng phút ở dòng 1 | B: như đơn mới |
| 3 | Lượt tua (A/B/C) | giữ 1 lượt, không phạt | B: +1 lượt bình thường khi điều phối |
| 3b | Lượt tua (D) | không ghi thêm `TurnLedger` | B: theo luật D thường |
| 4 | Thưởng Xuất sắc | bình thường trên dịch vụ trước | B: bình thường trên S |
| 5 | Đánh giá khách tính cho ai | A cho dịch vụ trước | B cho S |
| 6 | Dọn phòng / bàn giao | có, như thường | B: có |
| 7 | Nợ phòng / chặn tan ca | tính như thường | B: tính |
| 8 | Hạn mức bỏ qua bàn giao | tính như thường | B: tính |
| 9 | Hàng đợi (TurnQueue/KtvAssignments) | giữ `working`, cập nhật giờ kết thúc dự kiến | S: chờ điều phối; B: phân công mới |
| 10 | Màn app KTV | nhận thông báo, đồng hồ tự cập nhật qua realtime, tên dịch vụ đổi về tên gốc | B: nhận đơn như thường |
| 11 | Đồng hồ | giữ `actualStartTime`, tổng mới = phút dòng 1; nếu đã quá → hết giờ ngay, A kết thúc như thường | B: chạy từ lúc B bấm bắt đầu |
| 12 | Tự chốt khi hết giờ | như thường theo tổng mới | B: không chốt khi chưa bắt đầu |
| 13 | Thẻ Kanban | dịch vụ trước tên gốc, giờ kết thúc mới | S hiện thành dịch vụ chờ điều phối trong cùng đơn |
| 14 | "Cùng làm với" | không đổi | B: như thường |
| 15 | Lịch sử KTV | 1 dòng dịch vụ trước, phút mới | B: dòng riêng |
| 16 | Nhật ký quầy | `UNMERGE_RUNNING` "130p → 60p · tách S · lý do" | — |
| 17 | Lý do | **đề xuất bắt buộc** (đổi quyền lợi giữa ca) — chờ user chốt | — |

**Thông báo:** A nhận `KTV_ORDER_CHANGED`: "Quầy đã tách dịch vụ «Kết hợp 4 liệu trình» khỏi đơn của bạn. Thời gian của bạn còn 60 phút (kết thúc HH:mm)." Admin nhận `WARNING` (luồng `notifyAdjustedDurations` sẵn có).
**Test:** DB TEST cần dựng phân công đang làm (TurnQueue `working`) cho KTV thử, chạy: hủy khi đã làm 40p / đã quá 60p / đang tạm dừng / đã xong (phải chặn), đối chiếu tiền tua + giờ + đồng hồ + thông báo; chạy lại 4 bộ test hiện có.


## 10. Kết quả HG trên DB TEST (07/10/2026) — `npm run test:huy-gop-dang-lam-db`

| # | Ca | Kết quả |
|---|---|---|
| H1 | Đang làm 40p → hủy gộp | ĐẠT: A 130→60p, tua 60p, giữ giờ bắt đầu, phân công ACTIVE giữ nguyên, kết thúc dự kiến = bắt đầu + 60p, dịch vụ sau WAITING không KTV, KTV A nhận thông báo, nhật ký có lý do |
| H2 | Đã làm 80p | ĐẠT: A giữ 80–81p (làm tròn lên), không cắt về 60 |
| H3 | Đang tạm dừng (làm 45p, dừng 30p) | ĐẠT: tính 60p (không tính thời gian dừng), vẫn PAUSED |
| H4 | Đã xong (dọn phòng) | ĐẠT: bị chặn, DB giữ nguyên |
| H5 | Lý do < 5 ký tự | ĐẠT: từ chối, không đổi gì |
| H6 | Chưa bắt đầu | ĐẠT: trả NOT_RUNNING (hủy trên form như thường) |
| H7 | Lưu nháp thường cố hủy gộp khi đang làm | ĐẠT: server chặn — chỉ action riêng mở được |
| H8 | 9 bảng sổ/hàng đợi KTV + thông báo trong H1–H7 | ĐẠT: không đổi; thông báo chỉ tới KTV A và admin |

Chạy lại sau HG: `test:ghep`, `test:ghep-db`, `test:flow-db`, `test:huy-gop-db`, QA #20, #21 — đều ĐẠT. tsc + eslint sạch.
**Ghi chú:** KTV A nhận **2 thông báo**: "Quầy đã thay đổi thời gian dịch vụ của bạn thành 60 phút" (luồng sẵn có) + "Quầy đã tách dịch vụ … khỏi đơn của bạn" (mới).
