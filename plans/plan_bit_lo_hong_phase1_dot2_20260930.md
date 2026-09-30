# Plan: Bít lỗ hổng phase 1 — đợt 2 (30/09/2026)

> Mức 2 — chờ duyệt. Chưa sửa dòng code nào.
> Nguồn: báo cáo rà soát nhánh `feat/bit-lo-hong-phase1` (4 agent + kiểm tra trực tiếp) và feedback của user cùng ngày.

## 0. Phạm vi

**Làm trong đợt này**

| Phase | Nội dung | Mức |
|---|---|---|
| A | Vệ sinh repo: file `* 2.*`, `supabase/.temp`, script rời ở gốc | 0 |
| B | Lớp auth: middleware 401 (có cờ bật/tắt), 2 helper fail-closed, guard 8 file `actions.ts`, gỡ route debug, siết 2 route upload public, guard các route tiền chưa có auth | 2 |
| C | Báo cáo tài chính: KTV bị đổi ra không được chia tiền (B1); KTV ngoài `EXT_*` tính giá Loại C (B7) | 2 |
| D | `reset-type-d-hours` nhận GET để Vercel cron chạy được (B4) | 2 (cron giờ) |
| E | Gom hoa hồng A/B/C về một hàm — **chỉ thiết kế, chờ xác nhận có làm trong đợt này không** | 2 |

**Không đụng (theo feedback)**

- B3 — giờ chạy cron `sync-daily-ledger` và cửa sổ ngày hard-code `+07:00`.
- B8 — ảnh minh chứng ở bucket public, xoá sau 7 ngày: user xác nhận đúng ý.
- Migration mồ côi `20260929230000_ktv_start_release_atomic_root.sql` và `plans/root_sequential_audit_20260929/`: đang test ở nhánh khác. Phase A **không xoá** hai đường dẫn này.
- S5 — `app/api/ktv/booking` (điều phối): user cho phép mở. Middleware sẽ **allowlist** route này.
- Hash mật khẩu: để sau. Đợt này chỉ chặn người lạ đọc cột `password`, không đổi cách lưu.

---

## 1. Bảng Ảnh hưởng chéo (mục 4.1 CLAUDE.md)

| Hạng mục | Phía KTV | Phía Quản lý | Dùng chung | Kết luận |
|---|---|---|---|---|
| **Phase B — middleware 401** | Mọi `app/api/ktv/*` trừ `ktv/booking` bắt buộc có cookie JWT. KTV đăng nhập trước khi có auto-heal phải **đăng nhập lại một lần** | Mọi `app/api/{admin,finance,reception,…}` cũng vậy | `middleware.ts`, `lib/auth-server.ts` | Sửa — bật bằng cờ `AUTH_ENFORCE_API=1`, deploy 2 bước |
| **Phase B — helper fail-closed** | `ktv/attendance` (gồm gia hạn ca), `attendance/status`, `handover/skip`, `accept-order`, `discipline/reject-order` sẽ trả 401 nếu không có session | 21 file gọi `requirePermission` (settings hệ thống, dispatch actions, staff lock, …) sẽ throw `Unauthorized` thay vì cho qua | `lib/auth-server.ts` | Sửa — cùng cờ |
| **Phase B — guard actions.ts** | Không ảnh hưởng — KTV không gọi các action admin/quầy | Trang Roles, Employees, Service menu, Customer reminders, Web-booking, Dispatch, Feedback kiosk: chỉ user đúng vai gọi được | `getSupabaseAdmin` | Sửa |
| **Phase B — gỡ route debug** | `ktv/debug_nh007` mất | `debug*`, `setup-deposit`, `customers/clean-dummy` mất | — | Không ảnh hưởng — 0 chỗ trong UI gọi |
| **Phase C — số liệu tiền** | Ví KTV (`KtvWalletService`, `wallet/timeline`, `history`) **đã loại** chặng voided → không đổi | `finance/reports`, `hourly-details`, `raw-data`, `ktv-ranking`, `time-analysis` hiện **vẫn chia** cho người bị đổi ra → sửa để bằng phía KTV | `KtvCommissionService.isKtvVoidedOnItem`, `calculateItemDuration` | Lệch → Khớp sau sửa |
| **Phase C — KTV ngoài** | Ledger đã tính Loại C | Báo cáo tính Loại A vì bỏ `EXT_*` khỏi map | `isPlaceholderStaffId` | Lệch → Khớp sau sửa |
| **Phase D** | Giờ Loại D được reset đầu tháng (đúng như thiết kế nhưng chưa từng chạy) | Bảng xếp hạng giờ đầu tháng bắt đầu từ 0 | `KtvTypeDTurnService.getMonthlyHoursBreakdown` | Sửa |
| Realtime / refresh | Không đổi kênh nào | Không đổi | — | Đồng bộ |
| Quyền xem | KTV chỉ thao tác được mã của mình (sau bật cờ) | Admin/quầy thấy như cũ; cột `password` vẫn về trang Roles (hash để sau) | — | Không lộ thêm dữ liệu; **giảm** lộ ở `GET /api/employees` |

