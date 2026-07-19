'use client';

import React, { lazy, Suspense, useState } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { useSupportTemplates, ActiveTab } from './SupportTemplates.logic';
import { useSupportDashboard } from '../dashboard/SupportDashboard.logic';
import { useSupportReviews } from '../reviews/SupportReviews.logic';

// 🔧 UI CONFIGURATION
const CARD_BORDER_RADIUS = 'rounded-2xl';
const PROGRESS_HEIGHT = 'h-2';

const TAB_ITEMS: { key: ActiveTab; label: string; icon: string }[] = [
  { key: 'EMPLOYEES', label: 'Nhân Viên', icon: '👥' },
  { key: 'TEMPLATES', label: 'Kho Công Việc', icon: '📋' },
  { key: 'CATEGORIES', label: 'Nhóm Việc', icon: '🏷️' },
  { key: 'REVIEWS', label: 'Nghiệm Thu', icon: '✅' },
  { key: 'DASHBOARD', label: 'Thống Kê Phòng', icon: '📊' },
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
    <AppLayout title="Giao Việc">
    <div className="p-4 md:p-6 max-w-7xl mx-auto min-h-screen">
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
      {logic.activeTab === 'TEMPLATES' && <TemplatesTabContent logic={logic} />}

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

      {/* ======================= TAB: REVIEWS ======================= */}
      {logic.activeTab === 'REVIEWS' && <ReviewsTabContent />}

      {/* ======================= TAB: DASHBOARD ======================= */}
      {logic.activeTab === 'DASHBOARD' && <DashboardTabContent />}
    </div>
    </AppLayout>
  );
}

