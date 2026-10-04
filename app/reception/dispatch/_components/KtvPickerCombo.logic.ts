import type { StaffData, TurnQueueData } from '../types';
import { isVisibleInKtvPicker } from '@/lib/attendance/dispatchCheckinGate';
import {
  isPlaceholderStaffId, findExternalKtvByName, externalKtvNameProblem, externalKtvNameKey, newExternalKtvToken,
} from '@/lib/constants/staff.constants';

export type PickerTurn = TurnQueueData & { staff?: StaffData };

// 🔧 UI CONFIGURATION
export const MAX_EXTERNAL_SUGGESTIONS = 8;

/**
 * Gõ ĐÚNG mã hoặc ĐÚNG tên rồi Enter → chọn được cả KTV chưa điểm danh (ẩn khỏi
 * danh sách) và KTV ngoài đã có. Thứ tự tra: sổ tua → KTV nhà ĐANG LÀM → KTV ngoài
 * (so không dấu, kể cả ĐÃ NGHỈ — gửi đơn sẽ bật lại, không sinh dòng trùng tên).
 * Dùng chung cho ô chọn A (QuickDispatchTable) và ô chọn B (KtvPickerCombo).
 */
export const pickKtvByExactInput = (term: string, turns: PickerTurn[], staffs: StaffData[]): string | null => {
  const same = (v?: string | null) => (v || '').toLowerCase().trim() === term;
  const hit = turns.find(t => t.status !== 'off' && (same(t.employee_id) || same(t.staff?.full_name)));
  if (hit) return hit.employee_id;
  const staff = staffs.find(st => st.status === 'ĐANG LÀM' && !isPlaceholderStaffId(st.id) && (same(st.id) || same(st.full_name)));
  if (staff) return staff.id;
  return findExternalKtvByName(term, staffs)?.id ?? null;
};

export type KtvPickerOptions = {
  /** KTV có trong sổ tua (A/B/D và loại C có tài khoản), đã lọc hiển thị + tìm kiếm. */
  turnRows: PickerTurn[];
  /** KTV ngoài không tài khoản (`EXT_`/`C_`) đang dùng. */
  externalRows: StaffData[];
  /** Tên vừa gõ, đã chuẩn hoá, nếu được phép thêm KTV ngoài mới. */
  newExternalName: string | null;
  /** Lý do không thêm được tên vừa gõ (trùng KTV nhà, quá dài...). */
  newExternalProblem: string | null;
};

/**
 * Danh sách cho ô chọn KTV B. Cùng luật với ô chọn A: sổ tua + nhóm KTV ngoài +
 * dòng "Thêm KTV ngoài". `requireWaiting` = chỉ KTV đang chờ (popup bàn giao trực
 * tiếp — người đang làm đơn khác không nhận B được). Mã đang chọn (`value`) luôn giữ.
 */
export function buildKtvPickerOptions(input: {
  turns: PickerTurn[];
  staffs: StaffData[];
  excludeIds: string[];
  value?: string;
  search: string;
  requireWaiting?: boolean;
}): KtvPickerOptions {
  const { turns, staffs, excludeIds, value, requireWaiting } = input;
  const term = input.search.toLowerCase().trim();
  const excluded = new Set(excludeIds.filter(Boolean));

  // Sắp theo vị trí sổ tua (thấp = tới lượt trước) — cùng thứ tự quầy nhìn trên sổ tua.
  const turnRows = turns
    .filter(t => !excluded.has(t.employee_id))
    .filter(t => t.employee_id === value || (isVisibleInKtvPicker(t) && (!requireWaiting || t.status === 'waiting')))
    .filter(t => !term || t.employee_id.toLowerCase().includes(term) || (t.staff?.full_name || '').toLowerCase().includes(term))
    .sort((a, b) => (Number(a.queue_position) || 0) - (Number(b.queue_position) || 0));

  const key = externalKtvNameKey(input.search);
  const externalRows = staffs
    .filter(st => isPlaceholderStaffId(st.id) && st.status === 'ĐANG LÀM' && !excluded.has(st.id) && st.id !== value)
    .filter(st => !key || externalKtvNameKey(st.full_name).includes(key))
    .slice(0, MAX_EXTERNAL_SUGGESTIONS);

  const typedName = input.search.trim();
  const matchesSomeone = typedName ? !!pickKtvByExactInput(term, turns, staffs) : false;
  const problem = typedName && !matchesSomeone ? externalKtvNameProblem(typedName, staffs) : null;
  const canAdd = !!typedName && !matchesSomeone && !problem;

  return {
    turnRows,
    externalRows,
    newExternalName: canAdd ? typedName : null,
    newExternalProblem: problem,
  };
}

/** Enter trong ô chọn: khớp đúng ai thì chọn người đó, không thì thêm KTV ngoài (nếu được). */
export function pickOnEnter(search: string, turns: PickerTurn[], staffs: StaffData[]): string | null {
  const typed = search.trim();
  if (!typed) return null;
  const exact = pickKtvByExactInput(typed.toLowerCase(), turns, staffs);
  if (exact) return exact;
  return externalKtvNameProblem(typed, staffs) ? null : newExternalKtvToken(typed);
}
