import React from 'react';
import { useRevenueCustomers } from './RevenueCustomers.logic';
import { Loader2, Users, Star, UserPlus, Globe } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const PIE_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white shadow-xl rounded-xl border border-gray-100 px-4 py-3 text-sm">
            <p className="font-bold text-gray-700 mb-1">{label}</p>
            {payload.map((p: any, i: number) => (
                <p key={i} className="text-gray-500">
                    <span className="font-bold" style={{ color: p.color }}>{p.name}: </span>
                    {typeof p.value === 'number' ? p.value.toLocaleString('vi-VN') : p.value}
                </p>
            ))}
        </div>
    );
};

export default function RevenueCustomers({ dateFrom, dateTo, langFilter }: { dateFrom: string, dateTo: string, langFilter: string }) {
    const { newCustomers, topCustomers, languageBreakdown, isLoading, error } = useRevenueCustomers(dateFrom, dateTo, langFilter);

    const formatMoney = (val: number) => new Intl.NumberFormat('vi-VN').format(val || 0) + 'đ';

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-gray-100 backdrop-blur-sm">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                <p className="text-gray-500 font-medium">Đang phân tích dữ liệu Khách hàng...</p>
            </div>
        );
    }

    if (error) {
        return <div className="p-4 bg-red-50 text-red-600 rounded-xl">{error}</div>;
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 1. Ngôn ngữ khách hàng */}
                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm col-span-1">
                    <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <Globe size={18} className="text-indigo-500" />
                        Quốc Tịch / Ngôn Ngữ
                    </h3>
                    {languageBreakdown.length > 0 ? (
                        <>
                            <div className="h-52 w-full mb-4">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={languageBreakdown}
                                            cx="50%" cy="50%"
                                            innerRadius={55} outerRadius={90}
                                            paddingAngle={3}
                                            dataKey="orders"
                                            nameKey="lang"
                                        >
                                            {languageBreakdown.map((_, idx) => (
                                                <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<ChartTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="space-y-2">
                                {languageBreakdown.map((lb, idx) => {
                                    const totalOrders = languageBreakdown.reduce((s, l) => s + l.orders, 0);
                                    const pct = totalOrders > 0 ? Math.round((lb.orders / totalOrders) * 100) : 0;
                                    return (
                                        <div key={idx} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-2">
                                                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                                                <span className="text-gray-700 font-medium">{lb.lang}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-bold text-indigo-600">{pct}%</span>
                                                <span className="text-xs text-gray-500 w-16 text-right">{formatMoney(lb.revenue)}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <div className="h-52 flex items-center justify-center text-gray-400 text-sm">Chưa có dữ liệu</div>
                    )}
                </div>

                {/* 2. Top Khách Hàng (VIP) */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm col-span-2 flex flex-col h-[400px]">
                    <div className="p-4 border-b border-gray-100">
                        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                            <Star size={18} className="text-amber-500 fill-amber-500" />
                            Top Khách Hàng Chi Tiêu Cao (VIP)
                        </h3>
                    </div>
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 sticky top-0 border-b border-gray-100">
                                <tr>
                                    <th className="px-4 py-3 font-semibold text-gray-600 w-12">#</th>
                                    <th className="px-4 py-3 font-semibold text-gray-600">Tên Khách Hàng</th>
                                    <th className="px-4 py-3 font-semibold text-gray-600">SĐT</th>
                                    <th className="px-4 py-3 font-semibold text-gray-600 text-center">Số lượng Đơn</th>
                                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Tổng Chi Tiêu</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {topCustomers.map((cus, idx) => (
                                    <tr key={cus.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3 text-gray-500 font-medium">{idx + 1}</td>
                                        <td className="px-4 py-3 font-bold text-gray-800">{cus.name}</td>
                                        <td className="px-4 py-3 text-gray-500">{cus.phone || '-'}</td>
                                        <td className="px-4 py-3 text-center font-medium text-indigo-600">{cus.orders}</td>
                                        <td className="px-4 py-3 text-right font-bold text-emerald-600">{formatMoney(cus.revenue)}</td>
                                    </tr>
                                ))}
                                {topCustomers.length === 0 && (
                                    <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Chưa có dữ liệu</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* 3. Danh sách khách mới */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col h-[400px]">
                <div className="p-4 border-b border-gray-100">
                    <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                        <UserPlus size={18} className="text-emerald-500" />
                        Khách Hàng Mới Trong Kỳ ({newCustomers.length})
                    </h3>
                </div>
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 sticky top-0 border-b border-gray-100">
                            <tr>
                                <th className="px-4 py-3 font-semibold text-gray-600">Ngày Đăng Ký</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Tên Khách Hàng</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Số Điện Thoại</th>
                                <th className="px-4 py-3 font-semibold text-gray-600">Email</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {newCustomers.map(cus => {
                                const dateStr = cus.createdAt ? new Date(cus.createdAt).toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
                                return (
                                    <tr key={cus.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateStr}</td>
                                        <td className="px-4 py-3 font-bold text-gray-800">{cus.name}</td>
                                        <td className="px-4 py-3 text-gray-600 font-mono">{cus.phone || '-'}</td>
                                        <td className="px-4 py-3 text-gray-500 truncate max-w-[200px]">{cus.email || '-'}</td>
                                    </tr>
                                );
                            })}
                            {newCustomers.length === 0 && (
                                <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-500">Chưa có khách hàng mới nào đăng ký trong thời gian này.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
