# Plan: Đưa cron xử phạt Loại D (`daily-absence-check`) lên main

> Mức 2 (kỷ luật, khoá tài khoản, cron ghi DB). Chờ duyệt trước khi làm.
> Bối cảnh: production và preview dùng chung DB; Loại D có tài khoản test + NH079 (tài khoản anh Hiếu).
> Cập nhật 12/09 theo chỉ đạo: **KHÔNG tắt công tắc** — khoá thật thì mới biết cron chạy đúng.

## Hiện trạng (kiểm tra chỉ đọc 12/09)

- `origin/main` = `ef9c6592`. Route `daily-absence-check` **chưa có** trên main → chưa có cron phạt nào chạy.
- `vercel.json` trên main chưa có 2 lịch của cron này.
- Migration pg_cron `20260906000000_setup_pg_cron_daily_absence.sql` **chưa chạy** trên DB → lịch lấy từ `vercel.json`.
- `SystemConfigs.ktv_type_d_discipline_enabled = true` → deploy xong là **phạt / khoá thật**. Giữ nguyên, đúng ý anh Hiếu.
- Bản sửa `56877517` (tài khoản bị khoá vẫn đăng nhập lại được) **chỉ có trên nhánh**, main chưa có.

## Quyết định của anh Hiếu (12/09)

1. **Không tắt công tắc kỷ luật.** Khoá tài khoản thật là bằng chứng cron chạy đúng.
2. **Luật "hôm qua không đăng ký + không đi làm → khoá" gộp vào lượt 00:00.**
3. **Lượt 06:30 đổi thành 07:00.**

## Ba luật hiện tại

| Lượt | Giờ VN | Làm gì |
|---|---|---|
| `?mode=lock-unregistered` | 00:00 | Chưa đăng ký lịch (làm hoặc OFF) cho ngày vừa sang → **khoá tài khoản** |
| (mặc định) | 06:30 → **07:00** | Chốt ngày làm việc hôm trước: đăng ký làm mà không đến + không báo → **khoá**; đã báo vắng → **−5h**; đăng ký OFF hoặc có đi làm → không sao |

**Đổi lịch đi làm → OFF: đã có sẵn, không cần sửa.** Xử lý ngay lúc KTV bấm đổi
(`app/api/ktv/daily-registration/route.ts`), không đợi cron:

- Ngày làm còn ở tương lai → đổi thoải mái, **không phạt**.
- Đúng ngày làm, **trước 07:00** → vẫn đổi được nhưng **−5h** tích luỹ (`ABSENT_EARLY_NOTICE`). **Không khoá tài khoản.**
- Sau 07:00 → **không cho đổi nữa** (`getRegistrationEditWindow` trả `LOCKED`).

## 🐞 Vì sao phải đổi 06:30 → 07:00 (bug thật, không chỉ là đổi giờ)

`lib/vn-time.ts:76` cho KTV đổi lịch sang OFF **đến 07:00**. Cron lại chốt sổ lúc **06:30** —
chốt trước khi hết hạn đổi. KTV đổi lúc 06:45 là **đúng luật**, nhưng 06:30 cron đã ghi
"đăng ký làm mà không đến, không báo" và **khoá tài khoản**. Đưa cron về 07:00 thì hai mốc
khớp nhau: hết hạn đổi rồi mới chốt.

## Việc cần làm (nhánh mới từ `origin/main` ef9c659, worktree riêng)

1. Chép nguyên từ `feat/bit-lo-hong-phase1`:
   - `app/api/cron/daily-absence-check/route.ts` (mới)
   - `lib/services/KtvTypeDDisciplineService.ts` (thay bản cũ)
   - `lib/vn-time.ts` (mới)
2. **Sửa `runLockUnregistered()`**: sau khi xử ngày mới, xét thêm ngày làm việc liền trước —
   không có dòng đăng ký **và** không có check-in → khoá, cùng lý do `AUTO_LOCK_ABSENCE` như cũ.
   Bỏ nhánh tương ứng khỏi `run()` để một người không bị xử hai lần.
