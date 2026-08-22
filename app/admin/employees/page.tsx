'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  ShieldAlert,
  Search,
  Plus,
  Star,
  CheckCircle2,
  XCircle,
  Filter,
  Trash2
} from 'lucide-react';
import { EmployeeDetailModal } from '@/components/EmployeeDetailModal';
import { AddEmployeeModal } from '@/components/AddEmployeeModal';
import { useEmployeeManagement } from './Employees.logic';
import { t } from './Employees.i18n';

// 🔧 UI CONFIGURATION
const SKILL_LEVEL_STYLES = {
    active: 'bg-emerald-50 text-emerald-600 border-emerald-100',
} as const;

export default function EmployeeManagementPage() {
    const {
        searchTerm,
        isLoading,
        selectedEmployee,
        isDetailOpen,
        isAddModalOpen,
        mounted,
        filteredEmployees,
        stats,
        canAccessPage,
        setSearchTerm,
        fetchEmployees,
        handleUpdateEmployee,
        handleOpenDetail,
        handleCloseDetail,
        handleOpenAddModal,
        handleCloseAddModal,
        handleDeleteEmployee,
    } = useEmployeeManagement();

    if (!mounted) return null;

    if (!canAccessPage) {
        return (
            <AppLayout title={t.pageTitle}>
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">{t.noAccess}</h2>
                    <p className="text-gray-500 mt-2">{t.noAccessDetail}</p>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title={t.pageTitle}>
            <div className="space-y-2 lg:space-y-6">
                <div className="hidden lg:flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t.pageTitle}</h1>
                        <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
                    </div>
                    <button
                        onClick={handleOpenAddModal}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm transition-colors"
                    >
                        <Plus size={16} />
                        {t.addNew}
                    </button>
                </div>

                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center bg-gray-50/50">
                        <div className="relative w-full sm:w-96">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder={t.searchPlaceholder}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                            />
                        </div>
                        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors w-full sm:w-auto justify-center">
                            <Filter size={16} />
                            {t.advancedFilter}
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr>
                                    <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">{t.thEmployee}</th>
                                    <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">{t.thPosition}</th>
                                    <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">{t.thStatus}</th>
                                    <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">{t.thSkills}</th>
                                    <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm text-center">{t.thRating}</th>
                                    <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={6} className="text-center py-8 text-gray-500">{t.loading}</td>
                                    </tr>
                                ) : filteredEmployees.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="text-center py-8 text-gray-500">{t.empty}</td>
                                    </tr>
                                ) : filteredEmployees.map(emp => (
                                    <tr
                                        key={emp.id}
                                        className="hover:bg-gray-50 transition-colors cursor-pointer group"
                                        onClick={() => handleOpenDetail(emp)}
                                    >
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="relative w-10 h-10 rounded-full overflow-hidden border border-gray-200">
                                                    <img
                                                        src={emp.photoUrl}
                                                        alt={emp.name}
                                                        className="w-full h-full object-cover"
                                                        referrerPolicy="no-referrer"
                                                        loading="lazy"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="font-medium text-gray-900">{emp.name}</div>
                                                    <div className="text-xs text-indigo-600 font-bold">{emp.code}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="text-sm text-gray-900 font-medium flex items-center gap-2">
                                                {emp.position}
                                                {emp.isActiveVipMenu && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full border border-amber-200">VIP</span>}
                                                {emp.isHomeSpa && <span className="px-2 py-0.5 bg-sky-100 text-sky-700 text-[10px] font-bold rounded-full border border-sky-200">Home Spa</span>}
                                            </div>
                                            <div className="text-xs text-gray-500">{emp.experience} {t.experienceSuffix}</div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${emp.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>
                                                {emp.status === 'active' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                                {emp.status === 'active' ? t.statusActive : t.statusInactive}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-wrap gap-1">
                                                {emp.skills.shampoo && (
                                                    <span className={`px-2 py-0.5 text-[10px] rounded border ${SKILL_LEVEL_STYLES.active}`}>
                                                        {t.skillShampoo}
                                                    </span>
                                                )}
                                                {emp.skills.oilBody && (
                                                    <span className={`px-2 py-0.5 text-[10px] rounded border ${SKILL_LEVEL_STYLES.active}`}>
                                                        {t.skillOilBody}
                                                    </span>
                                                )}
                                                {emp.skills.facial && (
                                                    <span className={`px-2 py-0.5 text-[10px] rounded border ${SKILL_LEVEL_STYLES.active}`}>
                                                        {t.skillFacial}
                                                    </span>
                                                )}
                                                {emp.skills.bodyMix && (
                                                    <span className={`px-2 py-0.5 text-[10px] rounded border ${SKILL_LEVEL_STYLES.active}`}>
                                                        {t.skillBodyMix}
                                                    </span>
                                                )}
                                                <span className="px-2 py-0.5 bg-gray-50 text-gray-500 text-[10px] rounded border border-gray-100">...</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-1 text-amber-500 font-bold">
                                                <Star size={14} fill="currentColor" />
                                                {emp.rating}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteEmployee(emp);
                                                }}
                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                title={t.deleteEmployee}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <div className="text-sm text-gray-500 mb-1">{t.statsTotal}</div>
                        <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <div className="text-sm text-gray-500 mb-1">{t.statsActive}</div>
                        <div className="text-2xl font-bold text-emerald-600">{stats.active}</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <div className="text-sm text-gray-500 mb-1">{t.statsSenior}</div>
                        <div className="text-2xl font-bold text-indigo-600">{stats.senior}</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <div className="text-sm text-gray-500 mb-1">{t.statsAvgRating}</div>
                        <div className="text-2xl font-bold text-amber-500">{stats.avgRating}</div>
                    </div>
                </div>
            </div>

            <EmployeeDetailModal
                key={selectedEmployee?.id || 'none'}
                employee={selectedEmployee}
                isOpen={isDetailOpen}
                onClose={handleCloseDetail}
                onUpdate={handleUpdateEmployee}
            />

            <AddEmployeeModal
                isOpen={isAddModalOpen}
                onClose={handleCloseAddModal}
                onSuccess={fetchEmployees}
            />
        </AppLayout>
    );
}
