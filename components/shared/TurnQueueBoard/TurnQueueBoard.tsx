import React from 'react';
import { CheckCircle2, Timer, Clock, RotateCcw, Save, X, Moon, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { StaffData } from './TurnQueueBoard.types';
import { useTurnQueueBoard } from './TurnQueueBoard.logic';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.2;

export const TurnQueueBoard = ({ staffs }: { staffs: StaffData[] }) => {
    const {
        selectedDate,
        setSelectedDate,
        turns,
        shifts,
        suddenOffs,
        loading,
        hasChanges,
        isSavingOrder,
        editingKtvId,
        setEditingKtvId,
        saveOrder,
        cancelOrder,
        handleOrderChange,
        resetTurns,
        sortedTurns,
        readyCount,
        workingCount,
        activeCount
    } = useTurnQueueBoard(staffs);

    if (loading) return <div className="p-10 text-center text-gray-500">Đang tải hàng đợi...</div>;

    return (
        <div className="space-y-4">
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
                                <span>
                                    {turn.status === 'waiting' ? 'Sẵn sàng' : turn.status === 'working' ? (turn.estimated_end_time ? `Đang làm (xong lúc ${turn.estimated_end_time.substring(0, 5)})` : 'Đang làm') : turn.status === 'assigned' ? 'Đã xếp lịch' : 'Tan ca'}
                                </span>
                            </div>

                        </motion.div>
                    ))}
                </div>
            </div>

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
