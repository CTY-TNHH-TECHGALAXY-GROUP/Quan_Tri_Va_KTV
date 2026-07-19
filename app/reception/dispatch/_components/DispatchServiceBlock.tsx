'use client';

import React from 'react';
import { Plus, AlertTriangle, UserCheck, Trash2, Pencil } from 'lucide-react';
import { DispatchStaffRow } from './DispatchStaffRow';
import { ReminderData, ServiceBlock, StaffAssignment, StaffData, TurnQueueData } from '../types';

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

interface DispatchServiceBlockProps {
    svc: ServiceBlock;
    svcIndex: number;
    orderId: string;
    rooms: Room[];
    beds: Bed[];
    busyBedIds?: string[];
    usedKtvIds?: string[];
    availableTurns: (TurnQueueData & { staff?: StaffData })[];
    onUpdateSvc: (orderId: string, svcId: string, patch: Partial<ServiceBlock>) => void;
    onUpdateStaff: (orderId: string, svcId: string, rowId: string, patch: Partial<StaffAssignment>) => void;
    onAddStaff: (orderId: string, svcId: string) => void;
    onRemoveStaff: (orderId: string, svcId: string, rowId: string) => void;
    onRemoveSvc?: (orderId: string, svcId: string) => void;
    onEditSvc?: (orderId: string, svcId: string) => void;
    selectedDate?: string;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    onDispatchSvc?: (orderId: string, svcId: string) => void;
    reminders?: ReminderData[];
    onViewPhoto?: (photo: { url: string; ktvId: string; time: string | null }) => void;
    orderSource?: string;
}

