'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { StaffData } from '../types';
import { ktvDisplayLabel, isPlaceholderStaffId, newExternalKtvToken, normalizeExternalKtvName } from '@/lib/constants/staff.constants';
import { t as tCheckin } from '../CheckinConfirm.i18n';
import { fmtHours } from '@/lib/hours-format';
import { buildKtvPickerOptions, pickOnEnter, type PickerTurn } from './KtvPickerCombo.logic';

/**
 * Ô chọn KTV B cho đơn nối tiếp — cùng luật với ô chọn A: sổ tua (A/B/D, loại C có
 * tài khoản), nhóm "KTV ngoài (không tài khoản)" và dòng "➕ Thêm KTV ngoài: <tên>".
 * Trước 05/10/2026 ba chỗ chọn B đều là `<select>` chỉ liệt kê sổ tua nên không
 * chọn được KTV ngoài. Trả về mã KTV, hoặc token `NEW_EXT:<TÊN>` để máy chủ tạo mã.
 */
export function KtvPickerCombo({
  turns, staffs, excludeIds, value = '', onPick, placeholder, ariaLabel, requireWaiting = false, className = '',
}: {
  turns: PickerTurn[];
  staffs: StaffData[];
  excludeIds: string[];
  value?: string;
  onPick: (ktvId: string) => void;
  placeholder: string;
  ariaLabel: string;
  requireWaiting?: boolean;
  className?: string;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const options = useMemo(() => buildKtvPickerOptions({ turns, staffs, excludeIds, value, search, requireWaiting }),
    [turns, staffs, excludeIds, value, search, requireWaiting]);

  const workTypeOf = (id: string) =>
    turns.find(t => t.employee_id === id)?.staff?.work_type ?? staffs.find(st => st.id === id)?.work_type ?? (isPlaceholderStaffId(id) ? 'TYPE_C' : null);
  const nameOf = (id: string) => turns.find(t => t.employee_id === id)?.staff?.full_name ?? staffs.find(st => st.id === id)?.full_name;
  const currentLabel = value ? ktvDisplayLabel(workTypeOf(value), value, nameOf(value)) : '';

  const pick = (id: string) => { onPick(id); setSearch(''); setOpen(false); };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input type="text" aria-label={ariaLabel} value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const picked = pickOnEnter(search, turns, staffs);
          if (picked) pick(picked);
        }}
        placeholder={currentLabel || placeholder}
        className={`w-full min-h-[40px] rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs sm:text-sm font-bold outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 ${currentLabel ? 'placeholder:text-indigo-700 font-extrabold' : 'placeholder:text-gray-400 placeholder:italic'}`} />
      {open && (
        <div className="absolute z-50 mt-1 w-full max-w-[calc(100vw-2rem)] left-0 sm:min-w-[280px] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          <div className="max-h-52 space-y-0.5 overflow-y-auto p-1.5">
            {options.turnRows.map(turn => {
              const workType = turn.work_type || turn.staff?.work_type || 'TYPE_A';
              return (
                <div key={turn.employee_id} onClick={() => pick(turn.employee_id)}
                  className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs sm:text-sm font-bold text-gray-700 transition-all hover:bg-indigo-50 active:scale-[0.98]">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 flex-1 pr-2">
                    {workType !== 'TYPE_D' && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500 shrink-0">#{turn.check_in_order}</span>}
                    <span className="truncate">{ktvDisplayLabel(workType, turn.employee_id, turn.staff?.full_name)}</span>
                    {turn.checked_in_today === false && <span className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[8px] font-black leading-none text-amber-700">{tCheckin.notCheckedInTag}</span>}
                    {workType !== 'TYPE_A' && (
                      <span className={`rounded border px-1 py-0.5 text-[8px] font-black leading-none shrink-0 ${workType === 'TYPE_B' ? 'border-purple-200 bg-purple-100 text-purple-700' : workType === 'TYPE_D' ? 'border-indigo-200 bg-indigo-100 text-indigo-700' : 'border-gray-200 bg-gray-100 text-gray-500'}`}>
                        {workType === 'TYPE_B' ? 'B' : workType === 'TYPE_D' ? 'D' : 'C'}
                      </span>
                    )}
                    {/* Cùng thông tin với ô chọn A: giờ làm trong tháng (loại D) và giờ tan ca. */}
                    {workType === 'TYPE_D' && (
                      <span className="rounded-md border border-purple-200 bg-purple-100 px-1.5 py-0.5 text-[10px] font-black text-purple-700 shrink-0" title="Giờ làm trong tháng">
                        {fmtHours(turn.net_hours || 0)}
                      </span>
                    )}
                    {turn.shift_end_time && (
                      <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 shrink-0" title="Giờ tan làm của KTV">
                        Tan: {turn.shift_end_time}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] font-semibold shrink-0 ${turn.status === 'working' ? 'text-amber-500' : turn.status === 'assigned' ? 'text-indigo-500' : 'text-emerald-500'}`}>
                    {turn.status === 'working' ? 'Đang làm' : turn.status === 'assigned' ? 'Đã xếp lịch' : 'Rảnh'}
                  </span>
                </div>
              );
            })}
            {options.externalRows.length > 0 && (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-widest text-gray-400">{tCheckin.externalGroup}</p>
                {options.externalRows.map(st => (
                  <div key={st.id} onClick={() => pick(st.id)}
                    className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm font-bold text-gray-700 transition-all hover:bg-indigo-50 active:scale-[0.98]">
                    <div className="flex items-center gap-2">
                      <span>{st.full_name || st.id}</span>
                      <span className="rounded border border-gray-200 bg-gray-100 px-1 py-0.5 text-[8px] font-black leading-none text-gray-500">C</span>
                    </div>
                    <span className="text-[10px] font-semibold text-gray-400">{tCheckin.externalNoAccount}</span>
                  </div>
                ))}
              </>
            )}
            {options.newExternalName && (
              <div onClick={() => pick(newExternalKtvToken(options.newExternalName!))}
                className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-emerald-700 transition-all hover:bg-emerald-50 active:scale-[0.98]">
                <span aria-hidden="true">➕</span><span>{tCheckin.addExternal} <strong className="text-emerald-800">{normalizeExternalKtvName(options.newExternalName)}</strong></span>
              </div>
            )}
            {options.newExternalProblem && options.turnRows.length === 0 && (
              <p className="px-3 py-3 text-xs font-bold leading-relaxed text-amber-600">{options.newExternalProblem}</p>
            )}
            {search.trim() && options.turnRows.length === 0 && options.externalRows.length === 0 && !options.newExternalName && !options.newExternalProblem && (
              <p className="px-3 py-3 text-xs font-bold leading-relaxed text-gray-400">{tCheckin.pickerMissHint}</p>
            )}
            {!search.trim() && options.turnRows.length === 0 && options.externalRows.length === 0 && (
              <p className="py-4 text-center text-xs font-bold text-gray-400">Không có KTV rảnh · gõ tên để thêm KTV ngoài</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
