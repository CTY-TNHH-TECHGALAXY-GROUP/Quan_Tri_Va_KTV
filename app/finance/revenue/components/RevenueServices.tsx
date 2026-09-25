import React, { useState } from 'react';
import { useRevenueServices } from './RevenueServices.logic';
import { Loader2, Package, Search, AlertTriangle, BarChart2, CheckCircle2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const PIE_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export default function RevenueServices({ dateFrom, dateTo, langFilter }: { dateFrom: string, dateTo: string, langFilter: string }) {
    const { breakdown, menuEvaluation, durationPopularity, isLoading, error } = useRevenueServices(dateFrom, dateTo, langFilter);
    const [searchMenu, setSearchMenu] = useState('');
    const [filterMenu, setFilterMenu] = useState<'all' | 'zero' | 'low'>('all'); // low = <= 3 orders

    const formatMoney = (val: number) => new Intl.NumberFormat('vi-VN').format(val || 0) + 'đ';

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-gray-100 backdrop-blur-sm">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                <p className="text-gray-500 font-medium">Đang trích xuất dữ liệu Dịch vụ...</p>
            </div>
        );
    }

    if (error) {
        return <div className="p-4 bg-red-50 text-red-600 rounded-xl">{error}</div>;
    }

    const filteredMenu = menuEvaluation.filter(item => {
        const matchSearch = item.name.toLowerCase().includes(searchMenu.toLowerCase()) || item.code.toLowerCase().includes(searchMenu.toLowerCase());
        const matchFilter = filterMenu === 'all' ? true : filterMenu === 'zero' ? item.orders === 0 : item.orders > 0 && item.orders <= 3;
        return matchSearch && matchFilter;
    });

    return (
        <div className="space-y-6">
            {/* ─── ROW 1: TỔNG QUAN & DURATION POPULARITY ───────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 1. Dịch vụ bán chạy (Top 10) */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                    <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <Package size={18} className="text-blue-500" />
                        Top 10 Dịch Vụ Bán Chạy Nhất
                    </h3>
                    <div className="flex-1 overflow-auto pr-2 space-y-3">
                        {breakdown.slice(0, 10).map((svc, idx) => {
                            const maxCount = breakdown[0]?.count || 1;
                            const pct = Math.round((svc.count / maxCount) * 100);
                            return (
                                <div key={`${svc.name}-${idx}`} className="flex flex-col gap-1.5">
                                    <div className="flex justify-between text-sm items-end">
                                        <span className="font-semibold text-gray-800 line-clamp-1 flex-1 pr-4">{idx + 1}. {svc.name}</span>
                                        <span className="font-bold text-indigo-600 whitespace-nowrap">{svc.count} lượt</span>
                                    </div>
                                    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                                    </div>
                                    <div className="text-[11px] text-gray-400 flex justify-between">
                                        <span>Doanh thu: {formatMoney(svc.revenue)}</span>
                                        <span>~ {formatMoney(Math.round(svc.revenue / svc.count))} / lượt</span>
                                    </div>
                                </div>
                            );
                        })}
                        {breakdown.length === 0 && <p className="text-center text-gray-400 py-10">Chưa có dữ liệu</p>}
                    </div>
                </div>

                {/* 2. So sánh lựa chọn thời lượng (Duration Popularity) */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                    <h3 className="text-base font-bold text-gray-900 mb-1 flex items-center gap-2">
                        <BarChart2 size={18} className="text-orange-500" />
                        So Sánh Lựa Chọn Thời Lượng
                    </h3>
                    <p className="text-xs text-gray-500 mb-4">Các dịch vụ có nhiều mức thời gian (60p, 90p, 120p...), mức nào được khách chọn nhiều nhất?</p>
                    
                    <div className="flex-1 overflow-auto pr-2 space-y-5">
                        {durationPopularity.map((group, gIdx) => (
                            <div key={gIdx} className="bg-orange-50/50 p-4 rounded-xl border border-orange-100/50">
                                <h4 className="font-bold text-gray-800 mb-3">{group.baseName} <span className="text-xs font-normal text-gray-500">({group.totalOrders} lượt)</span></h4>
                                <div className="space-y-2">
                                    {group.items.map((item, iIdx) => {
                                        const pct = Math.round((item.orders / group.totalOrders) * 100);
                                        return (
                                            <div key={iIdx} className="flex items-center gap-3">
                                                <div className="w-12 text-xs font-bold text-gray-600 text-right">{item.duration}'</div>
                                                <div className="flex-1 h-5 bg-white border border-gray-200 rounded-md overflow-hidden flex relative">
                                                    <div className="h-full bg-orange-400/80 transition-all" style={{ width: `${pct}%` }} />
                                                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-800 mix-blend-darken">
                                                        {pct}% ({item.orders} lượt)
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        {durationPopularity.length === 0 && <p className="text-center text-gray-400 py-10">Chưa có đủ dữ liệu để so sánh.</p>}
                    </div>
                </div>
            </div>

            {/* ─── ROW 2: MENU EVALUATION (DỊCH VỤ "CHẾT" / ÍT LƯỢT BÁN) ─────── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col h-[500px]">
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                            <AlertTriangle size={18} className="text-rose-500" />
                            Đánh Giá Menu Dịch Vụ
                        </h3>
                        <p className="text-xs text-gray-500">Tìm ra các dịch vụ không bán được hoặc bán quá chậm.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input 
                                type="text" placeholder="Tìm tên/mã DV..." 
                                value={searchMenu} onChange={e => setSearchMenu(e.target.value)}
                                className="pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm w-48 focus:ring-2 focus:ring-indigo-300 outline-none"
                            />
                        </div>
                        <select 
                            value={filterMenu} onChange={e => setFilterMenu(e.target.value as any)}
                            className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-300 outline-none"
                        >
                            <option value="all">Tất cả Menu ({menuEvaluation.length})</option>
                            <option value="zero">Không bán được đơn nào</option>
                            <option value="low">Bán rất chậm (≤ 3 đơn)</option>
                        </select>
                    </div>
                </div>
                
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3 font-semibold text-gray-600">Mã DV</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Tên Dịch Vụ</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Nhóm</th>
                                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Thời lượng</th>
                                <th className="px-4 py-3 font-semibold text-gray-600 text-center">Lượt Bán</th>
                                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Doanh Thu</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredMenu.map(item => (
                                <tr key={item.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{item.code}</td>
                                    <td className="px-4 py-3 font-medium text-gray-800">{item.name}</td>
                                    <td className="px-4 py-3 text-xs text-gray-500">
                                        <span className="px-2 py-1 bg-gray-100 rounded-md">{item.category}</span>
                                    </td>
                                    <td className="px-4 py-3 text-gray-600 text-right">{item.duration}p</td>
                                    <td className="px-4 py-3 text-center">
                                        {item.orders === 0 ? (
                                            <span className="px-2.5 py-1 bg-rose-100 text-rose-700 text-xs font-bold rounded-full">0 lượt</span>
                                        ) : item.orders <= 3 ? (
                                            <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">{item.orders} lượt</span>
                                        ) : (
                                            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">{item.orders} lượt</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 font-semibold text-indigo-600 text-right">{formatMoney(item.revenue)}</td>
                                </tr>
                            ))}
                            {filteredMenu.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                                        Không tìm thấy dịch vụ nào phù hợp với bộ lọc.
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
