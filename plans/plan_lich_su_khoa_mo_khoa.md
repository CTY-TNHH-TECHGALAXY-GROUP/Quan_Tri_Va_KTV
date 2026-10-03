# Plan — Lịch sử khoá / mở khoá tài khoản KTV (dòng thời gian)

> **Mức 2** — đọc nhật ký bảo mật (`SecurityAuditLogs`) và sửa `GET /api/admin/staff/unlock` (khu vực khoá tài khoản / bảo mật).
> Trạng thái: ✅ Đã duyệt **phương án A** (14/09/2026) — xem mục 10. B và mục 3.2 **không làm** trong đợt này.

## 1. Yêu cầu

Trang **Chấm điểm KTV** (`/admin/ktv-office`) chưa có chỗ xem lại các lần **bị khoá** và **mở khoá**. Cần một dòng thời gian:
- Bị khoá: khi nào, vì sao, do hệ thống hay ai.
- Mở khoá: **ai mở**, **lý do mở**, (phí kích hoạt lại nếu có).

## 2. Hiện trạng — dữ liệu ĐÃ CÓ, chỉ thiếu màn hiển thị

Không cần bảng mới. Mọi đường khoá/mở khoá đều đã ghi vào `SecurityAuditLogs` (đã kiểm từng đường ghi và dữ liệu thật):

| Đường khoá / mở | Nơi ghi | `event_type` | `details` có gì |
|---|---|---|---|
| Cron chốt sổ 00:00 (không đăng ký lịch, vắng…) | `KtvTypeDDisciplineService.khoaTaiKhoan` | `AUTO_LOCK_ABSENCE` | `reason`, `violationDate`, `source`=`CRON_MIDNIGHT`, `netHours` |
| Khoá hoãn — áp khi KTV xong đơn | `apDungKhoaDangCho` → `khoaTaiKhoan` | `AUTO_LOCK_ABSENCE` | như trên, `source`=`CRON_PENDING_LOCK` |
| Quyết khoá nhưng còn đơn → **chờ khoá** | `ghiChoKhoa` | `PENDING_LOCK` | `reason`, `violationDate`, `billCodes` |
| Từ chối tua khi không đủ giờ | `api/ktv/discipline/reject-order` | `AUTO_LOCK_REJECT_NO_HOURS` | `minHours`, `availableHours`, `penaltyHours`, `reason` ⚠️ |
| Admin tắt công tắc "Hoạt động" | `api/admin/staff/lock` | `MANUAL_LOCK` | `locked_by` (tên), `reason` |
| Mở khoá (trang Office + công tắc "Hoạt động") | `api/admin/staff/unlock` | `MANUAL_UNLOCK` | `unlocked_by` (tên), `reason`, `reactivation_fee` |

**Dữ liệu thật (14/09/2026):** `AUTO_LOCK_ABSENCE` 13 · `AUTO_LOCK_REJECT_NO_HOURS` 2 · `MANUAL_UNLOCK` 2. **11/11** KTV đang bị khoá đều có dòng khoá trong nhật ký — không có lần khoá nào mất vết.

Không có màn nào đọc các dòng này → người dùng tưởng "chưa lưu".

## 3. Hai lỗi phát hiện khi khảo sát

### 3.1. ⚠️ Khoá do từ chối tua: `details.reason` KHÔNG phải lý do khoá

Ở `reject-order`, lý do khoá thật là hằng `lyDo = 'Từ chối tua khi không đủ giờ khả dụng'`, nhưng dòng nhật ký lại ghi `reason` = **câu KTV gõ khi từ chối tua** (dữ liệu thật: `"okay "`). Dòng thời gian mà đọc thẳng `details.reason` sẽ hiện *"Bị khoá — lý do: okay"*.

→ Service map riêng loại này: **lý do khoá** = `'Từ chối tua khi không đủ giờ khả dụng'`, kèm chi tiết *"còn {availableHours}h, cần hơn {minHours}h"* và *"KTV ghi khi từ chối: …"* tách riêng. **Không sửa dữ liệu cũ, không sửa route ghi** (chỉ đọc cho đúng).

