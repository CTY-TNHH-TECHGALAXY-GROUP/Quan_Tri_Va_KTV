# Plan — Lịch sử điểm Office: giữ phiếu đã thu hồi, hiện rõ người trừ / người hoàn

> **Mức 2** — chạm `lib/services/KtvOfficeScoreService.ts` (khu vực `Ktv*Score*`) và thêm 1 cột DB.
> Trạng thái: ✅ Đã duyệt và làm xong (12/09/2026) — **chưa chạy migration trên Supabase**.

## 1. Yêu cầu

Ở modal **Lịch sử điểm** (quản lý, `app/admin/ktv-office`), bấm **Thu hồi** thì phiếu **biến mất** khỏi "Chi tiết vi phạm". Cần:

1. Phiếu đã thu hồi **vẫn nằm trong lịch sử**, chỉ đổi trạng thái (xám, gạch điểm, nhãn "Đã thu hồi").
2. Hiện rõ **ai trừ** (lúc nào) và **ai hoàn** (lúc nào, lý do).
3. **Chỉ role `ADMIN` hoặc `DEV` mới được bồi hoàn (thu hồi phiếu).**

## 2. Nguyên nhân gốc rễ

Thu hồi **đã là xoá mềm** — `DELETE /api/admin/ktv-office/deduct` chỉ set `revoked_at / revoked_by / revoke_reason`, dòng vẫn còn trong `KTVOfficeScoreLog`.
Phiếu "biến mất" vì **nguồn duy nhất** của lịch sử là `KtvOfficeScoreService.computeMonth()`, query có `.is('revoked_at', null)` — đúng cho phép tính điểm, nhưng lịch sử cũng chỉ đọc từ đó nên phiếu thu hồi không bao giờ tới được UI.

Thêm 3 thiếu sót phụ:
- `revoked_by` lưu **mã** (`bUser.techCode`, có thể là UUID của tài khoản admin), không có tên → không hiện được "ai hoàn" cho người đọc.
- Dòng người trừ hiện `Quản Trị Viên (Mặc định) · 23:33 08-09` không có nhãn → không rõ đó là người trừ.
- **Quyền thu hồi đang rộng hơn yêu cầu**: cả server (`isOfficeManager` = `ADMIN | DEV | MANAGER`) lẫn nút trên UI (`isManager` = `admin | dev | branch_manager`, tức `MANAGER`) đều đang cho **Quản lý chi nhánh** bồi hoàn.

## 3. Hướng làm (khuyến nghị)

**Không đụng vào query tính điểm.** Lấy phiếu đã thu hồi bằng một query **riêng**, chỉ khi màn hình cần, trả ra một mảng **tách biệt** `revokedHits` — không trộn vào `days[].hits`.

Lý do chọn cách này thay vì bỏ filter `revoked_at` rồi tách trong code:
- `days[].hits` đang được dùng để tính/hiện điểm ở nhiều nơi: `buildMonth` (điểm ngày, ngày sạch), bảng ngày + timeline admin, `calendar` route (`hitCount`), modal Office KTV (màu lịch + danh sách lỗi), Ví KTV (`deducted` trong `KtvOfficeBonusService`). Trộn phiếu thu hồi vào đó thì chỗ nào quên lọc là **trừ điểm oan**.
- Query tính điểm giữ nguyên từng ký tự → điểm ngày / điểm tháng / lỗi lặp / quỹ **không thể lệch** do thay đổi này.
- Phiếu thu hồi rơi vào ngày KTV **không đi làm** (chấm nhầm ngày rồi thu hồi) vẫn hiện được, mà **không** bị đếm thành ngày công (mẫu số điểm tháng).

### 3.1. DB — migration mới

`supabase/migrations/20260912xxxxxx_add_revoked_by_name_to_office_score_log.sql`

```sql
alter table "KTVOfficeScoreLog" add column if not exists revoked_by_name text;

-- Backfill phiếu đã thu hồi trước đây: tra tên từ Staff theo revoked_by.
update "KTVOfficeScoreLog" l
set revoked_by_name = s.full_name
from "Staff" s
where l.revoked_at is not null
  and l.revoked_by_name is null
  and l.revoked_by = s.id;
```

- Snapshot tên giống `created_by_name` (đổi tên nhân viên sau này không làm sai lịch sử).
- Phiếu cũ không tra được tên (UUID admin) → UI hiện `Quản lý (không rõ tên)`.
- Cập nhật `TableInSupabase.md`: hiện **chưa có** mục `KTVOfficeCriteria` / `KTVOfficeScoreLog` → bổ sung cả hai bảng trong cùng thay đổi.

