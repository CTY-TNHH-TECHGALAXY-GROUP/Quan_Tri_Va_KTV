'use client';
import { parseDbDate } from "@/lib/utils";

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
    Bell,
    Check,
    Clock,
    Search,
    ExternalLink,
    Calendar,
    ChevronLeft,
    ChevronRight,
    Loader2
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNotificationHistory, NotificationItem, FilterStatus, SourceFilter } from './NotificationHistory.logic';
import { t } from './NotificationHistory.i18n';

// 🔧 UI CONFIGURATION
const FILTER_TABS: { id: FilterStatus; label: string }[] = [
    { id: 'all', label: t.filterAll },
    { id: 'pending', label: t.filterPending },
    { id: 'completed', label: t.filterCompleted },
    { id: 'acknowledged', label: 'Đã xác nhận' },
];

export default function NotificationHistoryPage() {
    const {
        isLoading,
        filterStatus,
        sourceFilter,
        searchTerm,
        selectedDate,
        page,
        filteredNotifs,
        stats,
        hasNextPage,
        hasPrevPage,
        setSearchTerm,
        setSelectedDate,
        setPage,
        setSourceFilter,
        fetchNotifications,
        handleMarkDone,
        handleAck,
        handleFilterChange,
        handleRedirectToDispatch,
    } = useNotificationHistory();

    return (
        <AppLayout title="Thông Báo">
            <div className="min-h-screen bg-slate-50/50 p-4 lg:p-8">
                {/* Header */}
                <div className="max-w-6xl mx-auto space-y-8">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div>
                            <p className="text-gray-500 font-medium">{t.pageSubtitle}</p>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={fetchNotifications}
                                className="p-3 bg-white hover:bg-slate-50 border border-gray-100 rounded-2xl text-indigo-600 transition-all flex items-center gap-2 font-bold text-xs uppercase"
                            >
                                <Loader2 size={16} className={isLoading ? 'animate-spin' : ''} />
                                {t.refresh}
                            </button>
                            <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-2">
                                <Calendar size={18} className="text-indigo-600 ml-2" />
                                <input
                                    type="date"
                                    value={selectedDate || ''}
                                    onChange={(e) => setSelectedDate(e.target.value || null)}
                                    className="border-none focus:ring-0 text-sm font-bold text-gray-700 bg-transparent"
                                />
                                {selectedDate && (
                                    <button
                                        onClick={() => setSelectedDate(null)}
                                        className="text-[10px] font-black text-rose-500 px-2 py-1 bg-rose-50 rounded-lg uppercase"
                                    >
                                        {t.clearDate}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Stats & Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="md:col-span-3 bg-white rounded-[2.5rem] p-4 shadow-sm border border-gray-100 flex flex-wrap items-center gap-4">
                            <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                                {FILTER_TABS.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => handleFilterChange(tab.id)}
                                        className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                            filterStatus === tab.id
                                                ? 'bg-white text-indigo-600 shadow-sm'
                                                : 'text-gray-400 hover:text-gray-600'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                            <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                                {[
                                    { id: 'all', label: 'Tất cả nguồn' },
                                    { id: 'CUSTOMER', label: '👤 Khách' },
                                    { id: 'KTV', label: 'KTV / Hệ thống' },
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setSourceFilter(tab.id as SourceFilter)}
                                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                                            sourceFilter === tab.id
                                                ? 'bg-white text-purple-600 shadow-sm'
                                                : 'text-gray-400 hover:text-gray-600'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                            <div className="flex-1 min-w-[200px] relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    placeholder={t.searchPlaceholder}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-sm font-medium focus:ring-2 focus:ring-indigo-100"
                                />
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-[2.5rem] p-6 text-white shadow-xl shadow-indigo-100 flex items-center justify-between">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-1">{t.statsPendingLabel}</p>
                                <p className="text-3xl font-black">{stats.pending}</p>
                            </div>
                            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
                                <Clock className="animate-pulse" size={24} />
                            </div>
                        </div>
                    </div>

                    {/* List */}
                    <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-6 border-b border-gray-50 flex justify-between items-center">
                            <h3 className="font-black text-gray-900 uppercase tracking-widest text-sm">{t.listTitle}</h3>
                            <div className="flex items-center gap-2">
                                <button
                                    disabled={!hasPrevPage}
                                    onClick={() => setPage(p => p - 1)}
                                    className="p-2 hover:bg-slate-50 rounded-xl disabled:opacity-30 transition-colors"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <span className="text-xs font-black text-gray-400">{t.pageLabel(page + 1)}</span>
                                <button
                                    disabled={!hasNextPage}
                                    onClick={() => setPage(p => p + 1)}
                                    className="p-2 hover:bg-slate-50 rounded-xl disabled:opacity-30 transition-colors"
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                        </div>

                        <div className="divide-y divide-gray-50">
                            {isLoading ? (
                                <div className="p-20 flex flex-col items-center justify-center gap-4">
                                    <Loader2 className="text-indigo-600 animate-spin" size={40} />
                                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">{t.loading}</p>
                                </div>
                            ) : filteredNotifs.length === 0 ? (
                                <div className="p-20 flex flex-col items-center justify-center text-center">
                                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                                        <Bell className="text-slate-200" size={32} />
                                    </div>
                                    <h4 className="text-gray-400 font-black uppercase tracking-widest">{t.emptyTitle}</h4>
                                    <p className="text-sm text-gray-300 mt-2">{t.emptySubtitle}</p>
                                </div>
                            ) : (
                                filteredNotifs.map((notif) => (
                                    <NotificationRow
                                        key={notif.id}
                                        notif={notif}
                                        onToggleDone={() => handleMarkDone(notif.id, notif.isRead)}
                                        onAck={(note) => handleAck(notif.id, note)}
                                        onRedirect={handleRedirectToDispatch}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}

// --- SUB-COMPONENTS ---

const NotificationRow = ({
    notif,
    onToggleDone,
    onAck,
    onRedirect
}: {
    notif: NotificationItem,
    onToggleDone: () => void,
    onAck: (note: string) => void,
    onRedirect: () => void
}) => {
    const isCritical = notif.type === 'EMERGENCY' || notif.type === 'COMPLAINT' || notif.type === 'CUSTOMER_EMERGENCY';
    const isInteraction = notif.type === 'WATER' || notif.type === 'SUPPORT' || notif.type === 'BUY_MORE' || notif.type === 'EMERGENCY' || notif.type === 'EARLY_EXIT' || notif.type.startsWith('CUSTOMER_');
    const isCustomer = notif.source === 'CUSTOMER' || notif.type.startsWith('CUSTOMER_');

    return (
        <motion.div
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`p-6 flex items-center gap-6 transition-all hover:bg-slate-50/50 ${notif.isRead ? 'opacity-60' : ''}`}
        >
            {/* Status Check */}
            <button
                onClick={onToggleDone}
                className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all border-2 ${
                    notif.isRead
                    ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-100'
                    : 'bg-white border-slate-100 text-slate-200 hover:border-emerald-300 hover:text-emerald-500'
                }`}
            >
                <Check size={20} strokeWidth={3} />
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                    {isCustomer && (
                        <span className="text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest bg-purple-100 text-purple-600 flex items-center gap-1">
                            👤 Khách
                        </span>
                    )}
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest ${
                        isCritical ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'
                    }`}>
                        {notif.type}
                    </span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        {parseDbDate(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {notif.acknowledgedAt ? (
                        <span className="text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest bg-emerald-100 text-emerald-600 flex items-center gap-1">
                            <Check size={12} strokeWidth={3} /> Đã xác nhận
                        </span>
                    ) : (
                        isInteraction && !notif.isRead && (
                            <span className="text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest bg-amber-100 text-amber-600 flex items-center gap-1">
                                <Clock size={12} strokeWidth={3} /> Chờ xử lý
                            </span>
                        )
                    )}
                </div>
                <h4 className={`text-base font-bold text-gray-900 tracking-tight ${notif.isRead ? 'line-through decoration-gray-400' : ''}`}>
                    {notif.message}
                </h4>
                {notif.acknowledgedAt && notif.acknowledgedNote && (
                    <p className="text-sm font-medium text-emerald-600 mt-1">
                        Ghi chú: {notif.acknowledgedNote}
                    </p>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
                {isInteraction && !notif.acknowledgedAt && (
                    <button
                        onClick={() => {
                            const note = window.prompt('Nhập ghi chú xác nhận:', 'Đã xác nhận');
                            if (note !== null) onAck(note);
                        }}
                        className="px-4 py-2 bg-emerald-50 text-emerald-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-100 transition-colors"
                    >
                        Xác nhận
                    </button>
                )}
                <button
                    onClick={onRedirect}
                    className="p-3 bg-white border border-gray-100 rounded-2xl text-indigo-600 hover:bg-indigo-50 hover:border-indigo-100 transition-all active:scale-95 group"
                    title={t.goToDispatch}
                >
                    <ExternalLink size={20} className="group-hover:rotate-12 transition-transform" />
                </button>
            </div>
        </motion.div>
    );
};
