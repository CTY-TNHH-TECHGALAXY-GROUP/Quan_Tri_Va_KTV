'use client';

import React from 'react';
import Link from 'next/link';
import { t } from '../SupportTasks.i18n';
import type { SupportTasksLogic, TaskState } from '../SupportEmployeeTasks.logic';
import { STATE_PILL } from './taskStyles';

const MUST: TaskState[] = ['OFFERED', 'TODO', 'DOING', 'BLOCKED'];

/** Bottom sheet listing exactly what still keeps this person from checking out — from the shared gate. */
const CheckoutCheckSheet = ({ logic }: { logic: SupportTasksLogic }) => {
  if (!logic.sheetOpen) return null;
  const items = logic.checkout?.items || [];
  const groups: { title: string; note: string; list: typeof items }[] = [
    { title: t.sheet.mustDo, note: t.sheet.yours, list: items.filter(i => MUST.includes(i.state)) },
    { title: t.sheet.mustFix, note: t.sheet.yours, list: items.filter(i => i.state === 'FIX') },
    { title: t.sheet.waitReview, note: t.sheet.supervisors, list: items.filter(i => i.state === 'WAITING') },
  ];
  const clear = !logic.checkout?.enabled || logic.checkout.count === 0 || !!logic.checkout.override;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center" onClick={() => logic.setSheetOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label={t.sheet.title} onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-3xl max-h-[86vh] overflow-y-auto rounded-t-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-4">
        <h2 className="text-lg font-bold text-stone-800">{t.sheet.title}</h2>
        {clear
          ? <p className="text-sm bg-emerald-50 text-emerald-800 rounded-xl px-3 py-2">
              {logic.checkout?.override ? t.gate.override(logic.checkout.override.reason) : t.sheet.allGood}
            </p>
          : <p className="text-sm text-stone-600">{t.sheet.intro}</p>}
        {!clear && groups.filter(g => g.list.length).map(g => (
          <div key={g.title} className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              {g.title} · {g.list.length} <span className="normal-case font-normal tracking-normal text-stone-400">— {g.note}</span>
            </h3>
            {g.list.map(i => (
              <button key={i.id} type="button" onClick={() => logic.gotoTask(i.id)}
                className="w-full min-h-[48px] flex items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 text-left text-sm">
                <span>{i.name}{i.carry && <span className="ml-1.5 text-xs font-bold text-amber-700">· tồn</span>}</span>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATE_PILL[i.state]}`}>{t.states[i.state]}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Link href="/ktv/attendance" className="min-h-[44px] px-4 rounded-xl bg-emerald-800 text-white text-sm font-bold inline-flex items-center">{t.sheet.goAttendance}</Link>
          <button type="button" className="min-h-[44px] px-4 rounded-xl border border-stone-300 text-stone-600 text-sm font-bold" onClick={() => logic.setSheetOpen(false)}>{t.sheet.close}</button>
        </div>
        <p className="text-xs text-stone-400">{t.sheet.suddenOff}</p>
      </div>
    </div>
  );
};

export default CheckoutCheckSheet;