### 3.2. Modal "Mở khoá" có thể hiện **lý do cũ** của lần khoá trước

`GET /api/admin/staff/unlock` lấy lý do theo thứ tự: dòng `ACCOUNT_LOCK` mới nhất trong `KTVDPenaltyLedger` → `AUTO_LOCK_*` trong nhật ký. **Bỏ qua `MANUAL_LOCK`.**
Tình huống: KTV bị khoá kỷ luật tháng trước (đã mở), hôm nay admin tắt công tắc → modal hiện *lý do kỷ luật tháng trước* + *ngày tháng trước*. Đúng kiểu "dòng cũ sống lâu hơn lần mở khoá" mà migration `lock_source` đã cảnh báo.

Làm dòng thời gian mà không sửa chỗ này thì **ô "Lý do bị khoá" và dòng thời gian ngay bên dưới nói hai điều khác nhau** trong cùng một modal.

→ Khuyến nghị sửa (mục 8, cần chốt): lý do/ngày khoá hiện tại = **sự kiện khoá mới nhất** (`AUTO_LOCK_*` hoặc `MANUAL_LOCK`) lấy từ cùng service của dòng thời gian — một nguồn duy nhất.

## 4. Hướng làm

### 4.1. Service — `lib/services/StaffLockHistoryService.ts` (mới)

Một nguồn duy nhất để đọc & diễn giải sự kiện khoá. Cả dòng thời gian lẫn `GET /unlock` gọi chung.

```ts
export type LockEventKind = 'LOCK' | 'PENDING' | 'UNLOCK';

export interface LockEvent {
    id: string;
    staffId: string;
    staffName: string;
    at: string;                 // created_at
    kind: LockEventKind;
    title: string;              // "Bị khoá tự động" | "Admin tắt hoạt động" | "Chờ khoá" | "Mở khoá"
    actor: string;              // "Hệ thống" | tên người thao tác
    reason: string | null;      // lý do KHOÁ hoặc lý do MỞ — đã map đúng (mục 3.1)
    details: string[];          // dòng phụ: ngày vi phạm, giờ khả dụng, câu KTV ghi, mã đơn, phí…
    fee: number | null;         // phí kích hoạt lại (chỉ UNLOCK)
}

listLockEvents(supabase, { staffId?, before?, limit = 30 })
    → { events: LockEvent[]; nextBefore: string | null }

latestLock(supabase, staffId) → LockEvent | null   // dùng cho GET /unlock (mục 3.2)
```

- Lọc `event_type IN (AUTO_LOCK_ABSENCE, AUTO_LOCK_REJECT_NO_HOURS, MANUAL_LOCK, MANUAL_UNLOCK, PENDING_LOCK)`, mới nhất trước, phân trang bằng con trỏ `created_at < before`.
- **Không trả** `ip_address`, `user_agent`, `unlocked_by_id` / `locked_by_id` (UUID nội bộ).
- Dòng cũ thiếu tên người thao tác → `"Không rõ"`.
- `source` → chữ đọc được: `CRON_MIDNIGHT` = "Chốt sổ 00:00", `CRON_PENDING_LOCK` = "Áp khoá sau khi xong đơn", `REJECT_ORDER` = "Từ chối tua", `FEATURES_TABLE` = "Công tắc Hoạt động".

**Vì sao phân trang bằng con trỏ, không lọc theo tháng:** một lần khoá cuối tháng 8 được mở đầu tháng 9 sẽ bị cắt làm đôi nếu xem theo tháng — đúng cặp sự kiện người xem cần thấy liền nhau.

### 4.2. API — `app/api/admin/staff/lock-history/route.ts` (mới)

`GET ?staffId=&before=&limit=` → `listLockEvents`. Quyền `ktv_office_scoring` (cùng quyền trang Chấm điểm KTV).

### 4.3. `GET /api/admin/staff/unlock` — sửa lý do khoá (mục 3.2, nếu duyệt)

