'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Wallet, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import {
    WALLET_TYPES,
    WALLET_LABEL,
    WalletType,
    readConfigBool,
    walletConfigKey,
    workTypeHasWallet,
} from '@/lib/featureFlags';
import { t } from './WalletSwitchesBlock.i18n';

// 🔧 UI CONFIGURATION
const SAVED_BADGE_MS = 3000;

const WALLET_ICON: Record<WalletType, string> = { TUA: '💰', BONUS: '💎' };

type WorkTypeTab = 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D';

/**
 * Wallet switch for a WHOLE work type.
 *
 * The level above the per-staff flags: off here takes the wallet from every
 * KTV of this type without touching anyone's flag; turning it back on keeps
 * people who were switched off individually still off.
 * Final result = type switch AND per-staff flag (see `isWalletEnabled`).
 */
export const WalletSwitchesBlock = ({ activeTab }: { activeTab: WorkTypeTab }) => {
    const [values, setValues] = useState<Record<string, boolean>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [saving, setSaving] = useState<WalletType | null>(null);
    const [savedAt, setSavedAt] = useState<WalletType | null>(null);

    // Ví Bonus only exists for Types A/B — no switch for it elsewhere.
    const wallets = WALLET_TYPES.filter(w => workTypeHasWallet(w, activeTab));
    const typeLabel = t.typeLabel[activeTab];

    const fetchConfigs = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            const data = res?.data || {};
            const next: Record<string, boolean> = {};
            WALLET_TYPES.forEach(w => {
                const key = walletConfigKey(w, activeTab);
                next[key] = readConfigBool(data[key], true);
            });
            setValues(next);
        } catch (err) {
            console.error('Failed to load wallet switches:', err);
        } finally {
            setIsLoading(false);
        }
    }, [activeTab]);

    useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

    const toggle = async (wallet: WalletType, next: boolean) => {
        const key = walletConfigKey(wallet, activeTab);
        if (!window.confirm(t.confirm(next, WALLET_LABEL[wallet], typeLabel))) return;

        setSaving(wallet);
        setValues(prev => ({ ...prev, [key]: next }));
        try {
            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, { [key]: next });
            if (result?.success) {
                setSavedAt(wallet);
                setTimeout(() => setSavedAt(null), SAVED_BADGE_MS);
            } else {
                setValues(prev => ({ ...prev, [key]: !next }));
            }
        } catch (err) {
            console.error('Failed to save wallet switch:', err);
            setValues(prev => ({ ...prev, [key]: !next }));
        } finally {
            setSaving(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center p-8 bg-white rounded-2xl border border-gray-100">
                <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                    <Wallet size={20} className="text-indigo-500" />
                </div>
                <div>
                    <h2 className="text-lg font-black text-gray-900">{t.title(typeLabel)}</h2>
                    <p className="text-xs text-gray-500">{t.subtitle(typeLabel)}</p>
                </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-4">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{t.rule}</span>
            </div>

            <div className={`grid grid-cols-1 gap-4 ${wallets.length > 1 ? 'md:grid-cols-2' : ''}`}>
                {wallets.map(w => {
                    const key = walletConfigKey(w, activeTab);
                    const enabled = values[key] ?? true;
                    return (
                        <div
                            key={w}
                            className={`rounded-xl border-2 p-4 transition-colors ${
                                enabled ? 'border-emerald-100 bg-emerald-50/30' : 'border-gray-100 bg-gray-50/60'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className={`font-bold truncate ${enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                                        {WALLET_ICON[w]} {WALLET_LABEL[w]}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {enabled ? t.walletHint[w] : t.offForType}
                                    </p>
                                </div>
                                {saving === w ? (
                                    <Loader2 size={20} className="animate-spin text-gray-400 flex-shrink-0" />
                                ) : (
                                    <button
                                        onClick={() => toggle(w, !enabled)}
                                        disabled={!!saving}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-50 ${
                                            enabled ? 'bg-indigo-500' : 'bg-gray-300'
                                        }`}
                                    >
                                        <span
                                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                                                enabled ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                        />
                                    </button>
                                )}
                            </div>
                            {savedAt === w && (
                                <p className="mt-2 text-emerald-600 text-xs font-bold flex items-center gap-1">
                                    <CheckCircle2 size={12} /> {t.saved}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
