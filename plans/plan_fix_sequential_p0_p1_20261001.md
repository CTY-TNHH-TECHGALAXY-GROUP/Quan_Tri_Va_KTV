# Plan: sửa 3 lỗi đã tái hiện — đơn ghép / nối tiếp (01/10/2026)

> **Mức 2 — chờ duyệt.** Chưa sửa code, chưa áp migration.
> Phạm vi: worktree `.worktrees/sequential-two-slot-handoff-20260926`, nhánh `test/sequential-two-slot-handoff-20260928` @ `0ae1806d`, Supabase **TEST** `eknggruuiuadwldacpmb`. Không chạm `feat/bit-lo-hong-phase1`, không chạm PROD.
> Nguồn: `_plans/REPORT_DEEP_REVIEW_SEQUENTIAL_20261001.md` (P0-1, P0-2, P1-1); probe tái hiện ở `_plans/probes_claude_20261001/`.

| Mã | Lỗi | File sửa | Kiểu |
|---|---|---|---|
| P0-1 | Điều phối 1 KTV vắt qua 00:00 nổ `Giờ phân công không hợp lệ` | migration mới A | SQL |
| P0-2 | Lưu form cũ sau khi KTV bàn giao → mất `handoverTime` + ảnh | migration mới B | SQL |
| P1-1 | NEXT_SEGMENT kéo dịch vụ trước từ DONE → CLEANING | `handleStartTimer.ts` + migration mới C | TS + SQL |

Ba migration tách riêng để lùi được từng lỗi. Mỗi migration chỉ `CREATE OR REPLACE` **đúng một hàm**, thân hàm copy nguyên từ định nghĩa đang chạy (đã đối chiếu **khớp** TEST bằng `readonly_funcdef_diff.cjs`) rồi thêm vài dòng. Không đổi chữ ký, không đổi grant.

---

## 1. Nguyên nhân gốc rễ

**P0-1.** Quầy bấm điều phối → `dispatch_commit_form` → `dispatch_apply_edit('DISPATCH')` → hàm gốc `dispatch_confirm_booking` (định nghĩa cuối: `20260830_add_dispatch_booking_guard.sql:172-180`). Hàm này dựng `planned_end = ngày điều phối + endTime` **cùng ngày**. UI gửi `endTime` đã quấn 24h (`h % 24`, `useDispatchBoard.logic.ts:38`) → slot `23:50 → 00:50` có `end < start`. Trước nhánh này sai **im lặng** (PROD đang có 31 dòng `end <= start`); nhánh này thêm trigger `validate_final_ktv_assignment_plan` (`20260928020000:16-30`) nên thành **lỗi cứng lúc COMMIT**. Đường DRAFT (`20260929160000:658-659`) và đường nối tiếp A/B đã dùng `start + duration` nên không bị.

**P0-2.** RELEASE ghi `handoverTime`, `handoverPhotoUrls`, `feedbackTime` vào segment, nhưng snapshot dùng để tăng `dispatchRevision` (`dispatch_edit_snapshot` + danh sách trường trong `keep_dispatch_edit_history`, `20260927150000:229-299`) **không gồm** 3 trường này → revision không đổi (probe: 3 → 3). Form quầy mở trước khi bàn giao vẫn qua kiểm revision. Với item ngoài `PREPARING..PAUSED` (FEEDBACK/CLEANING/DONE), `dispatch_commit_form_base` đẩy nguyên `edit->'segments'` của client xuống DRAFT (`20260929160000:765-769`); kiểm "bất biến" chỉ chặn 8 trường giờ thực tế, **không** chặn trường bàn giao → ghi đè mất.

**P1-1.** `handleStartTimer` (NEXT_SEGMENT) luôn đưa item của chặng trước vào `updates` và **tính lại** status bằng `done && !sequential ? 'CLEANING' : 'IN_PROGRESS'` (`handleStartTimer.ts:101-107`), không nhìn status hiện tại. Item đã DONE/FEEDBACK bị hạ về CLEANING. `ktv_finish_service_atomic` (`20260927150000:366-385`) nhận mọi status hợp lệ, không có chốt "không lùi DONE" (vi phạm CLAUDE.md 9.6).

---

