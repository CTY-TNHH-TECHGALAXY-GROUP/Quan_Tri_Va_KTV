# Plan — "Người làm cuối cùng bàn giao phòng" (hướng 1) · test trên DB TEST + Vercel Hobby

- **Mức**: 2 (hàm DB bàn giao `ktv_release_work_atomic_base`, luật bàn giao / nợ phòng, `app/reception/dispatch/actions.ts`). **Ngày**: 09/10/2026. **Trạng thái**: CHỜ DUYỆT.
- **Nguồn quyết định**: user chốt bảng luật 09/10/2026 (chat). Hướng 2 (giữ luật cũ cho ca huỷ không công) đi trước trên nhánh `fix/doi-ktv-va-huy-dv-dang-cho-20261008`; plan này làm SAU, trên nền nhánh đó.
- **Phần code tầng app đã viết sẵn** (đã gỡ khỏi hướng 2): `plans/huong1_nguoi_lam_cuoi_ban_giao_app.patch`.

## 1. Luật đã chốt (09/10/2026)

| Tình huống | Ai bàn giao phòng |
|---|---|
| Dịch vụ còn chạy và có người làm xong | **Người làm cuối cùng.** Người bị tước giữa chừng (đổi ra, bị huỷ phần) **không** phải bàn giao, không nợ phòng |
| Dịch vụ bị huỷ hẳn, người đã bắt đầu bị huỷ không công | Chính người đã bắt đầu (vẫn nợ phòng như hiện nay) |
| Dịch vụ bị huỷ hẳn, người bắt đầu đã bị đổi ra trước đó | Không ai qua app — quầy lo (đã làm ở hướng 2) |

Ca thực tế bị ảnh hưởng (tái hiện `qa_28` F20): đơn nối tiếp, A làm **xong** phần 1, B đang làm phần 2, khách phàn nàn → quầy huỷ không công phần A → B làm xong, bàn giao. Hôm nay: đơn chờ A bàn giao (cả hai thứ tự bấm). Sau plan: B bàn giao xong là Hoàn tất, A không nợ phòng.

## 2. Luật đang nằm ở 4 chỗ — phải đổi CÙNG LÚC

| # | Chỗ | Ai gọi | Hôm nay với "huỷ không công đã bắt đầu" |
|---|---|---|---|
| 1 | `submitCustomerRating` (`app/reception/dispatch/actions.ts`) | quầy nhập khách chấm | chờ bàn giao |
| 2 | `segmentProgress().allHandovered` (`lib/dispatch-status.ts`) | `handleFinishService` khi KTV bấm Hoàn tất | **bỏ qua** (lệch sẵn với 1, 3 — ít khi quyết định vì trạng thái cuối do 3 chốt) |
| 3 | `ktv_release_work_atomic_base` — biến `all_handed` (SQL, **giống nhau TEST = PROD**, md5 đối chiếu 09/10) | mọi lần KTV bấm bàn giao | chờ bàn giao |
| 4 | `hasNoRoomDutyOnItems` (`lib/segment-time.ts`) → nợ phòng / chặn tan ca (`/api/ktv/attendance/status`), danh sách bàn giao chờ (`HandoverService`), việc chưa xong (`lib/unfinished-work.ts`) | app KTV | theo code: còn nghĩa vụ. **Nhưng `qa_28` F20 (09/10) đo được nợ phòng của A = 0 khi B đang dọn** — có thể huỷ phần A đã gỡ A khỏi `technicianCodes` (truy vấn nợ phòng lọc theo cột này). Xác minh ở bước 7.1 trước khi sửa |

**Bài học 09/10:** sửa riêng tầng app (1, 2, 4) mà không sửa 3 → thứ tự "B xong rồi khách chấm" ra Hoàn tất, "khách chấm rồi B xong" vẫn chờ A. Không được deploy lệch.

Hàm khác có nhắc `CANCELLED_NO_CREDIT` / `handoverTime` (đọc kỹ khi làm, dự kiến không đổi): `dispatch_sequential_lifecycle_atomic`, `guard_sequential_item_update` (ghi nhãn / chặn sửa, không quyết bàn giao). `auto_complete_unrated_feedback` (pg_cron mỗi phút trên prod) chỉ chốt dịch vụ KHÔNG có đánh giá — không thuộc ca này.

## 3. Thay đổi

### 3.1 Tầng app — một hàm luật duy nhất (`plans/huong1_nguoi_lam_cuoi_ban_giao_app.patch`)
- `lib/segment-time.ts`: thêm `segmentOwesRoomHandover(seg, itemSegments)`:
  - chưa bắt đầu → không; đang làm (không voided) đã bắt đầu → có;
  - `CHANGED` / `EARLY_LEAVE_NOT_STARTED` → không;
  - đã bắt đầu rồi bị tước (huỷ không công…) → **chỉ khi không còn chặng sống nào khác đã bắt đầu** trong dịch vụ.