`lockReason` / `lockDate` lấy từ `latestLock(staffId)`. Response giữ nguyên cấu trúc → trang Cài đặt (công tắc Hoạt động) dùng chung route này tự đúng theo.
Giữ đường lùi cũ (`KTVDPenaltyLedger`) chỉ khi nhật ký không có dòng nào.

### 4.4. UI — `app/admin/ktv-office/page.tsx` + `AdminKtvOffice.logic.ts`

**A. Nút "Lịch sử khoá"** ở nhóm nút bên phải header (cạnh nút sang trang Giờ tích lũy) → mở sheet mới `lockHistory`:
- Dòng thời gian **toàn bộ KTV**, mới nhất trước, nút **Xem thêm** (30 dòng/lần).
- Chip lọc: `Tất cả · Bị khoá · Mở khoá`; ô tìm theo tên/mã KTV (lọc trên server bằng `staffId` khi chọn một KTV).
- Mỗi dòng:
  ```
  ● 14/09 00:00 · T079 Huỳnh Ngọc Tuấn Hiếu              [Bị khoá tự động]
    Lý do: Không đăng ký lịch và không đi làm
    Ngày vi phạm 12/09 · Chốt sổ 00:00 · Bởi: Hệ thống

  ● 12/09 00:27 · T001 …                                    [Mở khoá]
    Lý do mở: KTV đã bổ sung lịch làm việc…
    Bởi: Developer · Phí kích hoạt lại 1.000.000đ
  ```
  Chấm đỏ = khoá, vàng = chờ khoá, xanh = mở khoá.

**B. Trong modal "Mở khoá"**: dưới ô "Lý do bị khoá", thêm **"Các lần trước"** — 5 sự kiện gần nhất của riêng KTV đó, cùng component dòng, có link "Xem tất cả" mở sheet A đã lọc sẵn KTV.

## 5. Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | Không ảnh hưởng — KTV không xem nhật ký bảo mật; màn đăng nhập / điểm danh đọc lý do khoá bằng đường riêng (`login/actions.ts`, `ktv/attendance/status`), không đổi | `/admin/ktv-office` (nút + sheet + modal Mở khoá); `GET /api/admin/staff/unlock` | `StaffLockHistoryService` (mới), bảng `SecurityAuditLogs` | Sửa |
| Trang Cài đặt → công tắc Hoạt động | — | Dùng chung `GET /unlock` → lý do khoá hiện đúng theo (mục 3.2) | | Sửa gián tiếp — có lợi |
| Số liệu | — | Không có con số tiền/tua/giờ/điểm nào đổi; phí kích hoạt lại chỉ **đọc lại** từ nhật ký | | Không ảnh hưởng |
| Ghi dữ liệu | — | **Chỉ đọc.** Không đổi route ghi nào, không sửa dòng nhật ký cũ | | Không ảnh hưởng |
| Realtime / refresh | — | Không subscribe; mở sheet là tải. Mở khoá xong → tải lại lịch sử của KTV đó | | Đồng bộ |
| Quyền xem | KTV không thấy ai mở khoá / phí | Người có `ktv_office_scoring` thấy tên người thao tác, lý do, phí. **Không** trả IP, thiết bị, UUID | | Không lộ dữ liệu nội bộ |

**Mục 13 (hệ quả nghiệp vụ): không áp dụng** — vì chỉ hiển thị lại sự kiện đã xảy ra, không thêm/đổi sự kiện nào làm thay đổi quyền lợi hay nghĩa vụ của KTV.

**DB:** không migration. `SecurityAuditLogs` đã có index `event_type` và `created_at`; lọc 5 loại sự kiện khoá chỉ chạm vài chục dòng (hiện 17) dù bảng chứa cả vi phạm Wifi. Chưa có index `employee_id`, nhưng lọc theo KTV đi sau lọc `event_type` nên chưa cần. Sẽ bổ sung danh sách `event_type` khoá vào mô tả bảng trong `TableInSupabase.md`.

## 6. Edge case phải kiểm