## 2. Bảng Ảnh hưởng chéo (mục 4.1)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `PATCH /api/ktv/booking` NEXT_SEGMENT (app KTV, nút "dịch vụ tiếp theo") | Sổ điều phối: lưu form (DRAFT/DISPATCH) | `dispatch_confirm_booking`, `dispatch_edit_snapshot`, `keep_dispatch_edit_history`, `ktv_finish_service_atomic` | Sửa |
| Số liệu tiền/tua/giờ | P1-1: item không còn rời DONE → không lọt khỏi bộ lọc `DONE/COMPLETED` của ví/báo cáo | P0-1: `planned_end` đúng ngày → chống chồng ca và giờ dự kiến đúng cho ca đêm | Không đổi công thức tiền, không ghi `TurnLedger` mới | Khớp |
| Realtime / refresh | Không đổi kênh | Sau KTV bàn giao, form đang mở sẽ nhận lỗi "Dịch vụ đã có bản lưu mới… tải lại" (giống hành vi hiện có khi KTV bấm Xong) | `BookingItems` | Đồng bộ |
| Quyền | Không đổi | Không đổi | Hàm giữ `SECURITY DEFINER`, grant `service_role` | Không lộ thêm |
| Lịch sử chỉnh sửa | — | `options.dispatchHistory` có thêm dòng `handoverTime/handoverPhotoUrls/feedbackTime` khi KTV bàn giao | trigger `zz_dispatch_edit_history` | Chấp nhận (là nhật ký thật) |

**Không đổi:** đường nối tiếp A/B, `promote_next_assignment`, sổ tua, ví, Loại D, cron, UI.

---

## 3. Diff

### 3.1. P0-1 — `supabase/migrations/20261001090000_dispatch_plan_end_crosses_midnight.sql` (mới)

Copy nguyên `CREATE OR REPLACE FUNCTION dispatch_confirm_booking(...)` từ `20260830_add_dispatch_booking_guard.sql:5-408`, chỉ thêm khối sau dòng 180:

```diff
         v_planned_end_time := CASE
             WHEN NULLIF(v_assignment->>'endTime', '') IS NULL OR v_assignment->>'endTime' IN ('undefined', 'null') THEN NULL
             ELSE ((p_date::text || ' ' || (v_assignment->>'endTime'))::timestamp AT TIME ZONE 'Asia/Bangkok')
         END;
+
+        -- endTime là đồng hồ HH:mm đã quấn qua 24h (UI dùng h % 24). Slot 23:50 → 00:50
+        -- phải kết thúc ngày hôm sau. Trước đây ra end < start: sai im lặng, và từ khi có
+        -- trigger validate_final_ktv_assignment_plan thì quầy không điều phối được ca đêm.
+        -- Thời lượng tối đa 600 phút nên cộng đúng 1 ngày là đủ.
+        IF v_planned_start_time IS NOT NULL AND v_planned_end_time IS NOT NULL
+           AND v_planned_end_time <= v_planned_start_time THEN
+            v_planned_end_time := v_planned_end_time + interval '1 day';
+        END IF;
```

Không sửa UI. Không xử lý giờ **bắt đầu** sau 00:00 (P1-2, khung lệch 24h) — để plan riêng; bản sửa này chỉ đảm bảo `end > start`.

### 3.2. P0-2 — `supabase/migrations/20261001091000_release_bumps_revision_keeps_handover.sql` (mới)

**(a) Bàn giao làm tăng revision** — `CREATE OR REPLACE` 2 hàm, copy nguyên từ `20260927150000:229-306`:

```diff
 CREATE OR REPLACE FUNCTION dispatch_edit_snapshot(p_segments jsonb, p_options jsonb)
 ...
       'plannedEndAt', s->'plannedEndAt', 'actualStartTime', s->'actualStartTime',
-      'actualEndTime', s->'actualEndTime', 'voided', s->'voided', 'pauses', s->'pauses')))
+      'actualEndTime', s->'actualEndTime', 'voided', s->'voided', 'pauses', s->'pauses',
+      -- Bằng chứng bàn giao: phải làm tăng dispatchRevision để form quầy mở trước đó
+      -- bị từ chối thay vì ghi đè mất ảnh/giờ bàn giao.
+      'handoverTime', s->'handoverTime', 'handoverPhotoUrls', s->'handoverPhotoUrls',
+      'feedbackTime', s->'feedbackTime')))
```

```diff
 CREATE OR REPLACE FUNCTION keep_dispatch_edit_history()
 ...
-    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','startTime','endTime','duration','plannedStartAt','plannedEndAt','actualStartTime','actualEndTime','voided','pauses']) LOOP
+    FOR field_name IN SELECT unnest(ARRAY['ktvId','sequenceSlot','startTime','endTime','duration','plannedStartAt','plannedEndAt','actualStartTime','actualEndTime','voided','pauses',
+      'handoverTime','handoverPhotoUrls','feedbackTime']) LOOP
```

