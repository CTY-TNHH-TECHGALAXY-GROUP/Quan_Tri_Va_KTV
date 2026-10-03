# Đợt 4 — Sửa lỗi ca không bao giờ đóng khi tan ca

> Prompt gửi cho anti. Nối tiếp `plans/prompt_type_d_oncall_dot3.md`. Áp dụng **ANTIGRAVITY MODE**.

---

## 1. Đợt 3 đã nghiệm thu

Tôi kiểm chứng độc lập, chạy thật trên T079, có snapshot + restore:

- `staffCode` → `code` đúng ở cả 2 chỗ; có bắt `userError` và `!user`, test `ZZZ999` trả `success:false` ✅
- `arriveAtVenue` tạo được ca `FREE/ACTIVE`, ca cũ chuyển `REPLACED`, `isOnShift` bật/tắt đúng ✅
- Chọn phương án (a)+(b) cho §3 — `Staff.online_status` ghi cuối, `check_in_at` bọc `try/catch` riêng ✅
- `expected_start` bỏ sạch; preview dùng giờ VN ✅
- Hồi quy: `turns_completed` giữ nguyên 2 sau tan ca rồi vào lại ✅

Đợt này xử lý một lỗi **có sẵn từ trước**, không phải do anti gây ra, nhưng nó làm hỏng đúng nửa sau của luồng.

---

## 2. Bối cảnh nghiệp vụ (đọc trước khi sửa, đừng làm ngược ý)

| Loại | Ca ghi vào `KTVShifts` | Giờ tan ca |
|---|---|---|
| **A** | `SHIFT_1/2/3` | Có giờ cố định — **bị chặn**, chưa tới giờ không cho về |
| **B** | `VIP` | **Không có giờ tan ca** — về lúc nào cũng được |
| **D** | `FREE` | **Không có giờ tan ca** — về lúc nào cũng được |
| **C** | — | KTV ngoài / cộng tác viên, không điểm danh qua app. Ngoài phạm vi |

Logic chặn giờ này **đang đúng**, nằm ở `SHIFT_END_TIMES` trong `app/ktv/attendance/Attendance.logic.ts`. **Không đụng vào.**

---

## 3. P0 — `KTVShifts.actualEndTime` không tồn tại → tan ca không đóng được ca

### Bằng chứng

```
UPDATE KTVShifts SET actualEndTime=..., status='REPLACED'
→ error: Could not find the 'actualEndTime' column of 'KTVShifts' in the schema cache
→ trạng thái ca sau update: vẫn ACTIVE
```

Cột thật của `KTVShifts`:
`id, employeeId, employeeName, shiftType, effectiveFrom, previousShift, reason, status, reviewedBy, reviewedAt, createdAt, estimatedEndTime`

Postgrest từ chối **cả câu update** khi có cột lạ — nên `status` cũng không được ghi theo. Đây là lý do ca không bao giờ chuyển sang `COMPLETED`/`REPLACED`.

Hiện trạng DB: **17 ca đang kẹt `ACTIVE`**, trong đó **13 ca là của những ngày đã qua**, cũ nhất **23/06/2026**. Phân bố: `FREE: 9`, `SHIFT_2: 4`, `SHIFT_1: 2`, `SHIFT_3: 1`, `DEV_SHIFT: 1` — đúng như dự đoán, nhóm `FREE` (B và D, về giờ tự do) dính nhiều nhất.

### Cách sửa: BỎ field, KHÔNG thêm cột

Tôi đã cân nhắc thêm cột rồi bỏ ý định đó, lý do:

- B và D **không có giờ tan ca theo lịch** → chẳng có giờ chuẩn nào để đối chiếu, cột này không phục vụ nghiệp vụ nào.
- Thời điểm bấm về **đã được lưu sẵn** ở `KTVAttendance.checkedAt` của bản ghi `CHECK_OUT`. Tôi đã kiểm dữ liệu thật: đầy đủ, có giờ phút chính xác.
- Thêm cột = lưu trùng một dữ liệu ở hai bảng, sau này lệch nhau lại thành lỗi mới.
- **Không có chỗ nào trong repo đọc `KTVShifts.actualEndTime`.** (Các chỗ `actualEndTime` khác trong `handleFinishService.ts`, `KtvCommissionService.ts`, `KtvDisciplineService.ts` là của **segment booking**, hoàn toàn khác — **không được đụng**.)

