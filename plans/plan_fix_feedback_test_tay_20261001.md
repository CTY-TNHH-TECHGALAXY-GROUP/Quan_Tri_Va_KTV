# Plan: sửa lỗi từ lượt test tay 10 đơn (01/10/2026)

> **Mức 2 — chờ duyệt.** Chưa sửa code. Nhánh `test/sequential-two-slot-handoff-20260928` @ `2bba292a`, Supabase TEST.
> Bằng chứng dữ liệu: `_plans/probes_claude_20261001/readonly_user_test_bills.cjs` (đọc đơn `TEST-261001-*` user vừa test).

## 0. Tổng hợp phản hồi

| # | Ca / phản hồi | Phân loại | Mức | Nguyên nhân gốc (1 dòng) |
|---|---|---|---|---|
| F1 | B10: xoá KTV duy nhất rồi Lưu → "Giờ hoặc thời lượng không hợp lệ"; muốn popup "không điều phối ai → Chờ điều phối" | **Lỗi + tính năng** | 2 | Form vẫn gửi 1 chặng `ktvId:''` (`QuickDispatchTable.tsx:538`) → server từ chối (`…:737`). Server đã hỗ trợ đưa về `WAITING` |
| F2 | Ô thời lượng: gõ số ngoài danh sách, dropdown vẫn mở | Lỗi UI | 0 | `openDurationIdx` chỉ đóng khi bấm preset (`QuickDispatchTable.tsx:1708-1737`) |
| F3 | B4 (`TEST-261001-3XXT`): hiện 2 dòng "C" | **Lỗi dữ liệu** | 2 | `ASSIGN_B` `array_append` không khử trùng (`20260929160000:314`); UI không khử trùng (`useDispatchBoard.logic.ts:330`). DB thật: `["SEQ_TEST_B","SEQ_TEST_C","SEQ_TEST_C"]` (cả B10) |
| F4 | B7: không có tài khoản khách để test | Thiếu điều kiện test | — | Dùng nút đánh giá của quầy (`submitCustomerRating`) hoặc kiosk feedback |
| F5 | B8: chưa đủ ảnh thì nút xám, không bàn giao được | **Đúng thiết kế** (UI chặn, server vẫn kiểm) | — | Cần bạn xác nhận đây là PASS |
| F6a | B9: bấm "Nối tiếp" chưa Lưu đã tách thẻ | Lỗi UI (chỉ hiển thị, không ghi DB) | 1 | Timeline nhóm thẻ theo `sequentialSlots` của **bản nháp** (`dispatch-timeline.ts:424,482`) |
| F6b | B9: 2 chặng, bắt đầu chặng 2 → "B không còn được gán" | **Lỗi** | 2 | Dòng "giữ chỗ" của dịch vụ 1 gửi thiếu `segmentId` (`page.tsx:1663`) → assignment dịch vụ 1 ACTIVE `segment_id=null`; chặng 2 của B kẹt QUEUED; handler đòi ACTIVE |
| F7 | Thêm dịch vụ khi đang làm: chặng sau đã bắt đầu nhưng thẻ vẫn "Đã điều phối" | Lỗi UI | 1 | Status thẻ chỉ suy từ `actualStartTime` của segment bản nháp (`dispatch-timeline.ts:371`); merge realtime chỉ khớp theo id segment (`dispatch-form-draft.ts:57`) |
| F8 | B10: A 2' + B 1'; xoá B và đổi A thành 3' → không đổi được | **Lỗi** | 2 | Wrapper chặn khi A đang chạy mà form bỏ B (`20260929030000:41-46`); `_a` lại đòi không còn B → hai điều kiện loại nhau |

---

## 1. Diff đề xuất

### F1 — Bỏ hết nhân viên → "Chờ điều phối" (`app/reception/dispatch/page.tsx`)

```diff
 // :1321 (DRAFT) và :1688 (DISPATCH) — không gửi chặng của dòng chưa có KTV
- const allSegments = svc.staffList.flatMap(r => r.segments.map(seg => ({ ...seg, ktvId: r.ktvId, ...
+ const allSegments = svc.staffList.filter(r => r.ktvId).flatMap(r => r.segments.map(seg => ({ ...seg, ktvId: r.ktvId, ...

 // :1692 — dịch vụ không còn ai thì về WAITING thay vì PREPARING
- status: svc.mergedIntoId ? 'WAITING' : (...)
+ status: svc.mergedIntoId || !svc.staffList.some(r => r.ktvId) ? 'WAITING' : (...)

 // ~:1480 (sau khối validate) — popup xác nhận
+ const emptied = orderToValidate.services.filter(s => !isUtilityService(s) && !s.mergedIntoId
+   && !s.staffList.some(r => r.ktvId)
+   && (baselineItemsRef.current.get(`${orderToValidate.id}/${s.id}`)?.staffList || []).some(r => r.ktvId));
+ if (emptied.length) {
+   const ok = await askConfirm(t.dispatchNoStaffConfirm(emptied.map(s => s.displayName || s.serviceName)));
+   if (!ok) return false;
+ }
```

