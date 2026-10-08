'use client';

import React from 'react';
import { t } from '../../_shared/officeAdmin.i18n';
import { TIME_MODES, type TemplateConfigLogic } from '../TemplateConfig.logic';

const INPUT = 'w-full min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600';
const BTN = 'min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40';
const SECTION = 'flex flex-col gap-2 border-t border-stone-100 pt-4';
const H = 'text-xs font-bold uppercase tracking-wider text-stone-500';

const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="flex items-center gap-3 min-h-[44px] text-sm text-stone-700">
    <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={checked} onChange={e => onChange(e.target.checked)} />
    {label}
  </label>
);

/** Admin editor for the Office P0 fields of one task template. */
const TemplateConfigSheet = ({ logic, onSaved }: { logic: TemplateConfigLogic; onSaved?: () => void }) => {
  const d = logic.draft;
  if (!d) return null;
  const close = () => logic.setDraft(null);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label={t.config.title(d.name)} onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-stone-800">{t.config.title(d.name)}</h2>
          <p className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mt-2">{t.config.appliesNote}</p>
        </div>

        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.config.standard}
          <input className={INPUT} value={d.standard_text} placeholder={t.config.standardPlaceholder} onChange={e => logic.update({ standard_text: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.config.sop}
          <textarea className={`${INPUT} py-2 min-h-[72px]`} value={d.sopText} placeholder={t.config.sopPlaceholder} onChange={e => logic.update({ sopText: e.target.value })} />
        </label>

        <section className={SECTION}>
          <h3 className={H}>{t.config.slots}</h3>
          <p className="text-xs text-stone-500">{t.config.slotsHint}</p>
          {d.slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="relative w-16 h-12 shrink-0 rounded-lg overflow-hidden bg-stone-100 border border-dashed border-stone-300 cursor-pointer flex items-center justify-center text-[10px] text-stone-500 text-center"
                title={s.refUrl ? t.config.changeRef : t.config.uploadRef}>
                {s.uploading ? t.config.uploading : s.refUrl ? <img src={s.refUrl} alt="" className="w-full h-full object-cover" /> : t.config.uploadRef}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) logic.uploadRef(i, f); e.target.value = ''; }} />
              </label>
              <input className={INPUT} value={s.label} placeholder={t.config.slotLabel} aria-label={t.config.slotLabel}
                onChange={e => logic.updateSlot(i, { label: e.target.value })} />
              {s.refUrl && (
                <button type="button" className="text-xs text-stone-500 underline min-h-[44px] px-1 shrink-0" onClick={() => logic.updateSlot(i, { ref_path: null, refUrl: null })}>{t.config.removeRef}</button>
              )}
              <button type="button" aria-label={t.config.remove} className="min-h-[44px] px-2 text-stone-400 hover:text-rose-600 shrink-0"
                onClick={() => logic.update({ slots: d.slots.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="self-start text-sm font-bold text-emerald-800 min-h-[40px]"
            onClick={() => logic.update({ slots: [...d.slots, { label: '', ref_path: null, refUrl: null }] })}>{t.config.addSlot}</button>
        </section>

        <section className={SECTION}>
          <h3 className={H}>{t.config.fields}</h3>
          {d.fields.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-stone-100 text-stone-600 shrink-0">{f.kind === 'check' ? t.config.kindCheck : t.config.kindCount}</span>
              <input className={`${INPUT} flex-1 min-w-[160px]`} value={f.label} placeholder={t.config.fieldLabel} aria-label={t.config.fieldLabel}
                onChange={e => logic.updateField(i, { label: e.target.value })} />
              {f.kind === 'count' && (
                <>
                  <input className={`${INPUT} w-24`} value={f.unit} placeholder={t.config.unit} aria-label={t.config.unit} onChange={e => logic.updateField(i, { unit: e.target.value })} />
                  <input className={`${INPUT} w-24`} inputMode="numeric" value={f.min} placeholder={t.config.min} aria-label={t.config.min}
                    onChange={e => logic.updateField(i, { min: e.target.value.replace(/[^\d.]/g, '') })} />
                </>
              )}
              <button type="button" aria-label={t.config.remove} className="min-h-[44px] px-2 text-stone-400 hover:text-rose-600"
                onClick={() => logic.update({ fields: d.fields.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="flex gap-4">
            <button type="button" className="text-sm font-bold text-emerald-800 min-h-[40px]"
              onClick={() => logic.update({ fields: [...d.fields, { kind: 'check', label: '', unit: '', min: '' }] })}>{t.config.addCheck}</button>
            <button type="button" className="text-sm font-bold text-emerald-800 min-h-[40px]"
              onClick={() => logic.update({ fields: [...d.fields, { kind: 'count', label: '', unit: '', min: '' }] })}>{t.config.addCount}</button>
          </div>
        </section>

        <section className={SECTION}>
          <h3 className={H}>{t.config.timeMode}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TIME_MODES.map(m => (
              <button key={m} type="button" role="radio" aria-checked={d.time_mode === m} onClick={() => logic.update({ time_mode: m })}
                className={`min-h-[44px] rounded-xl border text-sm font-semibold ${d.time_mode === m ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-stone-200 text-stone-600'}`}>
                {t.config.modes[m]}
              </button>
            ))}
          </div>
          {d.time_mode === 'DEADLINE' && (
            <label className="flex flex-col gap-1 text-xs font-bold text-stone-600 max-w-[200px]">{t.config.dueTime}
              <input type="time" className={INPUT} value={d.due_time} onChange={e => logic.update({ due_time: e.target.value })} />
            </label>
          )}
          {d.time_mode === 'WINDOW' && (
            <div className="grid grid-cols-2 gap-3 max-w-[420px]">
              <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.config.windowStart}
                <input type="time" className={INPUT} value={d.window_start} onChange={e => logic.update({ window_start: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.config.windowEnd}
                <input type="time" className={INPUT} value={d.window_end} onChange={e => logic.update({ window_end: e.target.value })} />
              </label>
            </div>
          )}
          {d.time_mode === 'MULTI' && (
            <label className="flex flex-col gap-1 text-xs font-bold text-stone-600">{t.config.multiTimes}
              <input className={INPUT} value={d.multiText} placeholder={t.config.multiPlaceholder} onChange={e => logic.update({ multiText: e.target.value })} />
            </label>
          )}
        </section>

        <section className={SECTION}>
          <h3 className={H}>{t.config.flags}</h3>
          <Toggle checked={d.blocks_checkout} onChange={v => logic.update({ blocks_checkout: v })} label={t.config.blocksCheckout} />
          <Toggle checked={d.requires_review} onChange={v => logic.update({ requires_review: v })} label={t.config.requiresReview} />
          <Toggle checked={d.allow_carry_over} onChange={v => logic.update({ allow_carry_over: v })} label={t.config.allowCarry} />
        </section>

        {logic.error && <p role="alert" className="text-sm text-rose-700">{logic.error}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={logic.saving || d.slots.some(s => s.uploading)} onClick={async () => { if (await logic.save()) onSaved?.(); }}
            className={`${BTN} flex-1 bg-emerald-800 text-white`}>{logic.saving ? t.common.saving : t.common.save}</button>
          <button type="button" onClick={close} className={`${BTN} border border-stone-300 text-stone-600`}>{t.common.cancel}</button>
        </div>
      </div>
    </div>
  );
};

export default TemplateConfigSheet;
