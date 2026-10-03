-- Migration: luu TEN nguoi thu hoi phieu tru diem Office
-- Date: 2026-09-12
--
-- `revoked_by` chi luu MA (Staff.id, doi khi la UUID cua tai khoan admin khong
-- gan ma NV) nen lich su khong hien duoc "ai hoan diem". Snapshot ten giong
-- `created_by_name`: doi ten nhan vien sau nay khong lam sai lich su cu.

alter table "KTVOfficeScoreLog" add column if not exists revoked_by_name text;

-- Backfill cac phieu da thu hoi truoc day: tra ten tu Staff theo revoked_by.
-- Phieu nao khong tra duoc (tai khoan admin khong nam trong Staff) giu null,
-- UI hien "Quan ly (khong ro ten)".
update "KTVOfficeScoreLog" l
set revoked_by_name = s.full_name
from "Staff" s
where l.revoked_at is not null
  and l.revoked_by_name is null
  and l.revoked_by = s.id;
