---
description: Chuyển thiết kế từ Canva/Figma mockup thành code Next.js + Tailwind
---

# 🎨 Design to Code — Mockup → Implementation

> **Trigger**: Khi user cung cấp screenshot/link Canva hoặc Figma mockup để implement.

## Bước 1: Phân tích mockup

Khi nhận screenshot hoặc URL mockup:

1. **Quan sát tổng thể**: Layout, sections, visual hierarchy
2. **Phân tách sections**: Liệt kê từng section/block từ trên xuống dưới
3. **Xác định components**: Section nào tái sử dụng được?
4. **Trích xuất design tokens**:
   - Colors (dùng HSL hoặc hex)
   - Typography (font size, weight, line-height)
   - Spacing patterns
   - Border radius
   - Shadows

Output format:

```markdown
### 📐 Phân Tích Mockup

**Layout**: [1 column / 2 column / grid / ...]

**Sections** (từ trên xuống):
1. [Section name] — [mô tả ngắn]
2. [Section name] — [mô tả ngắn]
...

**Color Palette**:
- Primary: #XXXXXX
- Secondary: #XXXXXX
- Background: #XXXXXX
- Text: #XXXXXX

**Typography**:
- Heading: [size] / [weight]
- Body: [size] / [weight]

**Components tái sử dụng**:
- [Component 1]
- [Component 2]
```

## Bước 2: Map sang Tailwind CSS

Chuyển design tokens thành Tailwind classes:

| Design | Tailwind Equivalent |
|--------|-------------------|
| Font 32px Bold | `text-3xl font-bold` |
| Color #D4A574 | `text-[#D4A574]` hoặc custom color |
| Padding 24px | `p-6` |
| Radius 12px | `rounded-xl` |
| Shadow medium | `shadow-md` |
| Gap 16px | `gap-4` |

## Bước 3: Xác định component structure

```
app/[page-name]/
├── page.tsx
├── [PageName].logic.ts
├── [PageName].i18n.ts
└── components/
    ├── HeroSection.tsx
    ├── ContentSection.tsx
    └── [SectionName].tsx
```

## Bước 4: Implement Mobile-First

Luôn code **mobile layout trước**, rồi thêm responsive:

```tsx
// ✅ ĐÚNG: Mobile-first
<div className="flex flex-col md:flex-row gap-4">
  <div className="w-full md:w-1/2">...</div>
  <div className="w-full md:w-1/2">...</div>
</div>

// ❌ SAI: Desktop-first
<div className="flex flex-row md:flex-col gap-4">...</div>
```

## Bước 5: Spa-specific Guidelines

### Colors — Gam màu Spa thư giãn:
- Warm browns, beiges, golds (luxury feel)
- Muted greens, sage (natural/relaxing)
- Soft whites, creams (clean/minimal)
- **TRÁNH**: Bright neon colors, harsh contrasts

### UI Elements:
- Rounded corners: `rounded-lg` đến `rounded-2xl` (mềm mại)
- Soft shadows: `shadow-sm` đến `shadow-md` (không quá đậm)
- Ample whitespace: `space-y-6`, `p-6`, `gap-6` (không chật)
- Smooth transitions: `transition-all duration-300`

### Typography:
- Headings: `font-serif` hoặc elegant sans-serif
- Body: Clean sans-serif (Inter, Outfit)
- Letter spacing: `tracking-wide` cho headings

## Bước 6: So sánh với mockup

Sau khi implement xong:
1. **Screenshot** trang đã code
2. Đặt cạnh mockup Canva
3. Liệt kê khác biệt:
   - Spacing
   - Colors
   - Font sizes
   - Layout alignment
4. Sửa cho khớp

## Bước 7: Responsive check

Kiểm tra ở 3 breakpoints:
- **Mobile**: 375px (iPhone SE)
- **Tablet**: 768px (iPad)
- **Desktop**: 1280px (Laptop)

## Bước 8: Thông báo user

> *"Đã implement xong [section/page] từ mockup. Hãy so sánh với thiết kế Canva và cho feedback. Commit:*
> *`feat: implement giao diện [tên section]`"*

> [!TIP]
> Nếu cần tạo hình ảnh placeholder cho development, sử dụng tool `generate_image` để tạo ảnh phù hợp thay vì dùng URL placeholder.
