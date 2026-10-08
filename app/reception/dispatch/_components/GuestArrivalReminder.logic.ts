import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useNotifications } from '@/components/NotificationProvider';

// 🔧 CONFIGURATION
const POLL_MS = 30_000;
const DEFAULT_REMINDER_MINUTES = 15;
const API_URL = '/api/reception/guest-arrival';

const toMs = (iso?: string | null) => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Reminds the front desk that "Báo khách" is still on X minutes after it was
 * turned on (it blocks every TYPE_D checkout).
 *
 * ⚠️ Polls the server instead of listening to realtime: GuestArrivalEvents has
 * RLS on with no policy, so browser clients (publishable key) never receive its
 * postgres_changes events. Polling also keeps devices in sync:
 *  - "Vẫn còn khách" writes reminder_snoozed_until → every board picks it up
 *    on its next poll (≤ 30 s). Missing column → snooze stays on this device.
 *  - If the board's own lock state is stale (lock turned on/off from another
 *    device), `onResync` asks the board to re-read it, so the popup and the
 *    "Có Khách" button never disagree and "Tắt" always means turn OFF.
 *
 * Fully isolated: any failure here just means no reminder.
 */
export const useGuestArrivalReminder = (active: boolean, lockedAt: string, onResync?: () => void) => {
  const { playSound } = useNotifications();
  const [reminderMinutes, setReminderMinutes] = useState(DEFAULT_REMINDER_MINUTES);
  const [server, setServer] = useState<{ active: boolean; createdAt: string; snoozeMs: number | null } | null>(null);
  const [localSnoozeMs, setLocalSnoozeMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wasVisibleRef = useRef(false);
  const boardRef = useRef({ active, lockedAt, onResync });
  boardRef.current = { active, lockedAt, onResync };

  const poll = async () => {
    try {
      const res = await apiClient.get<any>(API_URL);
      if (!res?.success) return;
      const m = Number(res.reminderMinutes);
      if (Number.isFinite(m) && m >= 0) setReminderMinutes(m);
      const next = {
        active: !!res.active && !!res.data,
        createdAt: res.data?.created_at ?? '',
        snoozeMs: toMs(res.data?.reminder_snoozed_until),
      };
      setServer(next);
      setNow(Date.now());
      const board = boardRef.current;
      if (next.active !== board.active || (next.active && next.createdAt !== board.lockedAt)) board.onResync?.();
    } catch { /* keep last known state */ }
  };

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // The board toggled the lock here → re-read now; a new lock drops this device's fallback snooze.
  useEffect(() => { setLocalSnoozeMs(null); poll(); }, [active, lockedAt]);

  const lockedAtMs = toMs(lockedAt);
  const sameLock = !!server?.active && server.createdAt === lockedAt;
  const snoozeMs = Math.max(sameLock ? server!.snoozeMs ?? 0 : 0, localSnoozeMs ?? 0) || null;
  const dueAt = snoozeMs ?? (lockedAtMs ?? 0) + reminderMinutes * 60_000;
  const visible = active && sameLock && reminderMinutes > 0 && lockedAtMs !== null && now >= dueAt;

  useEffect(() => {
    if (visible && !wasVisibleRef.current) playSound('default');
    wasVisibleRef.current = visible;
  }, [visible]);

  const snooze = async () => {
    const at = Date.now();
    setNow(at);
    setLocalSnoozeMs(at + reminderMinutes * 60_000);
    try {
      await apiClient.patch<any>(API_URL, { minutes: reminderMinutes });
    } catch {
      // Column missing / network error → snooze stays on this device only.
    }
  };

  return {
    visible,
    elapsedMinutes: lockedAtMs !== null ? Math.max(0, Math.floor((now - lockedAtMs) / 60_000)) : 0,
    snooze,
  };
};
