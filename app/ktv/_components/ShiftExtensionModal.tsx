'use client';

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Clock, X, Loader2, AlertCircle } from 'lucide-react';
import { addMinutesToTime } from '@/lib/shift.constants';

interface ShiftExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEndTime: string | null;
  onConfirm: (minutes: number) => Promise<boolean>;
  isSubmitting?: boolean;
}

const PRESET_OPTIONS = [
  { label: '+60 phút', minutes: 60 },
  { label: '+90 phút', minutes: 90 },
  { label: '+120 phút', minutes: 120 },
] as const;

export function ShiftExtensionModal({
  isOpen,
  onClose,
  currentEndTime,
  onConfirm,
  isSubmitting = false,
}: ShiftExtensionModalProps) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(60);
  const [customMinutes, setCustomMinutes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setSelectedPreset(60);
      setCustomMinutes('');
      setError(null);
    }
  }

  const effectiveMinutes = selectedPreset !== null 
    ? selectedPreset 
    : (customMinutes ? Number(customMinutes) : null);

  const isValidMinutes = effectiveMinutes !== null && 
    Number.isInteger(effectiveMinutes) && 
    effectiveMinutes >= 60;

  const previewEndTime = currentEndTime && isValidMinutes
    ? addMinutesToTime(currentEndTime, effectiveMinutes)
    : '--:--';

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSelectedPreset(null);
    setCustomMinutes(val);
    setError(null);
  };

  const handlePresetSelect = (mins: number) => {
    setSelectedPreset(mins);
    setCustomMinutes('');
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);

    if (effectiveMinutes === null || isNaN(effectiveMinutes)) {
      setError('Vui lòng chọn hoặc nhập số phút gia hạn');
      return;
    }

    if (!Number.isInteger(effectiveMinutes) || String(customMinutes).includes('.') || String(customMinutes).includes(',')) {
      setError('Vui lòng nhập số phút nguyên (không nhận số thập phân)');
      return;
    }

    if (effectiveMinutes < 60) {
      setError('Thời gian gia hạn tối thiểu là 60 phút');
      return;
    }

    try {
      const success = await onConfirm(effectiveMinutes);
      if (success) {
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Có lỗi xảy ra khi gia hạn giờ làm');
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] animate-in fade-in duration-200" />
        <Dialog.Content 
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl z-[101] animate-in zoom-in-95 duration-200 flex flex-col focus:outline-none"
          aria-describedby="shift-extension-description"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-indigo-600">
              <Clock size={20} />
              <Dialog.Title className="text-lg font-bold text-gray-900">
                Gia hạn giờ làm
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-40"
                aria-label="Đóng hộp thoại gia hạn"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Description id="shift-extension-description" className="text-xs text-gray-500 mb-4 leading-relaxed">
            Mỗi ca/ngày làm việc chỉ được gia hạn 1 lần. Vui lòng chọn hoặc nhập thời lượng gia hạn mong muốn (tối thiểu 60 phút).
          </Dialog.Description>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4 text-center">
            <div className="text-xs text-gray-500 font-medium">Giờ tan ca mới (dự kiến)</div>
            <div className="text-2xl font-black text-indigo-700 mt-1">
              {previewEndTime}
            </div>
            {currentEndTime && isValidMinutes && (
              <div className="text-[11px] text-gray-400 mt-1">
                (Giờ hiện tại: {currentEndTime} + {effectiveMinutes} phút)
              </div>
            )}
          </div>

          <div className="space-y-3 mb-4">
            <div className="text-xs font-bold text-gray-700">Chọn nhanh thời lượng:</div>
            <div className="grid grid-cols-3 gap-2">
              {PRESET_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handlePresetSelect(opt.minutes)}
                  className={`py-2 px-1 text-xs font-bold rounded-xl border transition-all ${
                    selectedPreset === opt.minutes
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Hoặc nhập số phút tùy chỉnh (≥ 60):
              </label>
              <input
                type="number"
                min={60}
                step={1}
                inputMode="numeric"
                placeholder="VD: 75, 100, 150..."
                value={customMinutes}
                onChange={handleCustomChange}
                disabled={isSubmitting}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 font-bold text-sm bg-white outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-3 mb-4 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-3 bg-gray-100 text-gray-700 text-sm font-bold rounded-2xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !isValidMinutes}
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-2xl transition-all shadow-md shadow-indigo-200 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Xác nhận'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
