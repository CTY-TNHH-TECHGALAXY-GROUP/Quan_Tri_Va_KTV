# 📋 Plan Bổ Sung — Báo Vắng & Báo Trễ (TYPE_D)

> **Trạng thái**: Thiết kế nghiệp vụ đã rõ ✅ — Còn 5 điểm cần chốt ⚠️
> **Ngày**: 2026-09-02
> **Liên quan**: §5.3 và §14 câu 17–18 của [`plan_che_do_type_d.md`](./plan_che_do_type_d.md)
> **Nguồn**: Thiết kế luồng do anti đề xuất + luật vận hành do chủ dự án chốt

Đây là phần **phụ thuộc bị thiếu** của `KtvTypeDDisciplineService`: không có luồng đăng ký lịch và báo vắng/báo trễ thì hệ thống không có căn cứ để biết thế nào là "bỏ lịch", nên không thể tự động trừ giờ.

---

## 1. Luật vận hành (chủ dự án chốt)

```
Trước 00:00     →  KTV đăng ký ngày đi làm HÔM SAU

NGHỈ CẢ NGÀY
  Báo trước 07:00        →  −5 giờ
  Từ 07:00 trở đi        →  không báo được nữa → rơi vào chốt chặn cuối ngày → −10 giờ
  Không báo, không đến   →  −10 giờ

ĐI LÀM NHƯNG MUỘN
  Báo trễ + giữ đúng hẹn →  không phạt
  Không báo, hoặc báo rồi thất hứa  →  −5 giờ
```

**Mốc 07:00 chỉ chi phối việc NGHỈ.** Sau 07:00 KTV không xin nghỉ được nữa — chỉ còn đường báo trễ. Nếu báo trễ rồi vẫn không đến thì cuối ngày vẫn bị ghi −10 giờ.

Việc **báo trễ không bị giới hạn bởi mốc 07:00** — bấm lúc nào cũng được, miễn một lần trong ngày, và mức phạt phụ thuộc việc có giữ đúng giờ đã hẹn hay không.

---

## 2. Giao diện: nút ĐIỀU CHỈNH trên màn chấm công

> **[Chốt 02/09] KHÔNG làm hai nút riêng "Báo Vắng" / "Báo Trễ".**
> Tất cả gói vào **một nút "Điều chỉnh"** trên màn chấm công sẵn có `/ktv/attendance`.

Khi tài khoản là **TYPE_D**, màn `/ktv/attendance` hiển thị thêm:

1. **Giờ đăng ký đi làm** của KTV đó trong ngày
2. **Nút "Điều chỉnh"** — nội dung thay đổi theo thời điểm bấm

### Nút Điều chỉnh mở ra gì

| Thời điểm bấm | Lựa chọn hiện ra |
|---|---|
| **Trước 07:00** | ✅ Báo vắng<br>✅ Báo trễ (nhập giờ dự kiến đến) |
| **Từ 07:00 trở đi** | ❌ Không còn Báo vắng<br>✅ Chỉ còn Báo trễ — **bắt buộc nhập giờ đến** |

Sau 07:00 mà KTV muốn nghỉ hẳn thì **không có đường bấm nữa**. Họ hoặc báo trễ rồi không đến, hoặc không thao tác gì — cả hai đều rơi vào chốt chặn cuối ngày và chịu **−10h**. Kết quả giống nhau, nên không cần nút riêng.

File cần sửa: `app/ktv/attendance/page.tsx` (1000 dòng) và `Attendance.logic.ts` (401 dòng). Chỉ thêm nhánh cho TYPE_D, **không đụng luồng của A/B/C**.

---

## 3. Luồng BÁO VẮNG (nghỉ cả ngày)

| Tình huống | Ghi nhận | Phạt |
|---|---|---|
| Bấm Điều chỉnh → Báo vắng, **trước 07:00** | Nghỉ có báo trước | **−5h** (`ABSENT_EARLY_NOTICE`) |
| **Từ 07:00 trở đi** — không còn nút báo vắng | — | — |
| Có đăng ký, hết ngày không check-in, không thao tác gì | Bỏ lịch không báo | **−10h** (`ABSENT_NO_NOTICE`) — cron tự ghi |

