'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useStaffFeatures, FEATURE_FLAG_DEFS } from './Features.logic';
import { Search, ToggleLeft, ToggleRight, Loader2, RefreshCw, Zap, ZapOff, Info, Settings2 } from 'lucide-react';

// 🔧 SYSTEM-WIDE FEATURE TOGGLES
const SYSTEM_TOGGLES = [
    {
        key: 'show_overtime_on_dashboard',
        label: '⏰ Hiển thị tăng ca trên Dashboard',
        description: 'Hiển thị thời gian tăng ca của KTV trên bảng nhân sự Dashboard vận hành',
    },
] as const;

const useSystemToggles = () => {
    const [values, setValues] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);

    const fetchConfigs = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/settings/system');
            const json = await res.json();
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
            const res = await fetch('/api/admin/settings/system', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [key]: newValue }),
            });
            const json = await res.json();
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

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = '200ms';
const TABLE_ROW_HEIGHT = '52px';

const FeatureFlagsPage = () => {
    const {
        staffList,
        allStaffCount,
        configs,
        loading,
        updating,
        searchQuery,
        setSearchQuery,
        toggleFlag,
        bulkToggle,
        flagStats,
        refetch,
    } = useStaffFeatures();

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
    };

    if (loading) {
        return (
            <AppLayout title="Quản Lý Tính Năng">
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="text-center space-y-3">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
                        <p className="text-gray-500 text-sm">Đang tải dữ liệu...</p>
                    </div>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title="Quản Lý Tính Năng">
        <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Quản Lý Tính Năng</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Bật/tắt tính năng cho từng nhân viên — test trước khi áp dụng toàn bộ
                    </p>
                </div>
                <button
                    onClick={refetch}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors self-start"
                >
                    <RefreshCw size={16} />
                    Làm mới
                </button>
            </div>

            {/* ═══ SYSTEM-WIDE TOGGLES ═══ */}
            <SystemToggleSection />

            {/* Global Config Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-4">
                    <div className="flex items-center gap-2 text-blue-700 mb-1">
                        <Info size={16} />
                        <span className="text-xs font-semibold uppercase tracking-wide">Phí giặt đồ / ngày</span>
                    </div>
                    <p className="text-2xl font-bold text-blue-900">{formatCurrency(configs.laundry_fee)}</p>
                    <p className="text-xs text-blue-600 mt-1">
                        {flagStats['laundry_deduction']?.enabled || 0}/{allStaffCount} nhân viên đang bật
                    </p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-2xl p-4">
                    <div className="flex items-center gap-2 text-amber-700 mb-1">
                        <Info size={16} />
                        <span className="text-xs font-semibold uppercase tracking-wide">Phạt nghỉ đột xuất / lần</span>
                    </div>
                    <p className="text-2xl font-bold text-amber-900">{formatCurrency(configs.sudden_off_penalty)}</p>
                    <p className="text-xs text-amber-600 mt-1">
                        {flagStats['sudden_leave_penalty']?.enabled || 0}/{allStaffCount} nhân viên đang bật
                    </p>
                </div>
            </div>

            {/* Search + Bulk Actions */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Tìm theo mã NV hoặc tên..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
                    />
                </div>
                {/* Bulk Toggle Buttons */}
                <div className="flex gap-2 flex-wrap">
                    {FEATURE_FLAG_DEFS.map(def => (
                        <div key={def.key} className="flex gap-1">
                            <button
                                onClick={() => bulkToggle(def.key, true)}
                                disabled={updating === `bulk-${def.key}`}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
                                title={`Bật ${def.label} cho tất cả`}
                            >
                                <Zap size={14} />
                                Bật hết {def.label}
                            </button>
                            <button
                                onClick={() => bulkToggle(def.key, false)}
                                disabled={updating === `bulk-${def.key}`}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                                title={`Tắt ${def.label} cho tất cả`}
                            >
                                <ZapOff size={14} />
                                Tắt hết
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Staff Table */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 w-24">
                                    Mã NV
                                </th>
                                {FEATURE_FLAG_DEFS.map(def => (
                                    <th
                                        key={def.key}
                                        className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 w-40"
                                        title={def.description}
                                    >
                                        {def.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {staffList.length === 0 ? (
                                <tr>
                                    <td colSpan={1 + FEATURE_FLAG_DEFS.length} className="text-center text-gray-400 py-12 text-sm">
                                        {searchQuery ? 'Không tìm thấy nhân viên' : 'Không có dữ liệu'}
                                    </td>
                                </tr>
                            ) : (
                                staffList.map(staff => (
                                    <tr
                                        key={staff.id}
                                        className="hover:bg-gray-50/50 transition-colors"
                                        style={{ height: TABLE_ROW_HEIGHT }}
                                    >
                                        <td className="px-4 py-2">
                                            <span className="text-sm font-mono font-semibold text-indigo-600">
                                                {staff.id}
                                            </span>
                                        </td>
                                        {FEATURE_FLAG_DEFS.map(def => {
                                            const isEnabled = staff.feature_flags?.[def.key] === true;
                                            const isUpdating = updating === `${staff.id}-${def.key}`;

                                            return (
                                                <td key={def.key} className="px-4 py-2 text-center">
                                                    <button
                                                        onClick={() => toggleFlag(staff.id, def.key, !isEnabled)}
                                                        disabled={!!updating}
                                                        className={`inline-flex items-center gap-1.5 transition-all cursor-pointer disabled:cursor-wait`}
                                                        style={{ transitionDuration: ANIMATION_DURATION }}
                                                    >
                                                        {isUpdating ? (
                                                            <Loader2 size={20} className="animate-spin text-gray-400" />
                                                        ) : isEnabled ? (
                                                            <ToggleRight size={28} className="text-emerald-500" />
                                                        ) : (
                                                            <ToggleLeft size={28} className="text-gray-300" />
                                                        )}
                                                        <span className={`text-xs font-medium ${isEnabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                                                            {isEnabled ? 'ON' : 'OFF'}
                                                        </span>
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
                    Hiển thị {staffList.length} / {allStaffCount} nhân viên
                </div>
            </div>
        </div>
        </AppLayout>
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
