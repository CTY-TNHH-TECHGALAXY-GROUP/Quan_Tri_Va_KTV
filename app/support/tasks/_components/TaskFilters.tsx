'use client';

import React from 'react';
import { t } from '../SupportTasks.i18n';
import type { SupportTasksLogic } from '../SupportEmployeeTasks.logic';
import { STATE_DOT, STATE_PILL } from './taskStyles';
import GroupRail from './GroupRail';

/**
 * Two different controls on purpose:
 *  - STATUS = coloured chips generated from the states present today (same colours as the cards);
 *  - GROUP  = GroupRail: neutral cards with progress and sort — a place in the shift, not a status.
 */
const TaskFilters = ({ logic }: { logic: SupportTasksLogic }) => {
  const { activeTasks, stateChips, statusFilter, setStatusFilter } = logic;

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

      <GroupRail logic={logic} />
    </div>
  );
};

export default TaskFilters;
