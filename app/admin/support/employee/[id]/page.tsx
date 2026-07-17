'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEmployeeDetail } from './EmployeeDetail.logic';

// 🔧 UI CONFIGURATION
const SECTION_GAP = 'mt-8';
const CARD_STYLE = 'bg-white rounded-2xl border border-slate-100 shadow-sm';

export default function EmployeeDetailPage() {
  const params = useParams();
  const employeeId = params.id as string;
  const logic = useEmployeeDetail(employeeId);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewingTaskId, setReviewingTaskId] = useState<string | null>(null);

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

  // Split today tasks into groups
  const completedTasks = logic.todayTasks.filter(t => t.status === 'COMPLETED');
  const pendingReviewTasks = completedTasks.filter(t => t.inspection_status === 'PENDING_REVIEW' || t.inspection_status === 'NOT_REVIEWED');
  const passedTasks = completedTasks.filter(t => t.inspection_status === 'PASSED');
  const reworkTasks = logic.todayTasks.filter(t => t.inspection_status === 'REWORK_REQUIRED' && t.status !== 'COMPLETED');
  const inProgressTasks = logic.todayTasks.filter(t => t.status !== 'COMPLETED' && t.inspection_status !== 'REWORK_REQUIRED');

  const totalTasks = logic.todayTasks.length;
  const doneCount = passedTasks.length;
  const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto min-h-screen bg-slate-50">
      {/* Back + Employee Header */}
      <div className="mb-6">
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

        {/* Progress bar */}
        {totalTasks > 0 && (
          <div className="mt-4 bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-sm font-medium text-slate-600">Tiến độ hôm nay</span>
              <span className="text-sm font-bold text-cyan-600">{doneCount}/{totalTasks} hoàn thành ({pct}%)</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-green-500' : 'bg-cyan-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ======================== PHẦN A: GIAO VIỆC ======================== */}
      <section className={CARD_STYLE + ' p-5'}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-slate-800">📌 Checklist Công Việc Cố Định</h2>
          <button
            onClick={() => logic.setShowAddModal(true)}
            className="bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-cyan-700 transition-colors shadow-sm"
          >
            + Thêm việc
          </button>
        </div>

        {logic.routines.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">Chưa có công việc nào. Bấm &quot;+ Thêm việc&quot; để bắt đầu giao.</p>
        ) : (
          <div className="space-y-2">
            {logic.routines.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors group">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-green-500 text-lg">☑</span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 truncate">{r.templateName}</p>
                    <p className="text-xs text-slate-400">{r.categoryName} {r.requiresPhoto ? `• 📷 ≥${r.minPhotoCount} ảnh` : ''}</p>
                  </div>
                </div>
                <button
                  onClick={() => logic.removeRoutine(r.id)}
                  className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1"
                  title="Xóa khỏi checklist"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ======================== PHẦN B: NGHIỆM THU ======================== */}
      <section className={CARD_STYLE + ' p-5 ' + SECTION_GAP}>
        <h2 className="text-lg font-bold text-slate-800 mb-4">📸 Nghiệm Thu Hôm Nay</h2>

        {logic.todayTasks.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">Chưa có công việc nào được tạo hôm nay.</p>
        ) : (
          <div className="space-y-3">
            {/* Cần làm lại (Rework) */}
            {reworkTasks.length > 0 && (
              <>
                <div className="text-xs font-bold text-red-500 uppercase tracking-wide px-1">🔴 Cần làm lại ({reworkTasks.length})</div>
                {reworkTasks.map((t) => (
                  <TaskRow key={t.id} task={t} variant="rework" />
                ))}
              </>
            )}

            {/* Chờ nghiệm thu */}
            {pendingReviewTasks.length > 0 && (
              <>
                <div className="text-xs font-bold text-amber-600 uppercase tracking-wide px-1 mt-4">🟡 Chờ nghiệm thu ({pendingReviewTasks.length})</div>
                {pendingReviewTasks.map((t) => (
                  <div key={t.id}>
                    <TaskRow task={t} variant="pending_review" />
                    <div className="flex items-center gap-2 ml-8 mt-2">
                      {reviewingTaskId === t.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            placeholder="Ghi chú (tùy chọn)..."
                            value={reviewNote}
                            onChange={(e) => setReviewNote(e.target.value)}
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                          />
                          <button
                            onClick={() => { logic.reviewTask(t.id, 'REWORK_REQUIRED', reviewNote); setReviewingTaskId(null); setReviewNote(''); }}
                            disabled={logic.submitting}
                            className="bg-red-500 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                          >
                            Xác nhận
                          </button>
                          <button
                            onClick={() => { setReviewingTaskId(null); setReviewNote(''); }}
                            className="text-slate-400 hover:text-slate-600 text-xs"
                          >
                            Hủy
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => logic.reviewTask(t.id, 'PASSED')}
                            disabled={logic.submitting}
                            className="bg-green-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-green-600 transition-colors disabled:opacity-50 shadow-sm"
                          >
                            ✓ Đạt
                          </button>
                          <button
                            onClick={() => setReviewingTaskId(t.id)}
                            className="bg-red-50 text-red-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-100 transition-colors border border-red-200"
                          >
                            ↩ Làm lại
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Chưa bắt đầu / Đang làm */}
            {inProgressTasks.length > 0 && (
              <>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wide px-1 mt-4">⏳ Đang thực hiện ({inProgressTasks.length})</div>
                {inProgressTasks.map((t) => (
                  <TaskRow key={t.id} task={t} variant="in_progress" />
                ))}
              </>
            )}

            {/* Đã nghiệm thu đạt */}
            {passedTasks.length > 0 && (
              <>
                <div className="text-xs font-bold text-green-600 uppercase tracking-wide px-1 mt-4">✅ Đã nghiệm thu đạt ({passedTasks.length})</div>
                {passedTasks.map((t) => (
                  <TaskRow key={t.id} task={t} variant="passed" />
                ))}
              </>
            )}
          </div>
        )}
      </section>

      {/* ======================== MODAL: THÊM CÔNG VIỆC ======================== */}
      {logic.showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="font-bold text-lg text-slate-800">
                Thêm công việc cho <span className="text-cyan-600">{logic.employee?.fullName}</span>
              </h2>
              <button onClick={() => { logic.setShowAddModal(false); logic.setSearchQuery(''); }} className="text-slate-400 hover:text-slate-600 text-xl">
                ✕
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-slate-100">
              <input
                type="text"
                placeholder="🔍 Tìm hoặc gõ tên công việc..."
                value={logic.searchQuery}
                onChange={(e) => logic.setSearchQuery(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-200 focus:border-cyan-400"
                autoFocus
              />
            </div>

            {/* Template list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {logic.filteredTemplates.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">Không tìm thấy công việc phù hợp.</p>
              ) : (
                logic.filteredTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => logic.addRoutine(tpl.id)}
                    disabled={logic.submitting}
                    className="w-full text-left p-4 bg-slate-50 rounded-xl hover:bg-cyan-50 hover:border-cyan-200 border border-transparent transition-all flex items-center justify-between disabled:opacity-50"
                  >
                    <div>
                      <p className="font-medium text-slate-700">{tpl.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{tpl.categoryName}</p>
                    </div>
                    <span className="text-cyan-500 text-sm font-bold">+ Thêm</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-component: Task Row
// ============================================================
interface TaskRowProps {
  task: {
    id: string;
    name: string;
    status: string;
    task_type: string;
    priority: string;
    completedAt: string | null;
    photoCount: number;
  };
  variant: 'rework' | 'pending_review' | 'in_progress' | 'passed';
}

const TaskRow = ({ task, variant }: TaskRowProps) => {
  const bgMap = {
    rework: 'bg-red-50 border-red-200',
    pending_review: 'bg-amber-50 border-amber-200',
    in_progress: 'bg-slate-50 border-slate-200',
    passed: 'bg-green-50 border-green-200',
  };

  const iconMap = {
    rework: '🔴',
    pending_review: '🟡',
    in_progress: '🔲',
    passed: '✅',
  };

  const completedTime = task.completedAt ? new Date(task.completedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className={`flex items-center justify-between p-3 rounded-xl border ${bgMap[variant]} transition-colors`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-lg">{iconMap[variant]}</span>
        <div className="min-w-0">
          <p className={`font-medium truncate ${variant === 'passed' ? 'text-green-700 line-through' : 'text-slate-700'}`}>
            {task.name}
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
            {task.task_type === 'AD-HOC' && <span className="bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">ĐỘT XUẤT</span>}
            {task.priority === 'HIGH' && <span className="bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold">GẤP</span>}
            {task.photoCount > 0 && <span>📷 {task.photoCount} ảnh</span>}
            {completedTime && <span>Xong lúc {completedTime}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