- `hasNoRoomDutyOnItems` dùng hàm trên; `segmentProgress().allHandovered` dùng hàm trên; `submitCustomerRating` dùng hàm trên.

### 3.2 DB — migration `supabase/migrations/20261010xxxxxx_release_last_worker_handover.sql`
`CREATE OR REPLACE FUNCTION ktv_release_work_atomic_base(...)` = nguyên văn bản đang chạy (lấy từ prod, md5 khớp TEST) **chỉ đổi điều kiện `all_handed`**:
```sql
-- trước
WHERE COALESCE(s->>'ktvId','') <> '' AND (COALESCE(s->>'voided','false') <> 'true'
  OR (s->>'note'='CANCELLED_NO_CREDIT' AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''))
-- sau: chặng huỷ không công chỉ còn bắt bàn giao khi KHÔNG ai làm tiếp (khớp segmentOwesRoomHandover)
WHERE COALESCE(s->>'ktvId','') <> '' AND (COALESCE(s->>'voided','false') <> 'true'
  OR (s->>'note'='CANCELLED_NO_CREDIT' AND COALESCE(s->>'actualStartTime','') <> '' AND COALESCE(s->>'actualEndTime','') <> ''
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_segments) o
        WHERE COALESCE(o->>'voided','false') <> 'true' AND COALESCE(o->>'actualStartTime','') <> '')))
```
- Giữ nguyên `live_done` (A vẫn **được** bàn giao nếu muốn — không bắt buộc).
- File lùi: `plans/sql/rollback_release_base_20261010.sql` = nguyên văn hàm hiện tại.
- Cập nhật `TableInSupabase.md` (mục hàm bàn giao).

## 4. Ảnh hưởng chéo (4.1)
| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | bàn giao (RELEASE_KTV), chấm công (nợ phòng), danh sách bàn giao chờ | nhập khách chấm, Kanban (trạng thái đơn) | `ktv_release_work_atomic_base`, `segmentOwesRoomHandover` | Sửa |
| Số liệu | tiền / tua / giờ **không đổi** (chỉ đổi điều kiện chốt trạng thái + nợ phòng) | idem | — | Khớp |
| Realtime | `BookingItems` | `BookingItems` | không thêm kênh | Đồng bộ |
| Quyền | không đổi | không đổi | — | — |

## 5. Vùng nổ (4.5)
1. **Dùng chung:** `ktv_release_work_atomic_base` chạy ở MỌI lần KTV bàn giao → **đường nóng**. `hasNoRoomDutyOnItems` nuôi màn chấm công (chặn tan ca).
2. **Nếu sai:** SQL lỗi cú pháp/logic → KTV không bàn giao được, đơn kẹt CLEANING/FEEDBACK. Lùi tức thì bằng file rollback (1 lệnh `CREATE OR REPLACE`). Sai luật nợ phòng → KTV bị chặn tan ca oan hoặc thoát nợ oan.
3. **Luồng khách:** Không — WebBooking / WRB không gọi; hoá đơn đọc trạng thái như cũ.
4. **Cô lập:** chỉ đổi đúng 1 điều kiện WHERE; mọi nhánh khác của hàm giữ nguyên văn (so sánh diff bản prod ↔ bản mới phải chỉ còn đúng đoạn này).

## 6. Bảng hệ quả (mục 13) — ca "huỷ không công phần A, B làm tiếp và xong"
| Khía cạnh | A (bị huỷ phần, đã bắt đầu) | B (người làm cuối) |
|---|---|---|
| Tiền / giờ / lượt tua / thưởng | 0 / 0 / mất tua / không — **không đổi** | như thường — **không đổi** |
| Đánh giá khách tính cho | không | B — không đổi |
| Dọn phòng / bàn giao | **không bắt buộc** (trước: bắt buộc); vẫn bấm được | bàn giao cả phòng |
| Nợ phòng / chặn tan ca | **không** (trước: theo code có; đo thực tế F20 = 0 — xác minh ở 7.1) | như thường |
| Hạn mức bỏ qua | không áp dụng — không phải bàn giao | như thường |
| Hàng đợi | không đổi | không đổi |
| Màn app KTV | không còn bị đòi bàn giao phần đã huỷ | như thường |
| Đồng hồ / tự chốt / Kanban | đơn chốt Hoàn tất khi B bàn giao + khách chấm, **bất kể thứ tự** | idem |
| Lịch sử / nhật ký quầy / lý do | không đổi | không đổi |

