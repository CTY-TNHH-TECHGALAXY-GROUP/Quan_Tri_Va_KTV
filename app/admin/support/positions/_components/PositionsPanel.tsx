'use client';

import React from 'react';
import { t } from '../../_shared/officeAdmin.i18n';
import { POLICIES, usePositionsAdmin, type AcceptPolicy, type PositionsLogic } from '../Positions.logic';
import MultiPick from './MultiPick';

const INPUT = 'w-full min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600';
const BTN = 'min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40';
const CARD = 'bg-white rounded-2xl border border-stone-200 p-4 flex flex-col gap-2';

/** Three admin-chosen options; the stored value is never hard-coded per position. */
const PolicyPicker = ({ title, value, onChange }: { title: string; value: AcceptPolicy; onChange: (p: AcceptPolicy) => void }) => (
  <fieldset className="flex flex-col gap-1.5">
    <legend className="text-xs font-bold text-stone-600 mb-1">{title}</legend>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {POLICIES.map(p => (
        <button key={p} type="button" role="radio" aria-checked={value === p} onClick={() => onChange(p)}
          className={`text-left rounded-xl border px-3 py-2.5 min-h-[56px] ${value === p ? 'border-emerald-700 bg-emerald-50 ring-1 ring-emerald-700' : 'border-stone-200 bg-white'}`}>
          <span className="block text-sm font-bold text-stone-800">{t.positions.policies[p].label}</span>
          <span className="block text-xs text-stone-500">{t.positions.policies[p].hint}</span>
        </button>
      ))}
    </div>
  </fieldset>
);

const Sheet = ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => (
  <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
      className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-4">
      <h2 className="text-lg font-bold text-stone-800">{title}</h2>
      {children}
    </div>
  </div>
);

const PositionForm = ({ logic }: { logic: PositionsLogic }) => {
  const d = logic.positionDraft!;
  const set = (patch: Partial<typeof d>) => logic.setPositionDraft({ ...d, ...patch });
  const orig = logic.originalOf(d.id);
  const policyChanged = !!orig && (orig.fixed_accept_policy !== d.fixed_accept_policy || orig.adhoc_accept_policy !== d.adhoc_accept_policy);

  return (
    <Sheet title={d.id ? d.name || t.positions.title : t.positions.add} onClose={() => logic.setPositionDraft(null)}>
      <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.positions.name}
        <input className={INPUT} value={d.name} placeholder={t.positions.namePlaceholder} onChange={e => set({ name: e.target.value })} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.positions.branch}
          <input className={INPUT} value={d.branch || ''} onChange={e => set({ branch: e.target.value || null })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.positions.shiftStart}
          <input type="time" className={INPUT} value={(d.shift_start || '').slice(0, 5)} onChange={e => set({ shift_start: e.target.value || null })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.positions.shiftEnd}
          <input type="time" className={INPUT} value={(d.shift_end || '').slice(0, 5)} onChange={e => set({ shift_end: e.target.value || null })} />
        </label>
      </div>

      <PolicyPicker title={t.positions.fixedPolicy} value={d.fixed_accept_policy} onChange={p => set({ fixed_accept_policy: p })} />
      <PolicyPicker title={t.positions.adhocPolicy} value={d.adhoc_accept_policy} onChange={p => set({ adhoc_accept_policy: p })} />
      {policyChanged && <p className="text-sm bg-amber-50 text-amber-800 rounded-xl px-3 py-2">{t.positions.policyChanged}</p>}

      <MultiPick label={t.positions.sets} value={d.setIds} onChange={ids => set({ setIds: ids })}
        items={logic.sets.map(s => ({ id: s.id, label: s.name, hint: s.is_active ? null : t.positions.inactive }))} />
      <MultiPick label={t.positions.members} value={d.memberIds} onChange={ids => set({ memberIds: ids })} searchPlaceholder={t.positions.searchStaff}
        items={logic.staff.map(s => ({ id: s.id, label: `${s.id} · ${s.name}`, hint: s.title }))} />

      <label className="flex items-center gap-2 text-sm text-stone-700 min-h-[44px]">
        <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={d.is_active} onChange={e => set({ is_active: e.target.checked })} />
        {t.positions.active}
      </label>
      {logic.formError && <p role="alert" className="text-sm text-rose-700">{logic.formError}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={logic.saving || !d.name.trim()} onClick={logic.savePosition} className={`${BTN} flex-1 bg-emerald-800 text-white`}>
          {logic.saving ? t.common.saving : t.common.save}
        </button>
        <button type="button" onClick={() => logic.setPositionDraft(null)} className={`${BTN} border border-stone-300 text-stone-600`}>{t.common.cancel}</button>
      </div>
    </Sheet>
  );
};

