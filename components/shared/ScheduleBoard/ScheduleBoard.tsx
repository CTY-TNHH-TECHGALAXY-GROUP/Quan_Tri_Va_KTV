import React from 'react';
import { CalendarClock, MapPin, User, Tag, LayoutList } from 'lucide-react';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.3;

interface OrderTimeline {
  id: string;
  timeStart: string;
  timeEnd: string;
  customerName: string;
  services: { name: string; staff: string; room: string }[];
  status: string;
  source: string;
}

interface ScheduleBoardProps {
  orders: any[]; // Receive orders from Dispatch
}

export const ScheduleBoard: React.FC<ScheduleBoardProps> = ({ orders }) => {
  // Map and sort orders by time
  const timeline: OrderTimeline[] = orders.map(o => {
    // Determine overall start/end time
    let minStart = '23:59';
    let maxEnd = '00:00';
    
    const services = o.services.map((svc: any) => {
      if (svc.timeStart && svc.timeStart < minStart) minStart = svc.timeStart;
      if (svc.timeEnd && svc.timeEnd > maxEnd) maxEnd = svc.timeEnd;
      return {
        name: svc.serviceName,
        staff: svc.staffList?.[0]?.ktvName || 'Chưa phân công',
        room: svc.selectedRoomId || 'Chưa phân phòng'
      };
    });

    if (minStart === '23:59') minStart = o.time || '00:00';
    if (maxEnd === '00:00') maxEnd = minStart;

    return {
      id: o.id,
      timeStart: minStart,
      timeEnd: maxEnd,
      customerName: o.customerName,
      status: o.dispatchStatus || 'NEW',
      source: o.source || 'Trực tiếp',
      services
    };
  }).sort((a, b) => a.timeStart.localeCompare(b.timeStart));

  return (
    <div className="w-full h-full overflow-y-auto bg-gray-50/50 p-2 sm:p-4 rounded-3xl">
      <div className="flex items-center gap-3 mb-6 px-2">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-200">
          <CalendarClock size={20} strokeWidth={3} />
        </div>
        <div>
          <h2 className="text-xl font-black text-gray-900 tracking-tight">Lịch Biểu Diễn</h2>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-0.5">Dòng thời gian các đơn hàng trong ngày</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto space-y-4 pb-20">
        {timeline.map((item, index) => (
          <div key={item.id} className="relative flex gap-4 sm:gap-6">
            {/* Timeline line */}
            <div className="absolute left-[39px] sm:left-[55px] top-10 bottom-[-24px] w-px bg-indigo-100 z-0"></div>
            
            {/* Time */}
            <div className="w-20 sm:w-28 shrink-0 text-right pt-3 relative z-10">
              <span className="text-lg sm:text-xl font-black text-indigo-600 tracking-tighter">{item.timeStart.substring(0, 5)}</span>
              <span className="block text-xs font-bold text-gray-400">Đến {item.timeEnd.substring(0, 5)}</span>
            </div>

            {/* Content Card */}
            <div className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-sm p-4 relative z-10 transition-transform hover:-translate-y-1 hover:shadow-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base sm:text-lg font-black text-gray-900">{item.customerName}</span>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-widest border border-indigo-100">
                    {item.source}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs font-bold text-gray-500">
                  <Tag size={12} />
                  {item.status}
                </div>
              </div>

              <div className="space-y-2">
                {item.services.map((svc, sIdx) => (
                  <div key={sIdx} className="bg-gray-50 rounded-2xl p-3 border border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1">
                      <span className="text-sm font-bold text-gray-800">{svc.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-bold text-gray-500 shrink-0">
                      <span className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-gray-100 shadow-sm">
                        <User size={12} className="text-indigo-400" /> {svc.staff}
                      </span>
                      <span className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-gray-100 shadow-sm">
                        <MapPin size={12} className="text-emerald-400" /> {svc.room}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

        {timeline.length === 0 && (
          <div className="py-20 text-center flex flex-col items-center">
            <LayoutList size={40} className="text-gray-200 mb-4" />
            <h3 className="text-lg font-black text-gray-400 uppercase tracking-widest">Trống</h3>
            <p className="text-sm text-gray-500 mt-2 font-medium">Hôm nay chưa có đơn hàng nào.</p>
          </div>
        )}
      </div>
    </div>
  );
};