**Chốt chặn cuối ngày**: cron chạy sau 23:59, quét các KTV **có đăng ký lịch hôm đó** nhưng **không có bản ghi check-in** và **không báo vắng hợp lệ** → ghi `ABSENT_NO_NOTICE` (−10h).

Đây là cơ chế duy nhất áp mức −10h. Vì sau 07:00 KTV không bấm báo vắng được nữa, nên mọi trường hợp nghỉ muộn đều đi qua cron này.

---

## 4. Luồng BÁO TRỄ (đi làm muộn)

Nguyên tắc: **phải hẹn lại giờ cụ thể**, và **chỉ được hẹn một lần**.

Bấm Điều chỉnh → Báo trễ → **bắt buộc chọn giờ dự kiến có mặt**. Hệ thống dời mốc tính trễ sang đúng giờ đó.

| Tình huống | Hành vi | Kết quả |
|---|---|---|
| **A** | Không báo gì, check-in muộn hơn giờ quy định | **−5h** (`LATE_NO_UPDATE`) |
| **B** | Báo trễ hẹn 10:30, check-in lúc 10:15 | **Không phạt** — giữ đúng hẹn |
| **C** | Báo trễ hẹn 10:30, check-in lúc 11:00 | **−5h** — thất hứa, coi như trễ không cập nhật |
| **D** | Báo trễ nhưng không bao giờ đến | **−10h** — rơi vào chốt chặn cuối ngày |

**Chặn spam**: nút Báo Trễ chỉ dùng được **1 lần/ngày**. Không cho 10:00 hẹn 10:30, rồi 10:20 lại hẹn 11:00. Sau lần đầu, nút chuyển sang trạng thái đã dùng và hiện giờ đã hẹn.

---

## 5. Hai câu hỏi của anti — HỆ THỐNG ĐÃ CÓ SẴN CÂU TRẢ LỜI ✅

### 5.1 "Tiệm quản lý điểm danh bằng công cụ gì?"

**Đã có sẵn, không cần xây mới.** Cơ chế thật: **KTV kết nối wifi tiệm + chụp ảnh**, gửi từ app, admin duyệt (`PENDING` → `CONFIRMED` / `REJECTED`).

Chốt chặn nằm ở **kiểm tra IP wifi**, không phải GPS (`app/api/ktv/attendance/route.ts:70-90`):

```
1. Đọc dải IP tiệm từ SystemConfigs key 'spa_wifi_ips'
2. So 2 octet đầu của IP máy KTV với dải cho phép
   (chỉ 2 octet, để chịu được IP động đổi trong cùng mạng)
3. Không khớp → từ chối + ghi SecurityAuditLogs (event_type = 'INVALID_WIFI_IP')
```

Cột `latitude`/`longitude` có trong bảng nhưng **không dùng để chặn**. `SUDDEN_OFF` được miễn kiểm IP — hợp lý, vì người xin nghỉ đột xuất đang ở nhà.

> ✅ **Đây là nền tảng tốt cho việc bắt lỗi trễ.** KTV **không thể điểm danh từ xa** — muốn có bản ghi check-in thì phải thật sự đứng trong tiệm. Nên mốc giờ check-in đáng tin cậy để tính trễ, không lo KTV nằm nhà bấm rồi thủng thẳng đi sau.

> [!CAUTION]
> **Phải dùng `createdAt`, KHÔNG dùng `confirmedAt`.**
>
> | Mốc | Ý nghĩa | Kết luận |
> |---|---|---|
> | `createdAt` — lúc KTV bấm gửi | Là lúc họ thật sự có mặt (đã qua kiểm wifi) | ✅ **dùng cái này** |
> | `confirmedAt` — lúc admin duyệt | Phụ thuộc admin rảnh lúc nào | ❌ KTV đến đúng giờ mà admin duyệt trễ 30 phút sẽ bị phạt oan −5h |
>
> Plan của anti chưa nhắc tới điểm này.

