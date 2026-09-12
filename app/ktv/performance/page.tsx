'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ShieldAlert, TrendingUp, Star, DollarSign, Calendar, CheckCircle2 } from 'lucide-react';
import * as Progress from '@radix-ui/react-progress';
import { useKTVPerformance } from './Performance.logic';
import { t } from './Performance.i18n';

export default function KTVPerformancePage() {
    const { mounted, canAccessPage, kpiData, incomeData } = useKTVPerformance();

    if (!mounted) return null;

    if (!canAccessPage) {
        return (
            <AppLayout title="Hiệu Suất">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">{t.noAccess}</h2>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title="Hiệu Suất">
            <div className="space-y-6 max-w-4xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <p className="text-sm text-gray-500">{t.pageSubtitle}</p>
                    </div>
                    <div className="flex gap-2">
                        <button className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors flex items-center gap-2">
                            <Calendar size={16} />
                            {t.thisMonth}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* KPI Section */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-6">
                            <TrendingUp size={20} className="text-indigo-500" />
                            {t.kpiTitle}
                        </h2>

                        <div className="space-y-6">
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-gray-600 font-medium">{t.kpiAttendance}</span>
                                    <span className="text-emerald-600 font-bold">{kpiData.attendance.value}%</span>
                                </div>
                                <Progress.Root className="h-2 bg-gray-100 rounded-full overflow-hidden" value={kpiData.attendance.value}>
                                    <Progress.Indicator className="h-full bg-emerald-500 transition-all duration-500" style={{ transform: `translateX(${kpiData.attendance.progress}%)` }} />
                                </Progress.Root>
                                <p className="text-xs text-gray-500 mt-1">{t.kpiAttendanceNote}</p>
                            </div>

                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-gray-600 font-medium">{t.kpiProcess}</span>
                                    <span className="text-indigo-600 font-bold">{kpiData.process.value}%</span>
                                </div>
                                <Progress.Root className="h-2 bg-gray-100 rounded-full overflow-hidden" value={kpiData.process.value}>
                                    <Progress.Indicator className="h-full bg-indigo-500 transition-all duration-500" style={{ transform: `translateX(${kpiData.process.progress}%)` }} />
                                </Progress.Root>
                                <p className="text-xs text-gray-500 mt-1">{t.kpiProcessNote}</p>
                            </div>

                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-gray-600 font-medium">{t.kpiAttitude}</span>
                                    <span className="text-indigo-600 font-bold">{kpiData.attitude.value}%</span>
                                </div>
                                <Progress.Root className="h-2 bg-gray-100 rounded-full overflow-hidden" value={kpiData.attitude.value}>
                                    <Progress.Indicator className="h-full bg-indigo-500 transition-all duration-500" style={{ transform: `translateX(${kpiData.attitude.progress}%)` }} />
                                </Progress.Root>
                                <p className="text-xs text-gray-500 mt-1">{t.kpiAttitudeNote}</p>
                            </div>
                        </div>

                        <div className="mt-6 pt-4 border-t border-gray-100">
                            <div className="flex justify-between items-center">
                                <span className="font-medium text-gray-900">{t.kpiTotalLabel}</span>
                                <span className="text-2xl font-bold text-emerald-600">{kpiData.total}%</span>
                            </div>
                            <p className="text-sm text-emerald-600 mt-1 flex items-center gap-1">
                                <CheckCircle2 size={14} /> {t.kpiBonusEligible}
                            </p>
                        </div>
                    </div>

                    {/* Income Section */}
                    <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl shadow-sm p-6 text-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-6 opacity-10">
                            <DollarSign size={120} />
                        </div>

                        <h2 className="font-medium text-indigo-100 flex items-center gap-2 mb-6 relative z-10">
                            <Star size={20} className="text-amber-300" />
                            {t.incomeTitle}
                        </h2>

                        <div className="text-4xl font-bold mb-2 relative z-10">{incomeData.total}</div>
                        <p className="text-sm text-indigo-200 mb-8 relative z-10">{t.incomeUpdated}</p>

                        <div className="space-y-4 relative z-10">
                            <div className="flex justify-between items-center pb-3 border-b border-indigo-500/50">
                                <span className="text-indigo-100">{t.incomeSalary}</span>
                                <span className="font-semibold">{incomeData.salary}</span>
                            </div>
                            <div className="flex justify-between items-center pb-3 border-b border-indigo-500/50">
                                <span className="text-indigo-100">{t.incomeTurnFee}</span>
                                <span className="font-semibold">{incomeData.turnFee}</span>
                            </div>
                            <div className="flex justify-between items-center pb-3 border-b border-indigo-500/50">
                                <span className="text-indigo-100">{t.incomeTip}</span>
                                <span className="font-semibold">{incomeData.tip}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-amber-300 font-medium">{t.incomeBonus}</span>
                                <span className="font-bold text-amber-300">{incomeData.bonus}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
