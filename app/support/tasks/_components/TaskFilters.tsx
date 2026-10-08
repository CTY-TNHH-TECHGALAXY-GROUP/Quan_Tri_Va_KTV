'use client';

import React from 'react';
import { t } from '../SupportTasks.i18n';
import type { StatusFilter, SupportTasksLogic } from '../SupportEmployeeTasks.logic';

const chip = (active: boolean) =>
  `shrink-0 min-h-[40px] px-3.5 rounded-full text-sm font-semibold border transition-colors ${
    active ? 'bg-emerald-800 border-emerald-800 text-white' : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
  }`;

const TaskFilters = ({ logic }: { logic: SupportTasksLogic }) => {
  const { counts, activeTasks, statusFilter, setStatusFilter, groupFilter, setGroupFilter, groupNames } = logic;
  const items: [StatusFilter, string, number][] = [
    ['all', t.filters.all, activeTasks.length],
    ['open', t.filters.open, (counts.TODO || 0) + (counts.DOING || 0) + (counts.OFFERED || 0) + (counts.BLOCKED || 0)],
    ['fix', t.filters.fix, counts.FIX || 0],
    ['waiting', t.filters.waiting, counts.WAITING || 0],
    ['approved', t.filters.approved, counts.APPROVED || 0],
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t.filters.all}>
        {items.map(([key, label, n]) => (
          <button key={key} type="button" className={chip(statusFilter === key)} aria-pressed={statusFilter === key} onClick={() => setStatusFilter(key)}>
            {label} <span className="tabular-nums opacity-75 text-xs ml-1">{n}</span>
          </button>
        ))}
      </div>
      {groupNames.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t.allGroups}>
          <button type="button" className={chip(groupFilter === 'all')} aria-pressed={groupFilter === 'all'} onClick={() => setGroupFilter('all')}>{t.allGroups}</button>
          {groupNames.map(g => (
            <button key={g} type="button" className={chip(groupFilter === g)} aria-pressed={groupFilter === g} onClick={() => setGroupFilter(g)}>{g}</button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskFilters;
