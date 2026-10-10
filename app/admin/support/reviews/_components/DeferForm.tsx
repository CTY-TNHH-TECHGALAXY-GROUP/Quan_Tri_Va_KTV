'use client';

import React, { useState } from 'react';
import { t } from '../../_shared/officeAdmin.i18n';
import type { StaffOption } from '../../_shared/officeApi';
import { addDays, type QueueTask, type ReviewQueueLogic } from '../SupportReviews.logic';

// 🔧 UI CONFIGURATION
const DEFAULT_DUE = '09:00';
const MAX_DAYS_AHEAD = 7;   // same limit as OVERDUE_KEEP_DAYS on the server

const BTN = 'min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40';
const INPUT = 'min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm';

/**
 * "Dời sang…" — supervisor moves an unfinished task to another day (default tomorrow),
 * optionally to another person, with a handover note the receiver sees first.
 */
const DeferForm = ({ task, logic, staff, defaultNote, onDone }: {
  task: QueueTask;
  logic: ReviewQueueLogic;
  staff: StaffOption[];
  defaultNote: string;
  onDone: () => void;
}) => {
  // Later than the task's own day, never in the past; default tomorrow.
  const minDate = task.task_date >= logic.today ? addDays(task.task_date, 1) : logic.today;
  const tomorrow = addDays(logic.today, 1);
  const [toDate, setToDate] = useState(tomorrow >= minDate ? tomorrow : minDate);
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState(defaultNote);
  const [dueTime, setDueTime] = useState(DEFAULT_DUE);

  const submit = async () => {
    const ok = await logic.deferTask(task.id, { toDate, assigneeId: assigneeId || null, note: note.trim(), dueTime });
    if (ok) onDone();
  };

  return (
    <div className="flex flex-col gap-3 bg-orange-50/60 border border-orange-200 rounded-xl p-3">
      <div>
        <span className="block text-sm font-bold text-stone-800">{t.defer.title}</span>
        <span className="block text-xs text-stone-500 mt-0.5">{t.defer.hint}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
          {t.defer.date}
          <input type="date" value={toDate} min={minDate} max={addDays(logic.today, MAX_DAYS_AHEAD)} onChange={e => setToDate(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
          {t.defer.due}
          <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} className={INPUT} />
          <span className="font-normal text-stone-400">{t.defer.dueHint}</span>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
        {t.defer.assignee}
        <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={INPUT}>
          <option value="">{t.defer.keepAssignee(logic.nameOf(task.assignee_id))}</option>
          {staff.filter(s => s.id !== task.assignee_id).map(s => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
        {t.defer.note}
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={t.defer.notePlaceholder}
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-normal" />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={!note.trim() || !toDate || logic.busy} onClick={submit} className={`${BTN} bg-emerald-800 text-white`}>{t.defer.submit}</button>
        <button type="button" onClick={onDone} className={`${BTN} bg-white border border-stone-300 text-stone-600`}>{t.common.cancel}</button>
      </div>
    </div>
  );
};

export default DeferForm;