**(b) Lớp chắn thứ hai: form không bao giờ ghi đè bằng chứng do KTV tạo** — `CREATE OR REPLACE dispatch_commit_form_base`, copy nguyên từ `20260929160000:705-845`, chèn ngay sau vòng "Actual work is immutable" (sau dòng 763), trước `IF item.status NOT IN (...)`:

```diff
     END LOOP;
+    -- Bằng chứng KTV tạo (ảnh bắt đầu, dép khách, bàn giao, giờ feedback) thuộc về
+    -- server. Form quầy chỉ sửa kế hoạch; giữ nguyên bản đang lưu của từng chặng
+    -- dù client gửi bản cũ hoặc bỏ trống.
+    desired := COALESCE((SELECT jsonb_agg(
+        CASE WHEN o.value IS NULL THEN d.value
+             ELSE (d.value - ARRAY['handoverTime','handoverPhotoUrls','feedbackTime','reviewTime','startPhotoUrl','guestSlipperPhotoUrl'])
+                  || COALESCE((SELECT jsonb_object_agg(k.key, k.value) FROM jsonb_each(o.value) k
+                     WHERE k.key = ANY(ARRAY['handoverTime','handoverPhotoUrls','feedbackTime','reviewTime','startPhotoUrl','guestSlipperPhotoUrl'])), '{}')
+        END ORDER BY d.ord)
+      FROM jsonb_array_elements(desired) WITH ORDINALITY d(value, ord)
+      LEFT JOIN LATERAL (SELECT x.value FROM jsonb_array_elements(old) x WHERE x.value->>'id' = d.value->>'id' LIMIT 1) o ON true), '[]');
+    edit := edit || jsonb_build_object('segments', desired);
     IF item.status NOT IN ('PREPARING','READY','IN_PROGRESS','PAUSED') THEN
```

`plans` (nhánh item đang chạy) đã dựng từ `old` nên không bị ảnh hưởng; `edit` mới được dùng ở cả hai nhánh.

### 3.3. P1-1 — handler + chốt SQL

**`app/api/ktv/booking/_handlers/handleStartTimer.ts`** (Mức 2 Dispatch — chỉ sửa đúng handler này):

```diff
+// Thứ tự hậu kỳ của một dịch vụ. Không bao giờ hạ status đã đi xa hơn (CLAUDE.md 9.6).
+const POST_SERVICE_RANK: Record<string, number> = { IN_PROGRESS: 1, CLEANING: 2, FEEDBACK: 3, DONE: 4 };
+
 export async function handleStartTimer(ctx: HandlerContext): Promise<HandlerResult> {
 ...
-        if (previous && !previous.seg.actualEndTime) previous.seg.actualEndTime = now;
-        const changedIds = new Set([...run.map(s => s.item.id), ...(previous ? [previous.item.id] : [])]);
+        // Chỉ đụng tới item của chặng trước khi thực sự phải chốt giờ kết thúc cho nó.
+        // Chặng trước đã xong/bàn giao (item CLEANING/FEEDBACK/DONE) thì để nguyên.
+        const closesPrevious = !!previous && !previous.seg.actualEndTime;
+        if (closesPrevious) previous!.seg.actualEndTime = now;
+        const changedIds = new Set([...run.map(s => s.item.id), ...(closesPrevious ? [previous!.item.id] : [])]);
         const updates = [...changedIds].map(id => {
             const entry = work.find(s => s.item.id === id)!;
             const done = entry.segments.filter((s: any) => s.ktvId && s.voided !== true && s.voided !== 'true').every((s: any) => s.actualStartTime && s.actualEndTime);
-            return { id, status: done && !isTwoSlotSequential(entry.item.options) ? 'CLEANING' : 'IN_PROGRESS', segments: JSON.stringify(entry.segments) };
+            const computed = done && !isTwoSlotSequential(entry.item.options) ? 'CLEANING' : 'IN_PROGRESS';
+            const current = String(entry.item.status || '');
+            const status = (POST_SERVICE_RANK[current] ?? 0) > POST_SERVICE_RANK[computed] ? current : computed;
+            return { id, status, segments: JSON.stringify(entry.segments) };
         });
```

**`supabase/migrations/20261001092000_finish_atomic_never_regress_done.sql`** (mới) — `CREATE OR REPLACE ktv_finish_service_atomic`, copy nguyên từ `20260927150000:311-390`, chèn trong vòng `FOR patch`:

```diff
         SELECT * INTO item_row FROM "BookingItems" WHERE id = patch->>'id' AND "bookingId" = p_booking_id;
+        -- Chốt cuối ở DB: dịch vụ đã DONE không được lùi, bất kể handler nào gửi lên.
+        IF item_row.status::text = 'DONE' AND patch->>'status' IS DISTINCT FROM 'DONE' THEN
+            RAISE EXCEPTION 'Dịch vụ đã hoàn tất, không được lùi trạng thái: %', item_row.id;
+        END IF;
         SELECT * INTO item_row FROM jsonb_populate_record(item_row,patch - 'id');
```

