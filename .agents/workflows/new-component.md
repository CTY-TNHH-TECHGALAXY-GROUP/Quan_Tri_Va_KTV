---
description: Tạo component mới theo đúng pattern *.logic.ts, *.i18n.ts của project
---

# 🧩 Tạo Component Mới

> **Trigger**: Khi user yêu cầu tạo component, feature, hoặc module mới.

## Bước 1: Xác nhận thông tin

Hỏi user (nếu chưa rõ):
- **Tên component** (PascalCase, ví dụ: `BookingCalendar`)
- **Vị trí**: Nằm trong route nào? (`app/admin/`, `app/ktv/`, `app/reception/`, `components/`)
- **Có cần logic hook?** (hầu hết là CÓ)
- **Có cần i18n?** (hầu hết là CÓ)
- **Có cần animation?** (hỏi nếu liên quan đến UI phức tạp)

## Bước 2: Tạo folder structure

```
[target-path]/[component-name]/
├── [ComponentName].tsx           # UI Layout (arrow function component)
├── [ComponentName].logic.ts      # Business logic hook
├── [ComponentName].i18n.ts       # Text dictionary
├── [ComponentName].animation.ts  # (optional) Animation variants
└── components/                   # (optional) Sub-components
```

## Bước 3: Scaffold file — `[ComponentName].tsx`

Template:
```tsx
'use client';

import { use[ComponentName]Logic } from './[ComponentName].logic';
import { t } from './[ComponentName].i18n';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.3;
const CARD_BORDER_RADIUS = '12px';

const [ComponentName] = () => {
  const { /* destructured state & handlers */ } = use[ComponentName]Logic();

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      {/* UI here */}
    </div>
  );
};

export default [ComponentName];
```

## Bước 4: Scaffold file — `[ComponentName].logic.ts`

Template:
```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';

export const use[ComponentName]Logic = () => {
  // State
  const [loading, setLoading] = useState(true);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // TODO: Fetch from Supabase
      } catch (error) {
        console.error('[ComponentName] fetch error:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Handlers
  // ...

  return {
    loading,
    // export state & handlers
  };
};
```

## Bước 5: Scaffold file — `[ComponentName].i18n.ts`

Template:
```typescript
export const t = {
  title: '[Component Title]',
  // Group by section
  labels: {
    // ...
  },
  buttons: {
    save: 'Lưu',
    cancel: 'Hủy',
    delete: 'Xóa',
  },
  messages: {
    success: 'Thành công!',
    error: 'Đã xảy ra lỗi',
    confirmDelete: 'Bạn có chắc chắn muốn xóa?',
  },
} as const;
```

## Bước 6: Checklist cuối cùng

- [ ] Component dùng **arrow function**, không dùng `function` declaration
- [ ] `'use client'` chỉ thêm khi cần (hooks, interactivity)
- [ ] Không hardcode text → dùng `t.xxx` từ i18n
- [ ] Không hardcode magic numbers → dùng constants ở đầu file
- [ ] Styling dùng **Tailwind CSS**, không dùng inline styles
- [ ] Touch targets >= 44px cho mobile
- [ ] Import paths dùng `@/` alias khi cần

## Bước 7: Thông báo user

> *"Component [Name] đã được tạo xong. Hãy kiểm tra code và commit:*
> *`feat: thêm component [Name]`"*