export const DispatchServiceBlock = ({
    svc, svcIndex, orderId, rooms, beds, busyBedIds = [], usedKtvIds = [], availableTurns,
    onUpdateSvc, onUpdateStaff, onAddStaff, onRemoveStaff, onRemoveSvc, onEditSvc, selectedDate,
    isExpanded = true, onToggleExpand, onDispatchSvc, reminders = [], onViewPhoto, orderSource
}: DispatchServiceBlockProps) => {

    const isUtility = !!(svc as any).isUtility;
    const isVip = (svc.serviceId && (svc.serviceId.toUpperCase().startsWith('NHP') || svc.serviceId.toUpperCase().startsWith('VIP_'))) || orderSource === 'VIP_WALK_IN' || orderSource === 'VIP_MENU';

    return (
        <div className={`border rounded-3xl overflow-hidden shadow-sm transition-all ${isUtility ? 'border-amber-200 bg-amber-50/30' : 'border-gray-100 bg-white hover:shadow-md hover:border-indigo-100'}`}>
            {/* Service Header */}
            <div 
                className={`px-4 py-4 lg:px-6 flex items-center justify-between backdrop-blur-sm ${isUtility ? 'bg-amber-50/50 cursor-default' : 'bg-gray-50/80 border-b border-gray-100 cursor-pointer'}`}
                onClick={isUtility ? undefined : onToggleExpand}
            >
                <div className="flex items-center gap-3">
                    <span className={`text-white text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest shadow-lg ${isUtility ? 'bg-amber-500 shadow-amber-100' : 'bg-indigo-600 shadow-indigo-100'}`}>
                        {isUtility ? '₫' : svcIndex + 1}
                    </span>
                    <div className="flex flex-col w-full">
                        <div className="flex flex-wrap items-center gap-3">
                            <h3 className="font-black text-gray-900 text-base leading-tight">{svc.options?.displayName || svc.serviceName}</h3>
                            {!isUtility && <span className="inline-block text-xs text-gray-400 font-bold bg-white px-2 py-1 rounded-lg border border-gray-100">{svc.duration}p</span>}
                            {isUtility && <span className="inline-block text-[10px] text-amber-600 font-black bg-amber-100 px-2 py-1 rounded-lg border border-amber-200 uppercase tracking-wider">Tiện ích</span>}
                            
                            {/* Quick View: Assigned KTV & Room */}
                            <div className="flex flex-wrap items-center gap-2">
                                {svc.staffList.map((row, i) => {
                                    const ktvCode = row.ktvId;
                                    const firstSeg = row.segments?.[0];
                                    const roomName = firstSeg?.roomId ? rooms.find(r => r.id === firstSeg.roomId)?.name : null;
                                    
                                    if (!ktvCode && !roomName) return null;
                                    
                                    const photoSegment = row.segments?.find((seg: any) => seg.startPhotoUrl);
                                    const startPhotoUrl = photoSegment?.startPhotoUrl;

                                    return (
                                        <span key={`${row.id || 'row'}-${ktvCode || 'none'}-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-black rounded-lg whitespace-nowrap shadow-sm">
                                            <UserCheck size={14} className="text-indigo-500" />
                                            {ktvCode || 'Chưa gán'}
                                            {startPhotoUrl && onViewPhoto && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onViewPhoto({
                                                            url: startPhotoUrl,
                                                            ktvId: ktvCode,
                                                            time: photoSegment.actualStartTime || photoSegment.startTime
                                                        });
                                                    }}
                                                    className="w-4 h-4 rounded-full overflow-hidden border border-indigo-300 hover:scale-110 active:scale-95 transition-transform shrink-0"
                                                    title="Xem ảnh xác nhận khách"
                                                >
                                                    <img src={startPhotoUrl} alt="Selfie" className="w-full h-full object-cover" />
                                                </button>
                                            )}
                                            {roomName && <span className="text-indigo-300 mx-0.5">•</span>}
                                            {roomName && <span className="text-indigo-600 truncate max-w-[120px]">{roomName}</span>}
                                        </span>
                                    );
                                })}
                                {svc.staffList.every(r => !r.ktvId && !r.segments?.[0]?.roomId) && (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-100 text-gray-400 text-xs font-bold rounded-lg whitespace-nowrap">
                                        Chưa phân công
                                    </span>
                                )}
                            </div>
                        </div>

                        {svc.serviceDescription && (
                            <p className="text-[11px] text-gray-500 font-medium mt-1.5 line-clamp-2 max-w-[350px]">
                                {svc.serviceDescription}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 lg:gap-3">
                    {!isUtility && onEditSvc && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditSvc(orderId, svc.id);
                            }}
                            className="p-2.5 bg-blue-50 text-blue-500 hover:bg-blue-100 hover:text-blue-600 border border-blue-100 rounded-2xl transition-all active:scale-90 shadow-sm"
                            title="Đổi dịch vụ"
                        >
                            <Pencil size={18} strokeWidth={2.5} />
                        </button>
                    )}
                    {onRemoveSvc && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemoveSvc(orderId, svc.id);
                            }}
                            className="p-2.5 bg-rose-50 text-rose-500 hover:bg-rose-100 hover:text-rose-600 border border-rose-100 rounded-2xl transition-all active:scale-90 shadow-sm"
                            title="Xóa dịch vụ"
                        >
                            <Trash2 size={18} strokeWidth={2.5} />
                        </button>
                    )}
                    {!isUtility && (
                        <button className="p-2 text-gray-400 hover:text-gray-600 transition-transform duration-300" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                    )}
                </div>
            </div>

            {isExpanded && !isUtility && (
                <div className="p-4 lg:p-6 space-y-6 animate-in slide-in-from-top-2 duration-200">
                    {/* Customer Requirements */}
                    {((!isVip && svc.genderReq) || svc.strength || svc.focus || svc.avoid || svc.customerNote) && (
                        <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 space-y-3 shadow-inner">
                            <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-2">
                                <AlertTriangle size={14} className="text-amber-500" /> Yêu Cầu Từ Khách
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {!isVip && svc.genderReq && (
                                    <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-purple-50 text-purple-700 border-purple-100 flex items-center gap-1.5 shadow-sm">
                                        <UserCheck size={12} /> {svc.genderReq}
                                    </span>
                                )}
                                {svc.strength && (
                                    <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-orange-50 text-orange-700 border-orange-100 shadow-sm">
                                        💪 {svc.strength}
                                    </span>
                                )}
                                {svc.focus && (
                                    <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm">
                                        🎯 {svc.focus}
                                    </span>
                                )}
                                {svc.avoid && (
                                    <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-rose-50 text-rose-700 border-rose-100 shadow-sm">
                                        🚫 {svc.avoid}
                                    </span>
                                )}
                            </div>
                            {svc.customerNote && (
                                <p className="text-xs text-amber-800 bg-white/60 p-3 rounded-xl font-bold italic border border-amber-100 line-clamp-2">
                                    &quot;{svc.customerNote}&quot;
                                </p>
                            )}
                        </div>
                    )}

                    {/* Tên in phiếu (Tùy chỉnh) */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">Tên In Phiếu (Tùy chỉnh)</label>
                        <input
                            type="text"
                            value={svc.options?.displayName || ''}
                            onChange={e => onUpdateSvc(orderId, svc.id, { options: { ...(svc.options || {}), displayName: e.target.value } })}
                            placeholder={svc.serviceName}
                            className="w-full px-4 py-2 border border-gray-100 rounded-xl text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 outline-none bg-white transition-all shadow-sm text-gray-800 placeholder:text-gray-300"
                        />
                    </div>

                    {/* Staff Selection Area — ẩn cho dịch vụ phụ phí (phòng riêng) */}
                    {!(svc as any).isUtility && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    Nhân viên & Phòng <span className="text-rose-500">*</span>
                                </label>
                                <button
                                    onClick={() => onAddStaff(orderId, svc.id)}
                                    className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-800 transition-colors flex items-center gap-1.5"
                                >
                                    <Plus size={14} strokeWidth={3} /> Thêm KTV/Phòng
                                </button>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                {svc.staffList.map((row) => (
                                    <DispatchStaffRow
                                        key={row.id}
                                        row={row}
                                        svcId={svc.id}
                                        orderId={orderId}
                                        serviceName={svc.serviceName}
                                        displayName={svc.options?.displayName}
                                        svcDuration={svc.duration}
                                        availableTurns={availableTurns}
                                        rooms={rooms}
                                        beds={beds}
                                        busyBedIds={busyBedIds}
                                        usedKtvIds={usedKtvIds}
                                        onUpdate={onUpdateStaff}
                                        onRemove={onRemoveStaff}
                                        canRemove={svc.staffList.length > 1 && !row.segments.some((seg: any) => seg.actualStartTime)}
                                        serviceDescription={svc.serviceDescription}
                                        strength={svc.strength}
                                        adminNote={svc.adminNote}
                                        customerNote={svc.customerNote}
                                        selectedDate={selectedDate}
                                        focus={svc.focus}
                                        avoid={svc.avoid}
                                        realSvcId={svc.serviceId}
                                        reminders={reminders}
                                        genderReq={svc.genderReq}
                                        onViewPhoto={onViewPhoto}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-3 pt-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block px-1">Ghi chú điều phối</label>
                        <textarea
                            value={svc.adminNote}
                            onChange={e => onUpdateSvc(orderId, svc.id, { adminNote: e.target.value })}
                            placeholder="VD: Khách cần thư giãn tuyệt đối, không nói chuyện..."
                            rows={2}
                            className="w-full px-4 py-3 border border-gray-100 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none bg-gray-50/50 transition-all resize-none shadow-inner"
                        />
                    </div>
                    
                    {onDispatchSvc && (
                        <div className="pt-4 flex justify-end">
                            <button
                                onClick={() => onDispatchSvc(orderId, svc.id)}
                                disabled={!svc.staffList.every(r => r.ktvId && r.segments.every(seg => seg.roomId && seg.bedId && seg.startTime))}
                                className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-sm
                                    ${svc.staffList.every(r => r.ktvId && r.segments.every(seg => seg.roomId && seg.bedId && seg.startTime))
                                        ? 'bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 active:scale-95 cursor-pointer'
                                        : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                                    }`}
                            >
                                ĐIỀU PHỐI DỊCH VỤ NÀY
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
