---
description: Checklist review code trước khi approve hoặc merge
---

# 🔍 Code Review Checklist

> **Trigger**: Khi user yêu cầu review code, hoặc trước khi kết thúc một task quan trọng.

## 1. Architecture & Patterns

- [ ] **Separation of Concerns**: UI logic nằm trong `*.logic.ts`, không trong `*.tsx`
- [ ] **i18n**: Text không hardcode trong `*.tsx`, dùng `*.i18n.ts`
- [ ] **Server vs Client**: `'use client'` chỉ khi thật sự cần (hooks, event handlers)
- [ ] **Components**: Dùng arrow functions, PascalCase naming

## 2. Code Quality

- [ ] **Naming**: camelCase cho biến/hàm, UPPER_SNAKE_CASE cho constants
- [ ] **TypeScript**: Không dùng `any` — define proper types trong `lib/types.ts`
- [ ] **Error handling**: Try/catch cho async operations, user-friendly error messages
- [ ] **No dead code**: Xóa commented-out code, unused imports, unused variables
- [ ] **No console.log**: Xóa debug logs (chỉ giữ `console.error` cho error handling)

## 3. UI/UX (Spa Theme)

- [ ] **Mobile-first**: Check responsive ở 375px, 768px, 1024px
- [ ] **Touch targets**: Buttons, links >= 44px height/width
- [ ] **Spa aesthetic**: Rounded corners, soft shadows, ample whitespace
- [ ] **Loading states**: Skeleton hoặc spinner khi fetch data
- [ ] **Empty states**: Hiển thị message khi không có data
- [ ] **Error states**: Toast/alert khi operation thất bại

## 4. Performance

- [ ] **No unnecessary re-renders**: useCallback, useMemo khi cần
- [ ] **List keys**: Dùng unique `id`, KHÔNG dùng `index` làm key
- [ ] **Image optimization**: Dùng `next/image` cho images
- [ ] **API calls**: Không gọi API trong render cycle, chỉ trong useEffect

## 5. Security

- [ ] **No secrets in code**: API keys trong `.env.local`, dùng `process.env`
- [ ] **Input validation**: Validate user input trước khi gửi server
- [ ] **SQL injection**: Dùng Supabase SDK (parameterized queries), không raw SQL

## 6. Tailwind CSS

- [ ] **No inline styles**: `style={{...}}` chỉ cho dynamic values
- [ ] **Consistent spacing**: Dùng Tailwind scale (p-2, p-4, p-6...)
- [ ] **Responsive prefixes**: `md:`, `lg:` cho responsive breakpoints
- [ ] **Dark mode**: Có support `dark:` variants (nếu project yêu cầu)

## 7. Files Check

- [ ] **Coordination**: Đã check `.agents/coordination.md` trước khi edit
- [ ] **No debug files**: Không commit `inspect-*.js`, `debug-*.js` vào root
- [ ] **Updated types**: `lib/types.ts` được cập nhật nếu thêm fields mới

## Output Format

Sau khi review, output kết quả:

```markdown
### ✅ Code Review Result

**Files reviewed**: [danh sách files]

**Passed**: X/Y checks
**Issues found**: 

| # | File | Issue | Severity |
|---|------|-------|----------|
| 1 | path/to/file | Mô tả issue | HIGH/MEDIUM/LOW |

**Recommendation**: APPROVE / REQUEST CHANGES / BLOCK
```
