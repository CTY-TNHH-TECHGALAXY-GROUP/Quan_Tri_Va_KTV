# Kế hoạch triển khai: Trang Admin Chấm Điểm Office & Quản Lý Tài Khoản KTV Loại D

**Ngày lập:** 04/09/2026 · **Cập nhật:** 04/09/2026 (bản triển khai)
**Nhánh:** `feat/bit-lo-hong-phase1`
**Mockup đã duyệt:** https://claude.ai/code/artifact/9749a0f5-7bab-4a53-94c4-150cb8d5e43f
**Người dùng chính:** Quầy lễ tân + Quản lý (không rành công nghệ)

---

## 0. Các quyết định đã chốt

| # | Nội dung | Chốt | Ngày |
|---|---|---|---|
| 1 | Phạt lỗi lặp ≥3 lần/tháng | **Phương án A** — trừ thêm đúng 1 lần điểm lỗi đó, bất kể lặp 3 hay 10 lần | 04/09 |
| 2 | Cách đếm lỗi lặp | **3 lần rải rác bất kỳ trong tháng**, không cần liên tiếp | 04/09 |
| 3 | Thời điểm áp phạt lỗi lặp | Hiển thị **ngay khi chạm lần thứ 3**, không đợi cuối tháng (kết quả cuối tháng như nhau, nhưng KTV biết đường sửa) | 04/09 |
| 4 | Hiển thị quỹ nội bộ | Hiện **số tiền còn phải đóng**, không hiện số được miễn | 04/09 |
| 5 | Ô "Điểm trung bình toàn đội" | **Bỏ** — không giúp ra quyết định | 04/09 |

### Giả định tôi tự quyết (chưa có xác nhận — nói một câu là đổi được)

| # | Nội dung | Đang làm theo | Vì sao |
|---|---|---|---|
| A1 | Đơn vị chấm điểm | **Theo ngày**, không theo ca. KTV làm 2 ca/ngày, vi phạm ca sau vẫn tính 1 ngày | Đúng chữ "điểm ngày" trong quy chế |
| A2 | Lễ tân trừ được ngày nào | **Hôm nay + hôm qua**. Quản lý trừ được mọi ngày | Không giới hạn thì dễ trừ bù cả tuần trước, KTV không cãi được vì đã quá lâu |
| A3 | Lỗi nào bắt buộc ảnh | **Bắt buộc nhóm III** (thái độ, ngoại hình). Nhóm I, II tùy chọn | Bắt buộc hết thì lễ tân ngại chụp, sẽ bỏ qua không trừ — phản tác dụng |

---

## 1. Hiện trạng

Hai thang đo song song cho KTV Loại D, Admin không nhìn thấy cái nào:

| Thang đo | Bảng lưu | Ảnh hưởng | Admin xem được? |
|---|---|---|---|
| **Giờ tích lũy** (±giờ) | `KTVServiceHoursLedger` | Thứ tự nhận tua trong ngày | ❌ Không có trang nào đọc ra |
| **Điểm Office** (100đ/ngày) | **Chưa có bảng** | Miễn quỹ nội bộ 250k/tháng | ❌ Chưa số hóa |

Đã có sẵn, dùng lại được:
- `POST /api/admin/staff/unlock` — mở khóa tài khoản, **viết xong nhưng chưa màn hình nào gọi**
- Bucket `attendance` + pattern nén ảnh client ([attendance/route.ts:253](app/api/ktv/attendance/route.ts:253))
- `createNotification({ type, message, employeeId })`
- `KtvTypeDDisciplineService` cho phần giờ

---

## 2. Cơ sở dữ liệu

### 2.1 `KTVOfficeCriteria` — danh mục 18 tiêu chí

```sql
create table "KTVOfficeCriteria" (
  id            text primary key,          -- 'P1', 'T1', 'A1'...
  grp           text not null,             -- 'I' | 'II' | 'III'
  grp_label     text not null,
  label         text not null,
  points        numeric not null,
  requires_photo boolean not null default false,
  sort_order    int not null,
  is_active     boolean not null default true
);
```

