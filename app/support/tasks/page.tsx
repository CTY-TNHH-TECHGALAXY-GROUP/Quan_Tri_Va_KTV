'use client';

import React, { useRef } from 'react';
import { useSupportTasks } from './SupportEmployeeTasks.logic';

// 🔧 UI CONFIGURATION
const PROGRESS_HEIGHT = 'h-3';
const BUTTON_MIN_SIZE = 'min-h-[44px] min-w-[44px]'; // Touch target >= 44px

export default function SupportEmployeeTasksPage() {
  const logic = useSupportTasks();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (logic.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-500">Đang tải công việc...</p>
        </div>
      </div>
    );
  }

  const todayStr = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });

  return (
    <div className="p-4 max-w-lg mx-auto min-h-screen bg-slate-50">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800">📋 Công Việc Hôm Nay</h1>
        <p className="text-slate-500 text-sm capitalize">{todayStr}</p>
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm mb-5">
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-sm font-medium text-slate-600">Hoàn thành</span>
          <span className="text-sm font-bold text-cyan-600">{logic.doneCount}/{logic.totalTasks} ({logic.pct}%)</span>
        </div>
        <div className={`w-full ${PROGRESS_HEIGHT} bg-slate-100 rounded-full overflow-hidden`}>
          <div
            className={`${PROGRESS_HEIGHT} rounded-full transition-all duration-700 ${logic.pct >= 100 ? 'bg-green-500' : 'bg-gradient-to-r from-cyan-500 to-blue-500'}`}
            style={{ width: `${logic.pct}%` }}
          />
        </div>
      </div>

      {/* Notifications (Rework alerts) */}
      {logic.notifications.length > 0 && (
        <div className="space-y-2 mb-5">
          {logic.notifications.map((n) => (
            <div key={n.id} className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
              <span className="text-red-500 text-lg mt-0.5">🔔</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-700">{n.message}</p>
                <p className="text-xs text-red-400 mt-0.5">
                  {new Date(n.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <button
                onClick={() => logic.dismissNotification(n.id)}
                className="text-red-300 hover:text-red-500 text-sm"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ======================== VIỆC ĐỘT XUẤT ======================== */}
      {logic.urgentTasks.length > 0 && (
        <section className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide">Việc đột xuất ({logic.urgentTasks.length})</h2>
          </div>
          <div className="space-y-2">
            {logic.urgentTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                variant="urgent"
                onStart={() => logic.startTask(task.id)}
                onOpen={() => logic.setSelectedTask(task)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ======================== CHƯA HOÀN THÀNH ======================== */}
      {logic.incompleteTasks.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">
            🟡 Chưa hoàn thành ({logic.incompleteTasks.length})
          </h2>
          <div className="space-y-2">
            {logic.incompleteTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                variant="pending"
                onStart={() => logic.startTask(task.id)}
                onOpen={() => logic.setSelectedTask(task)}
              />
            ))}
          </div>
        </section>
      )}

      {/* ======================== ĐÃ HOÀN THÀNH ======================== */}
      {logic.completedTasks.length > 0 && (
        <section className="mb-5">
          <h2 className="text-sm font-bold text-green-600 uppercase tracking-wide mb-3">
            ✅ Đã hoàn thành ({logic.completedTasks.length})
          </h2>
          <div className="space-y-2">
            {logic.completedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                variant="done"
                onStart={() => {}}
                onOpen={() => {}}
              />
            ))}
          </div>
        </section>
      )}

      {/* No tasks */}
      {logic.totalTasks === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🎉</p>
          <p className="text-slate-500">Chưa có công việc nào được giao cho bạn hôm nay.</p>
        </div>
      )}

      {/* ======================== DRAWER: CHI TIẾT CÔNG VIỆC ======================== */}
      {logic.selectedTask && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center">
          <div className="bg-white w-full max-w-lg rounded-t-2xl overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="font-bold text-slate-800 text-lg truncate pr-4">{logic.selectedTask.name}</h2>
              <button
                onClick={() => logic.setSelectedTask(null)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Status */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">Trạng thái:</span>
                <StatusBadge status={logic.selectedTask.status} inspectionStatus={logic.selectedTask.inspection_status} />
              </div>

              {/* Photo Section */}
              {logic.selectedTask.requires_photo && (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">
                    📷 Ảnh minh chứng (Tối thiểu {logic.selectedTask.min_photo_count})
                  </p>
                  <p className="text-xs text-slate-400 mb-3">Đã chụp: {logic.selectedTask.photoCount} ảnh</p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && logic.selectedTask) {
                        logic.uploadPhoto(logic.selectedTask.id, file);
                      }
                    }}
                  />

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={logic.uploading}
                    className={`w-full ${BUTTON_MIN_SIZE} bg-slate-100 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 font-medium hover:bg-cyan-50 hover:border-cyan-300 transition-colors disabled:opacity-50`}
                  >
                    {logic.uploading ? 'Đang tải lên...' : '📷 Chụp / Chọn ảnh'}
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50">
              {logic.selectedTask.status !== 'COMPLETED' && (
                <button
                  onClick={() => logic.completeTask(logic.selectedTask!.id)}
                  className={`w-full ${BUTTON_MIN_SIZE} bg-green-500 text-white rounded-xl font-bold text-base hover:bg-green-600 transition-colors shadow-lg shadow-green-200`}
                >
                  ✓ Hoàn thành công việc
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================
interface TaskCardProps {
  task: {
    id: string;
    name: string;
    status: string;
    inspection_status: string;
    task_type: string;
    priority: string;
    completedAt: string | null;
    photoCount: number;
  };
  variant: 'urgent' | 'pending' | 'done';
  onStart: () => void;
  onOpen: () => void;
}

const TaskCard = ({ task, variant, onStart, onOpen }: TaskCardProps) => {
  const bgMap = {
    urgent: 'bg-red-50 border-red-200 hover:border-red-300',
    pending: 'bg-white border-slate-200 hover:border-cyan-300',
    done: 'bg-green-50/50 border-green-200',
  };

  const completedTime = task.completedAt
    ? new Date(task.completedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : null;

  const isNotStarted = task.status === 'NOT_STARTED';
  const isRework = task.inspection_status === 'REWORK_REQUIRED';

  return (
    <div className={`rounded-xl border ${bgMap[variant]} p-4 transition-all`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0" onClick={variant !== 'done' ? onOpen : undefined}>
          <p className={`font-medium truncate ${variant === 'done' ? 'text-green-700 line-through' : 'text-slate-800'}`}>
            {task.name}
          </p>
          <div className="flex items-center gap-2 text-xs mt-1">
            {variant === 'urgent' && <span className="bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold animate-pulse">GẤP!</span>}
            {isRework && <span className="bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">↩ CẦN LÀM LẠI</span>}
            {task.priority === 'HIGH' && variant !== 'urgent' && <span className="bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold">ƯU TIÊN</span>}
            {task.photoCount > 0 && <span className="text-slate-400">📷 {task.photoCount}</span>}
            {completedTime && <span className="text-green-600">{completedTime}</span>}
          </div>
        </div>

        {variant !== 'done' && (
          isNotStarted ? (
            <button
              onClick={onStart}
              className="min-h-[44px] min-w-[88px] bg-cyan-500 text-white rounded-xl text-sm font-bold hover:bg-cyan-600 transition-colors shadow-sm"
            >
              BẮT ĐẦU
            </button>
          ) : (
            <button
              onClick={onOpen}
              className="min-h-[44px] min-w-[88px] bg-green-500 text-white rounded-xl text-sm font-bold hover:bg-green-600 transition-colors shadow-sm"
            >
              LÀM TIẾP
            </button>
          )
        )}
      </div>
    </div>
  );
};

const StatusBadge = ({ status, inspectionStatus }: { status: string; inspectionStatus: string }) => {
  if (inspectionStatus === 'REWORK_REQUIRED') {
    return <span className="bg-red-100 text-red-600 px-2 py-1 rounded-lg text-xs font-bold">Cần làm lại</span>;
  }
  if (inspectionStatus === 'PASSED') {
    return <span className="bg-green-100 text-green-700 px-2 py-1 rounded-lg text-xs font-bold">Đã nghiệm thu ✅</span>;
  }
  if (status === 'COMPLETED') {
    return <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg text-xs font-bold">Chờ nghiệm thu</span>;
  }
  if (status === 'IN_PROGRESS') {
    return <span className="bg-cyan-100 text-cyan-700 px-2 py-1 rounded-lg text-xs font-bold">Đang làm</span>;
  }
  return <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded-lg text-xs font-bold">Chưa bắt đầu</span>;
};
