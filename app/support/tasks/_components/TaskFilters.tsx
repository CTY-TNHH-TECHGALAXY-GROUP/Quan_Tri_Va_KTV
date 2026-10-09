'use client';

import React from 'react';
import { t } from '../SupportTasks.i18n';
import type { SupportTasksLogic } from '../SupportEmployeeTasks.logic';
import { BUCKET_STYLE } from './taskStyles';
import GroupRail from './GroupRail';

/**
 * Two different controls on purpose:
 *  - STATUS = the artifact's summary cards (Chưa làm · Chờ duyệt · Bị từ chối · Đã duyệt) + extras when present;
 *  - GROUP  = GroupRail: neutral cards with progress and sort — a place in the shift, not a status.
 */
const TaskFilters = ({ logic }: { logic: SupportTasksLogic }) => {
  const { activeTasks, statusBuckets, statusFilter, setStatusFilter } = logic;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t.filters.statusLabel}</span>
          {statusFilter !== 'all' && (
            <button type="button" onClick={() => setStatusFilter('all')} className="min-h-[32px] px-2 text-xs font-semibold text-stone-600 underline">
              {t.filters.all} ({activeTasks.length})
            </button>
          )}
        </div>
        {/* Same four summary cards as the artifact, always visible; tap to show only that status. */}
        <div className="grid grid-cols-4 gap-2" role="group" aria-label={t.filters.statusLabel}>
          {statusBuckets.filter(b => b.always).map(b => <BucketCard key={b.key} bucket={b.key} count={b.count} active={statusFilter === b.key} onClick={() => setStatusFilter(statusFilter === b.key ? 'all' : b.key)} />)}
        </div>
        {statusBuckets.some(b => !b.always) && (
          <div className="grid grid-cols-4 gap-2">
            {statusBuckets.filter(b => !b.always).map(b => <BucketCard key={b.key} bucket={b.key} count={b.count} active={statusFilter === b.key} onClick={() => setStatusFilter(statusFilter === b.key ? 'all' : b.key)} />)}
          </div>
        )}
      </div>

      <GroupRail logic={logic} />
    </div>
  );
};

const BucketCard = ({ bucket, count, active, onClick }: { bucket: string; count: number; active: boolean; onClick: () => void }) => {
  const st = BUCKET_STYLE[bucket];
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`min-h-[60px] rounded-xl border px-2.5 py-2 text-left flex flex-col justify-center ${st.card} ${active ? 'ring-2 ring-stone-800' : ''}`}>
      <span className={`text-lg font-semibold tabular-nums font-mono leading-none ${st.num}`}>{count}</span>
      <span className="text-[11px] text-stone-600 mt-1 leading-tight">{t.buckets[bucket]}</span>
    </button>
  );
};

export default TaskFilters;