---

## Phase A — Vệ sinh repo (Mức 0)

Toàn bộ là file untracked hoặc `git rm --cached`; không đổi hành vi app.

```bash
# A1. Xoá bản sao " 2.*" do macOS tạo (tổng ~80 file). Đã kiểm tra:
#   - lib/services/KtvDLedgerWriter 2.ts  = bản v1 CŨ, không ai import
#   - lib/services/KtvTypeDBonusService 2.ts = byte-identical bản gốc
#   - app/api/ktv/wallet/access/route 2.ts = còn đọc SUPABASE_SERVICE_ROLE_KEY (legacy)
#   - supabase/migrations/* 2.sql (12 file) = trùng migration đã có → `supabase db push` sẽ chạy 2 lần
git status --short | grep '^??' | grep ' 2\.' | sed 's/^?? //; s/"//g' | while IFS= read -r f; do rm -v "$f"; done
rm -rv "supabase/.temp/linked-project 2.json" "supabase/.temp/pooler-url 2" "supabase/.temp/project-ref 2" \
       "supabase/.temp/rest-version 2" "supabase/.temp/storage-version 2" 2>/dev/null

# A2. Untrack supabase/.temp (CLI cache, đã có project-ref) — KHÔNG xoá file local
git rm -r --cached supabase/.temp
printf '\n# Supabase CLI cache\nsupabase/.temp/\n' >> .gitignore

# A3. Script rời ở gốc: .gitignore đã có pattern (check_*.js, fix_*.js, tmp_*.js…) nhưng file được commit TRƯỚC khi thêm pattern nên vẫn tracked.
#     Đề xuất: gom vào scripts/legacy/ thay vì xoá, để còn tra lại.
mkdir -p scripts/legacy
git ls-files | grep -E '^[^/]+\.(js|mjs|py|sql|json)$' \
  | grep -vE '^(package|package-lock|tsconfig|next\.config|tailwind\.config|postcss\.config|vercel|\.eslintrc|middleware|next-env|metadata)' \
  | xargs -I{} git mv "{}" scripts/legacy/
# Giữ nguyên ở gốc: supabase_types.ts, verify_*.ts, simulate_ktv_discipline.ts (đang được package.json / doc tham chiếu — kiểm tra trước khi mv)

# A4. Tài liệu ở gốc → plans/
git mv BAO_CAO_UI_GALLERY_UPLOAD_THEO_PHUONG_PHAP.md DYNAMIC_ADMIN_CURRENT_STATE_AND_TRANSFORMATION_PLAN.md \
       FINAL_NHP_NHT_GALLERY_HANDOFF.md FINAL_SHIFT_EXTENSION_PATCH.md FLOW_2_ANH_BAT_DAU_DICH_VU.md \
       READY_TO_PASTE_SHIFT_EXTENSION_PROMPT.md WEBBOOKING_LEGACY_KEY_MIGRATION_PLAN.md \
       WEBBOOKING_LEGACY_KEY_MIGRATION_PROPOSED.patch plans/   # (các file này đang untracked → dùng mv thường)
rm -v ".env (1).local"
```

**Không đụng:** `supabase/migrations/20260929230000_ktv_start_release_atomic_root.sql`, `plans/root_sequential_audit_20260929/`, `repomix-output.md` (6 MB — hỏi user có cần giữ).

Sau A: `npx tsc --noEmit` phải vẫn pass (tsconfig include `**/*.ts` nên các file " 2.ts" biến mất là tốt).

---

## Phase B — Lớp auth (Mức 2)

### B0. Nguyên tắc rollout: một cờ, hai bước

Thêm env `AUTH_ENFORCE_API` (mặc định **tắt**). Khi tắt, mọi hành vi giữ nguyên hôm nay (chỉ log). Khi bật (`=1`): middleware trả 401, hai helper fail-closed.

- **Bước 1** (deploy code, cờ tắt): theo dõi log Vercel `[Middleware] Unauthorized API call to …` trong 2–3 ngày làm việc. Nếu còn route/người dùng hợp lệ bị log → xử lý trước.
- **Bước 2**: đặt `AUTH_ENFORCE_API=1` trên Vercel → redeploy. Lùi: xoá biến → redeploy, **không cần revert code**.

