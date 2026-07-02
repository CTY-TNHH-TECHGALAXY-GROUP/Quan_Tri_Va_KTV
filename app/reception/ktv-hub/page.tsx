'use client';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.2;

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import {
    ClipboardList, Users, CheckCircle2, Timer, Clock,
    MapPin, RotateCcw, ArrowDown, ArrowUp, ChevronRight, ChevronLeft, ChevronDown,
    UserCheck, Star, Moon, CalendarOff, Briefcase, ArrowRightLeft,
    UserPlus, AlertTriangle, Award, Camera, Plus,
    Check, X, Loader2, History, Save,
    Trash2, CalendarDays, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

import { supabase } from '@/lib/supabase';
import { useLeaveManagement, useShiftManagement } from '@/app/reception/leave-management/LeaveManagement.logic';
import { EmployeeDetailModal } from '@/components/EmployeeDetailModal';
import { getStaffList, updateStaffMember } from '@/app/admin/employees/actions';
import { Employee } from '@/lib/types';

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Tab = 'turns' | 'leave-off' | 'ktv-list';

type StaffData = {
    id: string;
    full_name: string;
    status: string;
    gender: string;
    skills: Record<string, string>;
    phone: string;
    position: string;
    avatar_url: string;
    experience: string;
};

type AttendanceRecord = {
    id?: string;
    employee_id: string;
    date: string;
    check_in_time?: string;
    check_out_time?: string;
    status: 'on_duty' | 'absent' | 'off_leave' | 'off_duty';
};

type TurnQueueData = {
    id?: string;
    employee_id: string;
    date: string;
    queue_position: number;
    check_in_order: number;
    status: 'waiting' | 'working' | 'assigned' | 'done_turn' | 'off';
    turns_completed: number;
    current_order_id?: string | null;
    estimated_end_time?: string | null;
    last_served_at?: string | null;
};

// ─── TAB CONFIG ───────────────────────────────────────────────────────────────

type AttendanceStatus = 'on_duty' | 'absent' | 'off_leave' | 'off_duty';
const ATT_OPTIONS: { id: AttendanceStatus; label: string; color: string }[] = [
    { id: 'on_duty', label: 'Có mặt', color: 'bg-emerald-500 text-white' },
    { id: 'absent', label: 'Vắng', color: 'bg-rose-500 text-white' },
    { id: 'off_duty', label: 'Tan ca', color: 'bg-amber-500 text-white' },
    { id: 'off_leave', label: 'Nghỉ phép', color: 'bg-slate-500 text-white' },
];
const TABS: { id: Tab; label: string; icon: React.ReactNode; short: string }[] = [
    { id: 'turns', label: 'Sổ Tua', short: 'Sổ tua', icon: <ClipboardList size={16} /> },
    { id: 'leave-off', label: 'Lịch OFF & Ca', short: 'Lịch OFF', icon: <CalendarOff size={16} /> },
    { id: 'ktv-list', label: 'Danh Sách KTV', short: 'DS KTV', icon: <Users size={16} /> },
];

// ──────────────────────────────────────────────────────────────────────────────
// PHOTO VIEWER MODAL
// ──────────────────────────────────────────────────────────────────────────────
const PhotoViewerModal = ({ photos, onClose }: { photos: string[] | null, onClose: () => void }) => {
    return (
        <AnimatePresence>
            {photos && photos.length > 0 && (
                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center p-4 backdrop-blur-sm" 
                    onClick={onClose}
                >
                    <button 
                        className="absolute top-6 right-6 bg-white/10 text-white p-2 rounded-full hover:bg-white hover:text-black transition-colors z-10"
                        onClick={onClose}
                    >
                        <X size={24} />
                    </button>
                    <div className="text-white mb-4 text-sm font-bold bg-white/10 px-4 py-2 rounded-full backdrop-blur-md border border-white/20 shadow-lg">
                        {photos.length} ảnh (Cuộn xuống để xem thêm)
                    </div>
                    <div 
                        className="w-full max-w-lg max-h-[85vh] overflow-y-auto space-y-4 rounded-xl pb-10"
                        onClick={e => e.stopPropagation()}
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                        {photos.map((url, idx) => (
                            <img key={idx} src={url} alt={`Photo ${idx + 1}`} className="w-full h-auto bg-gray-900 rounded-xl shadow-2xl border border-white/20" />
                        ))}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// ──────────────────────────────────────────────────────────────────────────────
// ATTENDANCE PENDING SECTION (Duyệt điểm danh)
// ──────────────────────────────────────────────────────────────────────────────

interface PendingRecord {
    id: string;
    employeeId: string;
    employeeName: string;
    checkType: string;
    latitude: number | null;
    longitude: number | null;
    locationText: string | null;
    checkedAt: string;
    photoUrl?: string | null;
    reason?: string | null;
}

const AttendancePendingSection = () => {
    const [records, setRecords] = React.useState<PendingRecord[]>([]);
    const [loading, setLoading] = React.useState<Record<string, 'confirm' | 'reject'>>({});
    const [viewerPhotos, setViewerPhotos] = React.useState<string[] | null>(null);

    const fetchPending = React.useCallback(async () => {
        try {
            const res = await fetch('/api/ktv/attendance/pending');
            const json = await res.json();
            if (json.success) setRecords(json.data);
        } catch { /* silent */ }
    }, []);

    React.useEffect(() => {
        fetchPending();
        // 🔧 EGRESS FIX: Removed 15s polling — Realtime on KTVAttendance already handles live updates.
        // fetchPending() is also called via Realtime triggers in the parent TurnTab component.
    }, [fetchPending]);

    const handleAction = async (id: string, action: 'CONFIRM' | 'REJECT') => {
        setLoading(prev => ({ ...prev, [id]: action === 'CONFIRM' ? 'confirm' : 'reject' }));
        try {
            await fetch('/api/ktv/attendance/confirm', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ attendanceId: id, action }),
            });
            setRecords(prev => prev.filter(r => r.id !== id));
        } catch { /* silent */ }
        setLoading(prev => { const next = { ...prev }; delete next[id]; return next; });
    };

    if (records.length === 0) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden"
        >
            <div className="px-4 py-3 border-b border-amber-100 flex items-center gap-2">
                <MapPin size={16} className="text-amber-600 animate-pulse" />
                <h2 className="font-bold text-amber-800 text-sm">Yêu Cầu Điểm Danh / OFF Chờ Duyệt</h2>
                <span className="ml-auto bg-amber-200 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {records.length}
                </span>
            </div>
            <AnimatePresence>
                {records.map((rec) => {
                    const mapsUrl = rec.latitude && rec.longitude
                        ? `https://maps.google.com/?q=${rec.latitude},${rec.longitude}`
                        : null;
                        
                    let typeLabel = 'VÀO CA';
                    let typeColor = 'bg-emerald-100 text-emerald-700 border-emerald-200';
                    if (rec.checkType === 'CHECK_OUT') {
                         typeLabel = 'TAN CA'; typeColor = 'bg-amber-100 text-amber-700 border-amber-200';
                    } else if (rec.checkType === 'LATE_CHECKIN') {
                         typeLabel = 'BỔ SUNG'; typeColor = 'bg-orange-100 text-orange-700 border-orange-200';
                    } else if (rec.checkType === 'OFF_REQUEST' || rec.checkType === 'SUDDEN_OFF') {
                         typeLabel = rec.checkType === 'SUDDEN_OFF' ? 'NGHỈ ĐỘT XUẤT' : 'XIN OFF'; typeColor = 'bg-rose-100 text-rose-700 border-rose-200';
                    }

                    const loadState = loading[rec.id];

                    return (
                        <motion.div
                            key={rec.id}
                            exit={{ opacity: 0, height: 0 }}
                            className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-100 last:border-0"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-gray-900 text-sm">{rec.employeeName || rec.employeeId}</span>
                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${typeColor}`}>
                                        {typeLabel}
                                    </span>
                                </div>
                                
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                                    <span className="text-xs text-gray-500 font-medium">
                                        {new Date(rec.checkedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    {mapsUrl && (
                                        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                                            className="text-[10px] text-blue-600 bg-blue-50/50 hover:bg-blue-100 border border-blue-100 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors">
                                            <MapPin size={10} /> GPS Location
                                        </a>
                                    )}
                                    {rec.photoUrl && (
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                try {
                                                    const p = JSON.parse(rec.photoUrl || '');
                                                    setViewerPhotos(Array.isArray(p) ? p : [rec.photoUrl!]);
                                                } catch { 
                                                    setViewerPhotos([rec.photoUrl!]); 
                                                }
                                            }}
                                            className="text-[10px] text-indigo-600 bg-indigo-50/50 hover:bg-indigo-100 border border-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors"
                                        >
                                            <Camera size={10} /> Xem {(() => {
                                                try { const p = JSON.parse(rec.photoUrl || ''); return Array.isArray(p) ? p.length : 1; } catch { return 1; }
                                            })()} ảnh
                                        </button>
                                    )}
                                </div>
                                {rec.reason && (
                                    <div className="mt-2 text-[11px] text-gray-600 italic bg-white/60 p-2 rounded-lg border border-amber-100/50">
                                        "{rec.reason}"
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-1.5 shrink-0 sm:self-center mt-2 sm:mt-0">
                                <button
                                    onClick={() => handleAction(rec.id, 'CONFIRM')}
                                    disabled={!!loadState}
                                    className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all disabled:opacity-50 shadow-sm"
                                    title="Xác nhận"
                                >
                                    {loadState === 'confirm' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
                                </button>
                                <button
                                    onClick={() => handleAction(rec.id, 'REJECT')}
                                    disabled={!!loadState}
                                    className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-xl transition-all disabled:opacity-50"
                                    title="Từ chối"
                                >
                                    {loadState === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                                </button>
                            </div>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
            <PhotoViewerModal photos={viewerPhotos} onClose={() => setViewerPhotos(null)} />
        </motion.div>
    );
};

// ──────────────────────────────────────────────────────────────────────────────
// ATTENDANCE HISTORY SECTION (Lịch sử điểm danh hôm nay - Collapsible)
// ──────────────────────────────────────────────────────────────────────────────

interface HistoryRecord {
    id: string;
    employeeId: string;
    employeeName: string;
    checkType: string;
    status: string;
    checkedAt: string;
    confirmedAt: string;
    confirmedBy: string | null;
    latitude: number | null;
    longitude: number | null;
    photoUrl?: string | null;
}

const AttendanceHistorySection = () => {
    const [records, setRecords] = React.useState<HistoryRecord[]>([]);
    const [isExpanded, setIsExpanded] = useState(false);
    const [viewerPhotos, setViewerPhotos] = React.useState<string[] | null>(null);

    const fetchHistory = React.useCallback(async () => {
        try {
            const res = await fetch('/api/ktv/attendance/history');
            const json = await res.json();
            if (json.success) setRecords(json.data);
        } catch { /* silent */ }
    }, []);

    React.useEffect(() => {
        fetchHistory();
        // 🔧 EGRESS FIX: Removed 30s polling — Realtime handles updates.
        // History data rarely changes (only after confirm/reject actions, which trigger state updates).
    }, [fetchHistory]);

    if (records.length === 0) return null;

    const confirmedCount = records.filter(r => r.status === 'CONFIRMED').length;
    const rejectedCount = records.filter(r => r.status === 'REJECTED').length;

    return (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Header - Clickable to toggle */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50/50 transition-colors cursor-pointer"
            >
                <div className="flex items-center gap-2">
                    <History size={14} className="text-gray-400" />
                    <span className="font-bold text-gray-700 text-sm">Lịch sử điểm danh hôm nay</span>
                </div>
                <div className="flex items-center gap-2">
                    {confirmedCount > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            ✓ {confirmedCount}
                        </span>
                    )}
                    {rejectedCount > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                            ✗ {rejectedCount}
                        </span>
                    )}
                    <ChevronDown
                        size={14}
                        className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                    />
                </div>
            </button>

            {/* Content - Animated */}
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                    >
                        <div className="border-t border-gray-100 divide-y divide-gray-50">
                            {records.map((rec) => {
                                const isCheckIn = rec.checkType === 'CHECK_IN';
                                const isConfirmed = rec.status === 'CONFIRMED';
                                return (
                                    <div key={rec.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                                            <span className="font-bold text-gray-800 text-sm truncate">
                                                {rec.employeeName || rec.employeeId}
                                            </span>
                                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full shrink-0 ${
                                                isCheckIn ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                            }`}>
                                                {rec.checkType === 'CHECK_IN' ? 'VÀO' : rec.checkType === 'CHECK_OUT' ? 'RA' : rec.checkType === 'OFF_REQUEST' ? 'OFF' : 'BỔ SUNG'}
                                            </span>
                                            {rec.latitude && rec.longitude && (
                                                <a
                                                    href={`https://maps.google.com/?q=${rec.latitude},${rec.longitude}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-[10px] text-blue-500 hover:text-blue-700 bg-blue-50/50 hover:bg-blue-100 px-1 border border-transparent rounded flex items-center gap-0.5 shrink-0 transition-colors"
                                                >
                                                    <MapPin size={10} /> GPS
                                                </a>
                                            )}
                                            {rec.photoUrl && (
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        try {
                                                            const p = JSON.parse(rec.photoUrl || '');
                                                            setViewerPhotos(Array.isArray(p) ? p : [rec.photoUrl!]);
                                                        } catch { 
                                                            setViewerPhotos([rec.photoUrl!]); 
                                                        }
                                                    }}
                                                    className="text-[10px] text-indigo-600 bg-indigo-50/50 hover:bg-indigo-100 border border-indigo-100 px-1.5 rounded flex items-center gap-1 shrink-0 transition-colors h-[21px]"
                                                >
                                                    <Camera size={10} /> Xem {(() => {
                                                        try { const p = JSON.parse(rec.photoUrl || ''); return Array.isArray(p) ? p.length : 1; } catch { return 1; }
                                                    })()} ảnh
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-[11px] text-gray-400">
                                                {new Date(rec.checkedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                isConfirmed 
                                                    ? 'bg-emerald-50 text-emerald-600' 
                                                    : 'bg-red-50 text-red-500'
                                            }`}>
                                                {isConfirmed ? '✓ Đã duyệt' : '✗ Từ chối'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            <PhotoViewerModal photos={viewerPhotos} onClose={() => setViewerPhotos(null)} />
        </div>
    );
};

// ──────────────────────────────────────────────────────────────────────────────
// TAB 1: CANH TUA
// ──────────────────────────────────────────────────────────────────────────────

const TurnTab = ({ staffs }: { staffs: StaffData[] }) => {
    // Luôn sử dụng múi giờ Việt Nam (UTC+7) làm mặc định
    const getVietnamDateString = () => {
        const d = new Date();
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        const vnTime = new Date(utc + (3600000 * 7));
        return vnTime.toISOString().split('T')[0];
    };
    const [selectedDate, setSelectedDate] = useState<string>(getVietnamDateString());
    const [turns, setTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
    const [shifts, setShifts] = useState<Record<string, { type: string, end: string | null }>>({});
    const [suddenOffs, setSuddenOffs] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    // 🔧 LOCAL REORDER STATE
    const [localOrder, setLocalOrder] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
    const [hasChanges, setHasChanges] = useState(false);
    const [isSavingOrder, setIsSavingOrder] = useState(false);
    const [editingKtvId, setEditingKtvId] = useState<string | null>(null);
    const hasChangesRef = useRef(false);

    useEffect(() => {
        if (staffs.length > 0) {
            fetchTurns();
            fetchExtras();
        }
    }, [staffs, selectedDate]);

    const fetchExtras = async () => {
        const today = selectedDate;
        const [shiftRes, leaveRes] = await Promise.all([
            supabase.from('KTVShifts').select('employeeId, shiftType, estimatedEndTime').eq('status', 'ACTIVE'),
            supabase.from('KTVLeaveRequests').select('employeeId').eq('date', today).eq('is_sudden_off', true)
        ]);
        if (shiftRes.data) {
            const shiftMap: Record<string, { type: string, end: string | null }> = {};
            shiftRes.data.forEach((s: any) => shiftMap[s.employeeId] = { type: s.shiftType, end: s.estimatedEndTime });
            setShifts(shiftMap);
        }
        if (leaveRes.data) {
            setSuddenOffs(new Set(leaveRes.data.map((l: any) => l.employeeId || l.employee_id)));
        }
    };

    // 🔄 REALTIME: Lắng nghe 3 bảng quan trọng liên quan đến điều phối
    useEffect(() => {
        if (staffs.length === 0) return;

        const channel = supabase.channel('turn-realtime-sync')
            // Bảng BookingItems: Gán KTV, đổi KTV, thêm dịch vụ add-on
            .on('postgres_changes', { event: '*', schema: 'public', table: 'BookingItems' }, () => {
                console.log('🔄 [Realtime] BookingItems changed → syncing turns...');
                if (!hasChangesRef.current) fetchTurns();
            })
            // Bảng Bookings: Cập nhật trạng thái đơn (DONE, CANCELLED, NEW...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'Bookings' }, () => {
                console.log('🔄 [Realtime] Bookings changed → syncing turns...');
                if (!hasChangesRef.current) fetchTurns();
            })
            // Bảng TurnQueue: Thay đổi tua trực tiếp (swap vị trí, reset, tan ca...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'TurnQueue' }, () => {
                console.log('🔄 [Realtime] TurnQueue changed → refreshing...');
                if (!hasChangesRef.current) fetchTurnsFromDB();
            })
            // Bảng DailyAttendance: Điểm danh, đổi trạng thái (on_duty, off_duty, absent...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'DailyAttendance' }, () => {
                console.log('🔄 [Realtime] DailyAttendance changed → syncing turns...');
                if (!hasChangesRef.current) fetchTurnsFromDB();
            })
            // Bảng KTVAttendance: KTV bấm điểm danh / tan ca trên app
            .on('postgres_changes', { event: '*', schema: 'public', table: 'KTVAttendance' }, () => {
                console.log('🔄 [Realtime] KTVAttendance changed → syncing turns...');
                if (!hasChangesRef.current) fetchTurnsFromDB();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'KTVLeaveRequests' }, () => {
                fetchExtras();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'KTVShifts' }, () => {
                fetchExtras();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [staffs, selectedDate]);

    // Fetch qua API (trigger sync logic đếm tua chính xác)
    const fetchTurns = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/turns?date=${selectedDate}`);
            const json = await res.json();
            if (json.success && json.data) {
                const merged = json.data.map((t: TurnQueueData) => ({
                    ...t,
                    staff: staffs.find(s => s.id === t.employee_id)
                }));
                setTurns(merged);
            }
        } catch (err) {
            console.error('Fetch turns error:', err);
        }
        setLoading(false);
    };

    // Fetch trực tiếp từ DB (dùng khi TurnQueue thay đổi, không cần re-sync)
    const fetchTurnsFromDB = async () => {
        const today = selectedDate;
        const { data } = await supabase
            .from('TurnQueue')
            // 🔧 EGRESS FIX: Select only needed columns
            .select('id, employee_id, date, check_in_order, queue_position, status, turns_completed, current_order_id, estimated_end_time')
            .eq('date', today)
            .order('turns_completed', { ascending: true })
            .order('check_in_order', { ascending: true });

        if (data) {
            const merged = data.map((t: TurnQueueData) => ({
                ...t,
                staff: staffs.find(s => s.id === t.employee_id)
            }));
            setTurns(merged);
        }
    };

    // Sắp xếp gốc: off cuối → theo tua → theo queue_position
    const buildSorted = useCallback((source: (TurnQueueData & { staff?: StaffData })[]) => {
        return [...source].sort((a, b) => {
            const isAOff = a.status === 'off' || suddenOffs.has(a.employee_id);
            const isBOff = b.status === 'off' || suddenOffs.has(b.employee_id);
            if (isAOff && !isBOff) return 1;
            if (!isAOff && isBOff) return -1;
            if (a.turns_completed !== b.turns_completed) return a.turns_completed - b.turns_completed;
            return a.check_in_order - b.check_in_order;
        });
    }, [suddenOffs]);

    // Sync localOrder khi turns thay đổi VÀ không có thay đổi chưa lưu
    useEffect(() => {
        if (!hasChanges) {
            setLocalOrder(buildSorted(turns));
        }
    }, [turns, buildSorted, hasChanges]);

    // ─── BATCH SAVE: Ghi check_in_order + queue_position vào DB ───
    const saveOrder = async () => {
        setIsSavingOrder(true);
        try {
            const updates = localOrder.map((turn) => {
                return supabase.from('TurnQueue')
                    .update({ check_in_order: turn.check_in_order, queue_position: turn.check_in_order })
                    .eq('id', turn.id!);
            });
            await Promise.all(updates);
            setHasChanges(false);
            hasChangesRef.current = false;
            fetchTurns();
        } catch (err) {
            console.error('Save order error:', err);
            alert('❌ Lỗi khi lưu thứ tự!');
        }
        setIsSavingOrder(false);
    };

    // ─── CANCEL: Huỷ thay đổi ───
    const cancelOrder = () => {
        setLocalOrder(buildSorted(turns));
        setHasChanges(false);
        hasChangesRef.current = false;
        setEditingKtvId(null);
    };

    // ─── INLINE EDIT: Thay đổi check_in_order trực tiếp ───
    const handleOrderChange = (ktvId: string, newOrder: number) => {
        if (isNaN(newOrder) || newOrder < 1) return;
        const next = localOrder.map(t => ({ ...t }));
        const target = next.find(t => t.employee_id === ktvId);
        if (!target) return;
        const oldOrder = target.check_in_order;
        // Nếu trùng → swap: KTV cũ nhận số cũ của target
        const conflict = next.find(t => t.check_in_order === newOrder && t.employee_id !== ktvId);
        if (conflict) {
            conflict.check_in_order = oldOrder;
        }
        target.check_in_order = newOrder;
        setLocalOrder(next);
        setHasChanges(true);
        hasChangesRef.current = true;
        setEditingKtvId(null);
    };

    const resetTurns = async () => {
        const next = [...turns].sort((a, b) => a.check_in_order - b.check_in_order);
        const updates = next.map((turn, i) => {
            const pos = i + 1;
            return supabase.from('TurnQueue')
                .update({ queue_position: pos })
                .eq('id', turn.id!);
        });
        await Promise.all(updates);
        setHasChanges(false);
        hasChangesRef.current = false;
        fetchTurns();
    };

    // Dùng localOrder cho hiển thị
    const sortedTurns = localOrder;

    const readyCount = turns.filter(t => t.status === 'waiting' && !suddenOffs.has(t.employee_id)).length;
    const workingCount = turns.filter(t => t.status === 'working' && !suddenOffs.has(t.employee_id)).length;
    const offCount = turns.filter(t => t.status === 'off' || suddenOffs.has(t.employee_id)).length;
    const activeCount = turns.length - offCount;

    if (loading) return <div className="p-10 text-center text-gray-500">Đang tải hàng đợi...</div>;

    return (
        <div className="space-y-4">
            {/* Attendance Pending - Duyệt điểm danh */}
            <AttendancePendingSection />
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
                {[
                    { label: 'Sẵn Sàng', value: readyCount, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
                    { label: 'Đang Làm', value: workingCount, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200' },
                    { label: 'Tổng Ca', value: activeCount, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
                ].map(s => (
                    <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3 text-center`}>
                        <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mt-0.5">{s.label}</p>
                    </div>
                ))}
            </div>

            {/* Queue */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <h3 className="font-bold text-gray-900 text-sm">Sổ hàng đợi tua</h3>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="text-xs font-medium border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500 text-gray-700 bg-gray-50"
                        />
                    </div>
                    {hasChanges ? (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={cancelOrder}
                                disabled={isSavingOrder}
                                className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 font-semibold transition-colors px-2 py-1 rounded-lg border border-gray-200 hover:border-red-200"
                            >
                                <X size={12} /> Huỷ
                            </button>
                            <button
                                onClick={saveOrder}
                                disabled={isSavingOrder}
                                className="flex items-center gap-1 text-xs text-white font-bold transition-colors px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 shadow-sm disabled:opacity-50"
                            >
                                {isSavingOrder ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Lưu thứ tự
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={resetTurns}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 font-semibold transition-colors"
                        >
                            <RotateCcw size={12} /> Đặt lại theo chấm công
                        </button>
                    )}
                </div>

                <div className="divide-y divide-gray-50 min-h-[100px]">
                    {turns.length === 0 ? (
                        <div className="p-8 text-center text-gray-400 text-sm">
                            Chưa có KTV nào điểm danh hôm nay
                        </div>
                    ) : sortedTurns.map((turn, idx) => (
                        <motion.div
                            layout
                            transition={{ duration: ANIMATION_DURATION }}
                            key={turn.employee_id}
                            className={`flex items-center gap-3 px-4 py-3 transition-colors ${suddenOffs.has(turn.employee_id) || turn.status === 'off' ? 'opacity-40 bg-gray-50/80' : 'hover:bg-gray-50/50'}`}
                        >
                            {/* Position badge - Editable */}
                            {editingKtvId === turn.employee_id ? (
                                <input
                                    type="number"
                                    min={1}
                                    defaultValue={turn.check_in_order}
                                    autoFocus
                                    className="w-8 h-8 rounded-xl text-center text-sm font-black shrink-0 shadow-sm border-2 border-indigo-500 bg-indigo-50 text-indigo-700 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    onBlur={(e) => handleOrderChange(turn.employee_id, parseInt(e.target.value))}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleOrderChange(turn.employee_id, parseInt((e.target as HTMLInputElement).value));
                                        if (e.key === 'Escape') setEditingKtvId(null);
                                    }}
                                />
                            ) : (
                                <div
                                    onClick={(e) => { e.stopPropagation(); setEditingKtvId(turn.employee_id); }}
                                    className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black shrink-0 shadow-sm cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-all ${suddenOffs.has(turn.employee_id) ? 'bg-red-100 text-red-500 border border-red-200' : turn.status === 'waiting' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                                        turn.status === 'working' ? 'bg-rose-100 text-rose-600 border border-rose-200' :
                                        turn.status === 'assigned' ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' :
                                            'bg-gray-100 text-gray-500 border border-gray-200'
                                    }`}>
                                    {turn.check_in_order}
                                </div>
                            )}

                            {/* Name */}
                            <div className="flex-1 min-w-0">
                                <p className={`font-bold text-sm truncate ${suddenOffs.has(turn.employee_id) ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                                    {turn.staff?.full_name || 'Không rõ'}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{turn.employee_id}</span>
                                    {turn.turns_completed > 0 && (
                                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-bold border border-indigo-100">
                                            Đã làm {turn.turns_completed} tua
                                        </span>
                                    )}
                                    {shifts[turn.employee_id]?.type === 'FREE' && shifts[turn.employee_id]?.end && (
                                        <span className="text-[10px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded font-bold border border-orange-100 flex items-center gap-1">
                                            <Clock size={10} /> Tự do (Về: {shifts[turn.employee_id].end})
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Status badge */}
                            <div className={`px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 shrink-0 ${turn.status === 'waiting' ? 'bg-emerald-100 text-emerald-700' :
                                turn.status === 'working' ? 'bg-rose-100 text-rose-700' :
                                turn.status === 'assigned' ? 'bg-indigo-100 text-indigo-700' :
                                    'bg-gray-100 text-gray-500'
                                }`}>
                                {turn.status === 'waiting' ? <CheckCircle2 size={10} /> :
                                    turn.status === 'working' ? <Timer size={10} className="animate-spin" /> :
                                    turn.status === 'assigned' ? <Clock size={10} /> :
                                        <Moon size={10} />}
                                <span className="hidden sm:inline">
                                    {turn.status === 'waiting' ? 'Sẵn sàng' : turn.status === 'working' ? (turn.estimated_end_time ? `Đang làm (xong lúc ${turn.estimated_end_time.substring(0, 5)})` : 'Đang làm') : turn.status === 'assigned' ? 'Đã xếp lịch' : 'Tan ca'}
                                </span>
                            </div>

                        </motion.div>
                    ))}
                </div>
            </div>

            {/* Attendance History - Collapsible */}
            <AttendanceHistorySection />

            {/* Rules */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                <h4 className="font-bold text-indigo-800 text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Clock size={12} /> Quy Tắc Sổ Tua
                </h4>
                <ul className="space-y-2 text-xs text-indigo-700 font-medium">
                    {[
                        'Hàng đợi luôn sắp xếp cố định theo số thứ tự điểm danh ban đầu',
                        'Lễ tân sẽ tuỳ tình hình thực tế để ưu tiên ai nhận tua trước',
                        'Chỉ tính tua khi phục vụ 2 bill khác nhau',
                    ].map((rule, i) => (
                        <li key={i} className="flex items-start gap-2">
                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full mt-1 shrink-0" />
                            {rule}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

// ──────────────────────────────────────────────────────────────────────────────
// TAB 2: ĐIỂM DANH (Admin view)
// ──────────────────────────────────────────────────────────────────────────────

const AttendanceTab = ({ staffs }: { staffs: StaffData[] }) => {
    const [attendances, setAttendances] = useState<Record<string, AttendanceRecord>>({});
    const [loading, setLoading] = useState(true);
    const [now] = useState(new Date());

    useEffect(() => {
        fetchAttendances();
    }, []);

    const fetchAttendances = async () => {
        setLoading(true);
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase
            .from('DailyAttendance')
            .select('*')
            .eq('date', today);

        const map: Record<string, AttendanceRecord> = {};
        if (data) {
            data.forEach((r: any) => map[r.employee_id] = r);
        }
        setAttendances(map);
        setLoading(false);
    };

    const setStatus = async (staffId: string, status: AttendanceRecord['status']) => {
        const today = new Date().toISOString().split('T')[0];
        const currentTime = format(new Date(), 'HH:mm:ss');
        const existing = attendances[staffId];



        const payload = {
            employee_id: staffId,
            date: today,
            status: status,
            check_in_time: (status === 'on_duty' && !existing?.check_in_time) ? currentTime : (existing?.check_in_time || null),
            check_out_time: status === 'off_duty' ? currentTime : (existing?.check_out_time || null),
        };        // 1. Upsert DailyAttendance
        const { data: attData, error: attError } = await supabase
            .from('DailyAttendance')
            .upsert(payload, { onConflict: 'employee_id, date' })
            .select()
            .single();

        if (attError) {
            console.error("❌ [KTVHub] Error saving attendance:", attError.message, attError.details, attError.hint);
            return;
        }

        setAttendances(prev => ({ ...prev, [staffId]: attData }));

        // Auto Manage TurnQueue
        if (status === 'on_duty') {
            if (!existing || existing.status !== 'on_duty') {
                // Find max check_in_order
                const { data: currentQueue } = await supabase
                    .from('TurnQueue')
                    .select('check_in_order, queue_position')
                    .eq('date', today);

                let maxOrder = 0;
                let maxPos = 0;
                currentQueue?.forEach(q => {
                    if (q.check_in_order > maxOrder) maxOrder = q.check_in_order;
                    if (q.queue_position > maxPos) maxPos = q.queue_position;
                });

                // 3. Check if turn exists
                const { data: existingTurn } = await supabase
                    .from('TurnQueue')
                    .select('id')
                    .eq('employee_id', staffId)
                    .eq('date', today)
                    .maybeSingle();

                const turnPayload = {
                    employee_id: staffId,
                    date: today,
                    check_in_order: maxOrder + 1,
                    queue_position: maxPos + 1,
                    status: 'waiting',
                    turns_completed: 0
                };

                if (existingTurn) {
                    await supabase
                        .from('TurnQueue')
                        .update(turnPayload)
                        .eq('id', existingTurn.id);
                } else {
                    await supabase
                        .from('TurnQueue')
                        .insert(turnPayload);
                }
            }
        } else {
            // Remove from TurnQueue if not on_duty (absent, off_leave, off_duty)
            await supabase
                .from('TurnQueue')
                .delete()
                .eq('employee_id', staffId)
                .eq('date', today);
        }
    };

    const counts = { on_duty: 0, absent: 0, off_leave: 0, off_duty: 0 };
    Object.values(attendances).forEach(a => {
        if (a.status === 'on_duty') counts.on_duty++;
        if (a.status === 'absent') counts.absent++;
        if (a.status === 'off_leave') counts.off_leave++;
        if (a.status === 'off_duty') counts.off_duty++;
    });

    if (loading) return <div className="p-10 text-center text-gray-500">Đang tải dữ liệu...</div>;

    return (
        <div className="space-y-4">
            {/* Date & Stats */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Ngày điểm danh</p>
                        <p className="font-black text-gray-900 text-sm">{format(now, 'EEEE, dd/MM/yyyy')}</p>
                    </div>
                    <p className="text-2xl font-black text-indigo-600">{format(now, 'HH:mm')}</p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    <div className="flex-1 text-center">
                        <p className="text-2xl font-black text-emerald-600">{counts.on_duty}</p>
                        <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> Có mặt
                        </p>
                    </div>
                    <div className="flex-1 text-center">
                        <p className="text-2xl font-black text-rose-500">{counts.absent}</p>
                        <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1">
                            <span className="w-1.5 h-1.5 bg-rose-500 rounded-full" /> Vắng
                        </p>
                    </div>
                    <div className="flex-1 text-center">
                        <p className="text-2xl font-black text-amber-500">{counts.off_duty || 0}</p>
                        <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1">
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" /> Tan ca
                        </p>
                    </div>
                    <div className="flex-1 text-center">
                        <p className="text-2xl font-black text-slate-500">{counts.off_leave}</p>
                        <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1">
                            <span className="w-1.5 h-1.5 bg-slate-500 rounded-full" /> Nghỉ phép
                        </p>
                    </div>
                </div>
            </div>

            {/* KTV Attendance List */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                    <h3 className="font-bold text-gray-900 text-sm">Danh Sách Chấm Công Hôm Nay</h3>
                </div>
                <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
                    {staffs.map(staff => {
                        const currentAtt = attendances[staff.id];
                        const currentStatus = currentAtt?.status || 'absent';
                        const checkInTime = currentAtt?.check_in_time;

                        return (
                            <div key={staff.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    {/* Avatar */}
                                    <div className="relative shrink-0">
                                        <img src={staff.avatar_url || `https://ui-avatars.com/api/?name=${staff.full_name}&background=random`} alt={staff.full_name} className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm" />
                                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${currentStatus === 'on_duty' ? 'bg-emerald-400' :
                                            currentStatus === 'absent' ? 'bg-rose-400' :
                                                currentStatus === 'off_duty' ? 'bg-amber-400' : 'bg-gray-300'
                                            }`} />
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm text-gray-900 truncate">{staff.full_name}</p>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase">{staff.id}</p>
                                        {checkInTime && currentStatus === 'on_duty' && (
                                            <p className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5 mt-0.5">
                                                <CheckCircle2 size={9} /> Tới lúc {checkInTime.substring(0, 5)}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Status selector */}
                                <div className="flex gap-1 shrink-0 w-full sm:w-auto">
                                    {(['on_duty', 'absent', 'off_duty', 'off_leave'] as const).map(s => (
                                        <button
                                            key={s}
                                            onClick={() => setStatus(staff.id, s)}
                                            className={`flex-1 sm:flex-none px-2 py-1.5 sm:py-1 rounded-lg text-[10px] font-bold transition-all border ${currentStatus === s
                                                ? s === 'on_duty' ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' :
                                                    s === 'absent' ? 'bg-rose-500 text-white border-rose-500 shadow-sm' :
                                                        s === 'off_duty' ? 'bg-amber-500 text-white border-amber-500 shadow-sm' :
                                                            'bg-gray-500 text-white border-gray-500 shadow-sm'
                                                : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
                                                }`}
                                        >
                                            {s === 'on_duty' ? 'Có mặt' : s === 'absent' ? 'Vắng' : s === 'off_duty' ? 'Tan ca' : 'Nghỉ phép'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// ──────────────────────────────────────────────────────────────────────────────
// TAB 3: DANH SÁCH KTV
// ──────────────────────────────────────────────────────────────────────────────

const KTVListTab = ({ staffs, onEdit }: { staffs: any[], onEdit: (staff: any) => void }) => {
    const typeofSkillValue = (val: any) => typeof val === 'string' ? val : 'basic';
    const skillEntries = (skills: any) =>
        Object.entries(skills || {}).filter(([, v]) => typeofSkillValue(v) === 'expert' || typeofSkillValue(v) === 'basic');

    const SKILL_LABELS: Record<string, string> = {
        shampoo: 'Gội đầu', thaiBody: 'Massage Thái', oilBody: 'Massage Dầu',
        hotStoneBody: 'Đá Nóng', foot: 'Foot',
        facial: 'Chăm Sóc Da', hairCut: 'Cắt Tóc', earCleaning: 'Ráy Tai',
    };

    return (
        <div className="space-y-3">
            {staffs.map(emp => {
                const expertSkills = skillEntries(emp.skills).filter(([, v]) => typeofSkillValue(v) === 'expert');
                const Avatar = emp.avatar_url || `https://ui-avatars.com/api/?name=${emp.full_name}&background=random`;

                return (
                    <div key={emp.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col sm:flex-row">
                        <div className="p-4 flex items-start gap-4 flex-1">
                            {/* Avatar */}
                            <div className="relative shrink-0">
                                <img src={Avatar} alt={emp.full_name} className="w-14 h-14 rounded-2xl object-cover border-2 border-gray-100 shadow-sm" />
                                <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${emp.status === 'ĐANG LÀM' ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                            </div>

                            {/* Main info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                    <p className="font-black text-gray-900 text-base">{emp.full_name}</p>
                                    <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">{emp.id}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${emp.gender === 'Nữ' || emp.gender === 'Female' ? 'bg-pink-100 text-pink-600 border border-pink-200' : 'bg-blue-100 text-blue-600 border border-blue-200'}`}>
                                        {emp.gender || 'Nam'}
                                    </span>
                                </div>
                                <p className="text-[11px] text-gray-500 font-medium">{emp.position || 'Kỹ Thuật Viên'} · {emp.experience || '1 năm kinh nghiệm'}</p>

                                {/* Rating (mock for real DB) */}
                                <div className="flex items-center gap-1 mt-1.5">
                                    <Star size={12} className="text-amber-400 fill-amber-400" />
                                    <span className="text-xs font-bold text-amber-600">5.0</span>
                                    <span className="text-[10px] text-gray-400 ml-1.5 font-medium">Hoa hồng 10%</span>
                                </div>

                                {/* Skills */}
                                {expertSkills.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                                        {expertSkills.slice(0, 4).map(([key]) => (
                                            <span key={key} className="text-[10px] px-2 py-1 bg-indigo-50/80 text-indigo-700 rounded-lg font-bold border border-indigo-100/50">
                                                {SKILL_LABELS[key] || key}
                                            </span>
                                        ))}
                                        {expertSkills.length > 4 && (
                                            <span className="text-[10px] px-2 py-1 bg-gray-100 text-gray-500 rounded-lg font-bold border border-gray-200">
                                                +{expertSkills.length - 4}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Status dot mobile/desktop adapt */}
                        <div className={`shrink-0 flex flex-col gap-2 items-center justify-center p-3 sm:px-4 sm:border-l border-t sm:border-t-0 border-gray-100 ${emp.status === 'ĐANG LÀM' ? 'bg-emerald-50/30' : 'bg-gray-50'}`}>
                            <div className={`px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm ${emp.status === 'ĐANG LÀM' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-gray-200 text-gray-500 border border-gray-300'
                                }`}>
                                {emp.status === 'ĐANG LÀM' ? '● Đang làm việc' : '○ Đã nghỉ'}
                            </div>
                            <button
                                onClick={() => onEdit(emp)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-bold text-[10px] transition-colors border border-indigo-100"
                            >
                                <Award size={14} />
                                Sửa tay nghề
                            </button>
                        </div>
                    </div>
                );
            })}

            {staffs.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                    <Users size={36} className="mx-auto mb-3 text-gray-200" />
                    <p className="text-sm font-medium">Chưa có KTV nào trong database</p>
                </div>
            )}
        </div>
    );
};
// ──────────────────────────────────────────────────────────────────────────────
// TAB: LỊCH OFF & CA (from leave-management)
// ──────────────────────────────────────────────────────────────────────────────

const SHIFT_LABELS_HUB: Record<string, string> = {
    SHIFT_1: 'Ca 1 (09:00 - 17:00)',
    SHIFT_2: 'Ca 2 (11:00 - 19:00)',
    SHIFT_3: 'Ca 3 (17:00 - 00:00)',
    FREE: 'Ca tự do',
    REQUEST: 'Làm khách yêu cầu',
};
const SHIFT_COLORS_HUB: Record<string, { bg: string; text: string; border: string }> = {
    SHIFT_1: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    SHIFT_2: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    SHIFT_3: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
    FREE: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
    REQUEST: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
};

const LeaveOffTab = () => {
    const leaveLogic = useLeaveManagement();
    const shiftLogic = useShiftManagement();

    const [subTab, setSubTab] = useState<'off' | 'shift'>('off');
    const [showAdminRegister, setShowAdminRegister] = useState(false);
    const [selectedKtvId, setSelectedKtvId] = useState('');

    // KTV Leave Logic (New Calendar)
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
        adminStaffList,
        adminRegisterLoading,
        adminRegisterOff,
    } = leaveLogic;

    // Shift Logic
    const {
        allShifts,
        pendingShifts,
        isLoadingShifts,
        shiftActionLoading,
        handleShiftAction,
        fetchShifts,
        staffList,
        isLoadingStaff,
        unassignedStaff,
        assignModalOpen,
        setAssignModalOpen,
        assignEmployeeId,
        setAssignEmployeeId,
        assignShiftType,
        setAssignShiftType,
        isAssigning,
        handleAssignShift,
        openAssignModal,
    } = shiftLogic;

    // Sync shifts based on selected date (for holiday override rules)
    useEffect(() => {
        fetchShifts(selectedDate);
    }, [selectedDate, fetchShifts]);

    // --- CALENDAR LOGIC ---
    const MONTH_NAMES = [
        'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
        'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
    ];
    const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const BLOCKED_HOLIDAYS = ['04-30', '05-01', '09-02', '01-01'];

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

    const formatLeaveDate = (dateStr: string) => {
        try {
            return format(new Date(dateStr + 'T00:00:00'), 'EEEE, dd/MM', { locale: vi });
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="space-y-4">
            {/* ── TABS ── */}
            <div className="flex bg-gray-100 rounded-2xl p-1 gap-1 w-full max-w-sm mx-auto mb-4">
                <button
                    onClick={() => setSubTab('off')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${subTab === 'off' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <CalendarOff size={15} /> Lịch OFF
                </button>
                <button
                    onClick={() => setSubTab('shift')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${subTab === 'shift' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Briefcase size={15} /> Phân Ca
                    {pendingShifts.length > 0 && (
                        <span className="bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                            {pendingShifts.length}
                        </span>
                    )}
                </button>
            </div>

            {/* ── OFF SUB-TAB ── */}
            {subTab === 'off' && (
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
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
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
                                        <span className="flex items-center gap-1.5">
                                            Nhân sự OFF
                                            <span className="bg-rose-100 text-rose-700 py-0.5 px-2 rounded-full text-[10px]">
                                                {selectedLeaves.length}
                                            </span>
                                        </span>
                                        <button
                                            onClick={() => setShowAdminRegister(!showAdminRegister)}
                                            className="flex items-center gap-1 bg-rose-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg hover:bg-rose-600 transition-colors shadow-sm"
                                        >
                                            <Plus size={12} /> ĐK OFF
                                        </button>
                                    </h4>

                                    {/* Admin Register OFF Popover */}
                                    {showAdminRegister && selectedDate && (
                                        <div className="mb-3 p-3 bg-rose-50 rounded-2xl border border-rose-200 animate-in fade-in slide-in-from-top-2">
                                            <p className="text-[11px] font-bold text-rose-700 mb-2">
                                                Đăng ký OFF ngày {format(new Date(selectedDate), 'dd/MM/yyyy')} cho:
                                            </p>
                                            <div className="flex gap-2">
                                                <select
                                                    value={selectedKtvId}
                                                    onChange={e => setSelectedKtvId(e.target.value)}
                                                    className="flex-1 text-sm border border-rose-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 font-medium"
                                                >
                                                    <option value="">-- Chọn KTV --</option>
                                                    {adminStaffList
                                                        .filter(s => !selectedLeaves.some(l => l.employeeId === s.id))
                                                        .map(s => (
                                                            <option key={s.id} value={s.id}>{s.id} — {s.full_name}</option>
                                                        ))
                                                    }
                                                </select>
                                                <button
                                                    onClick={async () => {
                                                        if (!selectedKtvId || !selectedDate) return;
                                                        await adminRegisterOff(selectedKtvId, selectedDate);
                                                        setSelectedKtvId('');
                                                        setShowAdminRegister(false);
                                                    }}
                                                    disabled={!selectedKtvId || adminRegisterLoading}
                                                    className="px-4 py-2 bg-rose-500 text-white rounded-xl text-sm font-bold hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                                                >
                                                    {adminRegisterLoading ? <Loader2 size={14} className="animate-spin" /> : 'Xác nhận'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {selectedLeaves.length === 0 ? (
                                        <div className="text-center py-4 bg-gray-50/50 rounded-2xl border border-gray-100 border-dashed">
                                            <p className="text-xs text-gray-400 font-medium">Không có ai OFF.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {/* NHÓM 1: NGHỈ ĐỘT XUẤT (CÓ PHẠT) */}
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
                                                                                Lúc: {new Date(leave.createdAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
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

                                            {/* NHÓM 2: NGHỈ CÓ PHÉP / GIA HẠN */}
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
                                                                                Gửi lúc: {new Date(leave.createdAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
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
                                    <div className="space-y-3">
                                        {['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'FREE', 'REQUEST'].map(shiftType => {
                                            const activeShifts = allShifts.filter(shift => {
                                                if (shift.shiftType !== shiftType) return false;
                                                const isOff = selectedLeaves.some(l => l.employeeId === shift.employeeId);
                                                if (!isOff) return true;
                                                // Đã đăng ký OFF nhưng có điểm danh chọn ca tạm thời (hoặc tự do/khách yêu cầu) thì vẫn hiển thị
                                                const isTempShift = shift.reason === 'Tự chọn ca lúc điểm danh' || shift.shiftType === 'FREE' || shift.shiftType === 'REQUEST';
                                                return isTempShift;
                                            });
                                            
                                            if (activeShifts.length === 0) return null;
                                            
                                            const c = SHIFT_COLORS_HUB[shiftType] || { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100' };
                                            
                                            return (
                                                <div key={shiftType} className="border border-gray-100 rounded-2xl overflow-hidden bg-white shadow-sm">
                                                    <div className={`px-3 py-1.5 text-[10px] font-bold border-b flex justify-between items-center ${c.bg} ${c.text} ${c.border}`}>
                                                        <span>{SHIFT_LABELS_HUB[shiftType]}</span>
                                                        <span className="px-1.5 py-0.5 bg-white/50 rounded-md">{activeShifts.length}</span>
                                                    </div>
                                                    <div className="p-2 grid grid-cols-3 gap-2 bg-gray-50/30">
                                                        {activeShifts.map(shift => {
                                                            const isOff = selectedLeaves.some(l => l.employeeId === shift.employeeId);
                                                            return (
                                                                <div key={shift.id} className={`flex flex-col items-center justify-center py-2 px-2 rounded-xl border bg-white shadow-sm ${c.border}`}>
                                                                    <div className="flex flex-col items-center gap-1">
                                                                        <div className="flex items-center gap-1">
                                                                            <p className={`font-bold text-[12px] ${c.text} truncate`}>{shift.employeeId}</p>
                                                                            {isOff && (
                                                                                <span 
                                                                                    className={`text-[8px] font-black px-1 py-0.5 rounded uppercase ${selectedLeaves.find(l => l.employeeId === shift.employeeId)?.is_sudden_off ? 'bg-red-100 text-red-600' : 'bg-rose-100 text-rose-600'}`} 
                                                                                    title={selectedLeaves.find(l => l.employeeId === shift.employeeId)?.is_sudden_off ? "KTV nghỉ đột xuất nhưng vẫn đi làm" : "Có đăng ký OFF nhưng vẫn đi làm"}
                                                                                >
                                                                                    {selectedLeaves.find(l => l.employeeId === shift.employeeId)?.is_sudden_off ? 'Đột xuất' : 'OFF'}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        {shiftType === 'FREE' && shift.estimatedEndTime && (
                                                                            <span className="text-[9px] font-bold text-teal-600 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded shadow-sm w-full text-center">
                                                                                Về: {shift.estimatedEndTime}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── SHIFT SUB-TAB ── */}
            {subTab === 'shift' && (
                <div className="space-y-4">
                    {isLoadingShifts ? (
                        <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
                            <Loader2 size={20} className="animate-spin" /> Đang tải...
                        </div>
                    ) : (
                        <>
                            {/* Pending shift changes */}
                            {pendingShifts.length > 0 && (
                                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                                        <ArrowRightLeft size={16} className="text-amber-500" />
                                        <h3 className="text-sm font-bold text-gray-900">Yêu Cầu Đổi Ca</h3>
                                        <span className="ml-auto bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full">{pendingShifts.length}</span>
                                    </div>
                                    <div className="divide-y divide-gray-50">
                                        {pendingShifts.map(shift => {
                                            const ls = shiftActionLoading[shift.id];
                                            return (
                                                <div key={shift.id} className="px-4 py-3 flex items-center gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-sm text-gray-900">{shift.employeeName}</p>
                                                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                                            <span>{SHIFT_LABELS_HUB[shift.previousShift || ''] || 'Chưa có'}</span>
                                                            <ChevronRight size={11} />
                                                            <span className="font-bold text-indigo-600">{SHIFT_LABELS_HUB[shift.shiftType]}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-1.5 shrink-0">
                                                        <button onClick={() => handleShiftAction(shift.id, 'APPROVE')} disabled={!!ls}
                                                            className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50">
                                                            {ls === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={3} />}
                                                        </button>
                                                        <button onClick={() => handleShiftAction(shift.id, 'REJECT')} disabled={!!ls}
                                                            className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-xl disabled:opacity-50">
                                                            {ls === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} strokeWidth={3} />}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* All active shifts */}
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                                    <Users size={16} className="text-indigo-500" />
                                    <h3 className="text-sm font-bold text-gray-900">Ca Hiện Tại</h3>
                                    <button onClick={() => openAssignModal()}
                                        className="ml-auto flex items-center gap-1 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-xl transition-colors">
                                        <UserPlus size={12} /> Gán Ca
                                    </button>
                                </div>
                                {allShifts.length === 0 ? (
                                    <div className="text-center py-8">
                                        <Briefcase size={28} className="text-gray-300 mx-auto mb-2" />
                                        <p className="text-sm text-gray-400">Chưa có ca được gán</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-gray-50">
                                        {allShifts.map(shift => {
                                            const c = SHIFT_COLORS_HUB[shift.shiftType] || { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' };
                                            return (
                                                <div key={shift.id} className="px-4 py-3 flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold text-xs shrink-0">
                                                        {shift.employeeName?.charAt(0)}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-sm text-gray-900 truncate">{shift.employeeName}</p>
                                                    </div>
                                                    <div className={`px-3 py-1.5 rounded-xl border ${c.bg} ${c.text} ${c.border} flex flex-col items-center min-w-[70px]`}>
                                                        <span className="text-[10px] font-black leading-tight">
                                                            {SHIFT_LABELS_HUB[shift.shiftType]?.split(' (')[0] || shift.shiftType}
                                                        </span>
                                                        <span className="text-[8px] font-bold opacity-70 leading-none mt-0.5 whitespace-nowrap">
                                                            {shift.shiftType === 'FREE' && shift.estimatedEndTime ? `Về: ${shift.estimatedEndTime}` : SHIFT_LABELS_HUB[shift.shiftType]?.match(/\((.*)\)/)?.[1] || ''}
                                                        </span>
                                                    </div>
                                                    <button onClick={() => openAssignModal(shift.employeeId, shift.employeeName)}
                                                        className="p-1.5 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-all">
                                                        <ArrowRightLeft size={13} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Unassigned warning */}
                            {unassignedStaff.length > 0 && (
                                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center gap-2">
                                    <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                                    <p className="text-sm text-amber-700 font-semibold">
                                        {unassignedStaff.length} KTV chưa được gán ca
                                    </p>
                                    <button onClick={() => openAssignModal()}
                                        className="ml-auto text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-xl shrink-0 transition-colors">
                                        Gán ngay
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Assign Modal */}
            {assignModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-5 shadow-2xl">
                        <h3 className="text-lg font-black text-gray-900 text-center">Gán Ca KTV</h3>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700 block">
                                Chọn KTV
                                {unassignedStaff.length > 0 && (
                                    <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                        {unassignedStaff.length} chưa có ca
                                    </span>
                                )}
                            </label>
                            <select value={assignEmployeeId} onChange={e => setAssignEmployeeId(e.target.value)}
                                disabled={isLoadingStaff}
                                className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
                                <option value="">{isLoadingStaff ? 'Đang tải...' : '-- Chọn nhân viên --'}</option>
                                {unassignedStaff.length > 0 && (
                                    <optgroup label="⚠️ Chưa có ca">
                                        {unassignedStaff.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.id})</option>)}
                                    </optgroup>
                                )}
                                {staffList.filter(s => !unassignedStaff.find(u => u.id === s.id)).length > 0 && (
                                    <optgroup label="✅ Đã có ca">
                                        {staffList.filter(s => !unassignedStaff.find(u => u.id === s.id)).map(s => (
                                            <option key={s.id} value={s.id}>{s.full_name} ({s.id})</option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-gray-700 block">Chọn Ca</label>
                            <div className="space-y-2">
                                {['SHIFT_1', 'SHIFT_2', 'SHIFT_3', 'FREE', 'REQUEST'].map(shift => (
                                    <button key={shift} type="button" onClick={() => setAssignShiftType(shift)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${assignShiftType === shift ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-200'}`}>
                                        <div className={`w-2.5 h-2.5 rounded-full ${shift === 'SHIFT_1' ? 'bg-blue-600' : shift === 'SHIFT_2' ? 'bg-amber-600' : shift === 'SHIFT_3' ? 'bg-indigo-600' : shift === 'FREE' ? 'bg-teal-500' : 'bg-pink-500'}`} />
                                        <span className="text-sm font-bold">{SHIFT_LABELS_HUB[shift]}</span>
                                        {assignShiftType === shift && <CheckCircle2 size={14} className="ml-auto text-indigo-500" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button onClick={() => setAssignModalOpen(false)}
                                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors">Hủy</button>
                            <button onClick={handleAssignShift} disabled={!assignEmployeeId || !assignShiftType || isAssigning}
                                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2">
                                {isAssigning ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Gán Ca
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ──────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ──────────────────────────────────────────────────────────────────────────────

export default function KTVHubPage() {
    const { hasPermission } = useAuth();
    const [mounted, setMounted] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('turns');

    const [staffs, setStaffs] = useState<any[]>([]);
    const [loadingStaff, setLoadingStaff] = useState(true);

    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    useEffect(() => {
        setMounted(true);
        fetchStaff();
    }, []);

    const fetchStaff = async () => {
        setLoadingStaff(true);
        try {
            const res = await getStaffList();
            if (res.success && res.data) {
                setStaffs(res.data);
                console.log(`✅ [KTVHub] Fetched ${res.data.length} staff members`);
            } else if (res.error) {
                console.error("❌ [KTVHub] Error fetching staff:", res.error);
            }
        } catch (e) {
            console.error("❌ [KTVHub] Unexpected error:", e);
        } finally {
            setLoadingStaff(false);
        }
    };

    const handleEditSkills = (staff: any) => {
        // Map Staff data from DB to Employee type for Modal
        const emp: Employee = {
            id: staff.id,
            code: staff.id,
            name: staff.full_name,
            username: staff.username,
            password: staff.password,
            position: staff.position || 'Kỹ Thuật Viên',
            experience: staff.experience || '1 năm',
            status: staff.status === 'ĐANG LÀM' ? 'active' : 'inactive',
            photoUrl: staff.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(staff.full_name)}&background=random`,
            phone: staff.phone || '',
            email: staff.email || '',
            dob: staff.birthday || '',
            gender: staff.gender || 'Nữ',
            idCard: staff.id_card || '',
            bankAccount: staff.bank_account || '',
            bankName: staff.bank_name || '',
            joinDate: staff.join_date || '',
            height: staff.height || 0,
            weight: staff.weight || 0,
            baseSalary: 0,
            commissionRate: 0,
            rating: 5.0,
            skills: staff.skills && Object.keys(staff.skills).length > 0 ? staff.skills : {
                hairCut: 'none', hairExtensionShampoo: 'none', earCleaning: 'none',
                machineShave: 'none', razorShave: 'none', facial: 'none', thaiBody: 'none',
                shiatsuBody: 'none', oilBody: 'basic', hotStoneBody: 'none', scrubBody: 'none',
                foot: 'none', heelScrub: 'none', maniPedi: 'none',
                shampoo: 'basic'
            }
        };
        setSelectedEmployee(emp);
        setIsDetailOpen(true);
    };

    const handleUpdateSkills = async (updatedEmployee: Employee) => {
        const res = await updateStaffMember(updatedEmployee.id, updatedEmployee);
        if (res.success) {
            fetchStaff();
            setIsDetailOpen(false);
        } else {
            alert("Lỗi khi cập nhật tay nghề: " + res.error);
        }
    };

    if (!mounted) return null;

    if (!hasPermission('turn_tracking') && !hasPermission('ktv_attendance')) {
        return (
            <AppLayout title="Quản Lý KTV">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <UserCheck size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title="Quản Lý KTV">
            <div className="max-w-3xl mx-auto space-y-5">
                {/* Header */}
                <div>
                    <p className="text-xs text-gray-500">Sổ tua · Lịch OFF & Ca · Danh sách kỹ thuật viên</p>
                </div>

                {/* Tab Bar */}
                <div className="flex gap-1.5 bg-gray-100 p-1.5 rounded-2xl w-full">
                    {TABS.map(tab => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-bold transition-all ${isActive
                                    ? 'bg-white shadow-sm text-indigo-700 border border-gray-200/50'
                                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                                    }`}
                            >
                                <span className={isActive ? 'text-indigo-600' : 'text-gray-400'}>{tab.icon}</span>
                                <span className="hidden sm:inline">{tab.label}</span>
                                <span className="sm:hidden">{tab.short}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Tab Content */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: ANIMATION_DURATION }}
                        className="pb-20"
                    >
                        {loadingStaff ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <RotateCcw size={32} className="text-indigo-400 animate-spin" />
                                <p className="text-sm font-medium text-gray-400 font-black italic">Đang tải danh sách KTV...</p>
                            </div>
                        ) : (
                            <>
                                {activeTab === 'turns' && <TurnTab staffs={staffs} />}
                                {activeTab === 'leave-off' && <LeaveOffTab />}
                                {activeTab === 'ktv-list' && <KTVListTab staffs={staffs} onEdit={handleEditSkills} />}
                            </>
                        )}
                    </motion.div>
                </AnimatePresence>

                {/* Modal Sửa Tay Nghề / Chi Tiết */}
                <EmployeeDetailModal
                    key={selectedEmployee?.id || 'none'}
                    employee={selectedEmployee}
                    isOpen={isDetailOpen}
                    onClose={() => setIsDetailOpen(false)}
                    onUpdate={handleUpdateSkills}
                />
            </div>
        </AppLayout>
    );
}
