import React from 'react';
import { useRevenueHourlyDetails } from './RevenueHourlyDetails.logic';
import { Loader2, ArrowLeft, Download } from 'lucide-react';

interface Props {
    dateFrom: string;
    dateTo: string;
    langFilter: string;
    hour: number;
    onBack: () => void;
}

export default function RevenueHourlyDetails({ dateFrom, dateTo, langFilter, hour, onBack }: Props) {
    const { data, isLoading, error } = useRevenueHourlyDetails(dateFrom, dateTo, langFilter, hour);

    const formatMoney = (val: number) => new Intl.NumberFormat('vi-VN').format(val || 0);

    // Gom nhóm data theo id (billCode)
    const groupedData = data.reduce((acc, row) => {
        if (!acc[row.id]) acc[row.id] = [];
        acc[row.id].push(row);
        return acc;
    }, {} as Record<string, typeof data>);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-gray-100 backdrop-blur-sm">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                <p className="text-gray-500 font-medium">Đang tải chi tiết hóa đơn...</p>
            </div>
        );
    }

    if (error) {
        return <div className="p-4 bg-red-50 text-red-600 rounded-xl">{error}</div>;
    }

    const totalOrders = Object.keys(groupedData).length;

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[700px]">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={onBack}
                        className="p-2 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors flex items-center gap-2"
                    >
                        <ArrowLeft size={18} />
                        <span className="font-medium text-sm">Quay lại Biểu Đồ</span>
                    </button>
                    <div className="h-6 w-px bg-gray-200"></div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Chi tiết Khung Giờ {hour.toString().padStart(2, '0')}:00 - {hour.toString().padStart(2, '0')}:59</h2>
                        <p className="text-sm text-gray-500">Tìm thấy <span className="font-bold text-indigo-600">{totalOrders}</span> hóa đơn trong khung giờ này</p>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto bg-gray-50 p-4">
                <div className="min-w-max border border-cyan-600 rounded-sm overflow-hidden shadow-sm bg-white">
                    <table className="w-full text-sm text-center border-collapse">
                        <thead>
                            <tr className="bg-cyan-400 text-gray-900 border-b-2 border-cyan-700 whitespace-nowrap text-xs font-bold">
                                <th className="p-2 border-r border-cyan-600 w-12">Bill</th>
                                <th className="p-2 border-r border-cyan-600 w-12">QT</th>
                                <th className="p-2 border-r border-cyan-600 w-16">NGÀY</th>
                                <th className="p-2 border-r border-cyan-600 w-24">ĐẶT</th>
                                <th className="p-2 border-r border-cyan-600 w-28">THANH TOÁN</th>
                                <th className="p-2 border-r border-cyan-600 w-20">PHÒNG</th>
                                <th className="p-2 border-r border-cyan-600 w-16">THỜI GIAN</th>
                                <th className="p-2 border-r border-cyan-600 text-left min-w-[200px]">DỊCH VỤ</th>
                                <th className="p-2 border-r border-cyan-600 w-24">KTV</th>
                                <th className="p-2 border-r border-cyan-600 w-24">TỔNG TIỀN</th>
                                <th className="p-2 border-r border-cyan-600 w-24">TỔNG BILL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(groupedData).map(([billId, items], gIndex) => {
                                const totalBill = items.reduce((sum, item) => sum + item.revenue, 0);
                                const isOddGroup = gIndex % 2 === 0;
                                
                                return items.map((item, iIndex) => {
                                    const isFirst = iIndex === 0;
                                    const isLast = iIndex === items.length - 1;
                                    const rowBg = isOddGroup ? 'bg-[#32cd32] text-black' : 'bg-white text-black';
                                    const borderClass = isLast ? 'border-b-[3px] border-cyan-700' : 'border-b border-gray-300';
                                    
                                    return (
                                        <tr key={`${billId}-${iIndex}`} className={`${rowBg} ${borderClass} hover:opacity-90`}>
                                            <td className="p-1 border-r border-gray-300 font-semibold">{isFirst ? gIndex + 1 : ''}</td>
                                            <td className="p-1 border-r border-gray-300">{isFirst ? item.lang : ''}</td>
                                            <td className="p-1 border-r border-gray-300 font-medium text-gray-700 bg-gray-50">{isFirst ? item.dateStr : ''}</td>
                                            <td className="p-1 border-r border-gray-300">
                                                {isFirst ? (
                                                    <span className="px-2 py-0.5 bg-white rounded text-xs border border-gray-200">
                                                        {item.source}
                                                    </span>
                                                ) : ''}
                                            </td>
                                            <td className="p-1 border-r border-gray-300">
                                                {isFirst ? (
                                                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-bold rounded text-[11px] border border-indigo-100">
                                                        {item.paymentMethod || 'Tiền mặt'}
                                                    </span>
                                                ) : ''}
                                            </td>
                                            <td className="p-1 border-r border-gray-300 font-medium text-emerald-800 bg-[#f0fff0]">{item.roomName || '-'}</td>
                                            <td className="p-1 border-r border-gray-300 bg-[#ffcc99]">
                                                {item.duration > 0 ? item.duration : '-'}
                                            </td>
                                            <td className="p-1 border-r border-gray-300 text-left px-2 truncate max-w-[250px]" title={item.serviceName}>
                                                {item.serviceName}
                                            </td>
                                            <td className="p-1 border-r border-gray-300">
                                                <span className="px-2 py-0.5 bg-[#f0fff0] text-emerald-800 rounded text-xs font-medium border border-emerald-200">
                                                    {item.ktv || '-'}
                                                </span>
                                            </td>
                                            <td className="p-1 border-r border-gray-300 font-semibold text-blue-700 bg-cyan-50">
                                                {formatMoney(item.revenue)}
                                            </td>
                                            {isFirst ? (
                                                <td className="p-1 border-r border-gray-300 font-bold text-red-600 bg-red-50" rowSpan={items.length}>
                                                    {formatMoney(totalBill)}
                                                </td>
                                            ) : null}
                                        </tr>
                                    );
                                });
                            })}
                            {data.length === 0 && (
                                <tr>
                                    <td colSpan={11} className="py-12 text-gray-500 bg-white">
                                        Không có dữ liệu trong khung giờ này
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
