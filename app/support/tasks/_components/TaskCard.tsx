'use client';

import React from 'react';
import { User } from 'lucide-react';
import { t } from '../SupportTasks.i18n';
import { dueTone, hhmmVN, parseGroupName, slotProgress, uploadKey, type SupportTasksLogic, type TaskItem } from '../SupportEmployeeTasks.logic';
import { STATE_DOT, STATE_PILL } from './taskStyles';
import PhotoSlot from './PhotoSlot';
import EvidenceField from './EvidenceField';
import { AcceptBar, StuckControl } from './TaskActions';

const shortDate = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7);

/** showGroup: false when the card already sits under its group header. */
const TaskCard = ({ task, logic, showGroup = true }: { task: TaskItem; logic: SupportTasksLogic; showGroup?: boolean }) => {
  const open = logic.openId === task.id;
  const progress = slotProgress(task);
  const editable = ['TODO', 'DOING', 'FIX'].includes(task.state);

  const tags: { text: string; cls?: string }[] = [];
  if (task.task_type === 'AD-HOC') tags.push({ text: t.tags.adhoc + (task.priority === 'HIGH' ? ` · ${t.tags.priority}` : ''), cls: 'text-rose-700 font-bold' });
  if (task.handover?.fromDate) tags.push({ text: t.tags.handover(shortDate(task.handover.fromDate)), cls: 'text-orange-700 font-bold' });
  else if (task.isCarryOver) tags.push({ text: t.tags.carry(shortDate(task.task_date)), cls: 'text-amber-700 font-bold' });
  if (showGroup) tags.push({ text: parseGroupName(task.categoryName).title, cls: 'text-stone-400' });
  const tone = dueTone(task);
  if (task.time_mode === 'DEADLINE' && task.due_at) {
    const hhmm = hhmmVN(task.due_at);
    tags.push(tone === 'over' ? { text: t.tags.overdue(hhmm), cls: 'text-rose-700 font-bold' }
      : tone === 'soon' ? { text: t.tags.dueSoon(hhmm), cls: 'text-amber-700 font-bold' }
      : { text: t.tags.deadline(hhmm) });
  }
  if (task.time_mode === 'WINDOW' && task.window_start_at && task.window_end_at) tags.push({ text: t.tags.window(hhmmVN(task.window_start_at), hhmmVN(task.window_end_at)) });
  if (task.time_mode === 'MULTI' && task.slot_time) tags.push({ text: t.tags.multi(task.slot_time) });
  if (progress.total > 0) tags.push({ text: `${progress.done}/${progress.total}`, cls: 'tabular-nums' });
  if (!task.blocks_checkout) tags.push({ text: t.tags.noBlock, cls: 'italic' });

  // Named slots, or N generic slots for tasks created before Office P0.
  const named = task.photo_slots && task.photo_slots.length > 0;
  const genericCount = named ? 0 : (task.requires_photo ? Math.max(task.min_photo_count, task.photos.length) : 0);
  const slots = named
    ? task.photo_slots!.map((s, i) => ({ label: s.label, slot: i as number | null, photo: task.photos.find(p => p.slot === i) || null, ref: task.refs[i] || null }))
    : Array.from({ length: genericCount }, (_, i) => ({ label: t.slot.generic(i + 1), slot: null as number | null, photo: task.photos[i] || null, ref: null }));
  const firstEmptyGeneric = slots.findIndex(s => !s.photo);

  return (
    <div id={`task-${task.id}`} className={`bg-white rounded-2xl border overflow-hidden ${open ? 'border-stone-300 shadow-md' : 'border-stone-200'}`}>
      <button type="button" onClick={() => logic.setOpenId(open ? null : task.id)} aria-expanded={open}
        className="w-full text-left grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 min-h-[60px]">
        <span className={`w-3 h-3 rounded-full ${STATE_DOT[task.state]}`} />
        <span className="min-w-0">
          <span className="block text-[14.5px] font-semibold text-stone-800 leading-snug">{task.name}</span>
          <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-stone-500 mt-0.5">
            {tags.map((g, i) => <span key={i} className={g.cls}>{g.text}</span>)}
          </span>
          {task.handover?.note && !open && (
            <span className="block mt-1 text-xs text-orange-800 bg-orange-50 rounded-lg px-2 py-1 line-clamp-2">{task.handover.note}</span>
          )}
        </span>
        <span className={`text-[11.5px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${STATE_PILL[task.state]}`}>{t.states[task.state]}</span>
      </button>

      {open && (
        <div className="border-t border-stone-100 p-4 flex flex-col gap-4">
          {task.handover && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 text-sm text-orange-900 flex flex-col gap-1">
              <b className="text-[11px] uppercase tracking-wider text-orange-700">{t.detail.handoverTitle(task.handover.fromDate ? shortDate(task.handover.fromDate) : '')}</b>
              {task.handover.note && <span>{task.handover.note}</span>}
              {task.handover.blockedReason && (
                <span className="text-xs text-orange-700">{t.detail.handoverReason}: {t.stuck.reasons[task.handover.blockedReason.split(':')[0]]
                  ? task.handover.blockedReason.replace(/^[A-Z_]+/, m => t.stuck.reasons[m]) : task.handover.blockedReason}</span>
              )}
            </div>
          )}
          {task.state === 'FIX' && <p className="text-sm bg-rose-50 text-rose-800 rounded-xl px-3 py-2">{t.detail.fixNote}</p>}
          {task.state === 'WAITING' && <p className="text-sm bg-sky-50 text-sky-800 rounded-xl px-3 py-2">{t.detail.waitingNote(hhmmVN(task.completedAt))}</p>}
          {task.state === 'APPROVED' && <p className="text-sm bg-emerald-50 text-emerald-800 rounded-xl px-3 py-2">{t.detail.approvedNote}</p>}
          {task.state === 'BLOCKED' && task.blocked_reason && (
            <p className="text-sm bg-purple-50 text-purple-800 rounded-xl px-3 py-2">
              {t.detail.blockedNote(t.stuck.reasons[task.blocked_reason.split(':')[0]] ? task.blocked_reason.replace(/^[A-Z_]+/, m => t.stuck.reasons[m]) : task.blocked_reason)}
            </p>
          )}
          <AcceptBar task={task} logic={logic} />

          {task.room_id && (
            <button type="button" onClick={() => logic.toggleRoomHasGuest(task.room_id!, task.roomHasGuest)}
              className={`self-start min-h-[36px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${task.roomHasGuest ? 'bg-rose-500 text-white' : 'bg-stone-100 text-stone-600'}`}>
              <User size={13} /> {task.roomHasGuest ? `Có khách ${hhmmVN(task.roomHasGuestUpdatedAt)}` : 'Báo có khách'}
            </button>
          )}

          {task.standard_text && (
            <div className="bg-stone-50 rounded-xl px-3 py-2.5 text-sm">
              <b className="block text-[11px] uppercase tracking-wider text-stone-500 mb-0.5">{t.detail.standard}</b>
              {task.standard_text}
            </div>
          )}
          {task.sop && task.sop.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-emerald-900 min-h-[32px] flex items-center">{t.detail.sop}</summary>
              <ul className="list-disc pl-5 mt-1 text-stone-600">{task.sop.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </details>
          )}

          {!named && task.state === 'FIX' && (task.reworkNote || task.reworkPhotoUrl) && (
            <div className="bg-rose-50 rounded-xl px-3 py-2 text-sm text-rose-800 flex flex-col gap-1">
              {task.reworkNote && <span>{t.detail.reworkNote}: {task.reworkNote}</span>}
              {task.reworkPhotoUrl && (
                <button type="button" className="self-start font-bold underline" onClick={() => logic.setLightbox(task.reworkPhotoUrl)}>{t.detail.reworkPhoto}</button>
              )}
            </div>
          )}

          {slots.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {slots.map((s, i) => {
                const rejected = s.slot !== null ? (task.rejected_slots || []).find(r => r.slot === s.slot) || null : null;
                // Named slot: (re)shoot while editable; in FIX only the returned slots.
                // Legacy generic slots: each upload adds one photo, so only the first empty slot shoots.
                const canShoot = editable && (named ? (task.state !== 'FIX' || !!rejected) : !s.photo && i === firstEmptyGeneric);
                const pending = named || i === firstEmptyGeneric ? logic.uploads[uploadKey(task.id, s.slot)] || null : null;
                return (
                  <PhotoSlot
                    key={i}
                    label={s.label}
                    refUrl={s.ref}
                    photo={s.photo}
                    pending={pending}
                    rejected={rejected}
                    canShoot={canShoot}
                    canRemove={editable && task.state !== 'FIX'}
                    onShoot={file => logic.uploadPhoto(task.id, s.slot, file)}
                    onRetry={() => logic.retryUpload(task.id, s.slot)}
                    onRemove={photoId => logic.removePhoto(photoId)}
                    onZoom={url => logic.setLightbox(url)}
                  />
                );
              })}
            </div>
          )}

          {(task.evidence_fields || []).map((f, i) => (
            <EvidenceField key={i} id={`ev-${task.id}-${i}`} field={f} value={task.evidence_values?.[String(i)]} editable={editable}
              onChange={v => logic.setEvidence(task.id, i, v)} />
          ))}

          <StuckControl task={task} logic={logic} />

          {task.history.length > 0 && (
            <div className="border-l-2 border-stone-200 pl-3 flex flex-col gap-1 text-xs text-stone-600">
              <span className="font-bold text-stone-500">{t.detail.history}</span>
              {task.history.map((h, i) => (
                <span key={i}><span className="tabular-nums text-stone-400 mr-1.5">{hhmmVN(h.at)}</span>{t.events[h.type] || h.type}
                  {h.payload?.note ? ` — ${h.payload.note}` : h.payload?.reason ? ` — ${h.payload.reason}` : ''}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskCard;