- `askConfirm` dùng `ConfirmActionModal` có sẵn (`page.tsx:3503`); chuỗi đưa vào `*.i18n.ts`: *"Không điều phối nhân viên nào cho {dịch vụ}. Đưa dịch vụ về trạng thái Chờ điều phối?"*
- Server không đổi: vòng gỡ KTV của `dispatch_commit_form_base` gọi `dispatch_unassign_unstarted_staff` → dịch vụ `WAITING`, assignment `CANCELLED`, xoá `TurnLedger` nếu KTV không còn phân công nào trong đơn.
- KTV **đã bắt đầu** vẫn bị chặn ("dùng Dừng/Đổi để giữ giờ thực tế") — đúng nguyên tắc giữ giờ thực tế.

### F2 — Dropdown thời lượng (`QuickDispatchTable.tsx:1708`, tương tự `DispatchSegmentRow.tsx:184`)

```diff
- onChange={e => updateDurationForIdx(idx, e.target.value ? Number(e.target.value) : 0)}
+ onChange={e => {
+   const v = e.target.value ? Number(e.target.value) : 0;
+   updateDurationForIdx(idx, v);
+   if (!DURATION_PRESETS.includes(v)) setOpenDurationIdx(null);
+ }}
+ onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') setOpenDurationIdx(null); }}
```

### F3 — Khử trùng `technicianCodes`

**SQL** — migration mới `20261001100000_assign_b_dedupe_technician_codes.sql`, `CREATE OR REPLACE dispatch_assign_sequential_slot_b` (copy thân từ `20260929160000:185-…`):

```diff
-        "technicianCodes" = array_append(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv)
+        "technicianCodes" = array_append(array_remove(array_remove(COALESCE("technicianCodes", ARRAY[]::text[]), v_old_ktv), p_to_ktv), p_to_ktv)
```

kèm sửa dữ liệu TEST đã trùng (chỉ 2 đơn QA):

```sql
UPDATE "BookingItems" SET "technicianCodes" = ARRAY(SELECT DISTINCT ON (c) c FROM unnest("technicianCodes") WITH ORDINALITY u(c, o) ORDER BY c, o)
WHERE cardinality("technicianCodes") <> (SELECT count(DISTINCT c) FROM unnest("technicianCodes") c);
```

**UI** (`useDispatchBoard.logic.ts:330`) — lớp chắn hiển thị:

```diff
- const techCodes: string[] = (Array.isArray(bi.technicianCodes) ? bi.technicianCodes : (...)).filter(Boolean);
+ const techCodes: string[] = [...new Set((Array.isArray(bi.technicianCodes) ? bi.technicianCodes : (...)).filter(Boolean))];
```

### F6a — "Nối tiếp" chỉ tách thẻ sau khi Lưu

`QuickDispatchTable.tsx:520` (và `:572`, `:640`):

```diff
- options: { ...opts, sequentialSlots: 2, displayName: state.displayName },
+ options: { ...opts, sequentialSlots: 2, displayName: state.displayName,
+   _draftSequential: !isTwoSlotSequential(item.options) || item.options?._draftSequential === true },
```

`dispatch-timeline.ts` — chỉ ở 2 chỗ **nhóm thẻ / sinh id** (`:424`, `:482`), không đụng logic status:

```diff
+ const isSavedSequential = (o: any) => isTwoSlotSequential(o) && o?._draftSequential !== true;
- if (sequentialParent && isTwoSlotSequential(sequentialParent.options)) {
+ if (sequentialParent && isSavedSequential(sequentialParent.options)) {
- const sequentialItem = phaseServices.find(s => isTwoSlotSequential(s.options));
+ const sequentialItem = phaseServices.find(s => isSavedSequential(s.options));
```

Xoá `_draftSequential` khỏi `options` trước khi gửi (`page.tsx:1331`, `:1695`; `actions.ts:1621`). Sau khi lưu, `mergeSavedDispatchForm` lấy options của server nên cờ tự mất.

### F6b — KTV làm 2 dịch vụ, bắt đầu chặng 2

**(a) Gốc dữ liệu** — dòng "giữ chỗ" gửi đủ `segmentId` (`page.tsx:1663`):

```diff
   allStaffAssignments.push({
       ktvId: row.ktvId,
       bookingItemId: svc.id,
+      segmentId: firstSeg?.id,
+      sequenceNo: Number((firstSeg as any)?.sequenceSlot) || 0,
       roomId: firstSeg?.roomId || null,
```

