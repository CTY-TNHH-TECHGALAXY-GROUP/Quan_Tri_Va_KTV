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
  const [showModal, setShowModal] = useState(false);
  
  // Modal state
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [tasks, setTasks] = useState<{ id?: string; name: string; requires_photo: boolean; min_photo_count: number }[]>([
    { name: '', requires_photo: false, min_photo_count: 0 }
  ]);
  const [submitting, setSubmitting] = useState(false);

  if (logic.templates.length === 0 && logic.categories.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <p className="mb-4">Chưa có mẫu công việc nào.</p>
        <button onClick={() => setShowModal(true)} className="bg-cyan-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-cyan-200">
          + Thêm Tiêu Đề Mới
        </button>
      </div>
    );
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

  const handleSave = async () => {
    if (!categoryName.trim()) {
      alert('Vui lòng nhập tên tiêu đề.');
      return;
    }
    setSubmitting(true);
    const ok = await logic.saveCategoryWithTemplates(categoryId, categoryName.trim(), tasks);
    if (ok) {
      setShowModal(false);
      setCategoryId(null);
      setCategoryName('');
      setTasks([{ name: '', requires_photo: false, min_photo_count: 0 }]);
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4 relative">
      <div className="flex justify-end mb-4">
        <button onClick={() => {
          setCategoryId(null);
          setCategoryName('');
          setTasks([{ name: '', requires_photo: false, min_photo_count: 0 }]);
          setShowModal(true);
        }} className="bg-cyan-600 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-cyan-200 flex items-center gap-2 hover:bg-cyan-700 transition-colors">
          <span className="text-xl leading-none">+</span> Thêm Tiêu Đề Mới
        </button>
      </div>

      {Object.entries(grouped).map(([catName, items]) => {
        const catObj = logic.categories.find(c => c.name === catName);

        return (
          <div key={catName} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-6">
            {/* Tiêu đề cấp 1 */}
            <div className="bg-slate-200 text-slate-700 px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-sm uppercase tracking-wide">{catName}</h3>
              <div className="flex items-center gap-3">
                <span className="bg-slate-300 text-slate-700 text-xs font-bold px-2.5 py-1 rounded-full">{items.length} việc</span>
                <button
                  onClick={() => {
                    setCategoryId(catObj?.id || null);
                    setCategoryName(catName);
                    setTasks(items.length > 0 ? items.map(t => ({ id: t.id, name: t.name, requires_photo: t.requires_photo, min_photo_count: t.min_photo_count })) : [{ name: '', requires_photo: false, min_photo_count: 0 }]);
                    setShowModal(true);
                  }}
                  className="text-cyan-600 text-xs font-bold hover:underline"
                >Sửa</button>
              </div>
            </div>
            
            {/* Tiêu đề cấp 2 (Danh sách công việc) */}
            <div className="divide-y divide-slate-50">
              {items.length === 0 ? (
                <div className="px-5 py-6 text-center text-slate-400 text-sm italic">Chưa có công việc nào trong nhóm này.</div>
              ) : items.map((tpl, idx) => (
                <div key={tpl.id} className="px-5 py-3 hover:bg-slate-50/50 transition-colors flex items-start gap-3">
                  <span className="font-semibold text-slate-400 shrink-0 mt-0.5">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 truncate">{tpl.name}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {tpl.requires_photo && <span className="text-[11px] text-green-600 font-bold">📷 Tối thiểu {tpl.min_photo_count} ảnh</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* ======================== MODAL: THÊM / SỬA TIÊU ĐỀ ======================== */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="font-bold text-slate-800 text-lg">
                {categoryId ? 'Sửa Tiêu Đề' : 'Thêm Tiêu Đề / Nhóm Việc Mới'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl font-light leading-none">✕</button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Tiêu đề lớn */}
              <div className="mb-6">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">1. Nhập Tiêu Đề Lớn (Category)</label>
                <input
                  type="text"
                  value={categoryName}
                  onChange={e => setCategoryName(e.target.value)}
                  placeholder="Ví dụ: Vệ sinh chung, Chuẩn bị phòng..."
                  className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200 font-bold text-slate-800"
                  autoFocus
                />
              </div>

              {/* Danh sách việc nhỏ */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">2. Danh sách việc nhỏ</label>
                
                <div className="space-y-3">
                  {tasks.map((task, idx) => (
                    <div key={idx} className="flex gap-2 items-start bg-slate-50 p-2 rounded-xl border border-slate-100">
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={task.name}
                          onChange={e => {
                            const newTasks = [...tasks];
                            newTasks[idx].name = e.target.value;
                            setTasks(newTasks);
                          }}
                          placeholder={`Việc ${idx + 1}...`}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200"
                        />
                        <div className="flex items-center gap-2 px-1">
                          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-600">
                            <input
                              type="checkbox"
                              checked={task.requires_photo}
                              onChange={e => {
                                const newTasks = [...tasks];
                                newTasks[idx].requires_photo = e.target.checked;
                                if(e.target.checked && newTasks[idx].min_photo_count === 0) newTasks[idx].min_photo_count = 1;
                                setTasks(newTasks);
                              }}
                              className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                            />
                            Bắt buộc chụp ảnh
                          </label>
                          {task.requires_photo && (
                            <input
                              type="number"
                              min="1"
                              max="5"
                              value={task.min_photo_count || 1}
                              onChange={e => {
                                const newTasks = [...tasks];
                                newTasks[idx].min_photo_count = parseInt(e.target.value) || 1;
                                setTasks(newTasks);
                              }}
                              className="w-16 border border-slate-200 rounded px-2 py-1 text-xs"
                            />
                          )}
                        </div>
                      </div>
                      
                      {tasks.length > 1 && (
                        <button 
                          onClick={() => {
                            const newTasks = tasks.filter((_, i) => i !== idx);
                            setTasks(newTasks);
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600"
                        >✕</button>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setTasks([...tasks, { name: '', requires_photo: false, min_photo_count: 0 }])}
                  className="mt-3 text-cyan-600 font-bold text-sm flex items-center gap-1 hover:underline"
                >
                  <span className="text-lg leading-none">+</span> Thêm việc nữa
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button 
                onClick={() => setShowModal(false)}
                className="flex-1 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl font-bold hover:bg-slate-50"
              >
                Hủy
              </button>
              <button 
                onClick={handleSave}
                disabled={submitting}
                className="flex-1 bg-cyan-600 text-white py-3 rounded-xl font-bold hover:bg-cyan-700 shadow-md disabled:opacity-50"
              >
                {submitting ? 'Đang lưu...' : 'Lưu Lại'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
