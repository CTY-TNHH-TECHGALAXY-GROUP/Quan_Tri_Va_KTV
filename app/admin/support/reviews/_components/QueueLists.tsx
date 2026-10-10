'use client';

import React, { useState } from 'react';
import { t } from '../../_shared/officeAdmin.i18n';
import { hhmmVN, type StaffOption } from '../../_shared/officeApi';
import { useOfficeOptions } from '../../_shared/AdhocAssign.logic';
import type { AdhocAssignLogic } from '../../_shared/AdhocAssign.logic';
import { daysLate, ddmm, type QueuePerson, type QueueTask, type ReviewQueueLogic } from '../SupportReviews.logic';
import DeferForm from './DeferForm';

const BTN = 'min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40';
const CARD = 'bg-white rounded-2xl border border-stone-200 p-4 flex flex-col gap-3';

const Empty = ({ text }: { text: string }) => <p className="text-center text-stone-400 py-14">{text}</p>;

/** "CODE: note" stored by blockTask → readable label. */
const blockLabel = (raw: string | null) => {
  if (!raw) return '';
  const [code, ...rest] = raw.split(':');
  const label = t.blocked.reasons[code.trim()];
  return label ? [label, rest.join(':').trim()].filter(Boolean).join(' — ') : raw;
};

// ============================================================
// Báo vướng → làm tiếp, hoặc dời sang ngày khác (bàn giao)
// ============================================================
const BlockedCard = ({ task, logic, staff }: { task: QueueTask; logic: ReviewQueueLogic; staff: StaffOption[] }) => {
  const [deferring, setDeferring] = useState(false);
  return (
    <article className={CARD}>
      <div>
        <h3 className="text-[15px] font-semibold text-stone-800">{task.name}</h3>
        <p className="text-xs text-stone-500 mt-0.5">
          <span className="font-semibold text-stone-700">{logic.nameOf(task.assignee_id)}</span>
          {task.task_date !== logic.today && <span className="text-amber-700 font-bold"> · {t.review.fromDay(ddmm(task.task_date))}</span>}
          {task.blocked_at && <span> · {t.blocked.at(hhmmVN(task.blocked_at))}</span>}
        </p>
      </div>
      <p className="text-sm bg-purple-50 text-purple-800 rounded-xl px-3 py-2">{blockLabel(task.blocked_reason)}</p>
      {deferring ? (
        <DeferForm task={task} logic={logic} staff={staff} defaultNote={blockLabel(task.blocked_reason)} onDone={() => setDeferring(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={logic.busy} onClick={() => logic.resolveBlocked(task.id)} className={`${BTN} bg-emerald-800 text-white`}>{t.blocked.resume}</button>
          <button type="button" disabled={logic.busy} onClick={() => setDeferring(true)} className={`${BTN} bg-white border border-orange-300 text-orange-800`}>{t.defer.open}</button>
        </div>
      )}
    </article>
  );
};

export const BlockedList = ({ logic }: { logic: ReviewQueueLogic }) => {
  const { staff } = useOfficeOptions(logic.blocked.length > 0);
  if (!logic.blocked.length) return <Empty text={t.queue.emptyBlocked} />;
  return (
    <div className="flex flex-col gap-3">
      {logic.blocked.map(task => <BlockedCard key={task.id} task={task} logic={logic} staff={staff} />)}
    </div>
  );
};

// ============================================================
// Quá hạn (7 ngày) — dời / đóng; không chặn tan ca nhân viên
// ============================================================
const OverdueRow = ({ task, logic, staff }: { task: QueueTask; logic: ReviewQueueLogic; staff: StaffOption[] }) => {
  const [deferring, setDeferring] = useState(false);
  return (
    <div className="flex flex-col gap-2 py-2.5 border-t border-stone-100 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex-1 min-w-[180px] text-sm text-stone-800">{task.name}</span>
        {!deferring && (
          <span className="flex gap-2">
            <button type="button" disabled={logic.busy} onClick={() => setDeferring(true)} className="min-h-[40px] px-3 rounded-lg text-xs font-bold border border-orange-300 text-orange-800 disabled:opacity-40">{t.defer.open}</button>
            <button type="button" disabled={logic.busy} onClick={() => logic.cancelTasks([task.id], t.overdue.cancelReason)} className="min-h-[40px] px-3 rounded-lg text-xs font-bold border border-stone-300 text-stone-600 disabled:opacity-40">{t.overdue.cancel}</button>
          </span>
        )}
      </div>
      {deferring && <DeferForm task={task} logic={logic} staff={staff} defaultNote="" onDone={() => setDeferring(false)} />}
    </div>
  );
};

export const OverdueList = ({ logic }: { logic: ReviewQueueLogic }) => {
  const { staff } = useOfficeOptions(logic.overdue.length > 0);
  if (!logic.overdue.length) return <Empty text={t.queue.emptyOverdue} />;
  // One card per person per day — a skipped day can leave dozens of daily checklist items.
  const groups: { key: string; date: string; staffId: string; tasks: QueueTask[] }[] = [];
  logic.overdue.forEach(task => {
    const key = `${task.task_date}|${task.assignee_id}`;
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, date: task.task_date, staffId: task.assignee_id, tasks: [] }; groups.push(g); }
    g.tasks.push(task);
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-stone-500">{t.overdue.hint}</p>
      {groups.map(g => (
        <article key={g.key} className={CARD}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-[15px] font-semibold text-stone-800">{logic.nameOf(g.staffId)} <span className="text-xs font-normal text-stone-400">{g.staffId}</span></h3>
              <p className="text-xs mt-0.5">
                <span className="text-stone-600">{t.review.fromDay(ddmm(g.date))}</span>
                <span className="ml-2 font-bold text-rose-700">{t.overdue.days(daysLate(g.date, logic.today))}</span>
              </p>
            </div>
            {g.tasks.length > 1 && (
              <button type="button" disabled={logic.busy}
                onClick={() => { if (window.confirm(t.overdue.confirmGroup(g.tasks.length, logic.nameOf(g.staffId), ddmm(g.date)))) logic.cancelTasks(g.tasks.map(x => x.id), t.overdue.cancelReason); }}
                className="min-h-[40px] px-3 rounded-lg text-xs font-bold border border-stone-300 text-stone-600 disabled:opacity-40">{t.overdue.cancelGroup(g.tasks.length)}</button>
            )}
          </div>
          <div>{g.tasks.map(task => <OverdueRow key={task.id} task={task} logic={logic} staff={staff} />)}</div>
        </article>
      ))}
    </div>
  );
};

// ============================================================
// Bị từ chối → quay về người giao: giao lại hoặc huỷ
// ============================================================
const DeclinedCard = ({ task, logic, staff }: { task: QueueTask; logic: ReviewQueueLogic; staff: { id: string; name: string }[] }) => {
  const [assignee, setAssignee] = useState('');
  return (
    <article className={CARD}>
      <div>
        <h3 className="text-[15px] font-semibold text-stone-800">{task.name}</h3>
        <p className="text-xs text-stone-500 mt-0.5">{t.declined.by(logic.nameOf(task.assignee_id))}</p>
      </div>
      {task.declined_reason && <p className="text-sm bg-stone-100 text-stone-700 rounded-xl px-3 py-2">{task.declined_reason}</p>}
      <div className="flex flex-wrap gap-2">
        <select value={assignee} onChange={e => setAssignee(e.target.value)} aria-label={t.declined.pickAssignee}
          className="flex-1 min-w-[180px] min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm">
          <option value="">{t.declined.pickAssignee}</option>
          {staff.filter(s => s.id !== task.assignee_id).map(s => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
        </select>
        <button type="button" disabled={!assignee || logic.busy} onClick={() => logic.reassign(task.id, assignee)} className={`${BTN} bg-emerald-800 text-white`}>{t.declined.reassign}</button>
        <button type="button" disabled={logic.busy} onClick={() => logic.cancelDeclined(task.id)} className={`${BTN} bg-white border border-stone-300 text-stone-600`}>{t.declined.cancel}</button>
      </div>
    </article>
  );
};

export const DeclinedList = ({ logic }: { logic: ReviewQueueLogic }) => {
  const { staff } = useOfficeOptions(logic.declined.length > 0);
  if (!logic.declined.length) return <Empty text={t.queue.emptyDeclined} />;
  return (
    <div className="flex flex-col gap-3">
      {logic.declined.map(task => <DeclinedCard key={task.id} task={task} logic={logic} staff={staff} />)}
    </div>
  );
};

// ============================================================
// Nhân viên & tan ca
// ============================================================
const PersonCard = ({ person, logic, adhoc }: { person: QueuePerson; logic: ReviewQueueLogic; adhoc: AdhocAssignLogic }) => {
  const [allowing, setAllowing] = useState(false);
  const [reason, setReason] = useState('');
  const blockingCount = person.staffToDo + person.supervisorToReview;
  const pct = person.total ? Math.round((person.approved / person.total) * 100) : 0;

  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-stone-800">{person.name} <span className="text-xs font-normal text-stone-400">{person.staffId}</span></h3>
          <p className="text-xs text-stone-500 mt-0.5 flex flex-wrap gap-x-2.5">
            {person.position && <span>{person.position}</span>}
            {person.shiftEnd && <span>{t.people.shiftEnd(person.shiftEnd.slice(0, 5))}</span>}
            <span className="tabular-nums">{t.people.progress(person.approved, person.total)}</span>
          </p>
        </div>
        <button type="button" onClick={() => adhoc.start({ assigneeId: person.staffId })}
          className="min-h-[40px] px-3 rounded-lg text-xs font-bold border border-stone-300 text-stone-600 shrink-0">{t.people.giveTask}</button>
      </div>
      <div className="h-2 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>

      {person.override ? (
        <p className="text-sm bg-emerald-50 text-emerald-800 rounded-xl px-3 py-2">{t.people.override(person.override.reason)}</p>
      ) : blockingCount === 0 ? (
        <p className="text-sm bg-emerald-50 text-emerald-800 rounded-xl px-3 py-2">{t.people.free}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            {person.staffToDo > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">{t.people.staffToDo(person.staffToDo)}</span>}
            {person.supervisorToReview > 0 && <span className="px-2.5 py-1 rounded-full bg-sky-100 text-sky-700">{t.people.toReview(person.supervisorToReview)}</span>}
          </div>
          {!allowing ? (
            <button type="button" onClick={() => setAllowing(true)} className={`${BTN} self-start bg-white border border-stone-300 text-stone-700`}>{t.people.allow}</button>
          ) : (
            <div className="flex flex-col gap-2 bg-stone-50 rounded-xl p-3">
              <span className="text-sm font-bold text-stone-700">{t.people.allowTitle(person.name)}</span>
              <span className="text-xs text-stone-500">{t.people.allowHint}</span>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder={t.people.reasonPlaceholder} aria-label={t.people.reasonPlaceholder}
                className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-sm" />
              <div className="flex gap-2">
                <button type="button" disabled={!reason.trim() || logic.busy}
                  onClick={async () => { if (await logic.grantOverride(person.staffId, reason.trim())) setAllowing(false); }}
                  className={`${BTN} bg-emerald-800 text-white`}>{t.people.allow}</button>
                <button type="button" onClick={() => setAllowing(false)} className={`${BTN} bg-white border border-stone-300 text-stone-600`}>{t.common.cancel}</button>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
};

export const PeopleList = ({ logic, adhoc }: { logic: ReviewQueueLogic; adhoc: AdhocAssignLogic }) => {
  if (!logic.people.length) return <Empty text={t.queue.emptyPeople} />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {logic.people.map(p => <PersonCard key={p.staffId} person={p} logic={logic} adhoc={adhoc} />)}
    </div>
  );
};
