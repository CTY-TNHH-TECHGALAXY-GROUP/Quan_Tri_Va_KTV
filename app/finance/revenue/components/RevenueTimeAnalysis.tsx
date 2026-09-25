import React, { useState } from 'react';
import { useRevenueTimeAnalysis } from './RevenueTimeAnalysis.logic';
import { Loader2, Clock, CalendarDays, Timer } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import RevenueHourlyDetails from './RevenueHourlyDetails';

const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white shadow-xl rounded-xl border border-gray-100 px-4 py-3 text-sm">
            <p className="font-bold text-gray-700 mb-2 border-b border-gray-100 pb-2">{label}</p>
            {payload.map((p: any, i: number) => (
                <p key={i} className="text-gray-600 flex justify-between gap-4 py-1">
                    <span className="font-medium" style={{ color: p.color }}>{p.name}:</span>
                    <span className="font-bold">
                        {p.name.includes('Doanh thu') 
                            ? new Intl.NumberFormat('vi-VN').format(p.value) + 'đ'
                            : p.value.toLocaleString('vi-VN')}
                    </span>
                </p>
            ))}
        </div>
    );
};

export default function RevenueTimeAnalysis({ dateFrom, dateTo, langFilter }: { dateFrom: string, dateTo: string, langFilter: string }) {
    const [selectedHour, setSelectedHour] = useState<number | null>(null);
    const { timeBreakdown, weekdayBreakdown, ktvWorkingTime, isLoading, error } = useRevenueTimeAnalysis(dateFrom, dateTo, langFilter);

    const formatMoney = (val: number) => new Intl.NumberFormat('vi-VN').format(val || 0) + 'đ';

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-gray-100 backdrop-blur-sm">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                <p className="text-gray-500 font-medium">Đang phân tích thời gian và KTV...</p>
            </div>
        );
    }

    if (error) {
        return <div className="p-4 bg-red-50 text-red-600 rounded-xl">{error}</div>;
    }

    if (selectedHour !== null) {
        return (
            <RevenueHourlyDetails 
                dateFrom={dateFrom} 
                dateTo={dateTo} 
                langFilter={langFilter} 
                hour={selectedHour} 
                onBack={() => setSelectedHour(null)} 
            />
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 1. Biểu đồ theo Mốc giờ trong ngày */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                    <h3 className="text-base font-bold text-gray-900 mb-1 flex items-center gap-2">
                        <Clock size={18} className="text-blue-500" />
                        Phân Bổ Lượng Khách Theo Giờ
                    </h3>
                    <p className="text-xs text-gray-500 mb-6">Biết được khung giờ nào đông nhất để tối ưu nhân sự.</p>
                    
                    {timeBreakdown.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={timeBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                    <XAxis 
                                        dataKey="timeRange" 
                                        axisLine={false} tickLine={false} 
                                        tick={{ fill: '#9ca3af', fontSize: 11 }} 
                                    />
                                    <YAxis 
                                        yAxisId="left"
                                        axisLine={false} tickLine={false} 
                                        tick={{ fill: '#9ca3af', fontSize: 11 }} 
                                    />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Bar 
                                        yAxisId="left" 
                                        dataKey="orders" 
                                        name="Số lượng Đơn" 
                                        fill="#60a5fa" 
                                        radius={[4, 4, 0, 0]} 
                                        maxBarSize={40}
                                        cursor="pointer"
                                        onClick={(data: any) => {
                                            const timeRange = data?.timeRange || data?.payload?.timeRange;
                                            if (timeRange) {
                                                const h = parseInt(timeRange.split(':')[0], 10);
                                                if (!isNaN(h)) setSelectedHour(h);
                                            }
                                        }}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Chưa có dữ liệu theo giờ</div>
                    )}
                </div>

                {/* 2. Biểu đồ theo Ngày trong tuần */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                    <h3 className="text-base font-bold text-gray-900 mb-1 flex items-center gap-2">
                        <CalendarDays size={18} className="text-purple-500" />
                        Lưu Lượng Khách Theo Thứ Trong Tuần
                    </h3>
                    <p className="text-xs text-gray-500 mb-6">Ngày nào trong tuần thường đông khách nhất?</p>

                    {weekdayBreakdown.length > 0 ? (
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={weekdayBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                    <XAxis 
                                        dataKey="weekday" 
                                        axisLine={false} tickLine={false} 
                                        tick={{ fill: '#9ca3af', fontSize: 11 }} 
                                    />
                                    <YAxis 
                                        yAxisId="left"
                                        axisLine={false} tickLine={false} 
                                        tick={{ fill: '#9ca3af', fontSize: 11 }} 
                                    />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Line yAxisId="left" type="monotone" dataKey="orders" name="Lượt Khách" stroke="#a855f7" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Chưa có dữ liệu theo thứ</div>
                    )}
                </div>
            </div>

            {/* 3. Bảng Thời Gian Làm Việc Của KTV */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col h-[500px]">
                <div className="p-4 border-b border-gray-100">
                    <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                        <Timer size={18} className="text-emerald-500" />
                        Bảng Thời Gian & Năng Suất KTV
                    </h3>
                    <p className="text-xs text-gray-500">Thống kê tổng thời gian phục vụ khách của từng KTV trong kỳ.</p>
                </div>
                
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3 font-semibold text-gray-600 w-16">Mã</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Tên KTV</th>
                                <th className="px-4 py-3 font-semibold text-gray-600 text-center">Số Tua / DV</th>
                                <th className="px-4 py-3 font-semibold text-gray-600 text-center">Tổng Phút Làm Việc</th>
                                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Doanh Thu Mang Về</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {ktvWorkingTime.map(ktv => (
                                <tr key={ktv.ktvId} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{ktv.ktvCode}</td>
                                    <td className="px-4 py-3 font-bold text-gray-800">{ktv.ktvName}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 font-bold rounded-full text-xs">
                                            {ktv.totalServices} Tua
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="font-bold text-emerald-600">{ktv.totalWorkingMinutes}p</span>
                                        <span className="text-xs text-gray-400 ml-1">
                                            ({Math.floor(ktv.totalWorkingMinutes / 60)}h {ktv.totalWorkingMinutes % 60}p)
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-semibold text-gray-700 text-right">
                                        {formatMoney(ktv.totalRevenueContribution)}
                                    </td>
                                </tr>
                            ))}
                            {ktvWorkingTime.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                                        Chưa có dữ liệu KTV làm việc trong kỳ báo cáo này.
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
