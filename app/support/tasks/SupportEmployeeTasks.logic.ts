import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { compressImageWithWatermark } from '@/lib/camera.logic';
import { useAuth } from '@/lib/auth-context';
import { t } from './SupportTasks.i18n';

// ============================================================
// 🔧 UI CONFIGURATION
// ============================================================
const TOAST_MS = 2800;
const PHOTO_MAX_WIDTH = 1280;
const PHOTO_QUALITY = 0.72;

// ============================================================
// Types (shape returned by GET /api/support/tasks — Office P0)
// ============================================================
export type TaskState = 'OFFERED' | 'TODO' | 'DOING' | 'WAITING' | 'FIX' | 'APPROVED' | 'BLOCKED' | 'DECLINED' | 'CANCELLED';
export interface PhotoSlotDef { label: string; ref_path?: string | null }
export interface EvidenceFieldDef { kind: 'check' | 'count'; label: string; unit?: string; min?: number }
export interface TaskPhoto { id: string; slot: number | null; url: string | null; createdAt: string }
export interface RejectedSlot { slot: number; reason?: string; mark?: { x: number; y: number } | null }

export interface TaskItem {
  id: string;
  name: string;
  state: TaskState;
  status: string;
  inspection_status: string;
  task_type: string;
  priority: string;
  min_photo_count: number;
  requires_photo: boolean;
  photo_slots: PhotoSlotDef[] | null;
  photos: TaskPhoto[];
  /** Supervisor-set sample photo per slot (same picture the supervisor sees). */
  refs: (string | null)[];
  evidence_fields: EvidenceFieldDef[] | null;
  evidence_values: Record<string, boolean | number>;
  standard_text: string | null;
  sop: string[] | null;
  time_mode: string;
  due_at: string | null;
  window_start_at: string | null;
  window_end_at: string | null;
  blocks_checkout: boolean;
  acceptance_status: string;
  canDecline: boolean;
  rejected_slots: RejectedSlot[] | null;
  blocked_reason: string | null;
  slot_time: string | null;
  task_date: string;
  room_id: string | null;
  categoryName: string;
  roomHasGuest: boolean;
  roomHasGuestUpdatedAt: string | null;
  sortOrder: number;
  isCarryOver: boolean;
  reworkNote: string | null;
  reworkPhotoUrl: string | null;
  history: { type: string; payload: any; at: string }[];
  completedAt: string | null;
}

export interface CheckoutPicture {
  enabled: boolean;
  count: number;
  items: { id: string; name: string; state: TaskState; carry: boolean }[];
  override?: { reason: string; granted_by: string | null } | null;
}

/** 'all' or one concrete task state — the chips are generated from the states present today. */
export type StatusFilter = 'all' | TaskState;

export type GroupSort = 'shift' | 'remaining';

export interface GroupStat { name: string; order: string | null; title: string; time: string | null; total: number; done: number; remaining: number }

/** "1. Chuẩn bị sân ngoài (Trước 09:00)" → order "1", title, time. Names without that shape keep the whole text as title. */
export const parseGroupName = (name: string) => {
  const m = name.match(/^(\d+)\.\s*(.*?)\s*(?:\(([^()]*)\))?$/);
  return m ? { order: m[1], title: m[2] || name, time: m[3] || null } : { order: null, title: name, time: null };
};

/** Display order of state chips (most urgent first). */
export const STATE_CHIP_ORDER: TaskState[] = ['FIX', 'OFFERED', 'BLOCKED', 'TODO', 'DOING', 'WAITING', 'APPROVED', 'DECLINED'];
type UploadStatus = 'uploading' | 'queued' | 'failed';
export interface PendingUpload { taskId: string; slot: number | null; previewUrl: string; status: UploadStatus; file: File }

interface TaskNotification { id: string; message: string; type: string; created_at: string; employee_id?: string }

// ============================================================
// Helpers
// ============================================================
const slotKey = (taskId: string, slot: number | null) => `${taskId}:${slot ?? 'x'}`;

