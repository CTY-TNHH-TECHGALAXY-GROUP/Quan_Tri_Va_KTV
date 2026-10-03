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
  { key: 'TEMPLATES', label: 'Kho Việc Tương Tác', icon: '📋' },
  { key: 'ROOM_MATRIX', label: 'Ma Trận Phòng', icon: '🏢' },
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



      {/* ======================= TAB: REVIEWS ======================= */}
      {logic.activeTab === 'REVIEWS' && <ReviewsTabContent />}

      {/* ======================= TAB: DASHBOARD ======================= */}
      {logic.activeTab === 'DASHBOARD' && <DashboardTabContent />}

      {/* ======================= TAB: ROOM MATRIX ======================= */}
      {logic.activeTab === 'ROOM_MATRIX' && <RoomMatrixTabContent logic={logic} />}
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
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  
  // Modal state
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryType, setCategoryType] = useState<'ROLE' | 'ROOM'>('ROLE');
  const [repeatMode, setRepeatMode] = useState('DAILY');
  const [tasks, setTasks] = useState<{ id?: string; name: string; requires_photo: boolean; min_photo_count: number; cron_schedule?: string }[]>([
    { name: '', requires_photo: false, min_photo_count: 0, cron_schedule: '' }
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const allTemplates = [...logic.templates, ...logic.virtualTemplates];
  const allCategories = [...logic.categories, ...logic.virtualCategories];

  if (allTemplates.length === 0 && allCategories.length === 0) {
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
  allTemplates.forEach((tpl) => {
    const key = tpl.categoryName || 'Chưa phân loại';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(tpl);
  });
  allCategories.forEach((cat: any) => {
    if (!grouped[cat.name]) grouped[cat.name] = [];
  });

  const handleSave = async () => {
    if (!categoryName.trim()) {
      alert('Vui lòng nhập tên tiêu đề.');
      return;
    }
    setSubmitting(true);
    const ok = await logic.saveCategoryWithTemplates(categoryId, categoryName.trim(), tasks, categoryType, repeatMode);
    if (ok) {
      alert('Đã lưu thành công!');
      setShowModal(false);
      setCategoryId(null);
      setCategoryName('');
      setCategoryType('ROLE');
      setTasks([{ name: '', requires_photo: false, min_photo_count: 0 }]);
    } else {
      alert('Có lỗi xảy ra khi lưu, vui lòng thử lại.');
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        {/* Dropdown lọc danh mục */}
        <div className="flex-1 max-w-sm">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full bg-white border border-slate-200 text-slate-700 font-bold px-4 py-3 rounded-xl shadow-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition-all appearance-none cursor-pointer"
            style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394A3B8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem top 50%', backgroundSize: '0.65rem auto' }}
          >
            <option value="ALL">Hiển thị tất cả tiêu đề</option>
            {Object.keys(grouped).sort((a, b) => a.localeCompare(b)).map(catName => (
              <option key={catName} value={catName}>{catName}</option>
            ))}
          </select>
        </div>

        <button onClick={() => {
          setCategoryId(null);
          setCategoryName('');
          setRepeatMode('DAILY');
          setTasks([{ name: '', requires_photo: false, min_photo_count: 0, cron_schedule: '' }]);
          setShowModal(true);
        }} className="bg-cyan-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-cyan-200 flex items-center justify-center gap-2 hover:bg-cyan-700 transition-colors shrink-0">
          <span className="text-xl leading-none">+</span> Thêm Tiêu Đề Mới
        </button>
      </div>

      {Object.entries(grouped)
        .filter(([catName]) => selectedCategory === 'ALL' || catName === selectedCategory)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([catName, items]) => {
        const allCats = [...logic.categories, ...logic.virtualCategories];
        const catObj = allCats.find(c => c.name === catName);
        const isExpanded = expandedCats[catName] === true; // default false

        return (
          <div key={catName} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-6 transition-all duration-300">
            {/* Tiêu đề cấp 1 */}
            <div 
              className="bg-slate-200 text-slate-700 px-5 py-3 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-300/80 transition-colors select-none"
              onClick={() => setExpandedCats(prev => ({ ...prev, [catName]: !isExpanded }))}
            >
              <div className="flex items-center gap-2">
                <span className={`text-slate-500 font-bold w-4 text-xs transition-transform ${!isExpanded ? '-rotate-90' : ''}`}>▼</span>
                <h3 className="font-bold text-sm uppercase tracking-wide">
                  {catName}
                  {catObj?.type === 'ROOM_VIRTUAL' && <span className="ml-2 bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 rounded-full font-semibold">Chỉ xem (Gán từ Ma Trận)</span>}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <span className="bg-slate-300 text-slate-700 text-xs font-bold px-2.5 py-1 rounded-full">{items.length} việc</span>
                {catObj?.type !== 'ROOM_VIRTUAL' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCategoryId(catObj?.id || null);
                      setCategoryName(catName);
                      setCategoryType((catObj?.type as 'ROLE' | 'ROOM') || 'ROLE');
                      setRepeatMode(catObj?.repeat_mode || 'DAILY');
                      setTasks(items.length > 0 ? items.map(t => ({ id: t.id, name: t.name, requires_photo: t.requires_photo, min_photo_count: t.min_photo_count, cron_schedule: t.cron_schedule && t.cron_schedule !== '—' ? t.cron_schedule : '' })) : [{ name: '', requires_photo: false, min_photo_count: 0, cron_schedule: '' }]);
                      setShowModal(true);
                    }}
                    className="text-cyan-600 text-xs font-bold hover:underline bg-white/50 px-3 py-1 rounded-lg hover:bg-white transition-colors"
                  >Sửa</button>
                )}
              </div>
            </div>
            
            {/* Tiêu đề cấp 2 (Danh sách công việc) */}
            {isExpanded && (
              <div className="divide-y divide-slate-50 animate-in slide-in-from-top-2 fade-in duration-200">
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
            )}
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

              {/* Kiểu Lặp Lại */}
              <div className="mb-6">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Chu Kỳ Lặp Lại</label>
                <select
                  value={repeatMode}
                  onChange={e => setRepeatMode(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200 text-slate-800 bg-white"
                >
                  <option value="DAILY">Hằng ngày</option>
                  <option value="WEEKLY">Hằng tuần (Chọn lịch cho từng việc ở dưới)</option>
                  {repeatMode.startsWith('WEEKLY_') && <option value={repeatMode}>{repeatMode} (Cũ)</option>}
                </select>
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
                        
                        {repeatMode === 'WEEKLY' && (
                          <div className="flex flex-wrap gap-2 mt-2 p-2 bg-white rounded-lg border border-slate-200">
                            <span className="text-xs text-slate-500 font-medium self-center mr-1">Lặp lại vào:</span>
                            {[
                              { value: '1', label: 'T2' },
                              { value: '2', label: 'T3' },
                              { value: '3', label: 'T4' },
                              { value: '4', label: 'T5' },
                              { value: '5', label: 'T6' },
                              { value: '6', label: 'T7' },
                              { value: '0', label: 'CN' },
                            ].map(day => {
                              const selectedDays = (task as any).cron_schedule ? (task as any).cron_schedule.split(',') : [];
                              const isSelected = selectedDays.includes(day.value);
                              return (
                                <button
                                  key={day.value}
                                  onClick={() => {
                                    let newDays = [...selectedDays];
                                    if (isSelected) newDays = newDays.filter(d => d !== day.value);
                                    else newDays.push(day.value);
                                    const newTasks = [...tasks];
                                    (newTasks[idx] as any).cron_schedule = newDays.join(',');
                                    setTasks(newTasks);
                                  }}
                                  className={`px-2 py-1 text-xs rounded font-bold transition-all ${isSelected ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex flex-col items-center gap-1">
                        {idx > 0 && (
                          <button
                            onClick={() => {
                              const newTasks = [...tasks];
                              const temp = newTasks[idx - 1];
                              newTasks[idx - 1] = newTasks[idx];
                              newTasks[idx] = temp;
                              setTasks(newTasks);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600 font-bold"
                          >↑</button>
                        )}
                        {idx < tasks.length - 1 && (
                          <button
                            onClick={() => {
                              const newTasks = [...tasks];
                              const temp = newTasks[idx + 1];
                              newTasks[idx + 1] = newTasks[idx];
                              newTasks[idx] = temp;
                              setTasks(newTasks);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600 font-bold"
                          >↓</button>
                        )}
                        {tasks.length > 1 && (
                          <button 
                            onClick={() => {
                              const newTasks = tasks.filter((_, i) => i !== idx);
                              setTasks(newTasks);
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 mt-auto"
                          >✕</button>
                        )}
                      </div>
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

// ============================================================
// Embedded Tab: Room Matrix
// ============================================================
const RoomMatrixTabContent = ({ logic }: { logic: any }) => {
  const [showModal, setShowModal] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [repeatMode, setRepeatMode] = useState('DAILY');
  const [tasks, setTasks] = useState([{ name: '', requires_photo: false, min_photo_count: 0 }]);
  const [submitting, setSubmitting] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const roomTemplates = logic.templates.filter((t: any) => t.categoryType === 'ROOM');
  const roomTypes = Array.from(new Set(logic.rooms.map((r: any) => r.type))).filter(Boolean) as string[];
  const visibleRooms = logic.rooms.filter((room: any) => {
    if (!selectedType) return true;
    return room.type === selectedType;
  });

  const handleSave = async () => {
    if (!categoryName.trim()) {
      alert('Vui lòng nhập tên tiêu đề.');
      return;
    }
    setSubmitting(true);
    const ok = await logic.saveCategoryWithTemplates(categoryId, categoryName.trim(), tasks, 'ROOM', repeatMode);
    if (ok) {
      setShowModal(false);
      setCategoryId(null);
      setCategoryName('');
      setRepeatMode('DAILY');
      setTasks([{ name: '', requires_photo: false, min_photo_count: 0 }]);
    }
    setSubmitting(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden relative">
      <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
        <div>
          <h2 className="font-bold text-slate-800">Ma Trận Phân Bổ Công Việc Theo Phòng</h2>
          <p className="text-sm text-slate-500">Đánh dấu (tick) để quy định Mẫu công việc nào được áp dụng cho Phòng nào.</p>
        </div>
        <div className="flex gap-3">
          {logic.isMatrixDirty && (
            <button 
              onClick={logic.saveRoomMatrix}
              disabled={logic.isSavingMatrix}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold transition-all shadow-sm disabled:opacity-50 flex items-center gap-2 animate-in fade-in zoom-in"
            >
              {logic.isSavingMatrix ? 'Đang lưu...' : 'Lưu Thay Đổi'}
            </button>
          )}
          <button onClick={() => setShowModal(true)} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl font-bold transition-colors shadow-sm">
            + Thêm Việc Phòng
          </button>
        </div>
      </div>
      <div className="px-4 py-3 bg-white border-b border-slate-100 flex gap-2 overflow-x-auto items-center">
        <span className="text-sm font-semibold text-slate-600 mr-2">Lọc theo loại:</span>
        <button
          onClick={() => setSelectedType(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${!selectedType ? 'bg-cyan-100 text-cyan-700 border border-cyan-200' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'}`}
        >
          Tất cả
        </button>
        {roomTypes.map(type => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${selectedType === type ? 'bg-cyan-100 text-cyan-700 border border-cyan-200' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'}`}
          >
            {type}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
        <table className="w-full text-left border-collapse min-w-[800px] table-fixed">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-100 text-slate-600 text-sm border-b border-slate-200">
              <th className="p-4 font-bold sticky left-0 top-0 bg-slate-200 z-30 min-w-[280px] w-72 border-r border-slate-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Mẫu Công Việc</th>
              {visibleRooms.map((room: any) => (
                <th key={room.id} className="p-3 font-semibold text-center border-r border-slate-200 w-24 sticky top-0 bg-slate-100 z-20">
                  <div className="text-[13px] leading-tight truncate px-1" title={room.name}>{room.id}</div>
                  <div className="text-[10px] text-slate-400 font-normal truncate mt-0.5" title={room.type}>{room.type}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roomTemplates.length === 0 ? (
              <tr>
                <td colSpan={visibleRooms.length + 1} className="p-8 text-center text-slate-400">Chưa có công việc của phòng nào trong kho. Bấm "Thêm Việc Phòng" để tạo.</td>
              </tr>
            ) : (
              roomTemplates.map((tpl: any) => (
                <tr key={tpl.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="p-4 sticky left-0 bg-white z-10 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] break-words whitespace-normal">
                    <div className="font-medium text-slate-800 text-sm leading-snug">{tpl.name}</div>
                    <div className="text-xs text-slate-400 mt-1">{tpl.categoryName}</div>
                  </td>
                  {visibleRooms.map((room: any) => {
                    const cellData = logic.pendingMatrix[tpl.id]?.[room.id];
                    const isChecked = cellData?.active;
                    const customCount = cellData?.custom_min_photo_count;
                    
                    return (
                      <td key={room.id} className="p-2 text-center border-r border-slate-100 hover:bg-slate-50 transition-colors align-top">
                        <div className="flex flex-col items-center justify-center gap-1 min-h-[50px]">
                          <label className="cursor-pointer flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 transition-colors">
                            <input
                              type="checkbox"
                              checked={!!isChecked}
                              onChange={(e) => logic.toggleRoomMatrix(tpl.id, room.id, e.target.checked)}
                              className="w-5 h-5 text-cyan-600 bg-slate-50 border-slate-300 rounded focus:ring-cyan-500 focus:ring-2 cursor-pointer transition-transform hover:scale-110"
                            />
                          </label>
                          {isChecked && tpl.requires_photo && (
                            <div 
                              className="flex items-center bg-white border border-slate-200 rounded-full pl-2 pr-1 py-0.5 shadow-sm group hover:border-cyan-300 transition-colors focus-within:border-cyan-400 focus-within:ring-1 focus-within:ring-cyan-400"
                              title={`Số ảnh tuỳ chỉnh cho phòng này. Mặc định là ${tpl.min_photo_count}`}
                            >
                              <span className="text-[10px] text-slate-400 select-none">📷</span>
                              <input
                                type="number"
                                min="1"
                                max="10"
                                placeholder={`${tpl.min_photo_count}`}
                                value={customCount || ''}
                                onChange={(e) => {
                                   const val = e.target.value ? parseInt(e.target.value) : null;
                                   logic.updateCustomPhotoCount(tpl.id, room.id, val);
                                }}
                                className="w-8 bg-transparent border-none p-0 text-[11px] font-bold text-slate-700 text-center focus:ring-0 outline-none placeholder-slate-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Thêm Mẫu Việc Phòng */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-2xl">
              <h2 className="font-bold text-xl text-slate-800">
                {categoryId ? 'Sửa Tiêu Đề Việc Phòng' : 'Tạo Tiêu Đề Việc Phòng Mới'}
              </h2>
              <button 
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-700 mb-2">Tên Nhóm Việc Phòng (Ví dụ: Vệ sinh định kỳ, Setup giường...)</label>
                <input 
                  type="text" 
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  placeholder="Nhập tên tiêu đề..."
                  className="w-full border border-slate-200 p-3 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 outline-none transition-all"
                />
              </div>

              {/* Kiểu Lặp Lại */}
              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-700 mb-2">Chu Kỳ Lặp Lại</label>
                <select
                  value={repeatMode}
                  onChange={e => setRepeatMode(e.target.value)}
                  className="w-full border border-slate-200 p-3 rounded-xl focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 outline-none transition-all bg-white"
                >
                  <option value="DAILY">Hằng ngày</option>
                  <option value="WEEKLY_MONDAY">Hằng tuần - Thứ 2</option>
                  <option value="WEEKLY_TUESDAY">Hằng tuần - Thứ 3</option>
                  <option value="WEEKLY_WEDNESDAY">Hằng tuần - Thứ 4</option>
                  <option value="WEEKLY_THURSDAY">Hằng tuần - Thứ 5</option>
                  <option value="WEEKLY_FRIDAY">Hằng tuần - Thứ 6</option>
                  <option value="WEEKLY_SATURDAY">Hằng tuần - Thứ 7</option>
                  <option value="WEEKLY_SUNDAY">Hằng tuần - Chủ nhật</option>
                </select>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-bold text-slate-700">Các hạng mục công việc con</label>
                </div>
                
                {tasks.map((task, idx) => (
                  <div key={idx} className="flex gap-3 items-start bg-slate-50 p-4 rounded-xl border border-slate-100 group">
                    <div className="flex-1 space-y-3">
                      <input 
                        type="text"
                        value={task.name}
                        onChange={(e) => {
                          const newTasks = [...tasks];
                          newTasks[idx].name = e.target.value;
                          setTasks(newTasks);
                        }}
                        placeholder={`Công việc ${idx + 1}`}
                        className="w-full border border-slate-200 p-2.5 rounded-lg focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 outline-none transition-all text-sm"
                      />
                      <div className="flex items-center gap-4 text-sm">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input 
                            type="checkbox" 
                            checked={task.requires_photo}
                            onChange={(e) => {
                              const newTasks = [...tasks];
                              newTasks[idx].requires_photo = e.target.checked;
                              if (e.target.checked && newTasks[idx].min_photo_count === 0) {
                                newTasks[idx].min_photo_count = 1;
                              }
                              setTasks(newTasks);
                            }}
                            className="w-4 h-4 text-cyan-600 rounded border-slate-300 focus:ring-cyan-500"
                          />
                          <span className="text-slate-600">Bắt buộc chụp ảnh</span>
                        </label>
                        
                        {task.requires_photo && (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 text-xs">Số lượng tối thiểu:</span>
                            <input 
                              type="number"
                              min="1"
                              max="10"
                              value={task.min_photo_count || 1}
                              onChange={(e) => {
                                const newTasks = [...tasks];
                                newTasks[idx].min_photo_count = parseInt(e.target.value) || 1;
                                setTasks(newTasks);
                              }}
                              className="w-16 border border-slate-200 p-1 rounded text-center text-sm focus:border-cyan-500 outline-none"
                            />
                          </div>
                        )}
                      </div>
                      
                      {repeatMode === 'WEEKLY' && (
                        <div className="flex flex-wrap gap-2 mt-3 p-2 bg-white rounded-lg border border-slate-200">
                          <span className="text-xs text-slate-500 font-medium self-center mr-1">Lặp lại vào:</span>
                          {[
                            { value: '1', label: 'T2' },
                            { value: '2', label: 'T3' },
                            { value: '3', label: 'T4' },
                            { value: '4', label: 'T5' },
                            { value: '5', label: 'T6' },
                            { value: '6', label: 'T7' },
                            { value: '0', label: 'CN' },
                          ].map(day => {
                            const selectedDays = (task as any).cron_schedule ? (task as any).cron_schedule.split(',') : [];
                            const isSelected = selectedDays.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                onClick={() => {
                                  let newDays = [...selectedDays];
                                  if (isSelected) newDays = newDays.filter(d => d !== day.value);
                                  else newDays.push(day.value);
                                  const newTasks = [...tasks];
                                  (newTasks[idx] as any).cron_schedule = newDays.join(',');
                                  setTasks(newTasks);
                                }}
                                className={`px-2 py-1 text-xs rounded font-bold transition-all ${isSelected ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      {idx > 0 && (
                        <button
                          onClick={() => {
                            const newTasks = [...tasks];
                            const temp = newTasks[idx - 1];
                            newTasks[idx - 1] = newTasks[idx];
                            newTasks[idx] = temp;
                            setTasks(newTasks);
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600 font-bold"
                          title="Lên trên"
                        >↑</button>
                      )}
                      {idx < tasks.length - 1 && (
                        <button
                          onClick={() => {
                            const newTasks = [...tasks];
                            const temp = newTasks[idx + 1];
                            newTasks[idx + 1] = newTasks[idx];
                            newTasks[idx] = temp;
                            setTasks(newTasks);
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600 font-bold"
                          title="Xuống dưới"
                        >↓</button>
                      )}
                      {tasks.length > 1 && (
                        <button 
                          onClick={() => {
                            const newTasks = [...tasks];
                            newTasks.splice(idx, 1);
                            setTasks(newTasks);
                          }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 mt-auto opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Xóa dòng này"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                <button 
                  onClick={() => setTasks([...tasks, { name: '', requires_photo: false, min_photo_count: 0 }])}
                  className="w-full border-2 border-dashed border-slate-200 text-slate-500 py-3 rounded-xl font-medium hover:border-cyan-400 hover:text-cyan-600 hover:bg-cyan-50 transition-all"
                >
                  + Thêm dòng công việc
                </button>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex gap-3 rounded-b-2xl">
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