**(b) Cho KTV bắt đầu đúng chặng mình bấm khi chặng kia chưa bắt đầu** — *cần bạn chốt luật* (mục 3, Q1). Khuyến nghị: được phép, đổi thứ tự trong cùng transaction:

`handleStartTimer.ts:51-56`:

```diff
-            .eq('employee_id', technicianCode).eq('status', 'ACTIVE').maybeSingle();
+            .eq('employee_id', technicianCode).in('status', ['ACTIVE', 'QUEUED', 'READY']).maybeSingle();
```

Migration `20261001101000_start_promotes_target_assignment.sql`, `CREATE OR REPLACE ktv_start_service_atomic` (copy từ `20260929010000:3-49`), chèn trước khi gọi `ktv_finish_service_atomic`:

```sql
  -- KTV bấm bắt đầu một chặng đang QUEUED/READY: đưa chặng đó lên ACTIVE, hạ phân công ACTIVE
  -- chưa bắt đầu khác của chính KTV trong ngày về QUEUED. Phân công đã bắt đầu thì không đụng.
  IF EXISTS (SELECT 1 FROM "KtvAssignments" WHERE employee_id=p_employee_id AND business_date=service_day
             AND booking_id=p_booking_id AND segment_id=p_target_segment_id AND status IN ('QUEUED','READY')) THEN
    UPDATE "KtvAssignments" ka SET status='QUEUED', updated_at=clock_timestamp()
      WHERE ka.employee_id=p_employee_id AND ka.business_date=service_day AND ka.status='ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM "BookingItems" i, jsonb_array_elements(COALESCE(jsonb_unwrap_string(i.segments),'[]')) s
                        WHERE i.id=ka.booking_item_id AND s->>'id'=ka.segment_id AND COALESCE(s->>'actualStartTime','')<>'');
    UPDATE "KtvAssignments" SET status='ACTIVE', updated_at=clock_timestamp()
      WHERE employee_id=p_employee_id AND business_date=service_day AND booking_id=p_booking_id
        AND segment_id=p_target_segment_id AND status IN ('QUEUED','READY');
  END IF;
```

Constraint `ktv_assignments_no_live_overlap` (chỉ ACTIVE) kiểm lúc COMMIT nên hạ trước – nâng sau không vi phạm.

**(c) Sửa dữ liệu TEST** đơn `QA_WEB_20261001_B9`: gán lại `segment_id='seg-racdhop'` cho assignment B/item I1.

### F7 — Thẻ chặng sau phải "Đang làm"

```diff
 // dispatch-timeline.ts:371 — status server là nguồn đúng
- else if (svcAnyStart) dStatus = 'IN_PROGRESS';
+ else if (svcAnyStart || svc.status === 'IN_PROGRESS') dStatus = 'IN_PROGRESS';

 // lib/dispatch-form-draft.ts:57 — merge realtime khi id segment bản nháp khác id server
- const actual=server.staffList.flatMap(staff=>staff.segments).find(other=>other.id===seg.id);
+ const serverRow=server.staffList.find(st=>st.ktvId===row.ktvId);
+ const actual=server.staffList.flatMap(staff=>staff.segments).find(other=>other.id===seg.id)
+   || (serverRow?.segments.length===1 ? serverRow.segments[0] : undefined);
```

Cần bạn gửi mã đơn của ca này để mình đối chiếu id segment bản nháp vs DB trước khi chốt dòng thứ hai.

### F8 — Xoá B và đổi thời lượng A trong cùng một lần lưu

Migration `20261001102000_running_a_remove_b_then_adjust.sql`, `CREATE OR REPLACE dispatch_commit_form` (copy từ `20260929030000:2-80`), chèn ngay trước `IF old_b IS NOT NULL THEN` (`:41`):

```sql
      -- Quầy bỏ B (chưa bắt đầu) và đổi thời lượng A trong cùng lần lưu:
      -- gỡ B trước (void, huỷ phân công, xoá lượt tua nếu không còn), đóng lượt 2 để dịch vụ
      -- hoàn tất theo A, rồi mới đi đường sửa thời lượng A.
      IF old_b IS NOT NULL AND incoming_b IS NULL AND COALESCE(old_b->>'actualStartTime','')='' THEN
        PERFORM dispatch_unassign_unstarted_staff(p_booking_id, item.id, old_b->>'ktvId',
          COALESCE((jsonb_unwrap_string(edit->'options')->>'dispatchRevision')::bigint,0), p_actor);
        PERFORM set_config('app.sequential_rpc','1',true);
        UPDATE "BookingItems" SET options = COALESCE(jsonb_unwrap_string(options),'{}')
          || jsonb_build_object('closedSequentialSlots',
               COALESCE(jsonb_unwrap_string(options)->'closedSequentialSlots','[]') || '[2]'::jsonb)
          WHERE id = item.id RETURNING * INTO item;
        PERFORM set_config('app.sequential_rpc','',true);
        edit := edit || jsonb_build_object('options', COALESCE(jsonb_unwrap_string(edit->'options'),'{}')
          || jsonb_build_object('dispatchRevision', jsonb_unwrap_string(item.options)->'dispatchRevision'));
        old_b := NULL;   -- rơi xuống nhánh dispatch_adjust_running_sequential_a
      END IF;
```

