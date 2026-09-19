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
