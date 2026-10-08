'use client';

import React, { useState } from 'react';
import { t } from '../SupportTasks.i18n';
import type { SupportTasksLogic, TaskItem } from '../SupportEmployeeTasks.logic';

const BTN = 'min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40';

/** Accept / decline bar — the decline button only exists when the position's policy allows it. */
export const AcceptBar = ({ task, logic }: { task: TaskItem; logic: SupportTasksLogic }) => {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  if (task.state !== 'OFFERED') return null;
  return (
    <div className="flex flex-col gap-2 bg-violet-50 rounded-xl p-3">
      <p className="text-sm text-violet-800">{t.detail.offeredNote}</p>
      {!declining ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${BTN} bg-emerald-800 text-white`} onClick={() => logic.acceptTask(task.id)}>{t.accept.accept}</button>
          {task.canDecline && (
            <button type="button" className={`${BTN} bg-white border border-stone-300 text-stone-700`} onClick={() => setDeclining(true)}>{t.accept.decline}</button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder={t.accept.reasonPlaceholder}
            className="min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-sm" aria-label={t.accept.reasonPlaceholder}
          />
          <div className="flex gap-2">
            <button type="button" className={`${BTN} bg-rose-600 text-white`} disabled={!reason.trim()}
              onClick={async () => { if (await logic.declineTask(task.id, reason.trim())) setDeclining(false); }}>{t.accept.send}</button>
            <button type="button" className={`${BTN} bg-white border border-stone-300 text-stone-600`} onClick={() => setDeclining(false)}>{t.accept.cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
};

/** "Báo vướng" with preset reasons, or "làm tiếp" once it is resolved. */
export const StuckControl = ({ task, logic }: { task: TaskItem; logic: SupportTasksLogic }) => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (task.state === 'BLOCKED') {
    return (
      <button type="button" className={`${BTN} bg-stone-100 text-emerald-900 self-start`} onClick={() => logic.unblockTask(task.id)}>{t.stuck.resume}</button>
    );
  }
  if (!['TODO', 'DOING', 'FIX'].includes(task.state)) return null;
  if (!open) {
    return (
      <button type="button" className="min-h-[40px] px-3 rounded-lg text-sm font-semibold border border-stone-300 text-stone-600 self-start" onClick={() => setOpen(true)}>
        {t.stuck.open}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 bg-stone-50 rounded-xl p-3">
      <span className="text-xs font-bold text-stone-600">{t.stuck.title}</span>
      <div className="flex flex-wrap gap-2">
        {Object.entries(t.stuck.reasons).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={code === key} onClick={() => setCode(key)}
            className={`min-h-[40px] px-3 rounded-full text-sm font-semibold border ${code === key ? 'bg-emerald-800 border-emerald-800 text-white' : 'bg-white border-stone-200 text-stone-600'}`}>
            {label}
          </button>
        ))}
      </div>
      <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder={t.stuck.notePlaceholder}
        className="min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-sm" aria-label={t.stuck.notePlaceholder} />
      <div className="flex gap-2">
        <button type="button" className={`${BTN} bg-emerald-800 text-white`} disabled={!code}
          onClick={async () => { if (code && await logic.blockTask(task.id, code, note)) setOpen(false); }}>{t.stuck.send}</button>
        <button type="button" className={`${BTN} bg-white border border-stone-300 text-stone-600`} onClick={() => setOpen(false)}>{t.stuck.cancel}</button>
      </div>
    </div>
  );
};
