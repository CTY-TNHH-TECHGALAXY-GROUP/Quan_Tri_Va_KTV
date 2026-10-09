import type { TaskState } from '../SupportEmployeeTasks.logic';

// 🔧 UI CONFIGURATION — one colour per task state, shared by every piece of the screen.
export const STATE_PILL: Record<TaskState, string> = {
  OFFERED: 'bg-violet-100 text-violet-700',
  TODO: 'bg-stone-100 text-stone-600',
  DOING: 'bg-amber-100 text-amber-800',
  WAITING: 'bg-sky-100 text-sky-700',
  FIX: 'bg-rose-100 text-rose-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  BLOCKED: 'bg-purple-100 text-purple-700',
  DECLINED: 'bg-stone-200 text-stone-500',
  CANCELLED: 'bg-stone-200 text-stone-500',
};

export const STATE_DOT: Record<TaskState, string> = {
  OFFERED: 'bg-violet-500',
  TODO: 'bg-stone-300',
  DOING: 'bg-amber-500',
  WAITING: 'bg-sky-500',
  FIX: 'bg-rose-500',
  APPROVED: 'bg-emerald-500',
  BLOCKED: 'bg-purple-500',
  DECLINED: 'bg-stone-400',
  CANCELLED: 'bg-stone-400',
};

/** Order of the segments in the progress bar. */
export const BAR_ORDER: TaskState[] = ['APPROVED', 'WAITING', 'FIX', 'BLOCKED', 'DOING', 'OFFERED'];

/** Summary cards — colours taken from the approved artifact (sum-chip todo / pending / rejected / done). */
export const BUCKET_STYLE: Record<string, { card: string; num: string }> = {
  todo: { card: 'bg-white border-stone-300', num: 'text-stone-600' },
  waiting: { card: 'bg-[#DCE8F5] border-[#C9DDF0]', num: 'text-[#3E6FA6]' },
  fix: { card: 'bg-[#F3DFD7] border-[#EFC9BC]', num: 'text-[#8A3E29]' },
  approved: { card: 'bg-[#EEF8F0] border-[#BFE0C7]', num: 'text-[#2C7A46]' },
  offered: { card: 'bg-violet-50 border-violet-200', num: 'text-violet-700' },
  blocked: { card: 'bg-purple-50 border-purple-200', num: 'text-purple-700' },
};
