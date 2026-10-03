'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import {
    ShieldAlert, TrendingUp, TrendingDown, DollarSign, Users, Calendar,
    Star, Activity, ChevronRight, ChevronLeft, Loader2, BarChart3, Award, Coins, Globe, X, Phone, Mail,
    Package, Receipt, Calculator, PieChart as PieChartIcon, Clock, Crown, Download, BedDouble, Gauge, HelpCircle,
    XCircle, Ban, UserCheck, FileSpreadsheet, Check, Table2, DoorOpen, Target, ArrowUpDown, Info
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
    { key: 'quarter', label: 'Quý này' },
    { key: 'year', label: 'Năm này' },
    { key: 'custom', label: 'Tùy chọn' },
] as const;

// 24 tháng gần nhất cho dropdown chọn nhanh
const RECENT_MONTH_OPTIONS = (() => {
    const options: { value: string; label: string; month: number; year: number }[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const m = d.getMonth() + 1;
        const y = d.getFullYear();
        const value = `${y}-${String(m).padStart(2, '0')}`;
        const label = `Tháng ${String(m).padStart(2, '0')}/${y}`;
        options.push({ value, label, month: m, year: y });
    }
    return options;
})();

const formatPeriodDisplay = (fromStr: string, toStr: string, preset: string) => {
    if (!fromStr || !toStr) return { title: 'Đang tải...', subtitle: '' };

    const formatDateVn = (s: string) => {
        const parts = s.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : s;
    };

    if (fromStr === toStr) {
        const d = new Date(fromStr + 'T00:00:00');
        const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
        const dayName = isNaN(d.getTime()) ? '' : days[d.getDay()];
        const formatted = formatDateVn(fromStr);
        return {
            title: `${dayName}, ${formatted}`,
            subtitle: preset === 'today' ? 'Hôm nay' : preset === 'yesterday' ? 'Hôm qua' : '1 ngày',
        };
    }

    const fromDate = new Date(fromStr + 'T00:00:00');
    const toDate = new Date(toStr + 'T00:00:00');
    const diffDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // Kiểm tra trọn tháng
    const isStartOfMonth = fromDate.getDate() === 1;
    const isEndOfMonth = toDate.getDate() === new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0).getDate();
    if (isStartOfMonth && isEndOfMonth && fromDate.getMonth() === toDate.getMonth() && fromDate.getFullYear() === toDate.getFullYear()) {
        const m = fromDate.getMonth() + 1;
        const y = fromDate.getFullYear();
        return {
            title: `Tháng ${String(m).padStart(2, '0')}/${y}`,
            subtitle: `${formatDateVn(fromStr)} – ${formatDateVn(toStr)} · ${diffDays} ngày`,
        };
    }

    // Kiểm tra trọn năm
    if (fromStr.endsWith('-01-01') && toStr.endsWith('-12-31') && fromStr.slice(0, 4) === toStr.slice(0, 4)) {
        return {
            title: `Năm ${fromStr.slice(0, 4)}`,
            subtitle: `${formatDateVn(fromStr)} – ${formatDateVn(toStr)} · ${diffDays} ngày`,
        };
    }

    // Kiểm tra quý
    const qMonths = Math.round(diffDays / 30);
    if (isStartOfMonth && isEndOfMonth && qMonths === 3) {
        const q = Math.floor(fromDate.getMonth() / 3) + 1;
        return {
            title: `Quý ${q}/${fromDate.getFullYear()}`,
            subtitle: `${formatDateVn(fromStr)} – ${formatDateVn(toStr)} · ${diffDays} ngày`,
        };
    }

    return {
        title: `${formatDateVn(fromStr)} – ${formatDateVn(toStr)}`,
        subtitle: `${diffDays} ngày`,
    };
};

const GROUP_BY_OPTIONS: { key: GroupBy; label: string }[] = [
    { key: 'hour', label: 'Giờ' },
    { key: 'day', label: 'Ngày' },
    { key: 'week', label: 'Tuần' },
    { key: 'month', label: 'Tháng' },
];

type ChartSortOrder = 'time_asc' | 'time_desc' | 'revenue_desc' | 'revenue_asc';