Lý do không bật thẳng: login đã có auto-heal cấp JWT (`app/login/actions.ts:76-100`), nhưng phiên đăng nhập **trước** khi auto-heal lên có thể chưa có cookie; PWA KTV giữ phiên rất lâu.

### B1. `middleware.ts`

```diff
+// Route không cần session: tự xác thực bằng secret riêng hoặc được phép mở.
+const PUBLIC_API_PREFIXES = [
+  '/api/auth',
+  '/api/cron',                          // requireCronAuth (CRON_SECRET)
+  '/api/notifications/trigger-webhook', // x-webhook-secret
+  '/api/notifications/push',            // x-webhook-secret
+  '/api/ktv/booking',                   // điều phối — cho phép mở (quyết định 30/09/2026)
+  '/api/customers/identify',            // WebBooking gọi từ ngoài — CẦN XÁC NHẬN
+  '/api/resend-email',                  // không có caller trong repo — CẦN XÁC NHẬN
+];
+const AUTH_ENFORCE = process.env.AUTH_ENFORCE_API === '1';
+
 export async function middleware(request: NextRequest) {
   ...
-  if (request.nextUrl.pathname.startsWith('/api/') && !request.nextUrl.pathname.startsWith('/api/auth')) {
-    if (!user) {
-      console.warn(`[Middleware] Unauthorized API call to ${request.nextUrl.pathname} (Compatibility Phase - Allowed)`);
-    }
-  }
+  const path = request.nextUrl.pathname;
+  const isProtectedApi = path.startsWith('/api/') && !PUBLIC_API_PREFIXES.some(p => path.startsWith(p));
+  if (isProtectedApi && !user) {
+    if (AUTH_ENFORCE) {
+      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
+    }
+    console.warn(`[Middleware] Unauthorized API call to ${path} (AUTH_ENFORCE_API off - allowed)`);
+  }
   return supabaseResponse
 }
```

Hai dòng "CẦN XÁC NHẬN": nếu WebBooking / hệ thống ngoài không gọi `customers/identify` và `resend-email` thì bỏ khỏi allowlist. Nếu có gọi, đợt sau thêm `x-api-key` cho chúng.

### B2. `lib/auth-server.ts` — hai helper fail-closed

```diff
+const AUTH_ENFORCE = process.env.AUTH_ENFORCE_API === '1';
+
+const unauthorizedJson = () => Response.json(
+    { success: false, error: 'Unauthorized' }, { status: 401 }
+);
+const lockedJson = () => Response.json(
+    { success: false, error: 'ACCOUNT_LOCKED' }, { status: 423 }
+);

 export async function requirePermission(permissionId: string) {
     const bUser = await requireBusinessUser();

     if (!bUser) {
-        // 🔄 Compatibility Phase: ...
-        console.warn(`[AuthServer] ⚠️ Compatibility Phase: No JWT session for permission '${permissionId}'. Allowing through.`);
-        return true;
+        if (AUTH_ENFORCE) throw new Error('Unauthorized');
+        console.warn(`[AuthServer] ⚠️ No JWT session for permission '${permissionId}' (AUTH_ENFORCE_API off - allowed)`);
+        return true;
     }
     ...
 }

 export async function requireStaffMatches(claimedStaffId: string) {
     let bUser: Awaited<ReturnType<typeof requireBusinessUser>> = null;
     try {
         bUser = await requireBusinessUser();
-    } catch {
-        return null;   // Compatibility Phase: chưa map được business user
+    } catch (e: any) {
+        // Tài khoản bị khoá phải bị chặn ở đây — trước đây bị nuốt chung với lỗi map.
+        if (e?.message === 'ACCOUNT_LOCKED') return lockedJson();
+        if (AUTH_ENFORCE) return unauthorizedJson();
+        return null;
     }

     const sessionId = bUser?.techCode || bUser?.businessUserId;
-    if (!sessionId) return null;
+    if (!sessionId) return AUTH_ENFORCE ? unauthorizedJson() : null;
     ...
 }
```

Lưu ý: `requireBusinessUser` ném `ACCOUNT_LOCKED` cho KTV bị khoá; `requireStaffMatches` hiện nuốt lỗi này → KTV bị khoá vẫn gọi được `handover/skip`, `accept-order`. Diff trên sửa luôn, **không phụ thuộc cờ**.

Các route gọi `requirePermission` trong `try/catch` (VD `admin/settings/system/route.ts`) đã map `message === 'Unauthorized'` → 401. Với 21 file caller cần rà nhanh: file nào chưa map thì thêm 3 dòng chuẩn:

