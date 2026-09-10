'use client';

import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
    ShieldAlert, Loader2, CalendarOff, CheckCircle2, Clock, XCircle, AlertCircle, ChevronRight, ChevronLeft, ChevronDown, Send, Briefcase, CalendarDays, ArrowRightLeft, Trash2, Lock
} from 'lucide-react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { useKTVSchedule, LeaveRequest, ScheduleTab } from './Schedule.logic';
import { getRegistrationEditWindow } from '@/lib/vn-time';
import { canEditRegistration, vnToday } from '@/lib/vn-time';
import { t } from './Schedule.i18n';

// 🔧 UI CONFIGURATION
const STATUS_COLORS = {
    PENDING: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: Clock },
    APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle2 },
    ACTIVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle2 },
    REPLACED: { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200', icon: CheckCircle2 },
    REJECTED: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: XCircle },
} as const;

const STATUS_LABELS: Record<string, string> = {
    PENDING: t.statusPending,
    APPROVED: t.statusApproved,
    ACTIVE: 'THÀNH CÔNG',
    REPLACED: 'ĐÃ THAY THẾ',
    REJECTED: t.statusRejected,
};

const MONTH_NAMES = [
    'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
    'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];




const SHIFT_LABELS: Record<string, string> = { SHIFT_1: t.SHIFT_1, SHIFT_2: t.SHIFT_2, SHIFT_3: t.SHIFT_3 };
const SHIFT_COLORS: Record<string, string> = { SHIFT_1: 'bg-blue-600', SHIFT_2: 'bg-amber-600', SHIFT_3: 'bg-indigo-600' };
const TAB_CONFIG: { id: ScheduleTab; label: string; icon: React.ReactNode }[] = [
    { id: 'off', label: t.tabOff, icon: <CalendarOff size={16} /> },
    { id: 'shift', label: t.tabShift, icon: <Briefcase size={16} /> },
];

const KTVSchedulePage = () => {
    const logic = useKTVSchedule();
    const { 
        workRegistrationList, expectedTimes, setExpectedTimes, 
        pendingSubmit, setPendingSubmit, confirmSubmitWorkRegistration, 
        editingReg, setEditingReg, handleSaveEditRegistration,
        handleSubmitWorkRegistration, handleCancelWorkRegistration,
        mounted, canAccessPage, user, logout, identityMismatch,
        activeTab, setActiveTab,
        currentShift, tomorrowShift, shiftHistory, isLoadingShift, newShiftType, isSubmittingShift, shiftError, shiftSuccess, setNewShiftType, setShiftError, handleSubmitShift,
        selectedDates, toggleDate, isSubmittingOff, leaveList, isLoadingLeaves,
        offError, offSuccess, setOffError, handleSubmitOff, confirmDialog, setConfirmDialog,
        calendarMonth, goToPrevMonth, goToNextMonth, goToToday, WEEKDAY_LABELS,
    } = logic;

    const [viewDate, setViewDate] = useState<string | null>(null);
    const [isWorkListOpen, setIsWorkListOpen] = useState(true);
    const [isOffListOpen, setIsOffListOpen] = useState(true);

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

    // ⚠️ Phiên của tab này và phiên mà server đang thấy là hai người khác nhau.
    // Xảy ra khi mở hai tài khoản KTV trên cùng một trình duyệt: cookie JWT dùng chung
    // cả trình duyệt nên người đăng nhập sau đè lên trước. Phải chặn hẳn: đi tiếp thì
    // màn hình hiển thị — và mọi thao tác sửa/huỷ — sẽ rơi vào lịch của đồng nghiệp.
    if (identityMismatch) {
        return (
            <AppLayout title={t.pageTitle}>
                <div className="max-w-md mx-auto px-4 py-16 flex flex-col items-center text-center">
                    <ShieldAlert size={48} className="text-amber-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">Phiên đăng nhập bị lẫn</h2>
                    <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                        Màn hình đang mở bằng tài khoản <b>{user?.code || user?.id}</b>, nhưng máy chủ đang
                        nhận bạn là <b>{String(identityMismatch).toUpperCase()}</b> — do trình duyệt này đã đăng
                        nhập tài khoản khác ở tab khác. Để tránh sửa nhầm lịch của người khác, vui lòng
                        đăng nhập lại.
                    </p>
                    <button
                        onClick={async () => {
                            await logout();
                            window.location.href = '/login?error=identity_mismatch';
                        }}
                        className="mt-6 px-6 py-3 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-200"
                    >
                        Đăng nhập lại
                    </button>
                </div>
            </AppLayout>
        );
    }

    const { year, month } = calendarMonth;
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();

    let startDow = firstDayOfMonth.getDay(); 
    startDow = startDow === 0 ? 6 : startDow - 1; 

    // API đã lọc sẵn theo người đăng nhập (JWT), nên mọi dòng ở đây đều là của
    // chính mình — không lọc lại theo `user.code` nữa. Danh tính trong sessionStorage
    // có thể cũ hoặc lệch với cookie, lọc theo nó thì lịch biến mất không lý do.
    // Trường hợp lệch đã bị chặn hẳn ở `identityMismatch` phía trên.
    const workRegByDate: Record<string, any[]> = {};
    if (workRegistrationList) {
        workRegistrationList.forEach((reg: any) => {
            if (!workRegByDate[reg.work_date]) workRegByDate[reg.work_date] = [];
            workRegByDate[reg.work_date].push(reg);
        });
    }

    const leaveByDate: Record<string, LeaveRequest[]> = {};
    leaveList.forEach(leave => {
        if (!leaveByDate[leave.date]) leaveByDate[leave.date] = [];
        leaveByDate[leave.date].push(leave);
    });

    const todayStr = (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    })();

    const tomorrowStr = (() => {
        const now = new Date();
        now.setDate(now.getDate() + 1);
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    })();

    const handleDateClick = (dateStr: string) => {
        // Luôn set viewDate để xem ai off
        setViewDate(dateStr);
        
        // Kiểm tra xem user hiện tại đã đăng ký ngày này chưa
        const dayLeaves = leaveByDate[dateStr] || [];
        const myLeave = dayLeaves.find(l => l.employeeId === user?.id);
        const myWorkReg = workRegByDate[dateStr]?.[0];
        
        // Chỉ cho phép chọn/huỷ chọn những ngày > today VÀ chưa từng đăng ký
        if (!myLeave) {
            const isSelected = selectedDates.includes(dateStr);
            
            if (!isSelected) {
                if (!canEditRegistration(dateStr)) {
                    setOffError('Chỉ có thể đăng ký/chỉnh sửa lịch từ ngày mai trở đi.');
                    return;
                }
            }
            
            // Bỏ cảnh báo ở đây, chuyển vào modal pendingSubmit

            // Clear error and toggle
            setOffError(null);
            toggleDate(dateStr);
        }
    };

    // Dates for viewing info: if they selected multiple, show all?
    // User requested: "chỉ hiển thị ds off ngày đó". So we use viewDate, or if multiple selected, show the last one, or combine.
    // Let's combine the leaveList for all selectedDates, plus viewDate if it's not in selectedDates.
    const displayDatesSet = new Set<string>();
    selectedDates.forEach(d => displayDatesSet.add(d));
    if (viewDate) displayDatesSet.add(viewDate);
    const sortedDisplayDates = Array.from(displayDatesSet).sort();

    return (
        <AppLayout title={t.pageTitle}>
            <div className="max-w-md mx-auto px-4 py-6 space-y-5">
                
                <div>
                    <p className="text-sm text-gray-500">{t.pageSubtitle}</p>
                </div>

                {/* ── TAB SWITCHER ── */}
                <div className="flex bg-gray-100 rounded-2xl p-1 gap-1 mb-5">
                    {TAB_CONFIG.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            {tab.icon}{tab.id === "shift" && user?.work_type === "TYPE_D" ? "Đăng Ký Làm" : tab.label}
                        </button>
                    ))}
                </div>

                {(activeTab === 'off' || (activeTab === 'shift' && user?.work_type === 'TYPE_D')) && (<>
                {/* ── CALENDAR ── */}
                <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                        <button onClick={goToPrevMonth} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                            <ChevronLeft size={18} className="text-gray-500" />
                        </button>
                        <button onClick={goToToday} className="text-sm font-bold text-gray-800 px-3 py-1.5 hover:bg-gray-50 rounded-xl transition-colors">
                            {MONTH_NAMES[month]} {year}
                        </button>
                        <button onClick={goToNextMonth} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                            <ChevronRight size={18} className="text-gray-500" />
                        </button>
                    </div>

                    <div className="px-4 py-4">
                        {isLoadingLeaves ? (
                            <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
                                <Loader2 size={20} className="animate-spin" />
                                <span className="text-sm">{t.scheduleLoading}</span>
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
                                        const isPast = dateStr < todayStr;
                                        const isSelected = selectedDates.includes(dateStr);
                                        const dow = (startDow + i) % 7; 
                                        
                                        // Kiểm tra xem user hiện tại đã đăng ký ngày này chưa
                                        const myLeave = dayLeaves.find(l => l.employeeId === user?.id);
                                        const myWorkReg = workRegByDate[dateStr]?.[0];
                                        
                                        let cellStyle = 'text-gray-500 hover:bg-gray-50';
                                        
                                        if (myWorkReg && myWorkReg.status === "REGISTERED") {
                                            cellStyle = "bg-emerald-500 text-white shadow-md shadow-emerald-200 font-bold";
                                        } else if (myWorkReg && myWorkReg.status === "OFF_REGISTERED") {
                                            cellStyle = "bg-rose-600 text-white shadow-md shadow-rose-200 font-bold";
                                        } else if (isSelected) {
                                            cellStyle = activeTab === 'shift' 
                                                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200 scale-105 font-bold'
                                                : 'bg-rose-500 text-white shadow-md shadow-rose-200 scale-105 font-bold';
                                        } else if (myLeave) {
                                            if (myLeave.status === 'APPROVED') {
                                                cellStyle = 'bg-emerald-500 text-white shadow-md shadow-emerald-200 font-bold';
                                            } else if (myLeave.status === 'PENDING') {
                                                cellStyle = 'bg-amber-400 text-white shadow-md shadow-amber-200 font-bold';
                                            } else {
                                                cellStyle = 'bg-red-400 text-white shadow-md shadow-red-200 font-bold';
                                            }
                                        } else if (isToday) {
                                            cellStyle = 'bg-indigo-50 text-indigo-700 border-2 border-indigo-300 font-black';
                                        } else if (isPast) {
                                            cellStyle = 'text-gray-300 bg-gray-50/30';
                                        } else if (dow === 6) {
                                            cellStyle = 'text-red-300 hover:bg-red-50/50';
                                        } else if (dow === 5) {
                                            cellStyle = 'text-blue-300 hover:bg-blue-50/50';
                                        }

                                        return (
                                            <button
                                                key={dateStr}
                                                onClick={() => {
                                                    if (myWorkReg) {
                                                        if (!canEditRegistration(dateStr)) {
                                                            setOffError(`Chỉ có thể đăng ký/sửa lịch từ ngày mai trở đi.`);
                                                            return;
                                                        }
                                                        setOffError(null);
                                                        setEditingReg({ date: dateStr, expected_time: myWorkReg.expected_time || "", status: myWorkReg.status });
                                                    } else {
                                                        handleDateClick(dateStr);
                                                    }
                                                }}
                                                className={`aspect-square rounded-xl flex flex-col items-center justify-center relative transition-all text-sm ${cellStyle}`}
                                            >
                                                <span className={`leading-none ${isToday && !isSelected && !myLeave ? 'text-indigo-700' : ''}`}>
                                                    {day}
                                                </span>

                                                
                                                {/* Icon check nếu mình đã off */}
                                                {myLeave && !isSelected && (
                                                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                                                        {myLeave.status === 'APPROVED' ? <CheckCircle2 size={10} className="text-emerald-500" /> : 
                                                         myLeave.status === 'PENDING' ? <Clock size={10} className="text-amber-500" /> : 
                                                         <XCircle size={10} className="text-red-500" />}
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                                
                                {/* <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-gray-100 flex-wrap">
                                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-[10px] text-gray-500 font-medium">Đã duyệt</span></div>
                                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-400" /><span className="text-[10px] text-gray-500 font-medium">Chờ duyệt</span></div>
                                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-rose-500" /><span className="text-[10px] text-gray-500 font-medium">Đang chọn</span></div>
                                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-400" /><span className="text-[10px] text-gray-500 font-medium">Từ chối</span></div>
                                </div> */}
                            </>
                        )}
                    </div>
                </div>

                {/* ── REGISTRATION ACTIONS ── */}
                {selectedDates.length > 0 && activeTab === 'off' && (
                    <div className="bg-white rounded-3xl border border-gray-100 shadow-lg p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-rose-100 text-rose-600 p-2 rounded-xl">
                                <CalendarOff size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 text-sm">Đăng ký nghỉ OFF</h3>
                                <p className="text-xs text-gray-500">Đã chọn {selectedDates.length} ngày</p>
                            </div>
                        </div>
                        <button
                            onClick={() => handleSubmitOff()}
                            className="w-full py-3.5 bg-rose-600 text-white font-bold rounded-2xl hover:bg-rose-700 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md shadow-rose-200"
                        >
                            <Send size={18} /> Chọn giờ & Xác nhận gửi
                        </button>
                    </div>
                )}

                {selectedDates.length > 0 && activeTab === 'shift' && user?.work_type === 'TYPE_D' && (
                    <div className="bg-white rounded-3xl border border-gray-100 shadow-lg p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-blue-100 text-blue-600 p-2 rounded-xl">
                                <Briefcase size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 text-sm">Đăng ký Đi Làm</h3>
                                <p className="text-xs text-gray-500">Đã chọn {selectedDates.length} ngày</p>
                            </div>
                        </div>
                        <button
                            onClick={() => handleSubmitWorkRegistration()}
                            className="w-full py-3.5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-md shadow-blue-200"
                        >
                            <Send size={18} /> Chọn giờ & Xác nhận gửi
                        </button>
                    </div>
                )}

                {/* ── DANH SÁCH NGÀY ĐÃ ĐĂNG KÝ ĐI LÀM (ngày + giờ) ── */}
                {user?.work_type === 'TYPE_D' && (() => {
                    const myWorkDays = (workRegistrationList || [])
                        .filter((r: any) => r.status === 'REGISTERED')
                        .sort((a: any, b: any) => a.work_date.localeCompare(b.work_date));

                    if (myWorkDays.length === 0) return null;

                    return (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-lg p-5">
                            <button
                                onClick={() => setIsWorkListOpen(v => !v)}
                                aria-expanded={isWorkListOpen}
                                className="w-full flex items-center gap-3 text-left"
                            >
                                <div className="bg-emerald-100 text-emerald-600 p-2 rounded-xl shrink-0">
                                    <Briefcase size={20} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-gray-900 text-sm">Lịch đi làm đã đăng ký</h3>
                                    <p className="text-xs text-gray-500">{myWorkDays.length} ngày trong tháng {month + 1}</p>
                                </div>
                                <ChevronDown
                                    size={18}
                                    className={`text-gray-400 shrink-0 transition-transform duration-200 ${isWorkListOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            <div className={`divide-y divide-gray-100 overflow-hidden transition-all duration-200 ${isWorkListOpen ? 'mt-3' : 'max-h-0 opacity-0'}`}>
                                {myWorkDays.map((reg: any) => {
                                    const canEdit = canEditRegistration(reg.work_date);
                                    const d = new Date(reg.work_date + 'T00:00:00');
                                    const timeStr = (reg.expected_time || '').slice(0, 5) || '--:--';

                                    return (
                                        <button
                                            key={reg.work_date}
                                            onClick={() => {
                                                if (!canEdit) {
                                                    setOffError(`Chỉ có thể đăng ký/sửa lịch từ ngày mai trở đi.`);
                                                    return;
                                                }
                                                setOffError(null);
                                                setEditingReg({ date: reg.work_date, expected_time: reg.expected_time || '', status: reg.status });
                                            }}
                                            className="w-full flex items-center justify-between py-3 text-left group"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex flex-col items-center justify-center leading-none shrink-0">
                                                    <span className="text-[9px] font-medium opacity-80">{format(d, 'MM')}</span>
                                                    <span className="text-sm font-bold">{format(d, 'dd')}</span>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-gray-900 capitalize">{format(d, 'EEEE', { locale: vi })}</p>
                                                    <p className="text-xs text-gray-500">{format(d, 'dd/MM/yyyy')}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <div className="text-right">
                                                    <p className="text-[10px] text-gray-400 font-medium">Giờ đến tiệm</p>
                                                    <p className="text-sm font-bold text-emerald-600 flex items-center gap-1 justify-end">
                                                        <Clock size={13} /> {timeStr}
                                                    </p>
                                                </div>
                                                <span className="w-4 flex justify-center shrink-0">
                                                    {canEdit
                                                        ? <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
                                                        : <Lock size={14} className="text-gray-300" aria-label="Đã khóa" />}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                {/* ── DANH SÁCH NGÀY ĐÃ ĐĂNG KÝ OFF ── */}
                {(() => {
                    const isTypeD = user?.work_type === 'TYPE_D';

                    // Loại D: OFF nằm ở KTVTypeDDailyRegistration. Loại khác: ở KTVLeaveRequests.
                    const myOffDays = isTypeD
                        ? (workRegistrationList || [])
                            .filter((r: any) => r.status === 'OFF_REGISTERED')
                            .map((r: any) => ({ date: r.work_date, status: null as string | null, raw: r }))
                            .sort((a: any, b: any) => a.date.localeCompare(b.date))
                        : (leaveList || [])
                            .filter((l: any) => l.employeeId === user?.id)
                            .map((l: any) => ({ date: l.date, status: l.status as string | null, raw: l }))
                            .sort((a: any, b: any) => a.date.localeCompare(b.date));

                    if (myOffDays.length === 0) return null;

                    return (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-lg p-5">
                            <button
                                onClick={() => setIsOffListOpen(v => !v)}
                                aria-expanded={isOffListOpen}
                                className="w-full flex items-center gap-3 text-left"
                            >
                                <div className="bg-rose-100 text-rose-600 p-2 rounded-xl shrink-0">
                                    <CalendarOff size={20} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-gray-900 text-sm">Lịch nghỉ OFF đã đăng ký</h3>
                                    <p className="text-xs text-gray-500">{myOffDays.length} ngày trong tháng {month + 1}</p>
                                </div>
                                <ChevronDown
                                    size={18}
                                    className={`text-gray-400 shrink-0 transition-transform duration-200 ${isOffListOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            <div className={`divide-y divide-gray-100 overflow-hidden transition-all duration-200 ${isOffListOpen ? 'mt-3' : 'max-h-0 opacity-0'}`}>
                                {myOffDays.map((item: any) => {
                                    // Chỉ Loại D sửa được ngay tại đây; loại khác đi qua luồng duyệt nghỉ riêng.
                                    const canEdit = isTypeD && canEditRegistration(item.date);
                                    const d = new Date(item.date + 'T00:00:00');

                                    return (
                                        <button
                                            key={item.date}
                                            onClick={() => {
                                                if (!isTypeD) return;
                                                if (!canEdit) {
                                                    setOffError(`Chỉ có thể đăng ký/sửa lịch từ ngày mai trở đi.`);
                                                    return;
                                                }
                                                setOffError(null);
                                                setEditingReg({ date: item.date, expected_time: '', status: item.raw.status });
                                            }}
                                            className="w-full flex items-center justify-between py-3 text-left group"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-rose-500 text-white flex flex-col items-center justify-center leading-none shrink-0">
                                                    <span className="text-[9px] font-medium opacity-80">{format(d, 'MM')}</span>
                                                    <span className="text-sm font-bold">{format(d, 'dd')}</span>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-gray-900 capitalize">{format(d, 'EEEE', { locale: vi })}</p>
                                                    <p className="text-xs text-gray-500">{format(d, 'dd/MM/yyyy')}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-rose-600">
                                                    {item.status ? (STATUS_LABELS[item.status] || item.status) : 'Nghỉ OFF'}
                                                </span>
                                                {canEdit
                                                    ? <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
                                                    : <span className="w-4" />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                {/* ── PENDING SUBMIT MODAL (A1 & D1) ── */}
                {pendingSubmit && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 max-h-[90vh] flex flex-col">
                            <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${pendingSubmit.type === 'WORKING' ? 'bg-blue-100 text-blue-600' : 'bg-rose-100 text-rose-600'}`}>
                                {pendingSubmit.type === 'WORKING' ? <Briefcase size={24} /> : <CalendarOff size={24} />}
                            </div>
                            <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
                                {pendingSubmit.type === 'WORKING' ? 'Xác nhận đăng ký đi làm' : 'Xác nhận đăng ký nghỉ OFF'}
                            </h3>
                            <p className="text-sm text-gray-500 text-center mb-4">
                                Bạn đã chọn {pendingSubmit.dates.length} ngày. {pendingSubmit.type === 'WORKING' ? 'Vui lòng xác nhận thời gian đến làm.' : 'Kiểm tra lại danh sách ngày.'}
                            </p>
                            
                            <div className="overflow-y-auto flex-1 mb-4 space-y-2 px-1">
                                {pendingSubmit.dates.map(d => {
                                    const fmt = (() => {
                                        try { return format(new Date(d + 'T00:00:00'), 'EE, dd/MM', { locale: vi }); }
                                        catch { return d; }
                                    })();
                                    
                                    return (
                                        <div key={d} className="flex flex-col gap-1 bg-gray-50 p-3 rounded-2xl border border-gray-100">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-gray-700 text-sm uppercase">{fmt}</span>
                                                {pendingSubmit.type === 'WORKING' && (
                                                    <input 
                                                        type="time"
                                                        value={expectedTimes[d] || ""}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            setExpectedTimes(prev => ({ ...prev, [d]: val }));
                                                        }}
                                                        className="w-32 px-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 font-bold text-sm bg-white"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {pendingSubmit.type === 'WORKING' && pendingSubmit.dates.length > 1 && (
                                <button
                                    onClick={() => {
                                        const firstTime = expectedTimes[pendingSubmit.dates[0]];
                                        if (!firstTime) return setOffError("Vui lòng nhập giờ cho ngày đầu tiên để áp dụng cho tất cả");
                                        const newTimes = { ...expectedTimes };
                                        pendingSubmit.dates.forEach(d => newTimes[d] = firstTime);
                                        setExpectedTimes(newTimes);
                                        setOffError(null);
                                    }}
                                    className="text-xs text-blue-600 font-bold mb-4 w-full text-center hover:underline"
                                >
                                    Áp dụng giờ đầu tiên cho tất cả
                                </button>
                            )}

                            {offError && (
                                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2 mb-4 flex items-center gap-2">
                                    <AlertCircle size={14} className="shrink-0" />
                                    <span>{offError}</span>
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button 
                                    onClick={() => {
                                        setPendingSubmit(null);
                                        setOffError(null);
                                    }}
                                    className="flex-1 py-3.5 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
                                >
                                    Quay lại
                                </button>
                                <button 
                                    onClick={() => {
                                        if (pendingSubmit.type === 'WORKING') confirmSubmitWorkRegistration();
                                        else handleSubmitOff();
                                    }}
                                    disabled={isSubmittingOff}
                                    className={`flex-1 py-3.5 text-white font-bold rounded-2xl transition-all shadow-md ${pendingSubmit.type === 'WORKING' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'} disabled:opacity-50 flex justify-center items-center`}
                                >
                                    {isSubmittingOff ? <Loader2 size={18} className="animate-spin" /> : 'Xác nhận gửi'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* ── EDIT REGISTRATION MODAL (E1) ── */}
                {editingReg && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 flex flex-col">
                            {editingReg.step === 'CONFIRM_CANCEL' ? (
                                <>
                                    <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 bg-red-100 text-red-600">
                                        <AlertCircle size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
                                        {editingReg.status === 'REGISTERED' ? 'Chuyển sang OFF?' : 'Xác nhận hủy lịch'}
                                    </h3>
                                    <p className="text-sm text-gray-500 text-center mb-4">
                                        {editingReg.status === 'REGISTERED'
                                            ? <>Ngày {editingReg.date} sẽ chuyển thành <strong>OFF</strong>{editingReg.expected_time ? ` (đang đăng ký đi làm lúc ${editingReg.expected_time})` : ''}.</>
                                            : <>Bạn có chắc chắn muốn hủy đăng ký OFF ngày {editingReg.date}?</>}
                                    </p>

                                    {/* Cảnh báo trừ giờ khi bỏ ca sau hạn miễn phạt */}
                                    {editingReg.status === 'REGISTERED'
                                        && getRegistrationEditWindow(editingReg.date) === 'PENALTY' && (
                                        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl px-4 py-3 mb-4">
                                            <p className="text-sm font-black text-amber-900 mb-1 flex items-center gap-2">
                                                <AlertCircle size={16} /> Bạn sẽ bị trừ 5 giờ tích lũy
                                            </p>
                                            <p className="text-xs text-amber-800 leading-relaxed">
                                                Đã sang ngày làm việc — quá hạn đổi lịch miễn phạt (hết ngày hôm trước).
                                                Giờ tích lũy quyết định thứ tự nhận khách của bạn.
                                            </p>
                                        </div>
                                    )}
                                    
                                    {offError && (
                                        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2 mb-4 flex items-center gap-2">
                                            <AlertCircle size={14} className="shrink-0" />
                                            <span>{offError}</span>
                                        </div>
                                    )}

                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => { setEditingReg({ ...editingReg, step: 'EDIT' }); setOffError(null); }}
                                            className="flex-1 py-3.5 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
                                        >
                                            Quay lại
                                        </button>
                                        <button 
                                            onClick={() => handleCancelWorkRegistration(editingReg.date)}
                                            disabled={isSubmittingOff}
                                            className="flex-1 py-3.5 text-white font-bold rounded-2xl transition-all shadow-md bg-red-600 hover:bg-red-700 shadow-red-200 disabled:opacity-50 flex justify-center items-center gap-2"
                                        >
                                            {isSubmittingOff ? <Loader2 size={18} className="animate-spin" /> : 'Xác nhận hủy'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-bold text-gray-900">
                                            Sửa lịch ngày {editingReg.date}
                                        </h3>
                                        <button onClick={() => { setEditingReg(null); setOffError(null); }} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
                                            <XCircle size={20} />
                                        </button>
                                    </div>

                                    <div className="space-y-4 mb-6">
                                        <div className={`flex items-center gap-3 p-3 rounded-2xl border ${editingReg.status === 'REGISTERED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                                            {editingReg.status === 'REGISTERED' ? <Briefcase size={20} /> : <CalendarOff size={20} />}
                                            <span className="font-bold text-sm">
                                                Đang đăng ký {editingReg.status === 'REGISTERED' ? 'ĐI LÀM' : 'OFF'}
                                            </span>
                                        </div>
                                        
                                        {/* Đang OFF: nhập giờ để chuyển sang ĐI LÀM.
                                            Đang ĐI LÀM: sửa giờ đến tiệm. */}
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 mb-2">
                                                {editingReg.status === 'REGISTERED'
                                                    ? 'Giờ đến tiệm (Bắt buộc)'
                                                    : 'Muốn đi làm ngày này? Nhập giờ đến tiệm'}
                                            </label>
                                            <input
                                                type="time"
                                                value={editingReg.expected_time || ""}
                                                onChange={e => setEditingReg({ ...editingReg, expected_time: e.target.value })}
                                                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 font-bold"
                                            />
                                        </div>
                                    </div>

                                    {offError && (
                                        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2 mb-4 flex items-center gap-2">
                                            <AlertCircle size={14} className="shrink-0" />
                                            <span>{offError}</span>
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-3">
                                        <button
                                            onClick={() => handleSaveEditRegistration()}
                                            disabled={isSubmittingOff || !editingReg.expected_time}
                                            className="w-full py-3.5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-md shadow-blue-200 disabled:opacity-50 flex justify-center items-center gap-2"
                                        >
                                            {isSubmittingOff ? <Loader2 size={18} className="animate-spin" /> : (
                                                <><CheckCircle2 size={18}/> {editingReg.status === 'REGISTERED' ? 'Lưu thay đổi' : 'Chuyển sang ĐI LÀM'}</>
                                            )}
                                        </button>

                                        {/* Chỉ hiện khi đang ĐI LÀM — đang OFF rồi thì không có gì để chuyển. */}
                                        {editingReg.status === 'REGISTERED' && (
                                            <button
                                                onClick={() => setEditingReg({ ...editingReg, step: 'CONFIRM_CANCEL' })}
                                                className="w-full py-3.5 bg-red-50 text-red-600 border border-red-200 font-bold rounded-2xl hover:bg-red-100 transition-colors flex justify-center items-center gap-2"
                                            >
                                                <CalendarOff size={18} /> Chuyển sang OFF
                                                {getRegistrationEditWindow(editingReg.date) === 'PENALTY' && (
                                                    <span className="text-[10px] font-black bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">−5 GIỜ</span>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* ── CONFIRMATION DIALOG ── */}
                {confirmDialog && confirmDialog.isOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95">
                            <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${confirmDialog.type === 'SUDDEN_OFF_WARNING' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                                <AlertCircle size={24} />
                            </div>
                            <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
                                {confirmDialog.type === 'SUDDEN_OFF_WARNING' ? 'Cảnh Báo Hết Lượt' : 'Xác Nhận Gia Hạn'}
                            </h3>
                            <p className="text-sm text-gray-600 text-center mb-6 leading-relaxed">
                                {confirmDialog.message}
                            </p>
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setConfirmDialog(null)}
                                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors"
                                >
                                    Hủy bỏ
                                </button>
                                <button 
                                    onClick={() => {
                                        const type = confirmDialog.type === 'SUDDEN_OFF_WARNING' ? 'sudden_off' : 'extension';
                                        handleSubmitOff(type);
                                    }}
                                    disabled={isSubmittingOff}
                                    className={`flex-1 py-3 text-white font-bold rounded-2xl transition-all shadow-md ${confirmDialog.type === 'SUDDEN_OFF_WARNING' ? 'bg-red-600 hover:bg-red-700 shadow-red-200' : 'bg-amber-500 hover:bg-amber-600 shadow-amber-200'} disabled:opacity-50 flex justify-center items-center`}
                                >
                                    {isSubmittingOff ? <Loader2 size={18} className="animate-spin" /> : 'Tiếp tục'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── DETAILS ── */}
                {sortedDisplayDates.length > 0 && (
                    <div className="space-y-3">
                        {sortedDisplayDates.map(date => {
                            // 🛡️ RIÊNG TƯ: chỉ hiển thị lịch nghỉ của chính mình, không xem của người khác.
                            const leaves = (leaveByDate[date] || []).filter(l => l.employeeId === user?.id);
                            const myRegRaw = user?.work_type === 'TYPE_D'
                                ? workRegByDate[date]?.[0]
                                : null;

                            // Không có gì của mình trong ngày này → không render thẻ rỗng.
                            if (!myRegRaw && leaves.length === 0) return null;

                            const formattedDate = (() => {
                                try { return format(new Date(date + 'T00:00:00'), 'EEEE, dd/MM/yyyy', { locale: vi }); }
                                catch { return date; }
                            })();

                            return (
                                <div key={date} className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden animate-in fade-in">
                                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                                        <p className="text-xs font-bold text-gray-700 uppercase">{formattedDate}</p>
                                    </div>
                                    <div className="p-4">
                                        
                                        {myRegRaw && (
                                            <div className={`flex flex-col gap-2 p-3 mb-3 rounded-2xl border ${myRegRaw.status === 'REGISTERED' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                                                <div className="flex justify-between items-center">
                                                    <div className="flex items-center gap-2">
                                                        {myRegRaw.status === 'REGISTERED' ? <Briefcase size={16} className="text-emerald-600"/> : <CalendarOff size={16} className="text-rose-600"/>}
                                                        <span className={`font-bold text-sm ${myRegRaw.status === 'REGISTERED' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                            {myRegRaw.status === 'REGISTERED' ? 'ĐĂNG KÝ ĐI LÀM' : 'ĐĂNG KÝ OFF'}
                                                        </span>
                                                    </div>
                                                    {myRegRaw.status === 'REGISTERED' && myRegRaw.expected_time && (
                                                        <span className="text-sm font-bold text-emerald-600 flex items-center gap-1">
                                                            <Clock size={13} /> {myRegRaw.expected_time.slice(0, 5)}
                                                        </span>
                                                    )}
                                                </div>
                                                {myRegRaw.late_report_count > 0 && (
                                                    <p className="text-[10px] text-gray-500 italic mt-1">
                                                        Số lần báo trễ: {myRegRaw.late_report_count}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {leaves.length > 0 && (
                                            <div className="space-y-2">
                                                {leaves.map(leave => {
                                                    const cfg = STATUS_COLORS[leave.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.PENDING;
                                                    const Icon = cfg.icon;
                                                    return (
                                                        <div key={leave.id} className={`flex items-center gap-3 p-3 rounded-2xl border ${cfg.border} ${cfg.bg}`}>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-bold text-sm text-gray-900 truncate">
                                                                    Lịch nghỉ của bạn
                                                                </p>
                                                            </div>
                                                            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.text} ${cfg.bg}`}>
                                                                <Icon size={12} />
                                                                <span>{STATUS_LABELS[leave.status] || leave.status}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </>)}

                {activeTab === 'shift' && user?.work_type !== 'TYPE_D' && (
                    <ShiftTab
                        currentShift={currentShift}
                        tomorrowShift={tomorrowShift}
                        shiftHistory={shiftHistory}
                        isLoadingShift={isLoadingShift}
                        newShiftType={newShiftType}
                        isSubmittingShift={isSubmittingShift}
                        shiftError={shiftError}
                        shiftSuccess={shiftSuccess}
                        setNewShiftType={setNewShiftType}
                        setShiftError={setShiftError}
                        handleSubmitShift={handleSubmitShift}
                    />
                )}
            </div>
        </AppLayout>
    );
};

// ════════════════════════════════════════════════════════════════
// SHIFT TAB COMPONENT
// ════════════════════════════════════════════════════════════════
const ShiftTab = ({ currentShift, tomorrowShift, shiftHistory, isLoadingShift, newShiftType, isSubmittingShift, shiftError, shiftSuccess, setNewShiftType, setShiftError, handleSubmitShift }: any) => {
    if (isLoadingShift) {
        return (<div className="flex items-center justify-center py-16 gap-2 text-gray-400"><Loader2 size={20} className="animate-spin" /><span className="text-sm">{t.shiftLoading}</span></div>);
    }
    const effectiveShiftForChange = tomorrowShift?.shiftType || currentShift?.shiftType;
    const allShifts = ['SHIFT_1', 'SHIFT_2', 'SHIFT_3'];
    const nowHour = new Date().getHours();
    const isPast19 = nowHour >= 19;

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex gap-3">
                {currentShift ? (
                    <div className="flex-1 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-3xl p-5 text-white shadow-lg shadow-indigo-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-indigo-100 text-xs font-medium">{t.shiftCurrent}</span>
                            <Briefcase size={16} className="text-indigo-200" />
                        </div>
                        <div className="text-xl font-black tracking-tight">{SHIFT_LABELS[currentShift.shiftType] || currentShift.shiftType}</div>
                    </div>
                ) : (
                    <div className="flex-1 bg-gray-100 rounded-3xl p-5 text-gray-500 text-center border-2 border-dashed border-gray-200 flex flex-col justify-center">
                        <p className="font-medium text-sm">{t.shiftCurrentEmpty}</p>
                    </div>
                )}

                {isPast19 && (
                    tomorrowShift ? (
                        <div className="flex-1 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-3xl p-5 text-white shadow-lg shadow-emerald-200 opacity-90">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-emerald-100 text-xs font-medium">Ca ngày mai</span>
                                <CalendarDays size={16} className="text-emerald-200" />
                            </div>
                            <div className="text-xl font-black tracking-tight">{SHIFT_LABELS[tomorrowShift.shiftType] || tomorrowShift.shiftType}</div>
                        </div>
                    ) : (
                        <div className="flex-1 bg-gray-100 rounded-3xl p-5 text-gray-500 text-center border-2 border-dashed border-gray-200 flex flex-col justify-center opacity-80">
                            <p className="font-medium text-xs">Chưa có ca ngày mai</p>
                        </div>
                    )
                )}
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                <div className="px-6 pt-6 pb-2">
                    <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                        <ArrowRightLeft size={20} className="text-indigo-500" />{t.shiftFormTitle}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">Đổi ca sẽ có hiệu lực từ ngày hôm sau (yêu cầu trước 19h00).</p>
                </div>
                <form onSubmit={handleSubmitShift} className="px-6 pb-6 space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">{t.shiftSelectNew}</label>
                        <div className="space-y-2">
                            {allShifts.map(shift => {
                                const isCurrent = shift === effectiveShiftForChange;
                                if (isCurrent) {
                                    return (
                                        <div key={shift} className="w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 border-emerald-100 bg-emerald-50 text-emerald-700 transition-all text-left opacity-90 cursor-not-allowed">
                                            <CheckCircle2 size={16} className="text-emerald-500" />
                                            <span className="text-sm font-medium">Bạn đã đăng ký {SHIFT_LABELS[shift]}</span>
                                        </div>
                                    );
                                }
                                return (
                                    <button key={shift} type="button" onClick={() => setNewShiftType(shift)}
                                        className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all text-left ${newShiftType === shift ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-200'}`}>
                                        <div className={`w-3 h-3 rounded-full ${SHIFT_COLORS[shift] || 'bg-gray-400'}`} />
                                        <span className="text-sm font-bold">{SHIFT_LABELS[shift] || shift}</span>
                                        {newShiftType === shift && <CheckCircle2 size={16} className="ml-auto text-indigo-500" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    {shiftError && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-2xl px-4 py-3 flex items-center gap-2">
                            <AlertCircle size={16} className="shrink-0" /><span>{shiftError}</span>
                            <button type="button" onClick={() => setShiftError(null)} className="ml-auto"><XCircle size={16} /></button>
                        </div>
                    )}
                    {shiftSuccess && (
                        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-2xl px-4 py-3 flex items-center gap-2">
                            <CheckCircle2 size={16} className="shrink-0" /><span>{t.shiftSubmitSuccess}</span>
                        </div>
                    )}
                    <button type="submit" disabled={isSubmittingShift || !newShiftType}
                        className="w-full py-3.5 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-indigo-200">
                        {isSubmittingShift ? (<><Loader2 size={18} className="animate-spin" />{t.shiftSubmitting}</>) : (<><ArrowRightLeft size={18} />{t.shiftSubmit}</>)}
                    </button>
                </form>
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                <div className="px-6 pt-6 pb-3">
                    <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                        <CalendarDays size={20} className="text-gray-500" />{t.shiftHistoryTitle}
                    </h3>
                </div>
                <div className="px-6 pb-6">
                    {shiftHistory.length === 0 ? (
                        <div className="text-center py-6"><ArrowRightLeft size={30} className="text-gray-300 mx-auto mb-2" /><p className="text-sm text-gray-400">{t.shiftHistoryEmpty}</p></div>
                    ) : (
                        <div className="space-y-2.5">
                            {shiftHistory.map((record: any) => {
                                const statusConfig = STATUS_COLORS[record.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.APPROVED;
                                const StatusIcon = statusConfig.icon;
                                return (
                                    <div key={record.id} className={`flex items-center gap-3 p-3 rounded-2xl border ${statusConfig.border} ${statusConfig.bg}`}>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 text-sm font-bold text-gray-800">
                                                <span>{SHIFT_LABELS[record.previousShift || ''] || '—'}</span>
                                                <ChevronRight size={12} className="text-gray-400" />
                                                <span>{SHIFT_LABELS[record.shiftType] || record.shiftType}</span>
                                            </div>
                                            <p className="text-[10px] text-gray-400 mt-0.5">
                                                {(() => { try { return format(new Date(record.createdAt), 'dd/MM/yyyy'); } catch { return record.createdAt; } })()}
                                            </p>
                                        </div>
                                        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${statusConfig.text}`}>
                                            <StatusIcon size={11} /><span>{STATUS_LABELS[record.status] || record.status}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default KTVSchedulePage;
