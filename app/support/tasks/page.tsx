'use client';

import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSupportTasks } from './SupportEmployeeTasks.logic';
import { Camera, Check, Upload, Clock, AlertCircle, ArrowLeft } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';

// 🔧 UI CONFIGURATION
const PROGRESS_HEIGHT = 'h-3';
const BUTTON_MIN_SIZE = 'min-h-[44px] min-w-[44px]'; // Touch target >= 44px

export default function SupportEmployeeTasksPage() {
  const router = useRouter();
  const logic = useSupportTasks();

  if (logic.loading) {
    return (
      <AppLayout title="Công Việc Hôm Nay">
        <div className="flex items-center justify-center min-h-[70vh] bg-slate-50">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-500">Đang tải công việc...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const todayStr = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });

  return (
    <AppLayout title="Công Việc Hôm Nay">
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Mobile Top Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <button 
            onClick={() => router.back()}
            className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-slate-800 truncate">📋 Công Việc Hôm Nay</h1>
            <p className="text-slate-500 text-xs capitalize truncate">{todayStr}</p>
          </div>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto">
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

      {/* Notifications */}
      {logic.notifications.length > 0 && (
        <div className="space-y-2 mb-5">
          {logic.notifications.map((n) => (
            <div key={n.id} className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3">
              <AlertCircle className="text-red-500 mt-0.5 shrink-0" size={20} />
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
        <section className="mb-6">
          <div className="bg-red-50 border border-red-200 rounded-t-xl px-4 py-3 flex items-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide">CÁC VIỆC ĐỘT XUẤT PHÁT SINH</h2>
          </div>
          <div className="bg-white border-x border-b border-red-100 rounded-b-xl overflow-hidden divide-y divide-slate-100 shadow-sm">
            {logic.urgentTasks.map((task, index) => (
              <TaskRow key={task.id} index={index + 1} task={task} logic={logic} isUrgent={true} />
            ))}
          </div>
        </section>
      )}

      {/* ======================== CÁC DANH MỤC CÔNG VIỆC ======================== */}
      {logic.sortedCategories.map((group) => {
        if (group.tasks.length === 0) return null;
        return (
          <section key={group.categoryName} className="mb-6">
            <div className="bg-slate-200 text-slate-700 px-4 py-3 rounded-t-xl">
              <h2 className="text-sm font-bold uppercase tracking-wide">{group.categoryName}</h2>
            </div>
            <div className="bg-white border-x border-b border-slate-200 rounded-b-xl overflow-hidden divide-y divide-slate-100 shadow-sm">
              {group.tasks.map((task, index) => (
                <TaskRow key={task.id} index={index + 1} task={task} logic={logic} isUrgent={false} />
              ))}
            </div>
          </section>
        );
      })}

      {/* No tasks */}
      {logic.totalTasks === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🎉</p>
          <p className="text-slate-500">Chưa có công việc nào được giao cho bạn hôm nay.</p>
        </div>
      )}
      </div>
    </div>
    </AppLayout>
  );
}

// ============================================================
// Sub-components
// ============================================================
const TaskRow = ({ task, index, logic, isUrgent }: { task: any; index: number; logic: any; isUrgent: boolean }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const isCompleted = task.status === 'COMPLETED';
  const isRework = task.inspection_status === 'REWORK_REQUIRED';
  const hasEnoughPhotos = !task.requires_photo || task.photoCount >= task.min_photo_count;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      logic.uploadPhoto(task.id, file);
    }
  };

  return (
    <div className={`p-4 flex flex-col gap-3 transition-colors ${isCompleted ? 'bg-green-50/30' : ''} ${isRework ? 'bg-red-50/50' : ''}`}>
      {/* Top Row: Name and Photo Upload Icon */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex items-start gap-2">
          <span className="font-semibold text-slate-400 shrink-0">{index}.</span>
          <div>
            <p className={`text-sm font-medium ${isCompleted ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
              {task.name}
            </p>
            
            {/* Status / Tags */}
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {isRework && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Làm lại</span>}
              {task.priority === 'HIGH' && !isUrgent && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Ưu tiên</span>}
              
              {task.requires_photo && (
                <span className={`text-[11px] ${hasEnoughPhotos ? 'text-green-600 font-bold' : 'text-slate-500'}`}>
                  📷 {task.photoCount}/{task.min_photo_count} ảnh
                </span>
              )}
              {isCompleted && task.completedAt && (
                <span className="text-[11px] text-green-600 flex items-center gap-1 font-bold">
                  <Clock size={10} /> {new Date(task.completedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions (Camera / Check) */}
        <div className="shrink-0 flex flex-col gap-2">
          {!isCompleted && task.requires_photo && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={logic.uploading}
                className={`flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-colors shrink-0 ${
                  hasEnoughPhotos 
                  ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' 
                  : 'bg-cyan-50 text-cyan-500 border border-cyan-200'
                }`}
                title="Chụp ảnh minh chứng"
              >
                {logic.uploading ? (
                  <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera size={20} strokeWidth={hasEnoughPhotos ? 2.5 : 2} />
                )}
              </button>
            </div>
          )}

          {/* Submit Button */}
          {!isCompleted && hasEnoughPhotos && (
            <button
              onClick={() => logic.submitTask(task.id)}
              className="w-12 h-12 bg-cyan-600 text-white rounded-xl text-sm font-bold flex items-center justify-center hover:bg-cyan-700 active:bg-cyan-800 transition-colors shadow-sm"
              title="Gửi kết quả"
            >
              <Upload size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
