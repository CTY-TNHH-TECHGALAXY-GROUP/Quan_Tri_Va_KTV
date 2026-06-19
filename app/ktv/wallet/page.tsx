'use client';

import React, { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useKTVWallet } from './KTVWallet.logic';
import { Zap, Clock, Banknote, TrendingDown, TrendingUp, Gift, Calendar, Star, PiggyBank, XCircle } from 'lucide-react';

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
    const { 
        user, canViewWallet, activeTab, setActiveTab, canViewBonus, canViewPiggyBank,
        walletBalance, walletTimeline, bonusBalance, bonusTimeline, 
        isLoading, submitWithdraw, submitRedeemBonus 
    } = useKTVWallet();

    const [withdrawModal, setWithdrawModal] = useState<{ isOpen: boolean, type: 'TUA' | 'BONUS', maxAmount: number } | null>(null);
    const [withdrawAmountStr, setWithdrawAmountStr] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

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
                alert('Bạn chưa có điểm thưởng nào để quy đổi.');
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
        const amount = Number(withdrawAmountStr.replace(/,/g, ''));
        if (!amount || amount <= 0 || isNaN(amount)) {
            alert(withdrawModal.type === 'TUA' ? 'Vui lòng nhập số tiền hợp lệ.' : 'Vui lòng nhập số điểm hợp lệ.');
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

    const groupedTimeline = useMemo(() => {
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
    }, [activeTab, walletTimeline, bonusTimeline]);

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

                {/* TABS */}
                <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
                    <button 
                        onClick={() => setActiveTab('TUA')}
                        className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold whitespace-nowrap transition-all ${activeTab === 'TUA' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'bg-white text-slate-500 hover:bg-slate-100'}`}
                    >
                        <Zap size={18} className={activeTab === 'TUA' ? 'text-amber-300 fill-amber-300' : ''} />
                        Ví Tua
                    </button>
                    {canViewBonus && (
                        <button 
                            onClick={() => setActiveTab('BONUS')}
                            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold whitespace-nowrap transition-all ${activeTab === 'BONUS' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-white text-slate-500 hover:bg-slate-100'}`}
                        >
                            <Star size={18} className={activeTab === 'BONUS' ? 'fill-white' : ''} />
                            Ví Bonus
                        </button>
                    )}
                    {canViewPiggyBank && (
                        <button 
                            onClick={() => setActiveTab('TICH_LUY')}
                            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-bold whitespace-nowrap transition-all ${activeTab === 'TICH_LUY' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-white text-slate-500 hover:bg-slate-100'}`}
                        >
                            <PiggyBank size={18} />
                            Ví Tích Luỹ
                        </button>
                    )}
                </div>

                {isLoading ? (
                    <div className="flex justify-center items-center py-20">
                        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
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

                        {/* Ví Bonus */}
                        {activeTab === 'BONUS' && bonusBalance && (
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

                        {/* Ví Tích Luỹ */}
                        {activeTab === 'TICH_LUY' && (
                            <div className={`p-8 text-center rounded-[32px] shadow-lg shadow-indigo-900/10 bg-gradient-to-br from-indigo-500 to-purple-700 text-white`}>
                                <PiggyBank size={48} className="mx-auto mb-4 opacity-50" />
                                <h3 className="font-black text-xl mb-2">Ví Tích Luỹ</h3>
                                <p className="text-sm text-indigo-100/80">Tính năng này đang được phát triển, vui lòng quay lại sau.</p>
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

                                            <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-100 before:to-transparent">
                                                {group.items.map((item: any, idx: number) => {
                                                    const isPositive = activeTab === 'BONUS' ? Number(item.points) > 0 : Number(item.amount) >= 0;
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
                                                    const displayAmount = activeTab === 'BONUS' ? Math.abs(Number(item.points)) : Number(item.amount);

                                                    return (
                                                        <div key={item.id || idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                                                            <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-slate-100 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 ${isRejected ? 'opacity-50' : ''} ${iconColor}`}>
                                                                <Icon size={16} />
                                                            </div>
                                                            <div className={`w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded-2xl border ${isRejected ? 'border-dashed border-slate-200 opacity-60' : 'border-slate-100'} shadow-sm transition-all hover:shadow-md`}>
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

                            {withdrawModal.type === 'TUA' && (
                                <button 
                                    onClick={handleWithdrawAll}
                                    className="w-full py-2.5 rounded-xl text-sm font-bold border-2 transition-colors border-emerald-100 text-emerald-600 hover:bg-emerald-50"
                                >
                                    Rút hết toàn bộ
                                </button>
                            )}

                            <button 
                                onClick={handleSubmitWithdraw}
                                disabled={!withdrawAmountStr || isSubmitting}
                                className={`w-full py-4 text-white font-black rounded-2xl text-sm uppercase tracking-widest active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${withdrawModal.type === 'TUA' ? 'bg-emerald-600 shadow-lg shadow-emerald-600/20' : 'bg-amber-500 shadow-lg shadow-amber-500/20'}`}
                            >
                                {isSubmitting ? 'Đang xử lý...' : 'Xác Nhận'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AppLayout>
    );
}
