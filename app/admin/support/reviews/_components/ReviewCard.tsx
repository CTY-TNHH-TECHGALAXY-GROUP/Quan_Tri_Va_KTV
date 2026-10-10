'use client';

import React, { useState } from 'react';
import { t } from '../../_shared/officeAdmin.i18n';
import { hhmmVN } from '../../_shared/officeApi';
import type { QueueTask, RejectDraft, ReviewQueueLogic } from '../SupportReviews.logic';

const BTN = 'min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40';
const REASON_KEYS = Object.keys(t.review.reasons);

interface SlotView { label: string; ref: string | null; photo: string | null; photoId: string | null; index: number | null }

/** One task waiting for review: sample ↔ submitted photo per slot, approve, or return marked slots. */
const ReviewCard = ({ task, logic }: { task: QueueTask; logic: ReviewQueueLogic }) => {
  const [returning, setReturning] = useState(false);
  const [drafts, setDrafts] = useState<RejectDraft[]>([]);
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const named = !!task.photo_slots && task.photo_slots.length > 0;
  const photos = task.photos || [];
  const slots: SlotView[] = named
    ? task.photo_slots!.map((s, i) => {
        const ph = photos.find(p => p.slot === i);
        return { label: s.label, ref: task.refs?.[i] || null, photo: ph?.url || null, photoId: ph?.id || null, index: i };
      })
    : photos.map((p, i) => ({ label: `${t.review.submitted} ${i + 1}`, ref: null, photo: p.url, photoId: p.id, index: null }));

  const draftOf = (i: number | null) => (i === null ? undefined : drafts.find(d => d.slot === i));

  /** In return mode, a tap marks the slot and places the circle where the mistake is. */
  const tapSlot = (e: React.MouseEvent<HTMLButtonElement>, s: SlotView) => {
    if (!returning || s.index === null) {
      if (s.photo) logic.setLightbox(s.photo);
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const mark = { x: Math.round(((e.clientX - box.left) / box.width) * 100), y: Math.round(((e.clientY - box.top) / box.height) * 100) };
    const slot = s.index;
    setDrafts(prev => (prev.some(d => d.slot === slot) ? prev.map(d => (d.slot === slot ? { ...d, mark } : d)) : [...prev, { slot, mark }]));
    setFormError(null);
  };

  const sendReturn = async () => {
    if (named && drafts.length === 0) return setFormError(t.review.needSlot);
    if (!reasonCode) return setFormError(t.review.needReason);
    const ok = await logic.returnTask(task.id, reasonCode, note.trim(), drafts);
    if (ok) { setReturning(false); setDrafts([]); setReasonCode(null); setNote(''); }
  };

  const fields = task.evidence_fields || [];
  const values = task.evidence_values || {};
  const isSelected = logic.selected.has(task.id);
  const isCarry = task.task_date !== logic.today;

  return (
    <article className={`bg-white rounded-2xl border p-4 flex flex-col gap-3 ${isSelected ? 'border-emerald-600 shadow-md' : 'border-stone-200'}`}>
      <header className="flex items-start gap-3">
        {!returning && (
          <input type="checkbox" checked={isSelected} onChange={() => logic.toggleSelect(task.id)} aria-label={task.name}
            className="mt-1 w-5 h-5 accent-emerald-700 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-stone-800 leading-snug">{task.name}</h3>
          <p className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-stone-500 mt-0.5">
            <span className="font-semibold text-stone-700">{logic.nameOf(task.assignee_id)}</span>
            {task.submitted_at && <span>{t.review.sentAt(hhmmVN(task.submitted_at))}</span>}
            {(task.current_review_round || 0) > 0 && <span>{t.review.round((task.current_review_round || 0) + 1)}</span>}
            {task.task_type === 'AD-HOC' && <span className="text-rose-700 font-bold">{t.review.adhoc}</span>}
            {isCarry && <span className="text-amber-700 font-bold">{t.review.fromDay(`${task.task_date.slice(8, 10)}/${task.task_date.slice(5, 7)}`)}</span>}
          </p>
        </div>
      </header>

      {task.standard_text && (
        <p className="text-sm bg-stone-50 rounded-xl px-3 py-2"><b className="text-stone-500 text-xs uppercase tracking-wider mr-1.5">{t.review.standard}</b>{task.standard_text}</p>
      )}

      {returning && (
        <p className="text-sm bg-rose-50 text-rose-800 rounded-xl px-3 py-2">{named ? t.review.returnHelp : t.review.returnLegacyHelp}</p>
      )}

      {slots.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {slots.map((s, i) => {
            const d = draftOf(s.index);
            return (
              <div key={i} className="flex flex-col gap-1 min-w-0">
                <span className="text-xs font-bold text-stone-600 truncate">{s.label}</span>
                <button type="button" onClick={e => tapSlot(e, s)}
                  className={`relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-stone-100 ${d ? 'ring-[3px] ring-rose-500' : ''} ${returning && s.index !== null ? 'cursor-crosshair' : ''}`}
                  aria-label={s.label}>
                  {s.photo
                    ? <img src={s.photo} alt="" className="w-full h-full object-cover" />
                    : <span className="absolute inset-0 flex items-center justify-center text-xs text-stone-400">{t.review.missingPhoto}</span>}
                  {s.ref && (
                    <span className="absolute top-1.5 left-1.5 w-1/3 aspect-[4/3] rounded-md overflow-hidden border-2 border-white shadow" title={t.review.sample}>
                      <img src={s.ref} alt={t.review.sample} className="w-full h-full object-cover" />
                    </span>
                  )}
                  {d?.mark && (
                    <span className="absolute w-[22%] aspect-square rounded-full border-[3px] border-orange-500 shadow-[0_0_0_2px_rgba(255,255,255,0.7)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ left: `${d.mark.x}%`, top: `${d.mark.y}%` }} />
                  )}
                  {d && <span className="absolute bottom-1.5 right-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-rose-600 text-white">{t.review.slotMarked}</span>}
                </button>
                {/* Supervisor sets the sample here; staff see the very same picture. */}
                {!returning && task.template_id && s.index !== null && (
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                    {!s.ref && <span className="text-amber-700 font-semibold">{t.review.noSample}</span>}
                    {s.photoId && (
                      <button type="button" disabled={logic.busy} onClick={() => logic.sampleFromPhoto(s.photoId!)}
                        className="min-h-[32px] font-semibold text-emerald-800 underline disabled:opacity-40">{t.review.useAsSample}</button>
                    )}
                    <label className="min-h-[32px] inline-flex items-center font-semibold text-stone-600 underline cursor-pointer">
                      {s.ref ? t.review.changeSample : t.review.uploadSample}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) logic.uploadSample(task.template_id!, s.index!, f); e.target.value = ''; }} />
                    </label>
                  </div>
                )}
                {d && (
                  <div className="flex flex-col gap-1">
                    <input value={d.reason || ''} placeholder={t.review.slotReasonPlaceholder} aria-label={t.review.slotReasonPlaceholder}
                      onChange={e => setDrafts(prev => prev.map(x => (x.slot === d.slot ? { ...x, reason: e.target.value } : x)))}
                      className="min-h-[36px] rounded-lg border border-stone-300 px-2 text-xs" />
                    <button type="button" className="self-start text-xs font-semibold text-stone-500 underline min-h-[28px]"
                      onClick={() => setDrafts(prev => prev.filter(x => x.slot !== d.slot))}>{t.review.unmark}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {fields.length > 0 && (
        <ul className="text-sm flex flex-col gap-1 bg-stone-50 rounded-xl px-3 py-2">
          {fields.map((f, i) => {
            const v = values[String(i)];
            const low = f.kind === 'count' && typeof v === 'number' && f.min !== undefined && v < f.min;
            return (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-stone-600">{f.label}</span>
                <span className={`font-semibold tabular-nums ${low ? 'text-rose-700' : 'text-stone-800'}`}>
                  {f.kind === 'check' ? (v === true ? t.review.checked : t.review.unchecked) : `${v ?? t.common.none}${f.unit ? ` ${f.unit}` : ''}`}
                  {low && ` · ${t.review.belowMin(f.min!)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!returning ? (
        <div className="flex gap-2">
          <button type="button" disabled={logic.busy} onClick={() => logic.approve([task.id])} className={`${BTN} flex-1 bg-emerald-800 text-white`}>{t.review.approve}</button>
          <button type="button" disabled={logic.busy} onClick={() => setReturning(true)} className={`${BTN} bg-white border border-rose-300 text-rose-700`}>{t.review.returnStart}</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-stone-100 pt-3">
          <span className="text-xs font-bold text-stone-600">{t.review.reasonTitle}</span>
          <div className="flex flex-wrap gap-2">
            {REASON_KEYS.map(k => (
              <button key={k} type="button" aria-pressed={reasonCode === k} onClick={() => { setReasonCode(k); setFormError(null); }}
                className={`min-h-[40px] px-3 rounded-full text-sm font-semibold border ${reasonCode === k ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-stone-200 text-stone-600'}`}>
                {t.review.reasons[k]}
              </button>
            ))}
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={t.review.notePlaceholder} aria-label={t.review.notePlaceholder}
            className="min-h-[44px] rounded-xl border border-stone-300 px-3 text-sm" />
          {formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={logic.busy} onClick={sendReturn} className={`${BTN} flex-1 bg-rose-600 text-white`}>{t.review.sendReturn}</button>
            <button type="button" onClick={() => { setReturning(false); setDrafts([]); setFormError(null); }}
              className={`${BTN} bg-white border border-stone-300 text-stone-600`}>{t.common.cancel}</button>
          </div>
        </div>
      )}
    </article>
  );
};

export default ReviewCard;