```ts
if (e?.message === 'Unauthorized') return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
if (e?.message === 'Forbidden')    return NextResponse.json({ success: false, error: 'Forbidden' },    { status: 403 });
if (e?.message === 'ACCOUNT_LOCKED') return NextResponse.json({ success: false, error: 'ACCOUNT_LOCKED' }, { status: 423 });
```

### B3. Guard 8 file `actions.ts` (server action gọi được bằng action-id, middleware không che)

Dùng helper **đã fail-closed sẵn** `requireRole` / `requireBusinessUser` (không phụ thuộc cờ — admin/quầy đăng nhập qua auto-heal nên có JWT).

| File | Hàm | Guard thêm ở đầu hàm |
|---|---|---|
| `app/admin/roles/actions.ts` | `getAllUsers`, `getRolePermissions`, `verifyAdminPassword`, `saveRolePermissions`, `updateUserRole`, `updateUserPermissions` | `await requireRole(['ADMIN', 'DEV']);` |
| `app/admin/employees/actions.ts` | `getStaffList`, `createStaffMember`, `updateStaffMember`, `deleteStaffMember`, `updateEmployeeRole` | `await requireRole(['ADMIN', 'DEV', 'MANAGER']);` |
| `app/admin/service-menu/actions.ts` | `updateService`, `updateServiceBulkSync`, `createService` | `await requireRole(['ADMIN', 'DEV', 'MANAGER']);` — `getServices` chỉ cần `requireBusinessUser()` non-null |
| `app/admin/customer-reminders/actions.ts` | 4 hàm | `await requireRole(['ADMIN', 'DEV', 'MANAGER']);` |
| `app/reception/web-booking/actions.ts` | `getWebBookings`, `confirmWebBooking`, `rejectWebBooking`, `getNewWebBookingCount` | `await requirePermission('dispatch_board'); if (!(await requireBusinessUser())) throw new Error('Unauthorized');` (đúng mẫu `dispatch/actions.ts:101,586`) |
| `app/reception/dispatch/actions.ts` | Các hàm **chưa** có `requirePermission` (rà từng hàm export: `cancelBooking`, `updateBookingStatus`, `updateBookingItemStatus`, `submitCustomerRating`, `splitBookingItem`, `updateBookingMeta`, `rename*`, `unmergeServicesAction`, `submitGuestRating`, …) | Cùng mẫu trên. **Chỉ thêm guard, không đổi logic** (file thuộc khu vực Dispatch Mức 2) |
| `app/reception/feedback/_components/actions.ts` | `submitFeedbackAction` | `if (!(await requireBusinessUser())) throw new Error('Unauthorized');` — kiosk chạy trên máy quầy đã đăng nhập |
| `app/login/actions.ts` | `updatePasswordInDB(userId, newPassword)` | `const u = await requireBusinessUser(); if (!u || u.businessUserId !== userId) throw new Error('Forbidden');` — chỉ đổi mật khẩu của chính mình. `authenticateUser` giữ nguyên (là login) |

Mẫu diff (áp cho mọi hàm trong bảng):

```diff
+import { requireRole } from '@/lib/auth-server';
 export async function saveRolePermissions(roles: { id: string, permissions: string[] }[]) {
     try {
+        await requireRole(['ADMIN', 'DEV']);
         const supabase = getSupabaseAdmin();
```

Client hiện đọc `{ success:false, error }` → thông báo "Unauthorized" hiện như lỗi thường. Đủ cho đợt này.

### B4. Route API tiền/quản lý chưa có auth — thêm guard theo vai

Middleware 401 chỉ chặn **người lạ**; các route dưới còn cần chặn **KTV gọi route của quầy/kế toán**.

| Route | Guard |
|---|---|
| `finance/withdrawals/[id]` PATCH (duyệt rút tiền) | `requirePermission('payroll_commissions')` + `requireBusinessUser` non-null; **`adminId` lấy từ session**, bỏ đọc từ body |
| `finance/payroll/override`, `finance/adjustment` | như trên |
| `finance/reports/*` (9 route), `finance/ktv-summary`, `finance/ktv-bonus-summary` | `requirePermission('revenue_reports')` + non-null |
| `ktv/wallet/withdraw` POST | `const r = await requireStaffMatches(body.techCode); if (r) return r;` |
| `ktv/wallet/balance`, `wallet/access`, `wallet/timeline`, `bonus/*` GET | `requireStaffMatches(techCode)` — nếu quầy cũng gọi các route này để xem ví KTV thì thay bằng: khớp mã **hoặc** có `payroll_commissions` |
| `ktv/attendance/confirm` PATCH (duyệt chấm công) | `requirePermission('ktv_hub')` + non-null |
| `ktv/leave` POST/PATCH/DELETE | `requireStaffMatches(employeeId)` |
| `employees` GET | `requireApiUser` non-null **và bỏ `password` khỏi select** — CẦN XÁC NHẬN không có UI nào đọc password từ route này (grep trong repo: không thấy) |
| `admin/cleanup-shifts`, `admin/update-wifi-ip`, `support/room-matrix` DELETE, `support/*` DELETE | `requireRole(['ADMIN','DEV','MANAGER'])` |

