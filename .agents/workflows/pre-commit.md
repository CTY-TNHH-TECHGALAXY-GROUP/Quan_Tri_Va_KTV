---
description: Checklist kiểm tra trước khi commit code
---

# ✅ Pre-Commit Checklist

> **Trigger**: Trước khi commit bất kỳ thay đổi nào.

## Quick Check (< 2 phút)

### 1. Build check
// turbo
```bash
npm run build
```
Nếu có lỗi → FIX trước khi commit. KHÔNG commit code broken.

### 2. Lint check
// turbo
```bash
npm run lint
```
Fix tất cả warnings và errors.

### 3. TypeScript check
// turbo
```bash
npx tsc --noEmit
```
Đảm bảo không có type errors.

## Files Review

### 4. Kiểm tra files đã thay đổi
// turbo
```bash
git status
git diff --stat
```

Verify:
- [ ] Chỉ có files liên quan đến task hiện tại
- [ ] Không vô tình sửa files không liên quan
- [ ] Không có debug files ở root (*.js debug scripts)
- [ ] Không có `.env.local` hoặc files chứa secrets

### 5. Kiểm tra nội dung thay đổi
// turbo
```bash
git diff
```

Verify:
- [ ] Không có `console.log` debug còn sót
- [ ] Không có commented-out code
- [ ] Không có hardcoded text (dùng i18n)
- [ ] Không có TODO mà chưa handle

## Coordination

### 6. Cập nhật `.agents/coordination.md`
- [ ] Đánh dấu files đã sửa xong (🔴 Xong)
- [ ] Ghi log lịch sử vào bảng cuối file

## Commit Message

### 7. Viết commit message theo Conventional Commits

Format: `type: mô tả ngắn bằng tiếng Việt`

| Type | Khi nào dùng | Ví dụ |
|------|-------------|-------|
| `feat` | Thêm tính năng mới | `feat: thêm trang quản lý KTV` |
| `fix` | Sửa bug | `fix: sửa lỗi không hiển thị booking` |
| `refactor` | Refactor code (không đổi behavior) | `refactor: tách logic ra khỏi component` |
| `style` | Sửa UI/CSS (không đổi logic) | `style: cập nhật giao diện dashboard` |
| `chore` | Config, setup, cleanup | `chore: dọn debug scripts` |
| `docs` | Documentation | `docs: cập nhật README` |

### 8. Stage và commit

```bash
git add [specific-files]    # KHÔNG dùng git add .
git commit -m "type: mô tả"
```

> [!IMPORTANT]
> Dùng `git add [file]` cho từng file THAY VÌ `git add .`
> Tránh commit nhầm files không liên quan.

## Sau Commit

> *"Code đã sẵn sàng. KHÔNG tự động push. Hãy kiểm tra lại bằng `git log -1` rồi push khi sẵn sàng."*
