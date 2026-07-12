'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import {
    ShieldAlert, TrendingUp, TrendingDown, DollarSign, Users, Calendar,
    Star, Activity, ChevronRight, Loader2, BarChart3, Award, Coins, Globe, X, Phone, Mail,
    Package, Receipt, Calculator, PieChart as PieChartIcon, Clock, Crown, Download, BedDouble, Gauge, HelpCircle,
    XCircle, Ban, UserCheck, FileSpreadsheet, Check, Table2, DoorOpen, Target
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line, Legend, ReferenceLine
} from 'recharts';
import { useRevenueReport, GroupBy } from './RevenueReport.logic';
import RevenueRawData from './components/RevenueRawData';
import RevenueServices from './components/RevenueServices';
import RevenueCustomers from './components/RevenueCustomers';
import RevenueTimeAnalysis from './components/RevenueTimeAnalysis';
import RevenueRoomsAnalysis from './components/RevenueRoomsAnalysis';
import { RevenueKTVRanking } from './components/RevenueKTVRanking';

// 🔧 UI CONFIGURATION
const PIE_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const DATE_PRESETS = [
    { key: 'today', label: 'Hôm nay' },
    { key: 'yesterday', label: 'Hôm qua' },
    { key: 'week', label: 'Tuần này' },
    { key: 'month', label: 'Tháng này' },
    { key: 'year', label: 'Năm này' },
    { key: 'custom', label: 'Tuỳ chọn' },
] as const;

const GROUP_BY_OPTIONS: { key: GroupBy; label: string }[] = [
    { key: 'hour', label: 'Giờ' },
    { key: 'day', label: 'Ngày' },
    { key: 'week', label: 'Tuần' },
    { key: 'month', label: 'Tháng' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${i}:00` }));

const THRESHOLDS = [
    { label: 'Không dùng', value: null },
    { label: '5 Triệu', value: 5000000 },
    { label: '10 Triệu', value: 10000000 },
    { label: '15 Triệu', value: 15000000 },
    { label: '20 Triệu', value: 20000000 },
    { label: '30 Triệu', value: 30000000 },
    { label: '50 Triệu', value: 50000000 },
];

const KTV_DISPLAY_LIMIT = 3;
const SERVICE_DISPLAY_LIMIT = 3;

// ─── Filter Chip Bar ──────────────────────────────────────────────────────────
const FilterChipBar = ({ label, icon, options, selected, onSelect }: {
    label: string;
    icon: React.ReactNode;
    options: { key: string; label: string }[];
    selected: string;
    onSelect: (key: string) => void;
}) => (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <span className="text-xs text-gray-400 shrink-0 flex items-center gap-1">{icon}{label}</span>
        {options.map(o => (
            <button
                key={o.key}
                onClick={() => onSelect(o.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                    selected === o.key
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                }`}
            >
                {o.label}
            </button>
        ))}
    </div>
);

