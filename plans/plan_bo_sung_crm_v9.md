# Kế Hoạch: Bổ Sung Thông Tin CRM (V9 Đầy Đủ)

## Mục tiêu
Bổ sung các thông tin còn thiếu trên modal "Chi tiết Khách hàng" so với bản V9:

| # | Thông tin | Nguồn dữ liệu | Trạng thái |
|---|-----------|---------------|------------|
| 1 | **Giới tính** | `Customers.gender` | ✅ Có cột trong DB, chưa hiển thị |
| 2 | **Lực massage ưa thích** | `BookingItems.options.strength` ("Vừa", "Mạnh"...) | ❌ Chưa thu thập |
| 3 | **KTV thường làm** (≥2 lần) | `BookingItems.technicianCodes` | 🟡 Chỉ hiện TOP 1 |
| 4 | **Dịch vụ thường dùng** (≥2 lần + duration) | `BookingItems.serviceId` + `Services.duration` | 🟡 Chỉ hiện TOP 1 |
| 5 | **Ngôn ngữ khách hàng** | `Bookings.customerLang` (en, vi, jp, cn, kr) | ❌ Chưa thu thập |

## Proposed Changes

### 1. Backend API

#### [MODIFY] [route.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/api/customers/route.ts)

**a) Mở rộng câu SELECT:**
- BookingItems: thêm `options` → `BookingItems!fk_bookingitems_booking ( id, serviceId, technicianCodes, options )`
- Bookings: thêm `customerLang` vào câu SELECT
- Services: thêm `duration` → `supabase.from('Services').select('id, name, nameVN, duration')`

**b) Thu thập Lực massage (preferredStrength):**
- Duyệt `BookingItems.options.strength`, đếm tần suất mỗi loại
- Trả về loại lực có tần suất cao nhất (VD: "Vừa")

**c) Thu thập Ngôn ngữ (preferredLang):**
- Duyệt `Bookings.customerLang`, đếm tần suất
- Trả về ngôn ngữ nhiều nhất, map sang tên đọc được:
  - `en` → 🇬🇧 English, `vi` → 🇻🇳 Tiếng Việt, `jp` → 🇯🇵 日本語, `cn` → 🇨🇳 中文, `kr` → 🇰🇷 한국어

**d) KTV thường làm (frequentKtvs) — Rule: ≥2 lần:**
- Lọc tất cả KTV có ≥2 lần làm cho khách, kèm số lần
- Format: `"NH025 (5 lần), NH012 (3 lần)"`

**e) Dịch vụ thường dùng (frequentServices) — Rule: ≥2 lần, kèm duration:**
- Lọc tất cả DV có ≥2 lần, kèm thời lượng từ Services table
- Format: `"Body Massage 60p (4 lần), Foot Massage 90p (2 lần)"`

**f) Trả thêm các trường mới trong response:**
```
gender              // Từ Customers table (đã có sẵn trong ...customer)
preferredStrength   // "Vừa" / "Mạnh" / "Nhẹ"
preferredLang       // "🇬🇧 English"
frequentKtvs        // "NH025 (5 lần), NH012 (3 lần)"
frequentServices    // "Body Massage 60p (4 lần)"
```

---

### 2. Frontend UI

#### [MODIFY] [page.tsx](file:///c:/Users/ADMIN/OneDrive/Desktop/Ngan%20Ha/Quan_Tri_Va_KTV/app/reception/crm/page.tsx)

**Header:** Thêm badge Giới tính + Ngôn ngữ cạnh tên khách:
- `👨 Nam` / `👩 Nữ` + `🇬🇧 English`

**Stats row:** Thêm ô "Lực ưa thích" (cạnh VIP Menu):
- `💪 Lực ưa thích: Vừa`

**Block "Thói quen & Sở thích":**
- "Dịch vụ thường dùng" → `frequentServices` (tất cả DV ≥2 lần kèm duration)
- "KTV quen" → `frequentKtvs` (tất cả KTV ≥2 lần kèm số lần)

## Verification Plan
- F5 trang CRM, mở chi tiết khách có nhiều lần đến
- Kiểm tra: Giới tính, Ngôn ngữ, Lực, KTV ≥2 lần, DV ≥2 lần hiện đúng
