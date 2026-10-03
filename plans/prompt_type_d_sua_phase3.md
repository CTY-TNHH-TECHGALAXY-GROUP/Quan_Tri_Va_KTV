# Prompt sửa Phase 3 — lỗi chặn deploy

> Copy toàn bộ phần dưới gửi cho anti.

---

Đã kiểm tra Phase 3. Phần khung làm tốt: routes mới đủ, `KtvWalletService` có nhánh TYPE_D, helper `getWorkTypeSnapshot()` đã có, `work_type_snapshot` được stamp ở `adjustment` và `attendance`, `vercel.json` đã cập nhật.

**Nhưng có một lỗi sẽ xoá sạch ví bonus của toàn bộ KTV hiện hữu nếu deploy.** Dừng mọi việc khác, sửa cái này trước.

---

## L1 — Lọc `work_type_snapshot` bỏ sót NULL ⛔ CHẶN DEPLOY

### Hiện trạng

6 dòng dùng `.eq('work_type_snapshot', workType)` áp cho **mọi** loại KTV:

```
app/api/ktv/wallet/bonus/balance/route.ts : dòng 49, 60, 71
app/api/ktv/wallet/timeline/route.ts      : dòng 61, 265, 291
```

### Vì sao hỏng

Toàn bộ dữ liệu đang có đều `NULL` — tôi đếm trên production:

```
KTVDailyLedger      tổng 8.907   NULL 8.907   có giá trị 0
WalletAdjustments   tổng   503   NULL   503   có giá trị 0
KTVWithdrawals      tổng   193   NULL   193   có giá trị 0
KTVBonusLedger      tổng    88   NULL    88   có giá trị 0
```

Trong SQL, `cột = 'TYPE_A'` **không bao giờ khớp NULL**. Với KTV loại A/B/C, mấy truy vấn trên trả về rỗng.

Tác động thật, tôi đo bằng SQL trên dữ liệu hiện có:

```
mã    | loại   | trước khi sửa | sau khi sửa
NH025 | TYPE_A |         4.112 |           0
NH027 | TYPE_B |         1.673 |           0
NH021 | TYPE_A |         1.670 |           0
NH011 | TYPE_A |         1.529 |           0
NH002 | TYPE_A |         1.205 |           0
NH001 | TYPE_A |         1.025 |           0
```

### Luật đúng

Plan §2.2 đã ghi từ đầu:

| Loại | Filter |
|---|---|
| TYPE_D | `work_type_snapshot = 'TYPE_D'` |
| A/B/C | `work_type_snapshot = '<loại>' **OR** work_type_snapshot IS NULL` |

Bạn mới làm vế `=`, thiếu vế `IS NULL`. Vế đó chính là phần bảo đảm tương thích ngược cho 9.691 bản ghi cũ.

### Yêu cầu

1. Viết **một helper dùng chung** để áp filter, đừng sửa tay 6 chỗ rồi lần sau lại quên:
   ```ts
   // TYPE_D: chỉ lấy đúng snapshot. Các loại khác: lấy cả bản ghi cũ (NULL).
   function applySnapshotFilter(query: any, workType: string) {
       if (workType === 'TYPE_D') return query.eq('work_type_snapshot', 'TYPE_D');
       return query.or(`work_type_snapshot.eq.${workType},work_type_snapshot.is.null`);
   }
   ```
2. Dùng helper này ở **cả 6 chỗ**.
3. Rà thêm `app/api/ktv/wallet/bonus/timeline/route.ts` — file này đã sửa nhưng tôi không thấy filter snapshot nào. Xác định xem có cần không: nếu không lọc thì KTV TYPE_D sẽ thấy lẫn dữ liệu của chế độ cũ.
4. Rà `finance/ktv-summary` và mọi chỗ khác đọc 4 bảng ledger — cùng một lỗi có thể nằm ở đó.

Phần trong `lib/services/KtvWalletService.ts` (dòng 227, 348, 356) **giữ nguyên**, không đụng: chúng hardcode `'TYPE_D'` và nằm trong nhánh `if (workType === 'TYPE_D')` nên đúng rồi.

---

## L2 — Script kiểm hồi quy chưa đủ độ phủ

Nghiệm thu số 2 của Phase 3 là "gọi cho KTV TYPE_A và TYPE_B, trước và sau khi sửa, số phải giống hệt". Bạn có tạo `verify_abc_balance.ts` nhưng lỗi L1 vẫn lọt — nhiều khả năng script chỉ kiểm `wallet/balance`, không kiểm `wallet/bonus/balance` và `wallet/timeline` (đúng 2 chỗ chứa lỗi).

**Yêu cầu:** mở rộng script kiểm **tất cả** endpoint ví cho A/B/C:
- `wallet/balance`
- `wallet/bonus/balance`
- `wallet/timeline`
- `wallet/bonus/timeline`

Chạy trên ít nhất 3 KTV thật có số dư khác 0 — gợi ý NH025 (bonus 4.112), NH027 (TYPE_B, 1.673), NH021 (1.670). So với giá trị trước khi sửa, phải **giống hệt**.

Dán bảng đối chiếu vào báo cáo.

---

## L3 — Tài khoản test chưa có trong bảng `Users`

11 tài khoản test đã có trong `Staff` nhưng **không có trong `Users`**:

```
Staff  có 11 dòng id LIKE 'T%'
Users  có  0 dòng
```

Bảng `Users` hiện có 16 dòng: 14 KTV mã NH (đủ 14/14 KTV thật, đều có `auth_user_id`), 1 admin, 1 dev.

Hệ quả: T001–T079 **không đăng nhập được**, nên không test được luồng điểm danh `POST /api/ktv/attendance` vừa sửa ở Phase 3, và Phase 7 (app KTV) sẽ không test được gì.

Đây là thiếu sót từ Phase 0 — plan §11.2 không nhắc tới bảng `Users`.

**Yêu cầu:** bổ sung vào `scripts/seed_type_d_test_accounts.js` phần tạo bản ghi `Users` cho 11 mã test, theo đúng khuôn của các mã NH hiện có (`username` = mã, `code` = mã, `role = 'TECHNICIAN'`, có `auth_user_id`). Tham khảo `scripts/create_dev_account.sql` và `scripts/migrate_auth.ts`.

Mật khẩu và cách tạo `auth_user_id` thì **hỏi chủ dự án trước**, đừng tự đặt.

Nhớ cập nhật `scripts/cleanup_type_d_test_accounts.js` để xoá luôn các bản ghi `Users` này khi dọn.

---

## Báo cáo cần có

1. Bảng đối chiếu A/B/C trước/sau trên **cả 4 endpoint ví**, ít nhất 3 KTV.
2. `npm run test:type-d` và `tsc --noEmit`.
3. Danh sách mọi chỗ đã áp helper `applySnapshotFilter`, và kết quả rà `finance/ktv-summary`.
4. Xác nhận đã dọn dữ liệu test nếu có ghi vào DB.

Sau đó **commit Phase 3** (hiện còn treo chưa commit). Chưa làm Phase 4 hay UI.

---

Một nhận xét để lần sau đỡ mất công: ba lỗi nặng nhất tới giờ — `segments` kiểu chuỗi, config `[object Object]`, và lần này là NULL snapshot — đều **không phải lỗi thuật toán**, mà là **giả định sai về hình dạng dữ liệu thật đang nằm trong DB**. Trước khi viết truy vấn lọc theo cột nào, hãy `SELECT` thử phân bố giá trị của cột đó trước. Một câu đếm 5 giây tiết kiệm được cả vòng sửa.
