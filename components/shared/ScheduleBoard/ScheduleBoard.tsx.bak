import React, { useState, useMemo } from 'react';
import { CalendarClock, User, Tag, Clock, ChevronRight, X, AlertCircle, Info, Phone, Calendar as CalendarIcon, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// 🔧 UI CONFIGURATION
const TIME_START = 8; // 08:00
const TIME_END = 23; // 23:00
const ROW_HEIGHT = 80; // Chiều cao mỗi 1 tiếng (px)
const MINUTE_HEIGHT = ROW_HEIGHT / 60; // Chiều cao mỗi phút (px)

interface ScheduleBoardProps {
  orders: any[]; // Đơn hàng thực tế từ server
  staffs?: any[]; // Lấy từ KanbanBoard truyền qua, nếu không có thì trích xuất từ orders
}

export const ScheduleBoard: React.FC<ScheduleBoardProps> = ({ orders, staffs = [] }) => {
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  // Sinh mảng giờ [8, 9, 10, ..., 23]
  const hours = Array.from({ length: TIME_END - TIME_START + 1 }, (_, i) => TIME_START + i);

  // Helper: Chuyển đổi chuỗi giờ "HH:mm" thành vị trí Y (px)
  const calculateTop = (timeStr: string) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    
    // Nếu giờ nhỏ hơn TIME_START, đặt ở mép trên
    if (h < TIME_START) return 0;
    
    const minutesFromStart = (h - TIME_START) * 60 + m;
    return minutesFromStart * MINUTE_HEIGHT;
  };

  // Helper: Tính chiều cao (height) dựa trên số phút duration
  const calculateHeight = (durationMins: number) => {
    return Math.max(durationMins * MINUTE_HEIGHT, 30); // Tối thiểu 30px
  };

  // Trích xuất danh sách KTV duy nhất từ orders thực tế (nếu không có props staffs)
  const extractStaffs = () => {
    const ktvMap = new Map();
    orders.forEach(o => {
      o.services?.forEach((svc: any) => {
        svc.staffList?.forEach((st: any) => {
          if (st.ktvCode && !ktvMap.has(st.ktvCode)) {
            ktvMap.set(st.ktvCode, { id: st.ktvCode, name: st.ktvName });
          }
        });
      });
    });
    return Array.from(ktvMap.values());
  };

  const columns = useMemo(() => {
    const activeStaffs = staffs.length > 0 ? staffs.map(s => ({ id: s.id || s.code, name: s.full_name || s.name })) : extractStaffs();
    return [
      { id: 'UNASSIGNED', name: 'Chưa Phân Công', isSpecial: true },
      ...activeStaffs
    ];
  }, [orders, staffs]);

  // Chuẩn hoá dữ liệu để vẽ lên Lưới
  const gridBlocks = useMemo(() => {
    const blocks: any[] = [];

    // Thêm Đơn hàng thực tế
    orders.forEach(o => {
      o.services?.forEach((svc: any) => {
        // Nếu dịch vụ này đã phân công KTV
        if (svc.staffList && svc.staffList.length > 0) {
          svc.staffList.forEach((st: any) => {
            const duration = svc.duration || 60;
            const tStart = st.segments?.[0]?.actualStartTime || svc.timeStart || o.timeStart;
            
            // Format timeStart
            let formattedStart = '00:00';
            if (tStart) {
               const d = new Date(tStart.includes('Z') || tStart.includes('T') ? tStart : `1970-01-01T${tStart}Z`);
               if (!isNaN(d.getTime())) {
                   formattedStart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
               } else if (typeof tStart === 'string' && tStart.includes(':')) {
                   formattedStart = tStart.substring(0, 5);
               }
            }

            blocks.push({
              id: `${o.id}-${svc.id}-${st.ktvCode}`,
              originalOrderId: o.id,
              customerName: o.customerName || 'Khách vãng lai',
              customerPhone: o.customerPhone,
              source: o.source,
              timeStart: formattedStart,
              duration: duration,
              status: o.dispatchStatus || o.status,
              serviceName: svc.serviceName,
              ktvId: st.ktvCode || st.ktvId,
            });
          });
        } else {
          // Chưa phân công (có thể do lỗi hoặc chưa chọn KTV)
          const duration = svc.duration || 60;
          let formattedStart = '12:00'; // Fallback
          const oTime = o.timeStart || o.timeBooking || o.createdAt;
          if (oTime) {
             const d = new Date(oTime.includes('Z') || oTime.includes('T') ? oTime : `1970-01-01T${oTime}Z`);
             if (!isNaN(d.getTime())) {
                 formattedStart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
             } else if (typeof oTime === 'string' && oTime.includes(':')) {
                 formattedStart = oTime.substring(0, 5);
             }
          }
          blocks.push({
            id: `${o.id}-${svc.id}-unassigned`,
            originalOrderId: o.id,
            customerName: o.customerName || 'Khách vãng lai',
            customerPhone: o.customerPhone,
            source: o.source,
            timeStart: formattedStart,
            duration: duration,
            status: o.dispatchStatus || o.status,
            serviceName: svc.serviceName,
            ktvId: 'UNASSIGNED',
          });
        }
      });
    });

    return blocks;
  }, [orders]);


  return (
    <div className="w-full h-full flex flex-col bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden relative">
      
      {/* HEADER TỔNG */}
      <div className="px-5 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-200">
            <CalendarIcon size={20} strokeWidth={3} />
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight">Lịch Trực Quan (Demo)</h2>
            <p className="text-xs font-bold text-gray-500 mt-0.5">Hiển thị mọi đơn hàng theo từng khung giờ & KTV</p>
          </div>
        </div>
        
        {/* Chú thích màu sắc */}
        <div className="hidden md:flex items-center gap-4 bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm">
           <div className="flex items-center gap-2 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-red-500 border border-red-600"></span>VIP Booking</div>
           <div className="flex items-center gap-2 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-amber-400 border border-amber-500"></span>Web (Mới)</div>
           <div className="flex items-center gap-2 text-xs font-bold text-gray-600"><span className="w-3 h-3 rounded-full bg-blue-400 border border-blue-500"></span>Khách đã xác nhận</div>
        </div>
      </div>

      {/* LƯỚI LỊCH */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Trục Thời gian (Cố định bên trái) */}
        <div className="w-[70px] shrink-0 border-r border-gray-200 bg-white flex flex-col z-20 shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
           <div className="h-14 border-b border-gray-200 bg-gray-50 shrink-0 flex items-center justify-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
             Giờ
           </div>
           <div className="flex-1 overflow-y-hidden relative" style={{ height: hours.length * ROW_HEIGHT }}>
              {hours.map(h => (
                 <div key={h} className="absolute w-full flex justify-center text-xs font-black text-gray-400 bg-white" style={{ top: (h - TIME_START) * ROW_HEIGHT, height: ROW_HEIGHT, borderBottom: '1px solid #f3f4f6' }}>
                    <span className="mt-1">{String(h).padStart(2, '0')}:00</span>
                 </div>
              ))}
           </div>
        </div>

        {/* Khu vực KTV & Đơn hàng (Cuộn ngang & dọc) */}
        <div className="flex-1 overflow-auto bg-slate-50/50 relative custom-scrollbar" id="calendar-grid">
           
           {/* HEADER CỘT (KTV) - Cố định trên cùng */}
           <div className="flex sticky top-0 z-30 bg-gray-50 border-b border-gray-200 w-max min-w-full shadow-sm">
              {columns.map(col => (
                 <div 
                   key={col.id} 
                   className={`w-[240px] h-14 shrink-0 flex items-center justify-center border-r border-gray-200 p-2 
                     ${col.isSpecial ? 'bg-amber-50 text-amber-900 border-b-2 border-b-amber-400' : 'text-gray-700'}`}
                 >
                   <span className="text-sm font-black truncate">{col.name}</span>
                 </div>
              ))}
           </div>

           {/* NỘI DUNG LƯỚI */}
           <div className="relative w-max min-w-full" style={{ height: hours.length * ROW_HEIGHT }}>
              
              {/* Lưới ngang (Mỗi giờ) */}
              <div className="absolute inset-0 pointer-events-none flex flex-col">
                 {hours.map(h => (
                   <div key={h} className="w-full border-b border-gray-200/60" style={{ height: ROW_HEIGHT }}></div>
                 ))}
              </div>

              {/* Lưới dọc (Mỗi KTV) */}
              <div className="absolute inset-0 pointer-events-none flex">
                 {columns.map(col => (
                   <div key={col.id} className="w-[240px] shrink-0 border-r border-gray-200/60 h-full">
                      {/* Sub-grid 30 mins */}
                      <div className="w-full h-full" style={{ background: 'repeating-linear-gradient(to bottom, transparent, transparent 39px, #f9fafb 39px, #f9fafb 40px)'}}></div>
                   </div>
                 ))}
              </div>

              {/* KHỐI ĐƠN HÀNG (BLOCKS) */}
              {columns.map((col, colIdx) => {
                 const blocksInCol = gridBlocks.filter(b => b.ktvId === col.id);
                 
                 return (
                   <div key={col.id} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: colIdx * 240, width: 240 }}>
                      {blocksInCol.map(block => {
                         // Tính toán màu sắc dựa trên Source và Status
                         let bgColor = 'bg-blue-100 border-blue-300 text-blue-900 shadow-blue-200/50';
                         let tagColor = 'bg-blue-500';
                         
                         if (block.source?.includes('VIP')) {
                            bgColor = 'bg-red-50 border-red-300 text-red-900 shadow-red-200/50';
                            tagColor = 'bg-red-500';
                         } else if (block.status === 'NEW' || block.source?.includes('WEB')) {
                            bgColor = 'bg-amber-50 border-amber-300 text-amber-900 shadow-amber-200/50';
                            tagColor = 'bg-amber-500';
                         } else if (block.status === 'COMPLETED' || block.status === 'DONE') {
                            bgColor = 'bg-gray-100 border-gray-300 text-gray-500 shadow-gray-200/50 opacity-80';
                            tagColor = 'bg-gray-400';
                         }

                         return (
                           <div 
                             key={block.id}
                             onClick={() => setSelectedOrder(block)}
                             className={`absolute left-2 right-2 rounded-xl border pointer-events-auto cursor-pointer p-2 overflow-hidden shadow-sm hover:shadow-md transition-all hover:scale-[1.02] hover:z-10 flex flex-col ${bgColor}`}
                             style={{ 
                               top: calculateTop(block.timeStart), 
                               height: calculateHeight(block.duration) 
                             }}
                           >
                              {/* Thanh chỉ thị bên trái */}
                              <div className={`absolute left-0 top-0 bottom-0 w-1 ${tagColor}`}></div>
                              
                              <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest opacity-70 mb-0.5">
                                <Clock size={10} /> {block.timeStart} ({block.duration}p)
                              </div>
                              <div className="font-black text-sm leading-tight truncate">
                                {block.customerName}
                              </div>
                              <div className="text-xs font-bold opacity-80 truncate mt-0.5">
                                {block.serviceName}
                              </div>

                              {block.source?.includes('VIP') && (
                                <div className="absolute top-2 right-2 text-red-500 bg-red-100 p-0.5 rounded-full">
                                  <Sparkles size={12} />
                                </div>
                              )}
                           </div>
                         );
                      })}
                   </div>
                 );
              })}
           </div>
        </div>
      </div>

      {/* POPUP CHI TIẾT ĐƠN HÀNG (Khi bấm vào thẻ) */}
      <AnimatePresence>
        {selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setSelectedOrder(null)}>
             <motion.div
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               onClick={(e) => e.stopPropagation()}
               className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-sm w-full overflow-hidden"
             >
               <div className={`p-5 text-white ${selectedOrder.source?.includes('VIP') ? 'bg-red-600' : selectedOrder.status === 'NEW' ? 'bg-amber-500' : 'bg-indigo-600'}`}>
                 <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xl font-black">{selectedOrder.customerName}</h3>
                    <button onClick={() => setSelectedOrder(null)} className="p-1 hover:bg-white/20 rounded-full transition-colors"><X size={20}/></button>
                 </div>
                 <div className="flex items-center gap-2 text-sm font-bold opacity-90">
                   <Phone size={14} /> {selectedOrder.customerPhone || 'Không có SĐT'}
                 </div>
               </div>

               <div className="p-5 space-y-4">
                  <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                     <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Dịch vụ</div>
                     <div className="text-gray-900 font-bold text-sm">{selectedOrder.serviceName}</div>
                     <div className="mt-2 text-indigo-600 font-black flex items-center gap-1 text-sm">
                       <Clock size={14} /> {selectedOrder.timeStart} ({selectedOrder.duration} phút)
                     </div>
                  </div>

                  {selectedOrder.ktvId === 'UNASSIGNED' && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                      <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800 font-bold">
                        Đơn hàng chưa có Kỹ Thuật Viên. Lễ tân vui lòng chọn KTV để tiếp nhận khách.
                      </p>
                    </div>
                  )}

                  {/* CÁC NÚT THAO TÁC TO RÕ CHO NGƯỜI LỚN TUỔI */}
                  <div className="pt-2 flex flex-col gap-2">
                    {selectedOrder.ktvId === 'UNASSIGNED' ? (
                      <button className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black transition-colors shadow-lg shadow-indigo-200 text-sm">
                         CHỌN KTV LÀM ĐƠN NÀY
                      </button>
                    ) : (
                      <>
                        <button className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-black transition-colors text-sm">
                           ĐỔI KỸ THUẬT VIÊN KHÁC
                        </button>
                        <button className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-black transition-colors text-sm">
                           THAY ĐỔI GIỜ
                        </button>
                      </>
                    )}
                  </div>
               </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
};
