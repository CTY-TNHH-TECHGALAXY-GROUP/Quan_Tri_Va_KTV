# Plan: Đưa toàn bộ chế tài kỷ luật Loại D ra trang Cài đặt

> Mức 2 (kỷ luật, khoá tài khoản, trừ giờ tích luỹ). Chờ duyệt trước khi làm.
> Nối tiếp `plan_dua_cron_phat_len_main.md` — cron đã lên main ngày 12/09.

## Vấn đề

Mức phạt (bao nhiêu giờ) đã cấu hình được ở `admin/settings/system`. Nhưng **chế tài** —
khoá tài khoản hay chỉ trừ giờ — thì **viết cứng trong cron**. Muốn đổi phải sửa code và deploy.

Hệ quả thấy ngay: code đang khoá tài khoản ở hai trường hợp mà quy chế Phase 5.5 chỉ ghi −10 giờ.
Không ai phát hiện được vì phải đọc code mới biết.

## Quy chế gốc (`plan_type_d_bao_vang_bao_tre.md` mục 13–14) so với code trên main

| Trường hợp | Quy chế | Code | |
|---|---|---|---|
| Không đăng ký gì + không đi làm | Khoá | Khoá | ✅ |
| Báo vắng trước 07:00, không đến | −5h | −5h | ✅ |
| Không báo gì, không đến | −10h | **Khoá** | ❌ |
| Báo trễ rồi vẫn không đến | −10h | **Khoá** | ❌ |
| Giờ chốt sổ | **23:59 cùng ngày** | 07:00 hôm sau | ❌ |

Ghi chú trong code nói "theo quy chế mới chốt 2026-09-03" nhưng không có văn bản nào ghi lại
quyết định đó. Đưa ra cài đặt thì tranh cãi này biến mất: ai cũng mở trang ra xem được.

> ⚠️ **Đính chính:** lý do "chốt 06:30 là chốt trước hạn đổi lịch 07:00" ghi trong commit
> `376c1a95` là **SAI**. Mốc 07:00 là 07:00 của chính ngày làm, còn cron chốt ngày đó chạy
> sáng hôm sau — cách nhau 24 tiếng. 06:30 hay 07:00 đều không khoá oan ai.

## Thiết kế

### 1. Ô cấu hình — mở rộng `ktv_type_d_discipline_rules`

Thêm, mỗi trường hợp một cặp `action` + `hours`:

```json
{
  "ABSENT_EARLY_NOTICE": 5,
  "LATE_NO_UPDATE": 5,
  "ORDER_REJECT_MULTIPLIER": 3,
  "MIN_HOURS_TO_REJECT": 3,

  "CASES": {
    "UNREGISTERED_NEXT_DAY":  { "action": "LOCK",           "hours": 0  },
    "NO_REGISTRATION":        { "action": "DEDUCT_OR_LOCK", "hours": 10 },
    "NO_SHOW_NO_NOTICE":      { "action": "DEDUCT_OR_LOCK", "hours": 10 },
    "LATE_REPORTED_NO_SHOW":  { "action": "DEDUCT_OR_LOCK", "hours": 10 },
    "ABSENT_REPORTED_NO_SHOW":{ "action": "DEDUCT",         "hours": 5  }
  }
}
```

**Ba chế tài:**

| `action` | Nghĩa |
|---|---|
| `DEDUCT` | Chỉ trừ giờ, không bao giờ khoá |
| `LOCK` | Khoá thẳng, không trừ giờ |
| `DEDUCT_OR_LOCK` | Quỹ giờ **đủ** để trừ → trừ. **Không đủ** → khoá, và KHÔNG trừ |

**"Không đủ"** = quỹ giờ tích luỹ tháng tại thời điểm xử **nhỏ hơn** số giờ phạt (chốt 12/09).
Ví dụ phạt 10h: còn 30h → trừ còn 20h; còn 6h → khoá, quỹ giữ nguyên 6h.

Quỹ giờ lấy từ `KtvTypeDTurnService.getMonthlyNetHours` — cùng nguồn với ô "Thời gian" trên
dashboard KTV, với thứ tự nhận tua và với cửa chặn từ chối tua. KTV nhìn số nào thì bị xử theo
đúng số đó.

