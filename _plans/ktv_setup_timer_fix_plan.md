# KTV Setup Timer Fix Plan

## Muc tieu
- Loai bo hoan toan fallback mac dinh `10` phut cho `ktv_setup_duration_minutes`.
- Uu tien tuyet doi gia tri tu DB.
- Neu settings chua load duoc hoac load fail, KTV duoc bam bat dau ngay, khong bi chan boi mot timer gia.

## Van de hien tai
- Frontend KTV Dashboard khoi tao `ktv_setup_duration_minutes` bang `10`.
- Booking/status co the ve som hon settings, lam UI set timer `10p` truoc.
- Khi settings that tu DB ve sau, man hinh da vao `TIMER`, nen gia tri `10p` co the bi giu luon.
- Backend va API settings van co nhieu diem fallback `10`, gay race condition va hanh vi khong nhat quan.

## Nguyen tac moi
- Chi gia tri doc duoc tu DB moi duoc quyen quyet dinh thoi gian setup.
- `null` / `undefined` / loi fetch settings = khong cho setup timer, cho phep bat dau ngay.
- Gia tri `0` tu DB = cho phep bat dau ngay.
- Gia tri thap nhu `0.1` tu DB phai duoc giu nguyen, khong ep thanh `10`.

## Pham vi sua
- `app/ktv/dashboard/KTVDashboard.logic.ts`
- `app/ktv/dashboard/page.tsx`
- `app/api/ktv/settings/route.ts`
- `app/api/ktv/booking/route.ts`

## Ke hoach sua
### 1. Chuan hoa state settings o frontend
- Doi state `settings.ktv_setup_duration_minutes` mac dinh tu `10` sang `null`.
- Them co `settingsLoaded` hoac suy ra tu `ktv_setup_duration_minutes !== null`.
- Khong cho UI dung gia tri gia trong giai doan cho settings.

### 2. Xoa tat ca fallback `|| 10`
- Rà soat va xoa moi cho dang dung fallback `10`.
- Cac diem da thay:
  - `app/ktv/dashboard/KTVDashboard.logic.ts`
  - `app/ktv/dashboard/page.tsx`
  - `app/api/ktv/booking/route.ts`
- Rule moi:
  - Neu gia tri la so hop le -> dung no.
  - Neu gia tri khong hop le -> coi nhu `0` cho muc dich setup gate.

### 3. Sua logic `allowedStartTime`
- Neu co `dispatchStartTime` do le tan nhap, uu tien moc nay nhu hien tai.
- Neu phai tinh tu `last_served_at + setup`:
  - Chi cong setup khi config da load thanh cong va la so hop le.
  - Neu config chua co -> `allowedStartTime = null`, `canStart = true`.

### 4. Sua logic `READY -> TIMER`
- Khi vao man `READY`, chi set `prepTimeRemaining` dua tren gia tri DB da load.
- Neu chua co config:
  - `prepTimeRemaining = 0`
  - khong hien timer `10p`
  - cho phep bat dau ngay

### 5. Sua API settings
- Bo `ktv_setup_duration_minutes: 10` khoi default settings trong `app/api/ktv/settings/route.ts`.
- Neu bang config rong hoac route fail:
  - field nay nen la `null` hoac vang mat
  - client phai hieu day la "khong co config", khong phai "10p"

### 6. Sua backend booking gate
- Trong `app/api/ktv/booking/route.ts`, bo fallback `10` khi doc `ktv_setup_duration_minutes`.
- Neu config khong doc duoc:
  - khong chan start
  - khong tinh `allowed` bang mot gia tri setup gia

### 7. Bao dam nhat quan UI sau khi settings ve muon
- Neu booking fetch ve truoc settings:
  - khong duoc tao timer `10p`
- Neu settings ve sau:
  - neu KTV chua bat dau -> ap dung gia tri moi
  - neu KTV da vao luong thuc thi -> khong duoc giu "ky uc 10p" tu state cu

## Test cases can pass
- DB tra `0.1` -> timer setup hien dung ~6 giay.
- DB tra `0` -> bam bat dau ngay.
- API settings cham hon booking fetch -> khong bao gio nhay `10p`.
- API settings fail -> van bam bat dau ngay.
- Refresh nhieu lan o man KTV -> khong co lan nao ve `10p`.
- Doi config DB tu `0.1` sang `5` -> lan load moi ap dung dung `5`.

## Definition of done
- Khong con bat ky fallback `10` nao cho `ktv_setup_duration_minutes`.
- KTV khong bao gio thay `10p` neu DB dang de `0.1`.
- Neu settings loi/cham, he thong uu tien cho KTV bat dau ngay.
- Frontend va backend dung cung mot quy tac "khong co config = khong cho".
