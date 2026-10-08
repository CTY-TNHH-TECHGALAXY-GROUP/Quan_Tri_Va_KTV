'use client';

import React, { useRef } from 'react';
import { Camera, X } from 'lucide-react';
import { t } from '../SupportTasks.i18n';
import type { PendingUpload, RejectedSlot, TaskPhoto } from '../SupportEmployeeTasks.logic';

// 🔧 UI CONFIGURATION
const SAMPLE_OPACITY = 'opacity-80';

interface Props {
  label: string;
  refUrl: string | null;
  photo: TaskPhoto | null;
  pending: PendingUpload | null;
  rejected: RejectedSlot | null;
  canShoot: boolean;
  canRemove: boolean;
  onShoot: (file: File) => void;
  onRetry: () => void;
  onRemove: (photoId: string) => void;
  onZoom: (url: string) => void;
}

/**
 * One labelled evidence slot.
 * Empty: the sample fills the slot (what the photo should look like) with a "Chụp giống mẫu" button.
 * Filled: own photo, sample shrinks to the corner for comparison.
 */
const PhotoSlot = ({ label, refUrl, photo, pending, rejected, canShoot, canRemove, onShoot, onRetry, onRemove, onZoom }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = pending?.previewUrl || photo?.url || null;
  const refLabel = t.slot.sample;

  const badge = pending
    ? pending.status === 'uploading' ? { text: t.slot.uploading, cls: 'bg-stone-900/80 text-white' }
      : pending.status === 'queued' ? { text: t.slot.queued, cls: 'bg-amber-500 text-amber-950' }
        : { text: t.slot.failed, cls: 'bg-rose-600 text-white' }
    : rejected ? { text: t.slot.retake, cls: 'bg-rose-600 text-white' }
      : photo ? { text: t.slot.sent, cls: 'bg-stone-900/70 text-white' } : null;

  const handleTap = () => {
    if (pending?.status === 'failed') return onRetry();
    if (canShoot) return inputRef.current?.click();
    if (shown) onZoom(shown);
    else if (refUrl) onZoom(refUrl);
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs font-bold text-stone-600">
        <span className="truncate">{label}</span>
        <span className="flex items-center gap-1 shrink-0">
          {refUrl && (
            <button type="button" onClick={() => onZoom(refUrl)} className="text-emerald-800 underline min-h-[28px] px-1">{t.slot.viewSample}</button>
          )}
          {canRemove && photo && !pending && !rejected && (
            <button type="button" onClick={() => onRemove(photo.id)} className="text-stone-400 hover:text-rose-600 min-h-[28px] px-1" aria-label={t.slot.remove}>
              <X size={14} />
            </button>
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={handleTap}
        disabled={!canShoot && !shown && !refUrl && pending?.status !== 'failed'}
        className={`relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-stone-100 ${
          shown || refUrl ? '' : 'border-2 border-dashed border-stone-300'
        } ${rejected ? 'ring-2 ring-rose-500' : ''} disabled:cursor-default`}
        aria-label={`${canShoot ? t.slot.tapToShoot : label}: ${label}`}
      >
        {shown ? (
          <img src={shown} alt="" className="w-full h-full object-cover" />
        ) : refUrl ? (
          <>
            <img src={refUrl} alt={refLabel} className={`w-full h-full object-cover ${SAMPLE_OPACITY}`} />
            <span className="absolute top-1.5 left-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-stone-700">{refLabel}</span>
            {canShoot && (
              <span className="absolute inset-x-2 bottom-2 min-h-[36px] rounded-lg bg-emerald-800/90 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5">
                <Camera size={16} /> {t.slot.shootLikeSample}
              </span>
            )}
          </>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center text-stone-500 text-xs font-semibold">
            <Camera size={26} strokeWidth={1.7} />
            {canShoot ? t.slot.tapToShoot : ''}
            <span className="font-normal text-[11px] text-stone-400">{t.slot.noSample}</span>
          </span>
        )}
        {rejected?.mark && (
          <span
            className="absolute w-[22%] aspect-square rounded-full border-[3px] border-orange-500 shadow-[0_0_0_2px_rgba(255,255,255,0.7)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${rejected.mark.x}%`, top: `${rejected.mark.y}%` }}
          />
        )}
        {shown && refUrl && (
          <span className="absolute top-1.5 left-1.5 w-1/3 aspect-[4/3] rounded-md overflow-hidden border-2 border-white shadow" title={refLabel}>
            <img src={refUrl} alt={refLabel} className="w-full h-full object-cover" />
          </span>
        )}
        {badge && <span className={`absolute bottom-1.5 right-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>}
      </button>
      {rejected?.reason && <p className="text-xs font-semibold text-rose-700">{rejected.reason}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onShoot(f); e.target.value = ''; }}
      />
    </div>
  );
};

export default PhotoSlot;