### 3.2. Quyền bồi hoàn — thu hẹp còn ADMIN / DEV

Thu hồi là **hoàn điểm đã chấm**, nên siết về đúng hai role cao nhất. Không sửa `isOfficeManager` (hàm đó còn gác sửa quy chế, chấm ngày cũ, sửa phiếu người khác — giữ nguyên `ADMIN | DEV | MANAGER`), mà **thêm một hàm hẹp hơn** cạnh nó trong `lib/services/KtvOfficeScoreService.ts`:

```ts
/**
 * Ai được BỒI HOÀN (thu hồi phiếu đã chấm) — chỉ Admin và Dev.
 * Hẹp hơn `isOfficeManager` có chủ đích: Quản lý chi nhánh chấm và sửa được
 * phiếu, nhưng hoàn điểm đã trừ là quyết định của cấp quản trị.
 */
export function canRevokeOfficeLog(role?: string | null): boolean {
    return ['ADMIN', 'DEV'].includes(String(role || '').toUpperCase());
}
```

Chặn ở **cả hai tầng**:

| Tầng | Hiện tại | Sau khi sửa |
|---|---|---|
| Server `DELETE /api/admin/ktv-office/deduct` | `isOfficeManager(bUser.role)` → cho cả `MANAGER` | `canRevokeOfficeLog(bUser.role)`, lỗi 403 `'Chỉ Admin hoặc Dev mới thu hồi được phiếu trừ điểm.'` |
| UI nút "Thu hồi" (`page.tsx:161`) | `logic.isManager` (gồm `branch_manager`) | cờ mới `logic.canRevoke = role?.id === 'admin' \|\| role?.id === 'dev'` |

Server là cửa chặn thật; ẩn nút chỉ để Quản lý chi nhánh không bấm rồi ăn 403.
Các quyền khác của `MANAGER` (chấm ngày cũ, sửa phiếu người khác, sửa quy chế) **giữ nguyên**.

### 3.3. API thu hồi — `app/api/admin/ktv-office/deduct/route.ts` (DELETE)

- Ghi thêm `revoked_by_name`. Tách đoạn tra tên người thao tác đang có ở POST (Staff.full_name → `Quản lý (role)` → techCode) thành helper `actorName()` dùng chung cho POST và DELETE — không viết lặp.
- Không đổi request/response.

### 3.4. Service — `lib/services/KtvOfficeScoreService.ts`

- Thêm type:
  ```ts
  export interface OfficeRevokedHit extends OfficeHit {
      workDate: string;
      revokedAt: string;
      revokedByName: string;
      revokeReason: string | null;
  }
  ```
- `computeMonth(supabase, staffIds, month, opts?: { withRevoked?: boolean })`
  - Mặc định `false` → **hành vi y hệt hiện tại** (summary, calendar, Ví không đổi gì, không tốn thêm query).
  - `true` → chạy thêm 1 query `.not('revoked_at', 'is', null)` cùng khoảng ngày, gắn vào `OfficeMonth.revokedHits: OfficeRevokedHit[]` (mới nhất trước).
- `buildMonth()` **không sửa**.

### 3.5. Phía Quản lý — lịch sử

- `app/api/admin/ktv-office/staff/[id]/route.ts`: gọi `computeMonth(..., { withRevoked: true })`, trả thêm `office.revokedHits`.
- `app/admin/ktv-office/page.tsx`:
  - Timeline "Chi tiết vi phạm" dựng theo **hợp** các ngày có phiếu còn hiệu lực **và** ngày có phiếu thu hồi. Trong mỗi ngày: phiếu còn hiệu lực trước, phiếu thu hồi sau.
  - Điều kiện "Tháng này chưa có phiếu trừ điểm nào" tính cả phiếu thu hồi.
  - Điểm đầu ngày (`91 / 100`) vẫn lấy từ `days[]` (đã hoàn) — ngày không đi làm thì hiện `—`.
  - `HitRow` (phiếu còn hiệu lực): đổi dòng người trừ thành **`Trừ bởi: {tên} · {giờ}`**.
  - Component mới `RevokedHitRow` (cùng file, cạnh `HitRow`):
    ```
    [Đã thu hồi]  Bảo mật thông tin tuyệt đối            −3đ (gạch) · đã hoàn
    🖼 🖼
    Trừ bởi: Quản Trị Viên (Mặc định) · 23:33 08/09
    Hoàn bởi: Nguyễn Văn A · 09:10 09/09
    Lý do: Chấm nhầm KTV, đã xác minh lại với quản ca.
    ```
    Nền xám nhạt, chữ mờ, **không có** nút Sửa / Thu hồi. Ảnh minh chứng vẫn bấm xem được.