Xoá đúng dòng `actualEndTime: ...` tại 3 chỗ:

| File | Dòng | Ngữ cảnh |
|---|---|---|
| `app/api/ktv/attendance/route.ts` | ~351 | nhánh **D** tan ca → `status: 'COMPLETED'` |
| `app/api/ktv/attendance/route.ts` | ~485 | nhánh **A** tan ca → `status: 'COMPLETED'` |
| `lib/services/KtvTypeDOnlineService.ts` | ~118 | **D** tắt nhận đơn → `status: 'REPLACED'` |

Giữ nguyên `status` và `reason`. Sau khi bỏ, câu update chỉ còn cột hợp lệ → DB nhận → ca đóng đúng.

---

## 4. P0 — Nguyên nhân gốc: ghi `KTVShifts` mà không bao giờ đọc lỗi

Lỗi trên sống được từ tháng 6 tới giờ **chỉ vì không chỗ nào kiểm tra kết quả DB trả về**. Sửa cột mà không sửa chỗ này thì lần sau lại có lỗi tương tự nằm im nửa năm.

Rà **mọi** câu `.from('KTVShifts').insert(...)` / `.update(...)` / `.delete(...)` trong `app/` và `lib/`, và với từng câu:

```ts
const { error } = await supabase.from('KTVShifts').update({...})...;
if (error) {
    console.error('[<tên hàm>] KTVShifts update failed:', error.message, error.code);
    // trả lỗi nếu đây là bước bắt buộc, hoặc ít nhất phải log
}
```

Nguyên tắc:

- Ghi **bắt buộc** (đóng ca khi tan ca, mở ca khi tới tiệm) → lỗi phải làm hàm trả `success: false`, không được im lặng đi tiếp.
- Ghi **phụ** → log `console.error` đầy đủ, được phép đi tiếp (giống cách đã làm với `check_in_at` ở đợt 3).

Liệt kê trong báo cáo: đã thêm kiểm tra lỗi ở bao nhiêu chỗ, chỗ nào xếp loại bắt buộc, chỗ nào phụ.

---

## 5. Dọn 13 ca tồn đọng

Viết script `scripts/cleanup_stuck_active_shifts.ts`:

- Tìm mọi `KTVShifts` có `status = 'ACTIVE'` mà `effectiveFrom` **nhỏ hơn business date hôm nay** (ca của ngày đã qua thì chắc chắn không còn ai đang làm).
- Chuyển sang `status = 'REPLACED'`, `reason` giữ nguyên, thêm ghi chú `'Dọn ca treo do lỗi actualEndTime'` nếu bảng cho phép.
- **Tuyệt đối không đụng** ca có `effectiveFrom` = hôm nay — có người đang làm thật.
- In ra trước/sau từng dòng, chạy nhiều lần không hại.

⚠️ **Viết script nhưng CHƯA CHẠY trên production.** Đây là ghi thật vào DB, phải để anh Hiếu bấm nút. Báo cáo xong, chờ duyệt.

---

## 6. Quyết định cần anh Hiếu chốt: có sửa cho Loại B luôn không?

Từ đợt 1 tới giờ nguyên tắc là **không đụng file của B**. Nhưng khi đào lỗi này tôi phát hiện B đang hỏng nặng hơn D, và cùng một nguyên nhân:

`lib/services/KtvOnlineService.ts`

- dòng **128** và **180**: dùng `Users.staffCode` — **cột không tồn tại** (y hệt lỗi D vừa sửa ở đợt 3)
- dòng **132**: `actualEndTime` — y hệt lỗi ở §3

