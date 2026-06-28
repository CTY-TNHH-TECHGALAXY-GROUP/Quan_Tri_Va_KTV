'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Clock, AlertCircle, ArrowRight, QrCode, Star, Check, Sparkles, Banknote, CreditCard, Camera, X } from 'lucide-react';
import { PendingOrder, ServiceBlock } from '../types';
import { SubOrder, buildOrderTimeline } from './dispatch-timeline';

import { RawStatus, getNextStatus, canTransition } from '@/lib/dispatch-status';

const STATUS_CONFIG = [
    { id: 'PREPARING' as RawStatus, dispatchModeId: ['PREPARING'], label: 'Chuẩn bị', shortLabel: 'Chuẩn bị', color: 'text-orange-600', bg: 'bg-orange-50', activeBg: 'bg-orange-600', border: 'border-orange-200', dot: 'bg-orange-500', next: 'IN_PROGRESS' as RawStatus, nextLabel: '▶️ Bắt đầu làm' },
    { id: 'IN_PROGRESS' as RawStatus, dispatchModeId: ['IN_PROGRESS'], label: 'Đang Tiến Hành', shortLabel: 'Đang làm', color: 'text-indigo-600', bg: 'bg-indigo-50', activeBg: 'bg-indigo-600', border: 'border-indigo-200', dot: 'bg-indigo-500', next: 'CLEANING' as RawStatus, nextLabel: '🧹 Bắt đầu dọn' },
    { id: 'CLEANING' as RawStatus, dispatchModeId: ['CLEANING'], label: 'Đang Dọn Phòng', shortLabel: 'Dọn phòng', color: 'text-purple-600', bg: 'bg-purple-50', activeBg: 'bg-purple-600', border: 'border-purple-200', dot: 'bg-purple-500', next: 'FEEDBACK' as RawStatus, nextLabel: '⭐ Chờ Đánh Giá' },
    { id: 'FEEDBACK' as RawStatus, dispatchModeId: ['FEEDBACK'], label: 'Chờ Đánh Giá', shortLabel: 'Đánh giá', color: 'text-blue-600', bg: 'bg-blue-50', activeBg: 'bg-blue-600', border: 'border-blue-200', dot: 'bg-blue-500', next: 'DONE' as RawStatus, nextLabel: '✅ Hoàn tất' },
    { id: 'DONE' as RawStatus, dispatchModeId: ['DONE', 'CANCELLED'], label: 'Hoàn Tất Dịch Vụ', shortLabel: 'Hoàn tất', color: 'text-emerald-600', bg: 'bg-emerald-50', activeBg: 'bg-emerald-600', border: 'border-emerald-200', dot: 'bg-emerald-500', next: null, nextLabel: null },
];

const formatVND = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';

const formatToHourMinute = (isoString?: string | null) => {
    if (!isoString) return '--:--';
    
    // Nếu truyền vào định dạng HH:mm (ví dụ "17:40") thì trả về luôn
    if (/^\d{1,2}:\d{2}$/.test(isoString)) return isoString;

    let parseString = isoString;
    // Fix timezone: Supabase trả về timestamp không có múi giờ (UTC),
    // thêm 'Z' vào cuối để trình duyệt hiểu đúng là múi giờ UTC và parse thành Local (+7)
    if (!isoString.endsWith('Z') && !isoString.includes('+')) {
        parseString = isoString.replace(' ', 'T') + 'Z';
    }

    const d = new Date(parseString);
    if (isNaN(d.getTime())) return isoString;
    const dVn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return `${String(dVn.getUTCHours()).padStart(2, '0')}:${String(dVn.getUTCMinutes()).padStart(2, '0')}`;
};