**Tương thích ngược:** thiếu `CASES` thì lùi về mặc định trong `staff.constants.ts` (đúng quy chế:
−10h, `DEDUCT_OR_LOCK`). Các khoá cũ giữ nguyên tên, dữ liệu đang có không hỏng.

### 2. Giao diện — khối "Kỷ luật trễ giờ tích lũy" của `KtvTypeDSettingsBlock`

Thay 4 ô số rời bằng một bảng, mỗi trường hợp một dòng:

| Trường hợp | Chế tài | Số giờ |
|---|---|---|
| Chưa đăng ký lịch cho ngày mới (chốt lúc 00:00) | `[Khoá tài khoản ▾]` | — |
| Không đăng ký gì và không đi làm | `[Trừ giờ, không đủ thì khoá ▾]` | `[10]` |
| Đăng ký làm, không báo, không đến | `[Trừ giờ, không đủ thì khoá ▾]` | `[10]` |
| Báo trễ rồi vẫn không đến | `[Trừ giờ, không đủ thì khoá ▾]` | `[10]` |
| Báo vắng trước 07:00, không đến | `[Chỉ trừ giờ ▾]` | `[5]` |
| Đi trễ không cập nhật | `[Chỉ trừ giờ ▾]` | `[5]` |
| Từ chối tua đã gán | `[Chỉ trừ giờ ▾]` | `[3]` × thời lượng |

Dưới bảng, một ô riêng:
- **Hạn mức giờ tối thiểu mới được từ chối tua:** `[3]` giờ

Kèm một dòng nhắc: *"Giờ chạy của cron nằm trong `vercel.json`, đổi phải deploy lại."*

### 3. Sửa cron cho khớp

- Bỏ hẳn lượt 07:00 — quy chế chốt sổ lúc 23:59, tức là cùng lượt nửa đêm. Một mốc giờ duy nhất.
- Mọi nhánh xử phạt đọc `CASES` thay vì viết cứng.
- `vercel.json`: xoá dòng `"/api/cron/daily-absence-check"` lịch `0 0 * * *`; giữ lượt `0 17 * * *`.

## Việc cần làm

1. `lib/constants/staff.constants.ts` — thêm `TYPE_D_DISCIPLINE_CASES` (mặc định theo quy chế).
2. `lib/services/KtvTypeDDisciplineService.ts` — thêm:
   - `getCasePolicy(supabase, caseKey)` → `{ action, hours }`
   - `applyCasePenalty(supabase, staffId, workDate, caseKey, note)` → tự quyết trừ giờ hay khoá,
     trả về `{ locked, hoursDeducted }`. Mọi nơi khoá/trừ đều đi qua đây, không ai tự xử nữa.
3. `app/api/cron/daily-absence-check/route.ts` — gộp hết vào lượt 00:00, gọi `applyCasePenalty`.
4. `app/admin/settings/system/KtvTypeDSettingsBlock.tsx` — bảng cấu hình.
5. `vercel.json` — bỏ lượt 07:00.
6. `plans/plan_type_d_bao_vang_bao_tre.md` — ghi lại quyết định mới vào mục 13.

## Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | App KTV: bị khoá / bị trừ giờ theo cấu hình mới. Màn từ chối tua đọc cùng hạn mức | `admin/settings/system` thêm bảng; `admin/ktv-office` xem phiếu phạt, mở khoá | `KtvTypeDDisciplineService`, `SystemConfigs.ktv_type_d_discipline_rules` | Sửa cả 2 phía |
| Số liệu (giờ tích luỹ) | Quỹ giờ đọc `KtvTypeDTurnService.getMonthlyNetHours` | Office đọc cùng nguồn | Cùng một hàm | Khớp |
| Realtime / refresh | Không đổi | Không đổi | — | Không ảnh hưởng |
| Quyền xem | KTV chỉ nhận thông báo của mình | Chỉ admin vào được trang cài đặt | | Không lộ dữ liệu |

## Kiểm tra

