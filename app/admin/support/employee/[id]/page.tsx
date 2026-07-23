'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';
import { useEmployeeDetail } from './EmployeeDetail.logic';

export default function EmployeeDetailPage() {
  const params = useParams();
  const employeeId = params.id as string;
  const logic = useEmployeeDetail(employeeId);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewingTaskId, setReviewingTaskId] = useState<string | null>(null);
  const [adhocTaskName, setAdhocTaskName] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (catName: string) => {
    setExpandedCategories(prev => ({ ...prev, [catName]: !prev[catName] }));
  };

  if (logic.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500">Đang tải...</p>
        </div>
      </div>
    );
  }

  if (!logic.employee) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <p className="text-slate-500">Không tìm thấy nhân viên.</p>
      </div>
    );
  }

  const passedTasks = logic.todayTasks.filter(t => t.inspection_status === 'PASSED');
  const totalTasks = logic.todayTasks.length;
  const doneCount = passedTasks.length;
  const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  // Group tasks by category
  const groupedTasks = logic.todayTasks.reduce((acc, task) => {
    let cat = task.categoryName || 'Chưa phân loại';
    if (task.task_type === 'AD_HOC') cat = 'VIỆC ĐỘT XUẤT PHÁT SINH';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(task);
    return acc;
  }, {} as Record<string, typeof logic.todayTasks>);

  // Ensure "VIỆC ĐỘT XUẤT PHÁT SINH" is always at the top if it exists
  const categoryKeys = Object.keys(groupedTasks).sort((a, b) => {
    if (a === 'VIỆC ĐỘT XUẤT PHÁT SINH') return -1;
    if (b === 'VIỆC ĐỘT XUẤT PHÁT SINH') return 1;
    return a.localeCompare(b);
  });

  return (
    <AppLayout title="Chi Tiết Nhân Viên">
      <div className="p-4 md:p-6 max-w-5xl mx-auto min-h-screen">
        
        {/* ==================== HEADER ==================== */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <Link href="/admin/support/templates" className="text-cyan-600 hover:text-cyan-700 text-sm font-medium mb-3 inline-flex items-center gap-1">
              ← Về danh sách
            </Link>
            <div className="flex items-center gap-4 mt-2">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white font-bold text-xl shadow-md">
                {logic.employee.fullName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">{logic.employee.fullName}</h1>
                <p className="text-slate-500">{logic.getRoleLabel(logic.employee.role)}</p>
              </div>
            </div>
          </div>
          
          <button
            onClick={() => logic.setShowAddModal(true)}
            className="bg-white text-cyan-600 border border-cyan-200 px-4 py-2 rounded-xl text-sm font-bold hover:bg-cyan-50 transition-colors shadow-sm"
          >
            + Chỉnh sửa Checklist Cố định
          </button>
        </div>

        {/* ==================== TABS ==================== */}
        <div className="flex gap-8 mb-6 border-b border-slate-200 px-2">
          <div className="pb-4 text-cyan-600 border-b-2 border-cyan-600 font-bold">
            📋 Checklist Công Việc Hôm Nay
          </div>
        </div>

        {/* ==================== CONTENT ==================== */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-slate-500 font-medium text-sm">Tiến độ hôm nay: <strong className="text-cyan-600 text-base">{doneCount}/{totalTasks} hoàn thành</strong></p>
            {totalTasks > 0 && (
              <div className="w-48 h-2 bg-slate-200 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
          <button
            onClick={() => logic.setShowAdhocModal(true)}
            className="bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-600 transition-colors shadow-sm"
          >
            + Giao Việc Đột Xuất Ngay
          </button>
        </div>

        {totalTasks === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <p className="text-slate-500 mb-4">Nhân viên này chưa có công việc nào trong hôm nay.</p>
            <button
              onClick={() => logic.setShowAddModal(true)}
              className="bg-cyan-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-cyan-700"
            >
              Cấu hình Checklist Cố định
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {categoryKeys.map((catName) => {
              const isUrgent = catName === 'VIỆC ĐỘT XUẤT PHÁT SINH';
              const tasks = groupedTasks[catName];

              return (
                <div key={catName} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className={`px-4 py-3 border-b text-sm font-bold flex items-center gap-2 uppercase ${isUrgent ? 'bg-red-50 border-red-200 text-red-600' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                    {isUrgent && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
                    {catName}
                  </div>
                  
                  <div className="divide-y divide-slate-100">
                    {tasks.map((task, idx) => {
                      const isPendingReview = task.status === 'COMPLETED' && (task.inspection_status === 'PENDING_REVIEW' || task.inspection_status === 'NOT_REVIEWED');
                      const isRework = task.inspection_status === 'REWORK_REQUIRED' && task.status !== 'COMPLETED';
                      const isPassed = task.inspection_status === 'PASSED';
                      const isInProgress = task.status === 'IN_PROGRESS' && !isRework;
                      const isNotStarted = task.status === 'NOT_STARTED';

                      return (
                        <div key={task.id} className={`flex items-center justify-between p-4 gap-4 transition-colors ${isPendingReview ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                          
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium text-slate-800 ${isPassed ? 'line-through text-slate-400' : ''}`}>
                              {idx + 1}. {task.name}
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                              {task.photoCount > 0 && <span className="text-cyan-600 font-medium">📷 Yêu cầu ảnh</span>}
                              {task.completedAt && <span>Hoàn thành lúc {new Date(task.completedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>}
                            </div>
                          </div>

                          {/* Inline Controls or Badges */}
                          <div className="flex-shrink-0">
                            {isNotStarted && <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold">Chưa làm</span>}
                            {isInProgress && <span className="px-3 py-1 bg-amber-100 text-amber-600 rounded-lg text-xs font-bold">⏳ Đang làm</span>}
                            {isRework && <span className="px-3 py-1 bg-red-100 text-red-600 rounded-lg text-xs font-bold">🔴 Đang làm lại</span>}
                            {isPassed && <span className="px-3 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-bold">✓ Đã duyệt</span>}
                            
                            {isPendingReview && (
                              <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-amber-200">
                                <button className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-amber-300 rounded-lg text-cyan-600 text-xs font-bold hover:bg-cyan-50">
                                  <span>📷</span> Xem {task.photoCount} ảnh
                                </button>
                                
                                {reviewingTaskId === task.id ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      placeholder="Lý do làm lại..."
                                      value={reviewNote}
                                      onChange={(e) => setReviewNote(e.target.value)}
                                      className="text-xs border border-slate-200 rounded px-2 py-1.5 w-32 focus:outline-none focus:border-red-400"
                                    />
                                    <button 
                                      onClick={() => { logic.reviewTask(task.id, 'REWORK_REQUIRED', reviewNote); setReviewingTaskId(null); setReviewNote(''); }}
                                      className="bg-red-500 text-white px-2 py-1.5 rounded text-xs font-bold hover:bg-red-600"
                                    >Gửi</button>
                                    <button onClick={() => setReviewingTaskId(null)} className="text-slate-400 hover:text-slate-600 text-xs font-bold">✕</button>
                                  </div>
                                ) : (
                                  <>
                                    <button 
                                      onClick={() => logic.reviewTask(task.id, 'PASSED')}
                                      className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-green-600"
                                    >✓ Pass</button>
                                    <button 
                                      onClick={() => setReviewingTaskId(task.id)}
                                      className="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-600"
                                    >↩ Làm lại</button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* ======================== MODAL: CẤU HÌNH CHECKLIST ======================== */}
      {logic.showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center p-4 pt-10">
          <div className="bg-white w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[85vh]">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <div>
                <h2 className="font-bold text-lg text-slate-800">Cấu hình Checklist Cố Định</h2>
                <p className="text-sm text-slate-500">Gán các công việc định kỳ hằng ngày cho nhân viên {logic.employee?.fullName}</p>
              </div>
              <button onClick={() => logic.setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl font-light">✕</button>
            </div>
            
            <div className="flex flex-1 overflow-hidden">
              {/* Left: Available Templates */}
              <div className="w-1/2 border-r border-slate-200 flex flex-col bg-slate-50/50">
                <div className="p-4 border-b border-slate-200">
                  <input
                    type="text"
                    placeholder="🔍 Tìm trong kho việc..."
                    value={logic.searchQuery}
                    onChange={(e) => logic.setSearchQuery(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200"
                  />
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  <h3 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">KHO VIỆC CÓ SẴN</h3>
                  {Object.entries(
                    logic.availableTemplates
                      .filter(t => t.categoryName.toLowerCase().includes(logic.searchQuery.toLowerCase()) || t.name.toLowerCase().includes(logic.searchQuery.toLowerCase()))
                      .reduce((acc, t) => {
                        if (!acc[t.categoryName]) acc[t.categoryName] = [];
                        acc[t.categoryName].push(t);
                        return acc;
                      }, {} as Record<string, typeof logic.availableTemplates>)
                  ).map(([catName, templates]) => {
                    const allAssigned = templates.every(t => logic.routines.some(r => r.templateId === t.id));
                    const assignedCount = templates.filter(t => logic.routines.some(r => r.templateId === t.id)).length;
                    return (
                      <div key={catName} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div 
                          className="p-3 flex items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors"
                          onClick={() => toggleCategory(catName)}
                        >
                          <div className="min-w-0 pr-2">
                            <p className="text-sm font-bold text-slate-700 truncate">{catName}</p>
                            <p className="text-xs text-slate-400 truncate">{templates.length} công việc con {assignedCount > 0 && `(Đã gán ${assignedCount})`}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {allAssigned ? (
                              <span className="text-green-500 text-xs font-bold">Đã gán hết</span>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); logic.assignCategory(catName); }}
                                disabled={logic.submitting}
                                className="bg-cyan-50 text-cyan-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-cyan-100 whitespace-nowrap"
                              >
                                + Gán toàn bộ
                              </button>
                            )}
                            <span className="text-slate-400 w-5 text-center text-xs">{expandedCategories[catName] ? '▲' : '▼'}</span>
                          </div>
                        </div>
                        {expandedCategories[catName] && (
                          <div className="border-t border-slate-100 bg-slate-50/50 p-2 space-y-1">
                            {templates.map(tpl => {
                              const isAdded = logic.routines.some(r => r.templateId === tpl.id);
                              return (
                                <div key={tpl.id} className="flex justify-between items-center py-1.5 px-2 rounded hover:bg-slate-100">
                                  <span className="text-xs text-slate-600 truncate pr-2">{tpl.name}</span>
                                  {isAdded ? (
                                    <span className="text-green-500 text-[10px] font-bold shrink-0">Đã gán</span>
                                  ) : (
                                    <button
                                      onClick={() => logic.addRoutine(tpl.id)}
                                      disabled={logic.submitting}
                                      className="text-cyan-600 hover:text-cyan-800 text-[10px] font-bold bg-white px-2 py-0.5 rounded shadow-sm border border-slate-200 shrink-0"
                                    >
                                      + Gán lẻ
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Current Routines */}
              <div className="w-1/2 flex flex-col bg-white">
                <div className="p-4 border-b border-slate-200 bg-white">
                  <h3 className="text-sm font-bold text-slate-800">Checklist Đã Gán ({logic.routines.length})</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {Object.entries(
                    logic.routines.reduce((acc, r) => {
                      const cat = r.categoryName || 'Chưa phân loại';
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(r);
                      return acc;
                    }, {} as Record<string, typeof logic.routines>)
                  ).map(([catName, routines]) => (
                    <div key={catName}>
                      <h4 className="text-xs font-bold text-slate-500 mb-2 uppercase">{catName}</h4>
                      <div className="space-y-2">
                        {routines.map((r) => (
                          <div key={r.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between group">
                            <p className="text-sm font-medium text-slate-700 truncate pr-2">{r.templateName}</p>
                            <button
                              onClick={() => logic.removeRoutine(r.id)}
                              className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================== MODAL: GIAO VIỆC ĐỘT XUẤT ======================== */}
      {logic.showAdhocModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-100 bg-red-50 flex items-center gap-3">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
              <h2 className="font-bold text-red-600 text-lg">Giao Việc Đột Xuất</h2>
            </div>
            <div className="p-5">
              <label className="block text-sm font-bold text-slate-700 mb-2">Tên công việc phát sinh</label>
              <textarea
                value={adhocTaskName}
                onChange={(e) => setAdhocTaskName(e.target.value)}
                placeholder="Ví dụ: Sửa ống nước bồn rửa tay phòng VIP 1..."
                className="w-full border border-slate-300 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                rows={3}
                autoFocus
              />
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => logic.setShowAdhocModal(false)}
                  className="flex-1 bg-white border border-slate-300 text-slate-600 py-2.5 rounded-xl font-bold"
                >Hủy</button>
                <button
                  onClick={() => {
                    if (adhocTaskName.trim()) {
                      logic.createAdhocTask(adhocTaskName.trim());
                      setAdhocTaskName('');
                    }
                  }}
                  disabled={!adhocTaskName.trim() || logic.submitting}
                  className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-bold hover:bg-red-600 disabled:opacity-50"
                >Giao Việc Ngay</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </AppLayout>
  );
}
