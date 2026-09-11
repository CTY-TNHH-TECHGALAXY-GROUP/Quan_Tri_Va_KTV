'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Power } from 'lucide-react';
import { t } from './AccountActiveDialog.i18n';
import type { UnlockInfo } from './KtvFeatures.logic';

interface AccountActiveDialogProps {
    open: boolean;
    staffId: string;
    staffName: string;
    /** true = the admin is turning the account back ON (unlock). */
    turningOn: boolean;
    isSubmitting: boolean;
    loadUnlockInfo: (staffId: string) => Promise<UnlockInfo | null>;
    onConfirm: (reason: string, reactivationFee?: number) => void;
    onCancel: () => void;
}

/**
 * Confirm + reason for the "Hoạt động" switch. Both directions ask, because
 * both are immediate: OFF throws the KTV out of the app, ON reopens it.
 * Turning ON shows the same reason / reactivation-fee floor Office shows,
 * since it calls the same unlock route.
 */
export const AccountActiveDialog = ({
    open, staffId, staffName, turningOn, isSubmitting, loadUnlockInfo, onConfirm, onCancel,
}: AccountActiveDialogProps) => {
    // Fresh state per dialog: the parent mounts it with a key per row/direction.
    const [reason, setReason] = useState('');
    const [info, setInfo] = useState<UnlockInfo | null>(null);
    const [fee, setFee] = useState<number>(0);
    const [loadingInfo, setLoadingInfo] = useState(turningOn);

    useEffect(() => {
        if (!open || !turningOn) return;
        let alive = true;
        loadUnlockInfo(staffId).then(i => {
            if (!alive) return;
            setInfo(i);
            if (i?.feeEnabled) setFee(i.feeMin);
        }).finally(() => { if (alive) setLoadingInfo(false); });
        return () => { alive = false; };
    }, [open, staffId, turningOn, loadUnlockInfo]);

    if (!open) return null;

    const feeRequired = turningOn && !!info?.feeEnabled;
    const canSubmit = reason.trim().length > 0
        && !isSubmitting
        && !loadingInfo
        && (!feeRequired || fee >= (info?.feeMin || 0));

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
                <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center ${turningOn ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                        <Power size={20} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-black text-gray-900">{turningOn ? t.turnOnTitle : t.turnOffTitle}</h3>
                        <p className="text-xs text-gray-500 font-mono truncate">{staffId} · {staffName}</p>
                    </div>
                </div>

                <p className="text-sm text-gray-600">{turningOn ? t.turnOnBody : t.turnOffBody}</p>

                {turningOn && (loadingInfo ? (
                    <p className="text-xs text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {t.loading}</p>
                ) : info?.lockReason ? (
                    <div className="bg-gray-50 rounded-xl p-3">
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t.currentReason}</p>
                        <p className="text-sm text-gray-800">{info.lockReason}</p>
                    </div>
                ) : null)}

                <label className="block">
                    <span className="text-xs font-bold text-gray-500">{t.reasonLabel}</span>
                    <input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={t.reasonPlaceholder}
                        className="mt-1 w-full min-h-[44px] border-2 border-gray-100 rounded-xl px-3 text-sm focus:border-indigo-400 focus:outline-none"
                    />
                </label>

                {feeRequired && (
                    <label className="block">
                        <span className="text-xs font-bold text-gray-500">{t.feeLabel}: {(info?.feeMin || 0).toLocaleString('vi-VN')}đ</span>
                        <input
                            type="number"
                            min={info?.feeMin || 0}
                            value={fee}
                            onChange={e => setFee(Number(e.target.value))}
                            className="mt-1 w-full min-h-[44px] border-2 border-gray-100 rounded-xl px-3 text-sm focus:border-indigo-400 focus:outline-none"
                        />
                    </label>
                )}

                <div className="flex gap-3 pt-1">
                    <button
                        onClick={onCancel}
                        disabled={isSubmitting}
                        className="flex-1 min-h-[44px] border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50"
                    >
                        {t.cancel}
                    </button>
                    <button
                        onClick={() => onConfirm(reason.trim(), feeRequired ? fee : undefined)}
                        disabled={!canSubmit}
                        className={`flex-1 min-h-[44px] text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 ${turningOn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                    >
                        {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                        {turningOn ? t.confirmOn : t.confirmOff}
                    </button>
                </div>
            </div>
        </div>
    );
};
