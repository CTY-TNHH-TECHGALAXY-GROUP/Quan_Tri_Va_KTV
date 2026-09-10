'use client';

import React, { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { walletLabel } from '@/lib/featureFlags';
import { useKTVWallet } from './KTVWallet.logic';
import { Zap, Clock, Banknote, TrendingDown, TrendingUp, Gift, Calendar, Star, XCircle, ChevronDown, Info, AlertCircle, Wallet } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '@/components/ui/Toast';

const THEME = {
  primary: 'bg-emerald-600',
  primaryMuted: 'bg-emerald-50',
  primaryText: 'text-emerald-600',
  textBase: 'text-slate-800',
  textMuted: 'text-slate-500',
  bgCard: 'bg-white',
  bgBody: 'bg-slate-50',
  border: 'border-slate-200',
  radius: 'rounded-[32px]'
};

export default function KTVWalletPage() {
    const { addToast } = useToast();
    const { 
        user, canViewWallet, activeTab, setActiveTab, canViewTua, canViewBonus,
        walletBalance, walletTimeline, bonusBalance, bonusTimeline,
        isLoading, submitWithdraw, submitRedeemBonus 
    } = useKTVWallet();

    const [withdrawModal, setWithdrawModal] = useState<{ isOpen: boolean, type: 'TUA' | 'BONUS', maxAmount: number, step?: 'INPUT' | 'CONFIRM' } | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [withdrawAmountStr, setWithdrawAmountStr] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    const handleOpenWithdrawModal = (type: 'TUA' | 'BONUS') => {
        if (type === 'TUA') {
            if (!walletBalance) return;
            const max = Number(walletBalance.effective_balance) - Number(walletBalance.min_deposit);
            // USER YÊU CẦU: Không chặn lệnh rút tiền
            // if (max <= 0) {
            //     alert('Số dư khả dụng của bạn chưa đạt mức tối thiểu để rút.');
            //     return;
            // }
            setWithdrawModal({ isOpen: true, type, maxAmount: Math.max(0, max) });
        } else {
            if (!bonusBalance || bonusBalance.points <= 0) {
                addToast('Bạn chưa có điểm thưởng nào để quy đổi.', 'error');
                return;
            }
            setWithdrawModal({ isOpen: true, type, maxAmount: bonusBalance.points });
        }
        setWithdrawAmountStr('');
    };

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.replace(/,/g, '').replace(/\D/g, '');
        if (!val) {
            setWithdrawAmountStr('');
            return;
        }
        setWithdrawAmountStr(Number(val).toLocaleString('en-US'));
    };

    const handleWithdrawAll = () => {
        if (!withdrawModal) return;
        setWithdrawAmountStr(withdrawModal.maxAmount.toLocaleString('en-US'));
    };

    const handleSubmitWithdraw = async () => {
        if (!withdrawModal) return;
        setFormError(null);
        const amount = Number(withdrawAmountStr.replace(/,/g, ''));
        if (!amount || amount <= 0 || isNaN(amount)) {
            setFormError(withdrawModal.type === 'TUA' ? 'Vui lòng nhập số tiền hợp lệ.' : 'Vui lòng nhập số điểm hợp lệ.');
            return;
        }

        if (withdrawModal.type === 'BONUS' && withdrawModal.step !== 'CONFIRM') {
            setWithdrawModal({ ...withdrawModal, step: 'CONFIRM' });
            return;
        }

        setIsSubmitting(true);
        let success = false;
        if (withdrawModal.type === 'TUA') {
            success = await submitWithdraw(amount);
        } else {
            success = await submitRedeemBonus(amount);
        }
        setIsSubmitting(false);
        if (success) {
            setWithdrawModal(null);
            setWithdrawAmountStr('');
        }
    };

    /**
     * Ví Điểm của KTV này lấy điểm từ ĐIỂM OFFICE chứ không phải điểm sao.
     * Server nói ra bằng `source`, client không tự đoán theo work_type — cờ bật
     * riêng từng người nên cùng là loại D vẫn có thể khác nguồn.
     */
    const isOfficeBonus = bonusBalance?.source === 'OFFICE';

    const groupedTimeline = useMemo(() => {
        // Lịch sử điểm Office là danh sách theo NGÀY CHẤM ĐIỂM, không phải giao
        // dịch cộng/trừ, nên không đi qua bộ gom chung — nó có danh sách riêng.
        if (activeTab === 'BONUS' && isOfficeBonus) return [];
        const sourceData = activeTab === 'TUA' ? walletTimeline : (activeTab === 'BONUS' ? bonusTimeline : []);
        if (!sourceData) return [];
        const groups: Record<string, any[]> = {};
        sourceData.forEach((item: any) => {
            const itemDate = item.created_at || item.date;
            const dateStr = new Date(itemDate).toLocaleDateString('vi-VN', {
                weekday: 'long',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(item);
        });
        return Object.entries(groups).map(([date, items]) => ({ date, items }));
    }, [activeTab, isOfficeBonus, walletTimeline, bonusTimeline]);

    if (!user || !canViewWallet) {
        return (
            <AppLayout>
                <div className="flex items-center justify-center h-screen bg-slate-50">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <TrendingDown size={32} />
                        </div>
                        <h1 className="text-2xl font-black text-slate-800 mb-2">Truy cập bị từ chối</h1>
                        <p className="text-slate-500">Bạn không có quyền truy cập vào Ví điện tử KTV.</p>
                    </div>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout>
            <div className="p-4 lg:p-8 space-y-6 max-w-2xl mx-auto pb-32">
                <div className="flex items-center justify-between mb-4">
                    <h1 className={`text-2xl font-black tracking-tight ${THEME.textBase}`}>
                        Hệ Sinh Thái Ví
                    </h1>
                </div>

                {/* DROPDOWN SELECTOR */}
                <div className="relative mb-6 z-30">
                    <button 
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl font-bold shadow-sm border transition-all ${
                            activeTab === 'TUA' ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-600/20' :
                            activeTab === 'BONUS' ? 'bg-amber-500 text-white border-amber-400 shadow-amber-500/20' :
                            'bg-indigo-600 text-white border-indigo-500 shadow-indigo-600/20'
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            {activeTab === 'TUA' && <><Zap size={20} className="text-amber-300 fill-amber-300" /> <span className="text-lg">{walletLabel('TUA', user?.work_type)}</span></>}
                            {activeTab === 'BONUS' && <><Star size={20} className="fill-white" /> <span className="text-lg">{walletLabel('BONUS', user?.work_type)}</span></>}
                        </div>
                        <ChevronDown size={20} className={`transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isDropdownOpen && (
                        <div className="absolute top-full mt-2 w-full bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2">
                            {canViewTua && (
                                <button 
                                    onClick={() => { setActiveTab('TUA'); setIsDropdownOpen(false); }}
                                    className={`flex items-center gap-3 px-5 py-4 transition-all ${activeTab === 'TUA' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
                                >
                                    <Zap size={20} className={activeTab === 'TUA' ? 'text-emerald-500' : 'text-slate-400'} />
                                    <span className="font-bold">{walletLabel('TUA', user?.work_type)}</span>
                                </button>
                            )}
                            {canViewBonus && (
                                <button 
                                    onClick={() => { setActiveTab('BONUS'); setIsDropdownOpen(false); }}
                                    className={`flex items-center gap-3 px-5 py-4 transition-all ${activeTab === 'BONUS' ? 'bg-amber-50 text-amber-600' : 'text-slate-600 hover:bg-slate-50'}`}
                                >
                                    <Star size={20} className={activeTab === 'BONUS' ? 'text-amber-500' : 'text-slate-400'} />
                                    <span className="font-bold">{walletLabel('BONUS', user?.work_type)}</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {isLoading ? (
                    <div className="flex justify-center items-center py-20">
                        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (!canViewTua && !canViewBonus) ? (
                    /* Tắt sạch mọi ví thì nói thẳng, đừng để màn hình trống hay
                       hiện 0đ — KTV sẽ tưởng mất tiền chứ không nghĩ là bị tắt. */
                    <div className="text-center py-20 px-6">
                        <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Wallet size={32} />
                        </div>
                        <h2 className="text-xl font-black text-slate-800 mb-2">Ví đang bảo trì</h2>
                        <p className="text-slate-500 text-sm max-w-xs mx-auto">
                            Hệ thống đang bảo trì ví. Số dư của bạn vẫn được giữ nguyên.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Ví Thu Nhập (KTV Wallet) */}
                        {activeTab === 'TUA' && walletBalance && (
                            <div className={`p-6 rounded-[32px] shadow-lg shadow-emerald-900/10 bg-gradient-to-br from-emerald-600 to-teal-800 text-white`}>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-emerald-100 flex items-center gap-2 uppercase tracking-widest text-[11px]">
                                        <Zap size={16} className="text-amber-300 fill-amber-300" />
                                        Số Dư Thực Tế
                                    </h3>
                                    <span className="text-[10px] bg-white/20 px-2 py-1 rounded-lg font-bold">VNĐ</span>
                                </div>
                                <div className="mb-5">
                                    <p className="text-[10px] text-emerald-200 uppercase tracking-widest mb-1">Số dư khả dụng</p>
                                    <p className="text-4xl font-black tracking-tight drop-shadow-sm">
                                        {Number(walletBalance.available_balance || 0).toLocaleString()}đ
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-xs p-3 bg-black/10 rounded-2xl mb-4">
                                    <div>
                                        <p className="text-emerald-200/70 text-[10px] uppercase mb-0.5">Số dư hiện tại</p>
                                        <p className="font-bold">{Number(walletBalance.net_balance || 0).toLocaleString()}đ</p>
                                    </div>
                                    <div>
                                        <p className="text-emerald-200/70 text-[10px] uppercase mb-0.5">Đang chờ duyệt</p>
                                        <p className="font-bold text-amber-300">{Number(walletBalance.total_pending || 0).toLocaleString()}đ</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => handleOpenWithdrawModal('TUA')}
                                    className="w-full py-3.5 bg-white text-emerald-700 font-black rounded-2xl text-xs uppercase tracking-widest active:scale-[0.98] transition-transform shadow-lg shadow-white/10 flex justify-center items-center gap-2"
                                >
                                    <Banknote size={16} /> Tạo Lệnh Rút Tiền
                                </button>
                            </div>
                        )}

                        {/* Ví Điểm — nguồn ĐIỂM OFFICE.
                            Không có nút quy đổi: điểm Office là thang chất lượng,
                            hệ quả tiền duy nhất là mức quỹ nội bộ phải đóng. */}
                        {activeTab === 'BONUS' && bonusBalance && isOfficeBonus && (
                            <div className="p-6 rounded-[32px] shadow-lg shadow-amber-900/10 bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-amber-100 flex items-center gap-2 uppercase tracking-widest text-[11px]">
                                        <Star size={16} className="fill-amber-100" />
                                        Điểm Office tháng {String(bonusBalance.month || '').slice(5)}
                                    </h3>
                                    <span className="text-[10px] bg-white/20 px-2 py-1 rounded-lg font-bold">ĐIỂM</span>
                                </div>

                                {/* Chưa có ngày công nào thì KHÔNG vẽ điểm và KHÔNG vẽ mức quỹ.
                                    Điểm tháng là trung bình cộng — không có mẫu số thì con số
                                    100 chỉ là giá trị kỹ thuật, hiện ra là nói KTV làm việc
                                    hoàn hảo và được miễn sạch quỹ, cả hai đều sai. */}
                                {bonusBalance.hasData === false ? (
                                    <div className="p-4 rounded-2xl bg-black/15 text-center">
                                        <p className="text-lg font-black">Chưa có dữ liệu</p>
                                        <p className="text-[12px] font-medium text-amber-100/90 mt-1">
                                            Tháng này bạn chưa có ngày công nào. Điểm Office và mức quỹ
                                            sẽ hiện sau buổi đi làm đầu tiên.
                                        </p>
                                    </div>
                                ) : (
                                  <>
                                    <div className="mb-5">
                                        <p className="text-4xl font-black tracking-tight drop-shadow-sm flex items-baseline gap-1">
                                            {Number(bonusBalance.points ?? 0).toLocaleString('vi-VN')}
                                            <span className="text-xl font-bold">/ 100</span>
                                        </p>
                                        <p className="text-xs text-amber-100/90 font-medium mt-1">
                                            Trung bình {Number(bonusBalance.avg ?? 0).toLocaleString('vi-VN')}đ/ngày
                                            {Number(bonusBalance.repeatPenalty) > 0
                                                && ` · trừ thêm ${Number(bonusBalance.repeatPenalty).toLocaleString('vi-VN')}đ do lỗi lặp`}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 text-xs p-3 bg-black/10 rounded-2xl mb-4">
                                        <div>
                                            <p className="text-amber-100/70 text-[10px] uppercase mb-0.5">Ngày đi làm</p>
                                            <p className="font-bold">{bonusBalance.workDays ?? 0} ngày</p>
                                        </div>
                                        <div>
                                            <p className="text-amber-100/70 text-[10px] uppercase mb-0.5">Ngày không lỗi</p>
                                            <p className="font-bold">{bonusBalance.cleanDays ?? 0} ngày</p>
                                        </div>
                                    </div>

                                    {/* Hệ quả tiền DUY NHẤT của điểm Office. Hiện số CÒN PHẢI ĐÓNG,
                                        không hiện số được miễn — KTV cần biết mình nợ bao nhiêu. */}
                                    <div className={`p-4 rounded-2xl ${Number(bonusBalance.fundDue) > 0 ? 'bg-black/20' : 'bg-white/20'}`}>
                                        <p className="text-[10px] uppercase tracking-widest text-amber-100/80 mb-1">
                                            Quỹ nội bộ tháng này còn phải đóng
                                        </p>
                                        <p className="text-2xl font-black">
                                            {Number(bonusBalance.fundDue ?? 0).toLocaleString('vi-VN')}đ
                                            <span className="text-xs font-bold text-amber-100/70">
                                                {' '}/ {Number(bonusBalance.fundBase ?? 250000).toLocaleString('vi-VN')}đ
                                            </span>
                                        </p>
                                        <p className="text-[11px] font-medium text-amber-100/90 mt-1">
                                            {Number(bonusBalance.exemptPct) > 0
                                                ? `Đang được miễn ${bonusBalance.exemptPct}% nhờ điểm tháng.`
                                                : 'Chưa đạt bậc miễn nào — giữ điểm trên 85 để bắt đầu được miễn.'}
                                        </p>
                                    </div>

                                    <p className="text-[11px] text-amber-100/80 font-medium mt-3 text-center">
                                        Điểm Office không quy đổi ra tiền. Điểm chỉ quyết định mức quỹ phải đóng.
                                    </p>
                                  </>
                                )}
                            </div>
                        )}

                        {/* Lịch sử điểm Office theo từng ngày */}
                        {activeTab === 'BONUS' && isOfficeBonus && bonusTimeline.length > 0 && (
                            <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 space-y-3">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    Chi tiết từng ngày
                                </h4>
                                {bonusTimeline.map((d: any) => (
                                    <div key={d.date} className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-bold text-slate-700">
                                                {new Date(d.date + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                                            </p>
                                            <p className={`text-sm font-black ${d.deducted > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                {d.dayScore}đ
                                            </p>
                                        </div>
                                        {d.hits?.length > 0 && (
                                            <ul className="mt-1.5 space-y-1">
                                                {d.hits.map((h: any, i: number) => (
                                                    <li key={i} className="text-xs text-slate-500 flex justify-between gap-3">
                                                        <span>
                                                            {h.label}
                                                            {/* Mỗi ảnh một link riêng — trang Ví không có khung xem ảnh,
                                                                mở thẳng ảnh trong tab mới là đủ để KTV đối chiếu. */}
                                                            {(h.photoUrls || []).length > 0
                                                                ? h.photoUrls.map((u: string, k: number) => (
                                                                    <a
                                                                        key={k}
                                                                        href={u}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="text-rose-600 font-bold underline underline-offset-2"
                                                                    > · 📷 Ảnh {k + 1}</a>
                                                                  ))
                                                                : h.photoCount > 0 && <span className="text-slate-400"> · {h.photoCount} ảnh</span>}
                                                            {h.note && <span className="text-slate-400"> · {h.note}</span>}
                                                        </span>
                                                        <span className="font-bold text-rose-500 shrink-0">−{h.points}đ</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Ví Bonus — nguồn điểm sao khách chấm */}
                        {activeTab === 'BONUS' && bonusBalance && !isOfficeBonus && (
                            <div className={`p-6 rounded-[32px] shadow-lg shadow-amber-900/10 bg-gradient-to-br from-amber-500 to-orange-600 text-white`}>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-amber-100 flex items-center gap-2 uppercase tracking-widest text-[11px]">
                                        <Star size={16} className="fill-amber-100" />
                                        Điểm Thưởng Tích Luỹ
                                    </h3>
                                    <span className="text-[10px] bg-white/20 px-2 py-1 rounded-lg font-bold">ĐIỂM</span>
                                </div>
                                <div className="mb-5 flex flex-col gap-1">
                                    <div className="flex items-end gap-2">
                                        <p className="text-4xl font-black tracking-tight drop-shadow-sm flex items-baseline gap-1">
                                            {Number(bonusBalance.points || 0).toLocaleString()} <span className="text-xl font-bold">điểm</span>
                                        </p>
                                    </div>
                                    <p className="text-xs text-amber-100/90 font-medium">
                                        (Tương đương <span className="font-bold text-white">{Number(bonusBalance.vnd_value || 0).toLocaleString()}đ</span>)
                                    </p>
                                </div>
                                
                                <button 
                                    onClick={() => handleOpenWithdrawModal('BONUS')}
                                    className="w-full py-3.5 bg-white text-orange-700 font-black rounded-2xl text-xs uppercase tracking-widest active:scale-[0.98] transition-transform shadow-lg shadow-white/10 flex justify-center items-center gap-2"
                                >
                                    <Banknote size={16} /> Yêu Cầu Quy Đổi Tiền
                                </button>
                            </div>
                        )}

                        {groupedTimeline.length > 0 ? (
                            <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="font-black tracking-tight text-slate-800 text-sm uppercase flex items-center gap-2">
                                        <Clock size={16} className="text-emerald-500" /> Lịch sử giao dịch
                                    </h3>
                                    <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">
                                        Tháng {new Date().getMonth() + 1}/{new Date().getFullYear()}
                                    </span>
                                </div>
                                
                                <div className="space-y-8">
                                    {groupedTimeline.map((group, gIdx) => (
                                        <div key={gIdx} className="space-y-4 relative">
                                            <div className="sticky top-0 bg-white/90 backdrop-blur z-20 py-2 border-b border-slate-100 mb-4 flex items-center gap-2">
                                                <Calendar size={14} className="text-slate-400" />
                                                <h4 className="text-xs font-bold text-slate-600 capitalize">{group.date}</h4>
                                            </div>

                                            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-100 before:to-transparent">
                                                {group.items.map((item: any, idx: number) => {
                                                    const isPositive = activeTab === 'BONUS' ? (item.type === 'EARN' || item.type === 'GIFT') : Number(item.amount) >= 0;
                                                    const isWithdrawal = activeTab === 'BONUS' ? item.type === 'REDEEM' : item.type === 'WITHDRAWAL';
                                                    const isPending = item.status === 'PENDING';
                                                    const isRejected = item.status === 'REJECTED';
                                                    
                                                    let Icon = Zap;
                                                    let iconColor = 'text-slate-500';
                                                    if (activeTab === 'BONUS') {
                                                        Icon = item.type === 'EARN' ? Star : (item.type === 'REDEEM' ? TrendingDown : TrendingDown);
                                                        iconColor = item.type === 'EARN' ? 'text-amber-500 fill-amber-500' : 'text-rose-500';
                                                    } else {
                                                        Icon = item.type === 'TIP' ? Gift : (item.type === 'COMMISSION' ? Banknote : (item.type === 'WITHDRAWAL' ? TrendingDown : (item.type === 'GIFT' ? TrendingUp : Zap)));
                                                        iconColor = item.type === 'TIP' ? 'text-emerald-500' : (item.type === 'COMMISSION' ? 'text-indigo-500' : (item.type === 'WITHDRAWAL' ? 'text-rose-500' : (item.type === 'GIFT' ? 'text-amber-500' : 'text-slate-500')));
                                                    }

                                                    const titleText = activeTab === 'BONUS' ? (item.desc || item.type) : item.title;
                                                    const noteText = activeTab === 'BONUS' ? null : item.note;
                                                    const displayAmount = activeTab === 'BONUS' ? Math.abs(Number(item.points)) : Math.abs(Number(item.amount));

                                                    // Một cột thẳng, KHÔNG so le.
                                                    //
                                                    // ⚠️ Trước đây bố cục zigzag (`md:odd:flex-row-reverse`
                                                    // + thẻ rộng 50%) ném hai dòng của CÙNG một đơn —
                                                    // tiền tua và thuế — ra hai bên đối diện. Nhìn không
                                                    // ra chúng đi cặp, KTV tưởng thứ tự bị lộn.
                                                    return (
                                                        <div key={item.id || idx} className="relative flex items-center justify-between md:justify-normal group is-active">
                                                            <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-slate-100 shadow shrink-0 z-10 ${isRejected ? 'opacity-50' : ''} ${iconColor}`}>
                                                                <Icon size={16} />
                                                            </div>
                                                            <div className={`w-[calc(100%-4rem)] bg-white p-4 rounded-2xl border ${isRejected ? 'border-dashed border-slate-200 opacity-60' : 'border-slate-100'} shadow-sm transition-all hover:shadow-md`}>
                                                                <div className="flex items-center justify-between mb-1">
                                                                    <span className={`font-bold text-xs line-clamp-2 pr-2 ${isRejected ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{titleText}</span>
                                                                    <span className={`font-black text-sm whitespace-nowrap ${isRejected ? 'text-slate-400 line-through' : isWithdrawal ? 'text-rose-600' : isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                        {isPositive ? '+' : '-'}{displayAmount.toLocaleString()}{activeTab === 'BONUS' ? ' điểm' : 'đ'}
                                                                    </span>
                                                                </div>
                                                                {noteText && <div className={`mt-1.5 text-[10px] p-2 rounded-lg ${isRejected ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>{noteText}</div>}
                                                                <div className="flex items-center justify-between mt-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-[10px] text-slate-400 font-medium">
                                                                            {new Date(item.created_at || item.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                                                                        </span>
                                                                        {activeTab === 'TUA' && item.type !== 'TIP' && !isRejected && (
                                                                            <span className="text-[10px] text-slate-400 font-medium border-l border-slate-200 pl-2">
                                                                                Số dư: <span className="font-bold text-slate-600">{Number(item.running_balance || 0).toLocaleString()}đ</span>
                                                                            </span>
                                                                        )}
                                                                        {activeTab === 'BONUS' && !isRejected && (
                                                                            <span className="text-[10px] text-slate-400 font-medium border-l border-slate-200 pl-2">
                                                                                Số dư: <span className="font-bold text-slate-600">{Number(item.running_balance || 0).toLocaleString()} điểm</span>
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex gap-1">
                                                                        {isPending && (
                                                                            <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Chờ duyệt</span>
                                                                        )}
                                                                        {item.type === 'WITHDRAWAL' && item.status === 'APPROVED' && (
                                                                            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Đã nhận</span>
                                                                        )}
                                                                        {isRejected && (
                                                                            <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">Từ chối</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 text-center">
                                <Clock className="mx-auto text-slate-300 mb-4" size={32} />
                                <h3 className="text-sm font-bold text-slate-600 mb-1">Chưa có giao dịch</h3>
                                <p className="text-xs text-slate-400">Các giao dịch tài chính của bạn sẽ xuất hiện tại đây.</p>
                            </div>
                        )}
                    </>
                )}
            </div>

            {withdrawModal && withdrawModal.isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 relative">
                        <button 
                            onClick={() => setWithdrawModal(null)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 bg-slate-50 p-1.5 rounded-full transition-colors"
                        >
                            <XCircle size={24} />
                        </button>
                        <div className="text-center mb-6 mt-2">
                            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${withdrawModal.type === 'TUA' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-500'}`}>
                                <Banknote size={32} />
                            </div>
                            <h3 className="text-xl font-black text-slate-800">
                                {withdrawModal.type === 'TUA' ? 'Rút Tiền Mặt' : 'Quy Đổi Điểm'}
                            </h3>
                            <p className="text-sm text-slate-500 mt-1">
                                {withdrawModal.type === 'TUA' ? 'Nhập số tiền bạn muốn rút' : 'Nhập số điểm bạn muốn quy đổi'}
                            </p>
                        </div>
                        
                        <div className="space-y-4">
                            {withdrawModal.step === 'CONFIRM' ? (
                                <div className="py-4 text-center space-y-4">
                                    <div className="w-16 h-16 mx-auto bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
                                        <AlertCircle size={32} />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-800">Xác Nhận Quy Đổi</h3>
                                    <p className="text-slate-600">Bạn đang yêu cầu quy đổi <span className="font-bold text-amber-600">{withdrawAmountStr} điểm</span> thành <span className="font-bold text-amber-600">{(Number(withdrawAmountStr.replace(/,/g, '')) * 1000).toLocaleString('vi-VN')} VNĐ</span>.</p>
                                    <p className="text-sm font-semibold text-slate-500">Đồng ý thực hiện?</p>
                                </div>
                            ) : (
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                                            {withdrawModal.type === 'TUA' ? 'Số tiền rút' : 'Số điểm quy đổi'}
                                        </label>
                                        <span className="text-xs font-medium text-slate-500">
                                            Tối đa: <span className={`font-bold ${withdrawModal.type === 'TUA' ? 'text-emerald-600' : 'text-amber-500'}`}>{withdrawModal.maxAmount.toLocaleString('en-US')}</span>
                                        </span>
                                    </div>
                                    {withdrawModal.type === 'TUA' ? (
                                        <div className="relative">
                                            <input 
                                                type="text" 
                                                inputMode="numeric"
                                                value={withdrawAmountStr}
                                                onChange={handleAmountChange}
                                                placeholder="0"
                                                className="w-full text-2xl font-black text-slate-800 border-2 rounded-2xl p-4 pr-16 outline-none transition-colors focus:border-emerald-500 border-slate-200"
                                            />
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                                                VNĐ
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-3">
                                            {[50, 100, 200, 500].map(amount => (
                                                <button
                                                    key={amount}
                                                    onClick={() => setWithdrawAmountStr(amount.toString())}
                                                    className={`py-4 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1 ${
                                                        withdrawAmountStr === amount.toString()
                                                            ? 'border-amber-500 bg-amber-50 text-amber-600'
                                                            : 'border-slate-200 text-slate-500 hover:border-amber-200 hover:bg-amber-50/50'
                                                    }`}
                                                >
                                                    <span className="text-xl font-black">{amount} Điểm</span>
                                                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                                                        = {(amount * 1000).toLocaleString('en-US')} VNĐ
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {formError && (
                                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2 flex items-center gap-2 text-left">
                                    <AlertCircle size={14} className="shrink-0" />
                                    <span>{formError}</span>
                                </div>
                            )}

                            {withdrawModal.type === 'TUA' && withdrawModal.step !== 'CONFIRM' && (
                                <button 
                                    onClick={handleWithdrawAll}
                                    className="w-full py-2.5 rounded-xl text-sm font-bold border-2 transition-colors border-emerald-100 text-emerald-600 hover:bg-emerald-50"
                                >
                                    Rút hết toàn bộ
                                </button>
                            )}

                            {withdrawModal.step === 'CONFIRM' ? (
                                <div className="flex gap-3">
                                    <button 
                                        onClick={() => setWithdrawModal({ ...withdrawModal, step: 'INPUT' })}
                                        className="flex-1 py-4 bg-slate-100 text-slate-700 font-bold rounded-2xl text-sm uppercase tracking-widest hover:bg-slate-200"
                                    >
                                        Quay lại
                                    </button>
                                    <button 
                                        onClick={handleSubmitWithdraw}
                                        disabled={isSubmitting}
                                        className={`flex-1 py-4 text-white font-black rounded-2xl text-sm uppercase tracking-widest active:scale-[0.98] transition-all disabled:opacity-50 bg-amber-500 shadow-lg shadow-amber-500/20`}
                                    >
                                        {isSubmitting ? 'Đang xử lý...' : 'Xác Nhận'}
                                    </button>
                                </div>
                            ) : (
                                <button 
                                    onClick={handleSubmitWithdraw}
                                    disabled={!withdrawAmountStr || isSubmitting}
                                    className={`w-full py-4 text-white font-black rounded-2xl text-sm uppercase tracking-widest active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${withdrawModal.type === 'TUA' ? 'bg-emerald-600 shadow-lg shadow-emerald-600/20' : 'bg-amber-500 shadow-lg shadow-amber-500/20'}`}
                                >
                                    {isSubmitting ? 'Đang xử lý...' : 'Xác Nhận'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </AppLayout>
    );
}