const getDynamicEndTime = (startStr?: string | null, durationMins: number = 60) => {
    if (!startStr) return '--:--';
    const formatted = formatToHourMinute(startStr);
    if (formatted === '--:--') return '--:--';
    
    let [h, m] = formatted.split(':').map(Number);
    m += durationMins;
    h += Math.floor(m / 60);
    m = m % 60;
    h = h % 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

interface KanbanBoardProps {
    orders: PendingOrder[];
    onUpdateStatus: (orderId: string, newStatus: string, itemIds?: string[], skipConfirm?: boolean, targetKtvIds?: string[]) => void;
    onOpenDetail: (orderId: string, subOrderId?: string, status?: string) => void;
    onConfirmAddonPayment?: (orderId: string) => void;
    selectedOrderId: string | null;
    onContextMenu?: (e: React.MouseEvent, orderId: string) => void;
    roomTransitionTime?: number;
}

const getEstimatedEndTime = (order: PendingOrder, servicesToCheck: ServiceBlock[] = order.services) => {
    let maxTime = 0;

    if (!servicesToCheck || servicesToCheck.length === 0) return null;

    const parseHHMM = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m, 0, 0);

        // Handle midnight crossing using absolute offset to avoid timezone shift bugs
        if (d.getTime() < Date.now() - 12 * 60 * 60 * 1000) {
             d.setDate(d.getDate() + 1); // Looks like tomorrow
        } else if (d.getTime() > Date.now() + 12 * 60 * 60 * 1000) {
             d.setDate(d.getDate() - 1); // Looks like yesterday
        }
        
        return d;
    };

    // 🔥 FIX: Luôn quét TẤT CẢ segments để lấy max endTime chính xác
    // Không tin mù quáng booking.timeEnd vì nó có thể bị ghi đè sai
    for (const svc of servicesToCheck) {
        let hasValidSegmentTime = false;
        
        // Ưu tiên segment endTime (thời gian phân bổ chính xác nhất)
        if (svc.staffList) {
            for (const staff of svc.staffList) {
                if (!staff.segments) continue;
                for (const seg of staff.segments) {
                    const start = seg.actualStartTime || svc.timeStart || seg.startTime;
                    const duration = Number(seg.duration) || Number(svc.duration) || 60;
                    const finalEnd = seg.actualEndTime ? seg.actualEndTime : (seg.actualStartTime || svc.timeStart ? getDynamicEndTime(start, duration) : (svc.timeEnd || seg.endTime));
                    
                    if (finalEnd && finalEnd !== '--:--') {
                        const formattedEnd = formatToHourMinute(finalEnd);
                        if (formattedEnd !== '--:--') {
                            const d = parseHHMM(formattedEnd);
                            if (d.getTime() > maxTime) maxTime = d.getTime();
                            hasValidSegmentTime = true;
                        }
                    }
                }
            }
        }
        
        // Fallback: CHỈ dùng item.timeEnd nếu KHÔNG CÓ segment time nào hợp lệ
        if (!hasValidSegmentTime && svc.timeEnd) {
            let tEnd = svc.timeEnd;
            if (!tEnd.endsWith('Z') && !tEnd.includes('+')) {
                tEnd = tEnd.replace(' ', 'T') + 'Z';
            }
            const d = new Date(tEnd);
            if (!isNaN(d.getTime())) {
                if (d.getTime() > maxTime) maxTime = d.getTime();
            }
        }
    }

    if (maxTime > 0) {
        const mDate = new Date(maxTime);
        return `${String(mDate.getHours()).padStart(2, '0')}:${String(mDate.getMinutes()).padStart(2, '0')}`;
    }

    // Fallback cuối: dùng booking.timeEnd nếu có (chỉ khi không tìm được gì khác)
    if (order.timeEnd && servicesToCheck === order.services) {
        return formatToHourMinute(order.timeEnd);
    }

    return order.time; 
};

