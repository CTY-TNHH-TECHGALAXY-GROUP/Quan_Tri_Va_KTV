# Prompt — Tách hẳn A/B/C khỏi đường đi của TYPE_D

> Copy toàn bộ phần dưới gửi cho anti.

---

Phase 3 đã được nghiệm thu, tôi kiểm chứng độc lập và đạt: `applySnapshotFilter` gọi 9 lần, `tsc --noEmit` sạch, `npm run test:type-d` xanh, và số dư A/B/C đúng (NH025 = 4.112, NH021 = 1.670).

Trước khi đi tiếp, làm một đợt chỉnh kiến trúc nhỏ. **Đây không phải sửa lỗi** — code hiện tại chạy đúng. Đây là gỡ bỏ khả năng lỗi tái diễn.

---

## Vấn đề

Truy vấn ví của KTV loại A/B/C hiện vẫn nhận `workType` làm đầu vào:

```ts
// app/api/ktv/wallet/bonus/balance/route.ts
const { data: earns } = await KtvWalletService.applySnapshotFilter(
    supabase.from('KTVDailyLedger').select('total_bonus').eq('staff_id', techCode),
    workType          // ← nút gạt này quyết định truy vấn ra sao
)
```

Nghĩa là hình dạng truy vấn của A/B/C phụ thuộc vào cách `applySnapshotFilter` được viết. Sự cố xoá ví vừa rồi đi đúng theo chuỗi này: KTV là TYPE_A → thêm điều kiện `work_type_snapshot = 'TYPE_A'` → dữ liệu cũ toàn NULL → không khớp → ví về 0.

Chừng nào tham số đó còn, thì mỗi lần sửa logic TYPE_D vẫn còn **đường dẫn** chạm tới tiền của 145 nhân viên cũ, dù vô ý.

---

## Quyết định của chủ dự án

**A/B/C không cần lọc `work_type_snapshot` gì cả.** Chỉ TYPE_D mới lọc.

Lý do đã được xác nhận: sổ `KTVDailyLedger` ghi cả hai chiều (tiền kiếm được và tiền đã rút), và quy trình vận hành là **chốt sổ cho rút hết trước khi chuyển chế độ** (sổ tháng 8 đã làm vậy). Nên một giai đoạn cũ luôn về 0 — lấy vào hay bỏ ra đều cùng kết quả. Không cần vế `OR ... IS NULL` cho A/B/C nữa.

---

## Việc cần làm

### 1. Sửa helper — thay đúng một dòng

`lib/services/KtvWalletService.ts` dòng 8–11, hiện tại:

```ts
static applySnapshotFilter(query: any, workType: string) {
    if (workType === 'TYPE_D') return query.eq('work_type_snapshot', 'TYPE_D');
    return query.or(`work_type_snapshot.eq.${workType},work_type_snapshot.is.null`);
}
```

Đổi thành:

```ts
// Chỉ TYPE_D mới lọc theo snapshot.
// A/B/C: trả nguyên truy vấn gốc, KHÔNG thêm điều kiện nào.
static applySnapshotFilter(query: any, workType: string) {
    if (workType === 'TYPE_D') return query.eq('work_type_snapshot', 'TYPE_D');
    return query;
}
```

Một dòng này làm cả 9 chỗ gọi trở nên an toàn cho A/B/C ngay lập tức, vì truy vấn của họ quay về đúng hình dạng gốc trước Phase 3.

### 2. Tách `getTypeDBalance` ra file riêng

`KtvWalletService.ts` đang dài 401 dòng, trong đó:

```
dòng  18–198  getBalance()      ← A/B/C  (181 dòng)
dòng 200–383  getTypeDBalance() ← TYPE_D (184 dòng)
```

Gần một nửa file là code TYPE_D nằm chung nhà với code tính tiền của 145 người.

Chuyển khối 200–383 sang file mới `lib/services/KtvTypeDWalletService.ts`. `getBalance()` giữ lại đúng phần điều phối:

```ts
if (workType === 'TYPE_D') {
    return await KtvTypeDWalletService.getBalance(supabase, staffId);
}
// A/B/C chạy tiếp, không đổi gì
```

Chỉ có 2 nơi gọi `getBalance` (`wallet/balance/route.ts:20` và `wallet/withdraw/route.ts:45`) nên không cần sửa route.

Sau bước này, bộ TYPE_D thành một cụm hoàn chỉnh:
```
KtvTypeDWalletService.ts      ← mới
KtvTypeDCommissionService.ts
KtvTypeDBonusService.ts
KtvTypeDDisciplineService.ts
KtvTypeDTurnService.ts
```

### 3. Không làm gì thêm

Đừng nhân tiện sửa logic tính toán, đừng đổi tên biến, đừng dọn code. Đợt này chỉ **di chuyển** và **đổi một dòng helper**. Càng ít thay đổi càng dễ chứng minh không hỏng gì.

---

## Nghiệm thu

Đây là số liệu tôi đo **trước khi sửa**, lấy trực tiếp từ `KTVDailyLedger` (từ 2026-05-04):

```
  mã      bonus    tiền tua      số dòng
  NH001    1025    16.880.000      120
  NH011    1559    22.815.000      120
  NH021    1670    23.690.000      120
  NH025    4112    38.825.000      120
  NH027    1683    24.435.000      120
```

Sau khi sửa, chạy lại `verify_abc_balance.ts` (mở rộng cho đủ 5 mã trên và cả 4 endpoint ví: `balance`, `bonus/balance`, `timeline`, `bonus/timeline`). Kết quả phải **giống hệt** bảng trên.

Ngoài ra:
- `npm run test:type-d` xanh
- `tsc --noEmit` sạch
- Số dư của một KTV TYPE_D (dùng T001) trước/sau phải không đổi

**Commit ngay sau khi nghiệm thu xong.** Hiện đang có 10 file treo chưa commit — commit luôn cả số đó trước khi bắt đầu.

---

## Sau đợt này

**Bỏ qua Phase 4.** Đã kiểm tra: mức phí global đang dùng cho A/B/C là giặt đồ 20.000 / bảo trì 50.000, đúng bằng mức plan muốn cho TYPE_D. Sửa code dùng chung để ra đúng con số đang có là rủi ro không đổi lấy gì. Chỉ làm khi nào doanh nghiệp thực sự muốn TYPE_D đóng phí khác.

Tiếp theo là **Phase 5 — Admin UI tab D**, phase này gần như chỉ thêm màn hình mới nên ít đụng A/B/C. Chờ tôi duyệt xong đợt tách này rồi hãy bắt đầu.