1. `tsc --noEmit`.
2. Mô phỏng (mục 10): dựng KTV có quỹ giờ 20h / 8h / 2h, chạy qua cả 5 trường hợp × 3 chế tài,
   in ra bảng "ai bị trừ bao nhiêu, ai bị khoá" và đối chiếu với cấu hình.
3. Chạy `?dry=1` trên production trước khi đổi cấu hình thật.
4. Đổi một dòng trong cài đặt → chạy lại `?dry=1` → kết quả phải đổi theo, không cần deploy.

## Commit gợi ý

`feat(ky-luat): che tai loai D chinh duoc o trang Cai dat, khong con cung trong code`


---

## ✅ Đã làm xong 12/09/2026

Quyết định của Chủ Dự Án, thay cho mục 13.1 và một phần mục 14.3 của
`plan_type_d_bao_vang_bao_tre.md` (văn bản đó nằm trên nhánh `feat/bit-lo-hong-phase1`):

> Mọi lỗi vắng mặt đều **quy ra giờ**. Khoá tài khoản chỉ là chế tài cuối khi **quỹ giờ không
> gánh nổi** mức phạt. "Không đủ" = giờ tích luỹ THÁNG **nhỏ hơn** mức phạt; khi đó khoá và
> **KHÔNG trừ** — trừ để quỹ âm rồi vẫn khoá là phạt hai lần.

| Tình huống | Mặc định |
|---|---|
| Chưa đăng ký lịch cho ngày vừa sang | Khoá tài khoản |
| Hôm qua không đăng ký gì và không đi làm | −10h; quỹ < 10h → khoá |
| Đăng ký làm, không báo, không đến | −10h; quỹ < 10h → khoá |
| Báo trễ rồi vẫn không đến | −10h; quỹ < 10h → khoá |
| Báo vắng trước 07:00, không đến | −5h (không bao giờ khoá) |

Đây chỉ là **mặc định** (`TYPE_D_DISCIPLINE_CASES` trong `lib/constants/staff.constants.ts`),
dùng khi cấu hình trống hoặc hỏng. Quản lý chỉnh ở Cài đặt → Loại D, có hiệu lực ngay.

**Kiểm chứng:** `scripts/simulate_type_d_discipline_cases.ts` — gọi thẳng `applyCasePenalty`
với Supabase giả, 4 mức quỹ giờ × 5 tình huống, 5 cách cấu hình, 3 kiểu cấu hình rác. Tất cả đạt.

**🐞 Lỗi phát hiện khi làm:** `deductDailyViolation` lấy số giờ từ HẰNG SỐ, không đọc cấu hình.
Ba ô "Giờ" trên trang Cài đặt chỉ để trang trí — sửa 10 thành 8 thì hệ thống vẫn trừ 10. Đã sửa.


---

## Sửa tiếp 12/09 (tối) — bỏ luật "nhìn tới trước"

Chủ Dự Án chỉ ra: nếu cron khoá người chưa đăng ký cho NGÀY MỚI, thì sau một đêm, mọi người
còn dùng được app đều đã có đăng ký cho ngày đó — nên luật "hôm qua không đăng ký gì" **không
bao giờ chạy tới**. Code chết.

Và luật nuốt mất luật kia lại chính là luật **không có trong quy chế**.

**Xử lý:** thêm chế tài thứ tư `NONE` (Bỏ qua — không xử lý), và đặt
`UNREGISTERED_NEXT_DAY` mặc định `NONE`. Quy chế chỉ xét ngày ĐÃ QUA. Muốn buộc KTV đăng ký
trước thì bật lại ở Cài đặt.

**Thêm công tắc tổng vào trang Cài đặt.** Trên main khối "Kỷ luật trễ giờ tích lũy" hoàn toàn
không có công tắc — `ktv_type_d_discipline_enabled` chỉ sửa được bằng tay trong DB.

**Dự đoán đêm 12/09 với luật mới** (chạy trên dữ liệu thật, chỉ đọc): 12 KTV bị khoá vì hôm nay
không đăng ký gì và cũng không đến làm, quỹ giờ 0h < 10h nên khoá thay vì trừ. T007 thoát vì có
đi làm thật. Cùng con số với luật cũ nhưng **đúng lý do**.
