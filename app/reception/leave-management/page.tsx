'use client';
import { parseDbDate } from "@/lib/utils";

import React from 'react';
import { ShieldAlert, Trash2, ChevronLeft, ChevronRight, Briefcase, ArrowRightLeft, UserPlus, Users, Loader2, Check, X, CalendarDays, CheckCircle2, CalendarOff } from 'lucide-react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { useLeaveManagement, useShiftManagement, AdminTab } from './LeaveManagement.logic';
import { t } from './LeaveManagement.i18n';
import { AppLayout } from '@/components/layout/AppLayout';

// 🔧 UI CONFIGURATION








const SHIFT_LABELS: Record<string, string> = {
    SHIFT_1: t.SHIFT_1,
    SHIFT_2: t.SHIFT_2,
    SHIFT_3: t.SHIFT_3,
    FREE: t.FREE,
    REQUEST: t.REQUEST,
};

const SHIFT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    SHIFT_1: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    SHIFT_2: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    SHIFT_3: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
    FREE: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
    REQUEST: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
};

const LeaveManagementPage = () => {
    const leaveLogic = useLeaveManagement();
    const shiftLogic = useShiftManagement();

    const {
        mounted,
        canAccessPage,
        adminTab,
        setAdminTab,
    } = leaveLogic;

    if (!mounted) return null;

    if (!canAccessPage) {
        return (
            <AppLayout title={t.pageTitle}>
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">{t.noAccess}</h2>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title={t.pageTitle}>
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

                
{/* ── ADMIN TAB SWITCHER ── */}
<div className="flex bg-gray-100 rounded-2xl p-1 gap-1">
    <button
        onClick={() => setAdminTab('off')}
        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
            adminTab === 'off'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
        }`}
    >
        <CalendarOff size={16} /> Lịch OFF
    </button>
    <button
        onClick={() => setAdminTab('shift')}
        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
            adminTab === 'shift'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
        }`}
    >
        <Briefcase size={16} /> Đổi Ca
        {shiftLogic.pendingShifts.length > 0 && (
            <span className="bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {shiftLogic.pendingShifts.length}
            </span>
        )}
    </button>
</div>

{/* ── TAB CONTENT ── */}

                {adminTab === 'off' ? (
                    <OffTab logic={leaveLogic} allShifts={shiftLogic.allShifts} />
                ) : (
                    <ShiftManagementTab logic={shiftLogic} />
                )}
            </div>
        </AppLayout>
    );
};

// ════════════════════════════════════════════════════════════════
// OFF TAB (existing leave management)
// ════════════════════════════════════════════════════════════════