export function KanbanBoard({ orders, onUpdateStatus, onOpenDetail, onConfirmAddonPayment, selectedOrderId, onContextMenu, roomTransitionTime = 5 }: KanbanBoardProps) {
    const [draggedSubOrderId, setDraggedSubOrderId] = useState<string | null>(null);
    const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; ktvId: string; time: string | null } | null>(null);
    const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);

    const subOrders = React.useMemo(() => {
        return buildOrderTimeline(orders);
    }, [orders]);

    // 🔥 FIX: Track đơn đã auto-finish để không hỏi lại liên tục
    const autoFinishedRef = React.useRef<Set<string>>(new Set());

    React.useEffect(() => {
        const checkAutoFinish = () => {
            const now = new Date();
            
            // 🔧 FIX: Kiểm tra theo TỪNG subOrder, không phải toàn booking
            // Và BỎ QUA booking còn items PREPARING (chưa ai bắt đầu)
            subOrders.forEach(subOrder => {
                if (subOrder.dispatchStatus !== 'IN_PROGRESS' && subOrder.dispatchStatus !== 'CLEANING') return;
                
                // Skip nếu subOrder này đã được auto-finish trước đó
                if (autoFinishedRef.current.has(subOrder.id)) return;

                // 🛡️ GUARD: Bỏ qua nếu booking GỐC còn items PREPARING/NEW
                // → Có KTV khác chưa bắt đầu, KHÔNG auto-finish toàn booking
                const originalOrder = subOrder.originalOrder;
                const hasWaitingItems = originalOrder.services.some(s => 
                    ['PREPARING', 'NEW', 'WAITING'].includes(s.status || '')
                );
                
                if (subOrder.dispatchStatus === 'IN_PROGRESS') {
                    // Chỉ tính estimated end time từ services CỦA subOrder này (không phải toàn booking)
                    const estEndStr = getEstimatedEndTime(originalOrder, subOrder.services);
                    if (estEndStr && estEndStr !== '--:--') {
                        const [h, m] = estEndStr.split(':').map(Number);
                        const estEnd = new Date();
                        estEnd.setHours(h, m, 0, 0);
                        
                        // Handle midnight crossing using absolute offset to avoid timezone shift bugs
                        if (estEnd.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
                             estEnd.setDate(estEnd.getDate() + 1);
                        } else if (estEnd.getTime() > now.getTime() + 12 * 60 * 60 * 1000) {
                             estEnd.setDate(estEnd.getDate() - 1);
                        }
                        
                        // Allow 5 seconds grace period
                        if (now.getTime() >= estEnd.getTime() + 5000) {
                             console.log(`🤖 [Kanban AutoFinish] Time is up for subOrder ${subOrder.id} (${estEndStr}). Auto-completing...`);
                             autoFinishedRef.current.add(subOrder.id);
                             
                             // 🔧 FIX: Truyền itemIds cụ thể → CHỈ update items của subOrder này
                             const itemIds = subOrder.services.map(s => s.id);
                             let targetKtvIds: string[] | undefined = undefined;
                             if (subOrder.ktvIds && subOrder.ktvIds.length > 0) {
                                 targetKtvIds = subOrder.ktvIds;
                             }
                             // Chuyển sang CLEANING thay vì COMPLETED theo flow chuẩn mới
                             onUpdateStatus(subOrder.bookingId, 'CLEANING', itemIds, true, targetKtvIds); // skipConfirm = true
                        }
                    }
                } else if (subOrder.dispatchStatus === 'CLEANING') {
                    // Xử lý auto chuyển từ CLEANING sang FEEDBACK / DONE
                    const originalOrder = subOrder.originalOrder;
                    if (originalOrder.updatedAt) {
                        const updatedAt = new Date(originalOrder.updatedAt).getTime();
                        const diffMins = (now.getTime() - updatedAt) / 60000;
                        if (diffMins >= roomTransitionTime) {
                            const itemIds = subOrder.services.map(s => s.id);
                            let targetKtvIds: string[] | undefined = undefined;
                            if (subOrder.ktvIds && subOrder.ktvIds.length > 0) {
                                targetKtvIds = subOrder.ktvIds;
                            }
                            if (originalOrder.rating) {
                                console.log(`✅ [Kanban AutoFinish] Both done for subOrder ${subOrder.id}. Moving to DONE.`);
                                onUpdateStatus(subOrder.bookingId, 'DONE', itemIds, true, targetKtvIds);
                            } else {
                                console.log(`🧹 [Kanban AutoFinish] Cleaning done for subOrder ${subOrder.id}. Moving to FEEDBACK.`);
                                onUpdateStatus(subOrder.bookingId, 'FEEDBACK', itemIds, true, targetKtvIds);
                            }
                        }
                    }
                }
            });
        };

        const interval = setInterval(checkAutoFinish, 30000);
        return () => clearInterval(interval);
    }, [subOrders, onUpdateStatus]);

    const getStatusConfig = (id: string) => STATUS_CONFIG.find(s => s.id === id) || STATUS_CONFIG[0];

    return (
        <div className="flex-1 flex gap-4 overflow-x-auto pb-6 no-scrollbar min-h-0">
            {STATUS_CONFIG.map(column => {
                const columnSubOrders = subOrders.filter(so => column.dispatchModeId.includes(so.dispatchStatus));
                return (
                    <div
                        key={column.id}
                        className={`flex-1 min-w-[300px] max-w-[360px] flex flex-col bg-gray-50/40 rounded-[2rem] border-2 border-transparent transition-all duration-300 ${draggedSubOrderId ? 'bg-indigo-50/30 border-dashed border-indigo-200 shadow-inner' : 'hover:bg-gray-100/50'}`}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => {
                            if (draggedSubOrderId) {
                                const draggedSubOrder = subOrders.find(so => so.id === draggedSubOrderId);
                                if (draggedSubOrder) {
                                    const itemIds = draggedSubOrder.services.map(s => s.id);
                                    let newStatus = column.id;
                                    let targetKtvIds: string[] | undefined = undefined;
                                    if (draggedSubOrder.ktvIds && draggedSubOrder.ktvIds.length > 0) {
                                        targetKtvIds = draggedSubOrder.ktvIds;
                                    }
                                    
                                    if (!canTransition(draggedSubOrder.dispatchStatus, newStatus)) {
                                        const { mapDispatchToRawStatus, STATUS_FLOW } = require('@/lib/dispatch-status');
                                        const fromIdx = STATUS_FLOW.indexOf(mapDispatchToRawStatus(draggedSubOrder.dispatchStatus));
                                        const toIdx = STATUS_FLOW.indexOf(mapDispatchToRawStatus(newStatus));
                                        
                                        // Nếu kéo lùi (từ bước cao về bước thấp hơn)
                                        if (fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx) {
                                            const confirmBackward = confirm(`Trạng thái đang đi lùi từ ${draggedSubOrder.dispatchStatus} về ${newStatus}.\n\n⚠️ LƯU Ý: Nếu kéo về CHUẨN BỊ, mọi thời gian đã chạy của KTV sẽ bị XÓA SẠCH để làm lại từ đầu!\n\nBạn có chắc chắn muốn KÉO LẠI không?`);
                                            if (!confirmBackward) {
                                                setDraggedSubOrderId(null);
                                                return;
                                            }
                                            // Kéo lùi được chấp nhận
                                            onUpdateStatus(draggedSubOrder.bookingId, newStatus, itemIds, true, targetKtvIds);
                                            setDraggedSubOrderId(null);
                                            return;
                                        }
                                        
                                        console.warn(`[Kanban] Cấm chuyển từ ${draggedSubOrder.dispatchStatus} sang ${newStatus}`);
                                        setDraggedSubOrderId(null);
                                        return;
                                    }

                                    // if column is 'COMPLETED', use 'COMPLETED'
                                    onUpdateStatus(draggedSubOrder.bookingId, newStatus, itemIds, false, targetKtvIds);
                                }
                                setDraggedSubOrderId(null);
                            }
                        }}
                    >
                        {/* Column Header */}
                        <div className="p-5 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className={`w-3.5 h-3.5 rounded-full ${column.dot} shadow-lg shadow-indigo-200`} />
                                <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest leading-none">{column.shortLabel}</h2>
                                <span className="bg-white border text-gray-400 px-2.5 py-0.5 rounded-full text-[10px] font-black shadow-sm">
                                    {columnSubOrders.length}
                                </span>
                            </div>
                        </div>

                        {/* Order Cards */}
                        <div className="flex-1 overflow-y-auto space-y-4 px-3 pb-4 custom-scrollbar">
                            <AnimatePresence mode="popLayout">
                                {columnSubOrders.map((subOrder: any) => {
                                    const { originalOrder: order, services } = subOrder;
                                    const cfg = getStatusConfig(subOrder.dispatchStatus || 'PREPARING');
                                    const currentCfg = STATUS_CONFIG.find(c => c.dispatchModeId.includes(subOrder.dispatchStatus)) || cfg;
                                    const isSelected = selectedOrderId === subOrder.bookingId;

                                    return (
                                        <motion.div
                                            key={subOrder.id}
                                            layout
                                            initial={{ opacity: 0, scale: 0.9 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.9 }}
                                            draggable
                                            onDragStart={() => setDraggedSubOrderId(subOrder.id)}
                                            onDragEnd={() => setDraggedSubOrderId(null)}
                                            onClick={() => onOpenDetail(subOrder.bookingId, subOrder.id, subOrder.dispatchStatus)}

                                            onContextMenu={(e: React.MouseEvent) => {
                                                if (onContextMenu) {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    onContextMenu(e, subOrder.bookingId);
                                                }
                                            }}
                                            onTouchStart={(e) => {
                                                if (!onContextMenu) return;
                                                const touch = e.touches[0];
                                                longPressTimer.current = setTimeout(() => {
                                                    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
                                                        window.navigator.vibrate(50);
                                                    }
                                            onContextMenu(e as any, subOrder.bookingId);
                                                }, 500);
                                            }}
                                            onTouchMove={() => {
                                                if (longPressTimer.current) clearTimeout(longPressTimer.current);
                                            }}
                                            onTouchEnd={() => {
                                                if (longPressTimer.current) clearTimeout(longPressTimer.current);
                                            }}
                                            style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                                            className={`bg-white rounded-[1.5rem] border-2 cursor-grab active:cursor-grabbing transition-all shadow-sm hover:shadow-2xl hover:translate-y-[-4px] ${isSelected ? 'border-indigo-500 ring-4 ring-indigo-500/10' : 'border-white hover:border-indigo-100'}`}
                                        >
                                            <div className="p-4">
                                                <div className="flex items-center justify-between mb-4">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] font-black text-gray-400 bg-gray-50 px-2 py-0.5 rounded-lg tracking-wider">
                                                            {order.billCode} {services.length < order.services.length && '(Tách)'}
                                                        </span>
                                                        {order.hasVat && (
                                                            <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100" title="Khách yêu cầu xuất hoá đơn VAT">VAT</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400">
                                                        <Clock size={11} className="text-indigo-400" /> ra ca {getEstimatedEndTime(order, services)}
                                                    </div>
                                                </div>

                                                <div className="flex items-start justify-between mb-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-xl shadow-indigo-100 shrink-0">
                                                            {order.customerName.charAt(0)}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex flex-col gap-0.5 mb-1.5">
                                                              <div className="flex items-center gap-1.5">
                                                                <p className="font-black text-sm text-gray-900 leading-none truncate">{order.customerName}</p>
                                                                {order.services[0]?.adminNote?.includes('VIP_APPOINTMENT') && (
                                                                  <span className="px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-200 to-yellow-400 text-[9px] font-black text-amber-900 shadow-sm border border-yellow-300">VIP</span>
                                                                )}
                                                              </div>
                                                              {order.phone && <p className="text-[10px] text-gray-500 font-bold">{order.phone}</p>}
                                                              {order.source && order.source.includes('VIP') && (
                                                                <div className="flex items-center gap-1 mt-0.5">
                                                                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 uppercase tracking-tighter">
                                                                    {order.source === 'VIP_BOOKING' ? 'Khách Đặt Hẹn' : (order.source === 'VIP_WALK_IN' ? 'Khách Tại Quầy' : order.source)}
                                                                  </span>
                                                                  {order.timeBooking && (
                                                                     <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 tracking-tighter">
                                                                        🕒 {order.timeBooking}
                                                                     </span>
                                                                  )}
                                                                </div>
                                                              )}
                                                            </div>
                                                              <div className="flex flex-col gap-1 items-start">
                                                                  {order.vipWarnings && order.vipWarnings.length > 0 && (
                                                                      <div className="flex flex-col gap-0.5 mt-1">
                                                                          {order.vipWarnings.map((w: string, i: number) => (
                                                                              <span key={i} className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm bg-rose-50 text-rose-600 border border-rose-100 flex items-center gap-1 w-fit">
                                                                                  ⚠️ {w}
                                                                              </span>
                                                                          ))}
                                                                      </div>
                                                                  )}
                                                                  {(!order.paymentMethod || order.paymentMethod === 'Unpaid') && (
                                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100 flex items-center gap-1 w-fit">
                                                                        <AlertCircle size={9} /> Chưa TT
                                                                    </span>
                                                                )}
                                                                {(() => {
                                                                    const unpaidAmount = services.reduce((acc: number, svc: any) => acc + (svc.options?.isPaid === false ? ((svc.price || 0) * (svc.quantity || 1)) : 0), 0);
                                                                    if (unpaidAmount > 0) {
                                                                        return (
                                                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100 flex items-center gap-1 w-fit">
                                                                                Phát sinh chưa thu: {formatVND(unpaidAmount)}
                                                                            </span>
                                                                        );
                                                                    }
                                                                    return null;
                                                                })()}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {(() => {
                                                        const subOrderTotal = services.reduce((acc: number, svc: any) => acc + ((svc.price || 0) * (svc.quantity || 1)), 0);
                                                        const pm = order.paymentMethod;
                                                        let pmIcon = null;
                                                        let pmText = '';
                                                        let colorClass = '';
                                                        let bgClass = '';
                                                        
                                                        if (!pm || pm === 'Unpaid') {
                                                            pmIcon = <AlertCircle size={10} className="text-rose-600" />;
                                                            pmText = 'Chưa thanh toán';
                                                            colorClass = 'text-rose-600';
                                                            bgClass = 'bg-rose-50 border-rose-100';
                                                        } else if (pm === 'Tiền mặt' || pm === 'Cash') {
                                                            pmIcon = <Banknote size={10} className="text-emerald-600" />;
                                                            pmText = 'Tiền mặt';
                                                            colorClass = 'text-emerald-600';
                                                            bgClass = 'bg-emerald-50 border-emerald-100';
                                                        } else if (pm === 'Chuyển khoản' || pm === 'Bank') {
                                                            pmIcon = <QrCode size={10} className="text-indigo-600" />;
                                                            pmText = 'Chuyển khoản';
                                                            colorClass = 'text-indigo-600';
                                                            bgClass = 'bg-indigo-50 border-indigo-100';
                                                        } else if (pm.includes('Thẻ') || pm === 'Credit') {
                                                            pmIcon = <CreditCard size={10} className="text-amber-600" />;
                                                            pmText = 'Quẹt thẻ';
                                                            colorClass = 'text-amber-600';
                                                            bgClass = 'bg-amber-50 border-amber-100';
                                                        } else {
                                                            pmIcon = <CheckCircle2 size={10} className="text-gray-500" />;
                                                            pmText = pm;
                                                            colorClass = 'text-gray-600';
                                                            bgClass = 'bg-gray-50 border-gray-100';
                                                        }

                                                        return (
                                                          <div className="flex flex-col items-end shrink-0 gap-1.5">
                                                            <p className="text-sm font-black text-gray-900 leading-none">{formatVND(subOrderTotal)}</p>
                                                            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border ${bgClass}`} title={pmText}>
                                                              {pmIcon}
                                                              <span className={`text-[9px] font-bold ${colorClass}`}>{pmText}</span>
                                                            </div>
                                                          </div>
                                                        );
                                                    })()}
                                                </div>

                                                <div className="bg-gray-50/50 rounded-xl p-3 space-y-3 mb-4">
                                                    {(() => {
                                                        let currentCumulativeStr: string | null = null;
                                                        return services.map((s: any, idx: number) => {
                                                            const firstSeg = s.staffList?.[0]?.segments?.[0];
                                                            const explicitStart = firstSeg?.actualStartTime || s.timeStart || firstSeg?.startTime;
                                                            const duration = Number(firstSeg?.duration) || Number(s.duration) || 60;
                                                            
                                                            let displayStart = firstSeg?.actualStartTime ? firstSeg.actualStartTime : (currentCumulativeStr || explicitStart);
                                                            
                                                            let displayEnd = firstSeg?.actualEndTime ? firstSeg.actualEndTime : (displayStart ? getDynamicEndTime(displayStart, duration) : (s.timeEnd || firstSeg?.endTime));
                                                            if (s.staffList && s.staffList.length > 1) {
                                                                const lastSt = s.staffList[s.staffList.length - 1];
                                                                const lastSeg = lastSt?.segments?.[0];
                                                                if (lastSeg) {
                                                                    const kStart = lastSeg.actualStartTime || lastSeg.startTime || displayStart;
                                                                    // 🔥 FIX: Luôn tính dynamic từ kStart thay vì dùng endTime cũ (stale từ lúc dispatch)
                                                                    displayEnd = lastSeg.actualEndTime ? lastSeg.actualEndTime : getDynamicEndTime(kStart, Number(lastSeg.duration) || 60);
                                                                }
                                                            }
                                                            currentCumulativeStr = displayEnd;

                                                            return (
                                                        <div key={s.id} className="flex flex-col gap-1.5">
                                                            <div className="flex items-center justify-between text-[11px]">
                                                                <span className={`font-black truncate pr-2 ${s.isUtility ? 'text-amber-600/80 italic' : 'text-gray-700'}`}>
                                                                    {s.isUtility && <span className="text-amber-500 font-bold mr-1">[Tiện ích]</span>}
                                                                    {s.options?.displayName || s.serviceName}
                                                                </span>
                                                                {!s.isUtility && (
                                                                    <span className="text-[9px] font-black text-indigo-600 bg-white px-1.5 py-0.5 rounded-lg shadow-sm border border-indigo-50 shrink-0">P.{s.selectedRoomId || '—'}</span>
                                                                )}
                                                            </div>
                                                            
                                                            {/* Danh sách KTV */}
                                                            {!s.isUtility && s.staffList && s.staffList.length > 0 && (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {s.staffList.map((st: any, idx: number) => {
                                                                        const photoSegment = st.segments?.find((seg: any) => seg.startPhotoUrl);
                                                                        const startPhotoUrl = photoSegment?.startPhotoUrl;
                                                                        return (
                                                                            <span key={idx} className="text-[9px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-md flex items-center gap-1.5">
                                                                                <span>👤 {st.ktvId || 'Chưa gán'}</span>
                                                                                {startPhotoUrl && (
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setSelectedPhoto({
                                                                                                url: startPhotoUrl,
                                                                                                ktvId: st.ktvId,
                                                                                                time: photoSegment.actualStartTime || photoSegment.startTime
                                                                                            });
                                                                                        }}
                                                                                        className="w-3.5 h-3.5 rounded-full overflow-hidden border border-indigo-300 hover:scale-110 active:scale-95 transition-transform shrink-0"
                                                                                        title="Xem ảnh xác nhận khách"
                                                                                    >
                                                                                        <img src={startPhotoUrl} alt="Selfie" className="w-full h-full object-cover" />
                                                                                    </button>
                                                                                )}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}

                                                            {/* Hiển thị thời gian THEO TỪNG KTV */}
                                                            {!s.isUtility && (
                                                                s.staffList && s.staffList.length > 1 ? (
                                                                    <div className="space-y-1 mt-1">
                                                                        {s.staffList.map((st: any, stIdx: number) => {
                                                                            const seg = st?.segments?.[0];
                                                                            const ktvStart = seg?.actualStartTime || subOrder.calculatedStart || seg?.startTime || displayStart;
                                                                            // 🔥 FIX: Luôn tính dynamic end time từ ktvStart thực tế, không dùng seg.endTime cũ
                                                                            const ktvEnd = seg?.actualEndTime ? seg.actualEndTime : getDynamicEndTime(ktvStart, Number(seg?.duration) || duration);
                                                                            return (
                                                                                <div key={stIdx} className="flex items-center justify-between bg-indigo-50/70 rounded-lg px-2.5 py-1 border border-indigo-100/50">
                                                                                    <div className="flex items-center gap-1.5">
                                                                                        <span className="text-[9px] font-bold text-gray-500">{st.ktvId}</span>
                                                                                        {(() => {
                                                                                            const photoSegment = st.segments?.find((seg: any) => seg.startPhotoUrl);
                                                                                            if (!photoSegment) return null;
                                                                                            return (
                                                                                                <button
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        setSelectedPhoto({
                                                                                                            url: photoSegment.startPhotoUrl,
                                                                                                            ktvId: st.ktvId,
                                                                                                            time: photoSegment.actualStartTime || photoSegment.startTime
                                                                                                        });
                                                                                                    }}
                                                                                                    className="w-4 h-4 rounded-full overflow-hidden border border-indigo-300 hover:scale-110 active:scale-95 transition-transform shrink-0"
                                                                                                    title="Xem ảnh xác nhận khách"
                                                                                                >
                                                                                                    <img src={photoSegment.startPhotoUrl} alt="Selfie" className="w-full h-full object-cover" />
                                                                                                </button>
                                                                                            );
                                                                                        })()}
                                                                                    </div>
                                                                                    <div className="flex items-center gap-1.5">
                                                                                        <span className="text-[10px] font-black text-indigo-700">{formatToHourMinute(ktvStart)}</span>
                                                                                        <span className="text-indigo-300 text-[8px]">→</span>
                                                                                        <span className="text-[10px] font-black text-indigo-700">{formatToHourMinute(ktvEnd)}</span>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center justify-between bg-indigo-50/70 rounded-lg px-2.5 py-1.5 border border-indigo-100/50 mt-1">
                                                                        <div className="flex flex-col">
                                                                            <span className="text-[8px] text-indigo-400 font-bold uppercase tracking-wider mb-0.5">Bắt đầu</span>
                                                                            <span className="text-[10px] font-black text-indigo-700">{formatToHourMinute(displayStart)}</span>
                                                                        </div>
                                                                        <div className="text-indigo-300">
                                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                                                        </div>
                                                                        <div className="flex flex-col text-right">
                                                                            <span className="text-[8px] text-indigo-400 font-bold uppercase tracking-wider mb-0.5">Kết thúc</span>
                                                                            <span className="text-[10px] font-black text-indigo-700">
                                                                                {formatToHourMinute(displayEnd)}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                )
                                                            )}
                                                        </div>
                                                            );
                                                        });
                                                    })()}
                                                </div>

                                                {/* 🏷️ 2 TAGS: Hiện ở cả cột "Dọn phòng" và "Chờ đánh giá" */}
                                                {(subOrder.dispatchStatus === 'CLEANING' || subOrder.dispatchStatus === 'FEEDBACK') && (
                                                    <div className="mb-3 space-y-1.5">
                                                        {/* TAG 1: Dọn phòng */}
                                                        <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-bold border ${
                                                            subOrder.dispatchStatus === 'FEEDBACK' || subOrder.rawStatus === 'FEEDBACK'
                                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                : 'bg-orange-50 text-orange-600 border-orange-200'
                                                        }`}>
                                                            {subOrder.dispatchStatus === 'FEEDBACK' || subOrder.rawStatus === 'FEEDBACK'
                                                                ? <><Check size={12} /> Dọn phòng: Đã dọn xong</>
                                                                : <><Clock size={12} className="animate-spin" style={{animationDuration: '3s'}}/> Dọn phòng: Đang dọn...</>
                                                            }
                                                        </div>

                                                        {/* TAG 2: Đánh giá */}
                                                        <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-bold border ${
                                                            subOrder.rating
                                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                : 'bg-blue-50 text-blue-600 border-blue-200'
                                                        }`}>
                                                            {subOrder.rating ? (
                                                                <>
                                                                    <Check size={12} /> Đánh giá: {subOrder.rating >= 4 ? 'Xuất sắc' : subOrder.rating >= 3 ? 'Tốt' : subOrder.rating >= 2 ? 'Khá' : 'Tệ'} ({Math.min(subOrder.rating, 4)}/4)
                                                                </>
                                                            ) : (
                                                                <><Star size={12} /> Đánh giá: Chờ khách...</>
                                                            )}
                                                        </div>

                                                        {/* Ngôi sao để chấm điểm hộ khách (chỉ khi chưa đánh giá) */}
                                                        {!subOrder.rating && (
                                                            <div className="flex items-center gap-1 mt-1">
                                                                {[1, 2, 3, 4].map((star) => (
                                                                    <button
                                                                        key={star}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            if (confirm(`Xác nhận đánh giá ${star} sao hộ khách?`)) {
                                                                                import('../actions').then(m => {
                                                                                    m.submitCustomerRating(subOrder.bookingId, star);
                                                                                });
                                                                            }
                                                                        }}
                                                                        className="p-0.5 text-gray-300 hover:text-amber-400 transition-all cursor-pointer"
                                                                    >
                                                                        <Star size={14} fill="none" strokeWidth={2.5} />
                                                                    </button>
                                                                ))}
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const ratingUrl = `https://nganha.vercel.app/${order.customerLang || 'vi'}/journey/${order.accessToken || subOrder.bookingId}`;
                                                                        window.open(ratingUrl, '_blank');
                                                                    }}
                                                                    className="ml-auto text-[9px] text-indigo-500 hover:underline flex items-center gap-0.5"
                                                                >
                                                                    <QrCode size={10} /> Link
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* ✅ RATING RESULT: Chỉ hiện ở cột "Hoàn tất" */}
                                                {subOrder.dispatchStatus === 'DONE' && subOrder.rating && (() => {
                                                    const currentRating = Math.min(subOrder.rating, 4);
                                                    const ratingLabel = currentRating >= 4 ? 'Xuất sắc' : currentRating >= 3 ? 'Tốt' : currentRating >= 2 ? 'Khá' : 'Tệ';
                                                    const ratingColor = currentRating >= 4 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : currentRating >= 3 ? 'text-blue-600 bg-blue-50 border-blue-200' : currentRating >= 2 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-red-600 bg-red-50 border-red-200';
                                                    return (
                                                        <div className={`mb-3 rounded-xl px-3 py-2 border ${ratingColor}`}>
                                                            <div className="flex items-center gap-1">
                                                                {[1, 2, 3, 4].map((s) => (
                                                                    <Star key={s} size={14} fill={currentRating >= s ? 'currentColor' : 'none'} strokeWidth={currentRating >= s ? 0 : 2} className={currentRating >= s ? '' : 'opacity-30'} />
                                                                ))}
                                                                <span className="ml-1.5 text-[11px] font-black">{ratingLabel}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}

                                                <div className="flex items-center gap-2">
                                                    {(() => {
                                                        const unpaidAmount = services.reduce((acc: number, svc: any) => acc + (svc.options?.isPaid === false ? ((svc.price || 0) * (svc.quantity || 1)) : 0), 0);
                                                        if (unpaidAmount > 0 && onConfirmAddonPayment) {
                                                            return (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onConfirmAddonPayment(order.id); }}
                                                                    className="flex-1 py-2.5 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-2 shadow-sm bg-orange-500 text-white hover:bg-orange-600 active:scale-95"
                                                                >
                                                                    Đã thu {formatVND(unpaidAmount)}
                                                                </button>
                                                            );
                                                        }
                                                        if (currentCfg.next) {
                                                            return (
                                                                <button
                                                                    onClick={e => { 
                                                                        e.stopPropagation(); 
                                                                        const itemIds = services.map((s: any) => s.id);
                                                                        let targetKtvIds: string[] | undefined = undefined;
                                                                        if (subOrder.ktvIds && subOrder.ktvIds.length > 0) {
                                                                            targetKtvIds = subOrder.ktvIds;
                                                                        }
                                                                        onUpdateStatus(order.id, currentCfg.next!, itemIds, false, targetKtvIds); 
                                                                    }}
                                                                    className={`flex-1 py-2.5 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-2 shadow-sm ${currentCfg.activeBg || 'bg-indigo-600'} text-white hover:opacity-90 active:scale-95`}
                                                                >
                                                                    {currentCfg.nextLabel}
                                                                </button>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                    {(!subOrder.rating && !['DONE', 'CANCELLED'].includes(subOrder.dispatchStatus)) && (
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const ratingUrl = `https://nganha.vercel.app/${order.customerLang || 'vi'}/journey/${order.accessToken || subOrder.bookingId}`;
                                                                window.open(ratingUrl, '_blank');
                                                            }}
                                                            className="px-2.5 py-2.5 rounded-xl text-[11px] font-black text-indigo-500 bg-indigo-50 hover:bg-indigo-100 transition-all border border-indigo-100 flex items-center gap-1"
                                                            title="Link đánh giá"
                                                        >
                                                            <QrCode size={12} /> Link
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={e => { e.stopPropagation(); onOpenDetail(order.id, subOrder.id, subOrder.dispatchStatus); }}
                                                        className="px-3 py-2.5 rounded-xl text-[11px] font-black text-gray-400 bg-gray-50 hover:bg-gray-100 transition-all border border-gray-100"
                                                    >
                                                        Chi tiết
                                                    </button>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>

                            {columnSubOrders.length === 0 && (
                                <div className="h-32 flex flex-col items-center justify-center text-gray-300 gap-3 border-4 border-dashed border-gray-100 rounded-[2rem] bg-gray-50/50">
                                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                                        <CheckCircle2 size={16} className="opacity-20" />
                                    </div>
                                    <p className="text-[10px] font-black uppercase tracking-widest">Trống</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Modal Xem Ảnh Xác Nhận Khách */}
            <AnimatePresence>
                {selectedPhoto && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedPhoto(null)}
                        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            onClick={(e) => e.stopPropagation()}
                            className="relative bg-white rounded-3xl overflow-hidden max-w-md w-full shadow-2xl border border-gray-100 flex flex-col"
                        >
                            {/* Header */}
                            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                                <div>
                                    <h3 className="font-black text-gray-900 text-sm">Ảnh xác nhận khách bắt đầu ca</h3>
                                    <p className="text-xs text-gray-500 font-bold">Kỹ thuật viên: {selectedPhoto.ktvId}</p>
                                </div>
                                <button
                                    onClick={() => setSelectedPhoto(null)}
                                    className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Image Body */}
                            <div className="relative aspect-[3/4] bg-gray-50 flex items-center justify-center">
                                <img
                                    src={selectedPhoto.url}
                                    alt="Ảnh xác nhận khách"
                                    className="w-full h-full object-contain"
                                />
                            </div>

                            {/* Footer */}
                            {selectedPhoto.time && (
                                <div className="p-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                                    <span className="text-xs text-gray-500 font-bold">Thời gian bắt đầu:</span>
                                    <span className="text-xs font-black text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
                                        {formatToHourMinute(selectedPhoto.time)}
                                    </span>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