- `AdminKtvOffice.logic.ts`: thêm cờ `canRevoke` (mục 3.2). Phần còn lại không đổi — sau thu hồi đã `fetchDetail` lại nên phiếu tự chuyển sang dạng "Đã thu hồi".

### 3.6. Phía KTV — modal Office (khuyến nghị làm cùng, **cần anh chốt**)

Hiện KTV bị thu hồi phiếu thì chỉ nhận thông báo, còn trong modal phiếu **biến mất** — cùng lỗi với phía quản lý. Khuyến nghị:
- `app/api/ktv/office-score/route.ts`: `withRevoked: true`, trả `revokedHits` gồm `label, points, workDate, revokedAt, revokeReason` — **không** trả tên người hoàn và ảnh (modal KTV hiện cũng không hiện tên người trừ; giữ cùng mức).
- `app/ktv/dashboard/_components/modals.tsx`: dưới "Lỗi bị trừ" của ngày đang xem, thêm các phiếu thu hồi dạng xám `Đã hoàn điểm · lý do`.
- Trang Ví (`officeBonusTimeline`) **không đổi** — đó là bảng tổng điểm theo ngày, chi tiết tranh chấp xem ở modal.

## 4. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | `api/ktv/office-score` + modal Office (mục 3.6) | `api/admin/ktv-office/staff/[id]` + modal Lịch sử điểm; `deduct` DELETE ghi thêm tên | `KtvOfficeScoreService.computeMonth` (thêm tham số tuỳ chọn) | Sửa |
| `api/admin/ktv-office/summary`, `calendar` | — | Không ảnh hưởng — gọi `computeMonth` **không** truyền `withRevoked` → y hệt cũ | | Không ảnh hưởng |
| Ví KTV (`KtvOfficeBonusService`) | Không ảnh hưởng — không truyền `withRevoked` | — | | Không ảnh hưởng |
| `deduct` GET (sheet chấm điểm khoá tiêu chí đã trừ) | — | Giữ lọc `revoked_at IS NULL` — phiếu thu hồi **không** được khoá tiêu chí, chấm lại được | index `ux_office_once_per_day where revoked_at is null` | Không ảnh hưởng |
| `criteria` route (đếm phiếu đã dùng) | — | Không đọc qua service, không đổi | | Không ảnh hưởng |
| Số liệu điểm ngày / tháng / lỗi lặp / quỹ | từ `computeMonth` | từ `computeMonth` | query tính điểm **giữ nguyên** | Khớp — không đổi con số nào |
| Realtime / refresh | Không subscribe bảng này; mở modal là fetch | Không subscribe; sau thu hồi đã `fetchDetail` | `KTVOfficeScoreLog` | Đồng bộ — không cần thêm |
| Quyền xem | Chỉ phiếu của chính mình (route lấy `techCode`), không thấy tên người hoàn | Người có quyền `ktv_office_scoring` thấy đủ người trừ / người hoàn / lý do | | Không lộ dữ liệu nội bộ |
| Quyền **bồi hoàn** | Không áp dụng — KTV không thu hồi được phiếu | Thu hẹp: `MANAGER` (Quản lý chi nhánh) **mất** quyền thu hồi, chỉ còn `ADMIN`/`DEV`. Chấm điểm, sửa phiếu, sửa quy chế của `MANAGER` giữ nguyên | `canRevokeOfficeLog` (mới, cạnh `isOfficeManager`) | Sửa — cần báo Quản lý chi nhánh |

## 5. Edge case phải kiểm