const SetForm = ({ logic }: { logic: PositionsLogic }) => {
  const d = logic.setDraft!;
  const set = (patch: Partial<typeof d>) => logic.setSetDraft({ ...d, ...patch });
  return (
    <Sheet title={d.id ? d.name || t.sets.title : t.sets.add} onClose={() => logic.setSetDraft(null)}>
      <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.sets.name}
        <input className={INPUT} value={d.name} placeholder={t.sets.namePlaceholder} onChange={e => set({ name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.sets.description}
        <input className={INPUT} value={d.description || ''} onChange={e => set({ description: e.target.value || null })} />
      </label>
      <MultiPick label={t.sets.categories} value={d.categoryIds} onChange={ids => set({ categoryIds: ids })} searchPlaceholder={t.sets.searchCategory}
        items={logic.categories.map(c => ({ id: c.id, label: c.name, hint: c.type === 'ROOM' ? t.sets.roomType : null }))} />
      <label className="flex items-center gap-2 text-sm text-stone-700 min-h-[44px]">
        <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={d.is_active} onChange={e => set({ is_active: e.target.checked })} />
        {t.positions.active}
      </label>
      {logic.formError && <p role="alert" className="text-sm text-rose-700">{logic.formError}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={logic.saving || !d.name.trim()} onClick={logic.saveSet} className={`${BTN} flex-1 bg-emerald-800 text-white`}>
          {logic.saving ? t.common.saving : t.common.save}
        </button>
        <button type="button" onClick={() => logic.setSetDraft(null)} className={`${BTN} border border-stone-300 text-stone-600`}>{t.common.cancel}</button>
      </div>
    </Sheet>
  );
};

/** Positions (accept policy, members, sets) + template sets. Used by /admin/support/positions and the hub tab. */
const PositionsPanel = () => {
  const logic = usePositionsAdmin();
  if (logic.loading) return <p className="text-center text-stone-400 py-14">{t.common.loading}</p>;

  return (
    <div className="flex flex-col gap-8">
      {logic.loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-rose-50 text-rose-800 rounded-xl px-3 py-2 text-sm">
          {logic.loadError}
          <button type="button" onClick={logic.reload} className="font-bold underline min-h-[36px]">{t.common.retry}</button>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-stone-800">{t.positions.title}</h2>
            <p className="text-sm text-stone-500">{t.positions.subtitle}</p>
          </div>
          <button type="button" onClick={() => logic.editPosition()} className={`${BTN} bg-emerald-800 text-white`}>+ {t.positions.add}</button>
        </div>
        {logic.positions.length === 0 && <p className="text-stone-400 py-6 text-center">{t.positions.empty}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {logic.positions.map(p => (
            <article key={p.id} className={`${CARD} ${p.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-stone-800">{p.name}</h3>
                  <p className="text-xs text-stone-500 flex flex-wrap gap-x-2.5">
                    {p.branch && <span>{p.branch}</span>}
                    {(p.shift_start || p.shift_end) && <span>{(p.shift_start || '').slice(0, 5)}–{(p.shift_end || '').slice(0, 5)}</span>}
                    <span>{t.positions.membersCount(p.memberIds.length)}</span>
                    <span>{t.positions.setsCount(p.setIds.length)}</span>
                    {!p.is_active && <span>{t.positions.inactive}</span>}
                  </p>
                </div>
                <button type="button" onClick={() => logic.editPosition(p)} className="min-h-[40px] px-3 rounded-lg text-xs font-bold border border-stone-300 text-stone-600">{t.positions.edit}</button>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-stone-50 rounded-lg px-2.5 py-1.5"><dt className="text-stone-500">{t.positions.fixedPolicy}</dt><dd className="font-bold text-stone-800">{t.positions.policies[p.fixed_accept_policy]?.label}</dd></div>
                <div className="bg-stone-50 rounded-lg px-2.5 py-1.5"><dt className="text-stone-500">{t.positions.adhocPolicy}</dt><dd className="font-bold text-stone-800">{t.positions.policies[p.adhoc_accept_policy]?.label}</dd></div>
              </dl>
              {p.memberIds.length > 0 && <p className="text-xs text-stone-600">{p.memberIds.map(logic.staffName).join(', ')}</p>}
              {p.setIds.length > 0 && <p className="text-xs text-stone-500">{p.setIds.map(logic.setName).join(' · ')}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-stone-800">{t.sets.title}</h2>
            <p className="text-sm text-stone-500">{t.sets.subtitle}</p>
          </div>
          <button type="button" onClick={() => logic.editSet()} className={`${BTN} bg-white border border-stone-300 text-stone-700`}>+ {t.sets.add}</button>
        </div>
        {logic.sets.length === 0 && <p className="text-stone-400 py-6 text-center">{t.sets.empty}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {logic.sets.map(s => (
            <article key={s.id} className={`${CARD} ${s.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-stone-800">{s.name} <span className="text-xs font-normal text-stone-400">{t.sets.version(s.version || 1)}</span></h3>
                  {s.description && <p className="text-xs text-stone-500">{s.description}</p>}
                  <p className="text-xs text-stone-500">{t.sets.categoriesCount(s.categoryIds.length)}</p>
                </div>
                <button type="button" onClick={() => logic.editSet(s)} className="min-h-[40px] px-3 rounded-lg text-xs font-bold border border-stone-300 text-stone-600">{t.positions.edit}</button>
              </div>
              {s.categoryIds.length > 0 && <p className="text-xs text-stone-600">{s.categoryIds.map(logic.categoryName).join(' · ')}</p>}
            </article>
          ))}
        </div>
      </section>

      {logic.positionDraft && <PositionForm logic={logic} />}
      {logic.setDraft && <SetForm logic={logic} />}
      {logic.toast && (
        <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[70] bg-stone-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg">{logic.toast}</div>
      )}
    </div>
  );
};

export default PositionsPanel;
