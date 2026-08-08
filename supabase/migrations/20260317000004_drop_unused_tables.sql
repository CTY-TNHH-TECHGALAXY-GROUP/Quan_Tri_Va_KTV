-- Drop unused/legacy tables
-- Confirmed: no API routes or UI reference these tables

DROP TABLE IF EXISTS public."ReviewSelectedCriteria";
DROP TABLE IF EXISTS public."ReviewCriteria";
DROP TABLE IF EXISTS public."Reviews";
DROP TABLE IF EXISTS public."Categories";
DROP TABLE IF EXISTS public."MonthlyAttendanceSummary";
-- NOTE: DailyAttendance được giữ lại — dùng trong /reception/ktv-hub/page.tsx