const MONTH_NAMES = [
    'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
    'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];
const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const BLOCKED_HOLIDAYS = ['04-30', '05-01', '09-02', '01-01'];

const OffTab = ({ logic, allShifts }: { logic: ReturnType<typeof useLeaveManagement>, allShifts: any[] }) => {
    const {
        isLoading,
        actionLoading,
        leaveList,
        handleDelete,
        calendarMonth,
        selectedDate,
        setSelectedDate,
        goToPrevMonth,
        goToNextMonth,
        goToToday,
    } = logic;

    const { year, month } = calendarMonth;
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();

    let startDow = firstDayOfMonth.getDay(); 
    startDow = startDow === 0 ? 6 : startDow - 1; 

    const leaveByDate: Record<string, typeof leaveList> = {};
    leaveList.forEach(leave => {
        if (!leaveByDate[leave.date]) leaveByDate[leave.date] = [];
        leaveByDate[leave.date].push(leave);
    });

    const todayStr = (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    })();

    const handleDateClick = (dateStr: string) => {
        setSelectedDate(dateStr === selectedDate ? null : dateStr);
    };

    const selectedLeaves = selectedDate ? (leaveByDate[selectedDate] || []) : [];

    return (
        <div className="space-y-5">
            {/* ── CALENDAR ── */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <button onClick={goToPrevMonth} className="p-2 hover:bg-white rounded-xl transition-colors shadow-sm border border-transparent hover:border-gray-200">
                        <ChevronLeft size={18} className="text-gray-500" />
                    </button>
                    <button onClick={goToToday} className="text-base font-black text-gray-800 px-4 py-1.5 hover:bg-white rounded-xl transition-colors shadow-sm border border-transparent hover:border-gray-200">
                        {MONTH_NAMES[month]} {year}
                    </button>
                    <button onClick={goToNextMonth} className="p-2 hover:bg-white rounded-xl transition-colors shadow-sm border border-transparent hover:border-gray-200">
                        <ChevronRight size={18} className="text-gray-500" />
                    </button>
                </div>

                <div className="px-4 py-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
                            <Loader2 size={20} className="animate-spin" />
                            <span className="text-sm">Đang tải lịch...</span>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-7 gap-1 mb-2">
                                {WEEKDAY_LABELS.map((day, i) => (
                                    <div key={day} className={`text-center text-[10px] font-bold uppercase tracking-wider py-1 ${i === 6 ? 'text-red-400' : i === 5 ? 'text-blue-400' : 'text-gray-400'}`}>
                                        {day}
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-7 gap-1">
                                {Array.from({ length: startDow }).map((_, i) => (
                                    <div key={`empty-${i}`} className="aspect-square" />
                                ))}

                                {Array.from({ length: daysInMonth }).map((_, i) => {
                                    const day = i + 1;
                                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                    const dayLeaves = leaveByDate[dateStr] || [];
                                    const isToday = dateStr === todayStr;
                                    const isSelected = dateStr === selectedDate;
                                    const isBlocked = BLOCKED_HOLIDAYS.includes(dateStr.slice(5));
                                    const offCount = dayLeaves.length;
                                    const dow = (startDow + i) % 7;
                                    
                                    let cellStyle = 'text-gray-600 hover:bg-gray-50 border border-transparent';
                                    
                                    if (isSelected) {
                                        cellStyle = 'bg-indigo-600 text-white shadow-md shadow-indigo-200 scale-105 font-bold border-indigo-600 z-10';
                                    } else if (isBlocked) {
                                        cellStyle = 'bg-gray-100 text-gray-400 cursor-not-allowed';
                                    } else if (isToday) {
                                        cellStyle = 'bg-indigo-50 text-indigo-700 border-indigo-200 font-black';
                                    } else if (offCount > 0) {
                                        cellStyle = 'bg-rose-50 text-rose-700 border-rose-100 font-bold hover:bg-rose-100';
                                    } else if (dow === 6) {
                                        cellStyle = 'text-red-400 hover:bg-red-50/50';
                                    } else if (dow === 5) {
                                        cellStyle = 'text-blue-400 hover:bg-blue-50/50';
                                    }

                                    return (
                                        <button
                                            key={dateStr}
                                            onClick={() => handleDateClick(dateStr)}
                                            className={`aspect-square rounded-xl flex flex-col items-center justify-center relative transition-all text-sm ${cellStyle}`}
                                        >
                                            <span className="leading-none">{day}</span>
                                            
                                            {/* Badge số lượng người off */}
                                            {offCount > 0 && !isSelected && (
                                                <div className="absolute -bottom-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-black w-4 h-4 flex items-center justify-center rounded-full shadow-sm border-2 border-white">
                                                    {offCount}
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── CHI TIẾT NGÀY ĐƯỢC CHỌN ── */}
            {selectedDate && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 bg-indigo-50/50">
                        <div className="bg-indigo-100 text-indigo-600 p-2 rounded-xl">
                            <CalendarDays size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-gray-900">Chi tiết ngày {format(new Date(selectedDate), 'dd/MM/yyyy')}</h3>
                            <p className="text-xs text-gray-500">Có {selectedLeaves.length} nhân sự đăng ký OFF</p>
                        </div>
                    </div>

                    <div className="p-4 space-y-5">
                        {/* KHU VỰC NGƯỜI NGHỈ */}
                        <div>
                            <h4 className="text-[11px] font-black text-rose-500 mb-2 uppercase tracking-wider flex items-center justify-between">
                                Nhân sự OFF
                                <span className="bg-rose-100 text-rose-700 py-0.5 px-2 rounded-full text-[10px]">
                                    {selectedLeaves.length}
                                </span>
                            </h4>
                            {selectedLeaves.length === 0 ? (
                                <div className="text-center py-4 bg-gray-50/50 rounded-2xl border border-gray-100 border-dashed">
                                    <p className="text-xs text-gray-400 font-medium">Không có ai OFF.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* NHÓM 1: NGHỈ ĐỘT XUẤT */}
                                    {selectedLeaves.filter(l => l.is_sudden_off).length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-lg border border-red-100 inline-block uppercase tracking-tighter">⚠️ Nghỉ Đột Xuất (Tính Phạt)</p>
                                            <div className="grid grid-cols-2 gap-2">
                                                {selectedLeaves.filter(l => l.is_sudden_off).map(leave => {
                                                    const loadState = actionLoading[leave.id];
                                                    return (
                                                        <div key={leave.id} className="flex items-center justify-between p-2 rounded-xl border border-red-100 bg-red-50/30 group">
                                                            <div className="min-w-0 flex-1">
                                                                <p className="font-bold text-[13px] text-red-700">{leave.employeeId}</p>
                                                                {leave.createdAt && (
                                                                    <p className="text-[9px] text-red-500/80 mt-0.5 font-medium">
                                                                        Lúc: {parseDbDate(leave.createdAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            <button onClick={() => handleDelete(leave.id)} disabled={!!loadState} className="p-1.5 text-red-300 hover:text-red-600 hover:bg-red-100 rounded-lg transition-all">
                                                                {loadState === 'delete' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* NHÓM 2: NGHỈ CÓ PHÉP */}
                                    {selectedLeaves.filter(l => !l.is_sudden_off).length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-100 inline-block uppercase tracking-tighter">✅ Nghỉ Có Phép / Gia Hạn</p>
                                            <div className="grid grid-cols-2 gap-2">
                                                {selectedLeaves.filter(l => !l.is_sudden_off).map(leave => {
                                                    const loadState = actionLoading[leave.id];
                                                    return (
                                                        <div key={leave.id} className="flex items-center justify-between p-2 rounded-xl border border-rose-100 bg-rose-50/50 group">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-2">
                                                                    <p className="font-bold text-[13px] text-rose-700">{leave.employeeId}</p>
                                                                    {leave.is_extension && <span className="text-[8px] font-black bg-purple-100 text-purple-600 px-1 py-0.5 rounded uppercase tracking-wider">Gia hạn</span>}
                                                                </div>
                                                                {leave.createdAt && (
                                                                    <p className="text-[9px] text-rose-500/80 mt-0.5 font-medium">
                                                                        Gửi lúc: {parseDbDate(leave.createdAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            <button onClick={() => handleDelete(leave.id)} disabled={!!loadState} className="p-1.5 text-rose-300 hover:text-rose-600 hover:bg-rose-100 rounded-lg transition-all">
                                                                {loadState === 'delete' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* KHU VỰC NGƯỜI LÀM */}
                        <div>
                            <h4 className="text-[11px] font-black text-emerald-600 mb-2 uppercase tracking-wider flex items-center justify-between">
                                Nhân sự làm việc
                                <span className="bg-emerald-100 text-emerald-700 py-0.5 px-2 rounded-full text-[10px]">
                                    {allShifts.filter(shift => !selectedLeaves.some(l => l.employeeId === shift.employeeId)).length}
                                </span>
                            </h4>
                            <div className="grid grid-cols-3 gap-2">
                                {allShifts
                                    .filter(shift => !selectedLeaves.some(l => l.employeeId === shift.employeeId))
                                    .map(shift => (
                                        <div key={shift.id} className="flex items-center justify-center py-1.5 px-2 rounded-xl border border-emerald-100/50 bg-emerald-50/50">
                                            <p className="font-bold text-[12px] text-emerald-700 truncate">{shift.employeeId}</p>
                                        </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ════════════════════════════════════════════════════════════════
// SHIFT MANAGEMENT TAB (NEW)
// ════════════════════════════════════════════════════════════════

const ShiftManagementTab = ({ logic }: { logic: ReturnType<typeof useShiftManagement> }) => {
    const {
        allShifts,
        pendingShifts,
        isLoadingShifts,
        shiftActionLoading,
        handleShiftAction,
        // Staff dropdown
        staffList,
        isLoadingStaff,
        unassignedStaff,
        // Assign modal
        assignModalOpen,
        setAssignModalOpen,
        assignEmployeeId,
        setAssignEmployeeId,
        assignShiftType,
        setAssignShiftType,
        isAssigning,
        handleAssignShift,
        openAssignModal,
    } = logic;

    if (isLoadingShifts) {
        return (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
                <Loader2 size={24} className="animate-spin" />
                <span className="text-sm font-medium">{t.loading}</span>
            </div>
        );
    }

    return (
        <>
            {/* ── PENDING SHIFT CHANGES ── */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                    <ArrowRightLeft size={18} className="text-amber-500" />
                    <h3 className="text-base font-bold text-gray-900">{t.shiftPendingTitle}</h3>
                    {pendingShifts.length > 0 && (
                        <span className="ml-auto bg-amber-100 text-amber-700 text-[10px] font-black px-2.5 py-0.5 rounded-full">
                            {pendingShifts.length}
                        </span>
                    )}
                </div>

                {pendingShifts.length === 0 ? (
                    <div className="text-center py-8">
                        <ArrowRightLeft size={30} className="text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">{t.shiftPendingEmpty}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {pendingShifts.map(shift => {
                            const loadState = shiftActionLoading[shift.id];
                            const prevLabel = SHIFT_LABELS[shift.previousShift || ''] || 'Chưa có ca';
                            const newLabel = SHIFT_LABELS[shift.shiftType] || shift.shiftType;

                            return (
                                <div key={shift.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-gray-50/50 transition-colors">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="w-10 h-10 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-center shrink-0">
                                            <ArrowRightLeft size={18} className="text-amber-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-sm text-gray-900 truncate">{shift.employeeName}</p>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-600 mt-0.5">
                                                <span className="font-medium">{prevLabel}</span>
                                                <ChevronRight size={12} className="text-gray-400" />
                                                <span className="font-bold text-indigo-600">{newLabel}</span>
                                            </div>
                                            {shift.reason && (
                                                <p className="text-xs text-gray-400 mt-0.5 truncate italic">
                                                    &ldquo;{shift.reason}&rdquo;
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex gap-1.5 shrink-0">
                                        <button
                                            onClick={() => handleShiftAction(shift.id, 'APPROVE')}
                                            disabled={!!loadState}
                                            className="p-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all disabled:opacity-50 shadow-sm active:scale-95"
                                            title={t.approve}
                                        >
                                            {loadState === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
                                        </button>
                                        <button
                                            onClick={() => handleShiftAction(shift.id, 'REJECT')}
                                            disabled={!!loadState}
                                            className="p-2.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-xl transition-all disabled:opacity-50"
                                            title={t.reject}
                                        >
                                            {loadState === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} strokeWidth={3} />}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── CURRENT SHIFT OVERVIEW ── */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                    <Users size={18} className="text-indigo-500" />
                    <h3 className="text-base font-bold text-gray-900">{t.shiftOverviewTitle}</h3>
                    <button
                        onClick={() => openAssignModal()}
                        className="ml-auto flex items-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition-colors"
                    >
                        <UserPlus size={13} />
                        {t.shiftAssign}
                    </button>
                </div>

                {allShifts.length === 0 ? (
                    <div className="text-center py-8">
                        <Briefcase size={30} className="text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">{t.shiftOverviewEmpty}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {allShifts.map(shift => {
                            const shiftColor = SHIFT_COLORS[shift.shiftType] || { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' };
                            
                            return (
                                <div key={shift.id} className="px-5 py-3.5 flex items-center gap-3 hover:bg-gray-50/50 transition-colors">
                                    {/* Avatar placeholder */}
                                    <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold text-xs shrink-0">
                                        {shift.employeeName?.charAt(0) || '?'}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm text-gray-900 truncate">{shift.employeeName}</p>
                                        <p className="text-[10px] text-gray-400 truncate">{shift.employeeId}</p>
                                    </div>

                                    {/* Shift badge */}
                                    <div className={`px-3 py-1.5 rounded-xl text-xs font-bold ${shiftColor.bg} ${shiftColor.text} border ${shiftColor.border}`}>
                                        {SHIFT_LABELS[shift.shiftType] || shift.shiftType}
                                    </div>

                                    {/* Action */}
                                    <button
                                        onClick={() => openAssignModal(shift.employeeId, shift.employeeName)}
                                        className="p-1.5 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                        title={t.shiftChange}
                                    >
                                        <ArrowRightLeft size={14} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── ASSIGN SHIFT MODAL ── */}
            {assignModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-5 shadow-2xl">
                        <h3 className="text-lg font-black text-gray-900 text-center">
                            {t.shiftAssignTitle}
                        </h3>

                        {/* Employee Dropdown — grouped by shift status */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700 block">
                                Chọn KTV
                                {unassignedStaff.length > 0 && (
                                    <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                        {unassignedStaff.length} chưa có ca
                                    </span>
                                )}
                            </label>
                            <select
                                value={assignEmployeeId}
                                onChange={e => setAssignEmployeeId(e.target.value)}
                                disabled={isLoadingStaff}
                                className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                            >
                                <option value="">{isLoadingStaff ? 'Đang tải...' : '-- Chọn nhân viên --'}</option>

                                {/* Group 1: Chưa có ca */}
                                {unassignedStaff.length > 0 && (
                                    <optgroup label="⚠️ Chưa có ca">
                                        {unassignedStaff.map(staff => (
                                            <option key={staff.id} value={staff.id}>
                                                {staff.full_name} ({staff.id})
                                            </option>
                                        ))}
                                    </optgroup>
                                )}

                                {/* Group 2: Đã có ca */}
                                {staffList.filter(s => !unassignedStaff.find(u => u.id === s.id)).length > 0 && (
                                    <optgroup label="✅ Đã có ca">
                                        {staffList
                                            .filter(s => !unassignedStaff.find(u => u.id === s.id))
                                            .map(staff => (
                                                <option key={staff.id} value={staff.id}>
                                                    {staff.full_name} ({staff.id})
                                                </option>
                                            ))
                                        }
                                    </optgroup>
                                )}
                            </select>
                        </div>

                        {/* Shift selector */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700 block">Chọn Ca</label>
                            <div className="space-y-2">
                                {['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'FREE', 'REQUEST'].map(shift => (
                                    <button
                                        key={shift}
                                        type="button"
                                        onClick={() => setAssignShiftType(shift)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                                            assignShiftType === shift
                                                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                                : 'border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-200'
                                        }`}
                                    >
                                        <div className={`w-2.5 h-2.5 rounded-full ${
                                            shift === 'SHIFT_1' ? 'bg-blue-600' : shift === 'SHIFT_2' ? 'bg-amber-600' : shift === 'SHIFT_3' ? 'bg-indigo-600' : shift === 'FREE' ? 'bg-teal-500' : 'bg-pink-500'
                                        }`} />
                                        <span className="text-sm font-bold">{SHIFT_LABELS[shift]}</span>
                                        {assignShiftType === shift && <CheckCircle2 size={14} className="ml-auto text-indigo-500" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => setAssignModalOpen(false)}
                                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleAssignShift}
                                disabled={!assignEmployeeId || !assignShiftType || isAssigning}
                                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 active:scale-95 transition-all"
                            >
                                {isAssigning ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                {t.shiftAssign}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default LeaveManagementPage;