Seed từ [public/regulations/type-d.html](public/regulations/type-d.html):

| id | Nhóm | Tiêu chí | Điểm | Ảnh |
|---|---|---|---|---|
| P1 | I (40đ) | Trước tua (khi có đơn hàng) | 5 | |
| P2 | I | Nhận tua & đón khách tại sảnh | 5 | |
| P3 | I | Trong dịch vụ | 10 | |
| P4 | I | Kết thúc dịch vụ | 5 | |
| P5 | I | Sau dịch vụ — tại sảnh | 5 | |
| P6 | I | Sau dịch vụ — tại phòng, bàn giao | 10 | |
| T1 | II (30đ) | Bật app đúng giờ đã đăng ký | 7.5 | |
| T2 | II | Sẵn sàng nhận tua trong ca | 7.5 | |
| T3 | II | Tắt app kết thúc ngày làm việc | 7.5 | |
| T4 | II | Chuyên cần — đi làm đều | 7.5 | |
| A1 | III (30đ) | Đồng phục | 3 | ✅ |
| A2 | III | Ngoại hình | 6 | ✅ |
| A3 | III | Tác phong & chuẩn mực chào hỏi | 6 | ✅ |
| A4 | III | Tinh thần đồng đội & hòa khí nội bộ | 3 | ✅ |
| A5 | III | Minh bạch kênh tương tác & báo cáo | 3 | ✅ |
| A6 | III | Trung thực & trách nhiệm nghề nghiệp | 3 | ✅ |
| A7 | III | Minh bạch tài chính & cấm thu lợi bất chính | 3 | ✅ |
| A8 | III | Bảo mật thông tin tuyệt đối | 3 | ✅ |

Để trong bảng (không hard-code) để Admin sửa điểm/thêm tiêu chí không cần deploy.

### 2.2 `KTVOfficeScoreLog` — mỗi dòng là một lần trừ điểm

```sql
create table "KTVOfficeScoreLog" (
  id              uuid primary key default gen_random_uuid(),
  staff_id        text not null references "Staff"(id),
  work_date       date not null,              -- ngày VI PHẠM, không phải ngày nhập
  criteria_id     text not null,
  criteria_label  text not null,              -- snapshot, phòng khi đổi quy chế
  points_deducted numeric not null,
  note            text,
  photo_urls      jsonb default '[]'::jsonb,
  created_by      text not null references "Staff"(id),
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,                -- soft delete, không xoá cứng
  revoked_by      text,
  revoke_reason   text
);

-- Quy chế: "mỗi lỗi chỉ trừ 1 lần/ngày dù lặp lại nhiều lần" → DB phải chặn
create unique index ux_office_once_per_day
  on "KTVOfficeScoreLog" (staff_id, work_date, criteria_id)
  where revoked_at is null;

create index ix_office_staff_month on "KTVOfficeScoreLog" (staff_id, work_date);
```

**Chỉ ghi dòng khi có vi phạm.** Ngày đi làm sạch không có dòng nào, mặc định 100đ — giống cách mockup đang mô phỏng.

---

## 3. Công thức tính

```
Điểm ngày   = 100 − Σ(points_deducted của ngày đó, revoked_at IS NULL)

Điểm tháng  = [ (số ngày sạch × 100 + Σ điểm các ngày có vi phạm) ÷ số ngày đi làm ]
              − Σ(phạt lỗi lặp)

phạt lỗi lặp = với mỗi criteria_id xuất hiện ≥ 3 lần trong tháng (rải rác bất kỳ),
               trừ thêm ĐÚNG 1 LẦN điểm của lỗi đó
```

**"Ngày đi làm"** = có bản ghi `KTVAttendance` với `checkType IN ('CHECK_IN','LATE_CHECKIN')`. Ngày OFF không vào mẫu số.

Phạt lỗi lặp là **giá trị dẫn xuất, không lưu vào bảng** — tính ở tầng đọc, để đổi quy chế không phải migrate. Ngưỡng đặt hằng số `REPEAT_THRESHOLD = 3`.

### Bậc quỹ nội bộ (gốc 250.000đ/tháng)

