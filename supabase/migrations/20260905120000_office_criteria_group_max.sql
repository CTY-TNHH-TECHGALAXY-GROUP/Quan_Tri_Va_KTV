-- Migration: Trần điểm cho từng nhóm tiêu chí Office (Loại D)
-- Date: 2026-09-05
--
-- Quy chế chia 100 điểm/ngày thành 3 nhóm: I=40, II=30, III=30. Trước đây trần này
-- chỉ là tổng cộng lại của các tiêu chí, không ai đặt được — sửa điểm một tiêu chí là
-- lệch cơ cấu mà không có gì cảnh báo. Nay trần nằm trong DB và tổng điểm các tiêu chí
-- trong nhóm không được vượt nó.
--
-- Lưu cùng bảng, lặp lại theo từng dòng — giống cách `grp_label` đang làm — để không
-- phải thêm bảng chỉ vì 3 con số.

alter table "KTVOfficeCriteria" add column if not exists grp_max numeric;

-- Backfill: trần ban đầu = đúng tổng điểm đang áp dụng của nhóm (40 / 30 / 30).
update "KTVOfficeCriteria" c
set grp_max = s.total
from (
  select grp, sum(points) as total
  from "KTVOfficeCriteria"
  where is_active
  group by grp
) s
where c.grp = s.grp and c.grp_max is null;

-- Nhóm rỗng (mọi tiêu chí đều tắt) không có dòng nào trong bảng tổng ở trên.
update "KTVOfficeCriteria" set grp_max = 0 where grp_max is null;

alter table "KTVOfficeCriteria" alter column grp_max set not null;
alter table "KTVOfficeCriteria" add constraint ck_office_grp_max_nonneg check (grp_max >= 0);