Số liệu thật trên production:

```
CHECK_IN    : 851 bản ghi
CHECK_OUT   : 679
SUDDEN_OFF  :  13
OVERTIME    :   2
```

Code tại `app/api/ktv/attendance/route.ts` đã xử lý các loại: `CHECK_IN`, **`LATE_CHECKIN`**, `CHECK_OUT`, `SUDDEN_OFF`, `OFF_REQUEST`, `OVERTIME`.

> **Đáng chú ý: `LATE_CHECKIN` đã tồn tại sẵn trong code.** Cần kiểm tra xem nó đang được dùng thế nào trước khi thêm cơ chế báo trễ mới — có thể tái dùng thay vì xây song song.
>
> Tương tự, `SUDDEN_OFF` (nghỉ đột xuất) đã có và đang chạy — luồng "Báo Vắng" nhiều khả năng chính là mở rộng của nó, không phải làm mới từ đầu.

**Mốc check-in thực tế**: lấy từ `KTVAttendance` khi bản ghi `CHECK_IN` được duyệt.

### 5.2 "Khung giờ đi làm chuẩn là mấy giờ?"

**Đã định nghĩa sẵn** tại `app/api/ktv/shift/route.ts:6`:

| Ca | Giờ | Số bản ghi thực tế |
|---|---|---|
| `SHIFT_1` | 09:00 – 17:00 | 77 |
| `SHIFT_2` | 11:00 – 19:00 | 82 |
| `SHIFT_3` | 17:00 – 00:00 | 21 |
| `DEV_SHIFT` | 09:00 – 21:00 | 40 |
| **`FREE`** | **00:00 – 23:59** | **140 ← nhiều nhất** |
| `REQUEST` | 00:00 – 23:59 | 20 |

---

## 6. ⚠️ Vấn đề 1: Ca FREE chiếm đa số mà không có mốc giờ

`FREE` là loại ca **phổ biến nhất (140 bản ghi)**, và nó được định nghĩa là `00:00 – 23:59`.

Nghĩa là với ca FREE, **không tồn tại mốc giờ bắt đầu** để tính "đi trễ". Toàn bộ luồng Báo Trễ ở mục 4 sẽ không có căn cứ áp dụng cho nhóm này.

Anti đề xuất: *"nếu KTV làm tự do thì lấy mốc giờ của TUA GÁN làm mốc tính trễ"*. Hướng này hợp lý nhưng đổi bản chất vấn đề:

- Với ca cố định: trễ = đến muộn hơn giờ vào ca → phạt vì **không có mặt**
- Với ca FREE: trễ = đến muộn hơn giờ được gán tua → phạt vì **để khách chờ**

Hai loại vi phạm khác nhau, và mức −5h có thể không phù hợp cho cả hai.

**Cần chốt**: KTV TYPE_D sẽ dùng loại ca nào? Nếu tất cả đều FREE thì luồng Báo Trễ phải thiết kế lại quanh mốc **giờ gán tua**, không phải giờ vào ca.

---

## 7. ⚠️ Vấn đề 2: Chưa có bảng ĐĂNG KÝ LỊCH THEO NGÀY

Anti đề xuất thêm 3 cột vào "Daily Shift". **Nhưng bảng đó không tồn tại.** Hiện có:

| Bảng | Bản chất | Dùng được cho đăng ký ngày? |
|---|---|---|
| `KTVShifts` | Loại ca **áp dụng từ ngày X trở đi** (`effectiveFrom`) — một khai báo lâu dài, không phải đăng ký từng ngày | ❌ |
| `TurnQueue` | Đúng là theo ngày (`UNIQUE(employee_id, date)`), nhưng **chỉ được tạo SAU KHI duyệt điểm danh** (`attendance/confirm/route.ts:103`) | ❌ — không thể chứa thông tin "đăng ký cho ngày mai" |
| `KTVAttendance` | Ghi nhận sự kiện điểm danh, không phải đăng ký trước | ❌ |

