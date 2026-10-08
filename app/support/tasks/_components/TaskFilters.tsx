'use client';

import React from 'react';
import { FolderOpen } from 'lucide-react';
import { t } from '../SupportTasks.i18n';
import type { SupportTasksLogic } from '../SupportEmployeeTasks.logic';
import { STATE_DOT, STATE_PILL } from './taskStyles';

/**
 * Two different controls on purpose:
 *  - STATUS = coloured chips generated from the states present today (same colours as the cards);
 *  - GROUP  = a neutral dropdown with a folder icon — a place in the shift, not a status.
 */
const TaskFilters = ({ logic }: { logic: SupportTasksLogic }) => {
  const { activeTasks, stateChips, statusFilter, setStatusFilter, groupFilter, setGroupFilter, groupNames } = logic;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t.filters.statusLabel}</span>
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t.filters.statusLabel}>
          <button type="button" aria-pressed={statusFilter === 'all'} onClick={() => setStatusFilter('all')}
            className={`shrink-0 min-h-[40px] px-3.5 rounded-full text-sm font-semibold border ${statusFilter === 'all' ? 'bg-stone-800 border-stone-800 text-white' : 'bg-white border-stone-200 text-stone-600'}`}>
            {t.filters.all} <span className="tabular-nums opacity-75 text-xs ml-1">{activeTasks.length}</span>
          </button>
          {stateChips.map(({ state, count }) => {
            const active = statusFilter === state;
            return (
              <button key={state} type="button" aria-pressed={active} onClick={() => setStatusFilter(active ? 'all' : state)}
                className={`shrink-0 min-h-[40px] pl-2.5 pr-3.5 rounded-full text-sm font-semibold border inline-flex items-center gap-2 ${
                  active ? `${STATE_PILL[state]} border-current ring-1 ring-current` : 'bg-white border-stone-200 text-stone-700'}`}>
                <i className={`w-2.5 h-2.5 rounded-full ${STATE_DOT[state]}`} aria-hidden="true" />
                {t.states[state]} <span className="tabular-nums opacity-75 text-xs">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {groupNames.length > 1 && (
        <label className="flex items-center gap-2 min-h-[44px] rounded-xl border border-stone-200 bg-white px-3">
          <FolderOpen size={18} className="text-stone-400 shrink-0" aria-hidden="true" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 shrink-0">{t.filters.groupLabel}</span>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} aria-label={t.filters.groupLabel}
            className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-stone-800 py-2 focus:outline-none">
            <option value="all">{t.allGroups}</option>
            {groupNames.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
      )}
    </div>
  );
};

export default TaskFilters;
