/**
 * ScheduleBoard.tsx - Lich Hen & Timeline KTV
 *
 * TINH NANG LICH HEN (PreBookings) - Them ngay 28/08/2026
 * --------------------------------------------------------
 * Tinh nang "Khach lien he truoc" (Pre-bookings) da duoc chuyen tu
 * Web Noi Bo (wrb-noi-bo-dev) sang tich hop truc tiep vao day.
 *
 * Chuc nang:
 *  1. Hien thi danh sach khach hen (PENDING) o sidebar ben phai.
 *  2. Them khach hen moi (Modal form: ten, SDT + ma quoc gia, email, so khach, ngay/gio, ghi chu).
 *  3. Nhan dien "Khach cu" - tu dong tra cuu bang Customers theo SDT.
 *  4. Click vao the khach hen -> mo tab Web Noi Bo tai /en/new-user/standard/menu
 *     kem query params de auto-fill thong tin o buoc Checkout.
 *
 * Database: Bang PreBookings (xem TableInSupabase.md muc 12).
 * Env var: NEXT_PUBLIC_WEB_NOI_BO_URL (URL Web Noi Bo de redirect).
 *
 * Phia Web Noi Bo: src/app/[lang]/new-user/[menuType]/menu/page.tsx
 *   co useEffect bat query params -> luu localStorage("contactedFirstInfo").
 */