| Điểm tháng | Miễn | **Còn phải đóng** |
|---|---|---|
| ≥ 98 | 100% | **0đ** |
| 96 – 97,9 | 50% | **125.000đ** |
| 90 – 95,9 | 30% | **175.000đ** |
| 85 – 89,9 | 10% | **225.000đ** |
| < 85 | 0% | **250.000đ** |

---

## 4. API

| Endpoint | Việc | Ghi chú |
|---|---|---|
| `GET /api/admin/ktv-office/summary?month=YYYY-MM` | Danh sách KTV Loại D + điểm tháng + giờ tích lũy + trạng thái khóa | Gộp 1 request, tránh N+1 |
| `GET /api/admin/ktv-office/criteria` | 18 tiêu chí đang active | Cache được |
| `GET /api/admin/ktv-office/staff/[id]?month=` | Lịch sử điểm + lịch sử giờ của 1 KTV | Cho màn C |
| `POST /api/admin/ktv-office/deduct` | Ghi các dòng trừ + upload ảnh + gửi notification | Transaction |
| `POST /api/admin/ktv-office/revoke` | Thu hồi 1 dòng | Chỉ Quản lý |
| *(dùng lại)* `POST /api/admin/staff/unlock` | Mở khóa | **Đã có** |

**Bắt buộc mọi route mới:** gọi `requirePermission('ktv_office_scoring')` ở đầu — bài học từ `finish-early-paused` hiện đang không có lớp bảo vệ nào.

**Ảnh:** bucket `attendance`, thư mục `office-evidence/{staff_id}/{work_date}/`. Nén phía client trước khi gửi.

**Thông báo:** *"Bạn bị trừ 10,5 điểm Office ngày 04/09: Bật app đúng giờ (−7,5đ), Đồng phục (−3đ). Xem chi tiết trong mục Hiệu Suất."*

---

## 5. Giao diện

Bám theo mockup đã duyệt. Bốn màn:

**Màn A — Danh sách KTV** (`/admin/ktv-office`)
Thẻ xếp hạng theo **giờ tích lũy** (đúng quy chế: giờ cao xếp tua trước), huy chương 🥇🥈🥉 top 3. Thanh màu theo **điểm Office** (xanh ≥96 / vàng 90–95 / đỏ <90). Dòng quỹ hiện **số tiền còn phải đóng**, đỏ khi còn nợ, xanh khi 0đ. Badge vàng khi có lỗi lặp ≥3 lần. Thẻ bị khóa đẩy lên đầu, viền đỏ. Hai ô thống kê: số KTV hoạt động, số tài khoản bị khóa.

**Màn B — Trừ điểm** (bottom sheet, 3 bước)
1. Chọn ngày — 3 nút to: Hôm nay / Hôm qua / Ngày khác (lễ tân bị chặn ở nút thứ 3 theo A2)
2. Tích lỗi — 18 tiêu chí gom 3 nhóm; **số "Điểm còn lại" nhảy realtime**; lỗi đã trừ trong ngày hiện xám + khóa kèm *"Đã trừ lúc 14:20 bởi Lễ tân Hoa"*; lỗi có gợi ý tự động hiện nhãn ⚡; khu ảnh + ghi chú; nút xác nhận đổi chữ và bị khóa khi thiếu ảnh bắt buộc
3. Xác nhận — tóm tắt ai/ngày nào/mấy lỗi/bao nhiêu điểm/mấy ảnh

**Màn C — Lịch sử một KTV** (2 tab)
- *Điểm Office*: bảng "Cách tính điểm tháng" bóc từng dòng (ngày sạch × 100 → từng ngày vi phạm → trung bình → phạt lỗi lặp → điểm tháng → quỹ phải đóng), rồi timeline chi tiết từng ngày kèm ảnh và nút Thu hồi
- *Giờ tích lũy*: đọc `KTVServiceHoursLedger`, mã phạt dịch sang tiếng Việt, có cột số dư lũy kế — **đây là phần đang thiếu hoàn toàn**

