---
description: Tạo page mới trong Next.js App Router theo đúng cấu trúc project
---

# 📄 Tạo Page Mới (App Router)

> **Trigger**: Khi user yêu cầu tạo trang mới, thêm route mới.

## Bước 1: Xác nhận thông tin

Hỏi user (nếu chưa rõ):
- **Route path**: VD `/admin/reports`, `/ktv/schedule`
- **Thuộc role nào**: admin / ktv / reception / finance / public
- **Cần sidebar navigation?** (hầu hết là CÓ)
- **Cần API route kèm theo?** (nếu cần fetch data)

## Bước 2: Xác định vị trí trong cây route

```
app/
├── admin/        # Quản trị viên
│   ├── ai/
│   ├── employees/
│   ├── notifications/
│   ├── roles/
│   ├── service-menu/
│   └── web-booking/
├── ktv/          # Kỹ thuật viên
│   ├── attendance/
│   ├── dashboard/
│   ├── history/
│   ├── leave/
│   └── performance/
├── reception/    # Lễ tân
│   ├── crm/
│   ├── dispatch/
│   ├── ktv-hub/
│   ├── orders/
│   └── turns/
├── finance/      # Tài chính
└── services/     # Dịch vụ
```

## Bước 3: Tạo file structure

```
app/[role]/[feature-name]/
├── page.tsx                      # Route entry — KEEP CLEAN
├── [FeatureName].logic.ts        # Business logic hook
├── [FeatureName].i18n.ts         # Text dictionary
└── components/                   # (optional) Page-specific components
    ├── [SubComponent1].tsx
    └── [SubComponent2].tsx
```

## Bước 4: Scaffold `page.tsx`

Nguyên tắc: **page.tsx phải CLEAN** — chỉ import và render component chính.

```tsx
'use client';

import [FeatureName]View from './[FeatureName]View';
// HOẶC inline nếu đơn giản:

import { use[FeatureName]Logic } from './[FeatureName].logic';
import { t } from './[FeatureName].i18n';

// 🔧 UI CONFIGURATION
const PAGE_PADDING = 'p-4 md:p-6';

const [FeatureName]Page = () => {
  const logic = use[FeatureName]Logic();

  return (
    <div className={`${PAGE_PADDING} space-y-6`}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.title}</h1>
      </div>

      {/* Page content */}
    </div>
  );
};

export default [FeatureName]Page;
```

## Bước 5: Thêm vào Sidebar navigation

Mở file `components/layout/Sidebar.tsx` và thêm menu item mới:
- Icon từ `lucide-react`
- Label text
- Route path
- Đúng role section

## Bước 6: Tạo API route (nếu cần)

Nếu page cần fetch data, tạo API route theo workflow `/new-api`.

## Bước 7: Checklist cuối cùng

- [ ] `page.tsx` clean — không chứa business logic
- [ ] Logic tách vào `*.logic.ts`
- [ ] Text tách vào `*.i18n.ts`
- [ ] Đã thêm vào Sidebar navigation
- [ ] Responsive: check mobile view
- [ ] Auth: page có cần protected route không?

## Bước 8: Thông báo user

> *"Page [name] đã được tạo tại `/[role]/[feature]`. Hãy kiểm tra code và commit:*
> *`feat: thêm trang [mô tả]`"*
