'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useSupportReviews } from './SupportReviews.logic';

export default function SupportReviewsPage() {
  const logic = useSupportReviews();

  return (
    <AppLayout title="Nghiệm Thu">
    <div className="p-6 max-w-7xl mx-auto min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Nghiệm Thu Công Việc</h1>
        <p className="text-slate-500 mt-1">Duyệt các công việc Hậu Cần đã được nhân viên báo cáo Hoàn Thành</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {logic.tasks.length === 0 ? (
          <div className="col-span-full py-10 text-center text-slate-400 bg-white rounded-xl border border-slate-100 shadow-sm">
            Hiện tại không có công việc nào cần nghiệm thu.
          </div>
        ) : (
          logic.tasks.map(task => (
            <div key={task.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded">
                  {task.roomName}
                </span>
                <span className="text-slate-500 text-xs">{new Date(task.completed_at).toLocaleTimeString()}</span>
              </div>
              
              <h3 className="font-bold text-slate-800 text-lg mb-1">{task.name}</h3>
              <p className="text-sm text-slate-600 mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {task.assigneeName}
              </p>

              <button 
                onClick={() => logic.openReviewModal(task)}
                className="w-full py-2 bg-cyan-50 text-cyan-700 font-medium rounded-lg hover:bg-cyan-100 transition-colors border border-cyan-100"
              >
                Tiến Hành Nghiệm Thu
              </button>
            </div>
          ))
        )}
      </div>

      {/* Review Modal */}
      {logic.selectedTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col slide-in-from-bottom-4 animate-in duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 sticky top-0">
              <div>
                 <h2 className="font-bold text-xl text-slate-800">{logic.selectedTask.name}</h2>
                 <p className="text-sm text-slate-500 mt-1">Nhân viên: <span className="font-semibold text-slate-700">{logic.selectedTask.assigneeName}</span></p>
              </div>
              <button onClick={logic.closeReviewModal} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-full shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                 </svg>
                 Ảnh Minh Chứng ({logic.selectedTask.photos.length})
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                {logic.selectedTask.photos.map((photo: any) => (
                  <div key={photo.id} className="aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                    <img src={photo.url} alt="Minh chứng" className="w-full h-full object-cover hover:scale-105 transition-transform" />
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-6">
                <label className="block text-sm font-bold text-slate-800 mb-2">Ghi chú Nghiệm thu (Tùy chọn)</label>
                <textarea 
                  id="reviewNote"
                  className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none resize-none"
                  rows={3}
                  placeholder="Nhập ghi chú hoặc lý do yêu cầu làm lại (nếu có)..."
                ></textarea>
              </div>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 sticky bottom-0">
               <button 
                  disabled={logic.submitting}
                  onClick={() => {
                     const note = (document.getElementById('reviewNote') as HTMLTextAreaElement).value;
                     logic.reviewTask(logic.selectedTask!.id, 'REWORK_REQUIRED');

                  }}
                  className="px-6 py-2.5 bg-red-100 text-red-700 font-bold rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
               >
                 Yêu cầu Làm lại
               </button>
               <button 
                  disabled={logic.submitting}
                  onClick={() => {
                     const note = (document.getElementById('reviewNote') as HTMLTextAreaElement).value;
                     logic.reviewTask(logic.selectedTask!.id, 'PASSED');
                  }}
                  className="px-8 py-2.5 bg-green-500 text-white font-bold rounded-lg hover:bg-green-600 transition-colors shadow-sm disabled:opacity-50"
               >
                 Duyệt (PASSED)
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AppLayout>
  );
}
