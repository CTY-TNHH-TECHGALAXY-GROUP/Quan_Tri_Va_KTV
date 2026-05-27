'use client';

import { AppLayout } from '@/components/layout/AppLayout';
import { useNotificationSettings } from './NotificationSettings.logic';
import { motion } from 'motion/react';
import { Bell, Check, Loader2, RefreshCw, Save, AlertTriangle } from 'lucide-react';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.3;
const CARD_BORDER_RADIUS = '16px';

const NotificationSettingsPage = () => {
    const {
        rules,
        loading,
        saving,
        error,
        hasChanges,
        ROLE_OPTIONS,
        toggleRole,
        toggleEnabled,
        toggleOnShift,
        toggleTargetEmployee,
        saveRules,
        fetchRules,
    } = useNotificationSettings();

    const ruleEntries = Object.entries(rules);

    return (
        <AppLayout>
            <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-4 sm:p-6">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl shadow-lg">
                                <Bell size={22} className="text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-black text-slate-800">Cài Đặt Thông Báo</h1>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Quản lý phân luồng thông báo theo vai trò
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={fetchRules}
                                disabled={loading}
                                className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-all shadow-sm disabled:opacity-50"
                                title="Làm mới"
                            >
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button
                                onClick={saveRules}
                                disabled={saving || !hasChanges}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm shadow-lg transition-all ${
                                    hasChanges
                                        ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:shadow-emerald-200 hover:shadow-xl active:scale-95'
                                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                }`}
                            >
                                {saving ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : hasChanges ? (
                                    <Save size={16} />
                                ) : (
                                    <Check size={16} />
                                )}
                                {saving ? 'Đang lưu...' : hasChanges ? 'Lưu thay đổi' : 'Đã lưu'}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-sm font-medium flex items-center gap-2">
                            <AlertTriangle size={16} />
                            {error}
                        </div>
                    )}
                </motion.div>

                {/* Loading */}
                {loading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={32} className="animate-spin text-slate-400" />
                    </div>
                )}

                {/* Rules Table */}
                {!loading && ruleEntries.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: ANIMATION_DURATION }}
                        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                        style={{ borderRadius: CARD_BORDER_RADIUS }}
                    >
                        {/* Table Header */}
                        <div className="grid grid-cols-[1fr_60px_60px_60px_50px_50px_50px] gap-0 bg-slate-50 border-b border-slate-200 px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                            <span>Loại thông báo</span>
                            <span className="text-center">Admin</span>
                            <span className="text-center">Quầy</span>
                            <span className="text-center">KTV</span>
                            <span className="text-center" title="Chỉ gửi cho KTV liên quan">🎯</span>
                            <span className="text-center" title="Chỉ khi đang trong ca">⏰</span>
                            <span className="text-center" title="Bật/Tắt">On</span>
                        </div>

                        {/* Table Body */}
                        {ruleEntries.map(([type, rule], idx) => (
                            <div
                                key={type}
                                className={`grid grid-cols-[1fr_60px_60px_60px_50px_50px_50px] gap-0 items-center px-4 py-3 border-b border-slate-100 last:border-b-0 transition-colors ${
                                    !rule.enabled ? 'opacity-40 bg-slate-50' : 'hover:bg-slate-50/50'
                                }`}
                            >
                                {/* Label */}
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-lg shrink-0">{rule.icon}</span>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-slate-700 truncate">{rule.label}</p>
                                        <p className="text-[10px] text-slate-400 font-mono">{type}</p>
                                    </div>
                                </div>

                                {/* Role toggles */}
                                {ROLE_OPTIONS.map(opt => (
                                    <div key={opt.id} className="flex justify-center">
                                        <button
                                            onClick={() => toggleRole(type, opt.id)}
                                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all text-xs font-bold ${
                                                rule.allowed_roles?.includes(opt.id)
                                                    ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200'
                                                    : 'bg-slate-100 text-slate-300 hover:bg-slate-200'
                                            }`}
                                        >
                                            {rule.allowed_roles?.includes(opt.id) ? '✓' : '—'}
                                        </button>
                                    </div>
                                ))}

                                {/* Target Employee toggle */}
                                <div className="flex justify-center">
                                    <button
                                        onClick={() => toggleTargetEmployee(type)}
                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all text-xs font-bold ${
                                            rule.include_target_employee
                                                ? 'bg-blue-100 text-blue-600 ring-1 ring-blue-200'
                                                : 'bg-slate-100 text-slate-300 hover:bg-slate-200'
                                        }`}
                                        title="Gửi cho nhân viên liên quan (target employee)"
                                    >
                                        {rule.include_target_employee ? '🎯' : '—'}
                                    </button>
                                </div>

                                {/* On-shift toggle */}
                                <div className="flex justify-center">
                                    <button
                                        onClick={() => toggleOnShift(type)}
                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all text-xs font-bold ${
                                            rule.require_on_shift
                                                ? 'bg-amber-100 text-amber-600 ring-1 ring-amber-200'
                                                : 'bg-slate-100 text-slate-300 hover:bg-slate-200'
                                        }`}
                                        title="Chỉ gửi khi đang trong ca làm"
                                    >
                                        {rule.require_on_shift ? '⏰' : '—'}
                                    </button>
                                </div>

                                {/* Enabled toggle */}
                                <div className="flex justify-center">
                                    <button
                                        onClick={() => toggleEnabled(type)}
                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                                            rule.enabled
                                                ? 'bg-emerald-500 text-white shadow-sm'
                                                : 'bg-rose-100 text-rose-400 ring-1 ring-rose-200'
                                        }`}
                                    >
                                        {rule.enabled ? (
                                            <Check size={14} strokeWidth={3} />
                                        ) : (
                                            <span className="text-xs font-bold">✕</span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </motion.div>
                )}

                {/* Legend */}
                <div className="mt-4 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-[11px] font-bold text-slate-500 mb-2">Chú giải:</p>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                        <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px] font-bold">✓</span>
                            <span>Vai trò này luôn nhận thông báo</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center text-[10px]">🎯</span>
                            <span>Gửi cho KTV liên quan (người làm đơn)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded bg-amber-100 flex items-center justify-center text-[10px]">⏰</span>
                            <span>Chỉ gửi khi đang trong ca (KTV)</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded bg-emerald-500 text-white flex items-center justify-center text-[10px]"><Check size={10} /></span>
                            <span>Bật / Tắt loại thông báo</span>
                        </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2 italic">
                        * Admin / Quầy luôn nhận thông báo bất kể on/off-shift. Chỉ KTV mới bị ảnh hưởng bởi cài đặt &quot;On-shift&quot;.
                    </p>
                </div>
            </div>
        </AppLayout>
    );
};

export default NotificationSettingsPage;
