import re

with open('components/shared/ScheduleBoard/ScheduleBoard.tsx.bak', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    '''import { CalendarClock, User, Tag, Clock, ChevronRight, X, AlertCircle, Info, Phone, Calendar as CalendarIcon, Sparkles } from 'lucide-react';''',
    '''import { CalendarClock, User, Tag, Clock, ChevronRight, X, AlertCircle, Info, Phone, Calendar as CalendarIcon, Sparkles, Plus, ExternalLink, Users } from 'lucide-react';\nimport { supabase } from '@/lib/supabase';'''
)

state_code = '''
  // --- THÊM: STATE CHO LỊCH HẸN ---
  const [preBookings, setPreBookings] = React.useState<any[]>([]);
  const [oldCustomerPhones, setOldCustomerPhones] = React.useState<Set<string>>(new Set());
  
  // State cho Add Modal
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [newPbName, setNewPbName] = React.useState('');
  const [newPbPhone, setNewPbPhone] = React.useState('');
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
     
     const formattedTime = newPbTime.length === 5 ? ${newPbTime}:00 : newPbTime;
     
     const { error } = await supabase.from('PreBookings').insert([{
        customer_name: newPbName,
        customer_phone: newPbPhone,
        guest_count: Number(newPbGuests) || 1,
        booking_date: newPbDate,
        booking_time: formattedTime,
        notes: newPbNotes,
        status: 'PENDING'
     }]);
     
     setIsSubmitting(false);
     if (!error) {
       setIsAddModalOpen(false);
       setNewPbName(''); setNewPbPhone(''); setNewPbGuests(1); setNewPbNotes('');
       fetchPreBookings();
     } else {
       console.error("Lỗi khi thêm khách hẹn:", error);
     }
  };

  const handlePreBookingClick = (pb: any) => {
     const baseUrl = process.env.NEXT_PUBLIC_WEB_NOI_BO_URL || 'http://localhost:3000';
     const url = new URL(${baseUrl}/en/new-user/standard/menu);
     url.searchParams.set('preBookingId', pb.id);
     if (pb.customer_name) url.searchParams.set('name', pb.customer_name);
     if (pb.customer_phone) url.searchParams.set('phone', pb.customer_phone);
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
    return ${hour}: ;
  };
'''

content = content.replace(
    '''const [selectedOrder, setSelectedOrder] = useState<any | null>(null);''',
    '''const [selectedOrder, setSelectedOrder] = useState<any | null>(null);\n''' + state_code
)

content = content.replace(
    '''<div className="w-full h-full flex flex-col bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden relative">''',
    '''<div className="w-full h-full flex flex-col md:flex-row bg-gray-50 rounded-3xl shadow-sm border border-gray-200 overflow-hidden relative">\n      <div className="flex-1 flex flex-col bg-white overflow-hidden relative z-10 border-r border-gray-200">'''
)

# Close the main wrapper after calendar grid, before AnimatePresence
content = content.replace(
    '''      {/* POPUP CHI TIẾT ĐƠN HÀNG (Khi bấm vào thẻ) */}''',
    '''      </div>\n\n      {/* RIGHT SIDEBAR - PREBOOKINGS */}\n      <div className="w-[340px] shrink-0 bg-white flex flex-col relative z-20">\n          <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">\n             <div className="flex items-center gap-2">\n                <CalendarClock size={20} className="text-emerald-600" />\n                <h3 className="font-black text-gray-800 text-lg">Khách Đã Hẹn</h3>\n             </div>\n             <div className="bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full text-xs">\n                {preBookings.length}\n             </div>\n          </div>\n          \n          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-slate-50/50">\n             {preBookings.length === 0 ? (\n                <div className="text-center text-sm font-medium text-gray-400 py-10">\n                   Chưa có khách hẹn trước\n                </div>\n             ) : (\n                preBookings.map(pb => (\n                   <div \n                     key={pb.id} \n                     onClick={() => handlePreBookingClick(pb)}\n                     className="bg-white p-3 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer group hover:border-emerald-300"\n                   >\n                      <div className="flex justify-between items-start mb-2">\n                         <div className="font-black text-gray-800 text-base flex flex-col gap-1">\n                            {pb.customer_name}\n                            {oldCustomerPhones.has(pb.customer_phone) && (\n                               <span className="text-[9px] w-max bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase tracking-wider">\n                                 <Sparkles size={10} /> Khách cũ\n                               </span>\n                            )}\n                         </div>\n                         <div className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">\n                           {formatTime(pb.booking_time)}\n                         </div>\n                      </div>\n                      <div className="flex flex-col gap-1.5 text-xs text-gray-600 font-medium">\n                         <div className="flex items-center gap-1.5"><Phone size={13} className="text-gray-400" /> {pb.customer_phone}</div>\n                         <div className="flex items-center gap-1.5"><Users size={13} className="text-gray-400" /> {pb.guest_count} khách</div>\n                         {pb.notes && <div className="flex items-center gap-1.5 text-gray-500"><Info size={13} className="text-gray-400" /> {pb.notes}</div>}\n                      </div>\n                      <div className="mt-3 flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">\n                         <ExternalLink size={12} /> Bấm để tạo đơn\n                      </div>\n                   </div>\n                ))\n             )}\n          </div>\n          \n          <div className="p-4 border-t border-gray-200 bg-white">\n             <button \n                onClick={() => setIsAddModalOpen(true)}\n                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-colors shadow-sm shadow-emerald-200"\n             >\n                <Plus size={16} strokeWidth={3} /> THÊM KHÁCH HẸN\n             </button>\n          </div>\n       </div>\n\n      {/* POPUP CHI TIẾT ĐƠN HÀNG (Khi bấm vào thẻ) */}'''
)

modal_code = '''
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
                     <input type="text" value={newPbPhone} onChange={e => setNewPbPhone(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="09..." />
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
'''

content = content.replace(
    '''      <style>{''',
    modal_code + '''\n      <style>{'''
)

with open('components/shared/ScheduleBoard/ScheduleBoard.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Update successful')
