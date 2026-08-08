'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupportTasks } from './SupportEmployeeTasks.logic';
import { Camera, Check, Upload, Clock, AlertCircle, ArrowLeft, ChevronDown, ChevronUp, Send, Eye, X, Trash2, User } from 'lucide-react';
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
        <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[70vh] bg-slate-50">
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
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
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

      <div className="p-4 max-w-3xl mx-auto">
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

      {/* ======================== VIỆC TỒN ĐỌNG (CARRY-OVER) ======================== */}
      {logic.carryOverTasks.length > 0 && (
        <CarryOverSection groups={logic.carryOverTasks} logic={logic} />
      )}

      {/* ======================== VIỆC ĐỘT XUẤT ======================== */}
      {logic.urgentTasks.length > 0 && (
        <UrgentSection tasks={logic.urgentTasks} logic={logic} />
      )}

      {/* ======================== CÁC DANH MỤC CÔNG VIỆC ======================== */}
      {logic.sortedCategories.map((group) => {
        if (group.tasks.length === 0) return null;
        return <CategoryGroup key={group.categoryName} group={group} logic={logic} />;
      })}

      {/* No tasks */}
      {logic.totalTasks === 0 && (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🎉</p>
          <p className="text-slate-500">Chưa có công việc nào được giao cho bạn hôm nay.</p>
        </div>
      )}
      </div>

      {/* Photo Viewer Modal */}
      {logic.viewingTaskPhotos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800">Ảnh đã tải lên</h3>
              <button 
                onClick={() => logic.setViewingTaskPhotos(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              {logic.viewingTaskPhotos.photos.map((photo: any, idx: number) => (
                <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 group">
                  <img src={photo.url} alt={`Ảnh ${idx + 1}`} className="w-full h-auto object-contain bg-slate-50" />
                  <button 
                    onClick={() => {
                      if (confirm('Bạn có chắc chắn muốn xoá ảnh này?')) {
                        logic.deletePhoto(photo.id, photo.storage_path, logic.viewingTaskPhotos?.taskId || '');
                      }
                    }}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity"
                    title="Xoá ảnh"
                  >
                    <Trash2 size={16} />
                  </button>
                  <div className="p-2 text-xs text-center text-slate-500 bg-slate-50 border-t border-slate-200">
                    {new Date(photo.created_at).toLocaleString('vi-VN')}
                  </div>
                </div>
              ))}
              {logic.viewingTaskPhotos.photos.length === 0 && (
                <p className="text-center text-slate-500 py-8">Chưa có ảnh nào.</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
    </AppLayout>
  );
}

// ============================================================
// Sub-components
// ============================================================

const CarryOverSection = ({ groups, logic }: { groups: any[], logic: any }) => {
  const [isOpen, setIsOpen] = useState(false);
  const totalTasks = groups.reduce((acc, g) => acc + g.tasks.length, 0);

  return (
    <section className="mb-6">
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-amber-50 border border-amber-200 rounded-t-xl px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-amber-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 bg-amber-500 rounded-full animate-pulse" />
          <h2 className="text-sm font-bold text-amber-700 uppercase tracking-wide">Việc tồn đọng — Cần xử lý trước 9h</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-amber-600 bg-amber-200/50 px-2 py-0.5 rounded-full">{totalTasks} việc</span>
          <div className="text-amber-600">
            {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
      </div>
      
      {isOpen && (
        <div className="bg-white border-x border-b border-amber-100 rounded-b-xl overflow-hidden shadow-sm animate-in slide-in-from-top-2 fade-in duration-200">
          {groups.map((group) => (
            <div key={group.categoryName}>
              {/* Category header */}
              <div className="bg-amber-50/50 px-4 py-2 flex items-center justify-between border-b border-amber-100">
                <span className="text-xs font-bold text-amber-800 uppercase">{group.categoryName}</span>
                {group.carryOverDate && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                    📅 {new Date(group.carryOverDate).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                  </span>
                )}
              </div>
              {/* Tasks */}
              <div className="divide-y divide-slate-100">
                {group.tasks.map((task: any, index: number) => (
                  <div key={task.id} className="relative">
                    {/* Carry-over badge overlay */}
                    <div className="absolute top-2 right-2 z-10 flex gap-1">
                      {task.inspection_status === 'REWORK_REQUIRED' && (
                        <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">🔁 Làm lại</span>
                      )}
                      <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded font-bold">
                        📅 {task.carryOverDate ? new Date(task.carryOverDate).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : 'Hôm qua'}
                      </span>
                    </div>
                    <TaskRow index={index + 1} task={task} logic={logic} isUrgent={false} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const UrgentSection = ({ tasks, logic }: { tasks: any[], logic: any }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="mb-6">
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-red-50 border border-red-200 rounded-t-xl px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-red-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide">CÁC VIỆC ĐỘT XUẤT PHÁT SINH</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-red-600 bg-red-200/50 px-2 py-0.5 rounded-full">{tasks.length} việc</span>
          <div className="text-red-600">
            {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
      </div>
      
      {isOpen && (
        <div className="bg-white border-x border-b border-red-100 rounded-b-xl overflow-hidden divide-y divide-slate-100 shadow-sm animate-in slide-in-from-top-2 fade-in duration-200">
          {tasks.map((task: any, index: number) => (
            <TaskRow key={task.id} index={index + 1} task={task} logic={logic} isUrgent={true} />
          ))}
        </div>
      )}
    </section>
  );
};

const CategoryGroup = ({ group, logic }: { group: any; logic: any }) => {
  const doneCount = group.tasks.filter((t: any) => t.status === 'COMPLETED').length;
  const [isOpen, setIsOpen] = useState(doneCount < group.tasks.length);
  
  const roomId = group.tasks[0]?.room_id;
  const roomHasGuest = group.tasks[0]?.roomHasGuest;
  const roomHasGuestUpdatedAt = group.tasks[0]?.roomHasGuestUpdatedAt;

  return (
    <section className="mb-6">
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="bg-slate-200 text-slate-700 px-4 py-3 rounded-t-xl flex items-center justify-between cursor-pointer hover:bg-slate-300 transition-colors"
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide">{group.categoryName}</h2>
            {roomId && (
              <button 
                onClick={(e) => { e.stopPropagation(); logic.toggleRoomHasGuest(roomId, roomHasGuest); }}
                className={`px-2 py-0.5 text-[10px] font-bold rounded flex items-center gap-1 transition-colors ${
                  roomHasGuest ? 'bg-red-500 text-white shadow-sm shadow-red-500/30' : 'bg-slate-300 text-slate-500 hover:bg-slate-400'
                }`}
                title={roomHasGuest ? 'Phòng đang có khách, nhấn để hủy' : 'Đánh dấu phòng đang có khách'}
              >
                <User size={12} />
                {roomHasGuest ? (
                  <>Có khách {roomHasGuestUpdatedAt ? <span className="opacity-80">({new Date(roomHasGuestUpdatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})</span> : ''}</>
                ) : 'Báo có khách'}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">Hoàn thành {doneCount}/{group.tasks.length}</p>
        </div>
        <div className="text-slate-500 shrink-0">
          {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </div>
      
      {isOpen && (
        <div className="bg-white border-x border-b border-slate-200 rounded-b-xl overflow-hidden divide-y divide-slate-100 shadow-sm animate-in slide-in-from-top-2 fade-in duration-200">
          {group.tasks.map((task: any, index: number) => (
            <TaskRow key={task.id} index={index + 1} task={task} logic={logic} isUrgent={false} />
          ))}
        </div>
      )}
    </section>
  );
};

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
    if (e.target) e.target.value = '';
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
            
            {/* Rework Info */}
            {isRework && (task.reworkNote || task.reworkPhoto) && (
              <div className="mt-2 bg-white/60 p-2.5 rounded-lg border border-red-100 flex flex-col gap-2">
                {task.reworkNote && (
                  <p className="text-xs text-red-700 font-medium">💬 Ghi chú: {task.reworkNote}</p>
                )}
                {task.reworkPhoto && (
                  <button 
                    onClick={() => {
                       const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                       window.open(`${supabaseUrl}/storage/v1/object/public/task-photos/${task.reworkPhoto}`, '_blank');
                    }}
                    className="flex items-center gap-1.5 text-xs text-cyan-600 font-bold hover:text-cyan-700 w-fit"
                  >
                    📸 Xem ảnh lỗi quản lý gửi
                  </button>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Actions (Camera / Check) */}
        <div className="shrink-0 flex items-center gap-2">
          {!isCompleted && task.requires_photo && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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

          {/* View Photos Button */}
          {task.photoCount > 0 && (
            <button
              onClick={() => logic.fetchTaskPhotos(task.id)}
              className="flex items-center justify-center w-12 h-12 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors shadow-sm shrink-0"
              title="Xem ảnh"
            >
              <Eye size={20} />
            </button>
          )}

          {/* Submit Button */}
          {!isCompleted && hasEnoughPhotos && (
            <button
              onClick={() => logic.submitTask(task.id)}
              className="w-12 h-12 bg-cyan-600 text-white rounded-xl text-sm font-bold flex items-center justify-center hover:bg-cyan-700 active:bg-cyan-800 transition-colors shadow-sm"
              title="Gửi kết quả"
            >
              <Send size={20} className="ml-1" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
