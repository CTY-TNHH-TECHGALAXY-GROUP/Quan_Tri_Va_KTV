'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Loader2, Settings2, ToggleLeft, ToggleRight } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

// 🔧 SYSTEM-WIDE FEATURE TOGGLES
const SYSTEM_TOGGLES = [
    {
        key: 'enable_web_advance_booking_email',
        label: '🌐 Gửi Email Yêu Cầu Đặt Cọc',
        description: 'Tự động gửi email yêu cầu đặt cọc cho khách khi Lễ tân bấm Xác nhận đơn từ Web.',
    },
    {
        key: 'auto_demote_type_b_to_a',
        label: '⏬ Tự động giáng chức KTV Loại B',
        description: 'Tự động chuyển KTV Loại B xuống Loại A nếu không đạt đủ chỉ tiêu.',
    }
] as const;

const useSystemToggles = () => {
    const [values, setValues] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);

    const fetchConfigs = useCallback(async () => {
        try {
            setLoading(true);
            const json = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            const data = json.data || {};
            const parsed: Record<string, boolean> = {};
            for (const toggle of SYSTEM_TOGGLES) {
                const raw = data[toggle.key];
                parsed[toggle.key] = raw === true || raw === 'true';
            }
            setValues(parsed);
        } catch (err) {
            console.error('Failed to fetch system toggles:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

    const toggle = useCallback(async (key: string, newValue: boolean) => {
        setUpdating(key);
        setValues(prev => ({ ...prev, [key]: newValue }));
        try {
            const json = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, { [key]: newValue });
            if (!json.success) {
                setValues(prev => ({ ...prev, [key]: !newValue }));
            }
        } catch {
            setValues(prev => ({ ...prev, [key]: !newValue }));
        } finally {
            setUpdating(null);
        }
    }, []);

    return { values, loading, updating, toggle };
};

const FeatureFlagsPage = () => {
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Quản Lý Tính Năng</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Bật/tắt các tính năng và cài đặt tự động hoá của hệ thống
                    </p>
                </div>
            </div>

            {/* ═══ SYSTEM-WIDE TOGGLES ═══ */}
            <SystemToggleSection />
        </div>
    );
};

// ═══ System Toggle Section Component ═══
const SystemToggleSection = () => {
    const { values, loading, updating, toggle } = useSystemToggles();

    if (loading) {
        return (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-br from-gray-50 to-slate-50 border border-gray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
                <Settings2 size={16} className="text-gray-600" />
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Tính năng hệ thống</h2>
            </div>
            {SYSTEM_TOGGLES.map(def => {
                const isEnabled = values[def.key] === true;
                const isUpdating = updating === def.key;
                return (
                    <div
                        key={def.key}
                        className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3"
                    >
                        <div>
                            <p className="text-sm font-semibold text-gray-800">{def.label}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{def.description}</p>
                        </div>
                        <button
                            onClick={() => toggle(def.key, !isEnabled)}
                            disabled={!!updating}
                            className="flex items-center gap-1.5 cursor-pointer disabled:cursor-wait"
                        >
                            {isUpdating ? (
                                <Loader2 size={22} className="animate-spin text-gray-400" />
                            ) : isEnabled ? (
                                <ToggleRight size={32} className="text-emerald-500" />
                            ) : (
                                <ToggleLeft size={32} className="text-gray-300" />
                            )}
                            <span className={`text-xs font-bold ${isEnabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                                {isEnabled ? 'ON' : 'OFF'}
                            </span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

export default FeatureFlagsPage;