**Màn D — Mở khóa**
Hiện lý do bị khóa + thời điểm (đọc `SecurityAuditLogs`), ô lý do bắt buộc, gọi API có sẵn.

---

## 6. Phân quyền

Thêm `ktv_office_scoring` vào [lib/types.ts](lib/types.ts:1) (`ModuleId`) và [lib/constants.ts](lib/constants.ts:5) (nhóm "Kỹ Thuật Viên").

| Vai trò | Xem bảng | Trừ điểm | Ngày cũ | Thu hồi | Mở khóa |
|---|---|---|---|---|---|
| Admin / Manager | ✅ | ✅ | ✅ | ✅ | ✅ |
| Lễ tân | ✅ | ✅ | ❌ (chỉ hôm nay + hôm qua) | ❌ | ❌ |
| KTV | Chỉ của mình | ❌ | — | ❌ | ❌ |

Lễ tân là người chứng kiến vi phạm nên phải trừ được ngay; thu hồi và mở khóa là quyết định quản lý.

---

## 7. Thi công

### Đợt 1 — Nhìn thấy dữ liệu *(giá trị cao nhất, độc lập)*

1. Migration 2 bảng + seed 18 tiêu chí
2. Thêm `ktv_office_scoring` vào ModuleId + constants + phân quyền
3. `GET /api/admin/ktv-office/summary` và `/staff/[id]`
4. Trang `/admin/ktv-office` — Màn A (danh sách, xếp hạng, thanh màu, quỹ phải đóng)
5. Màn C **tab "Giờ tích lũy"** — đọc `KTVServiceHoursLedger`, dịch mã phạt, số dư lũy kế

→ **Xong Đợt 1 là hết cảnh "bị trừ giờ mà không biết vì sao"** — đúng câu hỏi gốc.

### Đợt 2 — Chấm điểm

6. `GET /criteria` + `POST /deduct` (kèm upload ảnh, transaction, notification)
7. Màn B — bottom sheet 3 bước, live score, chống trừ trùng, ép ảnh nhóm III
8. Màn C tab "Điểm Office" — bảng cách tính + timeline

### Đợt 3 — Quản trị

9. Màn D mở khóa (nối API có sẵn)
10. `POST /revoke` + nút Thu hồi (chỉ Quản lý)
11. Ghi `SecurityAuditLogs` cho cả trừ điểm và thu hồi

### Đợt 4 — Hoàn thiện

12. **Khối điểm cho KTV** trên [/ktv/performance](app/ktv/performance/page.tsx) — điểm tháng, quỹ phải đóng, danh sách lỗi kèm ảnh. *Trừ điểm mà KTV không tra cứu được thì khiếu nại triền miên.*
13. **Cảnh báo mốc quỹ** — khi điểm rơi sát ngưỡng 98/96/90/85, bắn notification: *"Điểm tháng còn 96,2 — giảm thêm 0,3 điểm sẽ phải đóng thêm 50.000đ."*
14. **Trừ điểm hàng loạt** — chọn nhiều KTV, tích một lỗi chung, dùng chung bộ ảnh
15. **Gợi ý tự động** — `T1 Bật app đúng giờ` so `KTVAttendance.checkedAt` với `KTVTypeDDailyRegistration.expected_time`; `T4 Chuyên cần` đếm ngày OFF. Chỉ **gợi ý** (tích mờ + nhãn ⚡), người chấm xác nhận — không tự trừ để tránh oan
16. **Xuất Excel** cuối tháng cho kế toán

---

## 8. Rủi ro

- **Migration trên DB thật.** 2 bảng mới, không đụng bảng cũ → an toàn. Nhưng unique index có `WHERE revoked_at IS NULL` cần Postgres ≥ 9.0, Supabase OK.
- **`KTVServiceHoursLedger` chỉ được ghi, chưa từng được đọc ra UI.** Khi hiển thị có thể lộ dữ liệu rác từ các lần test trước — cần rà trước khi mở cho lễ tân xem.
- **Điểm Office bắt đầu từ tháng nào?** Quy chế áp dụng từ 01/09/2026. Dữ liệu trước đó không có → tháng 9 là tháng đầu tiên.
