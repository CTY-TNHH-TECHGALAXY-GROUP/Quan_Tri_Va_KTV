'use client';

import React from 'react';
import { t } from '../SupportTasks.i18n';
import type { GroupSort, GroupStat, SupportTasksLogic } from '../SupportEmployeeTasks.logic';

// 🔧 UI CONFIGURATION
const CARD_WIDTH = 'w-[148px]';
const SORTS: GroupSort[] = ['shift', 'remaining'];

/** Number badge of a group — its place in the shift. */
export const GroupBadge = ({ order, done }: { order: string | null; done: boolean }) => (
  <span className={`w-7 h-7 shrink-0 rounded-lg text-xs font-bold inline-flex items-center justify-center tabular-nums ${
    done ? 'bg-emerald-700 text-white' : 'bg-stone-100 text-stone-700'}`}>
    {done ? '✓' : order ?? '•'}
  </span>
);

const Progress = ({ g }: { g: GroupStat }) => (
  <div className="flex items-center gap-2">
    <span className="flex-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
      <span className="block h-full bg-emerald-600 rounded-full" style={{ width: `${g.total ? (g.done / g.total) * 100 : 0}%` }} />
    </span>
    <span className="text-[11px] tabular-nums text-stone-500">{g.done}/{g.total}</span>
  </div>
);

/**
 * Group navigator: one card per group (place in the shift) with its own progress, sortable
 * by shift order or by most work left. Tap a card to show only that group; tap again for all.
 * Deliberately neutral (no status colours) so it never reads as a task state.
 */
const GroupRail = ({ logic }: { logic: SupportTasksLogic }) => {
  const { groupStats, groupFilter, setGroupFilter, groupSort, setGroupSort, activeTasks } = logic;
  if (groupStats.length < 2) return null;
  const doneAll = activeTasks.filter(x => x.state === 'APPROVED').length;

  const card = (active: boolean) =>
    `${CARD_WIDTH} shrink-0 snap-start text-left rounded-2xl border p-3 flex flex-col gap-2 min-h-[104px] transition-colors ${
      active ? 'border-stone-800 ring-1 ring-stone-800 bg-white' : 'border-stone-200 bg-white hover:border-stone-300'}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t.filters.groupLabel}</span>
        <div role="radiogroup" aria-label={t.groupSort.label} className="inline-flex rounded-full bg-stone-100 p-0.5">
          {SORTS.map(k => (
            <button key={k} type="button" role="radio" aria-checked={groupSort === k} onClick={() => setGroupSort(k)}
              className={`min-h-[32px] px-3 rounded-full text-xs font-semibold ${groupSort === k ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>
              {t.groupSort[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto snap-x pb-1 -mx-1 px-1" role="group" aria-label={t.filters.groupLabel}>
        <button type="button" aria-pressed={groupFilter === 'all'} onClick={() => setGroupFilter('all')} className={card(groupFilter === 'all')}>
          <span className="text-sm font-bold text-stone-800">{t.allGroups}</span>
          <span className="text-[11px] text-stone-500">{t.groups.count(activeTasks.length)}</span>
          <span className="mt-auto"><Progress g={{ name: '', order: null, title: '', time: null, total: activeTasks.length, done: doneAll, remaining: 0 }} /></span>
        </button>
        {groupStats.map(g => {
          const active = groupFilter === g.name;
          return (
            <button key={g.name} type="button" aria-pressed={active} onClick={() => setGroupFilter(active ? 'all' : g.name)} className={card(active)} title={g.name}>
              <span className="flex items-start gap-2">
                <GroupBadge order={g.order} done={g.total > 0 && g.done === g.total} />
                <span className="text-[13px] font-semibold text-stone-800 leading-snug line-clamp-2">{g.title}</span>
              </span>
              {g.time && <span className="text-[11px] text-stone-500">{g.time}</span>}
              <span className="mt-auto"><Progress g={g} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default GroupRail;
