---
description: Quy trình debug chuẩn khi gặp lỗi trong project
---

# 🐛 Quy Trình Debug

> **Trigger**: Khi user báo bug, lỗi, hoặc hành vi không đúng mong đợi.

## Bước 1: Thu thập thông tin

Hỏi user (nếu chưa có):
- **Mô tả lỗi**: Chuyện gì xảy ra? Mong đợi gì?
- **Steps to reproduce**: Làm gì để tái hiện?
- **Screenshots / Error logs**: Console, terminal, network tab?
- **Khi nào bắt đầu lỗi**: Sau khi sửa gì? Hay tự dưng?

## Bước 2: Xác định phạm vi lỗi

Phân loại lỗi:

| Loại | Dấu hiệu | Bắt đầu từ đâu |
|---|---|---|
| **UI/Render** | Giao diện sai, layout vỡ | `*.tsx` component |
| **Logic** | Tính toán sai, flow không đúng | `*.logic.ts` hook |
| **API** | 500 error, data sai | `app/api/*/route.ts` |
| **Database** | Data không lưu, query sai | Supabase console + `lib/supabase.ts` |
| **Auth** | Không login được, permission sai | `lib/auth-context.tsx` |
| **Build** | Compile error, type error | Terminal output |

## Bước 3: Trace code path

1. **Xác định entry point** — User click vào đâu? Page nào?
2. **Trace từ UI → Logic** — Component nào render? Hook nào xử lý?
3. **Trace từ Logic → API** — Gọi endpoint nào? Params gì?
4. **Trace từ API → DB** — Query table nào? Conditions gì?

```
User Action → page.tsx → *.logic.ts → fetch('/api/...') → route.ts → Supabase
     ↑                                                                    │
     └──────────── Response/Error ←───────────────────────────────────────┘
```

## Bước 4: Phân tích Root Cause

// turbo-all

Viết phân tích theo format:

```markdown
### 🔍 Root Cause Analysis

**Hiện tượng**: [Mô tả chính xác]

**Nguyên nhân gốc rễ**: [Giải thích TẠI SAO lỗi xảy ra]

**File liên quan**:
- `path/to/file.ts` — dòng XX: [mô tả vấn đề cụ thể]

**Impact**: [Ảnh hưởng đến flow nào khác?]
```

## Bước 5: Fix và verify

1. Sửa đúng **root cause** — KHÔNG patch triệu chứng
2. Check xem fix có ảnh hưởng files liên quan:
   - `*.logic.ts` files khác import cùng module?
   - `*.i18n.ts` cần update text?
   - API routes khác dùng cùng query pattern?
3. Test lại flow hoàn chỉnh (không chỉ test chỗ sửa)

## Bước 6: Cleanup

- [ ] Xóa `console.log` debug (nếu có thêm)
- [ ] KHÔNG commit debug scripts vào root directory
- [ ] Nếu cần debug scripts, đặt vào `tmp/` hoặc `scripts/`

## Bước 7: Thông báo user

> *"Đã sửa lỗi [mô tả]. Nguyên nhân: [root cause tóm tắt]. Hãy kiểm tra và commit:*
> *`fix: sửa lỗi [mô tả ngắn]`"*
