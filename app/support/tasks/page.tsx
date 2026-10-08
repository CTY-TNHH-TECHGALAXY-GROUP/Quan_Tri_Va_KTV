'use client';

import React from 'react';
import { AlertCircle, FolderOpen } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { useSupportTasks } from './SupportEmployeeTasks.logic';
import { t } from './SupportTasks.i18n';
import ShiftHeader from './_components/ShiftHeader';
import TaskFilters from './_components/TaskFilters';
import TaskCard from './_components/TaskCard';
import CheckoutCheckSheet from './_components/CheckoutCheckSheet';

const SupportEmployeeTasksPage = () => {
  const { user } = useAuth();
  const logic = useSupportTasks();

  if (logic.loading) {
    return (
      <AppLayout title={t.pageTitle}>
        <div className="flex items-center justify-center min-h-[70vh] bg-white">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-emerald-700 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-stone-500">{t.loading}</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const approved = logic.counts.APPROVED || 0;

  return (
    <AppLayout title={t.pageTitle}>
      <div className="min-h-screen bg-white pb-28">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col gap-4">
          <ShiftHeader logic={logic} name={user?.name || user?.code || ''} code={user?.code || ''} />

          {logic.notifications.map(n => (
            <div key={n.id} className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-3">
              <AlertCircle className="text-rose-500 mt-0.5 shrink-0" size={18} />
              <p className="flex-1 text-sm font-medium text-rose-800">{n.message}</p>
              <button type="button" onClick={() => logic.dismissNotification(n.id)} className="text-rose-400 min-h-[32px] px-1" aria-label="Đóng">✕</button>
            </div>
          ))}

          <TaskFilters logic={logic} />

          {logic.sections.top.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-stone-600">
                {t.groups.attention} <span className="normal-case font-normal tracking-normal text-stone-400">· {t.groups.attentionHint}</span>
              </h2>
              {logic.sections.top.map(task => <TaskCard key={task.id} task={task} logic={logic} />)}
            </section>
          )}

          {logic.sections.groups.map(g => (
            <section key={g.name} className="flex flex-col gap-2">
              {/* Group = where the task sits in the shift; neutral folder header, never a status colour. */}
              <h2 className="flex items-center gap-2 border-b border-stone-200 pb-1.5 text-sm font-bold text-stone-800">
                <FolderOpen size={16} className="text-stone-400 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{g.name}</span>
                <span className="text-xs font-normal text-stone-400 tabular-nums">{t.groups.count(g.tasks.length)}</span>
              </h2>
              {g.tasks.map(task => <TaskCard key={task.id} task={task} logic={logic} showGroup={false} />)}
            </section>
          ))}

          {logic.tasks.length === 0 && <p className="text-center text-stone-500 py-16">{t.empty}</p>}
          {logic.tasks.length > 0 && logic.sections.top.length === 0 && logic.sections.groups.length === 0 && (
            <p className="text-center text-stone-400 italic py-8">{t.noMatch}</p>
          )}
        </div>

        <div className="fixed left-0 right-0 bottom-0 z-30 bg-white border-t border-stone-200 pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="text-xs text-stone-600 leading-tight">
              <b className="text-sm text-stone-800 tabular-nums">{t.bottomSummary(approved, logic.activeTasks.length)}</b><br />
              {t.bottomDetail(logic.counts.WAITING || 0, logic.counts.FIX || 0)}
            </div>
            <button type="button" onClick={() => logic.setSheetOpen(true)} className="min-h-[44px] px-4 rounded-xl bg-emerald-800 text-white text-sm font-bold">
              {t.checkButton}
            </button>
          </div>
        </div>

        <CheckoutCheckSheet logic={logic} />

        {logic.lightbox && (
          <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-5" onClick={() => logic.setLightbox(null)}>
            <img src={logic.lightbox} alt="" className="max-w-full max-h-[88vh] rounded-xl" />
          </div>
        )}
        {logic.toast && (
          <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[70] bg-stone-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg max-w-[calc(100%-2rem)] text-center">
            {logic.toast}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default SupportEmployeeTasksPage;
