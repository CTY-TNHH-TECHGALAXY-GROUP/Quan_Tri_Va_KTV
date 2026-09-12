import React from 'react';
import { useRevenueRoomsAnalysis } from './RevenueRoomsAnalysis.logic';
import { Loader2, DoorOpen, BedDouble, CheckCircle2 } from 'lucide-react';

interface Props {
    dateFrom: string;
    dateTo: string;
    langFilter: string;
}

export default function RevenueRoomsAnalysis({ dateFrom, dateTo, langFilter }: Props) {
    const { data, isLoading, error } = useRevenueRoomsAnalysis(dateFrom, dateTo, langFilter);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-gray-100 backdrop-blur-sm">
                <Loader2 className="w-8 h-8 text-cyan-600 animate-spin mb-4" />
                <p className="text-gray-500 font-medium">Đang tải dữ liệu Hậu cần & Phòng...</p>
            </div>
        );
    }

    if (error) {
        return <div className="p-4 bg-red-50 text-red-600 rounded-xl">{error}</div>;
    }

    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-gray-100 shadow-sm">
                <DoorOpen className="w-16 h-16 text-gray-200 mb-4" />
                <p className="text-gray-500 font-medium">Chưa có dữ liệu sử dụng phòng trong khoảng thời gian này</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <DoorOpen size={20} className="text-cyan-600" />
                        Thống Kê Hoạt Động Từng Phòng
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">Dữ liệu chi tiết số lượt phục vụ để Hậu cần kịp thời bổ sung khăn, tinh dầu, vật tư.</p>
                </div>
                <div className="px-4 py-2 bg-cyan-50 rounded-xl border border-cyan-100 flex items-center gap-3">
                    <div className="bg-white p-2 rounded-lg shadow-sm">
                        <BedDouble size={20} className="text-cyan-600" />
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 font-medium uppercase">Số phòng hoạt động</p>
                        <p className="text-xl font-black text-cyan-700 leading-none">{data.length}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {data.map((room, index) => {
                    // Highlight phòng dùng nhiều (VD trên 5 lượt/ngày là nhiều, nhưng ta làm đơn giản là màu nhẹ)
                    const isHighUsage = room.totalServices >= 10;

                    return (
                        <div key={index} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                            {/* Card Header */}
                            <div className={`p-4 border-b border-gray-100 flex items-center justify-between ${isHighUsage ? 'bg-orange-50/50' : 'bg-gray-50/50'}`}>
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isHighUsage ? 'bg-orange-100 text-orange-600' : 'bg-cyan-100 text-cyan-600'}`}>
                                        <DoorOpen size={20} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-gray-900 text-lg leading-tight">{room.roomName}</h4>
                                        <p className="text-xs font-medium text-gray-500 mt-0.5">Thống kê dịch vụ</p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className={`text-2xl font-black leading-none ${isHighUsage ? 'text-orange-600' : 'text-cyan-600'}`}>
                                        {room.totalServices}
                                    </span>
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Lượt DV</span>
                                </div>
                            </div>

                            {/* Card Body - Service List */}
                            <div className="p-4 flex-1">
                                <ul className="space-y-3">
                                    {room.services.map((svc, sIndex) => (
                                        <li key={sIndex} className="flex items-center justify-between group">
                                            <div className="flex items-start gap-2 max-w-[80%]">
                                                <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                                                <span className="text-sm font-medium text-gray-700 leading-snug group-hover:text-cyan-700 transition-colors">
                                                    {svc.name}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="px-2 py-0.5 bg-gray-100 text-gray-700 font-bold text-xs rounded">
                                                    {svc.count}
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            
                            {isHighUsage && (
                                <div className="bg-orange-50 px-4 py-2 text-xs font-medium text-orange-700 border-t border-orange-100 text-center">
                                    🔥 Cần chú ý thay khăn & vật tư gấp
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