Hậu quả đo được trên DB thật:

```
Số ca shiftType = 'VIP' trong toàn bộ KTVShifts:  0
```

Tức **KTV Loại B bấm "Đã đến tiệm" chưa bao giờ tạo được bản ghi ca nào**, và `goOffline` cũng chưa bao giờ đóng được ca hay tắt `isOnShift`. (197 bản ghi ca của 7 KTV Loại B đều đến từ đường khác: "Admin gán ca", "Tự chọn ca lúc điểm danh".)

Sửa cho B = **3 dòng**, y hệt những gì vừa làm cho D, không đổi cấu trúc gì:

```
KtvOnlineService.ts:128   staffCode → code
KtvOnlineService.ts:180   staffCode → code
KtvOnlineService.ts:132   bỏ dòng actualEndTime
```

**Đề xuất của tôi: làm luôn trong đợt này.** Để lại 3 dòng hỏng y hệt trong khi đang sửa 3 dòng giống hệt bên cạnh là vô lý, và sửa xong dễ hoàn tác.

Nhưng đây là ngoại lệ so với nguyên tắc đã thống nhất → **anti phải hỏi anh Hiếu trước khi đụng vào**, không tự quyết. Nếu anh Hiếu chưa duyệt thì làm §3, §4, §5 trước, để B lại.

---

## 7. Không được đụng

- `SHIFT_END_TIMES` và logic `canCheckOut` trong `Attendance.logic.ts` — quy tắc chặn giờ đang đúng.
- `actualEndTime` của **segment booking** (`handleFinishService.ts`, `handleGetBooking.ts`, `handleStartTimer.ts`, `handleReleaseKTV.ts`, `KtvCommissionService.ts`, `KtvTypeDCommissionService.ts`, `BookingItemPauseService.ts`, `KtvDisciplineService.ts`) — khác hoàn toàn, đừng thấy trùng tên mà xoá nhầm.
- Không tạo migration thêm cột `actualEndTime`.
- File của B — trừ khi anh Hiếu duyệt §6.

---

## 8. Cách verify

Trên **T079**, snapshot trước, restore sau:

1. `arriveAtVenue` → có ca `FREE/ACTIVE` mới.
2. Gọi `goOffline` → ca đó **phải chuyển `REPLACED`** (trước khi sửa thì nó đứng im `ACTIVE`). Dán trạng thái trước/sau.
3. Qua đường thật: gọi API tan ca của D → ca chuyển **`COMPLETED`**.
4. Cố tình truyền một cột sai vào một câu ghi `KTVShifts` → hàm phải **trả lỗi hoặc log rõ**, không được im lặng báo thành công. Đây là nghiệm thu của §4.
5. Chạy script §5 ở chế độ in-thử (dry run) → liệt kê đúng **13 dòng** của ngày cũ, **không** đụng dòng của hôm nay.
6. Hồi quy đợt 2–3: gán 2 tua → tan ca → vào lại → `turns_completed` vẫn 2, ca mới được mở.
7. `npx tsc --noEmit` sạch; `npm run test:type-d` xanh.
8. `grep -rn "actualEndTime" app/ lib/ | grep -i ktvshifts` → phải bằng 0 (hoặc chỉ còn dòng của B nếu chưa được duyệt §6).

**Restore T079 về đúng snapshot ban đầu.**

---

## 9. Output bắt buộc

- Log DB bước 2 và 3: `status` của ca trước và sau khi tan ca.
- Danh sách các câu ghi `KTVShifts` đã thêm kiểm tra lỗi, phân loại bắt buộc / phụ.
- Kết quả dry run của script dọn ca (13 dòng), **kèm câu hỏi xin phép chạy thật**.
- Đã hỏi anh Hiếu về §6 chưa, câu trả lời là gì.
- Xác nhận đã restore T079.
- Risk còn treo: cron `auto-offline` / `cleanup-online` vẫn dùng chung cho cả D; lỗi `turns_completed` bên `KtvOnlineService.arriveAtVenue` của B.