- `dispatch_unassign_unstarted_staff` đã đủ: void B (`customCommissionDuration:0`), huỷ assignment, xoá `TurnLedger` của B nếu không còn phân công, promote B.
- `closedSequentialSlots:[2]` là điều kiện để dịch vụ hoàn tất chỉ với A (`dispatch-status.ts` `sequentialSlotsComplete`). Hệ quả: sau đó không gán lại B được cho dịch vụ này — đúng vì quầy đã chủ động bỏ B.
- **A đã kết thúc rồi** (như đơn B10 hiện tại: A `SE`, C chưa bắt đầu): dùng **"Kết thúc sau A"** (`dispatch_finish_sequential_after_a`) để bỏ B; còn đổi số phút A đã làm là sửa giờ thực tế (`EDIT_ACTUAL_TIME`) — không thuộc đường "đổi thời lượng".

---

## 2. Bảng Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | App KTV: bắt đầu chặng 2 (F6b); không còn thấy đơn đã bị gỡ (F1) | Sổ điều phối: form, dropdown, popup, thẻ Kanban | `dispatch_commit_form`, `dispatch_assign_sequential_slot_b`, `ktv_start_service_atomic`, `dispatch-timeline.ts` | Sửa |
| Tiền / tua / giờ | B bị gỡ (F1, F8): void + `customCommissionDuration:0`, xoá lượt tua nếu không còn phân công → **0đ** đúng mục 13.4 | Báo cáo đọc `technicianCodes` đã khử trùng (F3) — không đếm C hai lần | `KtvCommissionService.activeTechs` | Khớp |
| Realtime | Không đổi kênh | F7 lấy status server khi merge | `BookingItems` | Đồng bộ |
| Quyền | Không đổi | Không đổi | Hàm giữ `SECURITY DEFINER`, grant `service_role` | OK |

Bảng hệ quả mục 13 cho sự kiện **"quầy bỏ B khi A đang làm" (F8)**: B — tiền 0, giờ 0, lượt tua bị xoá nếu không còn phân công, không nợ phòng, không vào "cùng làm với", lịch sử giữ chặng voided `UNASSIGNED`; A — giữ nguyên, thời lượng mới, dịch vụ hoàn tất theo A; quầy — nhật ký `UNASSIGN_STAFF` + `ADJUST_A_DURATION`.

---

## 3. Cần bạn chốt

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| Q1 | F6b: KTV có 2 phân công, chặng sau đã tới lượt (A bàn giao) trong khi dịch vụ còn lại chưa bắt đầu — **cho KTV bắt đầu chặng mình bấm** hay bắt buộc làm theo giờ kế hoạch? | Cho bắt đầu (diff (b)); dịch vụ kia tự về hàng chờ |
| Q2 | F5 (B8 nút xám khi thiếu ảnh) là PASS? | PASS — server vẫn kiểm ảnh |
| Q3 | F7: gửi mã đơn để đối chiếu | — |
| Q4 | F1: popup chỉ hiện khi bấm **Lưu/Điều phối**, hay hiện ngay khi bỏ KTV cuối cùng? | Khi bấm Lưu (một lần cho cả đơn) |

## 4. Kiểm thử sau khi sửa

- Probe mới: F1 (gỡ hết → `WAITING`, assignment `CANCELLED`, `TurnLedger` 0), F3 (gán B 2 lần → codes không trùng), F6b (KTV 2 dịch vụ bắt đầu chặng 2 → 200, dịch vụ 1 về QUEUED), F8 (A chạy, bỏ B + A=3' → 200, B voided, `closedSequentialSlots:[2]`, hoàn tất được DONE).
- Hồi quy: 10 ca chuẩn (165) + 4 ca đồng thời (74) + probe P0/P1 hôm nay; ca đêm; `TZ=UTC`; `tsc`.
- UI (bạn test tay trên Preview): F2, F6a, F7, popup F1.

## 5. Thứ tự làm & commit

1. F2 + F3 UI + F6a + F7 (UI, ít rủi ro) — 1 commit.
2. F3 SQL + F6b + F8 (3 migration) + F1 page — 1 commit, kèm bảng cảnh báo vận hành.