1. Khoá do từ chối tua → lý do hiện **"Từ chối tua khi không đủ giờ khả dụng"**, câu KTV gõ (`"okay"`) nằm ở dòng phụ riêng.
2. KTV từng bị khoá kỷ luật (đã mở) rồi bị admin tắt công tắc → modal Mở khoá hiện lý do **thủ công mới nhất**, không phải lý do kỷ luật cũ.
3. Chờ khoá → áp khoá: hiện **2 dòng** (Chờ khoá, rồi Bị khoá "Áp khoá sau khi xong đơn"), không gộp.
4. Mở khoá có phí → hiện phí; phí 0 hoặc KTV không phải loại D → không hiện dòng phí.
5. Dòng cũ thiếu `unlocked_by` → "Không rõ", không vỡ giao diện.
6. "Xem thêm": không trùng, không sót dòng khi hai sự kiện cùng một mốc `created_at`.
7. KTV chưa từng bị khoá → "Chưa có lần khoá / mở khoá nào".
8. Response **không** chứa `ip_address`, `user_agent`, `*_by_id`.
9. Mở khoá xong trong modal → sheet lịch sử của KTV đó có ngay dòng "Mở khoá".

## 7. Mô phỏng & QA

- `scripts/qa/qa_17_lock_history.ts` — mock đúng định dạng `details` của từng loại (lấy mẫu từ dữ liệu thật ở mục 2), kiểm: map lý do (edge 1), chọn khoá mới nhất (edge 2), thứ tự & con trỏ (edge 6), không lộ trường nội bộ (edge 8).
- `npx tsc --noEmit`.
- Xem trên giao diện bằng dữ liệu thật: T079 (khoá tự động 12/09), T001 (mở khoá bởi Developer), T069 (khoá do từ chối tua).

## 8. File thay đổi

| File | Việc |
|---|---|
| `lib/services/StaffLockHistoryService.ts` | Mới — đọc & diễn giải sự kiện khoá |
| `app/api/admin/staff/lock-history/route.ts` | Mới — `GET` dòng thời gian |
| `app/api/admin/staff/unlock/route.ts` | `GET`: lý do / ngày khoá lấy từ `latestLock` *(mục 3.2)* |
| `app/admin/ktv-office/AdminKtvOffice.logic.ts` | State + tải lịch sử, sheet `lockHistory` |
| `app/admin/ktv-office/page.tsx` | Nút header, sheet dòng thời gian, mục "Các lần trước" trong modal Mở khoá |
| `TableInSupabase.md` | Liệt kê các `event_type` khoá trong `SecurityAuditLogs` |
| `scripts/qa/qa_17_lock_history.ts` + `package.json` | Mới — thêm vào `test:qa` |

## 9. Rủi ro còn lại (không sửa trong plan này)

`api/admin/staff/lock` và `unlock` ghi nhật ký **sau** khi đổi `status` và **không kiểm lỗi** câu insert. Nếu insert hỏng, khoá/mở vẫn thành công nhưng **mất dòng trong lịch sử**. Hiện dữ liệu thật chưa mất dòng nào (mục 2). Đề xuất tách thành việc riêng nếu anh muốn siết.

## 10. Đã chốt (14/09/2026)

| Điểm | Quyết định |
|---|---|
| A — nút "Lịch sử khoá" ở header, dòng thời gian toàn bộ KTV | ✅ **Làm** |
| B — 5 dòng gần nhất trong modal Mở khoá | ❌ Không làm |
| Mục 3.2 — sửa lý do khoá trong modal Mở khoá (`latestLock`) | ⏸ **Chưa duyệt → không làm.** Lỗi vẫn còn: KTV bị admin tắt công tắc sau một lần khoá kỷ luật cũ thì modal Mở khoá hiện lý do cũ. Mục 4.3 và hàm `latestLock` ở 4.1 vì vậy chưa triển khai |
| Mục 9 — route khoá/mở không kiểm lỗi ghi nhật ký | ⏸ Việc riêng, chưa làm |

**Đã làm theo A:** `StaffLockHistoryService` (`listLockEvents`, `toLockEvent`), `GET /api/admin/staff/lock-history`, sheet `lockHistory` + nút header, `qa_17`, mô tả `event_type` khoá trong `TableInSupabase.md`.