const dataUriToFile = (dataUri: string, filename: string): File => {
  const [head, body] = dataUri.split(',');
  const mime = head.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
};

/** HH:mm in Vietnam time for an ISO instant (device timezone independent). */
export const hhmmVN = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '';

/** Number of evidence slots a task needs and how many are filled — display only, the server decides submission. */
export const slotProgress = (task: TaskItem) => {
  const named = task.photo_slots?.length || 0;
  const photoNeed = named || (task.requires_photo ? task.min_photo_count : 0);
  const photoDone = named
    ? task.photo_slots!.filter((_, i) => task.photos.some(p => p.slot === i)).length
    : Math.min(task.photos.length, photoNeed);
  const fields = task.evidence_fields || [];
  const fieldDone = fields.filter((f, i) => {
    const v = task.evidence_values?.[String(i)];
    return f.kind === 'check' ? v === true : typeof v === 'number';
  }).length;
  return { done: photoDone + fieldDone, total: photoNeed + fields.length };
};

// ============================================================
// Hook
// ============================================================
export const useSupportTasks = () => {
  const { user } = useAuth();
  const employeeId = user?.id || null;
  const userCode = user?.code || null;

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [checkout, setCheckout] = useState<CheckoutPicture | null>(null);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [groupSort, setGroupSort] = useState<GroupSort>('shift');
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploads, setUploads] = useState<Record<string, PendingUpload>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // ------------------------------------------------------------
  // Load
  // ------------------------------------------------------------
  const fetchTasks = useCallback(async () => {
    if (!employeeId) return;
    try {
      const codeParam = userCode ? `&userCode=${encodeURIComponent(userCode)}` : '';
      const res = await fetch(`/api/support/tasks?employeeId=${encodeURIComponent(employeeId)}${codeParam}&t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setTasks(json.data || []);
        setCheckout(json.checkout || null);
      } else {
        console.error('API error fetching tasks:', json.error);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    }
  }, [employeeId, userCode]);

  const fetchNotifications = useCallback(async () => {
    if (!employeeId) return;
    const ids = Array.from(new Set([employeeId, userCode].filter(Boolean))) as string[];
    const { data, error } = await supabase
      .from('TaskNotifications')
      .select('*')
      .in('employee_id', ids)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) {
      console.error('Error fetching task notifications:', error.message);
      return;
    }
    setNotifications(data || []);
  }, [employeeId, userCode]);

  const dismissNotification = async (notifId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== notifId));
    const owner = notifications.find(n => n.id === notifId)?.employee_id || userCode || employeeId;
    try {
      await fetch('/api/support/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: owner, notificationIds: [notifId] }),
      });
    } catch (e) {
      console.error('Error marking notification read:', e);
    }
  };

  useEffect(() => {
    if (!employeeId) return;
    (async () => {
      setLoading(true);
      await Promise.all([fetchTasks(), fetchNotifications()]);
      setLoading(false);
    })();
  }, [employeeId, fetchTasks, fetchNotifications]);

  // Realtime: new task / returned task / approval for this employee
  useEffect(() => {
    if (!userCode && !employeeId) return;
    const channel = supabase
      .channel(`task-notifications-${userCode || employeeId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'TaskNotifications',
        filter: `employee_id=eq.${userCode || employeeId}`,
      }, (payload) => {
        setNotifications(prev => [payload.new as TaskNotification, ...prev]);
        fetchTasks();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [employeeId, userCode, fetchTasks]);

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  const postAction = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch('/api/support/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || t.toast.error);
    return json;
  }, []);

  const runAction = useCallback(async (body: Record<string, unknown>, okMsg?: string) => {
    try {
      const json = await postAction(body);
      if (json.submitted) showToast(t.toast.submitted);
      else if (okMsg) showToast(okMsg);
      await fetchTasks();
      return true;
    } catch (e: any) {
      showToast(e.message || t.toast.error);
      return false;
    }
  }, [postAction, fetchTasks, showToast]);

  const acceptTask = (taskId: string) => runAction({ action: 'ACCEPT', taskId }, t.toast.accepted);
  const declineTask = (taskId: string, reason: string) => runAction({ action: 'DECLINE', taskId, reason }, t.toast.declined);
  const blockTask = (taskId: string, reasonCode: string, note: string) => runAction({ action: 'BLOCK', taskId, reasonCode, note }, t.toast.stuckSent);
  const unblockTask = (taskId: string) => runAction({ action: 'UNBLOCK', taskId });
  const setEvidence = (taskId: string, index: number, value: boolean | number) =>
    runAction({ action: 'EVIDENCE', taskId, values: { [String(index)]: value } });

  const removePhoto = async (photoId: string) => {
    const res = await fetch(`/api/support/tasks/photo?id=${encodeURIComponent(photoId)}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) showToast(json.error || t.toast.error);
    await fetchTasks();
  };

  /** Send one queued/new upload. Network failure → stays queued; server refusal → dropped with a message. */
  const sendUpload = useCallback(async (u: PendingUpload) => {
    const key = slotKey(u.taskId, u.slot);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setUploads(prev => ({ ...prev, [key]: { ...u, status: 'queued' } }));
      return;
    }
    setUploads(prev => ({ ...prev, [key]: { ...u, status: 'uploading' } }));
    const form = new FormData();
    form.append('file', u.file);
    form.append('taskId', u.taskId);
    form.append('employeeId', userCode || employeeId || '');
    if (u.slot !== null) form.append('slotIndex', String(u.slot));
    let res: Response;
    try {
      res = await fetch('/api/support/tasks/upload', { method: 'POST', body: form });
    } catch {
      setUploads(prev => ({ ...prev, [key]: { ...u, status: 'queued' } }));
      showToast(t.toast.queued);
      return;
    }
    const json = await res.json().catch(() => ({}));
    if (res.status >= 500) {
      setUploads(prev => ({ ...prev, [key]: { ...u, status: 'failed' } }));
      return;
    }
    setUploads(prev => { const next = { ...prev }; delete next[key]; return next; });
    if (!res.ok || json.success === false) {
      showToast(json.error || t.toast.error);
    } else if (json.submitted) {
      showToast(t.toast.submitted);
    }
    await fetchTasks();
  }, [employeeId, userCode, fetchTasks, showToast]);

  const uploadPhoto = async (taskId: string, slot: number | null, file: File) => {
    let finalFile = file;
    let previewUrl = '';
    try {
      const dataUri = await compressImageWithWatermark(file, {
        maxWidth: PHOTO_MAX_WIDTH, quality: PHOTO_QUALITY, watermarkText: `${userCode || ''} ${hhmmVN(new Date().toISOString())}`,
      });
      finalFile = dataUriToFile(dataUri, file.name || 'photo.jpg');
      previewUrl = dataUri;
    } catch (err: any) {
      if (err?.message === 'TOO_DARK') { showToast(t.toast.tooDark); return; }
      previewUrl = URL.createObjectURL(file);
    }
    await sendUpload({ taskId, slot, previewUrl, status: 'uploading', file: finalFile });
  };

  const retryUpload = (taskId: string, slot: number | null) => {
    const u = uploads[slotKey(taskId, slot)];
    if (u) sendUpload(u);
  };

  // Flush the queue when the connection comes back
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  useEffect(() => {
    const onOnline = () => {
      const queued = Object.values(uploadsRef.current).filter(u => u.status === 'queued' || u.status === 'failed');
      if (queued.length) showToast(t.toast.online);
      queued.forEach(u => sendUpload(u));
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [sendUpload, showToast]);

  const toggleRoomHasGuest = async (roomId: string, current: boolean) => {
    setTasks(prev => prev.map(x => x.room_id === roomId ? { ...x, roomHasGuest: !current } : x));
    try {
      const res = await fetch('/api/rooms', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, has_guests: !current }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
    } catch {
      setTasks(prev => prev.map(x => x.room_id === roomId ? { ...x, roomHasGuest: current } : x));
    }
  };

  // ------------------------------------------------------------
  // Derived view
  // ------------------------------------------------------------
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    tasks.forEach(x => { c[x.state] = (c[x.state] || 0) + 1; });
    return c;
  }, [tasks]);

  // Group names sort "1. …", "2. …" in numeric order so the list follows the shift.
  const byName = (a: string, b: string) => a.localeCompare(b, 'vi', { numeric: true });
  const groupNames = useMemo(() => Array.from(new Set(tasks.map(x => x.categoryName))).sort(byName), [tasks]);
  // Per-group progress for the group rail; "remaining" = not approved yet (waiting counts as remaining for the shift).
  const groupStats = useMemo<GroupStat[]>(() => {
    const live = tasks.filter(x => x.state !== 'CANCELLED' && x.state !== 'DECLINED');
    const stats = groupNames.map(name => {
      const mine = live.filter(x => x.categoryName === name);
      const done = mine.filter(x => x.state === 'APPROVED').length;
      return { name, ...parseGroupName(name), total: mine.length, done, remaining: mine.length - done };
    }).filter(g => g.total > 0);
    return groupSort === 'remaining'
      ? [...stats].sort((a, b) => (b.remaining - a.remaining) || byName(a.name, b.name))
      : stats;
  }, [tasks, groupNames, groupSort]);
  const stateChips = useMemo(() => STATE_CHIP_ORDER.filter(st => counts[st]).map(st => ({ state: st, count: counts[st] })), [counts]);

  const visible = useMemo(() => tasks.filter(x => {
    if (x.state === 'CANCELLED') return false;
    if (statusFilter !== 'all' && x.state !== statusFilter) return false;
    if (groupFilter !== 'all' && x.categoryName !== groupFilter) return false;
    return true;
  }), [tasks, statusFilter, groupFilter]);

  const sections = useMemo(() => {
    const needsAttention = (x: TaskItem) =>
      x.state !== 'APPROVED' && x.state !== 'DECLINED'
      && (x.state === 'FIX' || x.state === 'OFFERED' || x.state === 'BLOCKED' || x.task_type === 'AD-HOC' || x.isCarryOver);
    const top = visible.filter(needsAttention);
    const rest = visible.filter(x => !needsAttention(x));
    const byGroup: { name: string; tasks: TaskItem[] }[] = [];
    rest.forEach(x => {
      let g = byGroup.find(b => b.name === x.categoryName);
      if (!g) { g = { name: x.categoryName, tasks: [] }; byGroup.push(g); }
      g.tasks.push(x);
    });
    // Sections follow the same order as the group rail.
    const rank = (n: string) => { const i = groupStats.findIndex(g => g.name === n); return i < 0 ? 999 : i; };
    byGroup.sort((a, b) => rank(a.name) - rank(b.name));
    byGroup.forEach(g => g.tasks.sort((a, b) => (a.sortOrder - b.sortOrder) || (a.slot_time || '').localeCompare(b.slot_time || '')));
    return { top, groups: byGroup };
  }, [visible, groupStats]);

  const activeTasks = tasks.filter(x => x.state !== 'CANCELLED' && x.state !== 'DECLINED');
  const pendingUploadCount = Object.values(uploads).length;

  const gotoTask = (taskId: string) => {
    setSheetOpen(false);
    setStatusFilter('all');
    setGroupFilter('all');
    setOpenId(taskId);
    setTimeout(() => document.getElementById(`task-${taskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  return {
    loading, tasks, checkout, counts, sections, groupNames, stateChips, activeTasks,
    statusFilter, setStatusFilter, groupFilter, setGroupFilter, groupStats, groupSort, setGroupSort,
    openId, setOpenId, sheetOpen, setSheetOpen, gotoTask,
    uploads, pendingUploadCount, uploadPhoto, retryUpload, removePhoto,
    acceptTask, declineTask, blockTask, unblockTask, setEvidence, toggleRoomHasGuest,
    notifications, dismissNotification,
    toast, lightbox, setLightbox,
  };
};

export type SupportTasksLogic = ReturnType<typeof useSupportTasks>;
export const uploadKey = slotKey;