### B5. Gỡ route debug (0 tham chiếu UI)

```bash
git rm -r app/api/debug app/api/debug-svc-map app/api/debug-data app/api/ktv/debug_nh007 app/api/setup-deposit app/api/customers/clean-dummy
```

### B6. Siết 2 route upload public

`app/api/customers/upload-avatar/route.ts`, `app/api/support/tasks/upload/route.ts`: thêm `requireApiUser` non-null; MIME allowlist `image/jpeg|png|webp`; giới hạn 5 MB; tên file lấy đuôi **từ MIME**, không từ `file.name`. Copy đúng logic magic-bytes đã có ở `admin/employees/upload-avatar/route.ts` (đã làm tốt) — tách thành `lib/upload-guard.ts` để 4 route dùng chung.

---

## Phase C — Báo cáo tài chính (Mức 2)

### C1. Một nguồn cho "ai còn quyền lợi trên item"

Thêm vào `lib/services/KtvCommissionService.ts`:

```ts
/**
 * KTV còn quyền lợi trên item = có trong technicianCodes và chặng KHÔNG voided.
 * technicianCodes cố ý giữ cả người bị đổi ra để truy vết (CLAUDE.md mục 13.3),
 * nên mọi phép chia tiền/tip/phút theo "số KTV" phải chia theo danh sách này.
 */
static activeTechs(item: any): string[] {
    const techs: string[] = Array.isArray(item?.technicianCodes) ? item.technicianCodes : [];
    return techs
        .map((t) => String(t || '').trim())
        .filter((code) => code && !this.isKtvVoidedOnItem(item, code));
}
```

### C2. Sửa 5 route báo cáo — cùng một mẫu

`app/api/finance/reports/route.ts:544-556`

```diff
             const techs = Array.isArray(i.technicianCodes) ? i.technicianCodes : [];
-            if (techs.length === 0) return;
+            const activeTechs = KtvCommissionService.activeTechs(i);
+            if (activeTechs.length === 0) return;
             const qty = Number(i.quantity) || 1;
-            techs.forEach((tc: string) => {
-                const code = tc.trim();
-                if (!code) return;
+            activeTechs.forEach((code: string) => {
                 const fallbackDuration = svcDurationMap[String(i.serviceId)] || 60;
                 let actualMins = KtvCommissionService.calculateItemDuration(i, code, fallbackDuration);
-                let myTotalMins = actualMins > 0 ? actualMins : (fallbackDuration / techs.length);
+                let myTotalMins = actualMins > 0 ? actualMins : (fallbackDuration / activeTechs.length);
                 ...
-                const perKtvTip = (Number(i.tip) || 0) / techs.length;
+                const perKtvTip = (Number(i.tip) || 0) / activeTechs.length;
```

`app/api/finance/reports/route.ts:768-775` (sheet raw): thay `i.technicianCodes.forEach` → `activeTechs.forEach`, mẫu số `activeTechs.length`.

`hourly-details/route.ts:70-77` và `raw-data/route.ts:64-71` — hiện lấy `technicianCodes[0]` rồi **nhân `length`** (sai cả khi không voided nếu 2 KTV khác loại):

```diff
-                        const ktvCode = i.technicianCodes[0];
-                        const workType = ktvWorkTypeMap[ktvCode] || 'TYPE_A';
-                        const myTotalMins = KtvCommissionService.calculateItemDuration(i, ktvCode, dur) || (dur / i.technicianCodes.length);
-                        commission = KtvCommissionService.calcCommission(myTotalMins, commConfigs, workType, i.serviceId) * (Number(i.quantity) || 1) * i.technicianCodes.length;
+                        const activeTechs = KtvCommissionService.activeTechs(i);
+                        for (const code of activeTechs) {
+                            const workType = ktvWorkTypeMap[code] || 'TYPE_A';
+                            const mins = KtvCommissionService.calculateItemDuration(i, code, dur) || (dur / activeTechs.length);
+                            commission += KtvCommissionService.calcCommission(mins, commConfigs, workType, i.serviceId) * (Number(i.quantity) || 1);
+                        }
```

