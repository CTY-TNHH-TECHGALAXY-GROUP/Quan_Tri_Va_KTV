# Dispatch Stabilization Plan

## Muc tieu
Tai cau truc va khoa bug cho cum dieu don de he thong on dinh voi cac truong hop multi-service, multi-KTV, add-on, cancel, remove service, rating, va sync tua.

## Pham vi
- `app/reception/dispatch/actions.ts`
- `app/reception/dispatch/_components/KanbanBoard.tsx`
- `app/reception/dispatch/page.tsx`
- `lib/turn-sync.ts`
- RPC/DB flow lien quan `Bookings`, `BookingItems`, `TurnQueue`, `TurnLedger`

## Yeu cau nghiep vu
- Mot booking co the co nhieu `BookingItems`, nhieu KTV, nhieu segment, nhung trang thai cuoi phai nhat quan giua `Bookings`, `BookingItems`, `TurnQueue`, `TurnLedger`.
- `TurnQueue` phai ho tro multi-item that su; khong duoc nua dung scalar `booking_item_id`, nua dung array `booking_item_ids`.
- Moi thao tac quan trong cua dieu don phai idempotent va uu tien atomic: dieu don, start/completed tung item, add-on, cancel, remove service, edit service, release KTV.
- `Bookings.status` phai duoc suy ra tu item status; item status phai duoc suy ra tu segment/work state.
- Flow rating/review phai dung `bookingId` that hoac token that, khong dung ID tong hop.
- Huy don, xoa dich vu, phat sinh dich vu phai dong bo lai luot tua va trang thai KTV ngay.
- Realtime/refetch khong duoc lam mat form dang sua hoac keo trang thai lui sai.
- Mọi route dieu don phai co server-side authz; khong tin `techCode`, `employeeId`, `bookingId` tu client neu co the derive tu session hoac validate ownership.

## Lo hong mo hien tai
### P0
- `app/api/bookings/route.ts`: API bookings dang public, tra raw data va leak debug env.
- `app/api/notifications/push/route.ts`: hardcoded VAPID private key.

### P1
- `app/reception/dispatch/actions.ts:624`: partial item transition dang filter `TurnQueue` bang `booking_item_id` scalar, vo sau add-on/multi-item.
- `app/reception/dispatch/actions.ts:1043`: remove 1 item co the clear ca row `TurnQueue`, tha nham KTV dang con item khac.
- `app/reception/dispatch/_components/KanbanBoard.tsx:486`: rating/link dung synthetic sub-order ID.

### P2
- `lib/turn-sync.ts:25`: sync tua chi upsert nguoi con ledger, khong reset ve `0` cho nguoi da bi xoa ledger.

## Ke hoach dieu chinh
### Pha 1: Va bug chan van hanh
Muc tieu: khoa nhung diem dang gay sai trang thai hoac ket queue ngay lap tuc.

1. Chuan hoa truy xuat `TurnQueue` cho partial item transition.
   Can sua `updateBookingItemStatus()` de truy theo `booking_item_ids` da chuan hoa, khong dua vao `booking_item_id` scalar comma-string.
2. Sua `removeBookingItem()` de chi bo item bi xoa khoi `booking_item_ids`, khong clear toan bo row neu KTV van con item khac.
3. Sua `KanbanBoard` va `submitCustomerRating()` de dung `bookingId`/`accessToken` that.
4. Sua `syncTurnsForDate()` de co the reset `turns_completed` ve `0` cho employee da mat ledger trong ngay.
5. Test lai toan bo nhom P0/P1 trong `dispatch_test_matrix.md`.

### Pha 2: Chot data invariant cho dispatch
Muc tieu: dat mot mo hinh du lieu nhat quan, giam branch logic chong cheo.

1. Chot mo hinh: 1 row `TurnQueue` = 1 KTV dang phuc vu 1 booking tai 1 thoi diem.
2. `TurnQueue.booking_item_ids` tro thanh truong chinh thuc; `booking_item_id` scalar chi con de compatibility tam thoi, sau do loai bo.
3. Chot rule status:
   - Booking status = tong hop tu item status.
   - Item status = tong hop tu segment/work state.
   - KTV queue status = `waiting` / `assigned` / `working` / `off` theo item active that.
4. Chot chinh sach cancel:
   - Huy truoc khi bat dau: tra tua.
   - Huy khi dang lam: giu/mat tua theo policy da ky ten.
5. Chot chinh sach multi-KTV:
   - Start lech gio.
   - End lech gio.
   - Release tung nguoi hay release theo item.

### Pha 3: Dua cac flow nhieu buoc vao RPC/transaction
Muc tieu: tranh cap nhat do dang giua `Bookings`, `BookingItems`, `TurnQueue`, `TurnLedger`.

Uu tien gom thanh RPC rieng cho:
1. `dispatch_confirm`
2. `start_item_or_booking`
3. `complete_item_or_booking`
4. `cancel_booking`
5. `mutate_booking_item` cho add/remove/edit service
6. `submit_customer_rating`
7. `release_ktv_after_review`

Yeu cau:
- Moi RPC phai idempotent.
- Moi RPC phai return ket qua co cau truc de UI xu ly retry an toan.
- Neu co side effect phu nhu push notification, tach khoi giao dich chinh.

### Pha 4: Test matrix va UAT
Muc tieu: bien dispatch test matrix thanh cong cu xac nhan release.

1. Chay P0 cases cua `dispatch_test_matrix.md` truoc moi release dispatch.
2. Chay it nhat 1 vong UAT cho:
   - multi-service
   - multi-KTV
   - add-on
   - partial complete
   - cancel truoc/sau start
   - remove service
   - rating ho khach
   - sync turns ve `0`
3. Ghi nhan log truoc/sau moi ca loi de so sanh `Bookings`, `BookingItems`, `TurnQueue`, `TurnLedger`.

### Pha 5: Authz server-side cho dispatch
Muc tieu: loai bo viec goi service-role tran o cum dieu don.

1. Khi roadmap auth tong the vao Pha 2, cac route/action dispatch phai di qua `requireRole()` va `requireBusinessUser()`.
2. Route rating/release/cancel/edit/remove phai validate role va ownership/permission phu hop.
3. Khong route nao tin `techCode`, `employeeId`, `bookingId` tu body neu co the derive tu session hoac validate truc tiep.

## Thu tu uu tien thuc thi
1. Pha 1
2. Pha 4 cho cac case P0
3. Pha 2
4. Pha 3
5. Pha 5 song song roadmap auth tong

## Definition of done
- Khong con parse lai `booking_item_id` comma-string de dieu khien queue.
- Remove/edit/add-on khong lam roi row `TurnQueue` cua item con lai.
- Partial complete/multi-KTV khong lam booking nhay `DONE` som.
- Rating Kanban dung booking/token that.
- `turns_completed` co the phan anh dung va reset `0`.
- Tat ca case P0 trong `dispatch_test_matrix.md` pass.
