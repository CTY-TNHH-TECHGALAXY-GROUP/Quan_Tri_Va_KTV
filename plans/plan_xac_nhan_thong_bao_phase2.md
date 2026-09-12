# Plan: Xác nhận Thông báo 2 Chiều — Phase 2 (Khách hàng ↔ Quầy)

> **Dành cho Executor.** Đọc kỹ toàn bộ plan trước khi code.
> **Yêu cầu**: Phase 1 phải hoàn thành trước (migration SQL + PATCH API + Toast Quầy đã có nút Xác nhận).

## Tổng quan

Khách hàng từ trang Journey (project `wrb-noi-bo-dev`, domain `nganha.vercel.app`) gửi yêu cầu gọi nước/hỗ trợ/khẩn cấp → Quầy nhận notification → Quầy xác nhận → Khách thấy trạng thái realtime trên web.

## Quyết định kiến trúc đã chốt
- API customer request đặt ở project **wrb-noi-bo-dev** (cùng domain với Journey page).
- Dùng **Supabase Realtime** (không polling) để khách nhận phản hồi tức thì.
- Dùng chung bảng `StaffNotifications` (cùng DB Supabase), phân biệt bằng cột `source = 'CUSTOMER'`.
- Không cần login — dùng `accessToken` của booking để xác thực.

---

## Bước 1: Backend API — POST yêu cầu từ khách

**Project**: `wrb-noi-bo-dev`  
**Tạo file**: `src/app/api/customer/request/route.ts`

### Logic chi tiết:

```typescript
// POST /api/customer/request
// Body: { bookingId: string, accessToken: string, type: 'WATER' | 'SUPPORT' | 'EMERGENCY' | 'CHECKOUT' }
export async function POST(request: Request) {
    // 1. Parse body
    // 2. Validate accessToken: 
    //    SELECT * FROM "Bookings" WHERE id = bookingId AND accessToken = accessToken
    //    → Nếu không khớp → 403
    // 3. Rate limit: Check StaffNotifications
    //    WHERE bookingId = X AND type = 'CUSTOMER_[TYPE]' AND source = 'CUSTOMER'
    //    AND createdAt > NOW() - 3 minutes
    //    → Nếu đã có → 429 "Vui lòng đợi 3 phút"
    // 4. Lấy roomName từ booking
    // 5. Map message:
    //    WATER: "👤 Khách phòng [X] yêu cầu mang nước/trà"
    //    SUPPORT: "👤 Khách phòng [X] yêu cầu hỗ trợ"
    //    EMERGENCY: "🚨 Khách phòng [X] BÁO KHẨN CẤP"
    //    CHECKOUT: "👤 Khách phòng [X] muốn thanh toán"
    // 6. Insert StaffNotifications:
    //    { type: 'CUSTOMER_[TYPE]', message, bookingId, source: 'CUSTOMER', isRead: false }
    // 7. Return { success: true, requestId: [notification.id] }
}
```

### Schema:
```typescript
const CustomerRequestSchema = z.object({
    bookingId: z.string().min(1),
    accessToken: z.string().min(1),
    type: z.enum(['WATER', 'SUPPORT', 'EMERGENCY', 'CHECKOUT']),
});
```

### Lưu ý quan trọng:
- Project `wrb-noi-bo-dev` cần kết nối **cùng Supabase instance** với `Quan_Tri_Va_KTV`.
- Kiểm tra file `.env.local` của `wrb-noi-bo-dev` có `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` trỏ đúng.
- Nếu chưa có, cần tạo Supabase admin client tương tự pattern ở `Quan_Tri_Va_KTV/lib/supabaseAdmin.ts`.

---

## Bước 2: Frontend Khách — Trang Journey

**Project**: `wrb-noi-bo-dev`  
**Sửa file**: Tìm trang Journey (route `/[lang]/journey/[token]`)

### 2.1 UI — Floating Action Buttons

Thêm nhóm nút nổi (fixed bottom) trên trang Journey:

```
┌────────────────────────────┐
│  🥤 Gọi nước   🔔 Hỗ trợ  │
│  🚨 Khẩn cấp  💳 Thanh toán│
└────────────────────────────┘
```