`ktv_start_service_atomic` gọi hàm này nên START/NEXT_SEGMENT cũng được chốt. `handleFinishService` đã giữ DONE (dòng 260-281) nên không bị chặn nhầm — sẽ xác nhận bằng chạy lại 10 ca.

---

## 4. Kiểm thử (mục 9.8 + 10)

1. **Biên dịch** từng migration trên TEST trong `BEGIN … ROLLBACK` trước khi áp thật.
2. **Áp** 3 migration lên TEST, ghi `supabase_migrations.schema_migrations`, kiểm grant `service_role` gọi được / `authenticated` không.
3. **Probe tái hiện đổi kỳ vọng** (`_plans/probes_claude_20261001/`):
   - P0-1: slot `23:50 → 00:50` → `success:true`, `planned_end = D+1 00:50`; slot `10:00 → 11:00` không đổi; nối tiếp `23:30 → 00:30` không đổi.
   - P0-2: RELEASE → `dispatchRevision` tăng; lưu DRAFT form cũ → **bị từ chối**; lưu DRAFT với revision mới nhưng segments cũ → `handoverTime` + ảnh **còn nguyên**.
   - P1-1: item 1 DONE → NEXT_SEGMENT → item 1 **vẫn DONE**, item 2 IN_PROGRESS; gọi thẳng RPC hạ DONE → exception.
4. **Hồi quy bắt buộc (9.8):** chạy lại 10 ca chuẩn (1KTV-1DV, 1KTV-2DV gộp, 2KTV-1DV, nối tiếp A/B các biến thể, B10) + 4 ca đồng thời → kỳ vọng 165/165 và 74/74. Ca đêm: probe P0-1. Chạy thêm API KTV dưới `TZ=UTC`.
5. `npx tsc --noEmit` worktree.
6. Dọn dữ liệu QA, hậu kiểm 0 hàng sót.

---

## 5. Rủi ro & cách lùi

| Rủi ro | Mức | Xử lý |
|---|---|---|
| Quầy mở form lúc KTV bàn giao sẽ gặp "tải lại" nhiều hơn | Thấp | Đúng ý đồ (giống khi KTV bấm Xong); thông báo đã có sẵn |
| `dispatchHistory` dài thêm 1–3 dòng mỗi lượt bàn giao | Thấp | Vấn đề không giới hạn kích thước đã ghi P2-4, xử lý riêng |
| Chốt DONE ở SQL chặn một luồng hợp lệ chưa biết | Thấp | Hồi quy 10 ca + 4 ca đồng thời; nếu dính, exception có mã item để tra |
| Copy thân hàm dài (408 + 140 + 80 dòng) lệch bản đang chạy | Trung bình | Đã đối chiếu 4/4 hàm **khớp** TEST; sau khi áp, chạy lại `readonly_funcdef_diff.cjs` so với file mới |

**Lùi:** mỗi lỗi một migration → tạo migration `CREATE OR REPLACE` bằng thân hàm cũ (file nguồn ghi ở mục 3). Handler: revert 1 commit. Không có dữ liệu ghi cần lùi (P0-1 chỉ đổi giờ kết thúc của assignment tạo **sau** migration).

**Không làm trong plan này:** P1-2 (khung giờ bắt đầu sau nửa đêm lệch 24h), P1-3 REVOKE `promote_next_assignment`, P1-4..P1-7, revert cron `cd4161db`, dọn 38 dòng PROD — đều thuộc danh sách chặn merge của báo cáo, làm ở plan sau.

## 6. Commit dự kiến (nhánh test, sau khi duyệt)

```
fix(sequential): dieu phoi ca qua nua dem, ban giao tang revision, khong lui DONE

- dispatch_confirm_booking: planned_end cong 1 ngay khi endTime <= startTime
- dispatch_edit_snapshot/keep_dispatch_edit_history: handoverTime/handoverPhotoUrls/feedbackTime lam tang dispatchRevision
- dispatch_commit_form_base: giu bang chung ktv (anh, ban giao, feedback) tu ban dang luu
- handleStartTimer NEXT_SEGMENT: khong ha status cua chang truoc; ktv_finish_service_atomic chan lui DONE

Van hanh: quay dieu phoi duoc ca qua 00:00; luu form sau khi ktv ban giao se bao tai lai thay vi mat anh; dich vu da DONE khong bi keo ve Don phong
```
