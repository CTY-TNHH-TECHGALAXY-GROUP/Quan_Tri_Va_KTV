# Prompt — Fix cờ `guest_arrival_lock_enabled` làm chết tính năng Báo Khách

> Copy toàn bộ phần dưới gửi cho anti.
> Độc lập với `plans/prompt_phase3_khoa_ky_luat_typeD.md` — làm cái này TRƯỚC vì đang chết tính năng trên production.

---

## 0. Triệu chứng

Nút **Báo Khách** trên Dispatch Board đang **xám, bấm không được**, tooltip
"Tính năng Báo Khách đang bị tắt trong cài đặt hệ thống". Không có chỗ nào trong app bật lại được
→ tính năng khóa tan ca TYPE_D hiện **không hoạt động**.

## 1. Nguyên nhân

`app/api/reception/guest-arrival/route.ts:19` đọc cờ bằng phép so sánh quá chặt:

```ts
const isEnabled = config?.value === 'true';
```

Giá trị đó chảy xuống `app/reception/dispatch/page.tsx:1876` → `disabled={!guestArrivalLock.enabled}`.

`SystemConfigs.value` trong DB thật **không trả về chuỗi `true` trần**. Bằng chứng ngay trong repo —
`lib/services/KtvCommissionService.ts:122` phải strip dấu nháy mới đọc được cờ:

```ts
const isBonusWalletEnabled = String(configMap[instantRewardKey] || '').replace(/"/g, '') === 'true';
```

Cộng thêm khả năng row `guest_arrival_lock_enabled` **chưa tồn tại** trên DB
(chỉ được seed trong `supabase/migrations/20260902090000_create_guest_arrival_events.sql:31`,
migration có thể chưa apply lên Supabase) → `config` = null → `isEnabled` = false.

**Cùng lỗi này còn nằm ở `app/api/ktv/attendance/route.ts:166`** — nên kể cả bật được nút thì
chốt chặn CHECK_OUT vẫn không chạy. Phải sửa cả hai, đừng sửa mỗi chỗ đầu.

## 2. Việc cần làm

### 2.1 Tách hàm đọc cờ dùng chung

Trong `lib/guest-arrival.logic.ts` (file đã có sẵn), thêm:

```ts
export async function isGuestArrivalEnabled(supabase): Promise<boolean> { ... }
```

Quy tắc parse — theo đúng pattern đã được kiểm chứng của repo:

```ts
String(config?.value ?? '').replace(/"/g, '').trim().toLowerCase() === 'true'
```

**Mặc định khi row KHÔNG tồn tại: trả về `true` (bật).**
Lý do: hiện tại thiếu row = tắt âm thầm, và đó chính là cách tính năng chết mà không ai biết.
Muốn tắt thì phải set `false` **tường minh**.

### 2.2 Thay cả HAI chỗ đang so sánh thủ công

- `app/api/reception/guest-arrival/route.ts:19`
- `app/api/ktv/attendance/route.ts:166` (khối chặn CHECK_OUT của TYPE_D)

Cả hai gọi `isGuestArrivalEnabled()`. Không còn chỗ nào so sánh `=== 'true'` trực tiếp với cột này nữa
(grep lại `guest_arrival_lock_enabled` để chắc chắn đã quét hết).

### 2.3 Seed lại cho chắc

Tạo migration mới (đừng sửa migration cũ đã commit):

```sql
INSERT INTO "SystemConfigs" (key, value, description)
VALUES ('guest_arrival_lock_enabled', 'true', 'Kích hoạt tính năng khóa tan ca khi có khách đến')
ON CONFLICT (key) DO NOTHING;
```

Dùng `DO NOTHING` chứ **không** `DO UPDATE` — nếu admin đã chủ động tắt thì đừng bật đè lên.

### 2.4 Đừng để lỗi này im lặng lần nữa

Khi `isEnabled === false`, log cảnh báo phía server nêu rõ đọc được giá trị thô là gì
(`console.warn` kèm raw value). Hiện tại tính năng chết hoàn toàn không để lại dấu vết nào trong log.

## 3. KHÔNG làm

- Không đụng logic auto-release / `hasPendingDispatch` — phần đó đã đúng.
- Không bỏ nút `disabled` ở `dispatch/page.tsx:1876`. Nút xám khi cờ tắt là **đúng thiết kế**
  (chống việc quầy tưởng đã khóa mà thực ra KTV vẫn tan ca được). Sửa ở tầng đọc cờ, không sửa ở UI.
- Không đổi tên key cấu hình.

## 4. Tự kiểm trước khi báo xong

1. Chạy `SELECT key, value, pg_typeof(value) FROM "SystemConfigs" WHERE key = 'guest_arrival_lock_enabled';`
   → **báo lại kết quả thật** (có row không, kiểu gì, giá trị thô ra sao). Đây là dữ kiện tôi đang thiếu.
2. Với row có `value = 'true'` → nút Báo Khách bấm được.
3. Với row `value = '"true"'` (có nháy) → **vẫn** bấm được (đây là ca đang nghi ngờ nhất).
4. Xóa hẳn row đi → nút **vẫn** bấm được (mặc định bật, theo §2.1).
5. Set `value = 'false'` → nút xám lại, VÀ KTV TYPE_D tan ca được bình thường (chốt chặn nhả ra).
6. Bật cờ + bấm Báo Khách → KTV TYPE_D bấm tan ca nhận **403** (không phải chỉ ẩn nút).

Báo lại kết quả 6 mục, mục nào chưa test được thì nói rõ, đừng báo xong chung chung.
