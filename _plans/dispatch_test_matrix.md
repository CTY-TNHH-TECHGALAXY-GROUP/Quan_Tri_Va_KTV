# Dispatch Test Matrix

## Muc tieu
Tai lieu nay dung de test cum dieu don cho cac truong hop van hanh thuc te. Muc tieu la dam bao `Bookings`, `BookingItems`, `TurnQueue`, `TurnLedger`, KTV Dashboard, va Kanban cua le tan luon nhat quan.

## Invariants can giu
- `Bookings.status` phai phan anh dung trang thai tong cua tat ca `BookingItems`.
- `BookingItems.status` khong duoc nhay lui hoac mau thuan voi segment/work state.
- `TurnQueue` chi co mot mo hinh du lieu thong nhat cho multi-item, uu tien `booking_item_ids`.
- `TurnLedger` phai tang, giu, hoac reset dung theo chinh sach khi start, cancel, release.
- Mot thao tac retry/double click khong duoc tao ra trang thai rac hoac ghi lap sai.
- Rating/review phai dung `bookingId` that hoac token that, khong dung ID tong hop.

## Bang test case
| ID | Nhom | Case | Du lieu dau vao | Hanh dong | Ky vong Booking/Items | Ky vong TurnQueue/TurnLedger | Ky vong UI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D01 | Assignment | 1 booking, 1 service, 1 KTV | 1 `Booking`, 1 `BookingItem`, 1 KTV dang `waiting` | Dieu don moi | Booking -> `PREPARING`/`IN_PROGRESS` theo flow; item duoc gan dung KTV, phong, giuong | 1 row `TurnQueue` cua KTV duoc gan booking, item IDs dung; ledger tang 1 lan | Le tan thay booking o dung cot; KTV nhan don |
| D02 | Assignment | 1 booking, nhieu service, moi service 1 KTV khac nhau | 1 booking, 2-3 items, moi item 1 KTV | Dieu don moi | Moi item luu dung `technicianCodes`, segment, room/bed | Moi KTV co row dung trong `TurnQueue`; ledger tang dung tung nguoi | Quick/Detail dispatch hien dung KTV tung service |
| D03 | Assignment | 1 booking, nhieu service, cung 1 KTV lam nhieu service | 1 booking, 2 items, 1 KTV | Dieu don moi | Cac item cung tro toi 1 KTV, khong tao status mau thuan | `TurnQueue` cua KTV mang day du `booking_item_ids`, khong lap row | KTV thay tong viec cua booking khong bi tach rach sai |
| D04 | Multi-KTV | 1 service co 2 KTV cung lam, start cung luc | 1 item, 2 KTV | Dieu don + start | Item va segments luu du 2 KTV | 2 row `TurnQueue` cung tro toi booking; ledger cua ca 2 tang dung | Ca 2 KTV thay dung man hinh lam viec |
| D05 | Multi-KTV | 1 service co 2 KTV start lech nhau | 1 item, 2 KTV, segment A start truoc B | Start tung KTV lech gio | Segment cua moi KTV co `actualStartTime` rieng, item khong bi nhay sai | `TurnQueue` van tro dung mot booking; khong release som nguoi con lai | UI hien phan doan thoi gian dung cho tung KTV |
| D06 | Multi-KTV | 1 service co 2 KTV end lech nhau | 1 item, 2 KTV dang lam | Complete KTV A truoc, B sau | Item/booking chua `DONE` khi moi 1 KTV complete | `TurnQueue` cua A co the chuyen trang thai dung, B van `working` | Khong KTV nao bi keo sai ve dashboard som |
| D07 | Room/Segment | 1 booking, 1 service, 1 KTV, doi phong/giuong giua chung | 1 item, 1 KTV, 2 segment khac room/bed | Cap nhat segment/room | Segment va metadata phong/giuong duoc luu day du | `TurnQueue` cap nhat room/bed hien tai dung | Dispatch monitor va KTV dashboard khong mat lich su segment |
| D08 | Room/Segment | 1 booking, 1 service, 1 KTV, nhieu phong | 1 item, 1 KTV, >1 segment | Dieu don/doi phong | Item van la 1 item, nhung segment du phong khac nhau | `TurnQueue` khong vo du lieu khi doi phong | Monitor hien dung phong hien tai |
| D09 | Draft | Luu draft dieu don roi mo lai | Booking chua start | Save draft -> reload | Khong doi status booking/item | Chua release/tang them ledger sai | Form phuc hoi du du lieu dang sua |
| D10 | Start/Complete | Start toan booking | Booking da dispatch, nhieu item | Start booking | Booking `IN_PROGRESS`; item can start duoc start | TurnQueue cua cac KTV lien quan thanh `working` | Le tan va KTV dong bo |
| D11 | Start/Complete | Start chi 1 item, item khac chua bat dau | Booking co >=2 items | Start partial | Chi item muc tieu `IN_PROGRESS`; item khac giu nguyen | Chi KTV lien quan chuyen `working` | Booking khong nhay sai `DONE`/`COMPLETED` |
| D12 | Start/Complete | Hoan tat 1 item, item khac van tiep tuc | Booking co >=2 items | Complete partial | Item muc tieu complete; booking chua `DONE` | KTV cua item xong duoc xu ly dung; KTV item khac van lam | UI khong release booking som |
| D13 | Add-on | Add-on khi bill dang lam, cung KTV tiep tuc lam | Booking `IN_PROGRESS`, co KTV dang lam | Them add-on | Tao `BookingItem` moi, tong tien tang dung | `booking_item_ids` duoc mo rong dung, `estimated_end_time` tang dung | KTV thay tong viec moi, dispatch khong mat assign cu |
| D14 | Add-on | Add-on khi bill dang lam, can dieu lai KTV/phong/giuong | Booking dang lam, add-on can nguoi khac | Them add-on + dieu lai | Item add-on luu KTV/phong/giuong moi dung | TurnQueue cua KTV moi va cu nhat quan | UI hien dung ai lam item phat sinh |
| D15 | Payment | Xac nhan thu tien add-on | Booking co item add-on `isPaid=false` | Confirm payment | Options item doi sang `isPaid=true` | Khong anh huong sai `TurnQueue`/ledger | UI khong con badge "chua thu" |
| D16 | Remove | Xoa 1 service truoc khi bat dau | Booking co item chua start | Remove item | Item bi xoa/cancel dung; tong tien giam dung | Neu chua bat dau thi release/ledger dung chinh sach | UI bien mat item, booking con lai on dinh |
| D17 | Remove | Xoa 1 service khi KTV do con service khac trong cung bill | Booking co nhieu item, 1 KTV dang giu >1 item | Remove 1 item | Cac item con lai van dung assign/status | `TurnQueue` khong duoc clear ca row; chi bo item bi xoa | KTV van thay cong viec con lai |
| D18 | Edit | Doi service giua chung | Booking dang lam, item dang active | Edit service | Gia va duration cap nhat dung | `estimated_end_time` cap nhat dung theo chenhlech | Dispatch va monitor cap nhat ten/gia moi |
| D19 | Cancel | Huy truoc khi KTV bat dau | Booking da dispatch, KTV chua start | Cancel booking | Booking/item -> `CANCELLED` | KTV duoc tra luot tua; ledger xoa/reset dung | UI dua booking ra khoi flow dang lam |
| D20 | Cancel | Huy khi KTV dang lam | Booking/item `IN_PROGRESS` | Cancel booking | Booking/item -> `CANCELLED` theo policy | Ledger/turns theo policy da chot, khong mo ho | KTV duoc release dung luong |
| D21 | Rating | Khach cham sao qua link that | Booking co `accessToken` that | Mo link rating | Rating luu vao booking dung ID/token | Khong anh huong sai queue | Dispatch chuyen `waiting_rating`/`done` dung |
| D22 | Rating | Le tan cham sao ho khach tu Kanban | Split order / multi-KTV booking | Submit rating tren Kanban | Route rating phai trung booking that | Khong fail vi synthetic ID | Nut sao va copy link deu hoat dong |
| D23 | KTV Flow | KTV review/handover xong va duoc release | Booking da qua service | KTV save review + handover | Booking/item sang trang thai hau ky dung | TurnQueue duoc release de nhan don moi | KTV tro ve dashboard, khong ket review |
| D24 | Realtime | Refresh/realtime giua luc dang sua dieu phoi | Le tan dang mo form dispatch | Co event update tu DB | Draft/form khong bi mat | Khong tao update lap/nhay status sai | UI giu context dang sua |
| D25 | Retry | Double click / timeout / submit lap | Network cham hoac nguoi dung bam 2 lan | Goi action lap | Khong tao item/ledger/assign duplicate | TurnQueue va ledger khong nhan ban ghi rac | UI bao loi dung, retry an toan |
| D26 | Sync | Sync turns sau cancel/remove/release ve dung, ke ca ve 0 | Da co ledger cu | Trigger `syncTurnsForDate` | Khong con count cu treo | `turns_completed` phan anh dung, co the reset `0` | Thu tu tua cong bang |
| D27 | Security | Unauthorized request khong duoc dieu don/release/sua rating | Request gia mao | Goi route/action truc tiep | Server tu choi | Khong doi queue/ledger | UI nhan loi phan quyen |
| D28 | Guardrail | 1 KTV bi assign vao 2 booking chong gio | 2 booking cung khung gio | Thu dieu don booking thu 2 | Server/logic chan conflict | TurnQueue chi co 1 booking active hop le | UI canh bao conflict |
| D29 | Guardrail | 1 phong/giuong bi dung trung gio | 2 item cung room/bed | Thu dieu don | Server/logic chan overlap | Khong tao assign sai | UI canh bao xung dot tai nguyen |
| D30 | Data | Reopen booking sau loi dang do | Booking co update dang do truoc do | Retry thao tac | He thong hoi phuc duoc trang thai nhat quan cuoi | Khong de queue/ledger mo coi | UI cho phep tiep tuc xu ly |

## Muc uu tien UAT
### P0
- D01, D02, D11, D12, D13, D17, D19, D22, D23, D26

### P1
- D04, D05, D06, D08, D14, D18, D20, D24, D25, D27

### P2
- D03, D07, D09, D15, D16, D21, D28, D29, D30

## Dinh nghia done cho dispatch
- Khong con row `TurnQueue` nao bi sai `booking_item_ids` sau add-on/remove/edit.
- Khong con truong hop release nham KTV khi booking/item con dang lam.
- Rating tu Kanban va link rating khong dung synthetic ID.
- `syncTurnsForDate` co kha nang reset `turns_completed` ve `0`.
- Cac case P0 pass end-to-end tren moi truong test.
