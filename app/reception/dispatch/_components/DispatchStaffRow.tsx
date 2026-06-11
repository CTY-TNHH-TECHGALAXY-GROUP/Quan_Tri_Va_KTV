'use client';

import React from 'react';
import { Trash2, AlertCircle, CheckCircle2, ChevronDown, Plus, Printer, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StaffData, TurnQueueData, WorkSegment } from '../types';
import { DispatchSegmentRow } from './DispatchSegmentRow';

interface StaffAssignment {
    id: string;
    ktvId: string;
    ktvName: string;
    segments: WorkSegment[];
    noteForKtv: string;
}

interface Bed {
    id: string;
    roomId: string;
}

interface Room {
    id: string;
    name: string;
    type: string;
    default_reminders?: string[];
}

interface DispatchStaffRowProps {
    row: StaffAssignment;
    svcId: string;
    orderId: string;
    serviceName: string;
    svcDuration: number;
    availableTurns: (TurnQueueData & { staff?: StaffData })[];
    rooms: Room[];
    beds: Bed[];
    busyBedIds?: string[];
    usedKtvIds?: string[];
    onUpdate: (orderId: string, svcId: string, rowId: string, patch: Partial<StaffAssignment>) => void;
    onRemove: (orderId: string, svcId: string, rowId: string) => void;
    canRemove: boolean;
    // Print ticket props
    displayName?: string;
    serviceDescription?: string;
    strength?: string;
    adminNote?: string;
    customerNote?: string;
    selectedDate?: string;
    focus?: string;
    avoid?: string;
    realSvcId?: string;
    reminders?: { id: string; content: string }[];
    // New props for ticket details
    billCode?: string;
    genderReq?: string;
    customerName?: string;
    onViewPhoto?: (photo: { url: string; ktvId: string; time: string | null }) => void;
}

const SERVICE_TO_SKILL: Record<string, string> = {
    'Gội đầu': 'shampoo',
    'Massage Thái': 'thaiBody',
    'Massage Dầu': 'oilBody',
    'Đá Nóng': 'hotStoneBody',
    'Massage Body': 'thaiBody',
    'Foot Dầu': 'foot',
    'Ráy tai': 'earCombo', // fallback for old data
    'Ráy Combo': 'earCombo',
    'Ráy Chuyên': 'earChuyen',
    'Chăm sóc da': 'facial',
    'Massage Chân': 'foot',
    'Foot': 'foot',
};

const genId = () => Math.random().toString(36).substring(2, 9);
// Format "15:19:00" → "15:19"
const fmtTime = (t?: string | null) => t ? t.replace(/^(\d{1,2}:\d{2})(:\d{2})?$/, '$1') : '--:--';

const calcEndTime = (start: string, duration: number): string => {
    if (!start || duration == null) return '';
    const [h, m] = start.split(':').map(Number);
    const end = new Date();
    end.setHours(h, m + Math.floor(duration), Math.floor((duration % 1) * 60), 0);
    return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
};

