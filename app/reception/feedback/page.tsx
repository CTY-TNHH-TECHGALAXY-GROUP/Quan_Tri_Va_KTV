'use client';

import React, { useState } from 'react';
import { useFeedbackDashboard, ChildBookingForFeedback } from './FeedbackDashboard.logic';
import { KioskFeedbackModal } from './_components/KioskFeedbackModal';
import { CheckCircle2, UserCircle2, LayoutList, Columns3, Users, BedDouble, CalendarClock, Star, ChevronDown, ChevronUp } from 'lucide-react';

function FeedbackGroupBlock({ group, onSelectChild }: { group: any, onSelectChild: (child: any) => void }) {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div 
                className="p-4 bg-gray-50/50 border-b border-gray-100 flex justify-between items-center cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div>
                    <h2 className="text-lg font-semibold text-gray-800">{group.customerName}</h2>
                    <p className="text-sm text-gray-500">Mã: {group.billCode} • {group.childBookings.length} đơn</p>
                </div>
                <button className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-200/50 transition-all">
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
            </div>

            {isExpanded && (
                <div className="p-5 space-y-3">
                    {group.childBookings.map((child: any) => {
                        const isEvaluated = child.status === 'DONE' || (child.ktvList && child.ktvList.length > 0 && child.ktvList.every((k: any) => k.rating && k.rating > 0));
                        const isReadyToEvaluate = child.status === 'COMPLETED' || child.status === 'FEEDBACK' || child.status === 'CLEANING';
                        
                        return (
                            <div 
                                key={child.id}
                                onClick={() => {
                                    if (isReadyToEvaluate && !isEvaluated) {
                                        onSelectChild(child);
                                    } else if (isEvaluated) {
                                        alert('Đơn này đã được đánh giá!');
                                    } else {
                                        alert('Đơn này chưa hoàn thành, chưa thể đánh giá!');
                                    }
                                }}
                                className={`relative p-3 rounded-lg border ${
                                    (isReadyToEvaluate && !isEvaluated)
                                        ? 'bg-indigo-50 border-indigo-200 cursor-pointer hover:bg-indigo-100 transition-colors' 
                                        : isEvaluated 
                                            ? 'bg-green-50 border-green-200 cursor-not-allowed opacity-70'
                                            : 'bg-gray-50 border-gray-200 cursor-not-allowed opacity-60'
                                }`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-sm font-medium text-gray-700">{child.customerName}</span>
                                    {(isReadyToEvaluate && !isEvaluated) && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Chờ Đánh Giá</span>}
                                    {isEvaluated && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Đã Đánh Giá</span>}
                                </div>
                                
                                <div className="space-y-2">
                                    {child.ktvList.map((ktv: any, idx: number) => (
                                        <div key={idx} className="flex items-center justify-between gap-2 bg-white/60 p-2 rounded-md text-sm border border-transparent hover:border-gray-100 transition-colors">
                                            <div className="flex items-center gap-2">
                                                <UserCircle2 className="w-4 h-4 text-gray-400" />
                                                <span className="font-medium text-gray-800">{ktv.ktvId} - {ktv.ktvName}</span>
                                                <span className="text-gray-400 text-xs">-</span>
                                                <span className="text-gray-500 text-xs uppercase tracking-tight line-clamp-1">{ktv.serviceNames?.join(' + ')}</span>
                                            </div>
                                            {ktv.rating !== undefined && ktv.rating > 0 && (
                                                <div className="flex items-center gap-1 shrink-0">
                                                    {[...Array(4)].map((_, i) => (
                                                        <Star 
                                                            key={i} 
                                                            size={12} 
                                                            className={i < (ktv.rating || 0) ? 'fill-amber-400 text-amber-400' : 'fill-gray-200 text-gray-200'} 
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {child.ktvList.length === 0 && (
                                        <div className="text-xs text-gray-400 italic">Chưa có KTV</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function FeedbackDashboardPage() {
    // Lấy ngày hiện tại theo giờ Việt Nam
    const getTodayStr = () => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const [selectedDate, setSelectedDate] = useState(getTodayStr());
    const { groups, loading } = useFeedbackDashboard(selectedDate);
    
    const [selectedGroup, setSelectedGroup] = useState<any | null>(null);
    const [selectedChildBooking, setSelectedChildBooking] = useState<ChildBookingForFeedback | null>(null);

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Đang tải dữ liệu Feedback...</div>;
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold text-gray-800">Quản Lý Đánh Giá Khách Hàng</h1>
                    <div className="relative">
                        <CalendarClock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input 
                            type="date" 
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 shadow-sm transition-all"
                        />
                    </div>
                </div>
                <div className="hidden sm:flex items-center gap-1 bg-gray-100/80 p-1 rounded-xl shadow-inner border border-gray-200">
                  <button
                    onClick={() => window.location.href = '/reception/dispatch'}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-gray-500 hover:text-gray-700"
                  >
                    <LayoutList size={14} /> Điều Phối
                  </button>
                  <button
                    onClick={() => window.location.href = '/reception/dispatch?mode=MONITOR'} // If supported later
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-gray-500 hover:text-gray-700"
                  >
                    <Columns3 size={14} /> Giám Sát Đơn
                  </button>
                  <button
                    onClick={() => window.location.href = '/reception/dispatch?mode=TURN_QUEUE'}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-gray-500 hover:text-gray-700"
                  >
                    <Users size={14} /> Sổ Tua
                  </button>
                  <button
                    onClick={() => window.location.href = '/reception/dispatch?mode=ROOMS'}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-gray-500 hover:text-gray-700"
                  >
                    <BedDouble size={14} /> Sổ Phòng
                  </button>
                  <button
                    onClick={() => window.location.href = '/reception/dispatch?mode=SCHEDULE'}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-gray-500 hover:text-gray-700"
                  >
                    <CalendarClock size={14} /> Lịch Biểu Diễn
                  </button>
                  <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-white text-amber-600 shadow-sm border border-gray-200/50 cursor-default"
                  >
                    <Star size={14} /> Đánh Giá
                  </button>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
                {groups.map(group => (
                    <FeedbackGroupBlock 
                        key={group.parentBookingId} 
                        group={group} 
                        onSelectChild={(child) => {
                            setSelectedGroup(group);
                            setSelectedChildBooking(child);
                        }} 
                    />
                ))}

                {groups.length === 0 && (
                    <div className="col-span-full py-12 text-center text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
                        Không có đơn hàng nào trong ngày {selectedDate}.
                    </div>
                )}
            </div>

            {/* Modal Kiosk Fullscreen */}
            {selectedChildBooking && selectedGroup && (
                <KioskFeedbackModal 
                    group={selectedGroup}
                    initialBooking={selectedChildBooking} 
                    onClose={() => {
                        setSelectedChildBooking(null);
                        setSelectedGroup(null);
                    }} 
                />
            )}
        </div>
    );
}
