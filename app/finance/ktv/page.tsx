'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useFinanceKTV } from './FinanceKTV.logic';
import { ShieldAlert, CheckCircle, Clock, XCircle, RefreshCcw, Banknote, Edit3, Star, PiggyBank, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

export default function FinanceKTVPage() {
    const { 
        user, canAccessPage, withdrawals, summaries, bonusSummaries, isLoading, isProcessing, 
        activeTab, setActiveTab, isHistoryExpanded, setIsHistoryExpanded,
        filterType, setFilterType, fromDate, setFromDate, toDate, setToDate,
        handleApprove, handleReject, refresh,
        isAdjustmentModalOpen, selectedKtv, adjAmount, setAdjAmount, adjType, setAdjType, adjWalletType, setAdjWalletType, adjReason, setAdjReason, setIsAdjustmentModalOpen, handleOpenAdjustment, handleSubmitAdjustment,
        handleAcknowledgeIntent
    } = useFinanceKTV();

    if (!user || !canAccessPage) {
        return (
            <AppLayout title="Quản lý Tài chính KTV">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
                    <p className="text-gray-500">Bạn cần được cấp quyền "Thu Ngân KTV" để xem trang này.</p>
                </div>
            </AppLayout>
        );
    }

    const pendingRequests = withdrawals.filter(w => w.status === 'PENDING' && w.amount > 1);
    const intentRequests = withdrawals.filter(w => w.status === 'PENDING' && w.amount === 1);
    const allHistoryRequests = withdrawals.filter(w => w.status !== 'PENDING');
    const historyRequests = isHistoryExpanded ? allHistoryRequests : allHistoryRequests.slice(0, 3);

    return (
        <AppLayout title="Thu Ngân - Thanh toán KTV">
            <div className="p-4 max-w-5xl mx-auto space-y-8">
                
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800">Quầy Giao Tiền KTV</h1>
                        <p className="text-sm text-slate-500">Xác nhận giao tiền mặt cho các lệnh rút tiền của Kỹ thuật viên</p>
                    </div>
                    <button 
                        onClick={refresh}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
                    >
                        <RefreshCcw size={16} className={isLoading ? "animate-spin" : ""} />
                        Làm mới
                    </button>
                </div>

                {/* 🟠 DANH SÁCH BÁO TRƯỚC (INTENT) */}
                {intentRequests.length > 0 && (
                    <div className="mb-8">
                        <h2 className="text-lg font-bold text-amber-600 mb-4 flex items-center gap-2 uppercase tracking-widest text-sm">
                            <Clock size={18} /> Báo trước rút tiền ({intentRequests.length})
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {intentRequests.map(req => (
                                <div key={req.id} className="bg-amber-50 rounded-2xl p-4 border border-amber-200 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                                            <Star size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-800">{req.staff_id} - {req.Staff?.full_name}</p>
                                            <p className="text-[10px] text-amber-700 font-medium">Muốn rút tiền mặt (Chưa báo số tiền)</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => handleAcknowledgeIntent(req.id)}
                                        disabled={isProcessing}
                                        title="Đã ghi nhận, ẩn thông báo"
                                        className="p-2 bg-white rounded-lg text-amber-600 shadow-sm border border-amber-100 hover:bg-amber-100 transition-colors"
                                    >
                                        <CheckCircle size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 🔴 DANH SÁCH CHỜ GIAO TIỀN */}
                <div>
                    <h2 className="text-lg font-bold text-rose-600 mb-4 flex items-center gap-2 uppercase tracking-widest text-sm">
                        <Banknote size={18} /> Đang chờ ra quầy lấy tiền ({pendingRequests.length})
                    </h2>

                    {pendingRequests.length === 0 ? (
                        <div className="bg-slate-50 border border-slate-100 rounded-3xl p-10 text-center">
                            <Banknote size={48} className="text-slate-300 mx-auto mb-4" />
                            <p className="text-slate-500 font-medium">Hiện tại không có KTV nào yêu cầu rút tiền.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {pendingRequests.map(req => {
                                const isBonus = req.wallet_type === 'BONUS';
                                return (
                                <div key={req.id} className={`bg-white rounded-3xl p-6 border-2 shadow-xl relative overflow-hidden ${isBonus ? 'border-amber-100 shadow-amber-900/5' : 'border-rose-100 shadow-rose-900/5'}`}>
                                    <div className={`absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r ${isBonus ? 'from-amber-400 to-orange-500' : 'from-rose-400 to-amber-400'}`} />
                                    
                                    {isBonus && (
                                        <div className="absolute top-3 right-3 animate-pulse bg-amber-100 text-amber-600 text-[10px] font-black px-2 py-1 rounded-md flex items-center gap-1 uppercase tracking-widest">
                                            <Star size={10} className="fill-amber-500" /> Quy Đổi Bonus
                                        </div>
                                    )}

                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isBonus ? 'text-amber-500' : 'text-rose-500'}`}>Mã KTV</p>
                                            <h3 className="text-xl font-black text-slate-800">{req.staff_id}</h3>
                                            <p className="text-xs font-bold text-slate-400">{req.Staff?.full_name}</p>
                                        </div>
                                        <div className={`text-right ${isBonus ? 'mt-6' : ''}`}>
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Giờ yêu cầu</p>
                                            <p className="text-sm font-bold text-slate-600">
                                                {format(new Date(req.request_date), 'HH:mm - dd/MM')}
                                            </p>
                                        </div>
                                    </div>

                                    <div className={`rounded-2xl p-4 mb-6 flex items-center justify-between ${isBonus ? 'bg-amber-50' : 'bg-rose-50'}`}>
                                        <span className={`text-xs font-black uppercase tracking-widest ${isBonus ? 'text-amber-800' : 'text-rose-800'}`}>Số tiền cần đưa</span>
                                        <span className={`text-2xl font-black tracking-tight ${isBonus ? 'text-amber-600' : 'text-rose-600'}`}>{req.amount.toLocaleString()}đ</span>
                                    </div>
                                    
                                    {req.note && !isBonus && (
                                        <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg mb-4 line-clamp-2">Ghi chú: {req.note}</p>
                                    )}

                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => handleApprove(req.id, req.amount)}
                                            disabled={isProcessing}
                                            className={`flex-1 py-3.5 text-white rounded-xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all shadow-lg disabled:opacity-50 ${isBonus ? 'bg-amber-500 shadow-amber-200' : 'bg-rose-600 shadow-rose-200'}`}
                                        >
                                            XÁC NHẬN ĐÃ GIAO TIỀN
                                        </button>
                                        <button 
                                            onClick={() => handleReject(req.id)}
                                            disabled={isProcessing}
                                            className="px-4 py-3.5 bg-white border-2 border-slate-100 text-slate-400 rounded-xl hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-50"
                                            title="Từ chối / Hủy lệnh"
                                        >
                                            <XCircle size={20} />
                                        </button>
                                    </div>
                                </div>
                            )})}
                        </div>
                    )}
                </div>

                {/* 🟢 LỊCH SỬ ĐÃ XỬ LÝ */}
                <div className="pt-8">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-slate-600 flex items-center gap-2 uppercase tracking-widest text-sm">
                            <CheckCircle size={18} /> Lịch sử giao dịch gần đây
                        </h2>
                        {allHistoryRequests.length > 3 && (
                            <button 
                                onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold hover:bg-slate-200 transition-colors"
                            >
                                {isHistoryExpanded ? (
                                    <><ChevronUp size={14} /> Thu gọn</>
                                ) : (
                                    <><ChevronDown size={14} /> Xem tất cả ({allHistoryRequests.length})</>
                                )}
                            </button>
                        )}
                    </div>

                    <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-black">
                                <tr>
                                    <th className="px-6 py-4">KTV</th>
                                    <th className="px-6 py-4">Số tiền</th>
                                    <th className="px-6 py-4">Thời gian tạo</th>
                                    <th className="px-6 py-4">Trạng thái</th>
                                    <th className="px-6 py-4">Thu ngân xác nhận</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 font-medium">
                                    {historyRequests.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-slate-400">Không có giao dịch nào gần đây</td>
                                        </tr>
                                    ) : (
                                        historyRequests.map((req) => {
                                            const isBonus = req.wallet_type === 'BONUS';
                                            const isIntent = Math.abs(Number(req.amount)) === 1 && (req.note?.includes('Báo trước') || req.note?.includes('Đã chuẩn bị'));
                                            return (
                                            <tr key={req.id} className={`hover:bg-slate-50/50 ${isBonus ? 'bg-amber-50/20' : ''}`}>
                                                <td className="px-6 py-4">
                                                    <span className="font-bold text-slate-800">{req.staff_id}</span>
                                                    <span className="text-xs text-slate-400 ml-2">{req.Staff?.full_name}</span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {isIntent ? (
                                                        <span className="font-bold text-slate-400 uppercase text-[10px] tracking-widest bg-slate-100 px-2 py-1 rounded">Báo trước</span>
                                                    ) : (
                                                        <>
                                                            <span className={`font-black ${isBonus ? 'text-amber-600' : 'text-slate-700'}`}>{req.amount.toLocaleString()}đ</span>
                                                            {isBonus && <span className="ml-2 text-[9px] font-bold text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded uppercase">Bonus</span>}
                                                        </>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-slate-500">
                                                    {format(new Date(req.request_date), 'HH:mm dd/MM', { locale: vi })}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {isIntent ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-bold uppercase">
                                                            <CheckCircle size={12} /> Đã ghi nhận
                                                        </span>
                                                    ) : req.status === 'APPROVED' ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-bold uppercase">
                                                            <CheckCircle size={12} /> Đã giao tiền
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 text-xs font-bold uppercase">
                                                            <XCircle size={12} /> Bị từ chối
                                                        </span>
                                                    )}
                                                    {!isIntent && req.note && !isBonus && <div className="text-[10px] text-slate-400 mt-1 max-w-[150px] truncate" title={req.note}>Lý do: {req.note}</div>}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-800 font-bold">{req.processed_by || '-'}</span>
                                                        {req.processed_at && (
                                                            <span className="text-[10px] text-slate-400">
                                                                {format(new Date(req.processed_at), 'HH:mm dd/MM')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )})
                                    )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 🔵 TỔNG HỢP TÀI CHÍNH KTV (PHA 3) */}
                <div className="pt-8">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-indigo-600 flex items-center gap-2 uppercase tracking-widest text-sm">
                            <Banknote size={18} /> Bảng thống kê Ví điện tử KTV
                        </h2>
                    </div>

                    {/* TABS */}
                    <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                        <button 
                            onClick={() => setActiveTab('TUA')}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all ${activeTab === 'TUA' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
                        >
                            <Zap size={16} className={activeTab === 'TUA' ? 'text-amber-300 fill-amber-300' : ''} />
                            Ví Tua (VNĐ)
                        </button>
                        <button 
                            onClick={() => setActiveTab('BONUS')}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all ${activeTab === 'BONUS' ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
                        >
                            <Star size={16} className={activeTab === 'BONUS' ? 'fill-white' : ''} />
                            Ví Bonus (Points)
                        </button>
                        <button 
                            onClick={() => setActiveTab('TICH_LUY')}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all ${activeTab === 'TICH_LUY' ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
                        >
                            <PiggyBank size={16} />
                            Ví Tích Luỹ
                        </button>

                        {/* BỘ LỌC NGÀY */}
                        <div className="ml-auto flex items-center gap-2">
                            <select 
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value as any)}
                                className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            >
                                <option value="ALL">Tất cả thời gian</option>
                                <option value="TODAY">Hôm nay</option>
                                <option value="CUSTOM">Tùy chọn...</option>
                            </select>

                            {filterType === 'CUSTOM' && (
                                <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <input 
                                        type="date" 
                                        value={fromDate}
                                        onChange={(e) => setFromDate(e.target.value)}
                                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600 font-medium focus:outline-none"
                                    />
                                    <span className="text-slate-400 font-black">-</span>
                                    <input 
                                        type="date" 
                                        value={toDate}
                                        onChange={(e) => setToDate(e.target.value)}
                                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600 font-medium focus:outline-none"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            {activeTab === 'TUA' && (
                            <table className="w-full text-sm text-left">
                                <thead className="bg-indigo-50 text-indigo-800 text-xs uppercase font-black whitespace-nowrap">
                                    <tr>
                                        <th className="px-6 py-4">Nhân viên</th>
                                        <th className="px-6 py-4 text-right">Tiền Tua</th>
                                        <th className="px-6 py-4 text-right">Tiền Tip</th>
                                        <th className="px-6 py-4 text-right">Thưởng/Phạt</th>
                                        <th className="px-6 py-4 text-right">Tổng thu nhập</th>
                                        <th className="px-6 py-4 text-right text-rose-600">Đã rút / Chờ</th>
                                        <th className="px-6 py-4 text-right text-emerald-600">Tiền khả dụng</th>
                                        <th className="px-6 py-4 text-center">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 font-medium">
                                    {summaries.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="px-6 py-8 text-center text-slate-400">Chưa có dữ liệu thống kê KTV</td>
                                        </tr>
                                    ) : (
                                        summaries.map((ktv) => (
                                            <tr key={ktv.id} className="hover:bg-indigo-50/30 whitespace-nowrap">
                                                <td className="px-6 py-4">
                                                    <span className="font-bold text-slate-800 block">{ktv.name}</span>
                                                    <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded-md inline-block mt-1">{ktv.id}</span>
                                                </td>
                                                <td className="px-6 py-4 text-right text-slate-600">{Number(ktv.total_commission || 0).toLocaleString()}đ</td>
                                                <td className="px-6 py-4 text-right text-slate-600">{Number(ktv.total_tip || 0).toLocaleString()}đ</td>
                                                <td className="px-6 py-4 text-right text-slate-600">
                                                    {(Number(ktv.total_bonus || 0) + Number(ktv.total_adjustment || 0) - Number(ktv.total_penalty || 0)).toLocaleString()}đ
                                                    {Number(ktv.total_bonus || 0) > 0 && (
                                                        <span className="block text-[9px] text-indigo-400 font-bold mt-0.5">
                                                            ★ {Number(ktv.total_bonus).toLocaleString()}đ
                                                        </span>
                                                    )}
                                                    {Number(ktv.total_adjustment || 0) !== 0 && (
                                                        <span className={`block text-[9px] font-bold mt-0.5 ${Number(ktv.total_adjustment) > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                            {Number(ktv.total_adjustment) > 0 ? '+' : ''}{Number(ktv.total_adjustment).toLocaleString()}đ
                                                        </span>
                                                    )}
                                                    {Number(ktv.total_penalty || 0) > 0 && (
                                                        <span className="block text-[9px] font-bold mt-0.5 text-rose-600">
                                                            - Phạt {Number(ktv.total_penalty).toLocaleString()}đ
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right font-black text-slate-800">{Number(ktv.gross_income || 0).toLocaleString()}đ</td>
                                                <td className="px-6 py-4 text-right text-rose-600">
                                                    <span className="font-bold">{Number(ktv.total_withdrawn || 0).toLocaleString()}đ</span>
                                                    {Number(ktv.total_pending || 0) > 0 && (
                                                        <span className="block text-[10px] text-amber-500 mt-0.5">(+{Number(ktv.total_pending).toLocaleString()}đ)</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right font-black text-emerald-600">
                                                    {Number(ktv.available_balance || 0).toLocaleString()}đ
                                                    <span className="block text-[9px] text-slate-400 font-bold mt-0.5" title="Bao gồm cọc">
                                                        - Cọc {(Number(ktv.min_deposit || 500000) / 1000)}k
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button 
                                                        onClick={() => handleOpenAdjustment(ktv.id, ktv.name)}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-bold transition-colors"
                                                    >
                                                        <Edit3 size={14} /> Thưởng / Phạt
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                            )}

                            {activeTab === 'BONUS' && (
                            <table className="w-full text-sm text-left">
                                <thead className="bg-amber-50 text-amber-800 text-xs uppercase font-black whitespace-nowrap">
                                    <tr>
                                        <th className="px-6 py-4">Nhân viên</th>
                                        <th className="px-6 py-4 text-right">Tổng điểm kiếm</th>
                                        <th className="px-6 py-4 text-right">Đã rút (Trừ)</th>
                                        <th className="px-6 py-4 text-right">Số điểm còn lại</th>
                                        <th className="px-6 py-4 text-right text-amber-600">Tương đương VNĐ</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 font-medium">
                                    {bonusSummaries.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-slate-400">Không có KTV nào được bật Ví Bonus hoặc chưa có dữ liệu</td>
                                        </tr>
                                    ) : (
                                        bonusSummaries.map((ktv) => (
                                            <tr key={ktv.id} className="hover:bg-amber-50/30 whitespace-nowrap">
                                                <td className="px-6 py-4">
                                                    <span className="font-bold text-slate-800 block">{ktv.name}</span>
                                                    <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest bg-amber-50 px-2 py-0.5 rounded-md inline-block mt-1">{ktv.id}</span>
                                                </td>
                                                <td className="px-6 py-4 text-right text-slate-600">{Number(ktv.totalEarned || 0).toLocaleString()} pts</td>
                                                <td className="px-6 py-4 text-right text-rose-600">{Number(ktv.totalRedeemed + ktv.totalDeducted || 0).toLocaleString()} pts</td>
                                                <td className="px-6 py-4 text-right font-black text-slate-800">{Number(ktv.currentBalance || 0).toLocaleString()} pts</td>
                                                <td className="px-6 py-4 text-right font-black text-amber-600">{Number(ktv.vndEquivalent || 0).toLocaleString()}đ</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                            )}

                            {activeTab === 'TICH_LUY' && (
                                <div className="p-12 text-center text-slate-400">
                                    <PiggyBank size={48} className="mx-auto mb-4 opacity-50" />
                                    <h3 className="font-bold text-lg mb-1 text-slate-600">Ví Tích Luỹ KTV</h3>
                                    <p className="text-sm">Bảng thống kê này đang được phát triển.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* MODAL THƯỞNG PHẠT */}
                {isAdjustmentModalOpen && selectedKtv && (
                    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                            <div className="bg-indigo-600 p-6 text-center relative">
                                <button 
                                    onClick={() => setIsAdjustmentModalOpen(false)}
                                    className="absolute top-4 right-4 text-white/50 hover:text-white"
                                >
                                    <XCircle size={24} />
                                </button>
                                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Edit3 size={32} className="text-white" />
                                </div>
                                <h3 className="text-xl font-black text-white">Điều chỉnh Thu Nhập</h3>
                                <p className="text-indigo-200 text-sm mt-1">KTV: {selectedKtv.name} ({selectedKtv.id})</p>
                            </div>
                            
                            <div className="p-6 space-y-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Loại điều chỉnh</label>
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <button 
                                            onClick={() => setAdjType('GIFT')}
                                            className={`py-3 rounded-xl font-bold text-sm border-2 transition-all ${adjType === 'GIFT' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-100 text-slate-400'}`}
                                        >
                                            Thưởng (+)
                                        </button>
                                        <button 
                                            onClick={() => setAdjType('PENALTY')}
                                            className={`py-3 rounded-xl font-bold text-sm border-2 transition-all ${adjType === 'PENALTY' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-100 text-slate-400'}`}
                                        >
                                            Phạt (-)
                                        </button>
                                    </div>

                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Áp dụng cho Ví</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button 
                                            onClick={() => setAdjWalletType('TUA')}
                                            className={`py-3 rounded-xl font-bold text-sm border-2 transition-all ${adjWalletType === 'TUA' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-100 text-slate-400'}`}
                                        >
                                            <Zap size={16} className="inline mr-1" /> Ví Tua
                                        </button>
                                        <button 
                                            onClick={() => setAdjWalletType('BONUS')}
                                            className={`py-3 rounded-xl font-bold text-sm border-2 transition-all ${adjWalletType === 'BONUS' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-100 text-slate-400'}`}
                                        >
                                            <Star size={16} className="inline mr-1" /> Ví Bonus
                                        </button>
                                    </div>
                                </div>


                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Số tiền (VNĐ)</label>
                                    <input 
                                        type="text" 
                                        value={adjAmount}
                                        onChange={(e) => {
                                            const val = e.target.value.replace(/[^0-9]/g, '');
                                            if (val) {
                                                setAdjAmount(Number(val).toLocaleString());
                                            } else {
                                                setAdjAmount('');
                                            }
                                        }}
                                        placeholder="Ví dụ: 500,000"
                                        className="w-full text-center text-2xl font-black text-slate-800 border-2 border-slate-200 rounded-2xl py-3 focus:outline-none focus:border-indigo-500 transition-colors"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Lý do</label>
                                    <textarea 
                                        value={adjReason}
                                        onChange={(e) => setAdjReason(e.target.value)}
                                        placeholder="Nhập lý do thưởng/phạt..."
                                        rows={3}
                                        className="w-full text-sm text-slate-800 border-2 border-slate-200 rounded-2xl p-4 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                                    />
                                </div>

                                <button 
                                    onClick={handleSubmitAdjustment}
                                    disabled={isProcessing || !adjAmount || !adjReason}
                                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                                >
                                    {isProcessing ? 'Đang xử lý...' : 'Xác nhận'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </AppLayout>
    );
}