export const DispatchStaffRow = ({
    row, svcId, orderId, serviceName, svcDuration, availableTurns, rooms, beds, busyBedIds = [], usedKtvIds = [], onUpdate, onRemove, canRemove,
    displayName, serviceDescription, strength, adminNote, customerNote, selectedDate, focus, avoid, realSvcId, reminders = [],
    billCode, genderReq, customerName, onViewPhoto
}: DispatchStaffRowProps) => {

    const targetSkill = Object.keys(SERVICE_TO_SKILL).find(k => serviceName.toLowerCase().includes(k.toLowerCase()))
        ? SERVICE_TO_SKILL[Object.keys(SERVICE_TO_SKILL).find(k => serviceName.toLowerCase().includes(k.toLowerCase()))!]
        : null;

    const [now, setNow] = React.useState(new Date());
    const [showTicketPreview, setShowTicketPreview] = React.useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = React.useState(false);
    const [showReminders, setShowReminders] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');
    const dropdownRef = React.useRef<HTMLDivElement>(null);
    const reminderRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
                setSearchQuery(''); // Reset search when closing without selection
            }
            if (reminderRef.current && !reminderRef.current.contains(e.target as Node)) {
                setShowReminders(false);
            }
        };
        if (isDropdownOpen || showReminders) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDropdownOpen, showReminders]);

    React.useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 30000); // Update every 30s
        return () => clearInterval(timer);
    }, []);

    const handleChange = (patch: Partial<StaffAssignment>) => {
        onUpdate(orderId, svcId, row.id, patch);
    };

    // 🖨️ Show KTV Turn Ticket Preview
    const handlePrintTicket = () => {
        setShowTicketPreview(true);
    };

    const dateFormatted = selectedDate 
        ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const ticketNoteText = row.noteForKtv || adminNote || '';

    const addSegment = () => {
        const lastSegment = row.segments[row.segments.length - 1];
        const startTime = lastSegment ? lastSegment.endTime : '08:00';
        
        const currentTotalMins = row.segments.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0);
        let duration = svcDuration - currentTotalMins;
        if (duration <= 0) duration = Math.min(15, svcDuration || 15); // Hỗ trợ test 1 phút
        
        const newSegment: WorkSegment = {
            id: genId(),
            roomId: null,
            bedId: null,
            startTime,
            duration,
            endTime: calcEndTime(startTime, duration)
        };
        handleChange({ segments: [...row.segments, newSegment] });
    };

    const updateSegment = (idx: number, patch: Partial<WorkSegment>) => {
        const newSegments = [...row.segments];
        newSegments[idx] = { ...newSegments[idx], ...patch };
        
        // Tự động nối giờ cho các chặng phía sau nếu giờ kết thúc chặng này thay đổi
        if (patch.endTime) {
            for (let i = idx + 1; i < newSegments.length; i++) {
                const prev = newSegments[i-1];
                newSegments[i] = { 
                    ...newSegments[i], 
                    startTime: prev.endTime,
                    endTime: calcEndTime(prev.endTime, newSegments[i].duration)
                };
            }
        }
        
        // 🧠 LOGIC NHẮC NHỞ TỰ ĐỘNG THEO PHÒNG
        if (patch.roomId) {
            const roomData = (rooms as any[]).find(r => r.id === patch.roomId);
            if (roomData && roomData.default_reminders && Array.isArray(roomData.default_reminders)) {
                const defaultReminders = reminders
                    .filter(rm => roomData.default_reminders.includes(rm.id))
                    .map(rm => rm.content);
                
                if (defaultReminders.length > 0) {
                    const currentNote = row.noteForKtv || '';
                    const reminderStr = defaultReminders.join(' - ');
                    
                    // Nếu chưa có nhắc nhở này thì mới append
                    if (!currentNote.includes(reminderStr)) {
                        const newNote = currentNote ? `${currentNote} - ${reminderStr}` : reminderStr;
                        handleChange({ segments: newSegments, noteForKtv: newNote });
                        return; // Đã gọi handleChange bên trong nên thoát
                    }
                }
            }
        }
        
        handleChange({ segments: newSegments });
    };

    const removeSegment = (idx: number) => {
        const newSegments = row.segments.filter((_, i) => i !== idx);
        handleChange({ segments: newSegments });
    };

    const handleSelectKtv = (ktvId: string, ktvName: string) => {
        handleChange({ 
            ktvId, 
            ktvName
        });
    };

    return (
        <>
        <div className="p-4 bg-white rounded-3xl border border-gray-100 shadow-sm space-y-5">
            <div className="flex flex-col gap-4">
                {/* KTV Header Selection */}
                <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 relative" ref={dropdownRef}>
                        <div 
                            className="w-full pl-4 pr-10 py-3 border-2 border-gray-50 rounded-2xl text-sm font-black focus-within:ring-4 focus-within:ring-indigo-500/10 focus-within:border-indigo-500 bg-gray-50/30 transition-all cursor-text relative flex items-center h-12"
                            onClick={() => setIsDropdownOpen(true)}
                        >
                            <input
                                type="text"
                                placeholder="— Nhập tên hoặc mã KTV —"
                                value={isDropdownOpen ? searchQuery : (row.ktvId ? row.ktvId : '')}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    if (!isDropdownOpen) setIsDropdownOpen(true);
                                }}
                                onFocus={() => setIsDropdownOpen(true)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && searchQuery.trim()) {
                                        const term = searchQuery.toLowerCase().trim();
                                        const match = availableTurns.find(t => t.employee_id.toLowerCase() === term || t.staff?.full_name?.toLowerCase() === term);
                                        if (match) {
                                            handleSelectKtv(match.employee_id, match.staff?.full_name || '');
                                        } else {
                                            handleSelectKtv(searchQuery.trim(), searchQuery.trim());
                                        }
                                        setSearchQuery('');
                                        setIsDropdownOpen(false);
                                    }
                                }}
                                className={`w-full bg-transparent border-none outline-none placeholder:font-black placeholder:text-gray-400 font-black truncate ${!isDropdownOpen && row.ktvId ? 'text-indigo-700' : 'text-gray-900'}`}
                            />
                            <button 
                                onClick={(e) => { e.stopPropagation(); setIsDropdownOpen(!isDropdownOpen); }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <ChevronDown size={16} className={`transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>
                        </div>

                        <AnimatePresence>
                            {isDropdownOpen && (
                                <motion.div 
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 5 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute z-50 w-full mt-2 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 overflow-hidden"
                                >
                                    <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                                        {availableTurns
                                            .filter(t => t.status !== 'off')
                                            .filter(t => {
                                                if (!searchQuery) return true;
                                                const term = searchQuery.toLowerCase();
                                                return t.employee_id.toLowerCase().includes(term) || (t.staff?.full_name || '').toLowerCase().includes(term);
                                            })
                                            .map((turn) => {
                                                const hasSkill = targetSkill ? turn.staff?.skills?.[targetSkill] === true : true;
                                                const isUsedInOtherSvc = usedKtvIds.includes(turn.employee_id);
                                                
                                                return (
                                                    <div 
                                                        key={turn.employee_id} 
                                                        onClick={() => {
                                                            handleSelectKtv(turn.employee_id, turn.staff?.full_name || '');
                                                            setSearchQuery('');
                                                            setIsDropdownOpen(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold transition-all flex flex-col gap-0.5
                                                            cursor-pointer hover:bg-indigo-50 active:scale-[0.98]
                                                            ${row.ktvId === turn.employee_id ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'text-gray-700'}
                                                            ${!hasSkill && !isUsedInOtherSvc ? 'text-gray-400' : ''}
                                                        `}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded-md font-black text-slate-500">#{turn.check_in_order}</span>
                                                                <span>{turn.employee_id}</span>
                                                            </div>
                                                        </div>
                                                        <div className="text-[10px] font-semibold flex gap-2">
                                                            {isUsedInOtherSvc 
                                                                ? <span className="text-indigo-500">🔄 Cùng đơn này</span> 
                                                                : (turn.status === 'working' 
                                                                    ? <span className="text-amber-500">⌛ Đang làm đến {fmtTime(turn.estimated_end_time)}</span> 
                                                                    : turn.status === 'assigned'
                                                                        ? <span className="text-indigo-500">🔒 Đã xếp lịch {turn.estimated_end_time ? `• Rảnh lúc ${fmtTime(turn.estimated_end_time)}` : ''}</span>
                                                                        : <span className="text-emerald-500">✅ Sẵn sàng</span>
                                                                )
                                                            }
                                                            {!hasSkill && <span className="text-gray-400 font-medium">(Chưa có kỹ năng)</span>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        
                                        {/* Nhập ngoài custom text */}
                                        {searchQuery.trim() && !availableTurns.some(t => t.employee_id.toLowerCase() === searchQuery.trim().toLowerCase() || t.staff?.full_name?.toLowerCase() === searchQuery.trim().toLowerCase()) && (
                                            <div
                                                onClick={() => {
                                                    const customText = searchQuery.trim();
                                                    handleSelectKtv(customText, customText);
                                                    setSearchQuery('');
                                                    setIsDropdownOpen(false);
                                                }}
                                                className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 cursor-pointer hover:bg-emerald-50 text-emerald-700 active:scale-[0.98] border border-dashed border-emerald-200 mt-2"
                                            >
                                                <Plus size={16} className="text-emerald-500" />
                                                <span>Nhập tên ngoài: <strong className="text-emerald-800">{searchQuery.trim()}</strong></span>
                                            </div>
                                        )}

                                        {availableTurns.filter(t => t.status !== 'off').filter(t => {
                                                if (!searchQuery) return true;
                                                const term = searchQuery.toLowerCase();
                                                return t.employee_id.toLowerCase().includes(term) || (t.staff?.full_name || '').toLowerCase().includes(term);
                                            }).length === 0 && !searchQuery.trim() && (
                                            <div className="px-3 py-4 text-center text-sm font-bold text-gray-400">
                                                Không tìm thấy KTV phù hợp
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* 🖨️ Print Ticket Button — only show when KTV is selected */}
                    {row.ktvId && (() => {
                        const photoSegment = row.segments?.find((seg: any) => seg.startPhotoUrl);
                        const startPhotoUrl = photoSegment?.startPhotoUrl;
                        return (
                            <>
                                {startPhotoUrl && onViewPhoto && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onViewPhoto({
                                                url: startPhotoUrl,
                                                ktvId: row.ktvId,
                                                time: photoSegment.actualStartTime || photoSegment.startTime
                                            });
                                        }}
                                        className="w-10 h-10 rounded-xl overflow-hidden border border-indigo-300 hover:scale-105 active:scale-95 transition-all shrink-0 flex items-center justify-center bg-indigo-50 shadow-sm"
                                        title="Xem ảnh xác nhận khách"
                                    >
                                        <img src={startPhotoUrl} alt="Check-in" className="w-full h-full object-cover" />
                                    </button>
                                )}
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleChange({ ktvId: '', ktvName: '' }); }}
                                    className="p-2.5 bg-rose-50 text-rose-400 hover:bg-rose-100 hover:text-rose-600 border border-rose-100 rounded-xl transition-all active:scale-90"
                                    title="Xoá KTV (để trống)"
                                >
                                    <X size={15} strokeWidth={2.5} />
                                </button>
                                <button
                                    onClick={handlePrintTicket}
                                    className="p-2.5 bg-indigo-50 text-indigo-500 hover:bg-indigo-100 border border-indigo-100 rounded-xl transition-all active:scale-90"
                                    title="In phiếu tua KTV"
                                >
                                    <Printer size={15} strokeWidth={2.5} />
                                </button>
                            </>
                        );
                    })()}

                    {canRemove && (
                        <button
                            onClick={() => onRemove(orderId, svcId, row.id)}
                            className="p-3 bg-rose-50 text-rose-500 hover:bg-rose-100 border border-rose-100 rounded-2xl transition-all active:scale-90"
                        >
                            <Trash2 size={18} strokeWidth={2.5} />
                        </button>
                    )}
                </div>

                {/* Skill Badge */}
                {row.ktvId && availableTurns.find(t => t.employee_id === row.ktvId)?.staff?.skills?.[targetSkill || ''] === true && (
                    <div className="px-1">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black border border-emerald-100 uppercase tracking-tighter">
                            <CheckCircle2 size={10} /> Đạt yêu cầu
                        </span>
                    </div>
                )}

                {/* Segments Area */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Lộ trình làm việc</p>
                        <button
                            onClick={addSegment}
                            className="text-[9px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-1 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1"
                        >
                            <Plus size={12} strokeWidth={3} /> Thêm Phòng
                        </button>
                    </div>

                    <div className="space-y-3">
                        {row.segments.map((seg, idx) => (
                            <DispatchSegmentRow
                                key={seg.id}
                                segment={seg}
                                segmentIndex={idx}
                                rooms={rooms}
                                beds={beds}
                                busyBedIds={busyBedIds}
                                realSvcId={realSvcId}
                                onUpdate={(patch) => updateSegment(idx, patch)}
                                onRemove={() => removeSegment(idx)}
                                canRemove={row.segments.length > 1}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* Note Input with Reminders Popover */}
            <div className="relative pt-1 border-t border-gray-50 pt-3 flex items-center gap-2">
                <div className="flex-1 relative">
                    <input
                        type="text"
                        value={row.noteForKtv}
                        onChange={e => handleChange({ noteForKtv: e.target.value })}
                        placeholder="Ghi chú riêng cho nhân viên này..."
                        className="w-full px-4 py-2 bg-indigo-50/30 border border-indigo-100 rounded-xl text-[11px] font-black text-indigo-700 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-300 transition-all pr-10"
                    />
                    {row.noteForKtv && (
                        <button 
                            onClick={() => handleChange({ noteForKtv: '' })}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-indigo-300 hover:text-indigo-500 transition-colors"
                        >
                            <X size={14} strokeWidth={3} />
                        </button>
                    )}
                </div>

                <div className="relative" ref={reminderRef}>
                    <button
                        onClick={() => setShowReminders(!showReminders)}
                        className={`p-2 rounded-xl border transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap
                            ${showReminders ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white border-gray-100 text-gray-400 hover:border-indigo-200 hover:text-indigo-600'}
                        `}
                        title="Chọn câu nhắc nhở nhanh"
                    >
                        <AlertCircle size={16} strokeWidth={2.5} />
                        <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Nhắc nhở</span>
                    </button>

                    <AnimatePresence>
                        {showReminders && (
                            <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                className="absolute bottom-full right-0 mb-3 w-72 bg-white rounded-2xl shadow-[0_10px_40px_rgb(0,0,0,0.15)] border border-gray-100 overflow-hidden z-[60]"
                            >
                                <div className="p-4 border-b border-gray-50 flex items-center justify-between bg-indigo-50/50">
                                    <span className="text-[10px] font-black text-indigo-900 uppercase tracking-[0.2em]">Chọn nhắc nhở</span>
                                    <span className="text-[10px] font-bold text-indigo-400">{reminders.length} câu</span>
                                </div>
                                <div className="max-h-60 overflow-y-auto p-2 grid grid-cols-1 gap-1 no-scrollbar">
                                    {reminders.map((rm) => {
                                        const isSelected = row.noteForKtv?.includes(rm.content);
                                        return (
                                            <button
                                                key={rm.id}
                                                onClick={() => {
                                                    const currentNote = row.noteForKtv || '';
                                                    if (isSelected) {
                                                        // Xoá nhắc nhở (cần handle dấu gạch nối)
                                                        const parts = currentNote.split(' - ').filter(p => p !== rm.content);
                                                        handleChange({ noteForKtv: parts.join(' - ') });
                                                    } else {
                                                        // Thêm nhắc nhở
                                                        const newNote = currentNote ? `${currentNote} - ${rm.content}` : rm.content;
                                                        handleChange({ noteForKtv: newNote });
                                                    }
                                                }}
                                                className={`w-full text-left px-3 py-2.5 rounded-xl text-[11px] font-bold transition-all flex items-center justify-between group
                                                    ${isSelected ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-indigo-50 text-gray-700 hover:text-indigo-700'}
                                                `}
                                            >
                                                <span className="flex-1 pr-2">{rm.content}</span>
                                                {isSelected ? (
                                                    <CheckCircle2 size={14} strokeWidth={3} />
                                                ) : (
                                                    <Plus size={14} strokeWidth={3} className="text-gray-200 group-hover:text-indigo-400" />
                                                )}
                                            </button>
                                        );
                                    })}
                                    {reminders.length === 0 && (
                                        <div className="py-8 text-center text-gray-400 text-[10px] font-bold uppercase italic">
                                            Chưa có câu nhắc nhở nào
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>

            {/* 🖨️ Ticket Preview Modal */}
            <AnimatePresence>
                {showTicketPreview && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={() => setShowTicketPreview(false)}>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/60 backdrop-blur-md"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 30 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 30 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            className="relative bg-white rounded-3xl shadow-2xl w-full max-w-[400px] max-h-[90vh] overflow-y-auto"
                        >
                            {/* Close button */}
                            <button
                                onClick={() => setShowTicketPreview(false)}
                                className="absolute top-4 right-4 z-10 p-2 bg-white/80 hover:bg-white rounded-full shadow-lg border border-gray-200 transition-all active:scale-90"
                            >
                                <X size={18} className="text-gray-500" />
                            </button>

                            {/* Ticket Header */}
                            <div className="bg-slate-900 text-white px-6 py-5 flex justify-between items-center rounded-t-3xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
                                <div className="relative z-10">
                                    <div className="text-4xl font-black italic tracking-tight">{row.ktvId}</div>

                                </div>
                                <div className="relative z-10 text-right">
                                    <div className="text-[11px] font-bold tracking-wider opacity-70">Phiếu Tua KTV</div>
                                    <div className="text-base font-black mt-0.5">{dateFormatted}</div>

                                </div>
                            </div>

                            {/* Ticket Content */}
                            <div className="px-5 py-5 space-y-4">
                                {/* Service Name */}
                                <div>

                                    <div className="text-2xl font-black text-red-600 uppercase leading-tight">
                                        {displayName || serviceName} ({row.segments.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0)}&apos;)
                                    </div>
                                    {serviceDescription && (!displayName || displayName === serviceName) && (
                                        <p className="mt-1.5 text-sm font-bold text-gray-600 leading-relaxed">
                                            {serviceDescription}
                                        </p>
                                    )}
                                </div>

                                {/* Segments */}
                                {row.segments.map((seg, idx) => {
                                    const roomName = rooms.find(r => r.id === seg.roomId)?.name || seg.roomId || '—';
                                    return (
                                        <div key={seg.id} className="space-y-3">
                                            {row.segments.length > 1 && (
                                                <p className="text-[11px] font-black text-indigo-600 uppercase tracking-widest text-center">
                                                    Chặng {idx + 1}
                                                </p>
                                            )}
                                            {/* Time */}
                                            <div className="border-[2.5px] border-dashed border-amber-400 rounded-2xl px-4 py-4 text-center">
                                                <p className="text-[10px] font-black text-amber-800 uppercase tracking-[3px] mb-2">Thời gian thực hiện</p>
                                                <p className="text-[32px] font-black text-red-600 leading-none tracking-tight">
                                                    {seg.startTime || '--:--'} <span className="text-red-400">→</span> {seg.endTime || '--:--'}
                                                </p>
                                            </div>
                                            {/* Room */}
                                            <div className="bg-slate-100 rounded-xl px-4 py-3 border-l-4 border-slate-500">
                                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Phòng</p>
                                                <p className="text-xl font-black text-red-600 mt-0.5">{roomName}</p>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Customer Requirements */}
                                {(genderReq || strength || focus || avoid || customerNote) && (
                                    <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 space-y-3 shadow-inner">
                                        <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-2">
                                            <AlertCircle size={14} className="text-amber-500" /> Yêu Cầu Khách Hàng
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {genderReq && (
                                                <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-purple-50 text-purple-700 border-purple-100 shadow-sm">
                                                    👩 {genderReq}
                                                </span>
                                            )}
                                            {strength && (
                                                <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-orange-50 text-orange-700 border-orange-100 shadow-sm">
                                                    💪 Lực: {strength}
                                                </span>
                                            )}
                                            {focus && (() => {
                                                const FULL_BODY_THRESHOLD = 8;
                                                const areas = focus.split(',').map(s => s.trim()).filter(Boolean);
                                                const displayText = areas.length >= FULL_BODY_THRESHOLD ? 'Full Body' : focus;
                                                return (
                                                    <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm">
                                                        🎯 Tập trung: {displayText}
                                                    </span>
                                                );
                                            })()}
                                            {avoid && (
                                                <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-rose-50 text-rose-700 border-rose-100 shadow-sm">
                                                    🚫 Tránh: {avoid}
                                                </span>
                                            )}
                                        </div>
                                        {customerNote && (
                                            <div className="bg-white/60 px-3 py-2.5 rounded-xl border border-amber-200/50">
                                                <p className="text-xs font-bold text-amber-900 italic flex items-start gap-2">
                                                    <span className="text-amber-400 mt-0.5">📌</span> {customerNote}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Admin Note */}
                                {ticketNoteText && (
                                    <div className="bg-green-50/50 border border-green-200 rounded-2xl p-4 space-y-3 shadow-inner">
                                        <p className="text-[10px] font-black text-green-700 uppercase tracking-widest flex items-center gap-2">
                                            📝 Admin Dặn Dò
                                        </p>
                                        <div className="bg-white/60 px-3 py-2.5 rounded-xl border border-green-200/50">
                                            <p className="text-xs font-bold text-green-900 flex items-start gap-2 uppercase">
                                                <span className="text-green-500 mt-0.5">💬</span> &quot;{ticketNoteText}&quot;
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="text-center py-4 border-t border-gray-200 mt-2">
                                <p className="text-xs text-gray-400 font-semibold italic">Hệ thống Spa Ngân Hà</p>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
};
