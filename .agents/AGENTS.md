# Global Project Rules (Next.js Spa Management System)

*All agents and subagents executing tasks in this workspace, including those using generic `agent-skills`, MUST adhere to the following rules without exception. These project-specific rules override any generic skill behaviors.*

## 1. Architecture & File Structure
- **Frameworks**: Next.js (App Router), Node.js, TypeScript, Tailwind CSS, Supabase.
- **Logic Separation (STRICT)**: DO NOT stuff business logic into UI components (`.tsx`). 
  - ALWAYS use `*.logic.ts` hooks for state/business logic.
  - ALWAYS use `*.i18n.ts` for text content (no hard-coded strings in `.tsx`).
  - ALWAYS use `*.animation.ts` for complex animations.
- When generic skills (e.g., `/build`) suggest creating a component, you MUST adhere to the multi-file pattern: `[Name].tsx`, `[Name].logic.ts`, `[Name].i18n.ts`.

## 2. Database Schema (CRITICAL)
- When code involves the database (Supabase), you **MUST READ** `TableInSupabase.md` BEFORE writing code.
- Do NOT assume table or column names. Check the schema first.

## 3. Workflow & Safety
- **Plan First & Wait**: You MUST output an implementation plan in **Vietnamese** and wait for the user's explicit approval BEFORE editing files.
- **No Global Search**: Do not automatically search (grep) the entire codebase.
- **Git Safety**: Remind the user to commit changes when a task is completed. Do not automatically push.
- **Git Commit Scope (CRITICAL)**: Khi commit, KHÔNG ĐƯỢC dùng `git add .`. Phải `git add` **CHỈ các file liên quan trực tiếp** đến task đang làm. Các file không liên quan (CSV, script tạm, file từ conversation khác) KHÔNG được gộp chung vào commit.

## 4. Communication Standard
- **Language**: Use Vietnamese for all plans, analysis, and conversation with the user. Use English for code, comments, and commits.
- **Tone**: Professional, AI Sparring Partner (provide critical feedback, point out edge cases, don't just blindly agree).

## 5. Artifact Retention
- Save development analysis and architectural pros/cons to a Markdown file.
- Save approved implementation plans to the `plans/` directory with a descriptive name (e.g., `plans/plan_feature_name.md`).

## 6. KTV Dashboard Rules
- Do NOT break existing flows in `KTVDashboard.logic.ts` or `dispatch/page.tsx` (Commission Flow, Continuous Receiving, State Integrity, Smart Sync).
- Timer logic must use `Date.now() - timerStartMsRef.current` (Absolute Time). Do not use `prev - 1` logic.
- Do NOT split `KTVDashboard.logic.ts` into smaller files to avoid Realtime Race Conditions.

## 7. Backend & API Rules (S.O.L.I.D)
- **SOLID Principles**: You MUST apply SOLID principles when creating or modifying backend code.
- **Service Layer Pattern**: API Routes (`route.ts`) must act only as controllers (handling requests/responses). ALL business logic and Supabase queries MUST be extracted into a separate Service class/file (e.g., `featureName.service.ts`).
- **Single Responsibility**: Do not mix UI logic, routing logic, and database operations in the same file.


## 8. Reporting Standard (Quy chuẩn Báo Cáo Tiến Độ)
Khi User yêu cầu "Cập nhật tiến độ" hoặc "Báo cáo tiến độ", AI BẮT BUỘC phải nhóm các tính năng/công việc đã làm theo form định dạng sau:

🟢 NHÓM [SỐ]: [TÊN NHÓM LOGIC / TÍNH NĂNG]
Tiến độ: Hoàn thiện [X]%

- **[Tên Tính Năng/Hạng mục 1]:**
  [Mô tả ngắn gọn, súc tích về cách hệ thống hoạt động hoặc cách AI đã tối ưu hóa, gạch đầu dòng rõ ràng, không viết quá dài].
- **[Tên Tính Năng/Hạng mục 2]:**
  [Mô tả tương tự...].

Quy tắc:
- Không liệt kê lộn xộn, phải phân nhóm rõ ràng (VD: Nhóm Trải nghiệm Lễ Tân, Nhóm KTV, Nhóm Database & API...).
- Bắt buộc dùng icon 🟢 (hoặc 🟡 nếu đang làm) và thống kê % tiến độ.
- Văn phong chuyên nghiệp, tập trung vào "Giải pháp kỹ thuật" và "Lợi ích mang lại" để User copy nộp cho Quản lý.