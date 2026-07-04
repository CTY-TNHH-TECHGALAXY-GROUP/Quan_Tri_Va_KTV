'use client';

import { usePiggyBankAdminLogic } from './PiggyBankAdmin.logic';
import { PiggyBank, RefreshCw, Save, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';

export default function PiggyBankAdminPage() {
    const {
        records,
        totalWeeks,
        loading,
        editingData,
        savingId,
        handleAmountChange,
        handleWeeksChange,
        handleStatusChange,
        saveAmount,
        refresh
    } = usePiggyBankAdminLogic();

    return (
        <AppLayout title="Quản Lý Ví Tích Lũy">
            <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <PiggyBank className="text-indigo-600" />
                        Quản Lý Ví Tích Lũy
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Thiết lập số tiền khấu trừ hàng tuần từ ví tua sang ví tích lũy của KTV (Mục tiêu: {totalWeeks} tuần).
                    </p>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={refresh}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        Làm mới
                    </button>
                    <Link href="/finance/ktv" className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors">
                        Quay lại Ví KTV
                    </Link>
                </div>
            </div>

            {/* Content Card */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-slate-500">Đang tải dữ liệu...</div>
                ) : records.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                        Chưa có KTV nào được bật tính năng Ví Tích Lũy. (Vào Hồ sơ KTV để bật)
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-sm text-slate-600">
                                    <th className="p-4 font-semibold">Mã KTV</th>
                                    <th className="p-4 font-semibold">Tên KTV</th>
                                    <th className="p-4 font-semibold">Số tiền/tuần (VNĐ)</th>
                                    <th className="p-4 font-semibold text-center">Tiến độ tuần</th>
                                    <th className="p-4 font-semibold text-right">Tổng tích lũy</th>
                                    <th className="p-4 font-semibold text-center">Trạng thái</th>
                                    <th className="p-4 font-semibold text-center">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {records.map(record => {
                                    const currentAmount = editingData[record.staff_id]?.amount ?? record.weekly_amount;
                                    const currentWeeks = editingData[record.staff_id]?.weeks ?? record.contributed_weeks;
                                    const currentStatus = editingData[record.staff_id]?.status ?? record.status ?? 'ACTIVE';
                                    const isChanged = currentAmount !== record.weekly_amount || currentWeeks !== record.contributed_weeks || currentStatus !== (record.status ?? 'ACTIVE');
                                    const totalSaved = currentWeeks * currentAmount;
                                    
                                    return (
                                        <tr key={record.staff_id} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-4 font-medium text-slate-700">{record.staff_id}</td>
                                            <td className="p-4 text-slate-600">{record.full_name}</td>
                                            <td className="p-4">
                                                <div className="relative">
                                                    <input
                                                        type="text"
                                                        value={currentAmount.toLocaleString('vi-VN')}
                                                        onChange={(e) => handleAmountChange(record.staff_id, e.target.value)}
                                                        className={`w-32 px-3 py-2 border rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${isChanged ? 'border-amber-400 bg-amber-50' : 'border-slate-300'}`}
                                                    />
                                                    <span className="absolute right-3 top-2.5 text-slate-400 text-sm pointer-events-none hidden sm:inline">đ</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <div className="inline-flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={currentWeeks}
                                                        onChange={(e) => handleWeeksChange(record.staff_id, e.target.value)}
                                                        className={`w-16 px-2 py-1.5 border rounded-lg text-center font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${currentWeeks !== record.contributed_weeks ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-300 text-indigo-600 bg-indigo-50/50'}`}
                                                    />
                                                    <span className="text-slate-400 font-medium">/ {totalWeeks}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-right font-medium text-emerald-600">
                                                {totalSaved.toLocaleString('vi-VN')}đ
                                            </td>
                                            <td className="p-4 text-center">
                                                <select
                                                    value={currentStatus}
                                                    onChange={(e) => handleStatusChange(record.staff_id, e.target.value)}
                                                    className={`px-3 py-1.5 border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${
                                                        currentStatus !== (record.status ?? 'ACTIVE') ? 'border-amber-400 bg-amber-50 text-amber-700' : 
                                                        currentStatus === 'COMPLETED' ? 'border-emerald-300 text-emerald-600 bg-emerald-50/50' : 
                                                        currentStatus === 'CANCELLED' ? 'border-red-300 text-red-600 bg-red-50/50' :
                                                        'border-slate-300 text-blue-600 bg-blue-50/50'
                                                    }`}
                                                >
                                                    <option value="ACTIVE">Đang chạy</option>
                                                    <option value="COMPLETED">Đã xong</option>
                                                    <option value="CANCELLED">Đã huỷ</option>
                                                </select>
                                            </td>
                                            <td className="p-4 text-center">
                                                <button
                                                    onClick={() => saveAmount(record.staff_id)}
                                                    disabled={!isChanged || savingId === record.staff_id}
                                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 mx-auto transition-all ${
                                                        !isChanged 
                                                            ? 'text-slate-400 bg-slate-100 cursor-not-allowed' 
                                                            : savingId === record.staff_id 
                                                                ? 'text-white bg-indigo-400' 
                                                                : 'text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-600/20'
                                                    }`}
                                                >
                                                    {savingId === record.staff_id ? (
                                                        <RefreshCw size={14} className="animate-spin" />
                                                    ) : !isChanged ? (
                                                        <CheckCircle2 size={14} />
                                                    ) : (
                                                        <Save size={14} />
                                                    )}
                                                    Lưu
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            </div>
        </AppLayout>
    );
}
