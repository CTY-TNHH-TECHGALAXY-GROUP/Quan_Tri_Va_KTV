'use client';

import React, { useRef } from 'react';
import { Camera, X } from 'lucide-react';
import { t } from '../SupportTasks.i18n';
import type { PendingUpload, RejectedSlot, TaskPhoto } from '../SupportEmployeeTasks.logic';

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

/** One labelled evidence slot: sample photo in the corner, tap to shoot, badges for upload / review state. */
const PhotoSlot = ({ label, refUrl, photo, pending, rejected, canShoot, canRemove, onShoot, onRetry, onRemove, onZoom }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = pending?.previewUrl || photo?.url || null;

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
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs font-bold text-stone-600">
        <span className="truncate">{label}</span>
        {canRemove && photo && !pending && !rejected && (
          <button type="button" onClick={() => onRemove(photo.id)} className="text-stone-400 hover:text-rose-600 min-h-[28px] px-1" aria-label={t.slot.remove}>
            <X size={14} />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={handleTap}
        disabled={!canShoot && !shown && pending?.status !== 'failed'}
        className={`relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-stone-100 ${
          shown ? '' : 'border-2 border-dashed border-stone-300'
        } ${rejected ? 'ring-2 ring-rose-500' : ''} disabled:cursor-default`}
        aria-label={`${canShoot ? t.slot.tapToShoot : label}: ${label}`}
      >
        {shown
          ? <img src={shown} alt="" className="w-full h-full object-cover" />
          : (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-stone-500 text-xs font-semibold">
              <Camera size={26} strokeWidth={1.7} />
              {t.slot.tapToShoot}
            </span>
          )}
        {rejected?.mark && (
          <span
            className="absolute w-[22%] aspect-square rounded-full border-[3px] border-orange-500 shadow-[0_0_0_2px_rgba(255,255,255,0.7)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${rejected.mark.x}%`, top: `${rejected.mark.y}%` }}
          />
        )}
        {refUrl && (
          <span className="absolute top-1.5 left-1.5 w-1/3 aspect-[4/3] rounded-md overflow-hidden border-2 border-white shadow" title={t.slot.sample}>
            <img src={refUrl} alt={t.slot.sample} className="w-full h-full object-cover" />
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