→ **Phải tạo bảng mới**, ví dụ `KTVDailyRegistration`:

```sql
CREATE TABLE IF NOT EXISTS "KTVDailyRegistration" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "staff_id" TEXT NOT NULL,
  "work_date" DATE NOT NULL,          -- ngày sẽ đi làm
  "registered_at" TIMESTAMPTZ DEFAULT NOW(),
  "status" TEXT DEFAULT 'REGISTERED', -- REGISTERED | ABSENT_REPORTED | LATE_REPORTED | COMPLETED
  "absent_reported_at" TIMESTAMPTZ,   -- lúc bấm Báo Vắng
  "late_reported_at" TIMESTAMPTZ,     -- lúc bấm Báo Trễ
  "late_expected_time" TIME,          -- giờ hẹn có mặt
  "late_report_count" INT DEFAULT 0,  -- chặn spam, tối đa 1
  "check_in_at" TIMESTAMPTZ,          -- giờ điểm danh thực tế
  "penalty_applied" TEXT,             -- mã phạt đã áp, tránh phạt hai lần
  UNIQUE("staff_id", "work_date")
);
```

Ba cột anti đề xuất (`late_reported_time`, `late_report_count`, `check_in_time`) đã nằm trong đây, đặt tên theo quy ước sẵn có của dự án.

Cột `penalty_applied` là bổ sung của tôi — **bắt buộc có** để cron chốt chặn cuối ngày không ghi phạt trùng với phạt đã ghi lúc KTV bấm nút.

---

## 8. ⚠️ Vấn đề 3: `LATE_NO_UPDATE` không còn chồng lấn nữa

§14 câu 17 hỏi có nên bỏ `LATE_NO_UPDATE` (−5h) không, vì nghi nó chồng với `ABSENT_NO_NOTICE` (−10h).

**Thiết kế của anti đã giải quyết câu này.** Hai mục phục vụ hai hành vi khác nhau:

| Mã | Hành vi | Mức |
|---|---|---|
| `ABSENT_NO_NOTICE` | **Nghỉ cả ngày** — bỏ lịch, hoặc báo vắng từ 07:00 | −10h |
| `ABSENT_EARLY_NOTICE` | **Nghỉ cả ngày** — báo vắng trước 06:59 | −5h |
| `LATE_NO_UPDATE` | **Vẫn đi làm nhưng đến muộn** — không báo, hoặc báo rồi thất hứa | −5h |

Không chồng lấn: một bên là *không đi làm*, một bên là *có đi làm nhưng muộn*.

→ **Giữ `LATE_NO_UPDATE`.** Coi §14 câu 17 là đã chốt.

Nhưng nhãn giao diện phải nói rõ sự khác biệt này, nếu không admin vẫn hiểu nhầm.

---

## 9. Các mục cần thêm

### Database
- Bảng mới `KTVDailyRegistration` (mục 7)
- Cân nhắc tái dùng `KTVAttendance.LATE_CHECKIN` thay vì cơ chế mới

### API
- `POST /api/ktv/daily-registration` — đăng ký ngày mai (khoá sau 00:00)
- `POST /api/ktv/report-absent` — báo vắng, kèm logic mốc 07:00 và cảnh báo
- `POST /api/ktv/report-late` — báo trễ, kèm giờ hẹn, chặn quá 1 lần/ngày
- `POST /api/cron/daily-absence-check` — chốt chặn 23:59

### UI App KTV
- Màn hình đăng ký lịch ngày mai
- Hai nút hành động: **Báo Vắng**, **Báo Trễ**
- Hộp cảnh báo khi báo vắng sau 07:00
- Bộ chọn giờ khi báo trễ

### Cron
- Đăng ký `daily-absence-check` trong `vercel.json` (chạy sau 23:59 giờ VN = 16:59 UTC)

---

## 10. Năm điểm cần chốt trước khi code

