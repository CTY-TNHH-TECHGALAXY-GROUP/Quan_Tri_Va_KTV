'use client';

import React from 'react';
import { t } from '../SupportTasks.i18n';
import type { SupportTasksLogic, TaskState } from '../SupportEmployeeTasks.logic';
import { BAR_ORDER, STATE_DOT } from './taskStyles';

const ShiftHeader = ({ logic, name, code }: { logic: SupportTasksLogic; name: string; code: string }) => {
  const { counts, activeTasks, checkout, pendingUploadCount } = logic;
  const total = activeTasks.length || 1;
  const todayStr = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

  const gate = !checkout?.enabled
    ? { text: t.gate.off, cls: 'bg-stone-100 text-stone-600' }
    : checkout.override || checkout.count === 0
      ? { text: t.gate.free, cls: 'bg-emerald-100 text-emerald-700' }
      : { text: t.gate.blocked(checkout.count), cls: 'bg-rose-100 text-rose-700' };

  return (
    <section className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-stone-800">{t.pageTitle} · {name}</h1>
          <p className="text-xs text-stone-500 capitalize">{code} · {todayStr}</p>
        </div>
        <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${gate.cls}`}>{gate.text}</span>
      </div>

      <div className="h-2 w-full bg-stone-100 rounded-full overflow-hidden flex" aria-hidden="true">
        {BAR_ORDER.map(s => (
          <span key={s} className={`${STATE_DOT[s]} h-full`} style={{ width: `${((counts[s] || 0) / total) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        {(['APPROVED', 'WAITING', 'FIX', 'BLOCKED', 'DOING', 'TODO', 'OFFERED'] as TaskState[])
          .filter(s => counts[s])
          .map(s => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <i className={`w-2.5 h-2.5 rounded-sm ${STATE_DOT[s]}`} />
              {t.states[s]} <b className="tabular-nums">{counts[s]}</b>
            </span>
          ))}
      </div>

      {pendingUploadCount > 0 && (
        <p className="text-xs font-semibold bg-amber-50 text-amber-800 rounded-lg px-3 py-2">{t.queue(pendingUploadCount)}</p>
      )}
      {checkout?.override && (
        <p className="text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2">{t.gate.override(checkout.override.reason)}</p>
      )}
    </section>
  );
};

export default ShiftHeader;