1. Thu hồi 1 phiếu → điểm ngày tăng lại đúng số điểm, phiếu chuyển xám ở cùng ngày, không mất.
2. Thu hồi xong **chấm lại cùng lỗi cùng ngày** → hiện 2 dòng: 1 còn hiệu lực + 1 đã thu hồi; điểm chỉ trừ 1 lần.
3. Lỗi lặp: 3 phiếu cùng tiêu chí, thu hồi 1 → **không** còn phạt lặp (còn 2 lần).
4. Phiếu thu hồi ở ngày **không có chấm công** → vẫn hiện trong lịch sử, `workDays` **không** tăng, điểm tháng không đổi.
5. Ngày chỉ còn phiếu thu hồi → lịch tháng tô **xanh "Không lỗi"** (vì `days[].hits` rỗng).
6. Phiếu thu hồi cũ (trước migration) → tên người hoàn lấy từ backfill; không tra được thì `Quản lý (không rõ tên)`.
7. Tài khoản admin không gắn mã NV thu hồi → `revoked_by_name = "Quản lý (role)"`.
8. Phiếu thu hồi không có nút Sửa/Thu hồi; gọi PATCH/DELETE thẳng vẫn bị server chặn 409 (đã có).
9. Tháng chỉ có phiếu thu hồi → không hiện "Tháng này chưa có phiếu trừ điểm nào".
10. **Quyền**: `MANAGER` không thấy nút "Thu hồi"; gọi thẳng `DELETE /api/admin/ktv-office/deduct` vẫn bị **403**. `ADMIN`/`DEV` thu hồi bình thường. `MANAGER` vẫn chấm điểm và **sửa** phiếu được như cũ.

## 6. Mô phỏng & QA (mục 10)

- `scripts/qa/qa_16_office_revoked_history.ts` — mock `buildMonth` + query giả, in **so sánh 2 phía** (điểm ngày, điểm tháng, lỗi lặp, quỹ) cho cùng 1 KTV ở 2 chế độ `withRevoked: false/true` → mọi con số phải **bằng nhau**, chỉ khác có thêm `revokedHits`. Phủ edge case 1–5.
- Kiểm quyền bằng bảng chân trị của `canRevokeOfficeLog` (`ADMIN`, `DEV`, `MANAGER`, `RECEPTIONIST`, `null`) trong cùng script QA — phải đúng `true, true, false, false, false`.
- `npx tsc --noEmit`.
- Kiểm tay trên preview với T016 (Test D): thu hồi 1 phiếu ở modal Lịch sử điểm.

## 7. File thay đổi

| File | Việc |
|---|---|
| `supabase/migrations/20260912xxxxxx_add_revoked_by_name_to_office_score_log.sql` | Mới — thêm cột + backfill |
| `TableInSupabase.md` | Bổ sung `KTVOfficeCriteria`, `KTVOfficeScoreLog` |
| `lib/services/KtvOfficeScoreService.ts` | Type `OfficeRevokedHit`, tham số `withRevoked`, hàm `canRevokeOfficeLog` |
| `app/api/admin/ktv-office/deduct/route.ts` | Helper `actorName()`, DELETE ghi `revoked_by_name`, đổi cửa chặn sang `canRevokeOfficeLog` |
| `app/api/admin/ktv-office/staff/[id]/route.ts` | Trả `revokedHits` |
| `app/admin/ktv-office/page.tsx` | Nhãn "Trừ bởi", `RevokedHitRow`, timeline hợp ngày, nút Thu hồi theo `canRevoke` |
| `app/admin/ktv-office/AdminKtvOffice.logic.ts` | Cờ `canRevoke` |
| `app/api/ktv/office-score/route.ts` | *(mục 3.6)* trả `revokedHits` rút gọn |
| `app/ktv/dashboard/_components/modals.tsx` | *(mục 3.6)* hiện phiếu đã hoàn |
| `scripts/qa/qa_16_office_revoked_history.ts` | Mới — 21 mục kiểm, đã chạy **DAT** |
| `package.json` | Thêm `qa_16` vào `test:qa` |

⚠️ **Migration phải chạy TRƯỚC khi deploy code.** Code `select` và `update` thẳng cột `revoked_by_name`, nên deploy khi chưa có cột thì modal Lịch sử điểm lỗi 500 và nút Thu hồi hỏng. (Bản plan đầu viết "chạy trước/sau đều được" là sai — đã sửa lại.)

## 8. Cần chốt

1. Duyệt hướng tách `revokedHits` (không trộn vào `days[].hits`).
2. **Phía KTV (mục 3.6)**: làm cùng không? Khuyến nghị **có** — không thì KTV vẫn thấy phiếu "tự biến mất".
3. Xác nhận `MANAGER` (Quản lý chi nhánh) **mất** quyền thu hồi — hiện họ đang có, nên cần báo trước cho người đang dùng.
