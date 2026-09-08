'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Wallet, Loader2, CheckCircle2, AlertTriangle, LogOut } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { WALLET_TYPES, WalletType, walletConfigKey } from '@/lib/featureFlags';

/** Trùng với FORCE_LOGOUT_ENABLED_KEY trong SessionEpochService. */
const FORCE_LOGOUT_KEY = 'auth_force_logout_enabled';

/**
 * Công tắc ví cho CẢ MỘT LOẠI KTV.
 *
 * Tầng trên của cờ per-nhân-viên ở bảng bên dưới: tắt ở đây là cả loại mất ví,
 * khỏi phải bấm từng người; bật lại thì ai bị tắt riêng vẫn tắt riêng.
 * Kết quả cuối = công tắc loại VÀ cờ cá nhân.
 */

const WALLET_META: Record<WalletType, { label: string; hint: string; labelTypeD?: string }> = {
    TUA: {
        label: '💰 Ví Tua',
        labelTypeD: '💰 Ví Thu Nhập',
        hint: 'Số dư tua, hoa hồng và lệnh rút tiền',
    },
    BONUS: {
        label: '💎 Ví Bonus',
        labelTypeD: '💎 Điểm Tích Lũy',
        hint: 'Điểm thưởng ca / tua và đổi điểm',
    },
    SAVINGS: {
        label: '🐷 Ví Tích Luỹ',
        hint: 'Khoản tích luỹ dài hạn',
    },
};

