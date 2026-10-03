-- Migration: Create KTV Office Scoring tables
-- Date: 2026-09-04
-- Author: Antigravity

create table "KTVOfficeCriteria" (
  id            text primary key,          -- 'P1', 'T1', 'A1'...
  grp           text not null,             -- 'I' | 'II' | 'III'
  grp_label     text not null,
  label         text not null,
  points        numeric not null,
  requires_photo boolean not null default false,
  sort_order    int not null,
  is_active     boolean not null default true
);

-- Seed data for 18 criteria
insert into "KTVOfficeCriteria" (id, grp, grp_label, label, points, requires_photo, sort_order) values
('P1', 'I', 'Quy trình công việc', 'Trước tua (khi có đơn hàng)', 5, false, 1),
('P2', 'I', 'Quy trình công việc', 'Nhận tua & đón khách tại sảnh', 5, false, 2),
('P3', 'I', 'Quy trình công việc', 'Trong dịch vụ', 10, false, 3),
('P4', 'I', 'Quy trình công việc', 'Kết thúc dịch vụ', 5, false, 4),
('P5', 'I', 'Quy trình công việc', 'Sau dịch vụ — tại sảnh', 5, false, 5),
('P6', 'I', 'Quy trình công việc', 'Sau dịch vụ — tại phòng, bàn giao', 10, false, 6),
('T1', 'II', 'Thời gian làm việc', 'Bật app đúng giờ đã đăng ký', 7.5, false, 7),
('T2', 'II', 'Thời gian làm việc', 'Sẵn sàng nhận tua trong ca', 7.5, false, 8),
('T3', 'II', 'Thời gian làm việc', 'Tắt app kết thúc ngày làm việc', 7.5, false, 9),
('T4', 'II', 'Thời gian làm việc', 'Chuyên cần — đi làm đều', 7.5, false, 10),
('A1', 'III', 'Thái độ & Tác phong', 'Đồng phục', 3, true, 11),
('A2', 'III', 'Thái độ & Tác phong', 'Ngoại hình', 6, true, 12),
('A3', 'III', 'Thái độ & Tác phong', 'Tác phong & chuẩn mực chào hỏi', 6, true, 13),
('A4', 'III', 'Thái độ & Tác phong', 'Tinh thần đồng đội & hòa khí nội bộ', 3, true, 14),
('A5', 'III', 'Thái độ & Tác phong', 'Minh bạch kênh tương tác & báo cáo', 3, true, 15),
('A6', 'III', 'Thái độ & Tác phong', 'Trung thực & trách nhiệm nghề nghiệp', 3, true, 16),
('A7', 'III', 'Thái độ & Tác phong', 'Minh bạch tài chính & cấm thu lợi bất chính', 3, true, 17),
('A8', 'III', 'Thái độ & Tác phong', 'Bảo mật thông tin tuyệt đối', 3, true, 18);

create table "KTVOfficeScoreLog" (
  id              uuid primary key default gen_random_uuid(),
  staff_id        text not null references "Staff"(id),
  work_date       date not null,
  criteria_id     text not null references "KTVOfficeCriteria"(id),
  criteria_label  text not null,
  points_deducted numeric not null,
  note            text,
  photo_urls      jsonb default '[]'::jsonb,
  created_by      text not null references "Staff"(id),
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      text,
  revoke_reason   text
);

create unique index ux_office_once_per_day
  on "KTVOfficeScoreLog" (staff_id, work_date, criteria_id)
  where revoked_at is null;

create index ix_office_staff_month on "KTVOfficeScoreLog" (staff_id, work_date);
