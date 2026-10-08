'use client';

import React from 'react';
import { BellRing } from 'lucide-react';
import { t } from './GuestArrivalReminder.i18n';
import { useGuestArrivalReminder } from './GuestArrivalReminder.logic';

interface Props {
  active: boolean;
  lockedAt: string;
  lockedBy: string;
  onTurnOff: () => void;
  /** Re-read the board's lock state (it went stale vs. the server). */
  onResync?: () => void;
}

export const GuestArrivalReminder = ({ active, lockedAt, lockedBy, onTurnOff, onResync }: Props) => {
  const { visible, elapsedMinutes, snooze } = useGuestArrivalReminder(active, lockedAt, onResync);
  if (!visible) return null;

  const since = new Date(lockedAt).toLocaleTimeString('vi-VN', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
  });

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div role="alertdialog" aria-labelledby="guest-arrival-reminder-title" className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
            <BellRing size={22} className="text-amber-600" />
          </div>
          <h3 id="guest-arrival-reminder-title" className="text-lg font-black text-gray-900">{t.title}</h3>
        </div>
        <p className="text-sm text-gray-700 font-medium leading-relaxed">
          {t.message(elapsedMinutes, since, lockedBy)}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onTurnOff}
            className="w-full min-h-[44px] py-3 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold rounded-2xl transition-all"
          >
            {t.turnOff}
          </button>
          <button
            onClick={snooze}
            className="w-full min-h-[44px] py-3 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold rounded-2xl transition-all"
          >
            {t.keep}
          </button>
        </div>
      </div>
    </div>
  );
};