Ca "dịch vụ bị huỷ hẳn, A đã bắt đầu": **không đổi** — A vẫn phải bàn giao, vẫn nợ phòng (`qa_28` F09f).

## 7. Test — DB TEST (`eknggruuiuadwldacpmb`)
0. (7.1) Xác minh vì sao nợ phòng của A = 0 sau khi quầy huỷ phần A (`technicianCodes` sau `dispatch_sequential_lifecycle_atomic` CANCEL); ghi kết quả vào plan trước khi sửa mục 4.
1. Chụp md5 hàm `ktv_release_work_atomic_base` trên TEST, lưu bản cũ.
2. Áp migration trên TEST bằng script (transaction), kiểm diff nguyên văn chỉ khác đúng đoạn WHERE.
3. Test SQL trong transaction ROLLBACK: 6 ca dựng chặng — (a) A huỷ không công + B sống đã xong & bàn giao → DONE nếu đã chấm; (b) A huỷ không công, không ai làm tiếp → chờ A; (c) đổi người (CHANGED); (d) 2KTV-1DV thường; (e) nối tiếp bình thường; (f) chưa bàn giao ai → FEEDBACK.
4. `qa_28` (đổi kỳ vọng F20 về "không chờ A, cả hai thứ tự"; giữ F09f "huỷ hẳn vẫn chờ A") — chạy `TZ=UTC`, ca đêm, trigger bật; thêm F20 kiểm nợ phòng A = 0 khi B đang dọn.
5. Hồi quy: `test:ghep`, `test:ghep-db`, `test:flow-db`, `test:huy-gop-db`, `test:huy-gop-dang-lam-db`, 22 script nối tiếp (so với mốc 09/10: 12 đạt, 10 hỏng có sẵn), `qa_kanban_sequential_hold`.
6. Đối chiếu 2 phía (4.3): cùng 1 đơn, trạng thái + nợ phòng ở app KTV = bảng điều phối/Kanban.

## 8. Test — Vercel Hobby (UI thật, trỏ DB TEST)
1. Nhánh `test/nguoi-lam-cuoi-ban-giao-20261010` = nhánh plan này + `vercel.json` `{"crons": []}` (Hobby không nhận cron dưới 1 ngày). **Không bao giờ merge.**
2. Push → project Hobby `test-98d3c5e6/quan-tri-va-ktv` build Preview (env Preview → DB TEST). Preview sau Vercel SSO → mở bằng trình duyệt đã đăng nhập.
3. Kiểm tay trên UI (2 tab: quầy `seq_admin`, KTV `seq_a` / `seq_b`):
   - Điều phối đơn nối tiếp A → B; A xong phần 1; B bắt đầu; quầy huỷ không công phần A (popup lý do).
   - App A: màn chấm công không báo nợ phòng; không bị đòi bàn giao phần đã huỷ.
   - B xong, bàn giao; quầy nhập khách chấm → Kanban: thẻ sang Hoàn tất. Làm lại với thứ tự ngược (chấm trước).
   - Ca huỷ hẳn (F09f) trên UI: A vẫn bị đòi bàn giao, chấm công báo nợ phòng.
4. Ghi ảnh màn hình + lỗi console vào báo cáo.

## 9. Production (sau khi TEST + Hobby ĐẠT, user duyệt)
- Khung giờ vắng. Thứ tự: (1) user chạy SQL migration trên SQL Editor (khối 0: md5 hàm hiện tại phải khớp bản đã chụp; khối 1: CREATE OR REPLACE; khối 2: md5 mới + kiểm 1 ca trong ROLLBACK); (2) ngay sau đó merge code tầng app lên phase1 → deploy. Khoảng lệch giữa 2 bước chỉ ảnh hưởng đúng ca hiếm này.
- Lùi: chạy `plans/sql/rollback_release_base_20261010.sql` + revert commit.

## 10. Còn để ngỏ (ngoài plan, báo user)
- **F20c (có sẵn):** đơn nối tiếp, quầy huỷ phần A **khi A đang làm** → B không bắt đầu được ("Chờ KTV lượt 1 bắt đầu…"), dịch vụ đứng IN_PROGRESS. Cần chốt nghiệp vụ riêng (B được bắt đầu luôn? hay quầy phải đổi người?).
- `ktv_release_work_root_atomic` chỉ còn trên TEST (thử nghiệm đã gỡ khỏi phase1 — `4bfa1b44`), không ai gọi. Dọn khi tiện.
- Gom `segmentProgress` (bỏ mọi chặng voided) về cùng hàm luật — đã nằm trong patch 3.1.