// ─── Help Tooltip (inline) ────────────────────────────────────────────────────
const HelpTooltip = ({ text }: { text: string }) => {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div ref={ref} className="relative inline-flex">
            <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
                className="w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors shrink-0"
                title="Giải thích"
            >
                <HelpCircle size={10} className="text-gray-400" />
            </button>
            {open && (
                <div className="absolute left-0 top-6 z-50 w-56 bg-gray-900 text-white text-[11px] leading-relaxed rounded-xl px-3 py-2.5 shadow-xl border border-gray-700 whitespace-normal">
                    <div className="absolute -top-1.5 left-2 w-3 h-3 bg-gray-900 rotate-45 border-l border-t border-gray-700" />
                    {text}
                </div>
            )}
        </div>
    );
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────
const KPICard = ({ title, value, subtitle, change, icon, color, href, onClick, helpText }: {
    title: string;
    value: string;
    subtitle?: string;
    change?: number;
    icon: React.ReactNode;
    color: string;
    href?: string;
    onClick?: () => void;
    helpText?: string;
}) => {
    const isPositive = (change || 0) >= 0;
    const isClickable = !!(href || onClick);
    const handleClick = (e: React.MouseEvent) => {
        if (onClick) { e.preventDefault(); onClick(); }
    };
    const Wrapper = href ? 'a' : 'div';
    return (
        <Wrapper href={href || undefined} onClick={isClickable ? handleClick : undefined} className={`bg-white p-5 rounded-2xl border border-gray-100 shadow-sm block ${isClickable ? 'cursor-pointer active:scale-[0.98] transition-transform hover:shadow-md' : ''}`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-medium text-gray-500">{title}</h3>
                    {helpText && <HelpTooltip text={helpText} />}
                </div>
                <div className="flex items-center gap-1.5">
                    {isClickable && <ChevronRight size={14} className="text-gray-300" />}
                    <div className={`p-2 ${color} rounded-xl`}>
                        {icon}
                    </div>
                </div>
            </div>
            <div className="text-3xl font-black text-gray-900 tracking-tight">{value}</div>
            {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
            {change !== undefined && change !== 0 && (
                <p className={`text-xs font-bold mt-2 flex items-center gap-1 ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {isPositive ? '+' : ''}{change}%
                </p>
            )}
        </Wrapper>
    );
};

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RevenueReportsPage() {
    const { hasPermission } = useAuth();
    const [mounted, setMounted] = React.useState(false);
    const report = useRevenueReport();
    const [activeTab, setActiveTab] = React.useState<'overview' | 'services' | 'customers' | 'time' | 'raw_data' | 'rooms' | 'ktv_ranking'>('overview');
    
    const [showNewCustomers, setShowNewCustomers] = React.useState(false);
    const [showAllKTV, setShowAllKTV] = React.useState(false);
    const [showAllServices, setShowAllServices] = React.useState(false);
    const [showMetricsHelp, setShowMetricsHelp] = React.useState(false);
    const [showExportModal, setShowExportModal] = React.useState(false);
    const [exportSections, setExportSections] = React.useState<Record<string, boolean>>({
        kpi: true, services: true, languages: true, ktv: true, peakHours: true, revenue: true,
    });
    const [exportFrom, setExportFrom] = React.useState('');
    const [exportTo, setExportTo] = React.useState('');

    React.useEffect(() => { setMounted(true); }, []);
    if (!mounted) return null;

    if (!hasPermission('revenue_reports')) {
        return (
            <AppLayout title="Báo Cáo">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
                </div>
            </AppLayout>
        );
    }

    const { summary } = report.data;
    const formatDate = (d: string) => {
        const parts = d.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
    };

    // Get chart data based on groupBy
    const getRevenueChartData = () => {
        switch (report.groupBy) {
            case 'hour':
                return report.data.hourlyRevenue.map(h => ({
                    label: h.label,
                    revenue: h.revenue,
                    revenueK: Math.round(h.revenue / 1000),
                    orders: h.orders,
                }));
            case 'week':
                return report.data.weeklyRevenue.map(w => ({
                    label: formatDate(w.week),
                    revenue: w.revenue,
                    revenueK: Math.round(w.revenue / 1000),
                    orders: w.orders,
                }));
            case 'month':
                return report.data.monthlyRevenue.map(m => ({
                    label: m.month.substring(5), // MM from YYYY-MM
                    revenue: m.revenue,
                    revenueK: Math.round(m.revenue / 1000),
                    orders: m.orders,
                }));
            default: // day
                return report.data.dailyRevenue.map(d => ({
                    label: formatDate(d.date),
                    revenue: d.revenue,
                    revenueK: Math.round(d.revenue / 1000),
                    orders: d.orders,
                }));
        }
    };

    const revenueChartData = getRevenueChartData();
    const chartTitle = { hour: 'Doanh Thu Theo Giờ', day: 'Doanh Thu Theo Ngày', week: 'Doanh Thu Theo Tuần', month: 'Doanh Thu Theo Tháng' }[report.groupBy];

    // Find KTV with highest tip
    const topTipKTV = report.data.topKTV.length > 0
        ? report.data.topKTV.reduce((max, k) => k.totalTip > max.totalTip ? k : max, report.data.topKTV[0])
        : null;

    const displayedKTV = showAllKTV ? report.data.topKTV : report.data.topKTV.slice(0, KTV_DISPLAY_LIMIT);

    return (
        <AppLayout title="Báo Cáo">
            <div className="space-y-6 max-w-[1600px] mx-auto">
                {/* ─── Header ─────────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight">Báo Cáo Doanh Thu</h1>
                        <p className="text-sm text-gray-500">Tổng quan tình hình kinh doanh của Spa.</p>
                    </div>
                </div>

                {/* ─── Date Picker ────────────────────────────────────── */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 space-y-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Calendar size={14} className="text-gray-400 shrink-0" />
                        {DATE_PRESETS.map(b => (
                            <button
                                key={b.key}
                                onClick={() => report.setDatePreset(b.key)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                    report.datePreset === b.key
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                                }`}
                            >
                                {b.label}
                            </button>
                        ))}
                        {/* Excel + ? buttons */}
                        {!report.isLoading && report.data.summary.orders > 0 && (
                            <>
                                <div className="w-px h-5 bg-gray-200 mx-0.5" />
                                <button
                                    onClick={() => { setExportFrom(report.dateFrom); setExportTo(report.dateTo); setShowExportModal(true); }}
                                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-all active:scale-95 flex items-center gap-1.5"
                                >
                                    <FileSpreadsheet size={12} />
                                    Excel
                                </button>
                                <button
                                    onClick={() => setShowMetricsHelp(true)}
                                    className="w-7 h-7 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-400 transition-all active:scale-95"
                                    title="Giải thích thông số"
                                >
                                    <HelpCircle size={14} />
                                </button>
                            </>
                        )}
                    </div>
                    {report.datePreset === 'custom' && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <input
                                type="date" value={report.dateFrom}
                                onChange={e => report.setDateFrom(e.target.value)}
                                className="border border-gray-200 rounded-xl px-2.5 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 flex-1 min-w-[120px]"
                            />
                            <ChevronRight size={14} className="text-gray-300 shrink-0" />
                            <input
                                type="date" value={report.dateTo}
                                onChange={e => report.setDateTo(e.target.value)}
                                className="border border-gray-200 rounded-xl px-2.5 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 flex-1 min-w-[120px]"
                            />
                            <button
                                onClick={report.applyCustomDate}
                                className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold active:scale-95 transition-all"
                            >
                                Xem
                            </button>
                        </div>
                    )}
                </div>

                {/* ─── Tabs Navigation ────────────────────────────────────────── */}
                <div className="flex items-center gap-1 border-b border-gray-200 pb-px overflow-x-auto scrollbar-hide mb-4">
                    {[
                        { id: 'overview', label: 'Tổng Quan', icon: <PieChartIcon size={16} /> },
                        { id: 'services', label: 'Dịch Vụ', icon: <Package size={16} /> },
                        { id: 'time', label: 'Thời Gian', icon: <Clock size={16} /> },
                        { id: 'customers', label: 'Khách Hàng', icon: <Users size={16} /> },
                        { id: 'raw_data', label: 'Sổ Giao Dịch', icon: <Table2 size={16} /> },
                        { id: 'rooms', label: 'Phòng', icon: <DoorOpen size={16} /> },
                        { id: 'ktv_ranking', label: 'Nhân Viên', icon: <Award size={16} /> },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                activeTab === tab.id
                                    ? 'border-indigo-600 text-indigo-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* ─── TAB: PHÒNG (HẬU CẦN) ─────────────────────────────────────── */}
                {activeTab === 'rooms' && (
                    <RevenueRoomsAnalysis 
                        dateFrom={report.dateFrom} 
                        dateTo={report.dateTo} 
                        langFilter={report.filterLang} 
                    />
                )}

                {/* ─── TAB: KTV RANKING ─────────────────────────────────────────── */}
                {activeTab === 'ktv_ranking' && (
                    <RevenueKTVRanking 
                        dateFrom={report.dateFrom} 
                        dateTo={report.dateTo} 
                        langFilter={report.filterLang} 
                    />
                )}

                {/* ─── TAB: SỔ GIAO DỊCH ──────────────────────────────────────── */}
                {activeTab === 'raw_data' && (
                    <RevenueRawData 
                        dateFrom={report.dateFrom} 
                        dateTo={report.dateTo} 
                        langFilter={report.filterLang} 
                    />
                )}

                {/* ─── TAB: DỊCH VỤ ───────────────────────────────────────────── */}
                {activeTab === 'services' && (
                    <RevenueServices 
                        dateFrom={report.dateFrom} 
                        dateTo={report.dateTo} 
                        langFilter={report.filterLang} 
                    />
                )}

                {/* ─── TAB: KHÁCH HÀNG ────────────────────────────────────────── */}
                {activeTab === 'customers' && (
                    <RevenueCustomers 
                        dateFrom={report.dateFrom} 
                        dateTo={report.dateTo} 
                        langFilter={report.filterLang} 
                    />
                )}

                {/* ─── TAB: THỜI GIAN ─────────────────────────────────────────── */}
                {activeTab === 'time' && (
                    <RevenueTimeAnalysis 
                        dateFrom={report.dateFrom} 
                        dateTo={report.dateTo} 
                        langFilter={report.filterLang} 
                    />
                )}

                {/* ─── TAB: TỔNG QUAN ─────────────────────────────────────────── */}
                {activeTab === 'overview' && (
                    <>
                        {/* ─── Loading ────────────────────────────────────────── */}
                        {report.isLoading && (
                            <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-3xl border border-gray-100 backdrop-blur-sm">
                                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                                <p className="text-gray-500 font-medium">Đang tổng hợp dữ liệu...</p>
                            </div>
                        )}

                        {!report.isLoading && (
                            <>
                                {/* ─── Filter Chips ───────────────────────── */}
                                {report.data.languageBreakdown.length > 0 && (
                                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 space-y-2">
                                        <FilterChipBar
                                            label="Ngôn ngữ"
                                            icon={<Globe size={12} />}
                                            options={[
                                                { key: 'all', label: 'Tất cả' },
                                                ...report.data.languageBreakdown.map(lb => ({
                                                    key: lb.key || lb.lang,
                                                    label: lb.lang,
                                                }))
                                            ]}
                                            selected={report.filterLang}
                                            onSelect={report.applyLangFilter}
                                        />
                                    </div>
                                )}

                                {/* ─── Revenue Chart + Group By ─────────────────── */}
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                                        <h3 className="text-base font-bold text-gray-900">{chartTitle}</h3>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-2 bg-pink-50 border border-pink-100 px-2 py-1 rounded-lg">
                                                <Target size={14} className="text-pink-500" />
                                                <select
                                                    value={report.revenueThreshold || ''}
                                                    onChange={e => report.setRevenueThreshold(e.target.value ? Number(e.target.value) : null)}
                                                    className="bg-transparent text-xs font-bold text-pink-700 focus:outline-none cursor-pointer"
                                                >
                                                    {THRESHOLDS.map(t => (
                                                        <option key={t.label} value={t.value || ''}>{t.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {GROUP_BY_OPTIONS.map(o => (
                                                    <button
                                                        key={o.key}
                                                        onClick={() => report.applyGroupBy(o.key)}
                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                                            report.groupBy === o.key
                                                                ? 'bg-indigo-600 text-white'
                                                                : 'bg-gray-100 text-gray-500 active:bg-gray-200'
                                                        }`}
                                                    >
                                                        {o.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {(() => {
                                        const passedCount = report.revenueThreshold ? revenueChartData.filter(d => (d.revenue || 0) >= report.revenueThreshold!).length : 0;
                                        if (!report.revenueThreshold) return null;
                                        const timeUnit = report.groupBy === 'hour' ? 'giờ' : report.groupBy === 'day' ? 'ngày' : report.groupBy === 'week' ? 'tuần' : 'tháng';
                                        return (
                                            <div className="mb-4 bg-gradient-to-r from-pink-50 to-orange-50 text-pink-700 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 font-medium border border-pink-100 shadow-sm">
                                                <Award size={18} className="text-pink-500 flex-shrink-0" />
                                                <span>
                                                    Có <b className="text-lg mx-1">{passedCount} {timeUnit}</b> đạt mốc doanh thu trên <b>{report.revenueThreshold / 1000000} Triệu</b> trong chu kỳ này.
                                                </span>
                                            </div>
                                        );
                                    })()}
                                    {/* Hour range picker — only visible when groupBy = 'hour' */}
                                    {report.groupBy === 'hour' && (
                                        <div className="flex items-center gap-2 mb-4 flex-wrap">
                                            <Clock size={14} className="text-gray-400" />
                                            <span className="text-xs text-gray-500">Từ</span>
                                            <select
                                                value={report.hourFrom}
                                                onChange={e => report.applyHourFilter(Number(e.target.value), report.hourTo)}
                                                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                            >
                                                {HOUR_OPTIONS.map(h => (
                                                    <option key={h.value} value={h.value}>{h.label}</option>
                                                ))}
                                            </select>
                                            <span className="text-xs text-gray-500">đến</span>
                                            <select
                                                value={report.hourTo}
                                                onChange={e => report.applyHourFilter(report.hourFrom, Number(e.target.value))}
                                                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                            >
                                                {HOUR_OPTIONS.map(h => (
                                                    <option key={h.value} value={h.value}>{h.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    {revenueChartData.length > 0 ? (
                                        <div className="h-64 w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={revenueChartData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => `${v}K`} />
                                                    <Tooltip content={<ChartTooltip />} />
                                                    <Bar dataKey="revenueK" name="Doanh thu (K)" radius={[6, 6, 0, 0]}>
                                                        {revenueChartData.map((entry, index) => {
                                                            const isPassed = report.revenueThreshold && (entry.revenue || 0) >= report.revenueThreshold;
                                                            return (
                                                                <Cell 
                                                                    key={`cell-${index}`} 
                                                                    fill={report.revenueThreshold ? (isPassed ? '#4f46e5' : '#e5e7eb') : '#4f46e5'} 
                                                                />
                                                            );
                                                        })}
                                                    </Bar>
                                                    {report.revenueThreshold && (
                                                        <ReferenceLine 
                                                            y={report.revenueThreshold / 1000} 
                                                            stroke="#f43f5e" 
                                                            strokeDasharray="3 3" 
                                                            label={{ position: 'top', value: 'Mục tiêu', fill: '#f43f5e', fontSize: 11, fontWeight: 'bold' }} 
                                                        />
                                                    )}
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    ) : (
                                        <div className="h-64 flex items-center justify-center text-gray-300 text-sm">Chưa có dữ liệu</div>
                                    )}
                                </div>

                                {/* ─── Charts Row: Service + Language ──────────── */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Top Selling Services — Horizontal Bar */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                                            <Package size={16} className="text-blue-500" />
                                            Dịch Vụ Bán Chạy Nhất
                                        </h3>
                                        {(() => {
                                            const sortedServices = [...report.data.serviceBreakdown].sort((a, b) => b.count - a.count);
                                            const displayedServices = showAllServices ? sortedServices : sortedServices.slice(0, SERVICE_DISPLAY_LIMIT);
                                            const maxCount = sortedServices.length > 0 ? sortedServices[0].count : 1;
                                            return sortedServices.length > 0 ? (
                                                <>
                                                    <div className="space-y-2.5">
                                                        {displayedServices.map((svc, idx) => {
                                                            const pct = Math.round((svc.count / maxCount) * 100);
                                                            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
                                                            return (
                                                                <div key={`svc-${idx}`} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                                                    <div className="flex items-center justify-between mb-1.5">
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            {medal ? (
                                                                                <span className="text-base shrink-0">{medal}</span>
                                                                            ) : (
                                                                                <span className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-black text-gray-500 shrink-0">{idx + 1}</span>
                                                                            )}
                                                                            <span className="text-sm font-bold text-gray-800 truncate">{svc.name}</span>
                                                                        </div>
                                                                        <span className="text-xs font-bold text-indigo-600 whitespace-nowrap ml-2">{svc.count} lượt</span>
                                                                    </div>
                                                                    <div className="h-1.5 bg-gray-200 rounded-full mb-1.5">
                                                                        <div
                                                                            className="h-full rounded-full transition-all"
                                                                            style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                                                                        />
                                                                    </div>
                                                                    <div className="flex items-center justify-between text-[11px] text-gray-400">
                                                                        <span>Doanh thu: <span className="font-bold text-gray-600">{report.formatVND(svc.revenue)}</span></span>
                                                                        <span>TB/lượt: <span className="font-bold text-gray-600">{svc.count > 0 ? report.formatVND(Math.round(svc.revenue / svc.count)) : '—'}</span></span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {sortedServices.length > SERVICE_DISPLAY_LIMIT && (
                                                        <button
                                                            onClick={() => setShowAllServices(!showAllServices)}
                                                            className="w-full mt-3 py-2 text-xs font-bold text-blue-600 bg-blue-50 rounded-xl active:bg-blue-100 transition-all"
                                                        >
                                                            {showAllServices ? 'Thu gọn' : `Xem tất cả ${sortedServices.length} dịch vụ`}
                                                        </button>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="h-52 flex items-center justify-center text-gray-300 text-sm">Chưa có dữ liệu</div>
                                            );
                                        })()}
                                    </div>

                                    {/* Language Breakdown Donut */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                                            <Globe size={16} className="text-indigo-500" />
                                            Lượt Khách Theo Ngôn Ngữ
                                        </h3>
                                        {report.data.languageBreakdown.length > 0 ? (
                                            <>
                                                <div className="h-52 w-full">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <PieChart>
                                                            <Pie
                                                                data={report.data.languageBreakdown}
                                                                cx="50%" cy="50%"
                                                                innerRadius={55} outerRadius={90}
                                                                paddingAngle={3}
                                                                dataKey="orders"
                                                                nameKey="lang"
                                                            >
                                                                {report.data.languageBreakdown.map((_, idx) => (
                                                                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                                                ))}
                                                            </Pie>
                                                            <Tooltip content={<ChartTooltip />} />
                                                        </PieChart>
                                                    </ResponsiveContainer>
                                                </div>
                                                <div className="space-y-2 mt-2">
                                                    {report.data.languageBreakdown.map((lb, idx) => {
                                                        const totalOrders = report.data.languageBreakdown.reduce((s, l) => s + l.orders, 0);
                                                        const pct = totalOrders > 0 ? Math.round((lb.orders / totalOrders) * 100) : 0;
                                                        return (
                                                            <div key={idx} className="flex items-center justify-between text-sm">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                                                                    <span className="text-gray-700 font-medium">{lb.lang}</span>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-xs text-gray-400">{lb.orders} lượt khách</span>
                                                                    <span className="text-xs font-bold text-indigo-600">{pct}%</span>
                                                                    <span className="text-xs text-gray-500">{report.formatVND(lb.revenue)}</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="h-52 flex items-center justify-center text-gray-300 text-sm">Chưa có dữ liệu</div>
                                        )}
                                    </div>
                                </div>

                                {/* ─── KTV Section (#8 #9 #10) ──────────────────── */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Top KTV */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <h3 className="text-base font-bold text-gray-900 mb-4">Bảng Xếp Hạng KTV</h3>
                                        {report.data.topKTV.length > 0 ? (
                                            <>
                                                <div className="space-y-2.5">
                                                    {displayedKTV.map((ktv, idx) => {
                                                        const maxRevenue = report.data.topKTV[0]?.revenue || 1;
                                                        const pct = Math.round((ktv.revenue / maxRevenue) * 100);
                                                        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
                                                        const isTopTip = topTipKTV && ktv.code === topTipKTV.code && ktv.totalTip > 0;
                                                        return (
                                                            <div key={ktv.code} className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
                                                                {/* Row 1: Name + Orders + Rating */}
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <div className="flex items-center gap-2">
                                                                        {medal ? (
                                                                            <span className="text-base">{medal}</span>
                                                                        ) : (
                                                                            <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-black text-gray-500">{idx + 1}</span>
                                                                        )}
                                                                        <span className="text-sm font-bold text-gray-800">{ktv.name}</span>
                                                                        {isTopTip && (
                                                                            <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[9px] font-black flex items-center gap-0.5">
                                                                                <Crown size={9} /> Top Tip
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        {ktv.avgRating > 0 && (
                                                                            <span className="px-1.5 py-0.5 rounded-md bg-yellow-50 text-yellow-700 text-[10px] font-bold">
                                                                                {ktv.avgRating} ★ <span className="text-gray-400 font-normal">({ktv.ratingCount})</span>
                                                                            </span>
                                                                        )}
                                                                        <span className="text-[11px] text-gray-400 font-medium">{ktv.orders} đơn</span>
                                                                    </div>
                                                                </div>
                                                                {/* Progress bar */}
                                                                <div className="h-1.5 bg-gray-200 rounded-full mb-2.5">
                                                                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                                                </div>
                                                                {/* Row 2: Revenue + Commission + Tip */}
                                                                <div className="flex items-center justify-between text-xs flex-wrap gap-1">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <DollarSign size={12} className="text-emerald-500" />
                                                                        <span className="text-gray-500">DT:</span>
                                                                        <span className="font-bold text-indigo-600">{report.formatVND(ktv.revenue)}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Coins size={12} className="text-cyan-500" />
                                                                        <span className="text-gray-500">Tua:</span>
                                                                        <span className="font-bold text-cyan-600">{report.formatVND(ktv.commission || 0)}</span>
                                                                    </div>
                                                                    {ktv.totalTip > 0 && (
                                                                        <div className="flex items-center gap-1.5">
                                                                            <Award size={12} className="text-pink-500" />
                                                                            <span className="text-gray-500">Tip:</span>
                                                                            <span className="font-bold text-pink-600">{report.formatVND(ktv.totalTip)}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {/* Show all / Show less */}
                                                {report.data.topKTV.length > KTV_DISPLAY_LIMIT && (
                                                    <button
                                                        onClick={() => setShowAllKTV(!showAllKTV)}
                                                        className="w-full mt-3 py-2 text-xs font-bold text-indigo-600 bg-indigo-50 rounded-xl active:bg-indigo-100 transition-all"
                                                    >
                                                        {showAllKTV ? 'Thu gọn' : `Xem tất cả ${report.data.topKTV.length} KTV`}
                                                    </button>
                                                )}
                                                {/* Tổng Tiền Tua */}
                                                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Coins size={16} className="text-cyan-600" />
                                                        <span className="text-sm font-bold text-gray-700">Tổng Tiền Tua</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-lg font-black text-cyan-600">
                                                            {report.formatVND(summary.totalCommission)}
                                                        </span>
                                                        {summary.totalCommission > 0 && (
                                                            <p className="text-[10px] text-gray-400">{report.formatFullVND(summary.totalCommission)}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="h-48 flex items-center justify-center text-gray-300 text-sm">Chưa có dữ liệu</div>
                                        )}
                                    </div>

                                    {/* Peak Hours */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <h3 className="text-base font-bold text-gray-900 mb-4">Khung Giờ Cao Điểm</h3>
                                        {report.data.peakHours.length > 0 ? (
                                            <div className="h-52 w-full">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={report.data.peakHours}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                                        <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                                        <Tooltip content={<ChartTooltip />} />
                                                        <Line
                                                            type="monotone" dataKey="count" name="Số đơn"
                                                            stroke="#10b981" strokeWidth={2.5}
                                                            dot={{ r: 3, fill: '#10b981' }}
                                                            activeDot={{ r: 5, stroke: '#10b981' }}
                                                        />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        ) : (
                                            <div className="h-52 flex items-center justify-center text-gray-300 text-sm">Chưa có dữ liệu</div>
                                        )}
                                    </div>
                                </div>

                                {/* ─── KPI Cards (10 chỉ số) ──────────────────── */}
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {/* Tổng Doanh Thu (gộp DV + Đơn) */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-1.5">
                                                <h3 className="text-sm font-medium text-gray-500">Tổng Doanh Thu</h3>
                                                <HelpTooltip text="Σ totalAmount (đơn hoàn thành). Tổng tiền thu từ khách hàng trong kỳ." />
                                            </div>
                                            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                                                <DollarSign size={18} />
                                            </div>
                                        </div>
                                        <div className="text-3xl font-black text-gray-900 tracking-tight">{report.formatVND(summary.revenue)}</div>
                                        <p className="text-xs text-gray-400 mt-1">{report.formatFullVND(summary.revenue)}</p>
                                        {summary.revenueChange !== 0 && (
                                            <p className={`text-xs font-bold mt-1.5 flex items-center gap-1 ${summary.revenueChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                {summary.revenueChange >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                {summary.revenueChange >= 0 ? '+' : ''}{summary.revenueChange}%
                                            </p>
                                        )}
                                        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                                            <div className="flex items-center gap-1">
                                                <Package size={12} className="text-blue-500" />
                                                <span className="text-xs font-bold text-gray-700">{summary.totalServiceCount}</span>
                                                <span className="text-[10px] text-gray-400">DV</span>
                                            </div>
                                            <div className="w-px h-3 bg-gray-200" />
                                            <div className="flex items-center gap-1">
                                                <Receipt size={12} className="text-indigo-500" />
                                                <span className="text-xs font-bold text-gray-700">{summary.orders}</span>
                                                <span className="text-[10px] text-gray-400">đơn</span>
                                            </div>
                                        </div>
                                    </div>
                                    {/* #4 CP TB / DV */}
                                    <KPICard
                                        title="Chi Phí TB / Dịch Vụ"
                                        value={report.formatVND(summary.costPerService)}
                                        subtitle="Tiền tua trung bình / dịch vụ"
                                        icon={<Calculator size={18} />}
                                        color="bg-orange-50 text-orange-600"
                                        helpText="Tổng tiền tua ÷ Số dịch vụ. Trung bình tiền tua trả cho KTV mỗi dịch vụ."
                                    />
                                    {/* #5 Tỷ Lệ Chi Phí */}
                                    <KPICard
                                        title="Tỷ Lệ Chi Phí"
                                        value={`${summary.costRatio}%`}
                                        subtitle="Tua / Doanh thu"
                                        icon={<PieChartIcon size={18} />}
                                        color="bg-rose-50 text-rose-600"
                                        helpText="Tổng tiền tua ÷ Doanh thu × 100%. % doanh thu dành trả cho KTV (càng thấp càng tốt)."
                                    />
                                    {/* #6 Số Khách */}
                                    <KPICard
                                        title="Số Khách"
                                        value={String(summary.uniqueCustomers)}
                                        subtitle={`${summary.newCustomers} đăng ký mới`}
                                        change={summary.customersChange}
                                        icon={<Users size={18} />}
                                        color="bg-purple-50 text-purple-600"
                                        onClick={() => setShowNewCustomers(true)}
                                        helpText="Count distinct (customerId). Số khách hàng duy nhất có đơn hoàn thành."
                                    />
                                    {/* #7 Chi Tiêu TB / Khách */}
                                    <KPICard
                                        title="Chi Tiêu TB / Khách"
                                        value={report.formatVND(summary.avgBillPerCustomer)}
                                        subtitle={`Trung bình/đơn: ${report.formatVND(summary.avgPerOrder)}`}
                                        icon={<Activity size={18} />}
                                        color="bg-amber-50 text-amber-600"
                                        helpText="Doanh thu ÷ Số khách duy nhất. Trung bình mỗi khách chi tiêu bao nhiêu trong kỳ."
                                    />
                                    {/* Đánh Giá TB */}
                                    <KPICard
                                        title="Đánh Giá Trung Bình"
                                        value={summary.avgRating > 0 ? `${summary.avgRating} ★` : '—'}
                                        subtitle={summary.avgRating >= 4 ? 'Xuất sắc' : summary.avgRating >= 3 ? 'Tốt' : ''}
                                        icon={<Star size={18} />}
                                        color="bg-yellow-50 text-yellow-600"
                                        helpText="Σ itemRating ÷ Số lượt đánh giá. Điểm hài lòng trung bình từ khách (thang 5 sao)."
                                    />
                                    {/* Tổng Tip */}
                                    <KPICard
                                        title="Tổng Tip"
                                        value={summary.totalTip > 0 ? report.formatVND(summary.totalTip) : '0đ'}
                                        icon={<Award size={18} />}
                                        color="bg-pink-50 text-pink-600"
                                        helpText="Σ tip (BookingItems). Tổng tiền tip khách thưởng cho KTV."
                                    />
                                    {/* DT / Giường */}
                                    <KPICard
                                        title="Doanh Thu / Giường"
                                        value={report.formatVND(summary.revenuePerBed)}
                                        subtitle={`${summary.totalBeds} giường`}
                                        icon={<BedDouble size={18} />}
                                        color="bg-indigo-50 text-indigo-600"
                                        helpText="Doanh thu ÷ Tổng số giường. Hiệu quả kinh doanh trên mỗi giường."
                                    />
                                    {/* Lấp đầy Giường */}
                                    <KPICard
                                        title="Lấp đầy Giường"
                                        value={`${summary.bedOccupancy}%`}
                                        subtitle={summary.bedOccupancy >= 80 ? 'Cao tải' : summary.bedOccupancy >= 50 ? 'Ổn định' : 'Còn trống nhiều'}
                                        icon={<Gauge size={18} />}
                                        color={summary.bedOccupancy >= 80 ? 'bg-red-50 text-red-600' : summary.bedOccupancy >= 50 ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}
                                        helpText="Tổng phút DV ÷ (Giường × Giờ mở cửa × Ngày) × 100%. ≥80% là cao tải."
                                    />
                                    {/* Tỷ lệ hủy đơn */}
                                    <KPICard
                                        title="Tỷ Lệ Hủy Đơn"
                                        value={`${summary.cancellationRate}%`}
                                        subtitle={`${summary.cancelledOrders} đơn hủy`}
                                        icon={<Ban size={18} />}
                                        color={summary.cancellationRate >= 20 ? 'bg-red-50 text-red-600' : summary.cancellationRate >= 10 ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-600'}
                                        helpText="Đơn hủy ÷ Tổng đơn (hoàn thành + hủy) × 100%. Giúp phát hiện vấn đề vận hành."
                                    />
                                    {/* Khách quay lại */}
                                    <KPICard
                                        title="Khách Quay Lại"
                                        value={`${summary.retentionRate}%`}
                                        subtitle={`${summary.returningCustomers}/${summary.uniqueCustomers} khách`}
                                        icon={<UserCheck size={18} />}
                                        color={summary.retentionRate >= 50 ? 'bg-emerald-50 text-emerald-600' : summary.retentionRate >= 30 ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-500'}
                                        helpText="Khách có ≥ 2 đơn ÷ Tổng khách × 100%. Đánh giá mức giữ chân khách."
                                    />
                                </div>

                                {/* ─── Metrics Help Modal ─────────────────────── */}
                                {showMetricsHelp && (
                                    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowMetricsHelp(false)}>
                                        <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                                            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                                                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                                    <HelpCircle size={18} className="text-indigo-500" />
                                                    Giải thích thông số
                                                </h3>
                                                <button onClick={() => setShowMetricsHelp(false)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                                                    <XCircle size={20} className="text-gray-400" />
                                                </button>
                                            </div>
                                            <div className="overflow-y-auto max-h-[calc(80vh-60px)] p-5">
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="border-b border-gray-100">
                                                            <th className="text-left py-2.5 pr-3 font-semibold text-gray-500 whitespace-nowrap">Thông số</th>
                                                            <th className="text-left py-2.5 pr-3 font-semibold text-gray-500">Công thức</th>
                                                            <th className="text-left py-2.5 font-semibold text-gray-500">Ý nghĩa</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-50">
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Tổng Doanh Thu</td><td className="py-2 pr-3 text-gray-500">Σ totalAmount (đơn hoàn thành)</td><td className="py-2 text-gray-500">Tổng tiền thu từ khách hàng trong kỳ</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Số Dịch Vụ</td><td className="py-2 pr-3 text-gray-500">Σ quantity (BookingItems)</td><td className="py-2 text-gray-500">Tổng số lượt dịch vụ đã thực hiện</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Số Đơn</td><td className="py-2 pr-3 text-gray-500">Count (Bookings hoàn thành)</td><td className="py-2 text-gray-500">Tổng số đơn hàng đã hoàn thành</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Chi Phí TB / Dịch Vụ</td><td className="py-2 pr-3 text-gray-500">Tổng tiền tua ÷ Số dịch vụ</td><td className="py-2 text-gray-500">Trung bình tiền tua trả cho KTV mỗi dịch vụ</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Tỷ Lệ Chi Phí</td><td className="py-2 pr-3 text-gray-500">Tổng tiền tua ÷ Doanh thu × 100%</td><td className="py-2 text-gray-500">% doanh thu dành trả cho KTV (càng thấp càng tốt)</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Số Khách</td><td className="py-2 pr-3 text-gray-500">Count distinct (customerId)</td><td className="py-2 text-gray-500">Số khách hàng duy nhất có đơn hoàn thành</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Đăng ký mới</td><td className="py-2 pr-3 text-gray-500">Count (Customers created trong kỳ)</td><td className="py-2 text-gray-500">Số tài khoản khách tạo mới, chưa chắc đã đặt lịch</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Chi Tiêu TB / Khách</td><td className="py-2 pr-3 text-gray-500">Doanh thu ÷ Số khách duy nhất</td><td className="py-2 text-gray-500">Trung bình mỗi khách chi tiêu bao nhiêu trong kỳ</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Đánh Giá Trung Bình</td><td className="py-2 pr-3 text-gray-500">Σ itemRating ÷ Số lượt đánh giá</td><td className="py-2 text-gray-500">Điểm hài lòng trung bình từ khách (thang 5 sao)</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Tổng Tip</td><td className="py-2 pr-3 text-gray-500">Σ tip (BookingItems)</td><td className="py-2 text-gray-500">Tổng tiền tip khách thưởng KTV</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Doanh Thu / Giường</td><td className="py-2 pr-3 text-gray-500">Doanh thu ÷ Tổng số giường</td><td className="py-2 text-gray-500">Hiệu quả kinh doanh trên mỗi giường</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Lấp đầy Giường</td><td className="py-2 pr-3 text-gray-500">Tổng phút DV ÷ (Giường × Giờ mở cửa × Ngày) × 100%</td><td className="py-2 text-gray-500">% thời gian giường được sử dụng (≥80% là cao tải)</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Tỷ Lệ Hủy Đơn</td><td className="py-2 pr-3 text-gray-500">Đơn hủy ÷ Tổng đơn (hoàn thành + hủy) × 100%</td><td className="py-2 text-gray-500">% đơn bị hủy, giúp phát hiện vấn đề vận hành</td></tr>
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Khách Quay Lại</td><td className="py-2 pr-3 text-gray-500">Khách có ≥ 2 đơn ÷ Tổng khách × 100%</td><td className="py-2 text-gray-500">% khách quay lại, đánh giá mức giữ chân khách</td></tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* ─── Export Modal ────────────────────────────── */}
                                {showExportModal && (() => {
                                    const EXPORT_OPTIONS = [
                                        { key: 'kpi', label: 'Tóm tắt KPI', desc: '14 thông số chính' },
                                        { key: 'services', label: 'Cơ cấu dịch vụ', desc: 'Breakdown theo tên DV' },
                                        { key: 'languages', label: 'Phân tích ngôn ngữ', desc: 'Doanh thu & đơn theo ngôn ngữ' },
                                        { key: 'ktv', label: 'Bảng KTV', desc: 'Commission, tip, rating từng KTV' },
                                        { key: 'peakHours', label: 'Giờ cao điểm', desc: 'Lượng đơn theo giờ' },
                                        { key: 'revenue', label: 'Doanh thu theo thời gian', desc: 'Dữ liệu chart (ngày/tuần/tháng)' },
                                    ];
                                    const selectedCount = Object.values(exportSections).filter(Boolean).length;
                                    return (
                                        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowExportModal(false)}>
                                            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                                                    <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                                        <FileSpreadsheet size={18} className="text-emerald-600" />
                                                        Xuất Excel
                                                    </h3>
                                                    <button onClick={() => setShowExportModal(false)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                                                        <XCircle size={20} className="text-gray-400" />
                                                    </button>
                                                </div>
                                                <div className="p-5 space-y-4">
                                                    <div>
                                                        <p className="text-xs font-semibold text-gray-500 mb-2">Khoảng thời gian</p>
                                                        <div className="flex items-center gap-2">
                                                            <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)}
                                                                className="border border-gray-200 rounded-xl px-2.5 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-300 flex-1 min-w-0" />
                                                            <ChevronRight size={14} className="text-gray-300 shrink-0" />
                                                            <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)}
                                                                className="border border-gray-200 rounded-xl px-2.5 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-300 flex-1 min-w-0" />
                                                            <button
                                                                onClick={() => {
                                                                    report.setDatePreset('custom');
                                                                    report.setDateFrom(exportFrom);
                                                                    report.setDateTo(exportTo);
                                                                    setTimeout(() => report.applyCustomDate(), 50);
                                                                    setShowExportModal(false);
                                                                }}
                                                                className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold whitespace-nowrap active:scale-95 transition-all"
                                                            >
                                                                Xem trước
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <p className="text-xs font-semibold text-gray-500">Chọn loại dữ liệu ({selectedCount}/{EXPORT_OPTIONS.length})</p>
                                                            <button
                                                                onClick={() => {
                                                                    const allChecked = selectedCount === EXPORT_OPTIONS.length;
                                                                    const newState: Record<string, boolean> = {};
                                                                    EXPORT_OPTIONS.forEach(o => { newState[o.key] = !allChecked; });
                                                                    setExportSections(newState);
                                                                }}
                                                                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                                                            >
                                                                {selectedCount === EXPORT_OPTIONS.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                                                            </button>
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            {EXPORT_OPTIONS.map(o => (
                                                                <label key={o.key} className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${exportSections[o.key] ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-gray-100 hover:bg-gray-100'}`}>
                                                                    <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${exportSections[o.key] ? 'bg-emerald-600' : 'bg-white border-2 border-gray-300'}`}>
                                                                        {exportSections[o.key] && <Check size={12} className="text-white" />}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-sm font-semibold text-gray-800">{o.label}</p>
                                                                        <p className="text-[10px] text-gray-400">{o.desc}</p>
                                                                    </div>
                                                                    <input type="checkbox" checked={exportSections[o.key]} onChange={() => setExportSections(prev => ({ ...prev, [o.key]: !prev[o.key] }))} className="sr-only" />
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
                                                    <button onClick={() => setShowExportModal(false)} className="flex-1 py-2.5 text-sm font-bold text-gray-500 bg-white border border-gray-200 rounded-xl hover:bg-gray-100 transition-all active:scale-95">
                                                        Đóng
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const sections = Object.entries(exportSections).filter(([, v]) => v).map(([k]) => k);
                                                            report.exportToCSV({ sections, exportFrom, exportTo });
                                                            setShowExportModal(false);
                                                        }}
                                                        disabled={selectedCount === 0}
                                                        className="flex-1 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                    >
                                                        <Download size={14} />
                                                        Xuất Excel
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </>
                        )}
                    </>
                )}
            </div>
            {/* New Customer Modal */}
            <NewCustomerModal
                isOpen={showNewCustomers}
                onClose={() => setShowNewCustomers(false)}
                customers={report.data.newCustomerList}
                formatDate={(d: string) => {
                    try { return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
                    catch { return d; }
                }}
            />
        </AppLayout>
    );
}

// ─── New Customer Modal (iOS-style bottom sheet) ─────────────────────────
const NewCustomerModal = ({ isOpen, onClose, customers, formatDate }: {
    isOpen: boolean;
    onClose: () => void;
    customers: { id: string; name: string; phone: string; email: string; createdAt: string }[];
    formatDate: (d: string) => string;
}) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[80vh] flex flex-col shadow-2xl">
                {/* Handle */}
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 sm:hidden" />
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-gray-100">
                    <div>
                        <h2 className="text-lg font-black text-gray-900">Khách Hàng Mới</h2>
                        <p className="text-xs text-gray-400 mt-0.5">{customers.length} khách trong kỳ</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center active:scale-90 transition-transform">
                        <X size={16} className="text-gray-500" />
                    </button>
                </div>
                {/* List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {customers.length === 0 ? (
                        <div className="py-12 text-center text-gray-300 text-sm">Chưa có khách hàng mới</div>
                    ) : (
                        customers.map((c, idx) => (
                            <div key={c.id || idx} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-gray-800">{c.name}</span>
                                    <span className="text-[10px] text-gray-400">{formatDate(c.createdAt)}</span>
                                </div>
                                <div className="flex items-center gap-4 mt-2">
                                    {c.phone && !c.phone.startsWith('GUEST') && (
                                        <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-indigo-600">
                                            <Phone size={11} /> {c.phone}
                                        </a>
                                    )}
                                    {c.email && !c.email.includes('no-email') && (
                                        <span className="flex items-center gap-1 text-xs text-gray-500 truncate">
                                            <Mail size={11} /> {c.email}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