| # | Câu hỏi | Vì sao chặn |
|---|---|---|
| **1** | **KTV TYPE_D dùng loại ca nào?** Nếu là `FREE` (đang chiếm 140/380 bản ghi) thì không có mốc giờ vào ca, luồng Báo Trễ phải tính theo **giờ gán tua** thay vì giờ vào ca | Quyết định toàn bộ cách tính "trễ" |
| **2** | **Tái dùng `SUDDEN_OFF` và `LATE_CHECKIN` sẵn có, hay xây luồng mới?** Hai loại này đã chạy thật (13 bản ghi SUDDEN_OFF) | Tránh xây hai hệ thống song song cho cùng một việc |
| **3** | **KTV không đăng ký gì cả thì tính sao?** Nghỉ có phép (không phạt), hay vẫn coi là bỏ lịch? | Quyết định cron chốt chặn quét ai |
| **4** | **Đăng ký rồi có được huỷ không?** Nếu được thì huỷ trước 00:00 hay trước 07:00, và có phạt không? | Ảnh hưởng trạng thái của `KTVDailyRegistration` |
| **5** | **Bản ghi check-in bị admin TỪ CHỐI thì tính sao?** Có `createdAt` đúng giờ nhưng `status = REJECTED`. Coi như đã có mặt (không phạt), hay coi như chưa điểm danh (cron cuối ngày phạt −10h bỏ lịch)? | Chênh lệch 10 giờ tích lũy — hiếm nhưng sẽ xảy ra |

---

## 11. Thứ tự triển khai đề xuất

Phần này **không nên nhét vào Phase 6**. Nó là một hệ thống con riêng, và là **phụ thuộc chặn** của `KtvTypeDDisciplineService`.

```
Phase 5   Admin UI tab D          ← đang làm, gần xong
Phase 5.5 Đăng ký lịch + báo vắng/báo trễ   ← PHẦN NÀY (mới)
Phase 6   Reception / Dispatch
Phase 7   KTV App (phần ví)
Phase 8   Cron
```

Lý do đặt trước Phase 6: chưa có phần này thì `KtvTypeDDisciplineService` không có dữ liệu đầu vào, và giờ tích lũy dùng để xếp tua ở Phase 6 sẽ thiếu vế trừ giờ.

 - - - 
 # #   1 2 .   B �  s u n g   q u a n   t r �n g   ( C h �t   C � u   1 8 ) 
 �   c �p   n h �t   t h e o   c h �  �o   m �i   n h �t : 
 -   * * T � i   s �  d �n g   m � n   h � n h   \ / k t v / s c h e d u l e \ * *   h i �n   t �i   �  K T V   T Y P E _ D   n g   k �   i   l � m . 
 -   K T V   s �  t h a o   t � c   c h �n   * * N g � y * *   v �   n h �p   * * G i �  �n * * . 
 -   T h a y   v �   x � y   d �n g   m �t   t r a n g   h o � n   t o � n   m �i ,   t a   c h � n   U I / U X   n � y   t h �n g   v � o   \ / k t v / s c h e d u l e \   c h o   �n g   b �  h �  t h �n g . 
  
 
---
## 13. Quyết định cuối cùng từ Chủ Dự Án (Chốt Phase 5.5)

**1. KTV không đăng ký lịch làm & không đăng ký nghỉ:**
- BẮT BUỘC phải đăng ký Đi làm hoặc Nghỉ (Off).
- Hết ngày làm việc (23:59 - tức là sau 24h) mà KTV vẫn không có bất kỳ thông báo hay hành động nào (Không đăng ký làm, không đăng ký Off, không đi làm) -> **Hệ thống tự động KHÓA TÀI KHOẢN (Deactivate App)**.
- Trạng thái: Buộc đóng phí kích hoạt lại (1.000.000đ - 2.000.000đ) để mở khóa app.