`ktv-ranking/route.ts:280-356`: `ktvs = KtvCommissionService.activeTechs(item)`; `tipPerKtv = tip / ktvs.length`; `commissionMins = actualMins > 0 ? actualMins : fallback / ktvs.length`. Lượt VIP và rating chỉ đếm cho `ktvs` (đã lọc).

`time-analysis/route.ts:72-84`: `i.technicianCodes.forEach` → `activeTechs.forEach`; mẫu số `activeTechs.length`.

### C3. KTV ngoài `EXT_*` (B7) — `app/api/finance/reports/route.ts:124-131`

```diff
         (staffData || []).forEach((s: any) => {
             const sid = s.id ? String(s.id).trim() : '';
-            if (!sid || sid === 'ADMIN' || sid === 'dev' || isPlaceholderStaffId(sid)) return;
+            if (!sid || sid === 'ADMIN' || sid === 'dev') return;
+            if (isPlaceholderStaffId(sid)) {
+                // KTV ngoài không tài khoản: ledger tính theo Loại C → báo cáo phải cùng loại.
+                staffWorkTypeMap[sid] = 'TYPE_C';
+                if (s.full_name) staffNameMap[sid] = s.full_name.trim();
+                return; // không vào activeStaffIds → không hiện ở bảng xếp hạng KTV nội bộ
+            }
```

CẦN XÁC NHẬN: có muốn KTV ngoài **hiện** trong danh sách KTV của báo cáo (nhãn "KTV ngoài") hay chỉ cần đúng tiền tổng? Diff trên chọn "đúng tiền, không hiện".

### C4. Mô phỏng bắt buộc (mục 4.3 / 10)

`scripts/qa/qa_19_report_voided_and_ext.ts` — mock, không chạm DB:
- Item 1: 2 KTV `T001`, `T002`; `T002` có `segments[].voided = true`; `tip = 100_000`; không có `actualStartTime` (ép fallback).
- Item 2: 1 KTV `EXT_abc123`, 60 phút.
- In bảng: `KTV | phía ví (KtvWalletService logic) | phía báo cáo (hàm sau sửa) | khớp?`.
- Kỳ vọng: `T002` = 0đ / 0 tip cả 2 phía; `T001` nhận trọn fallback và trọn tip; `EXT_*` tính theo `commConfigs.TYPE_C`.
- Chạy thêm `TZ=UTC`.

---

## Phase D — `reset-type-d-hours` nhận GET (Mức 2 vì đụng giờ Loại D)

`app/api/cron/reset-type-d-hours/route.ts`

```diff
 export async function POST(request: Request) {
     ...
 }
+
+// Vercel Cron gọi bằng GET (vercel.json "0 17 1 * *"). Route chỉ có POST → 405 mỗi tháng.
+export async function GET(request: Request) {
+    return POST(request);
+}
```

Kiểm tra trước khi merge: tháng 09/2026 đã reset chưa? Nếu chưa → sau deploy gọi tay `POST` với `CRON_SECRET` một lần cho tháng trước (route dùng `getMonth()` giờ server UTC — mốc "tháng trước" tính lúc 00:00 VN ngày 2 nên vẫn đúng; **không sửa** trong đợt này theo phạm vi).

Cùng lỗi ở `cleanup-storage`, `auto-approve`, `guest-arrival-sweep` (POST-only, không có trong `vercel.json`): **không đụng** — chúng không được schedule nên không phải bug đang chạy sai.

---

## Phase E — Gom hoa hồng A/B/C (thiết kế, CHỜ XÁC NHẬN)

Hiện có 6 bản chép với luật khác nhau (trạng thái đếm là xong, loại dịch vụ tiện ích, `checkIsItemPassed`, phút fallback). Đề xuất:

```ts
// lib/services/KtvCommissionService.ts
static computeBookingCommission(
    booking: any, staffId: string,
    ctx: { commConfigs; workType; svcDurationMap; svcUtilityMap; doneStatuses?: string[] }
): { passed: number; held: number; tip: number; passedItemCount: number }
```

- Bản gốc = logic trong `KtvWalletService.ts:120-163` (đã đúng voided, utility, passed).
- 6 nơi gọi lại: `KtvWalletService`, `ktv/wallet/timeline`, `finance/ktv-summary`, `cron/sync-daily-ledger`, `finance/reports/ktv-ranking`, `ktv/history`.
- Điểm phải chốt nghiệp vụ **trước khi code**: (1) CLEANING/FEEDBACK có tính là "xong" cho ví không (timeline hiện không, ví service hiện có); (2) bonus `isNewRule` dùng chung hằng `BONUS_NEW_RULE_FROM = '2026-08-05'` ở `lib/constants`.
- Mô phỏng: cùng 1 KTV + 1 ngày, in 6 số trước/sau → phải bằng nhau.

