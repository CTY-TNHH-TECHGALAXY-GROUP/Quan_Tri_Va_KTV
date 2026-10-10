'use client';

import React from 'react';
import { t } from '../../_shared/officeAdmin.i18n';
import { useAdhocAssign } from '../../_shared/AdhocAssign.logic';
import AdhocAssignSheet from '../../_shared/AdhocAssignSheet';
import { useReviewQueue, type QueueTab } from '../SupportReviews.logic';
import ReviewCard from './ReviewCard';
import { BlockedList, DeclinedList, OverdueList, PeopleList } from './QueueLists';

const TABS: QueueTab[] = ['waiting', 'blocked', 'overdue', 'declined', 'people'];

/** Supervisor "Cần tôi xử lý" — used by /admin/support/reviews and the "Giao Việc" hub tab. */
const ReviewQueue = () => {
  const logic = useReviewQueue();
  const adhoc = useAdhocAssign(logic.refresh);

  if (logic.loading) return <p className="text-center text-stone-400 py-14">{t.common.loading}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-stone-800">{t.queue.title}</h2>
          <p className="text-sm text-stone-500">{t.queue.subtitle}</p>
        </div>
        <button type="button" onClick={() => adhoc.start()} className="min-h-[44px] px-4 rounded-xl bg-rose-600 text-white text-sm font-bold">
          + {t.queue.assignAdhoc}
        </button>
      </div>

      {logic.loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-rose-50 text-rose-800 rounded-xl px-3 py-2 text-sm">
          {logic.loadError}
          <button type="button" onClick={logic.refresh} className="font-bold underline min-h-[36px]">{t.common.retry}</button>
        </div>
      )}

      <div role="tablist" className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map(k => (
          <button key={k} role="tab" type="button" aria-selected={logic.tab === k} onClick={() => logic.setTab(k)}
            className={`min-h-[44px] px-4 rounded-full text-sm font-semibold whitespace-nowrap border ${logic.tab === k ? 'bg-emerald-800 border-emerald-800 text-white' : 'bg-white border-stone-200 text-stone-600'}`}>
            {t.queue.tabs[k]}
            {logic.counts[k] > 0 && (
              <span className={`ml-2 text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${logic.tab === k ? 'bg-white/20' : 'bg-rose-100 text-rose-700'}`}>{logic.counts[k]}</span>
            )}
          </button>
        ))}
      </div>

      {logic.tab === 'waiting' && (
        logic.waiting.length === 0 ? <p className="text-center text-stone-400 py-14">{t.queue.emptyWaiting}</p> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2 min-h-[44px] text-stone-600">
                <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={logic.selected.size === logic.waiting.length} onChange={logic.selectAll} />
                {logic.selected.size ? t.queue.selected(logic.selected.size) : t.queue.selectAll}
              </label>
              <span className="text-xs text-stone-400">{t.queue.orderHint}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {logic.waiting.map(task => <ReviewCard key={task.id} task={task} logic={logic} />)}
            </div>
          </>
        )
      )}
      {logic.tab === 'blocked' && <BlockedList logic={logic} />}
      {logic.tab === 'overdue' && <OverdueList logic={logic} />}
      {logic.tab === 'declined' && <DeclinedList logic={logic} />}
      {logic.tab === 'people' && <PeopleList logic={logic} adhoc={adhoc} />}

      {logic.tab === 'waiting' && logic.selected.size > 0 && (
        <div className="sticky bottom-3 z-20 flex justify-center">
          <button type="button" disabled={logic.busy} onClick={() => logic.approve(Array.from(logic.selected))}
            className="min-h-[52px] px-6 rounded-2xl bg-emerald-800 text-white text-sm font-bold shadow-lg disabled:opacity-50">
            {t.queue.approveSelected(logic.selected.size)}
          </button>
        </div>
      )}

      <AdhocAssignSheet logic={adhoc} />
      {logic.lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-5" onClick={() => logic.setLightbox(null)}>
          <img src={logic.lightbox} alt="" className="max-w-full max-h-[88vh] rounded-xl" />
        </div>
      )}
      {logic.toast && (
        <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[70] bg-stone-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg max-w-[calc(100%-2rem)] text-center">
          {logic.toast}
        </div>
      )}
    </div>
  );
};

export default ReviewQueue;