// ============================================================
// Embedded Tab: Nghiệm Thu
// ============================================================
const ReviewsTabContent = () => {
  const logic = useSupportReviews();

  if (logic.loading) {
    return <div className="text-center py-12 text-slate-400">Đang tải...</div>;
  }

  return (
    <div className="space-y-4">
      {logic.tasks.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">✅</p>
          <p>Không có công việc nào chờ nghiệm thu.</p>
        </div>
      ) : (
        logic.tasks.map((task: any) => (
          <div key={task.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                {task.roomName && (
                  <span className="bg-orange-50 text-orange-600 font-semibold px-2 py-0.5 rounded text-xs border border-orange-100 mb-2 inline-block">
                    {task.roomName}
                  </span>
                )}
                <h3 className="font-bold text-slate-800">{task.name}</h3>
                <p className="text-sm text-slate-500 mt-1">👤 {task.assigneeName || 'Chưa giao'}</p>
                {task.photoCount > 0 && <p className="text-xs text-slate-400 mt-1">📷 {task.photoCount} ảnh minh chứng</p>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => logic.reviewTask(task.id, 'PASSED')}
                  disabled={logic.submitting}
                  className="bg-green-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-green-600 transition-colors disabled:opacity-50"
                >
                  ✓ Đạt
                </button>
                <button
                  onClick={() => logic.reviewTask(task.id, 'REWORK_REQUIRED')}
                  disabled={logic.submitting}
                  className="bg-red-50 text-red-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-50"
                >
                  ↩ Làm lại
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// ============================================================
// Embedded Tab: Thống Kê Phòng
// ============================================================
const DashboardTabContent = () => {
  const logic = useSupportDashboard();
  const totalRooms = Object.keys(logic.stats).length;

  if (logic.isLoading) {
    return <div className="text-center py-12 text-slate-400">Đang tải...</div>;
  }

  return (
    <div className="space-y-4">
      {totalRooms === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">📊</p>
          <p>Chưa có dữ liệu thống kê phòng.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Object.entries(logic.stats).map(([roomName, stat]: [string, any]) => (
            <div key={roomName} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 hover:shadow-md transition-shadow">
              <h3 className="font-bold text-slate-800 mb-2">{roomName}</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Tổng lượt:</span>
                  <span className="font-medium">{stat.total}</span>
                </div>
                {stat.services && Object.entries(stat.services).map(([svcName, count]: [string, any]) => (
                  <div key={svcName} className="flex justify-between">
                    <span className="text-slate-400 truncate mr-2">{svcName}</span>
                    <span className="font-medium text-cyan-600">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Embedded Tab: Kho Công Việc (Collapsible + Add new)
// ============================================================
const TemplatesTabContent = ({ logic }: { logic: ReturnType<typeof useSupportTemplates> }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (logic.templates.length === 0 && logic.categories.length === 0) {
    return <div className="text-center py-16 text-slate-400">Chưa có mẫu công việc nào.</div>;
  }

  const grouped: Record<string, typeof logic.templates> = {};
  logic.templates.forEach((tpl) => {
    const key = tpl.categoryName || 'Chưa phân loại';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(tpl);
  });
  logic.categories.forEach(cat => {
    if (!grouped[cat.name]) grouped[cat.name] = [];
  });

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const handleAdd = async (catName: string) => {
    if (!newName.trim()) return;
    const cat = logic.categories.find(c => c.name === catName);
    if (!cat) return;
    setSubmitting(true);
    const ok = await logic.addTemplate(newName.trim(), cat.id);
    if (ok) { setNewName(''); setAddingTo(null); }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([catName, items]) => {
        const isCollapsed = collapsed[catName] ?? false;
        const allEmployees = new Set<string>();
        items.forEach(t => t.assignedEmployees.forEach(n => allEmployees.add(n)));

        return (
          <div key={catName} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <button
              onClick={() => toggle(catName)}
              className="w-full bg-slate-50 px-5 py-4 border-b border-slate-100 text-left hover:bg-slate-100/70 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={`text-slate-400 text-xs transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                <span className="text-lg">🏷️</span>
                <h3 className="font-bold text-slate-700 text-base">{catName}</h3>
                <span className="ml-auto bg-slate-200 text-slate-600 text-xs font-bold px-2.5 py-1 rounded-full">{items.length} việc</span>
              </div>
              {allEmployees.size > 0 ? (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap ml-8">
                  <span className="text-xs text-slate-400">👤 Giao cho:</span>
                  {Array.from(allEmployees).map(name => (
                    <span key={name} className="bg-cyan-50 text-cyan-700 text-xs font-medium px-2 py-0.5 rounded-full border border-cyan-200">{name}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 mt-1 italic ml-8">Chưa giao cho ai</p>
              )}
            </button>

            {!isCollapsed && (
              <>
                <div className="divide-y divide-slate-50">
                  {items.length === 0 ? (
                    <div className="px-5 py-6 text-center text-slate-400 text-sm italic">Chưa có công việc nào trong nhóm này.</div>
                  ) : items.map((tpl) => (
                    <div key={tpl.id} className="px-5 py-3 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-800 truncate">{tpl.name}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                            <span className="bg-orange-50 text-orange-600 font-semibold px-1.5 py-0.5 rounded border border-orange-100">{tpl.roomName}</span>
                            {tpl.cron_schedule !== '—' && <span className="font-mono text-cyan-600">🔄 {tpl.cron_schedule}</span>}
                            {tpl.requires_photo && <span className="text-green-600">📷 ≥{tpl.min_photo_count}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                          {tpl.assignedEmployees.length > 0 ? tpl.assignedEmployees.map(name => (
                            <span key={name} className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-[10px] font-bold" title={name}>{name.charAt(0).toUpperCase()}</span>
                          )) : <span className="text-xs text-slate-300 italic">—</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-slate-100 px-5 py-3 bg-slate-50/50">
                  {addingTo === catName ? (
                    <div className="flex items-center gap-2">
                      <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd(catName)} placeholder="Tên công việc mới..." className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400" />
                      <button onClick={() => handleAdd(catName)} disabled={submitting || !newName.trim()} className="bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-cyan-700 transition-colors disabled:opacity-50">{submitting ? '...' : 'Thêm'}</button>
                      <button onClick={() => { setAddingTo(null); setNewName(''); }} className="text-slate-400 hover:text-slate-600 px-2 py-2 text-sm">Hủy</button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingTo(catName)} className="text-cyan-600 hover:text-cyan-700 text-sm font-medium flex items-center gap-1">
                      <span className="text-lg">+</span> Thêm công việc
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
