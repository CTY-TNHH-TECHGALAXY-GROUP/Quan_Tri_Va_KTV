'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useSupportDashboard } from './SupportDashboard.logic';

// 🔧 UI CONFIGURATION
const CARD_BG = 'bg-white';
const BORDER_COLOR = 'border-slate-100';
const SHADOW = 'shadow-sm hover:shadow-md transition-shadow';

export default function SupportDashboardPage() {
  const logic = useSupportDashboard();

  const totalRooms = Object.keys(logic.stats).length;

  return (
    <AppLayout title="Thống Kê Phòng">
    <div className="p-6 space-y-6 max-w-7xl mx-auto min-h-screen">
      {/* Header - Collapsible Toggle */}
      <div 
        className={`flex items-start justify-between p-4 bg-white rounded-xl border ${BORDER_COLOR} cursor-pointer hover:bg-slate-50 transition-colors`}
        onClick={logic.toggleExpand}
      >
        <div className="flex gap-4">
          <div className="p-3 bg-cyan-50 text-cyan-600 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              Thống Kê Hoạt Động Từng Phòng
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                className={`h-5 w-5 text-slate-400 transform transition-transform duration-300 ${logic.isExpanded ? 'rotate-180' : ''}`} 
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Dữ liệu chi tiết số lượt phục vụ để Hậu cần kịp thời bổ sung khăn, tinh dầu, vật tư.
            </p>
          </div>
        </div>

        <div className="bg-cyan-50 px-4 py-2 rounded-lg border border-cyan-100 text-center">
          <p className="text-xs text-cyan-600 font-semibold uppercase tracking-wider">Số phòng hoạt động</p>
          <p className="text-2xl font-bold text-cyan-700 leading-none mt-1">{totalRooms}</p>
        </div>
      </div>

      {/* Expanded Content */}
      {logic.isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
          {logic.isLoading ? (
            <div className="col-span-full py-10 text-center text-slate-400">Đang tải dữ liệu...</div>
          ) : logic.error ? (
            <div className="col-span-full py-10 text-center text-red-500">{logic.error}</div>
          ) : totalRooms === 0 ? (
            <div className="col-span-full py-10 text-center text-slate-400">Chưa có lượt dịch vụ nào hôm nay.</div>
          ) : (
            Object.entries(logic.stats).map(([roomName, stat]) => (
              <div 
                key={roomName}
                onClick={() => logic.openHotTaskModal(roomName)}
                className={`${CARD_BG} border ${BORDER_COLOR} ${SHADOW} rounded-xl p-4 flex flex-col h-[400px] cursor-pointer hover:border-red-200 group`}
                title="Bấm để giao việc nóng cho phòng này"
              >
                {/* Card Header */}
                <div className="flex justify-between items-start mb-4 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center font-bold">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg leading-tight">{roomName}</h3>
                      <p className="text-xs text-slate-400">Thống kê dịch vụ</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-red-500 leading-none">{stat.total}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Lượt DV</p>
                  </div>
                </div>

                {/* Service List */}
                <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                  {Object.entries(stat.services).sort((a, b) => b[1] - a[1]).map(([svc, count]) => (
                    <div key={svc} className="flex justify-between items-start text-sm">
                      <div className="flex gap-2 items-start text-slate-600 pr-2">
                        <svg className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="leading-snug group-hover:text-slate-900 transition-colors">{svc}</span>
                      </div>
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium min-w-[24px] text-center">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
                
                {/* Hover Overlay Hint */}
                <div className="mt-4 pt-3 border-t border-slate-50 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-xs font-semibold text-red-500 bg-red-50 px-3 py-1 rounded-full">
                    + Giao việc nóng
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Hot Task Modal */}
      {logic.selectedRoom && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="font-bold text-lg text-slate-800">
                Giao Việc Nóng: <span className="text-red-500">{logic.selectedRoom}</span>
              </h2>
              <button onClick={logic.closeHotTaskModal} className="text-slate-400 hover:text-slate-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                logic.submitHotTask(
                  formData.get('taskName') as string,
                  formData.get('categoryId') as string,
                  formData.get('assigneeId') as string
                );
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nội dung công việc *</label>
                <input 
                  required
                  name="taskName"
                  type="text" 
                  placeholder="VD: Bổ sung khăn tắm lớn, Thay tinh dầu..."
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none"
                />
              </div>

              {/* Tạm thời dùng input text cho ID, thực tế sẽ là Select Box lấy data từ DB */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hạng mục</label>
                  <select name="categoryId" className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-white">
                    <option value="">-- Chọn --</option>
                    <option value="fake-cat-1">Vệ sinh</option>
                    <option value="fake-cat-2">Vật tư</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Người nhận</label>
                  <select name="assigneeId" className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-white">
                    <option value="">(Tự động chia đều)</option>
                    <option value="fake-staff-1">NV Hậu Cần A</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button" 
                  onClick={logic.closeHotTaskModal}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  type="submit" 
                  disabled={logic.isCreatingTask}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {logic.isCreatingTask ? 'Đang giao...' : 'Giao Ngay'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* CSS để làm đẹp thanh cuộn bên trong card */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f5f9; 
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1; 
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8; 
        }
      `}} />
    </div>
    </AppLayout>
  );
}