const CHART_SORT_OPTIONS: { key: ChartSortOrder; label: string }[] = [
    { key: 'time_asc', label: 'Thời gian: Cũ → Mới' },
    { key: 'time_desc', label: 'Thời gian: Mới → Cũ' },
    { key: 'revenue_desc', label: 'Doanh thu: Cao → Thấp' },
    { key: 'revenue_asc', label: 'Doanh thu: Thấp → Cao' },
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
    const data = payload[0]?.payload;
    const isDrilldown = Boolean(data?.rawDate);
    const avgPerOrder = data?.orders && data?.revenue ? Math.round(data.revenue / data.orders) : 0;

    return (
        <div className="bg-white shadow-2xl rounded-2xl border border-gray-100 p-3.5 text-xs min-w-[210px] z-50">
            <div className="border-b border-gray-100 pb-2 mb-2">
                <p className="font-black text-gray-900 text-sm">
                    {data?.dayOfWeek ? `${data.dayOfWeek}, ` : ''}{data?.fullDate || label}
                </p>
                {data?.orders !== undefined && (
                    <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                        {data.orders} đơn hàng hoàn thành
                    </p>
                )}
            </div>
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-gray-500 font-medium">Doanh thu:</span>
                    <span className="font-black text-indigo-600 text-sm">
                        {data?.revenue !== undefined ? `${data.revenue.toLocaleString('vi-VN')} đ` : `${payload[0]?.value}K`}
                    </span>
                </div>
                {avgPerOrder > 0 && (
                    <div className="flex items-center justify-between text-gray-500">
                        <span>TB / đơn:</span>
                        <span className="font-bold text-gray-700">{avgPerOrder.toLocaleString('vi-VN')} đ</span>
                    </div>
                )}
            </div>
            {isDrilldown && (
                <div className="mt-2.5 pt-2 border-t border-dashed border-gray-100 flex items-center gap-1 text-[10px] text-indigo-600 font-bold bg-indigo-50/60 px-2 py-1 rounded-md">
                    <span>💡 Bấm cột để xem chi tiết ngày này</span>
                </div>
            )}
        </div>
    );
};

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RevenueReportsPage() {
    const { hasPermission } = useAuth();
    const [mounted, setMounted] = React.useState(false);
    const report = useRevenueReport();
    const [activeTab, setActiveTab] = React.useState<'overview' | 'services' | 'customers' | 'time' | 'raw_data' | 'rooms' | 'ktv_ranking'>('overview');
    
    const [chartSortOrder, setChartSortOrder] = React.useState<ChartSortOrder>('time_asc');
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

    const formatDayOfWeek = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '';
            const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
            return days[d.getDay()];
        } catch {
            return '';
        }
    };

    // Get chart data based on groupBy and sort order
    const getRevenueChartData = () => {
        let items: any[] = [];
        switch (report.groupBy) {
            case 'hour':
                items = report.data.hourlyRevenue.map((h, i) => ({
                    label: h.label,
                    fullDate: h.label,
                    revenue: h.revenue,
                    revenueK: Math.round(h.revenue / 1000),
                    orders: h.orders,
                    sortKey: i,
                }));
                break;
            case 'week':
                items = report.data.weeklyRevenue.map(w => ({
                    label: formatDate(w.week),
                    fullDate: `Tuần từ ${w.week}`,
                    revenue: w.revenue,
                    revenueK: Math.round(w.revenue / 1000),
                    orders: w.orders,
                    sortKey: w.week,
                }));
                break;
            case 'month':
                items = report.data.monthlyRevenue.map(m => ({
                    label: `T${m.month.substring(5)}`,
                    fullDate: `Tháng ${m.month}`,
                    revenue: m.revenue,
                    revenueK: Math.round(m.revenue / 1000),
                    orders: m.orders,
                    sortKey: m.month,
                }));
                break;
            default: // day
                items = report.data.dailyRevenue.map(d => ({
                    label: formatDate(d.date),
                    fullDate: d.date,
                    dayOfWeek: formatDayOfWeek(d.date),
                    revenue: d.revenue,
                    revenueK: Math.round(d.revenue / 1000),
                    orders: d.orders,
                    rawDate: d.date,
                    sortKey: d.date,
                }));
                break;
        }

        return [...items].sort((a, b) => {
            if (chartSortOrder === 'time_asc') {
                return a.sortKey > b.sortKey ? 1 : a.sortKey < b.sortKey ? -1 : 0;
            }
            if (chartSortOrder === 'time_desc') {
                return a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0;
            }
            if (chartSortOrder === 'revenue_desc') {
                return (b.revenue || 0) - (a.revenue || 0);
            }
            if (chartSortOrder === 'revenue_asc') {
                return (a.revenue || 0) - (b.revenue || 0);
            }
            return 0;
        });
    };

    const revenueChartData = getRevenueChartData();
    const chartTitle = { hour: 'Doanh Thu Theo Giờ', day: 'Doanh Thu Theo Ngày', week: 'Doanh Thu Theo Tuần', month: 'Doanh Thu Theo Tháng' }[report.groupBy];

    // Find KTV with highest tip
    const topTipKTV = report.data.topKTV.length > 0
        ? report.data.topKTV.reduce((max, k) => k.totalTip > max.totalTip ? k : max, report.data.topKTV[0])
        : null;

    const displayedKTV = showAllKTV ? report.data.topKTV : report.data.topKTV.slice(0, KTV_DISPLAY_LIMIT);

    const handlePresetSelect = (presetKey: any) => {
        report.setDatePreset(presetKey);
        if (presetKey === 'today' || presetKey === 'yesterday') {
            report.applyGroupBy('hour');
        } else if (presetKey === 'week' || presetKey === 'month') {
            report.applyGroupBy('day');
        } else if (presetKey === 'quarter' || presetKey === 'year') {
            report.applyGroupBy('month');
        }
    };

    const handleMonthYearSelect = (val: string) => {
        if (!val) return;
        const [yStr, mStr] = val.split('-');
        const year = parseInt(yStr, 10);
        const month = parseInt(mStr, 10);
        report.applyMonthYear(month, year);
    };

    const getActiveMonthYear = () => {
        if (!report.dateFrom || !report.dateTo) return '';
        const from = new Date(report.dateFrom + 'T00:00:00');
        const to = new Date(report.dateTo + 'T00:00:00');
        if (isNaN(from.getTime()) || isNaN(to.getTime())) return '';
        const isStart = from.getDate() === 1;
        const isEnd = to.getDate() === new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
        if (isStart && isEnd && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
            const m = from.getMonth() + 1;
            const y = from.getFullYear();
            return `${y}-${String(m).padStart(2, '0')}`;
        }
        return '';
    };

    const activeMonthYear = getActiveMonthYear();
    const periodInfo = formatPeriodDisplay(report.dateFrom, report.dateTo, report.datePreset);

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

                {/* ─── 2-Tier Revenue Filter Bar (Executive Time Controller) ─── */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5 space-y-3">
                    {/* TẦNG 1: Quick Preset Chips + Actions */}
                    <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
                        {/* Preset Chips (Scrollable on mobile) */}
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide flex-1">
                            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100 shrink-0">
                                {DATE_PRESETS.map(b => (
                                    <button
                                        key={b.key}
                                        onClick={() => handlePresetSelect(b.key)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                                            report.datePreset === b.key
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60 active:bg-gray-200'
                                        }`}
                                    >
                                        {b.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Actions: Excel & Help */}
                        <div className="flex items-center gap-2 shrink-0">
                            {!report.isLoading && report.data.summary.orders > 0 && (
                                <button
                                    onClick={() => { setExportFrom(report.dateFrom); setExportTo(report.dateTo); setShowExportModal(true); }}
                                    className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-all active:scale-95 flex items-center gap-1.5 shadow-sm"
                                >
                                    <FileSpreadsheet size={13} />
                                    <span>Xuất Excel</span>
                                </button>
                            )}
                            <button
                                onClick={() => setShowMetricsHelp(true)}
                                className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-500 border border-gray-200 transition-all active:scale-95 shrink-0"
                                title="Giải thích thông số"
                            >
                                <HelpCircle size={15} />
                            </button>
                        </div>
                    </div>

                    {/* TẦNG 2: Stepper Điều Hướng Kỳ & Bộ Lọc Nghiệp Vụ */}
                    <div className="pt-2.5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                        {/* Trái: Nhãn kỳ trực quan */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200/80 p-1.5 rounded-xl shadow-xs">
                                {/* Nội dung kỳ hiển thị */}
                                {report.datePreset === 'custom' ? (
                                    <div className="flex items-center gap-1.5 px-1.5 py-0.5">
                                        <input
                                            type="date"
                                            value={report.dateFrom}
                                            onChange={e => report.setDateFrom(e.target.value)}
                                            className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                        />
                                        <span className="text-gray-400 font-bold px-0.5">-</span>
                                        <input
                                            type="date"
                                            value={report.dateTo}
                                            onChange={e => report.setDateTo(e.target.value)}
                                            className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => report.applyCustomDate()}
                                            className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all active:scale-95 shadow-2xs cursor-pointer"
                                        >
                                            Xem
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 px-2.5 py-1">
                                        <Calendar size={14} className="text-indigo-600 shrink-0" />
                                        <div className="flex items-baseline gap-2">
                                            <span className="font-bold text-gray-900 text-xs sm:text-sm tracking-tight">{periodInfo.title}</span>
                                            {periodInfo.subtitle && (
                                                <span className="text-[11px] font-medium text-gray-500 hidden sm:inline">({periodInfo.subtitle})</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Subtitle hiển thị riêng trên mobile nếu cần */}
                            {report.datePreset !== 'custom' && periodInfo.subtitle && (
                                <span className="text-[11px] font-medium text-gray-500 sm:hidden">
                                    {periodInfo.subtitle}
                                </span>
                            )}
                        </div>

                        {/* Phải: Bộ chọn Tháng cụ thể + Bộ lọc Kênh + Chi nhánh */}
                        <div className="flex items-center gap-2 flex-wrap">
                            {/* Dropdown Tháng Cụ Thể (Hợp nhất Tháng & Năm) */}
                            <div className="relative">
                                <select
                                    value={activeMonthYear}
                                    onChange={(e) => handleMonthYearSelect(e.target.value)}
                                    className="bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                                >
                                    <option value="" disabled hidden>Chọn tháng khác...</option>
                                    {RECENT_MONTH_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Dropdown Kênh / Ngôn ngữ */}
                            <div className="relative">
                                <select
                                    value={report.filterLang}
                                    onChange={(e) => report.applyLangFilter(e.target.value)}
                                    className="bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                                >
                                    <option value="all">Tất cả kênh / ngôn ngữ</option>
                                    {report.data.languageBreakdown?.map(lb => (
                                        <option key={lb.key || lb.lang} value={lb.key || lb.lang}>
                                            Kênh: {lb.lang}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Dropdown Chi nhánh */}
                            <div className="relative">
                                <select
                                    defaultValue="all"
                                    className="bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                                >
                                    <option value="all">Tất cả chi nhánh</option>
                                    <option value="main">Trụ sở chính</option>
                                </select>
                            </div>
                        </div>
                    </div>
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
                                {/* ─── 4 TRỤ CỘT KPI CHIẾN LƯỢC (EXECUTIVE HERO CARDS) ─── */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                                    {/* TRỤ CỘT 1: TÀI CHÍNH & LÃI GỘP */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Tài Chính & Lợi Nhuận</span>
                                                    <HelpTooltip text="Tổng doanh thu thực thu, tiền lãi gộp ước tính sau khi trừ tiền tua KTV, và tỷ lệ chi phí." />
                                                </div>
                                                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl shrink-0">
                                                    <DollarSign size={18} />
                                                </div>
                                            </div>
                                            <div className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                                                {report.formatVND(summary.revenue)}
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <span className="text-xs text-gray-400">Doanh thu thuần</span>
                                                {summary.revenueChange !== 0 && (
                                                    <span className={`text-xs font-bold flex items-center ${summary.revenueChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                        {summary.revenueChange >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                        {summary.revenueChange >= 0 ? '+' : ''}{summary.revenueChange}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-500 font-medium">Lãi gộp ước tính:</span>
                                                <span className="font-bold text-emerald-700">{report.formatVND(summary.grossProfit)} ({summary.grossProfitMargin}%)</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-500 font-medium">Chi phí tua KTV:</span>
                                                <span className={`font-bold ${summary.costRatio > 45 ? 'text-rose-600' : summary.costRatio > 38 ? 'text-amber-600' : 'text-gray-800'}`}>
                                                    {report.formatVND(summary.totalCommission)} ({summary.costRatio}%)
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* TRỤ CỘT 2: KHÁCH HÀNG & ĐỘ TRUNG THÀNH */}
                                    <div 
                                        onClick={() => setShowNewCustomers(true)}
                                        className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between hover:shadow-md transition-all cursor-pointer active:scale-[0.99]"
                                    >
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Khách Hàng & Giữ Chân</span>
                                                    <HelpTooltip text="Số lượng khách hàng hoàn thành dịch vụ, tỷ lệ khách quay lại và giá trị chi tiêu trung bình." />
                                                </div>
                                                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl shrink-0">
                                                    <Users size={18} />
                                                </div>
                                            </div>
                                            <div className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                                                {summary.uniqueCustomers} <span className="text-sm font-bold text-gray-500">khách</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <span className="text-xs text-gray-400">{summary.newCustomers} khách mới</span>
                                                {summary.customersChange !== 0 && (
                                                    <span className={`text-xs font-bold flex items-center ${summary.customersChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                        {summary.customersChange >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                        {summary.customersChange >= 0 ? '+' : ''}{summary.customersChange}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-500 font-medium">Tỷ lệ khách quay lại:</span>
                                                <span className="font-bold text-purple-700">{summary.retentionRate}% ({summary.returningCustomers} khách)</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-500 font-medium">Chi tiêu TB / khách:</span>
                                                <span className="font-bold text-gray-800">{report.formatVND(summary.avgBillPerCustomer)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* TRỤ CỘT 3: CÔNG SUẤT PHÒNG & GIƯỜNG */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Hiệu Suất Giường & Phòng</span>
                                                    <HelpTooltip text="Tỷ lệ lấp đầy giường (dựa trên giờ hoạt động), doanh thu trên mỗi giường và tổng số lượt dịch vụ." />
                                                </div>
                                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl shrink-0">
                                                    <BedDouble size={18} />
                                                </div>
                                            </div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">{summary.bedOccupancy}%</span>
                                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${summary.bedOccupancy >= 80 ? 'bg-rose-50 text-rose-600' : summary.bedOccupancy >= 50 ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-600'}`}>
                                                    {summary.bedOccupancy >= 80 ? 'Cao tải' : summary.bedOccupancy >= 50 ? 'Ổn định' : 'Trống nhiều'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400 mt-1">
                                                Tổng {summary.totalBeds} giường hoạt động
                                            </div>
                                        </div>
                                        <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-500 font-medium">Doanh thu / Giường:</span>
                                                <span className="font-bold text-indigo-700">{report.formatVND(summary.revenuePerBed)}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-500 font-medium">Lượt dịch vụ:</span>
                                                <span className="font-bold text-gray-800">{summary.totalServiceCount} lượt ({summary.orders} đơn)</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* TRỤ CỘT 4: CHẤT LƯỢNG & RỦI RO */}
                                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Chất Lượng & Rủi Ro</span>
                                                    <HelpTooltip text="Điểm đánh giá sao từ khách, tỷ lệ hủy đơn hàng và tổng tiền tip KTV nhận được." />
                                                </div>
                                                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl shrink-0">
                                                    <Star size={18} />
                                                </div>
                                            </div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                                                    {summary.avgRating > 0 ? `${summary.avgRating} ★` : '—'}
                                                </span>
                                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                                                    {summary.avgRating >= 4 ? 'Xuất sắc' : summary.avgRating >= 3 ? 'Khá' : 'Cần cải thiện'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400 mt-1">
                                                Độ hài lòng từ phản hồi khách
                                            </div>
                                        </div>
                                        <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-500 font-medium">Tỷ lệ hủy đơn:</span>
                                                <span className={`font-bold ${summary.cancellationRate >= 15 ? 'text-rose-600' : summary.cancellationRate >= 8 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                    {summary.cancellationRate}% ({summary.cancelledOrders} đơn)
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-500 font-medium">Tổng tiền tip KTV:</span>
                                                <span className="font-bold text-pink-600">{report.formatVND(summary.totalTip)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ─── THANH ĐÈN BÁO SỨC KHỎE KINH DOANH (HEALTH STRIP) ─── */}
                                <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-sm">
                                    <div className="flex items-center gap-2 text-indigo-950 font-medium">
                                        <Activity size={16} className="text-indigo-600 shrink-0" />
                                        <span>
                                            Sức khỏe kinh doanh: Lãi gộp ước tính <strong className="text-indigo-900">{summary.grossProfitMargin}%</strong> | 
                                            Lấp đầy giường <strong className="text-indigo-900">{summary.bedOccupancy}%</strong> | 
                                            Giữ chân khách <strong className="text-indigo-900">{summary.retentionRate}%</strong>
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-gray-500">Chi phí tua / DT:</span>
                                        <span className={`font-bold px-2 py-0.5 rounded-lg ${summary.costRatio <= 38 ? 'bg-emerald-100 text-emerald-800' : summary.costRatio <= 45 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                                            {summary.costRatio}% ({summary.costRatio <= 38 ? 'Tối ưu' : summary.costRatio <= 45 ? 'Chấp nhận' : 'Cần kiểm soát'})
                                        </span>
                                    </div>
                                </div>

                                {/* ─── Revenue Chart + Group By ─────────────────── */}
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-base font-bold text-gray-900">{chartTitle}</h3>
                                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                                {revenueChartData.length} {report.groupBy === 'hour' ? 'giờ' : report.groupBy === 'day' ? 'ngày' : report.groupBy === 'week' ? 'tuần' : 'tháng'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {/* Bộ chọn sắp xếp thời gian / doanh thu */}
                                            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200/80 px-2 py-1 rounded-lg">
                                                <ArrowUpDown size={13} className="text-gray-500 shrink-0" />
                                                <select
                                                    value={chartSortOrder}
                                                    onChange={e => setChartSortOrder(e.target.value as ChartSortOrder)}
                                                    className="bg-transparent text-xs font-bold text-gray-700 focus:outline-none cursor-pointer"
                                                    title="Sắp xếp thời gian hoặc doanh thu"
                                                >
                                                    {CHART_SORT_OPTIONS.map(opt => (
                                                        <option key={opt.key} value={opt.key}>{opt.label}</option>
                                                    ))}
                                                </select>
                                            </div>

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

                                    {/* 💡 Thanh Hướng Dẫn Tương Tác Trực Quan */}
                                    <div className="mb-4 bg-indigo-50/60 border border-indigo-100/80 rounded-xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-indigo-900 flex-wrap">
                                        <div className="flex items-center gap-2 font-medium">
                                            <Info size={15} className="text-indigo-600 shrink-0" />
                                            <span>
                                                {report.groupBy === 'day' ? (
                                                    <>
                                                        <strong>Mẹo phân tích:</strong> Click vào bất kỳ <strong>cột ngày</strong> nào trên biểu đồ để xem chi tiết doanh thu & đơn hàng của riêng ngày đó.
                                                    </>
                                                ) : report.groupBy === 'hour' ? (
                                                    <>
                                                        <strong>Biểu đồ theo giờ:</strong> Thể hiện khung giờ cao điểm trong ngày. Dùng bộ lọc giờ bên dưới để thu hẹp khung xem.
                                                    </>
                                                ) : (
                                                    <>
                                                        <strong>Biểu đồ tổng hợp:</strong> Đang xem toàn cảnh theo {report.groupBy === 'week' ? 'tuần' : 'tháng'}. Dùng bộ sắp xếp ở góc trên để tìm đỉnh doanh thu.
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                        <div className="text-[11px] text-indigo-600 font-medium">
                                            Đang xếp: <strong className="text-indigo-800">{CHART_SORT_OPTIONS.find(o => o.key === chartSortOrder)?.label}</strong>
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
                                                    <Bar 
                                                        dataKey="revenueK" 
                                                        name="Doanh thu (K)" 
                                                        radius={[6, 6, 0, 0]}
                                                        cursor={report.groupBy === 'day' ? 'pointer' : 'default'}
                                                        onClick={(data: any) => {
                                                            if (report.groupBy === 'day' && data?.payload?.rawDate) {
                                                                report.applyCustomDate(data.payload.rawDate, data.payload.rawDate);
                                                            }
                                                        }}
                                                    >
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
                                                            return (
                                                                <div key={`svc-${idx}`} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                                                    <div className="flex items-center justify-between mb-1.5">
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                                                                                idx === 0 ? 'bg-amber-100 text-amber-700' :
                                                                                idx === 1 ? 'bg-slate-200 text-slate-700' :
                                                                                idx === 2 ? 'bg-orange-100 text-orange-700' :
                                                                                'bg-gray-100 text-gray-500'
                                                                            }`}>
                                                                                {idx + 1}
                                                                            </span>
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
                                                        const isTopTip = topTipKTV && ktv.code === topTipKTV.code && ktv.totalTip > 0;
                                                        return (
                                                            <div key={ktv.code} className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
                                                                {/* Row 1: Name + Orders + Rating */}
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                                                                            idx === 0 ? 'bg-amber-100 text-amber-700' :
                                                                            idx === 1 ? 'bg-slate-200 text-slate-700' :
                                                                            idx === 2 ? 'bg-orange-100 text-orange-700' :
                                                                            'bg-gray-100 text-gray-500'
                                                                        }`}>
                                                                            {idx + 1}
                                                                        </span>
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
                                                        <tr><td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">Đánh Giá Trung Bình</td><td className="py-2 pr-3 text-gray-500">Σ itemRating ÷ Số lượt đánh giá, quy về thang 4 (sao thang 5 × 4 ÷ 5)</td><td className="py-2 text-gray-500">Điểm hài lòng trung bình từ khách (thang 4 sao)</td></tr>
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
