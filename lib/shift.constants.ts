import { phutTrongNgayLamViec } from './business-date';

export const SHIFT_TYPES = {
  SHIFT_1: { label: 'Ca 1', start: '09:00', end: '17:00' },
  SHIFT_2: { label: 'Ca 2', start: '11:00', end: '19:00' },
  SHIFT_3: { label: 'Ca 3', start: '17:00', end: '00:00' },
  DEV_SHIFT: { label: 'Ca Dev', start: '09:00', end: '21:00' },
  FREE: { label: 'Ca tự do', start: '00:00', end: '23:59' },
  REQUEST: { label: 'Làm khách yêu cầu', start: '00:00', end: '23:59' },
  SUPPORT: { label: 'Ca Hậu cần', start: '00:00', end: '23:59' },
  VIP: { label: 'Ca VIP', start: '00:00', end: '23:59' },
} as const;

export type ShiftTypeKey = keyof typeof SHIFT_TYPES;

export function addMinutesToTime(value: string, minutes: number) {
  const [hour, minute] = value.split(':').map(Number);
  const total = (hour * 60 + minute + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function hasReachedShiftEnd(endTime: string, currentTime: string, cutoffHours = 7): boolean {
  const end = phutTrongNgayLamViec(endTime, cutoffHours);
  const current = phutTrongNgayLamViec(currentTime, cutoffHours);
  return end !== null && current !== null && current >= end;
}

export async function resolveStaffShiftEndTimes(
  supabase: any,
  employeeIds: string[],
  date: string
): Promise<Record<string, string | null>> {
  if (!employeeIds || employeeIds.length === 0) return {};
  const result: Record<string, string | null> = {};

  const [attRes, regRes, shiftRes] = await Promise.all([
    supabase
      .from('KTVAttendance')
      .select('employeeId, estimatedEndTime')
      .in('employeeId', employeeIds)
      .eq('date', date)
      .eq('status', 'CONFIRMED')
      .eq('checkType', 'OVERTIME'),
    supabase
      .from('KTVTypeDDailyRegistration')
      .select('staff_id, expected_end_time')
      .in('staff_id', employeeIds)
      .eq('work_date', date),
    supabase
      .from('KTVShifts')
      .select('employeeId, shiftType, estimatedEndTime, status, effectiveFrom')
      .in('employeeId', employeeIds)
      .lte('effectiveFrom', date)
      .in('status', ['ACTIVE', 'REPLACED'])
      .order('effectiveFrom', { ascending: false })
      .order('createdAt', { ascending: false })
  ]);

  if (shiftRes.data) {
    for (const s of shiftRes.data) {
      if (!result[s.employeeId]) {
        const defaultEnd = s.shiftType && (SHIFT_TYPES as any)[s.shiftType]?.end ? (SHIFT_TYPES as any)[s.shiftType].end : null;
        result[s.employeeId] = s.estimatedEndTime || defaultEnd;
      }
    }
  }
  if (regRes.data) {
    for (const r of regRes.data) {
      if (r.expected_end_time) {
        result[r.staff_id] = r.expected_end_time.slice(0, 5);
      }
    }
  }
  if (attRes.data) {
    for (const a of attRes.data) {
      if (a.estimatedEndTime) {
        result[a.employeeId] = a.estimatedEndTime.slice(0, 5);
      }
    }
  }
  return result;
}
