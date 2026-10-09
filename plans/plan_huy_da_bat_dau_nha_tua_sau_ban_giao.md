# Plan — Huỷ dịch vụ khi KTV đã bắt đầu: bàn giao xong phải về rảnh

> Mức 2 (tua / hàng đợi KTV). Trạng thái: **ĐÃ DUYỆT 10/10 — đã sửa trên nhánh fix/doi-ktv-va-huy-dv-dang-cho-20261008**. Ngày 10/10/2026.
> Phát hiện ở `scripts/qa/qa_29_huy_tranh_chap_test_db.ts` T02 (DB TEST).

## 1. Lỗi

Quầy huỷ **một dịch vụ** (nút huỷ dịch vụ, `/api/bookings/cancel-item`) khi KTV **đã bấm Bắt đầu**, và KTV không còn dịch vụ nào khác trong đơn.
KTV bàn giao phòng xong → sổ tua vẫn `working`, `current_order_id` = đơn đã huỷ. KTV bị coi là đang bận ở đơn đã huỷ.

Áp dụng cho cả huỷ không công (`NONE`) và huỷ có công (`WORKED`). Huỷ **cả đơn** không bị (nhả tua ngay lúc huỷ).

## 2. Nguyên nhân gốc

`BookingModificationService.cancelBookingItem`:
- KTV đã bắt đầu → cố ý **giữ** TurnQueue `working` để KTV còn bàn giao (đúng luật).
- Nhưng ngay sau đó vẫn **đóng phiếu phân công** (`KtvAssignments` → `CANCELLED`) của KTV đó.

Lúc bàn giao, `ktv_release_work_atomic` chỉ nhả tua cho những ngày có phiếu phân công của KTV ở đơn này đã chuyển `COMPLETED`.
Phiếu đã bị huỷ từ trước → không có dòng `COMPLETED` → vòng nhả tua không chạy → TurnQueue kẹt `working`.

## 3. Cách sửa (chỉ code app, KHÔNG đổi DB)

Trong `cancelBookingItem`, KTV **đã bắt đầu** trên dịch vụ bị huỷ:
- **Không** đóng phiếu phân công của dịch vụ đó và không gọi `promote_next_assignment` lúc huỷ.
- Phiếu giữ `ACTIVE` đến khi KTV bàn giao → `ktv_release_work_atomic_base` tự chuyển `COMPLETED` (chặng `CANCELLED_NO_CREDIT` / chặng có công đều nằm trong `live_done`) → wrapper nhả tua → về rảnh hoặc kéo đơn kế tiếp lên.

KTV chưa bắt đầu: giữ nguyên như hiện tại (đóng phiếu, kéo đơn kế, trả tua).

Đã cân nhắc: sửa SQL `ktv_release_work_atomic` (lặp theo TurnQueue thay vì theo phiếu COMPLETED) → phải chạy migration trên bản thật. Không chọn vì sửa app đủ, lùi bằng revert.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | App KTV: sau bàn giao về màn chờ / nhận đơn kế | Sổ tua, bảng điều phối: KTV hiện rảnh sau bàn giao | `cancelBookingItem`, `ktv_release_work_atomic` (không sửa), `KtvAssignments` | Sửa |
| Số liệu | Tua: không đổi (`punishTurnIfIdle` giữ nguyên) | Không đổi | TurnLedger không đụng | Khớp |
| Realtime | TurnQueue đổi lúc bàn giao (như dịch vụ bình thường) | như trên | TurnQueue, KtvAssignments | Đồng bộ |
| Quyền xem | Không đổi | Không đổi | | Không lộ |

### Vùng nổ (4.5)
1. **Dùng chung**: chỉ nhánh "đã bắt đầu" trong `cancelBookingItem`. Huỷ cả đơn (`cancelBooking`), đổi KTV, kết thúc sớm, nối tiếp 2 lượt: không đụng.
   Phiếu `COMPLETED` của dịch vụ đã huỷ được đọc ở: chặn trả tua trong `dispatch_unassign_unstarted_staff` (đúng — KTV đã làm trong bill), các RPC nối tiếp (không áp dụng — dịch vụ nối tiếp đi đường riêng).
2. **Nếu sai**: KTV kẹt bận ở đơn đã huỷ — đúng như lỗi hiện tại, không tệ hơn. Quầy / khách vẫn làm việc được.
3. **Luồng khách**: không — chỉ sổ tua nội bộ.
4. **Cô lập**: chỉ bỏ 2 lệnh ở 1 nhánh; không thêm select vào đường nóng.

## 5. Kiểm (DB TEST, TZ=UTC)
- T02 đổi thành kiểm chặt: A bàn giao xong → sổ tua `waiting`, `current_order_id` null.
- Mới: huỷ có công (`WORKED`) khi đang làm → bàn giao → rảnh.
- Mới: KTV đang làm X có Y chờ sau; huỷ X khi đã bắt đầu → bàn giao → Y được kéo lên (`assigned`), không kẹt.
- Mới: dịch vụ 2 KTV, A đã bắt đầu, B chưa → huỷ: B rảnh ngay, A rảnh sau bàn giao.
- Mới: KTV có 2 dịch vụ trong đơn, huỷ 1 dịch vụ đã bắt đầu → vẫn làm dịch vụ còn lại, không bị nhả sớm.
- Chạy lại toàn bộ `qa_28` (bật trigger), `qa_29`, `test:ghep`.

## 6. Lùi
Revert 1 commit. Phiếu đang `ACTIVE` của dịch vụ đã huỷ sẽ được `promote_next_assignment` tự dọn khi đơn đã huỷ (đoạn tự làm sạch có sẵn) hoặc khi KTV bàn giao.

## 7. Cập nhật bảng tra
`plans/nghiep_vu_tam_dung_doi_huy.md` mục 2–3: "huỷ khi đã bắt đầu → rảnh sau bàn giao".
