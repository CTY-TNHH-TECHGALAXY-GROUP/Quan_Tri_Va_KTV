import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getJson, sendJson } from '../_shared/officeApi';
import { t } from '../_shared/officeAdmin.i18n';

// 🔧 UI CONFIGURATION
const REFRESH_DEBOUNCE_MS = 800;
const POLL_FALLBACK_MS = 60_000;
const TOAST_MS = 2600;

// ============================================================
// Types — mirror getReviewQueue() in lib/services/officeTaskActions.service.ts
// ============================================================
export interface PhotoSlotDef { label: string; ref_path?: string | null }
export interface EvidenceFieldDef { kind: 'check' | 'count'; label: string; unit?: string; min?: number }
export interface QueuePhoto { id: string; slot: number | null; url: string | null }
export interface SlotMark { x: number; y: number }
export interface RejectDraft { slot: number; reason?: string; mark?: SlotMark | null }

export interface QueueTask {
  id: string;
  name: string;
  template_id: string | null;
  task_type: string;
  task_date: string;
  assignee_id: string;
  state: string;
  standard_text: string | null;
  photo_slots: PhotoSlotDef[] | null;
  evidence_fields: EvidenceFieldDef[] | null;
  evidence_values: Record<string, unknown> | null;
  submitted_at: string | null;
  current_review_round: number | null;
  blocked_reason: string | null;
  blocked_at: string | null;
  declined_reason: string | null;
  priority: string | null;
  photos?: QueuePhoto[];
  refs?: (string | null)[];
}

export interface QueuePerson {
  staffId: string;
  name: string;
  position: string | null;
  shiftEnd: string | null;
  total: number;
  approved: number;
  staffToDo: number;
  supervisorToReview: number;
  override: { reason: string; granted_by: string | null } | null;
}

export type QueueTab = 'waiting' | 'blocked' | 'overdue' | 'declined' | 'people';

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** 'YYYY-MM-DD' + n days (calendar math in UTC, no timezone drift). */
export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** Whole days between a task's date and today. */
export const daysLate = (taskDate: string, today: string) =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${taskDate}T00:00:00Z`)) / 86_400_000);

export interface DeferDraft { toDate: string; assigneeId: string | null; note: string; dueTime: string }

export const useReviewQueue = () => {
  const [waiting, setWaiting] = useState<QueueTask[]>([]);
  const [blocked, setBlocked] = useState<QueueTask[]>([]);
  const [declined, setDeclined] = useState<QueueTask[]>([]);
  const [overdue, setOverdue] = useState<QueueTask[]>([]);
  const [people, setPeople] = useState<QueuePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<QueueTab>('waiting');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const json = await getJson('/api/support/review-queue');
      setWaiting(json.waiting || []);
      setBlocked(json.blocked || []);
      setDeclined(json.declined || []);
      setOverdue(json.overdue || []);
      setPeople(json.people || []);
      setLoadError(null);
      // Drop selections that are no longer waiting.
      setSelected(prev => new Set(Array.from(prev).filter(id => (json.waiting || []).some((w: QueueTask) => w.id === id))));
    } catch (e: any) {
      setLoadError(e.message || t.common.error);
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchQueue, REFRESH_DEBOUNCE_MS);
  }, [fetchQueue]);

  useEffect(() => {
    fetchQueue();
    // Realtime on Tasks (published by the Office P0 migration); polling covers RLS / dropped sockets.
    const channel = supabase
      .channel('office-review-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Tasks' }, scheduleRefresh)
      .subscribe();
    const poll = setInterval(fetchQueue, POLL_FALLBACK_MS);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchQueue, scheduleRefresh]);

  const nameOf = useCallback((staffId: string) => people.find(p => p.staffId === staffId)?.name || staffId, [people]);
  const shiftEndOf = useCallback((staffId: string) => people.find(p => p.staffId === staffId)?.shiftEnd || null, [people]);

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  const run = useCallback(async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      showToast(okMsg);
      await fetchQueue();
      return true;
    } catch (e: any) {
      showToast(e.message || t.common.error);
      await fetchQueue();
      return false;
    } finally {
      setBusy(false);
    }
  }, [fetchQueue, showToast]);

  const approve = (ids: string[]) =>
    run(() => sendJson('/api/support/tasks/review', 'POST', { taskIds: ids, decision: 'PASSED' }), t.queue.approved(ids.length));

  const returnTask = (id: string, reasonCode: string, note: string, rejectedSlots: RejectDraft[]) =>
    run(() => sendJson('/api/support/tasks/review', 'POST', {
      taskIds: [id], decision: 'REWORK_REQUIRED', reasonCode, note, rejectedSlots,
    }), t.review.returned);

  const resolveBlocked = (taskId: string) =>
    run(() => sendJson('/api/support/review-queue', 'POST', { taskId }), t.blocked.resumed);

  /** Move an unfinished task to another day / person (lib officeTaskActions.deferTask). */
  const deferTask = (taskId: string, input: DeferDraft) =>
    run(() => sendJson('/api/support/tasks/defer', 'POST', { taskId, ...input }), t.defer.done(ddmm(input.toDate)));

  const cancelTasks = (taskIds: string[], reason: string) =>
    run(async () => {
      for (const id of taskIds) {
        await sendJson(`/api/support/tasks?taskId=${encodeURIComponent(id)}&reason=${encodeURIComponent(reason)}`, 'DELETE');
      }
    }, t.overdue.cancelled);

  const reassign = (taskId: string, assigneeId: string) =>
    run(() => sendJson('/api/support/tasks/reassign', 'POST', { taskId, assigneeId }), t.declined.reassigned);

  const cancelDeclined = (taskId: string) =>
    run(() => sendJson(`/api/support/tasks?taskId=${encodeURIComponent(taskId)}&reason=${encodeURIComponent(t.declined.cancelReason)}`, 'DELETE'), t.declined.cancelled);

  /** Sample photo for a template slot — from a submitted photo, or an uploaded file. Both sides see it. */
  const sampleFromPhoto = (photoId: string) =>
    run(() => sendJson('/api/support/task-template-config/sample', 'POST', { photoId }), t.review.sampleSet);

  const uploadSample = (templateId: string, slot: number, file: File) =>
    run(async () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'ref');
      const res = await fetch('/api/support/tasks/rework-photo', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || t.common.error);
      await sendJson('/api/support/task-template-config/sample', 'POST', { templateId, slot, refPath: json.path });
    }, t.review.sampleSet);

  const grantOverride = (staffId: string, reason: string) =>
    run(() => sendJson('/api/support/checkout-override', 'POST', { staffId, reason }), t.people.allowed);

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = () => setSelected(prev => (prev.size === waiting.length ? new Set() : new Set(waiting.map(w => w.id))));

  const counts = useMemo(() => ({
    waiting: waiting.length, blocked: blocked.length, overdue: overdue.length, declined: declined.length,
    people: people.filter(p => p.staffToDo + p.supervisorToReview > 0 && !p.override).length,
  }), [waiting, blocked, overdue, declined, people]);

  return {
    loading, loadError, tab, setTab, counts,
    waiting, blocked, overdue, declined, people, today: todayVN(),
    selected, toggleSelect, selectAll,
    busy, toast, lightbox, setLightbox,
    nameOf, shiftEndOf, refresh: fetchQueue,
    approve, returnTask, resolveBlocked, deferTask, cancelTasks, reassign, cancelDeclined, grantOverride, sampleFromPhoto, uploadSample,
  };
};

export type ReviewQueueLogic = ReturnType<typeof useReviewQueue>;
