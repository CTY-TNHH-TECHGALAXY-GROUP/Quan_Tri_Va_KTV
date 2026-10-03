'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
    ShieldAlert, CalendarDays, Send, Loader2,
    CalendarOff, CheckCircle2, Clock, XCircle, AlertCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { useKTVLeave } from './Leave.logic';
import { t } from './Leave.i18n';

// 🔧 UI CONFIGURATION
const STATUS_COLORS = {
    PENDING: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: Clock },
    APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle2 },
    REJECTED: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: XCircle },
} as const;

const STATUS_LABELS: Record<string, string> = {
    PENDING: t.statusPending,
    APPROVED: t.statusApproved,
    REJECTED: t.statusRejected,
};

const KTVLeavePage = () => {
    const {
        date,
        isSubmitting,
        mounted,
        canAccessPage,
        leaveList,
        isLoadingList,
        submitError,
        submitSuccess,
        setDate,
        setSubmitError,
        handleSubmit,
    } = useKTVLeave();

    if (!mounted) return null;

    if (!canAccessPage) {
        return (
            <AppLayout title="Đăng Ký OFF">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">{t.noAccess}</h2>
                </div>
            </AppLayout>
        );
    }

    // Get today string for min date
    const todayStr = new Date().toISOString().split('T')[0];

    return (
        <AppLayout title="Đăng Ký OFF">
            <div className="max-w-md mx-auto px-4 py-6 space-y-6">
                
                {/* Page Header */}
                <div>
                    <p className="text-sm text-gray-500">{t.pageSubtitle}</p>
                </div>

                {/* ── FORM SECTION ── */}
                <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                    <div className="px-6 pt-6 pb-2">
                        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                            <CalendarOff size={20} className="text-rose-500" />
                            {t.pageTitle}
                        </h3>
                    </div>
                    <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
                        {/* Date picker */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.labelDate}</label>
                            <div className="relative">
                                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="date"
                                    value={date}
                                    min={todayStr}
                                    onChange={(e) => setDate(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-rose-400 focus:border-rose-400 outline-none text-sm bg-gray-50"
                                    required
                                />
                            </div>
                        </div>



                        {/* Warning */}
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-sm text-amber-800">
                            <strong>{t.warningPrefix}</strong> {t.warning}
                        </div>

                        {/* Error message */}
                        {submitError && (
                            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-4 py-3 flex items-center gap-2">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{submitError}</span>
                                <button onClick={() => setSubmitError(null)} className="ml-auto">
                                    <XCircle size={16} />
                                </button>
                            </div>
                        )}

                        {/* Success message */}
                        {submitSuccess && (
                            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-2xl px-4 py-3 flex items-center gap-2">
                                <CheckCircle2 size={16} className="shrink-0" />
                                <span>{t.submitSuccess}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting || !date}
                            className="w-full py-3.5 bg-rose-600 text-white font-bold rounded-2xl hover:bg-rose-700 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 shadow-md shadow-rose-200"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={18} className="animate-spin" />
                                    {t.submitting}
                                </>
                            ) : (
                                <>
                                    <Send size={18} />
                                    {t.submit}
                                </>
                            )}
                        </button>
                    </form>
                </div>

                {/* ── LEAVE SCHEDULE SECTION ── */}
                <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                    <div className="px-6 pt-6 pb-3">
                        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                            <CalendarDays size={20} className="text-indigo-500" />
                            {t.scheduleTitle}
                        </h3>
                        <p className="text-xs text-gray-400 mt-1">{t.scheduleSubtitle}</p>
                    </div>

                    <div className="px-6 pb-6">
                        {/* Loading */}
                        {isLoadingList && (
                            <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                                <Loader2 size={20} className="animate-spin" />
                                <span className="text-sm">{t.scheduleLoading}</span>
                            </div>
                        )}

                        {/* Empty */}
                        {!isLoadingList && leaveList.length === 0 && (
                            <div className="text-center py-8">
                                <CalendarOff size={36} className="text-gray-300 mx-auto mb-2" />
                                <p className="text-sm text-gray-400">{t.scheduleEmpty}</p>
                            </div>
                        )}

                        {/* Leave list */}
                        {!isLoadingList && leaveList.length > 0 && (
                            <div className="space-y-3">
                                {leaveList.map((leave) => {
                                    const statusConfig = STATUS_COLORS[leave.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.PENDING;
                                    const StatusIcon = statusConfig.icon;
                                    const formattedDate = (() => {
                                        try {
                                            return format(new Date(leave.date + 'T00:00:00'), 'EEEE, dd/MM', { locale: vi });
                                        } catch {
                                            return leave.date;
                                        }
                                    })();

                                    return (
                                        <div
                                            key={leave.id}
                                            className={`flex items-center gap-3 p-3.5 rounded-2xl border ${statusConfig.border} ${statusConfig.bg} transition-all`}
                                        >
                                            {/* Left: Date badge */}
                                            <div className="flex flex-col items-center justify-center min-w-[52px] bg-white rounded-xl p-2 shadow-sm border border-gray-100">
                                                <span className="text-lg font-black text-gray-900 leading-none">
                                                    {(() => {
                                                        try { return format(new Date(leave.date + 'T00:00:00'), 'dd'); }
                                                        catch { return '--'; }
                                                    })()}
                                                </span>
                                                <span className="text-[10px] font-semibold text-gray-400 uppercase leading-tight">
                                                    {(() => {
                                                        try { return format(new Date(leave.date + 'T00:00:00'), 'MMM', { locale: vi }); }
                                                        catch { return ''; }
                                                    })()}
                                                </span>
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-sm text-gray-900 truncate">
                                                    {leave.employeeName}
                                                </p>
                                                <p className="text-xs text-gray-500 capitalize truncate">
                                                    {formattedDate}
                                                </p>
                                            </div>

                                            {/* Right: Status */}
                                            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${statusConfig.text} ${statusConfig.bg}`}>
                                                <StatusIcon size={12} />
                                                <span>{STATUS_LABELS[leave.status] || leave.status}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </AppLayout>
    );
};

export default KTVLeavePage;
