'use client';

import React from 'react';
import { t } from './officeAdmin.i18n';
import type { AdhocAssignLogic } from './AdhocAssign.logic';

const INPUT = 'w-full min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600';

/** Ad-hoc assignment form (bottom sheet on phone, dialog on desktop). Writes through /api/support/tasks/adhoc. */
const AdhocAssignSheet = ({ logic }: { logic: AdhocAssignLogic }) => {
  if (!logic.open) return null;
  const { form, update } = logic;
  const canSubmit = !!form.assigneeId && !!form.name.trim() && !logic.saving;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => logic.setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label={t.adhoc.title} onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-3">
        <h2 className="text-lg font-bold text-stone-800">{t.adhoc.title}</h2>

        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.adhoc.assignee}
          <select className={INPUT} value={form.assigneeId} onChange={e => update({ assigneeId: e.target.value })}>
            <option value="">{t.adhoc.pickAssignee}</option>
            {logic.staff.map(s => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.adhoc.name}
          <input className={INPUT} value={form.name} placeholder={t.adhoc.namePlaceholder} onChange={e => update({ name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.adhoc.standard}
          <input className={INPUT} value={form.standardText} onChange={e => update({ standardText: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.adhoc.slots}
          <textarea className={`${INPUT} py-2 min-h-[72px]`} value={form.slotsText} placeholder={t.adhoc.slotsPlaceholder}
            onChange={e => update({ slotsText: e.target.value })} />
          <span className="font-normal text-stone-400">{t.adhoc.slotsHint}</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.adhoc.due}
            <input type="time" className={INPUT} value={form.dueTime} onChange={e => update({ dueTime: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-700 min-h-[44px] self-end">
            <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={form.highPriority} onChange={e => update({ highPriority: e.target.checked })} />
            {t.adhoc.priority}
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700 min-h-[44px]">
          <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={form.blocksCheckout} onChange={e => update({ blocksCheckout: e.target.checked })} />
          {t.adhoc.blocks}
        </label>
        <p className="text-xs text-stone-500 bg-stone-50 rounded-xl px-3 py-2">{t.adhoc.policyNote}</p>
        {logic.error && <p role="alert" className="text-sm text-rose-700">{logic.error}</p>}

        <div className="flex gap-2">
          <button type="button" disabled={!canSubmit} onClick={logic.submit}
            className="flex-1 min-h-[48px] rounded-xl bg-emerald-800 text-white text-sm font-bold disabled:opacity-40">
            {logic.saving ? t.common.saving : t.adhoc.submit}
          </button>
          <button type="button" onClick={() => logic.setOpen(false)}
            className="min-h-[48px] px-5 rounded-xl border border-stone-300 text-stone-600 text-sm font-bold">{t.common.cancel}</button>
        </div>
      </div>
    </div>
  );
};

export default AdhocAssignSheet;
