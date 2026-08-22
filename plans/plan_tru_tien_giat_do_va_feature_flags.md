# Kế hoạch: Trừ tiền giặt đồ & Refactor phạt nghỉ đột xuất với Feature Flags Per-Staff

> **Trạng thái**: ✅ ĐÃ DUYỆT & TRIỂN KHAI (27/05/2026)

## Tóm tắt yêu cầu đã chốt
1. **Trừ tiền giặt đồ (MỚI):** Mỗi lần KTV điểm danh → trừ 20K, chỉ 1 lần/ngày, chỉ KTV có flag.
2. **Phạt nghỉ đột xuất (REFACTOR):** Trừ trực tiếp vào WalletAdjustments thay vì tính trong Cron.
3. Cả 2 đều dùng `Staff.feature_flags` (per-staff), trừ vào `WalletAdjustments`.
4. Không ảnh hưởng Bonus Wallet hiện tại.

## Files đã thay đổi
- `migrations/20260527_add_feature_flags_staff.sql` — Migration SQL
- `app/api/ktv/attendance/route.ts` — Thêm Step 4.5 deductions
- `app/api/cron/sync-daily-ledger/route.ts` — Gỡ penalty logic cũ
- `app/api/ktv/wallet/balance/route.ts` — Gỡ penalty hiển thị cũ
- `app/api/admin/staff-features/route.ts` — API quản lý feature flags
- `app/admin/settings/features/page.tsx` — UI Admin quản lý tính năng
- `app/admin/settings/features/Features.logic.ts` — Logic hook
- `lib/types.ts`, `lib/constants.ts`, `components/layout/Sidebar.tsx` — Thêm module mới
- `TableInSupabase.md` — Cập nhật schema