Ước lượng: 1 phiên riêng, plan riêng. Không gộp vào đợt này nếu chưa chốt (1).

---

## Thứ tự thực hiện & kiểm tra

1. **A** → `tsc` pass → commit `chore(repo): don file trung " 2", untrack supabase/.temp, gom script cu vao scripts/legacy`.
2. **B1 + B2 + B5 + B6** (cờ tắt) → `tsc` → thử tay: đăng nhập admin, KTV, quầy; gọi `curl` không cookie tới `/api/finance/reports` (phải vẫn qua khi cờ tắt, log warn) → commit `security(auth): them co AUTH_ENFORCE_API, helper fail-closed, go route debug`.
3. **B3 + B4** → `tsc` → thử tay trang Roles/Employees/Service menu/Web-booking/Dispatch/Kiosk feedback với đúng vai và với KTV → commit `security(auth): guard server actions va route tien theo vai`.
4. **C** → viết `qa_19` → chạy, chạy `TZ=UTC` → commit `fix(finance-reports): khong chia tien cho ktv bi doi ra, ktv ngoai tinh loai C`.
5. **D** → commit `fix(cron): reset-type-d-hours nhan GET de vercel cron chay duoc`.
6. Deploy bước 1 (cờ tắt) → theo dõi log 2–3 ngày → bật `AUTH_ENFORCE_API=1`.
7. Cập nhật `TableInSupabase.md`: sửa mô tả `Users.password` (hiện ghi "hashed" — sai); bổ sung 2 migration sau 22/09.

Mỗi commit đều kèm bảng **Cảnh báo vận hành** (mục 5.1) trước khi commit. Bản nháp cho commit lớn nhất:

> ⚠️ **Ảnh hưởng vận hành — bật `AUTH_ENFORCE_API=1`**
>
> | Ai | Khác gì so với hôm nay | Cần báo / hướng dẫn gì |
> |---|---|---|
> | Quầy | Máy quầy đăng nhập từ lâu có thể bị 401 khi mở sổ điều phối → đăng xuất/đăng nhập lại 1 lần | Báo trước 1 ngày: "sáng mai đăng nhập lại" |
> | KTV | PWA giữ phiên cũ có thể bị 401 ở chấm công, ví, lịch (điều phối `ktv/booking` **không** bị) → đăng nhập lại 1 lần | Nhắn nhóm KTV; quầy hỗ trợ ai không vào được |
> | Admin / khác | Trang Roles/Employees chỉ ADMIN/DEV/MANAGER dùng được; route debug biến mất | Ai đang dùng link debug thì báo |
>
> **Rủi ro & cách lùi:** xoá biến `AUTH_ENFORCE_API` trên Vercel → redeploy; không có dữ liệu ghi cần lùi.
> **Deploy:** cần thêm env `AUTH_ENFORCE_API` (bước 2); không có migration.

---

## Quyết định của user (30/09/2026)

1. `customers/identify`, `resend-email`: **không** bị hệ ngoài gọi, nhưng user chưa muốn quyết định → **giữ trong allowlist** (không đổi so với hôm nay), ghi chú chờ.
2. Cột `password`: admin cần đọc được → **không bỏ**. `getAllUsers` guard `requireRole(['ADMIN','DEV'])`; `GET /api/employees` cần đăng nhập, chỉ trả `password` khi vai ADMIN/DEV.
3. Ví KTV: quầy không xem; admin/dev hoặc ai được gán trong matrix phân quyền → guard "khớp mã của mình **hoặc** có permission module ví/hoa hồng".
4. KTV ngoài: **hiện** trong danh sách KTV của báo cáo (C3 sửa: thêm vào `activeStaffIds`).
5. Phase E: **tách riêng**, lập báo cáo riêng sau. Không làm trong đợt này.
6. `repomix-output.md`: giữ local, **không commit** → `git rm --cached` + `.gitignore`.

---