export function WalletSwitchesBlock({ activeTab }: { activeTab: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D' }) {
    const [values, setValues] = useState<Record<string, boolean>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [saving, setSaving] = useState<WalletType | null>(null);
    const [savedAt, setSavedAt] = useState<WalletType | null>(null);
    const [forceLogout, setForceLogout] = useState(false);
    const [savingForceLogout, setSavingForceLogout] = useState(false);

    const fetchConfigs = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            const data = res?.data || {};
            const next: Record<string, boolean> = {};
            WALLET_TYPES.forEach(w => {
                const key = walletConfigKey(w, activeTab);
                next[key] = readBool(data[key]);
            });
            setValues(next);
            // Khoá này thiếu thì hiểu là TẮT, ngược với công tắc ví.
            setForceLogout(data[FORCE_LOGOUT_KEY] === true || String(data[FORCE_LOGOUT_KEY]).replace(/"/g, '') === 'true');
        } catch (err) {
            console.error('Lỗi tải công tắc ví:', err);
        } finally {
            setIsLoading(false);
        }
    }, [activeTab]);

    useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

    const toggle = async (wallet: WalletType, next: boolean) => {
        const key = walletConfigKey(wallet, activeTab);
        const label = labelOf(wallet, activeTab);

        const ok = window.confirm(
            `${next ? 'BẬT' : 'TẮT'} "${label}" cho TOÀN BỘ KTV ${typeLabel(activeTab)}.\n\n`
            + (forceLogout
                ? `Tất cả KTV ${typeLabel(activeTab)} sẽ BỊ ĐĂNG XUẤT ngay để nhận thay đổi.\n`
                : `Không ai bị đăng xuất — thay đổi áp dụng ở lần đăng nhập kế tiếp của họ.\n`)
            + `Các loại KTV khác không bị ảnh hưởng.\n\nTiếp tục?`
        );
        if (!ok) return;

        setSaving(wallet);
        setValues(prev => ({ ...prev, [key]: next }));
        try {
            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, { [key]: next });
            if (result?.success) {
                setSavedAt(wallet);
                setTimeout(() => setSavedAt(null), 3000);
            } else {
                setValues(prev => ({ ...prev, [key]: !next }));
            }
        } catch (err) {
            console.error('Lỗi lưu công tắc ví:', err);
            setValues(prev => ({ ...prev, [key]: !next }));
        } finally {
            setSaving(null);
        }
    };

    /**
     * Cần gạt tổng — có ép đăng xuất khi đổi cấu hình hay không.
     *
     * Để mặc định TẮT vì bật giữa ca đang chạy là cả tiệm văng ra màn hình
     * đăng nhập cùng lúc. Quản lý bật lúc rảnh tay, không phải lúc deploy.
     */
    const toggleForceLogout = async (next: boolean) => {
        const ok = window.confirm(
            next
                ? 'BẬT ép đăng xuất.\n\nTừ giờ mỗi lần đổi công tắc tính năng, những người bị ảnh '
                  + 'hưởng sẽ bị đá về màn hình đăng nhập trong vòng 1 phút.\n\n'
                  + 'Bật ngay bây giờ KHÔNG đá ai ra — chỉ áp cho các lần đổi cấu hình sau.\n\nTiếp tục?'
                : 'TẮT ép đăng xuất.\n\nĐổi cấu hình sẽ không đá ai ra nữa; thay đổi chỉ áp dụng ở '
                  + 'lần đăng nhập kế tiếp của họ.\n\nTiếp tục?'
        );
        if (!ok) return;

        setSavingForceLogout(true);
        setForceLogout(next);
        try {
            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, { [FORCE_LOGOUT_KEY]: next });
            if (!result?.success) setForceLogout(!next);
        } catch (err) {
            console.error('Lỗi lưu cần gạt ép đăng xuất:', err);
            setForceLogout(!next);
        } finally {
            setSavingForceLogout(false);
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
                    <h2 className="text-lg font-black text-gray-900">
                        Công tắc ví — cả loại {typeLabel(activeTab)}
                    </h2>
                    <p className="text-xs text-gray-500">
                        Tắt ở đây là <b>mọi KTV {typeLabel(activeTab)}</b> mất ví, không cần bấm từng người.
                        Loại khác giữ nguyên.
                    </p>
                </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-4">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>
                    Ví chỉ hiện khi <b>công tắc loại BẬT</b> và <b>cờ cá nhân BẬT</b> (bảng bên dưới).
                    {forceLogout
                        ? ` Đổi công tắc này sẽ đăng xuất toàn bộ KTV ${typeLabel(activeTab)} ngay.`
                        : ' Hiện không ai bị đăng xuất — thay đổi áp dụng ở lần đăng nhập kế tiếp.'}
                </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {WALLET_TYPES.map(w => {
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
                                        {labelOf(w, activeTab)}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {enabled ? WALLET_META[w].hint : 'Đang tắt cho cả loại'}
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
                                    <CheckCircle2 size={12} /> Đã lưu{forceLogout ? ` — đã đăng xuất loại ${typeLabel(activeTab)}` : ''}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Cần gạt tổng: ép đăng xuất hay để tới lần đăng nhập sau */}
            <div className={`mt-5 rounded-xl border-2 p-4 transition-colors ${
                forceLogout ? 'border-rose-100 bg-rose-50/40' : 'border-gray-100 bg-gray-50/60'
            }`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                        <LogOut size={18} className={`mt-0.5 flex-shrink-0 ${forceLogout ? 'text-rose-500' : 'text-gray-400'}`} />
                        <div className="min-w-0">
                            <p className="font-bold text-gray-900">Ép đăng xuất khi đổi cấu hình</p>
                            <p className="text-xs text-gray-500 leading-relaxed">
                                {forceLogout
                                    ? 'ĐANG BẬT — đổi công tắc là người bị ảnh hưởng bị đá về màn hình đăng nhập trong vòng 1 phút. Đừng bật giữa ca đang chạy.'
                                    : 'ĐANG TẮT — không ai bị đá ra. Thay đổi áp dụng ở lần đăng nhập kế tiếp của từng người, nên máy không đăng xuất có thể còn thấy tính năng cũ.'}
                            </p>
                        </div>
                    </div>
                    {savingForceLogout ? (
                        <Loader2 size={20} className="animate-spin text-gray-400 flex-shrink-0" />
                    ) : (
                        <button
                            onClick={() => toggleForceLogout(!forceLogout)}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                                forceLogout ? 'bg-rose-500' : 'bg-gray-300'
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                                    forceLogout ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function labelOf(wallet: WalletType, workType: string): string {
    const meta = WALLET_META[wallet];
    return workType === 'TYPE_D' && meta.labelTypeD ? meta.labelTypeD : meta.label;
}

function typeLabel(workType: string): string {
    return ({ TYPE_A: 'Loại A', TYPE_B: 'Loại B', TYPE_C: 'Loại C', TYPE_D: 'Loại D' } as Record<string, string>)[workType] || workType;
}

/** SystemConfigs.value là jsonb — có thể về `true`, `"true"` hoặc `'"true"'`. */
function readBool(raw: any): boolean {
    if (raw === undefined || raw === null || raw === '') return true;
    if (typeof raw === 'boolean') return raw;
    return String(raw).replace(/"/g, '').toLowerCase() === 'true';
}