> **Cập nhật 14/09/2026 (Chủ Dự Án)** — thay cho ý trên và quyết định 12/09:
> - 00:00 mà **ngày vừa sang chưa có dòng đăng ký** (đi làm hoặc OFF) → **khoá thẳng**, không miễn người đang làm dở đơn.
> - **Ngày vừa qua không có dòng đăng ký** → khoá, **kể cả có đi làm** (bắt người được quầy mở khoá mà vẫn không đăng ký).
> - Hôm nay chưa có dòng thì KTV tạo đăng ký được mọi lúc trong ngày (đường đăng ký bù sau khi mở khoá).
> - 21:00 nhắc KTV chưa đăng ký, công tắc ở Quản lý tính năng.
> Chi tiết: `plans/plan_khoa_khi_chua_dang_ky_lich_loai_d.md`.

**2. Hủy lịch đã đăng ký:**
- Cho phép KTV tự do HỦY lịch làm việc trước 00:00.
- Từ 00:01 trở đi: KHÔNG được hủy tự do. Bắt buộc dùng nút "Điều chỉnh" -> **Báo vắng**. 
  - Nếu báo vắng từ 00:01 đến trước 07:00: Tránh được án phạt nặng, chỉ bị trừ 5h (chứ không bị trừ 10h).
  - Nếu báo vắng từ 07:00 trở đi: Bị trừ 10h.

**3. Bản ghi check-in bị từ chối:**
- Hệ thống hiện tại đang **Auto-duyệt điểm danh** (bằng IP Wifi). Do đó không phát sinh trường hợp Admin bấm từ chối bằng tay. Dữ liệu `createdAt` của bản ghi điểm danh Auto-approve là mốc thời gian chốt chuẩn xác 100%.

**KẾT LUẬN:** Mọi luồng logic đã kín kẽ hoàn toàn. File Kế hoạch Phase 5.5 (Đăng ký lịch + Điều chỉnh Báo vắng/Báo trễ) CHÍNH THỨC ĐƯỢC CHỐT.

---
## 14. Chốt Logic Phương Án B (Trì hoãn xử phạt đến cuối ngày)
Theo quyết định của Chủ dự án, hệ thống sẽ KHÔNG trừ điểm ngay lập tức khi KTV bấm nút [Báo Vắng] để tránh tình trạng "quay xe" (KTV báo vắng xong lại đổi ý lên tiệm đi làm).

**Logic thống nhất (Chỉ xử lý phạt Báo Vắng / Bỏ lịch vào lúc 23:59 đêm):**
1. Khi KTV bấm nút **[Báo Vắng]** (dù trước hay sau 07:00):
   - Hệ thống CHỈ LƯU TRẠNG THÁI (Lưu giờ bấm nút).
   - KHÔNG trừ bất kỳ giờ tích lũy nào tại thời điểm bấm.

2. Khi KTV **Điểm danh (Check-in)** tại tiệm:
   - Hệ thống ghi nhận có mặt.
   - Ngay lúc này, hệ thống sẽ check xem có bị ĐI TRỄ không (dựa vào giờ đến thực tế so với giờ đăng ký/giờ báo trễ). Nếu trễ -> Trừ thẳng **-5h** (Lỗi Đi trễ).

3. Quét chốt sổ cuối ngày **(23:59 đêm)**:
   Cron Job sẽ quét toàn bộ danh sách KTV đăng ký đi làm hôm nay.
   - KTV NÀO CÓ RECORD ĐIỂM DANH: Bỏ qua (vì đã xử lý lúc họ đến tiệm).
   - KTV NÀO KHÔNG CÓ RECORD ĐIỂM DANH CẢ NGÀY: 
     + Nếu đã bấm [Báo Vắng] trước 07:00 -> Xử phạt **-5h** (Nghỉ có báo trước).
     + Nếu đã bấm [Báo Vắng] từ 07:00 trở đi HOẶC Không bấm gì cả -> Xử phạt nặng **-10h** (Bỏ lịch / Báo muộn).

> **Nhận xét Kiến trúc:** Phương án B này là **Hoàn Hảo**. Nó giải quyết triệt để mọi case KTV "đổi ý phút chót" mà không cần code các luồng hoàn tiền, rollback phức tạp. Mọi thứ được phán quyết công bằng vào giây phút cuối cùng của ngày!