## Trạng thái thực hiện (30/09/2026, cùng ngày)

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| A | ✅ Xong — đang **staged** | 127 script gốc → `scripts/legacy/`; untrack `supabase/.temp`, `repomix-output.md`; xoá ~85 bản sao " 2.*" (gồm 12 migration trùng, 2 thư mục rỗng trong `app/`); 8 doc → `plans/`. **Không đụng** migration atomic root & `plans/root_sequential_audit_20260929/`. |
| B1 | ✅ | `middleware.ts`: cờ `AUTH_ENFORCE_API`, allowlist 7 prefix (gồm `/api/ktv/booking`, `customers/identify`, `resend-email` chờ quyết định). |
| B2 | ✅ | `lib/auth-server.ts`: `requirePermission` fail-closed theo cờ; `requireStaffMatches` → `requireStaffOrPermission(claimed, permission)`; ACCOUNT_LOCKED luôn bị chặn (423), không theo cờ; thêm `authErrorResponse(e)`. |
| B3 | ✅ | 8 file `actions.ts` — 2 điều chỉnh sau impact check: `getStaffList`/`updateStaffMember` được quầy gọi từ ktv-hub → `requirePermission('ktv_hub')`; 6 wrapper dispatch không có try → lỗi ném thẳng ra client khi bật cờ. |
| B4 | ✅ | 30 handler ở 26 route. Ví KTV: `requireStaffOrPermission(techCode, 'finance_management')`. `withdrawals` PATCH: `processed_by` lấy từ session. `employees` GET: `password` chỉ trả cho ADMIN/DEV. `support/room-matrix` POST và `support/tasks/rework` POST: `requirePermission('support_tasks_admin')` (chỉ trang admin support gọi — làm nốt theo yêu cầu user). |
| B5 | ✅ | Gỡ 7 file route debug/one-off. |
| B6 | ✅ | `lib/upload-guard.ts` (MIME + magic bytes + 5MB); 2 route upload public dùng chung; 2 route admin cũ giữ nguyên. |
| C | ✅ | `KtvCommissionService.activeTechs`; 8 route `finance/reports/*` guard `revenue_reports`; 5 route chia tiền/tip/phút theo `activeTechs`; `EXT_*` → `TYPE_C` và **hiện** trong danh sách. `qa_19` PASS (local + TZ=UTC), đã thêm vào `test:qa`. Bỏ dòng ghi `ktv_error_log.txt` trong ktv-ranking (fs Vercel read-only). |
| D | ✅ | `reset-type-d-hours` thêm `GET`. Cần kiểm tra tháng 09/2026 đã chốt chưa. |
| E | ⏸ | Tách riêng, báo cáo riêng. |
| Doc | ✅ | `TableInSupabase.md`: sửa `Users.password`, thêm `Services.strengthConfig`. |

**Kiểm tra:** `tsc --noEmit` EXIT 0 (sau A, sau toàn bộ). `npm run lint` hỏng sẵn trên nhánh (ESLint 9 thiếu `eslint.config.js`) — không liên quan.

**Phát hiện thêm — ĐÃ SỬA theo yêu cầu user:**
- `FinanceReportService.getBaseData` đọc `Staff.code`/`Staff.role` (2 cột không tồn tại) → `ktvWorkTypeMap` rỗng → `hourly-details` và `raw-data` tính **mọi KTV** theo TYPE_A. Sửa: select `id, full_name, work_type, status`, key theo `id`, `EXT_*` → TYPE_C. Chỉ `ktvWorkTypeMap` được tiêu thụ (2 route), `employeeMap`/`allKTV` không ai dùng.

### Rà soát phạm vi sau khi làm (30/09/2026, theo yêu cầu user)

- **Sửa thêm sau rà:** guard `ktv/attendance/confirm`, `getStaffList`/`updateStaffMember` từng đòi `ktv_hub`, nhưng màn ktv-hub của quầy mở bằng `ktv_attendance` / `turn_tracking` (`app/reception/ktv-hub/page.tsx:1512`). Nhánh Forbidden của `requirePermission` KHÔNG phụ thuộc cờ → quầy có session mà thiếu `ktv_hub` trong DB sẽ bị 403 ngay. Thêm `requirePermissionAny([...])` trong `lib/auth-server.ts` và dùng đúng bộ id của màn.
- `leave_management`, `turn_tracking` không có trong `MODULES` nhưng là id mà chính trang quầy đang kiểm tra (`LeaveManagement.logic.ts:92`, `ktv-hub/page.tsx:1512`) và nằm trong fallback của reception ở cả client lẫn server → guard dùng cùng id với trang nên không tạo thêm trường hợp bị chặn mới.
- **Ngoài plan nhưng đã làm (nhỏ, công khai):** `ktv-ranking/route.ts` bỏ dòng ghi `ktv_error_log.txt` bằng `fs` (Vercel read-only, throw trong catch che lỗi thật) và không trả `error.stack` ra client nữa.
- **Không đụng:** migration atomic root, `plans/root_sequential_audit_20260929/`, B3 (cron 02:00), B8 (ảnh 7 ngày), `/api/ktv/booking`, hash mật khẩu, 18 file user sửa dở trước đó (vẫn nguyên trong working tree), 2 route admin upload cũ.