3. **`vercel.json`**: `0 17 * * *` (00:00 VN) giữ nguyên; `30 23 * * *` (06:30 VN) đổi thành
   `0 0 * * *` (**07:00 VN**).
4. `package.json` + `package-lock.json`: thêm `date-fns-tz@^3.2.0` (lock chỉ khác main đúng gói này).
5. Chép luôn `56877517` — chặn đăng nhập tài khoản bị khoá. Không có nó thì trên production
   khoá cũng như không: phiếu khoá có, thông báo có, nhưng KTV vẫn vào app làm việc bình thường.
6. Không cần chép thêm: `business-date`, `notification-helper`, `supabaseAdmin`,
   `TYPE_D_DISCIPLINE_PENALTIES` — giống hệt main.

## ⚠️ Rủi ro của việc gộp vào 00:00

Ngày làm việc của spa **đóng lúc 06:00**, không phải 00:00. Chốt "hôm qua" vào lúc 00:00 nghĩa là
ngày đó còn 6 tiếng nữa mới đóng. Ai điểm danh trong khoảng 00:00–06:00 cho ngày hôm trước sẽ bị
chấm vắng oan.

Thực tế rủi ro **rất nhỏ**: người không đăng ký gì thì cũng đã bị khoá ngay ở luật thứ nhất của
chính lượt 00:00 (chưa đăng ký cho ngày mới). Chỉ lọt đúng một trường hợp hiếm: đăng ký ngày mai
nhưng hôm qua không đăng ký, rồi đi làm sau 00:00. Ghi ra đây để sau này có ai thắc mắc thì biết
đường lần.

## Ảnh hưởng chéo

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| Màn hình / API | App KTV: bị khoá không đăng nhập được (sau khi chép `56877517`), nhận thông báo `ACCOUNT_LOCK` / `WARNING` | `admin/ktv-office` thấy phiếu khoá / trừ giờ, mở khoá được. Nhận `EMERGENCY` tổng hợp | `Staff.status`, `KTVDPenaltyLedger`, `KTVTypeDDailyRegistration`, `SecurityAuditLogs`, `StaffNotifications` | Sửa cả 2 phía |
| Số liệu (giờ tích luỹ) | Đọc `KTVDPenaltyLedger` qua `KtvDLedgerReader` | Đọc cùng nguồn | Mức phạt ở `ktv_type_d_discipline_rules` | Khớp |
| Tác dụng phụ trên main | `api/ktv/attendance` (Nghỉ đột xuất, chỉ TYPE_D) đổi từ `KTVServiceHoursLedger` sang `KTVDPenaltyLedger` + tôn trọng công tắc | — | `KtvTypeDDisciplineService` | Đúng với nhánh; chỉ đụng Loại D |
| Quyền xem | Thông báo khoá gửi đúng chính chủ | Bản tổng hợp gửi quản lý | | Không lộ dữ liệu |

## Đêm đầu tiên sẽ ra sao

Công tắc đang bật, nên **00:00 đêm ngay sau khi deploy sẽ khoá mọi KTV Loại D chưa đăng ký lịch cho
ngày hôm sau — gồm cả NH079**. Anh Hiếu đã biết và chấp nhận: khoá thật mới chứng minh được cron chạy.

Mở khoá: `admin/ktv-office` → mở khoá tài khoản. Hoặc gọi tay
`/api/cron/daily-absence-check?mode=lock-unregistered&dry=1` trước để xem trước danh sách.

## Kiểm tra

1. `tsc --noEmit` trong worktree.
2. Gọi route với `?dry=1` trên production **ngay sau khi deploy** → in danh sách sẽ khoá / trừ giờ,
   không ghi gì. Đối chiếu với thực tế đăng ký hôm đó.
3. Sáng hôm sau: Vercel → Cron Jobs xem log lượt 00:00 và 07:00; kiểm tra `KTVDPenaltyLedger`,
   `Staff.status`, và thông báo KTV nhận được.

## Commit gợi ý

`feat(cron): dua cron ky luat loai D len main, chot so doi sang 07:00`