- Mỗi nút khi bấm → Gọi `POST /api/customer/request`.
- Hiển thị loading spinner khi đang gửi.
- Sau khi gửi → Nút chuyển sang trạng thái "Đang chờ..." (disabled, badge vàng).
- Khi Quầy xác nhận → Nút chuyển sang "✅ Đã xác nhận" (badge xanh) + hiển thị ghi chú từ Quầy.

### 2.2 Supabase Realtime — Lắng nghe xác nhận

```typescript
// Trong component Journey, sau khi gửi request thành công:
const channel = supabase
    .channel(`customer-request-${requestId}`)
    .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'StaffNotifications',
        filter: `id=eq.${requestId}`,
    }, (payload) => {
        if (payload.new.acknowledgedAt) {
            // Quầy đã xác nhận!
            setRequestStatus('CONFIRMED');
            setAcknowledgedNote(payload.new.acknowledgedNote);
        }
    })
    .subscribe();

// Cleanup khi unmount
return () => { supabase.removeChannel(channel); };
```

### 2.3 Cooldown UI

Sau khi gửi 1 yêu cầu, nút đó bị disable 3 phút (đồng bộ với rate limit backend).
Hiển thị countdown: "Gửi lại sau 2:45..."

---

## Bước 3: Frontend Quầy — Badge phân biệt nguồn

**Project**: `Quan_Tri_Va_KTV`  
**Sửa file**: `components/NotificationProvider.tsx`

### Toast Component

Khi notification có `source === 'CUSTOMER'` hoặc type bắt đầu bằng `CUSTOMER_`:

- Thêm badge **"👤 KHÁCH"** trước message.
- Dùng màu khác (ví dụ: border tím, icon người) để phân biệt với yêu cầu từ KTV.
- Nút "Xác nhận" hoạt động giống Phase 1 (đã có sẵn từ Phase 1).

### SOUND_MAP

```typescript
'CUSTOMER_WATER': '/sounds/reception-notification.wav',
'CUSTOMER_SUPPORT': '/sounds/reception-notification.wav',
'CUSTOMER_EMERGENCY': '/sounds/quay-bao-khan-cap.wav',
'CUSTOMER_CHECKOUT': '/sounds/reception-notification.wav',
```

### Admin Notifications Page

Thêm filter theo source: "Tất cả" / "Từ KTV" / "Từ Khách".

---

## Bước 4: Supabase Realtime — Enable cho StaffNotifications

Kiểm tra Supabase Dashboard → Database → Replication:
- Đảm bảo bảng `StaffNotifications` đã được enable cho Realtime (cả INSERT và UPDATE).
- Nếu chưa có UPDATE: Bật lên để khách nhận được event khi Quầy update `acknowledgedAt`.

---

## Checklist kiểm tra

- [ ] `POST /api/customer/request` hoạt động (test bằng curl/Postman).
- [ ] Rate limit 3 phút hoạt động đúng.
- [ ] Validate accessToken đúng.
- [ ] Trang Journey hiện nút tương tác.
- [ ] Bấm nút → Quầy nhận toast có badge "KHÁCH".
- [ ] Quầy xác nhận → Khách thấy "Đã xác nhận" realtime (< 1 giây).
- [ ] Toast Quầy phân biệt được nguồn KTV vs Khách.
- [ ] Build cả 2 project không lỗi.

---

## File reference (Quan_Tri_Va_KTV)

| File | Vai trò |
|------|---------|
| `components/NotificationProvider.tsx` | Toast UI + Realtime subscription |
| `lib/notification-helper.ts` | Insert notification helper |
| `app/api/ktv/interaction/route.ts` | API gốc (POST tạo, PATCH xác nhận) |
| `app/admin/notifications/` | Trang lịch sử notifications |

## File reference (wrb-noi-bo-dev)

| File | Vai trò |
|------|---------|
| `src/app/api/customer/request/route.ts` | [NEW] API customer request |
| `src/app/[lang]/journey/[token]/page.tsx` | Trang Journey (thêm nút tương tác) |
