# Plan — KTV từ chối đơn bị kẹt (seq_b, seq_c) — 02/10/2026

Mức 2 (chạm phân công / tua / KtvAssignments). Chờ duyệt.

## 1. Hiện trạng trên TEST (đọc lúc 00:18, 02/10)

| KTV | Đơn kẹt | Ngày | Booking / Item | KtvAssignments |
|---|---|---|---|---|
| SEQ_TEST_B | SEQ_TEST_ORDER_2 | 27/09 | NEW / PREPARING, đã nhận đơn | ACTIVE |
| SEQ_TEST_B | SEQ_PENDING_20260928_3 | 28/09 | PREPARING / PREPARING, đã nhận đơn | ACTIVE |
| SEQ_TEST_C | SEQ_TEST_ORDER_5 | 27/09 | IN_PROGRESS, chặng 1 đã có giờ bắt đầu và kết thúc | ACTIVE |

## 2. Nguyên nhân gốc rễ

1. **Đơn ngày cũ không hiện trên app KTV.** `GET /api/ktv/booking` chỉ tìm phân công ACTIVE của **ngày làm việc hôm nay**. Ba phân công trên thuộc 27–28/09 nên app KTV không thấy đơn để từ chối. Phía quầy vẫn coi KTV đang bận vì đọc KtvAssignments / technicianCodes. Kết quả là app KTV trống, còn bảng điều phối vẫn ghi KTV đang có đơn.
2. **Route từ chối chỉ dọn một phần** (`app/api/ktv/discipline/reject-order/route.ts`):
   - a. Không huỷ `KtvAssignments` của dịch vụ bị từ chối, nên phân công vẫn ACTIVE. Lần lấy đơn sau trả lại đúng đơn vừa từ chối, hoặc chặn "ca trước chưa bàn giao".
   - b. Không đánh dấu `voided` cho chặng của KTV. Chỉ gỡ `technicianCodes`, nên `segments[].ktvId` vẫn mang tên KTV. Kanban, timeline và hàng đợi suy ra từ segments vẫn thấy KTV đó.
   - c. `TurnQueue.current_order_id = newBookingItemIds[0]` ghi **id dịch vụ** vào cột vốn chứa **id đơn**. Màn KTV và quầy tra theo id đơn nên không khớp. Lúc 01/10 đã thấy `current_order_id = QA_WEB_20261001_B9_I1`.
   - d. Không gọi đẩy phân công kế tiếp (QUEUED → ACTIVE) cho KTV sau khi từ chối.

## 3. Đề xuất

### Bước A — gỡ kẹt TEST ngay (ghi dữ liệu TEST, cần OK)

Chạy trong một transaction, chỉ trên ref `eknggruuiuadwldacpmb`:

- `KtvAssignments` của 3 đơn trên → `CANCELLED`.
- Các chặng chưa bắt đầu của B trong SEQ_TEST_ORDER_2 và SEQ_PENDING_20260928_3 → `voided=true`, `note='UNASSIGNED'`. Gỡ B khỏi `technicianCodes`, xoá `acceptedByStaff.SEQ_TEST_B`, item → PREPARING.
- SEQ_TEST_ORDER_5: chặng của C đã xong (S/E) → cho đơn về **CANCELLED** (đây là đơn test cũ). Nếu muốn giữ thì đưa về DONE.
- Không đụng QA_WEB_20261001_B9 (B đang làm thật trên Preview).

### Bước B — sửa route từ chối (code, Mức 2)

Diff dự kiến trong `reject-order/route.ts`, bước 5:

```ts
// 5a. Void this KTV's unstarted segments instead of only dropping technicianCodes.
segments = segments.map(s => s.ktvId?.toLowerCase() === me && !s.actualStartTime
  ? { ...s, voided: true, note: 'UNASSIGNED' } : s);
// 5b. Cancel the KTV's open assignment for the affected items.
await supabase.from('KtvAssignments').update({ status: 'CANCELLED' })
  .eq('employee_id', staffId).in('booking_item_id', affectedIds)
  .in('status', ['ACTIVE', 'QUEUED', 'READY']);
// 5c. TurnQueue.current_order_id must be a BOOKING id.
current_order_id: nextItem ? nextItem.bookingId : null,
// 5d. Promote the next queued assignment (same RPC the release flow uses).
```

- Chặn từ chối chặng **đã bắt đầu** với lỗi rõ ràng: "Dịch vụ đã bắt đầu, không thể từ chối — nhờ quầy đổi KTV".
- Ý (1), đơn ngày cũ: **khuyến nghị không** mở GET ra nhiều ngày. Thay vào đó, bảng điều phối hiện cảnh báo "phân công ACTIVE từ ngày trước" để quầy tự gỡ. Cách này không đổi luồng KTV đang ổn định.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Nút Từ chối (ScreenDashboard) → reject-order | Kanban / điều phối thấy KTV rảnh ngay sau từ chối | KtvAssignments, TurnQueue, BookingItems.segments | Sửa |
| Số liệu (giờ phạt / điểm) | Trừ giờ D / điểm A-B-C, giữ nguyên | Không đổi | KtvTypeDDisciplineService | Không ảnh hưởng — vì không chạm công thức |
| Realtime | KTV nhận cập nhật BookingItems / TurnQueue | Quầy nhận cập nhật như trên | cùng bảng | Đồng bộ |
| Quyền | Chỉ chính chủ (requireStaffMatches) | — | — | Không đổi |

## 5. Test

- 1KTV-1DV: từ chối → KA CANCELLED, chặng voided, TurnQueue waiting / null.
- 1KTV-2DV gộp: chọn đúng dịch vụ (needsItemPick), cả cụm ghép bị gỡ.
- 2KTV-1DV: chỉ chặng của người từ chối bị void, người còn lại giữ nguyên.
- Nối tiếp B từ chối khi A đang làm: A không bị ảnh hưởng, slot 2 về UNASSIGNED.
- Ca đêm, chạy dưới TZ=UTC.
- KTV còn đơn QUEUED: đơn đó được đẩy lên ACTIVE, `current_order_id` = booking id.

## 6. Đã làm (02/10/2026)

- Bước A đã chạy trên TEST (`_plans/probes_claude_20261002/unstick_old_orders.cjs`): huỷ 3 phân công cũ, trả 2 đơn của B về Chờ điều phối, SEQ_TEST_ORDER_5 → CANCELLED.
- Bước B: route gọi chung RPC `dispatch_unassign_unstarted_staff` của quầy, có thêm `p_reject=true`. Migration `20261002090000` đã áp lên TEST.
  - `p_reject=true`: giữ tua (TurnLedger) như hành vi cũ của từ chối, và xoá mốc "đã nhận đơn" trong cùng transaction.
  - Quầy bỏ phân công (mặc định `false`) giữ nguyên như cũ.
  - Gỡ phân công chạy TRƯỚC khi trừ phạt; gỡ hỏng thì không phạt.
  - Chặng đã bắt đầu → 409, không phạt.
  - Item về WAITING (thay cho PREPARING), cùng trạng thái với lúc quầy bỏ phân công.
- Test: `verify_reject_order.ts` 24/24 (C1–C6, TZ=UTC, đơn sau nửa đêm trong ngày làm việc trước). Hồi quy: V1/V3/T3 25/25, F 50/50, 10 đơn 165/165.
- Lỗi có sẵn, ngoài phạm vi: `KtvDisciplineService` ghi `KTVDisciplineLedger.is_exempted` nhưng TEST không có cột này, nên sổ kỷ luật A/B/C không ghi được dòng nào (điểm tổng vẫn trừ).
