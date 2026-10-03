import React, { useMemo } from 'react';
import { useRevenueRawData, RawDataRow } from './RevenueRawData.logic';
import { Loader2, Download, Table2 } from 'lucide-react';

interface RevenueRawDataProps {
    dateFrom: string;
    dateTo: string;
    langFilter: string;
}

export default function RevenueRawData({ dateFrom, dateTo, langFilter }: RevenueRawDataProps) {
    const { data, isLoading, error } = useRevenueRawData(dateFrom, dateTo, langFilter);

    // Gom nhóm các dòng theo Bill ID để tính Tổng Bill và hiển thị đẹp
    const groupedData = useMemo(() => {
        const groups: Record<string, RawDataRow[]> = {};
        data.forEach(row => {
            if (!groups[row.id]) groups[row.id] = [];
            groups[row.id].push(row);
        });
        return groups;
    }, [data]);

    const formatMoney = (val: number) => {
        if (!val) return '0';
        return new Intl.NumberFormat('vi-VN').format(val);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl border border-gray-100 shadow-sm">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
                <p className="text-sm text-gray-500">Đang trích xuất Sổ Giao Dịch...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 bg-red-50 text-red-600 rounded-2xl border border-red-100">
                Lỗi tải dữ liệu: {error}
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[calc(100vh-200px)]">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                        <Table2 size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-800">Sổ Nhật Ký Giao Dịch (Raw Data)</h3>
                        <p className="text-xs text-gray-500">
                            Hiển thị chi tiết {data.length} dòng dịch vụ từ {Object.keys(groupedData).length} hóa đơn.
                        </p>
                    </div>
                </div>
                <button className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-xl border border-gray-200 transition-colors">
                    <Download size={16} />
                    Tải Excel
                </button>
            </div>

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
                                <th className="p-2 border-r border-cyan-600 w-16">GIỜ LÊN</th>
                                <th className="p-2 border-r border-cyan-600 w-16">GIỜ XUỐNG</th>
                                <th className="p-2 border-r border-cyan-600 w-24">TỔNG TIỀN</th>
                                <th className="p-2 border-r border-cyan-600 w-24">TỔNG BILL</th>
                                <th className="p-2 w-16">TRẠNG THÁI</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(groupedData).map(([billId, items], gIndex) => {
                                // Tính tổng bill
                                const totalBill = items.reduce((sum, item) => sum + item.revenue, 0);
                                // Màu nền xen kẽ theo Bill (Xanh lá sáng và Xanh lá nhạt/Trắng)
                                const isOddGroup = gIndex % 2 === 0;
                                
                                return items.map((item, iIndex) => {
                                    const isFirst = iIndex === 0;
                                    const isLast = iIndex === items.length - 1;
                                    // Row color logic matching user's excel
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
                                            <td className="p-1 border-r border-gray-300">{item.startTime || '-'}</td>
                                            <td className="p-1 border-r border-gray-300">{item.endTime || '-'}</td>
                                            <td className="p-1 border-r border-gray-300 font-semibold text-blue-700 bg-cyan-50">
                                                {formatMoney(item.revenue)}
                                            </td>
                                            {isFirst ? (
                                                <td className="p-1 border-r border-gray-300 font-bold text-red-600 bg-red-50" rowSpan={items.length}>
                                                    {formatMoney(totalBill)}
                                                </td>
                                            ) : null}
                                            {isFirst ? (
                                                <td className="p-1 font-bold text-xs" rowSpan={items.length}>
                                                    {item.statusText === 'TRUE' ? (
                                                        <span className="text-emerald-700">TRUE</span>
                                                    ) : (
                                                        <span className="text-red-600">FALSE</span>
                                                    )}
                                                </td>
                                            ) : null}
                                        </tr>
                                    );
                                });
                            })}
                            {data.length === 0 && (
                                <tr>
                                    <td colSpan={11} className="p-8 text-center text-gray-500 bg-white">
                                        Không có giao dịch nào trong khoảng thời gian này.
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
