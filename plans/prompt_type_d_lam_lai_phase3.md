# Prompt — Làm lại Phase 3

> Copy toàn bộ phần dưới gửi cho anti.

---

## Việc đầu tiên: COMMIT NGAY, trước khi gõ bất kỳ dòng code nào

**Toàn bộ Phase 3 đã mất.** Tôi kiểm tra lại và đếm được 0 lần xuất hiện `TYPE_D` trong tất cả các file bạn đã sửa:

```
lib/services/KtvWalletService.ts        0   (trước có helper + nhánh TYPE_D + 3 filter)
app/api/ktv/attendance/route.ts         0
app/api/turns/route.ts                  0
app/api/finance/adjustment/route.ts     0
app/api/ktv/wallet/withdraw/route.ts    0
app/api/finance/ktv-summary/route.ts    0
```

`git log` vẫn dừng ở `676c799 commit truoc khi vao phase 3` — Phase 3 chưa từng được commit. Dấu vết cho thấy có lệnh `git checkout .` hoặc `git restore .` chạy qua: mọi sửa đổi trên **file tracked** bị xoá, **file untracked** thì còn (nên `app/api/ktv/type-d/` và `app/api/cron/reset-type-d-hours/` sống sót).

Phase 2 sống sót vì đã commit ở `c9d72f2`. Phase 3 chết vì chưa.

**Quy tắc từ giờ, không ngoại lệ:**
1. Ngay bây giờ: `git add -A && git commit` mọi thứ đang treo.
2. Sau **mỗi** bước có kết quả chạy được: commit tiếp.
3. Không bao giờ chạy `git checkout .` / `git restore .` / `git reset --hard` khi còn việc chưa commit. Cần bỏ thay đổi của một file thì nêu tên file cụ thể.

---

## L1 — Sửa lại cho đúng: helper đã viết nhưng KHÔNG DÙNG

Ở lượt trước bạn **đã tạo** `applySnapshotFilter` trong `KtvWalletService.ts` với logic đúng. Nhưng tôi đếm số lần nó được **gọi**: **0**. Sáu dòng `.eq('work_type_snapshot', workType)` vẫn nguyên như cũ. Helper là code chết, lỗi vẫn còn nguyên.

Khi làm lại, nhớ đủ hai vế:

```ts
// TYPE_D: chỉ lấy đúng snapshot.
// A/B/C: phải lấy CẢ bản ghi cũ có snapshot = NULL (9.691 dòng hiện có đều NULL).
static applySnapshotFilter(query: any, workType: string) {
    if (workType === 'TYPE_D') return query.eq('work_type_snapshot', 'TYPE_D');
    return query.or(`work_type_snapshot.eq.${workType},work_type_snapshot.is.null`);
}
```

Và **gọi nó ở cả 6 chỗ**:
```
app/api/ktv/wallet/bonus/balance/route.ts : 3 truy vấn
app/api/ktv/wallet/timeline/route.ts      : 3 truy vấn
```

Nhắc lại vì sao quan trọng: 100% dữ liệu hiện có đều `work_type_snapshot = NULL` (KTVDailyLedger 8.907, WalletAdjustments 503, KTVWithdrawals 193, KTVBonusLedger 88). `cột = 'TYPE_A'` không khớp NULL, nên nếu thiếu vế `is.null` thì ví bonus của mọi KTV A/B/C về 0. Tôi đã đo: NH025 từ 4.112 → 0, NH027 từ 1.673 → 0.

Kiểm tra bằng lệnh này trước khi báo xong — kết quả phải bằng số chỗ gọi, không phải 0:
```bash
grep -rn "applySnapshotFilter" app lib --include=*.ts | grep -v "static applySnapshotFilter" | wc -l
```

---

## L3 — Users cho tài khoản test: đã làm nhưng chưa dùng được

11 bản ghi `Users` đã tạo. Nhưng:

```
T001..T079 | auth_user_id = KHÔNG có (cả 11)  | password = chuỗi thường, 6 ký tự
KTV thật   | auth_user_id = 13/14 CÓ
```

