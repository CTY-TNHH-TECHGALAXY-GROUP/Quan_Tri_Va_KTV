'use client';

import React from 'react';
import Link from 'next/link';
import { useSupportTemplates, ActiveTab } from './SupportTemplates.logic';

// 🔧 UI CONFIGURATION
const CARD_BORDER_RADIUS = 'rounded-2xl';
const PROGRESS_HEIGHT = 'h-2';

const TAB_ITEMS: { key: ActiveTab; label: string; icon: string }[] = [
  { key: 'EMPLOYEES', label: 'Nhân Viên', icon: '👥' },
  { key: 'TEMPLATES', label: 'Kho Công Việc', icon: '📋' },
  { key: 'CATEGORIES', label: 'Nhóm Việc', icon: '🏷️' },
];

export default function SupportTemplatesPage() {
  const logic = useSupportTemplates();

  if (logic.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto min-h-screen bg-slate-50">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">📋 Giao Việc Nhân Viên</h1>
        <p className="text-slate-500 mt-1">Quản lý checklist công việc và nghiệm thu cho toàn bộ nhân viên</p>
      </div>

      {/* Tabs — Friendly large buttons */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => logic.setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition-all ${
              logic.activeTab === tab.key
                ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-cyan-300 hover:text-cyan-600'
            }`}
          >
            <span className="text-lg">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ======================= TAB: EMPLOYEES ======================= */}
      {logic.activeTab === 'EMPLOYEES' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {logic.employees.length === 0 ? (
            <div className="col-span-full py-16 text-center text-slate-400">
              Chưa có nhân viên nào trong hệ thống.
            </div>
          ) : (
            logic.employees.map((emp) => {
              const pct = emp.totalTasks > 0 ? Math.round((emp.completedTasks / emp.totalTasks) * 100) : 0;
              const isAllDone = emp.totalTasks > 0 && emp.completedTasks >= emp.totalTasks;
              const hasStarted = emp.completedTasks > 0;

              let borderColor = 'border-slate-200';
              let bgGlow = '';
              if (isAllDone) {
                borderColor = 'border-green-300';
                bgGlow = 'bg-green-50/50';
              } else if (hasStarted) {
                borderColor = 'border-amber-300';
                bgGlow = 'bg-amber-50/30';
              }

              return (
                <Link
                  key={emp.id}
                  href={`/admin/support/employee/${emp.id}`}
                  className={`${CARD_BORDER_RADIUS} border ${borderColor} ${bgGlow} bg-white p-5 shadow-sm hover:shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] block`}
                >
                  {/* Avatar + Name */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                      {emp.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-800 truncate">{emp.fullName}</h3>
                      <p className="text-xs text-slate-400">{logic.getRoleLabel(emp.role)}</p>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm font-medium text-slate-600">
                        {emp.completedTasks}/{emp.totalTasks} việc
                      </span>
                      {isAllDone && (
                        <span className="text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">✅ Xong</span>
                      )}
                      {!isAllDone && emp.totalTasks > 0 && (
                        <span className="text-xs font-medium text-slate-400">{pct}%</span>
                      )}
                    </div>
                    <div className={`w-full ${PROGRESS_HEIGHT} bg-slate-100 rounded-full overflow-hidden`}>
                      <div
                        className={`${PROGRESS_HEIGHT} rounded-full transition-all duration-500 ${
                          isAllDone ? 'bg-green-500' : 'bg-cyan-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      )}

      {/* ======================= TAB: TEMPLATES ======================= */}
      {logic.activeTab === 'TEMPLATES' && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-sm border-b border-slate-100">
                <th className="p-4 font-medium">Tên công việc</th>
                <th className="p-4 font-medium">Nhóm</th>
                <th className="p-4 font-medium">Phòng</th>
                <th className="p-4 font-medium">Lịch lặp lại</th>
                <th className="p-4 font-medium">Ảnh</th>
                <th className="p-4 font-medium text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {logic.templates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">Chưa có mẫu công việc nào.</td>
                </tr>
              ) : (
                logic.templates.map((tpl) => (
                  <tr key={tpl.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors text-sm">
                    <td className="p-4 font-medium text-slate-800">{tpl.name}</td>
                    <td className="p-4 text-slate-600">{tpl.categoryName}</td>
                    <td className="p-4">
                      <span className="bg-orange-50 text-orange-600 font-semibold px-2 py-1 rounded-md text-xs border border-orange-100">
                        {tpl.roomName}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-cyan-600 text-xs">{tpl.cron_schedule}</td>
                    <td className="p-4">
                      {tpl.requires_photo ? (
                        <span className="text-green-600 flex items-center gap-1 font-medium text-xs">📷 ≥ {tpl.min_photo_count}</span>
                      ) : (
                        <span className="text-slate-400 text-xs">Không bắt buộc</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <button className="text-slate-400 hover:text-cyan-600 transition-colors text-sm">Sửa</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ======================= TAB: CATEGORIES ======================= */}
      {logic.activeTab === 'CATEGORIES' && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden max-w-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-sm border-b border-slate-100">
                <th className="p-4 font-medium">Tên Nhóm Việc</th>
                <th className="p-4 font-medium w-32">Trạng thái</th>
                <th className="p-4 font-medium text-right w-24">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {logic.categories.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-slate-400">Chưa có nhóm việc nào.</td>
                </tr>
              ) : (
                logic.categories.map((cat) => (
                  <tr key={cat.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors text-sm">
                    <td className="p-4 font-medium text-slate-800">{cat.name}</td>
                    <td className="p-4">
                      {cat.is_active ? (
                        <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-medium">Hoạt động</span>
                      ) : (
                        <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded text-xs font-medium">Đã tắt</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <button className="text-slate-400 hover:text-cyan-600 transition-colors">Sửa</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