import React, { useState, useMemo } from 'react';
import { CalendarClock, User, Tag, Clock, ChevronRight, X, AlertCircle, Info, Phone, Calendar as CalendarIcon, Sparkles, Plus, ExternalLink, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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

  // --- THÊM: STATE CHO LỊCH HẸN ---
    /**
   * [TÍNH NĂNG ĐẶT LỊCH HẸN TRƯỚC (PRE-BOOKING)]
   * - Quản lý việc tạo nhanh lịch hẹn cho khách gọi điện/đặt qua fanpage.
   * - Tự động nhận diện Khách Cũ (kiểm tra SĐT trong bảng Customers).
   * - Khi Lễ Tân bấm vào Thẻ Lịch Hẹn -> Hệ thống tạo link trỏ sang Web Nội Bộ (qua biến NEXT_PUBLIC_WEB_NOI_BO_URL).
   * - Dữ liệu (Tên, SĐT, Email, Khách) được truyền qua URL, Web Nội Bộ sẽ autofill khi Thanh Toán.
   */
const [preBookings, setPreBookings] = React.useState<any[]>([]);
  const [oldCustomerPhones, setOldCustomerPhones] = React.useState<Set<string>>(new Set());
  
  // State cho Add Modal
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [newPbName, setNewPbName] = React.useState('');
  const [newPbPhone, setNewPbPhone] = React.useState('');
  const [newPbPhoneCode, setNewPbPhoneCode] = React.useState('+84');
  const [newPbEmail, setNewPbEmail] = React.useState('');
  const [newPbMenuType, setNewPbMenuType] = React.useState('standard');
  const [newPbGuests, setNewPbGuests] = React.useState<number | ''>(1);
  const [newPbDate, setNewPbDate] = React.useState(() => {
     const today = new Date();
     return new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
  });
  const [newPbTime, setNewPbTime] = React.useState('12:00');
  const [newPbNotes, setNewPbNotes] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isFormOldCustomer, setIsFormOldCustomer] = React.useState(false);

  // --- FETCH LỊCH HẸN TỪ SUPABASE ---
  React.useEffect(() => {
    fetchPreBookings();
    
    // Subscribe realtime
    const sub = supabase.channel('prebookings_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'PreBookings' }, () => {
         fetchPreBookings();
      }).subscribe();
      
    return () => { supabase.removeChannel(sub); };
  }, []);

  const fetchPreBookings = async () => {
    const today = new Date();
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    
    const { data: pbs, error } = await supabase
       .from('PreBookings')
       .select('*')
       .eq('booking_date', localDate)
       .eq('status', 'PENDING')
       .order('booking_time', { ascending: true });
       
    if (pbs) {
      setPreBookings(pbs);
      // Kiểm tra khách cũ
      const phones = pbs.map(p => p.customer_phone).filter(Boolean);
      if (phones.length > 0) {
        const { data: custs } = await supabase.from('Customers').select('phone').in('phone', phones);
        if (custs) {
          setOldCustomerPhones(new Set(custs.map(c => c.phone)));
        }
      }
    }
  };

  // --- KIỂM TRA KHÁCH CŨ KHI NHẬP FORM ---
  React.useEffect(() => {
    if (newPbPhone && newPbPhone.length >= 9) {
      const timer = setTimeout(async () => {
         const { data } = await supabase.from('Customers').select('id').eq('phone', newPbPhone).maybeSingle();
         setIsFormOldCustomer(!!data);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setIsFormOldCustomer(false);
    }
  }, [newPbPhone]);

  const handleAddPreBooking = async () => {
     if (!newPbName || !newPbPhone || !newPbDate || !newPbTime) return;
     setIsSubmitting(true);
     
     const formattedTime = newPbTime.length === 5 ? `${newPbTime}:00` : newPbTime;
     
     const { error } = await supabase.from('PreBookings').insert([{
        customer_name: newPbName,
        customer_phone: (newPbPhoneCode || "").replace(/\s+/g, "") + (newPbPhone || "").replace(/\s+/g, ""),
        customer_email: newPbEmail,
        menu_type: newPbMenuType,
        guest_count: Number(newPbGuests) || 1,
        booking_date: newPbDate,
        booking_time: formattedTime,
        notes: newPbNotes,
        status: 'PENDING'
     }]);
     
     setIsSubmitting(false);
     if (!error) {
       setIsAddModalOpen(false);
       setNewPbName(''); setNewPbPhone(''); setNewPbEmail(''); setNewPbMenuType('standard'); setNewPbGuests(1); setNewPbNotes('');
       fetchPreBookings();
     } else {
       console.error("Lỗi khi thêm khách hẹn:", error);
     }
  };

  const handlePreBookingClick = (pb: any) => {
     const baseUrl = process.env.NEXT_PUBLIC_WEB_NOI_BO_URL || 'http://localhost:3001';
     const url = new URL(`${baseUrl}/en/new-user/${pb.menu_type || 'standard'}/menu`);
     url.searchParams.set('preBookingId', pb.id);
     if (pb.customer_name) url.searchParams.set('name', pb.customer_name);
     if (pb.customer_phone) url.searchParams.set('phone', pb.customer_phone);
     if (pb.customer_email) url.searchParams.set('email', pb.customer_email);
     if (pb.menu_type) url.searchParams.set('menuType', pb.menu_type);
     if (pb.guest_count) url.searchParams.set('guests', pb.guest_count.toString());
     if (pb.notes) url.searchParams.set('notes', pb.notes);
     window.open(url.toString(), '_blank');
  };

  const formatTime = (time: string) => {
    if (!time) return "";
    const [h, m] = time.split(':');
    let hour = parseInt(h);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    hour = hour ? hour : 12; 
    return `${hour}:${m} ${ampm}`;
  };


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
    <div className="w-full h-full flex flex-col md:flex-row bg-gray-50 rounded-3xl shadow-sm border border-gray-200 overflow-hidden relative">
      <div className="flex-1 flex flex-col bg-white overflow-hidden relative z-10 border-r border-gray-200">
      
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

      </div>

      {/* RIGHT SIDEBAR - PREBOOKINGS */}
      <div className="w-[340px] shrink-0 bg-white flex flex-col relative z-20">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
             <div className="flex items-center gap-2">
                <CalendarClock size={20} className="text-emerald-600" />
                <h3 className="font-black text-gray-800 text-lg">Khách Đã Hẹn</h3>
             </div>
             <div className="bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full text-xs">
                {preBookings.length}
             </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-slate-50/50">
             {preBookings.length === 0 ? (
                <div className="text-center text-sm font-medium text-gray-400 py-10">
                   Chưa có khách hẹn trước
                </div>
             ) : (
                preBookings.map(pb => (
                   <div 
                     key={pb.id} 
                     onClick={() => handlePreBookingClick(pb)}
                     className="bg-white p-3 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer group hover:border-emerald-300"
                   >
                      <div className="flex justify-between items-start mb-2">
                         <div className="font-black text-gray-800 text-base flex flex-col gap-1">
                            {pb.customer_name}
                            {oldCustomerPhones.has(pb.customer_phone) && (
                               <span className="text-[9px] w-max bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase tracking-wider">
                                 <Sparkles size={10} /> Khách cũ
                               </span>
                            )}
                         </div>
                         <div className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
                           {formatTime(pb.booking_time)}
                         </div>
                      </div>
                      <div className="flex flex-col gap-1.5 text-xs text-gray-600 font-medium">
                         <div className="flex items-center gap-1.5"><Phone size={13} className="text-gray-400" /> {pb.customer_phone}</div>
                         <div className="flex items-center gap-1.5"><Users size={13} className="text-gray-400" /> {pb.guest_count} khách</div>
                         {pb.notes && <div className="flex items-center gap-1.5 text-gray-500"><Info size={13} className="text-gray-400" /> {pb.notes}</div>}
                      </div>
                      <div className="mt-3 flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                         <ExternalLink size={12} /> Bấm để tạo đơn
                      </div>
                   </div>
                ))
             )}
          </div>
          
          <div className="p-4 border-t border-gray-200 bg-white">
             <button 
                onClick={() => setIsAddModalOpen(true)}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-colors shadow-sm shadow-emerald-200"
             >
                <Plus size={16} strokeWidth={3} /> THÊM KHÁCH HẸN
             </button>
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


      {/* NEW Modal Add PreBooking */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setIsAddModalOpen(false)}>
             <motion.div
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               onClick={(e) => e.stopPropagation()}
               className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-sm w-full overflow-hidden flex flex-col"
             >
               <div className="p-5 bg-emerald-600 text-white flex justify-between items-center">
                  <h3 className="text-xl font-black">Thêm Khách Hẹn</h3>
                  <button onClick={() => setIsAddModalOpen(false)} className="p-1 hover:bg-white/20 rounded-full transition-colors"><X size={20}/></button>
               </div>
               
               <div className="p-5 space-y-4">
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Họ tên</label>
                     <input type="text" value={newPbName} onChange={e => setNewPbName(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="Tên khách hàng" />
                  </div>
                  <div>
                     <div className="flex justify-between items-end mb-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase">Số điện thoại</label>
                        {isFormOldCustomer && (
                           <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider font-black">
                             <Sparkles size={10} /> Khách cũ
                           </span>
                        )}
                     </div>
                     <div className="flex gap-2">
                        <input 
                           type="text" 
                           list="phone-codes" 
                           value={newPbPhoneCode} 
                           onChange={e => setNewPbPhoneCode(e.target.value)} 
                           className="p-3 w-28 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-bold text-gray-700" 
                           placeholder="+84"
                        />
                        <datalist id="phone-codes">
                           <option value="+93">🇦🇫 +93 (AF)</option>
                           <option value="+358">🇦🇽 +358 (AX)</option>
                           <option value="+355">🇦🇱 +355 (AL)</option>
                           <option value="+213">🇩🇿 +213 (DZ)</option>
                           <option value="+1684">🇦🇸 +1684 (AS)</option>
                           <option value="+376">🇦🇩 +376 (AD)</option>
                           <option value="+244">🇦🇴 +244 (AO)</option>
                           <option value="+1264">🇦🇮 +1264 (AI)</option>
                           <option value="+672">🇦🇶 +672 (AQ)</option>
                           <option value="+1268">🇦🇬 +1268 (AG)</option>
                           <option value="+54">🇦🇷 +54 (AR)</option>
                           <option value="+374">🇦🇲 +374 (AM)</option>
                           <option value="+297">🇦🇼 +297 (AW)</option>
                           <option value="+61">🇦🇺 +61 (AU)</option>
                           <option value="+43">🇦🇹 +43 (AT)</option>
                           <option value="+994">🇦🇿 +994 (AZ)</option>
                           <option value="+1242">🇧🇸 +1242 (BS)</option>
                           <option value="+973">🇧🇭 +973 (BH)</option>
                           <option value="+880">🇧🇩 +880 (BD)</option>
                           <option value="+1246">🇧🇧 +1246 (BB)</option>
                           <option value="+375">🇧🇾 +375 (BY)</option>
                           <option value="+32">🇧🇪 +32 (BE)</option>
                           <option value="+501">🇧🇿 +501 (BZ)</option>
                           <option value="+229">🇧🇯 +229 (BJ)</option>
                           <option value="+1441">🇧🇲 +1441 (BM)</option>
                           <option value="+975">🇧🇹 +975 (BT)</option>
                           <option value="+591">🇧🇴 +591 (BO)</option>
                           <option value="+387">🇧🇦 +387 (BA)</option>
                           <option value="+267">🇧🇼 +267 (BW)</option>
                           <option value="+55">🇧🇷 +55 (BR)</option>
                           <option value="+246">🇮🇴 +246 (IO)</option>
                           <option value="+673">🇧🇳 +673 (BN)</option>
                           <option value="+359">🇧🇬 +359 (BG)</option>
                           <option value="+226">🇧🇫 +226 (BF)</option>
                           <option value="+257">🇧🇮 +257 (BI)</option>
                           <option value="+855">🇰🇭 +855 (KH)</option>
                           <option value="+237">🇨🇲 +237 (CM)</option>
                           <option value="+1">🇨🇦 +1 (CA)</option>
                           <option value="+238">🇨🇻 +238 (CV)</option>
                           <option value="+ 345">🇰🇾 + 345 (KY)</option>
                           <option value="+236">🇨🇫 +236 (CF)</option>
                           <option value="+235">🇹🇩 +235 (TD)</option>
                           <option value="+56">🇨🇱 +56 (CL)</option>
                           <option value="+86">🇨🇳 +86 (CN)</option>
                           <option value="+61">🇨🇽 +61 (CX)</option>
                           <option value="+61">🇨🇨 +61 (CC)</option>
                           <option value="+57">🇨🇴 +57 (CO)</option>
                           <option value="+269">🇰🇲 +269 (KM)</option>
                           <option value="+242">🇨🇬 +242 (CG)</option>
                           <option value="+243">🇨🇩 +243 (CD)</option>
                           <option value="+682">🇨🇰 +682 (CK)</option>
                           <option value="+506">🇨🇷 +506 (CR)</option>
                           <option value="+225">🇨🇮 +225 (CI)</option>
                           <option value="+385">🇭🇷 +385 (HR)</option>
                           <option value="+53">🇨🇺 +53 (CU)</option>
                           <option value="+357">🇨🇾 +357 (CY)</option>
                           <option value="+420">🇨🇿 +420 (CZ)</option>
                           <option value="+45">🇩🇰 +45 (DK)</option>
                           <option value="+253">🇩🇯 +253 (DJ)</option>
                           <option value="+1767">🇩🇲 +1767 (DM)</option>
                           <option value="+1849">🇩🇴 +1849 (DO)</option>
                           <option value="+593">🇪🇨 +593 (EC)</option>
                           <option value="+20">🇪🇬 +20 (EG)</option>
                           <option value="+503">🇸🇻 +503 (SV)</option>
                           <option value="+240">🇬🇶 +240 (GQ)</option>
                           <option value="+291">🇪🇷 +291 (ER)</option>
                           <option value="+372">🇪🇪 +372 (EE)</option>
                           <option value="+251">🇪🇹 +251 (ET)</option>
                           <option value="+500">🇫🇰 +500 (FK)</option>
                           <option value="+298">🇫🇴 +298 (FO)</option>
                           <option value="+679">🇫🇯 +679 (FJ)</option>
                           <option value="+358">🇫🇮 +358 (FI)</option>
                           <option value="+33">🇫🇷 +33 (FR)</option>
                           <option value="+594">🇬🇫 +594 (GF)</option>
                           <option value="+689">🇵🇫 +689 (PF)</option>
                           <option value="+241">🇬🇦 +241 (GA)</option>
                           <option value="+220">🇬🇲 +220 (GM)</option>
                           <option value="+995">🇬🇪 +995 (GE)</option>
                           <option value="+49">🇩🇪 +49 (DE)</option>
                           <option value="+233">🇬🇭 +233 (GH)</option>
                           <option value="+350">🇬🇮 +350 (GI)</option>
                           <option value="+30">🇬🇷 +30 (GR)</option>
                           <option value="+299">🇬🇱 +299 (GL)</option>
                           <option value="+1473">🇬🇩 +1473 (GD)</option>
                           <option value="+590">🇬🇵 +590 (GP)</option>
                           <option value="+1671">🇬🇺 +1671 (GU)</option>
                           <option value="+502">🇬🇹 +502 (GT)</option>
                           <option value="+44">🇬🇬 +44 (GG)</option>
                           <option value="+224">🇬🇳 +224 (GN)</option>
                           <option value="+245">🇬🇼 +245 (GW)</option>
                           <option value="+595">🇬🇾 +595 (GY)</option>
                           <option value="+509">🇭🇹 +509 (HT)</option>
                           <option value="+379">🇻🇦 +379 (VA)</option>
                           <option value="+504">🇭🇳 +504 (HN)</option>
                           <option value="+852">🇭🇰 +852 (HK)</option>
                           <option value="+36">🇭🇺 +36 (HU)</option>
                           <option value="+354">🇮🇸 +354 (IS)</option>
                           <option value="+91">🇮🇳 +91 (IN)</option>
                           <option value="+62">🇮🇩 +62 (ID)</option>
                           <option value="+98">🇮🇷 +98 (IR)</option>
                           <option value="+964">🇮🇶 +964 (IQ)</option>
                           <option value="+353">🇮🇪 +353 (IE)</option>
                           <option value="+44">🇮🇲 +44 (IM)</option>
                           <option value="+972">🇮🇱 +972 (IL)</option>
                           <option value="+39">🇮🇹 +39 (IT)</option>
                           <option value="+1876">🇯🇲 +1876 (JM)</option>
                           <option value="+81">🇯🇵 +81 (JP)</option>
                           <option value="+44">🇯🇪 +44 (JE)</option>
                           <option value="+962">🇯🇴 +962 (JO)</option>
                           <option value="+77">🇰🇿 +77 (KZ)</option>
                           <option value="+254">🇰🇪 +254 (KE)</option>
                           <option value="+686">🇰🇮 +686 (KI)</option>
                           <option value="+850">🇰🇵 +850 (KP)</option>
                           <option value="+82">🇰🇷 +82 (KR)</option>
                           <option value="+965">🇰🇼 +965 (KW)</option>
                           <option value="+996">🇰🇬 +996 (KG)</option>
                           <option value="+856">🇱🇦 +856 (LA)</option>
                           <option value="+371">🇱🇻 +371 (LV)</option>
                           <option value="+961">🇱🇧 +961 (LB)</option>
                           <option value="+266">🇱🇸 +266 (LS)</option>
                           <option value="+231">🇱🇷 +231 (LR)</option>
                           <option value="+218">🇱🇾 +218 (LY)</option>
                           <option value="+423">🇱🇮 +423 (LI)</option>
                           <option value="+370">🇱🇹 +370 (LT)</option>
                           <option value="+352">🇱🇺 +352 (LU)</option>
                           <option value="+853">🇲🇴 +853 (MO)</option>
                           <option value="+389">🇲🇰 +389 (MK)</option>
                           <option value="+261">🇲🇬 +261 (MG)</option>
                           <option value="+265">🇲🇼 +265 (MW)</option>
                           <option value="+60">🇲🇾 +60 (MY)</option>
                           <option value="+960">🇲🇻 +960 (MV)</option>
                           <option value="+223">🇲🇱 +223 (ML)</option>
                           <option value="+356">🇲🇹 +356 (MT)</option>
                           <option value="+692">🇲🇭 +692 (MH)</option>
                           <option value="+596">🇲🇶 +596 (MQ)</option>
                           <option value="+222">🇲🇷 +222 (MR)</option>
                           <option value="+230">🇲🇺 +230 (MU)</option>
                           <option value="+262">🇾🇹 +262 (YT)</option>
                           <option value="+52">🇲🇽 +52 (MX)</option>
                           <option value="+691">🇫🇲 +691 (FM)</option>
                           <option value="+373">🇲🇩 +373 (MD)</option>
                           <option value="+377">🇲🇨 +377 (MC)</option>
                           <option value="+976">🇲🇳 +976 (MN)</option>
                           <option value="+382">🇲🇪 +382 (ME)</option>
                           <option value="+1664">🇲🇸 +1664 (MS)</option>
                           <option value="+212">🇲🇦 +212 (MA)</option>
                           <option value="+258">🇲🇿 +258 (MZ)</option>
                           <option value="+95">🇲🇲 +95 (MM)</option>
                           <option value="+264">🇳🇦 +264 (NA)</option>
                           <option value="+674">🇳🇷 +674 (NR)</option>
                           <option value="+977">🇳🇵 +977 (NP)</option>
                           <option value="+31">🇳🇱 +31 (NL)</option>
                           <option value="+599">🇦🇳 +599 (AN)</option>
                           <option value="+687">🇳🇨 +687 (NC)</option>
                           <option value="+64">🇳🇿 +64 (NZ)</option>
                           <option value="+505">🇳🇮 +505 (NI)</option>
                           <option value="+227">🇳🇪 +227 (NE)</option>
                           <option value="+234">🇳🇬 +234 (NG)</option>
                           <option value="+683">🇳🇺 +683 (NU)</option>
                           <option value="+672">🇳🇫 +672 (NF)</option>
                           <option value="+1670">🇲🇵 +1670 (MP)</option>
                           <option value="+47">🇳🇴 +47 (NO)</option>
                           <option value="+968">🇴🇲 +968 (OM)</option>
                           <option value="+92">🇵🇰 +92 (PK)</option>
                           <option value="+680">🇵🇼 +680 (PW)</option>
                           <option value="+970">🇵🇸 +970 (PS)</option>
                           <option value="+507">🇵🇦 +507 (PA)</option>
                           <option value="+675">🇵🇬 +675 (PG)</option>
                           <option value="+595">🇵🇾 +595 (PY)</option>
                           <option value="+51">🇵🇪 +51 (PE)</option>
                           <option value="+63">🇵🇭 +63 (PH)</option>
                           <option value="+872">🇵🇳 +872 (PN)</option>
                           <option value="+48">🇵🇱 +48 (PL)</option>
                           <option value="+351">🇵🇹 +351 (PT)</option>
                           <option value="+1939">🇵🇷 +1939 (PR)</option>
                           <option value="+974">🇶🇦 +974 (QA)</option>
                           <option value="+40">🇷🇴 +40 (RO)</option>
                           <option value="+7">🇷🇺 +7 (RU)</option>
                           <option value="+250">🇷🇼 +250 (RW)</option>
                           <option value="+262">🇷🇪 +262 (RE)</option>
                           <option value="+590">🇧🇱 +590 (BL)</option>
                           <option value="+290">🇸🇭 +290 (SH)</option>
                           <option value="+1869">🇰🇳 +1869 (KN)</option>
                           <option value="+1758">🇱🇨 +1758 (LC)</option>
                           <option value="+590">🇲🇫 +590 (MF)</option>
                           <option value="+508">🇵🇲 +508 (PM)</option>
                           <option value="+1784">🇻🇨 +1784 (VC)</option>
                           <option value="+685">🇼🇸 +685 (WS)</option>
                           <option value="+378">🇸🇲 +378 (SM)</option>
                           <option value="+239">🇸🇹 +239 (ST)</option>
                           <option value="+966">🇸🇦 +966 (SA)</option>
                           <option value="+221">🇸🇳 +221 (SN)</option>
                           <option value="+381">🇷🇸 +381 (RS)</option>
                           <option value="+248">🇸🇨 +248 (SC)</option>
                           <option value="+232">🇸🇱 +232 (SL)</option>
                           <option value="+65">🇸🇬 +65 (SG)</option>
                           <option value="+421">🇸🇰 +421 (SK)</option>
                           <option value="+386">🇸🇮 +386 (SI)</option>
                           <option value="+677">🇸🇧 +677 (SB)</option>
                           <option value="+252">🇸🇴 +252 (SO)</option>
                           <option value="+27">🇿🇦 +27 (ZA)</option>
                           <option value="+211">🇸🇸 +211 (SS)</option>
                           <option value="+500">🇬🇸 +500 (GS)</option>
                           <option value="+34">🇪🇸 +34 (ES)</option>
                           <option value="+94">🇱🇰 +94 (LK)</option>
                           <option value="+249">🇸🇩 +249 (SD)</option>
                           <option value="+597">🇸🇷 +597 (SR)</option>
                           <option value="+47">🇸🇯 +47 (SJ)</option>
                           <option value="+268">🇸🇿 +268 (SZ)</option>
                           <option value="+46">🇸🇪 +46 (SE)</option>
                           <option value="+41">🇨🇭 +41 (CH)</option>
                           <option value="+963">🇸🇾 +963 (SY)</option>
                           <option value="+886">🇹🇼 +886 (TW)</option>
                           <option value="+992">🇹🇯 +992 (TJ)</option>
                           <option value="+255">🇹🇿 +255 (TZ)</option>
                           <option value="+66">🇹🇭 +66 (TH)</option>
                           <option value="+670">🇹🇱 +670 (TL)</option>
                           <option value="+228">🇹🇬 +228 (TG)</option>
                           <option value="+690">🇹🇰 +690 (TK)</option>
                           <option value="+676">🇹🇴 +676 (TO)</option>
                           <option value="+1868">🇹🇹 +1868 (TT)</option>
                           <option value="+216">🇹🇳 +216 (TN)</option>
                           <option value="+90">🇹🇷 +90 (TR)</option>
                           <option value="+993">🇹🇲 +993 (TM)</option>
                           <option value="+1649">🇹🇨 +1649 (TC)</option>
                           <option value="+688">🇹🇻 +688 (TV)</option>
                           <option value="+256">🇺🇬 +256 (UG)</option>
                           <option value="+380">🇺🇦 +380 (UA)</option>
                           <option value="+971">🇦🇪 +971 (AE)</option>
                           <option value="+44">🇬🇧 +44 (GB)</option>
                           <option value="+1">🇺🇸 +1 (US)</option>
                           <option value="+598">🇺🇾 +598 (UY)</option>
                           <option value="+998">🇺🇿 +998 (UZ)</option>
                           <option value="+678">🇻🇺 +678 (VU)</option>
                           <option value="+58">🇻🇪 +58 (VE)</option>
                           <option value="+84">🇻🇳 +84 (VN)</option>
                           <option value="+1284">🇻🇬 +1284 (VG)</option>
                           <option value="+1340">🇻🇮 +1340 (VI)</option>
                           <option value="+681">🇼🇫 +681 (WF)</option>
                           <option value="+967">🇾🇪 +967 (YE)</option>
                           <option value="+260">🇿🇲 +260 (ZM)</option>
                           <option value="+263">🇿🇼 +263 (ZW)</option>
                        </datalist>
                        <input type="text" value={newPbPhone} onChange={e => setNewPbPhone(e.target.value)} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="09..." />
                     </div>
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Loại Menu Hẹn</label>
                     <select value={newPbMenuType} onChange={e => setNewPbMenuType(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium text-gray-700 mb-4">
                        <option value="standard">Standard Menu (Tiêu chuẩn)</option>
                        <option value="vip">VIP Menu (Cao cấp)</option>
                        <option value="spa">Spa Menu (Trị liệu)</option>
                     </select>
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email (Tùy chọn)</label>
                     <input type="email" value={newPbEmail} onChange={e => setNewPbEmail(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="example@email.com" />
                  </div>
                  <div className="flex gap-3">
                     <div className="flex-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ngày hẹn</label>
                        <input type="date" value={newPbDate} onChange={e => setNewPbDate(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" />
                     </div>
                     <div className="flex-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Giờ</label>
                        <input type="time" value={newPbTime} onChange={e => setNewPbTime(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" />
                     </div>
                  </div>
                  <div className="flex gap-3">
                     <div className="flex-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Số lượng khách</label>
                        <input type="number" min="1" value={newPbGuests} onChange={e => setNewPbGuests(e.target.value ? parseInt(e.target.value) : '')} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" />
                     </div>
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ghi chú</label>
                     <input type="text" value={newPbNotes} onChange={e => setNewPbNotes(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="Yêu cầu đặc biệt..." />
                  </div>
               </div>
               
               <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3">
                  <button onClick={() => setIsAddModalOpen(false)} className="flex-1 py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-xl font-black transition-colors text-sm">
                     HỦY
                  </button>
                  <button onClick={handleAddPreBooking} disabled={isSubmitting || !newPbName || !newPbPhone} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-black transition-colors text-sm shadow-md shadow-emerald-200">
                     {isSubmitting ? 'ĐANG LƯU...' : 'LƯU LẠI'}
                  </button>
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