Ba vấn đề:

1. **Thiếu `auth_user_id`.** Mọi KTV thật đều có. Không có thì nhiều khả năng không đăng nhập được qua Supabase Auth — tức mục đích ban đầu (test luồng điểm danh, test app KTV) vẫn chưa đạt. Kiểm tra luồng đăng nhập thực tế để xác định có bắt buộc không, rồi báo lại.

2. **Mật khẩu để thẳng trong file `insert_test_users.js`** dạng chuỗi thường, và file này sẽ được commit vào repo. Không đưa mật khẩu vào mã nguồn — đọc từ biến môi trường, hoặc để chủ dự án đặt riêng. Cũng cần xác nhận cột `password` của hệ thống lưu dạng băm hay chuỗi thường; hiện 11 bản ghi test đang khác định dạng với các tài khoản thật.

3. Lượt trước tôi ghi rõ *"mật khẩu và cách tạo `auth_user_id` thì hỏi chủ dự án trước, đừng tự đặt"*. Bước hỏi này bị bỏ qua. Lần này hỏi trước khi làm.

Phụ: `gender: 'Female'` đang hardcode cho cả 11 tài khoản — nên lấy theo dữ liệu gốc trong `Staff`.

Nhớ cập nhật `scripts/cleanup_type_d_test_accounts.js` để xoá luôn 11 bản ghi `Users` này.

---

## Hai thứ cần giải thích

**1. Migration ngoài phạm vi.** Xuất hiện file mới chưa commit:
```
supabase/migrations/20260901010000_add_commission_breakdown_to_ledger.sql
→ ALTER TABLE "KTVDailyLedger" ADD COLUMN "commission_breakdown" JSONB
```
Comment nhắc "sự cố NH027 29/08/2026". Việc này không nằm trong phạm vi Phase 3 và không có trong plan. Giải thích vì sao thêm, rồi chờ chủ dự án duyệt trước khi apply — thêm cột vào bảng sổ cái là thay đổi có ảnh hưởng rộng.

**2. Script xoá dữ liệu ở thư mục gốc.** Có `delete_phibaotri.mjs`, `delete_phibaotri2.mjs`, `delete_phibaotri3.mjs`, `delete_final.mjs`, `refund_phibaotri.mjs` nằm ở gốc repo. Cho biết chúng đã chạy trên DB production chưa, đã thay đổi/xoá những gì. Nếu đã chạy thì báo rõ phạm vi ảnh hưởng. Script dùng một lần thì đừng để ở gốc repo — chuyển vào `scripts/` hoặc xoá sau khi xong.

---

## Phạm vi Phase 3 (làm lại)

Đúng như lần trước — §6 của plan. Không làm Phase 4, không làm UI.

Năm điều dễ sai, nhắc lại:
1. Logic ví ở `KtvWalletService.ts`, không phải ở route (route chỉ 31 dòng).
2. `getBalance()` tính lai — phải phủ **cả** đường ledger lẫn đường tính lại từ `Bookings`.
3. Stamp `work_type_snapshot` ở mọi nơi tạo bút toán.
4. Rate lấy key `ktv_type_d_*_rate_per_60m`, nhớ chia 60.
5. Đường đi của A/B/C phải giữ nguyên.

---

## Nghiệm thu

1. Lệnh đếm số chỗ gọi `applySnapshotFilter` phải ra đúng số chỗ dùng, không phải 0.
2. Bảng đối chiếu A/B/C trước/sau trên **cả 4 endpoint ví** (`balance`, `bonus/balance`, `timeline`, `bonus/timeline`), ít nhất 3 KTV có số dư khác 0 — gợi ý NH025, NH027, NH021. Số phải giống hệt.
3. Đối chiếu số tiền TYPE_D: route ↔ script mô phỏng, phải khớp.
4. `npm run test:type-d` xanh, `tsc --noEmit` sạch.
5. **Commit** trước khi báo cáo.

Gặp chỗ nào không khớp plan thì dừng hỏi, đừng tự quyết.
