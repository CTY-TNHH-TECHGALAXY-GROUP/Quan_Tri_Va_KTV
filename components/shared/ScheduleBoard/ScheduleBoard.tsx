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
 *  4. Click vao the khach hen -> panel thong tin khach; nut "Mo WRB" mo tab Web Noi Bo
 *     tai /{lang}/{menuType}/menu kem query params de auto-fill o buoc Checkout.
 *     (03/10/2026: WRB da xoa thu muc new-user — link cu 404.)
 *
 * Database: Bang PreBookings (xem TableInSupabase.md muc 12).
 * Env var: NEXT_PUBLIC_WEB_NOI_BO_URL (URL Web Noi Bo de redirect).
 *
 * Phia Web Noi Bo: src/app/[lang]/[menuType]/menu/page.tsx
 *   co useEffect bat query params -> luu localStorage("contactedFirstInfo").
 */
import React, { useState, useMemo } from 'react';
import { CalendarClock, User, Tag, Clock, ChevronRight, X, AlertCircle, Info, Phone, Calendar as CalendarIcon, UserCheck, Crown, Plus, ExternalLink, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { t } from './ScheduleBoard.i18n';
import { PhoneCodeSelect } from './PhoneCodeSelect';
import { searchCustomers } from '@/app/reception/dispatch/actions';
import { isDummyPhone, isDummyEmail } from '@/lib/customer.logic';

/**
 * SĐT giữ chỗ: '0000…' (isDummyPhone) hoặc 'GUEST-<id>' do kiosk WRB sinh cho khách không
 * nhập SĐT (2.934 hồ sơ, 03/10/2026). Không mở rộng isDummyPhone dùng chung — các luồng gộp
 * khách đang dựa vào nghĩa hiện tại của nó (xem BookingModificationService).
 */
const isPlaceholderPhone = (p: string | null | undefined) => !p || isDummyPhone(p) || /^GUEST-/i.test(p.trim());

// 🔧 UI CONFIGURATION
/** Web Nội Bộ (WRB) — nơi khách order. Ghi đè bằng NEXT_PUBLIC_WEB_NOI_BO_URL. */
const DEFAULT_WRB_URL = 'https://oriaspa.vercel.app';
/** Ngôn ngữ mở WRB; khách đổi ngôn ngữ tiếp trên kiosk. */
const WRB_LANG = 'en';
/** Khối lịch hẹn trên lưới giờ — chưa có dịch vụ nên vẽ cao bằng một tua tiêu chuẩn. */
const PREBOOKING_BLOCK_MINUTES = 60;
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
  // Gợi ý hồ sơ khách khi gõ tên / email — cùng nguồn `searchCustomers` với Tạo đơn nhanh.
  const [custSuggestions, setCustSuggestions] = React.useState<any[]>([]);
  const [suggestField, setSuggestField] = React.useState<'name' | 'email' | null>(null);
  const [isSearchingCust, setIsSearchingCust] = React.useState(false);
  // Thẻ lịch hẹn đang mở panel thông tin khách.
  const [selectedPreBooking, setSelectedPreBooking] = React.useState<any | null>(null);
  const [isCancelling, setIsCancelling] = React.useState(false);
  // Ngày đang xem trên lưới giờ. Đơn thật (orders) chỉ có của hôm nay; các ngày tới chỉ có lịch hẹn.
  const [viewDate, setViewDate] = React.useState(() => {
     const d = new Date();
     return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
  });
  // Ngày: cột theo KTV. Tuần: cột theo 7 ngày (T2→CN) của tuần chứa viewDate.
  const [viewMode, setViewMode] = React.useState<'day' | 'week'>('day');
  const weekDays = useMemo(() => {
     const d = new Date(`${viewDate}T00:00:00`);
     const dow = (d.getDay() + 6) % 7; // T2 = 0
     d.setDate(d.getDate() - dow);
     return Array.from({ length: 7 }, (_, i) => {
        const x = new Date(d); x.setDate(d.getDate() + i);
        return new Date(x.getTime() - (x.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
     });
  }, [viewDate]);

  // --- FETCH LỊCH HẸN TỪ SUPABASE ---
  React.useEffect(() => {
    fetchPreBookings();
    
    // Subscribe realtime
    const sub = supabase.channel('prebookings_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'PreBookings' }, () => {
         fetchPreBookings();
      }).subscribe();
      
    return () => { supabase.removeChannel(sub); };
  // Đổi sang tuần khác → tải lại cửa sổ dữ liệu (và đăng ký lại realtime với fetch mới).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDays[0]]);

  /** 'YYYY-MM-DD' theo giờ máy (trình duyệt quầy đặt giờ VN). */
  const toLocalDateStr = (d: Date) =>
    new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

  const fetchPreBookings = async () => {
    // Cửa sổ = tuần đang xem ± 1 tuần: chuyển ngày/tuần liền kề không phải chờ tải.
    const from = new Date(`${weekDays[0]}T00:00:00`); from.setDate(from.getDate() - 7);
    const to = new Date(`${weekDays[6]}T00:00:00`); to.setDate(to.getDate() + 7);

    const { data: pbs, error } = await supabase
       .from('PreBookings')
       .select('*')
       .gte('booking_date', toLocalDateStr(from))
       .lte('booking_date', toLocalDateStr(to))
       .eq('status', 'PENDING')
       .order('booking_date', { ascending: true })
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

  // Debounce tra hồ sơ khách theo ô đang gõ (tên hoặc email), từ 2 ký tự.
  React.useEffect(() => {
     if (!isAddModalOpen || !suggestField) return;
     const query = (suggestField === 'name' ? newPbName : newPbEmail).trim();
     if (query.length < 2) { setCustSuggestions([]); return; }
     const timer = setTimeout(async () => {
        setIsSearchingCust(true);
        const res = await searchCustomers(query);
        setCustSuggestions(res?.success && res.data ? res.data : []);
        setIsSearchingCust(false);
     }, 300);
     return () => clearTimeout(timer);
  }, [newPbName, newPbEmail, suggestField, isAddModalOpen]);

  const handleSelectCustomer = (c: any) => {
     setNewPbName(c.fullName || '');
     // Điền cả SĐT giữ chỗ 'GUEST-…' của hồ sơ kiosk: WRB dùng mã này để khớp đúng khách cũ
     // khi chốt đơn (tránh sinh thêm một khách GUEST- mới). Quầy có thể sửa thành SĐT thật.
     if (c.phone) {
        // Hồ sơ đã lưu SĐT đầy đủ (có thể kèm mã nước) → bỏ ô mã nước để không ghép đôi.
        setNewPbPhoneCode('');
        setNewPbPhone(String(c.phone).replace(/\s+/g, ''));
     }
     if (c.email && !isDummyEmail(c.email)) setNewPbEmail(c.email);
     setCustSuggestions([]);
     setSuggestField(null);
  };

  const renderCustSuggestions = (field: 'name' | 'email') => (
     suggestField === field && custSuggestions.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
           <div className="max-h-48 overflow-y-auto p-1 custom-scrollbar">
              {custSuggestions.map((c: any) => (
                 <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectCustomer(c)}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-emerald-50 transition-colors flex flex-col gap-0.5"
                 >
                    <span className="text-sm font-bold text-gray-900 flex items-center gap-1.5"><UserCheck size={11} className="text-amber-500" /> {c.fullName || '—'}</span>
                    <span className="flex items-center gap-3 text-[11px] font-medium text-gray-500">
                       {c.phone && <span className="flex items-center gap-1"><Phone size={10} /> {isPlaceholderPhone(c.phone) ? `${c.phone} (mã kiosk)` : c.phone}</span>}
                       {c.email && !isDummyEmail(c.email) && <span className="flex items-center gap-1"><Tag size={10} /> {c.email}</span>}
                    </span>
                 </button>
              ))}
           </div>
        </div>
     )
  );

  const handleAddPreBooking = async () => {
     // Cần tên và ít nhất một kênh liên lạc thật (SĐT hoặc email).
     if (!newPbName || (!newPbPhone && !newPbEmail) || !newPbDate || !newPbTime) return;
     setIsSubmitting(true);
     
     const formattedTime = newPbTime.length === 5 ? `${newPbTime}:00` : newPbTime;
     
     const { error } = await supabase.from('PreBookings').insert([{
        customer_name: newPbName,
        customer_phone: newPbPhone ? (newPbPhoneCode || "").replace(/\s+/g, "") + newPbPhone.replace(/\s+/g, "") : null,
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

  /**
   * Link sang WRB: trang menu đọc các query này rồi lưu localStorage("contactedFirstInfo")
   * để bước Thanh toán tự điền. preBookingId để WRB đổi lịch hẹn sang CONVERTED khi chốt đơn.
   */
  const buildWrbUrl = (pb: any) => {
     const baseUrl = (process.env.NEXT_PUBLIC_WEB_NOI_BO_URL || DEFAULT_WRB_URL).replace(/\/+$/, '');
     // Deep Body (và giá trị cũ 'spa') nằm trong VIP menu, tab deep_body — không có route riêng.
     const isDeepBody = pb.menu_type === 'deep_body' || pb.menu_type === 'spa';
     const menuPath = isDeepBody ? 'vip' : (pb.menu_type || 'standard');
     const url = new URL(`${baseUrl}/${WRB_LANG}/${menuPath}/menu`);
     if (isDeepBody) url.searchParams.set('tab', 'deep_body');
     url.searchParams.set('preBookingId', pb.id);
     if (pb.customer_name) url.searchParams.set('name', pb.customer_name);
     if (pb.customer_phone) url.searchParams.set('phone', pb.customer_phone);
     if (pb.customer_email && !isDummyEmail(pb.customer_email)) url.searchParams.set('email', pb.customer_email);
     url.searchParams.set('menuType', menuPath);
     if (pb.guest_count) url.searchParams.set('guests', pb.guest_count.toString());
     if (pb.notes) url.searchParams.set('notes', pb.notes);
     return url.toString();
  };

  const handlePreBookingClick = (pb: any) => {
     setSelectedPreBooking(pb);
     // Nhảy lưới giờ tới đúng ngày hẹn để thấy khối khách này ở đúng chỗ.
     if (pb.booking_date) setViewDate(pb.booking_date);
  };

  const shiftViewDate = (days: number) => {
     const d = new Date(`${viewDate}T00:00:00`); d.setDate(d.getDate() + days);
     setViewDate(toLocalDateStr(d));
  };
  const isViewingToday = viewDate === toLocalDateStr(new Date());
  /** Cột phải chỉ hiện lịch hẹn của NGÀY ĐANG XEM trên lưới giờ (đổi ngày → đổi danh sách). */
  const preBookingsOfViewDate = useMemo(
     () => preBookings.filter(pb => pb.booking_date === viewDate),
     [preBookings, viewDate]
  );

  const openWrbForPreBooking = (pb: any) => {
     window.open(buildWrbUrl(pb), '_blank', 'noopener');
  };

  const cancelPreBooking = async (pb: any) => {
     if (!window.confirm(t.cancelConfirm)) return;
     setIsCancelling(true);
     const { error } = await supabase.from('PreBookings')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', pb.id);
     setIsCancelling(false);
     if (error) { console.error('Lỗi huỷ lịch hẹn:', error); alert(t.cancelError); return; }
     setSelectedPreBooking(null);
     fetchPreBookings();
  };

  /** Nhãn nhóm ngày cho danh sách: Hôm nay / Ngày mai / Thứ, dd/MM. */
  const dateGroupLabel = (dateStr: string) => {
     const today = toLocalDateStr(new Date());
     const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
     if (dateStr === today) return t.today;
     if (dateStr === toLocalDateStr(tmr)) return t.tomorrow;
     const d = new Date(`${dateStr}T00:00:00`);
     return d.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
  };

  /** Lịch hôm nay đã quá giờ hẹn mà khách chưa order. */
  const isLatePreBooking = (pb: any) => {
     const now = new Date();
     if (pb.booking_date !== toLocalDateStr(now)) return false;
     const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
     return String(pb.booking_time || '').slice(0, 5) < hhmm;
  };

  const MENU_TYPE_LABEL: Record<string, string> = { standard: 'Standard', vip: 'VIP', deep_body: 'Deep Body', spa: 'Deep Body' };
  const MENU_TYPE_OPTIONS = [
     { value: 'standard', label: 'Standard', hint: 'Menu tiêu chuẩn' },
     { value: 'vip', label: 'VIP', hint: 'Menu cao cấp' },
     { value: 'deep_body', label: 'Deep Body', hint: 'Trị liệu' },
  ];

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
    if (viewMode === 'week') {
      const today = toLocalDateStr(new Date());
      return weekDays.map(dt => ({
        id: dt,
        name: new Date(`${dt}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }),
        isSpecial: dt === today,
        isDay: true,
      }));
    }
    const activeStaffs = staffs.length > 0 ? staffs.map(s => ({ id: s.id || s.code, name: s.full_name || s.name })) : extractStaffs();
    return [
      { id: 'UNASSIGNED', name: 'Chưa Phân Công', isSpecial: true },
      ...activeStaffs
    ];
  }, [orders, staffs, viewMode, weekDays]);

  // Chuẩn hoá dữ liệu để vẽ lên Lưới
  const gridBlocks = useMemo(() => {
    const blocks: any[] = [];

    const todayStr = toLocalDateStr(new Date());
    // Ngày: lịch hẹn của ngày đang xem vào cột "Chưa Phân Công" (chưa gán KTV/dịch vụ).
    // Tuần: mỗi lịch hẹn vào cột của ngày hẹn.
    const pbsToDraw = viewMode === 'week'
      ? preBookings.filter(pb => weekDays.includes(pb.booking_date))
      : preBookings.filter(pb => pb.booking_date === viewDate);
    pbsToDraw.forEach(pb => {
      blocks.push({
        id: `pb-${pb.id}`,
        isPreBooking: true,
        preBooking: pb,
        customerName: pb.customer_name || 'Khách hẹn',
        customerPhone: pb.customer_phone,
        source: 'PRE_BOOKING',
        timeStart: String(pb.booking_time || '12:00').slice(0, 5),
        duration: PREBOOKING_BLOCK_MINUTES,
        status: 'PRE_BOOKING',
        serviceName: `${t.preBookingBlock} · ${pb.guest_count || 1} ${t.guests} · ${MENU_TYPE_LABEL[pb.menu_type] || 'Standard'}`,
        ktvId: viewMode === 'week' ? pb.booking_date : 'UNASSIGNED',
      });
    });

    // Đơn hàng thực tế chỉ có của hôm nay (bảng điều phối tải theo ngày hiện tại).
    if (viewMode === 'day' && !isViewingToday) return blocks;
    if (viewMode === 'week' && !weekDays.includes(todayStr)) return blocks;

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

    // Chế độ tuần: mọi đơn thật hôm nay dồn vào cột của hôm nay.
    return viewMode === 'week' ? blocks.map(b => (b.isPreBooking ? b : { ...b, ktvId: todayStr })) : blocks;
  }, [orders, preBookings, viewDate, isViewingToday, viewMode, weekDays]);


  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-gray-50 rounded-3xl shadow-sm border border-gray-200 overflow-hidden relative">
      <div className="flex-1 flex flex-col bg-white overflow-hidden relative z-10 border-r border-gray-200">
      
      {/* HEADER TỔNG */}
      <div className="px-4 md:px-5 py-3 md:py-4 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <CalendarIcon size={24} strokeWidth={2.5} className="text-indigo-600" />
          <div>
            <h2 className="text-xl font-black text-gray-900 tracking-tight">Lịch Trực Quan</h2>
            <p className="text-xs font-bold text-gray-500 mt-0.5">Hiển thị mọi đơn hàng theo từng khung giờ & KTV</p>
          </div>
          {/* Chọn ngày xem: hôm nay có đơn thật + lịch hẹn; ngày tới chỉ có lịch hẹn */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-1 py-1 shadow-sm ml-2">
            <button onClick={() => shiftViewDate(viewMode === 'week' ? -7 : -1)} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center font-black text-gray-600">‹</button>
            {/* Bấm vào nhãn ngày là chọn ngày bất kỳ (input date phủ lên nhãn). */}
            <label className="relative px-3 h-8 rounded-lg text-xs font-black text-gray-800 hover:bg-gray-100 min-w-[150px] flex items-center justify-center cursor-pointer">
              {viewMode === 'week'
                ? `${t.weekOf} ${new Date(`${weekDays[0]}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} – ${new Date(`${weekDays[6]}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}`
                : `${dateGroupLabel(viewDate)} · ${new Date(`${viewDate}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}`}
              <input type="date" value={viewDate} onChange={e => e.target.value && setViewDate(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Chọn ngày" />
            </label>
            <button onClick={() => shiftViewDate(viewMode === 'week' ? 7 : 1)} className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center font-black text-gray-600">›</button>
            {!isViewingToday && (
              <button onClick={() => setViewDate(toLocalDateStr(new Date()))} className="px-2 h-8 rounded-lg text-[11px] font-bold text-indigo-600 hover:bg-indigo-50">{t.today}</button>
            )}
          </div>
          {/* Ngày / Tuần */}
          <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
            {(['day', 'week'] as const).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`px-3 h-8 rounded-lg text-xs font-black transition-colors ${viewMode === m ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                {m === 'day' ? t.viewDay : t.viewWeek}
              </button>
            ))}
          </div>
        </div>
        
        {/* Chú thích màu sắc (Hiển thị cả Mobile & Desktop) */}
        <div className="flex items-center gap-2 md:gap-4 bg-white px-3 md:px-4 py-1.5 md:py-2 rounded-xl border border-gray-200 shadow-sm overflow-x-auto no-scrollbar text-[11px] md:text-xs font-bold text-gray-600 shrink-0">
           <div className="flex items-center gap-1.5 md:gap-2 shrink-0"><span className="w-2.5 md:w-3 h-2.5 md:h-3 rounded-full bg-emerald-400 border border-emerald-500"></span>{t.preBookingBlock}</div>
           <div className="flex items-center gap-1.5 md:gap-2 shrink-0"><span className="w-2.5 md:w-3 h-2.5 md:h-3 rounded-full bg-red-500 border border-red-600"></span>Khách VIP</div>
           <div className="flex items-center gap-1.5 md:gap-2 shrink-0"><span className="w-2.5 md:w-3 h-2.5 md:h-3 rounded-full bg-amber-400 border border-amber-500"></span>Web mới</div>
           <div className="flex items-center gap-1.5 md:gap-2 shrink-0"><span className="w-2.5 md:w-3 h-2.5 md:h-3 rounded-full bg-blue-400 border border-blue-500"></span>Khách đã xác nhận</div>
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
                   onClick={() => { if ((col as any).isDay) { setViewDate(col.id); setViewMode('day'); } }}
                   title={(col as any).isDay ? 'Bấm để xem ngày này' : undefined}
                   className={`w-[240px] h-14 shrink-0 flex items-center justify-center border-r border-gray-200 p-2 
                     ${(col as any).isDay ? 'cursor-pointer hover:bg-indigo-50' : ''}
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
                         
                         if (block.isPreBooking) {
                            bgColor = 'bg-emerald-50 border-emerald-400 border-dashed text-emerald-900 shadow-emerald-200/50';
                            tagColor = 'bg-emerald-500';
                         } else if (block.source?.includes('VIP')) {
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
                             onClick={() => block.isPreBooking ? handlePreBookingClick(block.preBooking) : setSelectedOrder(block)}
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
                                  <Crown size={12} />
                                </div>
                              )}
                              {block.isPreBooking && (
                                <div className="absolute top-2 right-2 text-emerald-600 bg-emerald-100 p-0.5 rounded-full">
                                  <CalendarClock size={12} />
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
                <div>
                   <h3 className="font-black text-gray-800 text-lg leading-tight">{t.panelTitle}</h3>
                   <p className="text-[11px] font-bold text-gray-500">{dateGroupLabel(viewDate)} · {new Date(`${viewDate}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</p>
                </div>
             </div>
             <div className="bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full text-xs">
                {preBookingsOfViewDate.length}
             </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-slate-50/50">
             {preBookingsOfViewDate.length === 0 ? (
                <div className="text-center text-sm font-medium text-gray-400 py-10">
                   {t.emptyForDay}
                </div>
             ) : (
                preBookingsOfViewDate.map(pb => (
                   <React.Fragment key={pb.id}>
                   <div 
                     onClick={() => handlePreBookingClick(pb)}
                     className="bg-white p-3 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer group hover:border-emerald-300"
                   >
                      <div className="flex justify-between items-start mb-2">
                         <div className="font-black text-gray-800 text-base flex flex-col gap-1">
                            {pb.customer_name}
                            <div className="flex gap-1 flex-wrap">
                            {oldCustomerPhones.has(pb.customer_phone) && (
                               <span className="text-[9px] w-max bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase tracking-wider">
                                 <UserCheck size={10} /> {t.oldCustomer}
                               </span>
                            )}
                            {isLatePreBooking(pb) && (
                               <span className="text-[9px] w-max bg-red-100 text-red-700 px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase tracking-wider">
                                 <AlertCircle size={10} /> {t.late}
                               </span>
                            )}
                            </div>
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
                      <div className="mt-3 flex items-center justify-between gap-2">
                         <span className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ChevronRight size={12} /> {t.tapForDetail}
                         </span>
                         {/* Đi thẳng sang WRB, không qua panel — stopPropagation để không mở panel. */}
                         <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openWrbForPreBooking(pb); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black transition-colors"
                         >
                            <ExternalLink size={12} /> {t.openWrbShort}
                         </button>
                      </div>
                   </div>
                   </React.Fragment>
                ))
             )}
          </div>
          
          <div className="p-4 border-t border-gray-200 bg-white">
             <button 
                onClick={() => setIsAddModalOpen(true)}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-colors shadow-sm shadow-emerald-200"
             >
                <Plus size={16} strokeWidth={3} /> {t.addButton}
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
        {selectedPreBooking && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setSelectedPreBooking(null)}>
             <motion.div
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               onClick={(e) => e.stopPropagation()}
               className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-sm w-full overflow-hidden flex flex-col"
             >
               <div className="p-5 bg-emerald-600 text-white flex justify-between items-start gap-3">
                  <div className="min-w-0">
                     <p className="text-[10px] font-black uppercase tracking-widest text-emerald-100">{t.detailTitle}</p>
                     <h3 className="text-xl font-black truncate">{selectedPreBooking.customer_name}</h3>
                     <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                        oldCustomerPhones.has(selectedPreBooking.customer_phone) ? 'bg-amber-100 text-amber-700' : 'bg-white/20 text-white'
                     }`}>
                        <UserCheck size={10} /> {oldCustomerPhones.has(selectedPreBooking.customer_phone) ? t.oldCustomer : t.newCustomer}
                     </span>
                  </div>
                  <button onClick={() => setSelectedPreBooking(null)} className="p-1 hover:bg-white/20 rounded-full transition-colors shrink-0"><X size={20}/></button>
               </div>

               <div className="p-5 space-y-3 text-sm">
                  <div className="flex items-center gap-3"><Phone size={16} className="text-gray-400 shrink-0" /><div><p className="text-[10px] font-bold uppercase text-gray-400">{t.phone}</p><p className="font-bold text-gray-800">{selectedPreBooking.customer_phone || '—'}</p></div></div>
                  <div className="flex items-center gap-3"><Info size={16} className="text-gray-400 shrink-0" /><div><p className="text-[10px] font-bold uppercase text-gray-400">{t.email}</p><p className="font-bold text-gray-800 break-all">{selectedPreBooking.customer_email || '—'}</p></div></div>
                  <div className="grid grid-cols-2 gap-3">
                     <div className="flex items-center gap-3"><CalendarIcon size={16} className="text-gray-400 shrink-0" /><div><p className="text-[10px] font-bold uppercase text-gray-400">{t.appointmentAt}</p><p className="font-bold text-gray-800">{dateGroupLabel(selectedPreBooking.booking_date)} · {formatTime(selectedPreBooking.booking_time)}</p></div></div>
                     <div className="flex items-center gap-3"><Users size={16} className="text-gray-400 shrink-0" /><div><p className="text-[10px] font-bold uppercase text-gray-400">{t.guestCount}</p><p className="font-bold text-gray-800">{selectedPreBooking.guest_count || 1} {t.guests}</p></div></div>
                  </div>
                  <div className="flex items-center gap-3"><Tag size={16} className="text-gray-400 shrink-0" /><div><p className="text-[10px] font-bold uppercase text-gray-400">{t.menuType}</p><p className="font-bold text-gray-800">{MENU_TYPE_LABEL[selectedPreBooking.menu_type] || selectedPreBooking.menu_type || 'Standard'}</p></div></div>
                  <div className="bg-gray-50 rounded-xl p-3">
                     <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">{t.notes}</p>
                     <p className="text-gray-700">{selectedPreBooking.notes || <span className="text-gray-400">{t.noNotes}</span>}</p>
                  </div>
               </div>

               <div className="p-5 border-t border-gray-100 bg-gray-50 space-y-2">
                  <button
                     onClick={() => openWrbForPreBooking(selectedPreBooking)}
                     className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                     <ExternalLink size={16} /> {t.openWrb}
                  </button>
                  <p className="text-[11px] text-gray-500 text-center leading-snug">{t.openWrbHint}</p>
                  <div className="flex gap-2 pt-1">
                     <button
                        onClick={() => cancelPreBooking(selectedPreBooking)}
                        disabled={isCancelling}
                        className="flex-1 py-2.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-xl font-bold text-xs disabled:opacity-50"
                     >{t.cancel}</button>
                     <button onClick={() => setSelectedPreBooking(null)} className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 rounded-xl font-bold text-xs">{t.close}</button>
                  </div>
               </div>
             </motion.div>
          </div>
        )}
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
                     <div className="relative">
                        <input type="text" value={newPbName}
                           onChange={e => { setNewPbName(e.target.value); setSuggestField('name'); }}
                           onFocus={() => setSuggestField('name')}
                           onBlur={() => setTimeout(() => setSuggestField(f => (f === 'name' ? null : f)), 150)}
                           className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="Tên khách hàng — gõ để gợi ý hồ sơ" />
                        {isSearchingCust && suggestField === 'name' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">…</span>}
                        {renderCustSuggestions('name')}
                     </div>
                  </div>
                  <div>
                     <div className="flex justify-between items-end mb-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase">Số điện thoại</label>
                        {isFormOldCustomer && (
                           <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider font-black">
                             <UserCheck size={10} /> Khách cũ
                           </span>
                        )}
                     </div>
                     <div className="flex gap-2">
                        <PhoneCodeSelect value={newPbPhoneCode} onChange={setNewPbPhoneCode} />
                        <input type="text" value={newPbPhone} onChange={e => setNewPbPhone(e.target.value)} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="09..." />
                     </div>
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Loại Menu Hẹn</label>
                     <div className="grid grid-cols-3 gap-2">
                        {MENU_TYPE_OPTIONS.map(opt => (
                           <button
                              key={opt.value}
                              type="button"
                              onClick={() => setNewPbMenuType(opt.value)}
                              className={`rounded-xl border px-2 py-2.5 text-left transition-all ${
                                 newPbMenuType === opt.value
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-sm'
                                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-emerald-300 hover:bg-white'
                              }`}
                           >
                              <span className="block text-sm font-black leading-tight">{opt.label}</span>
                              <span className="block text-[10px] font-medium opacity-70 mt-0.5">{opt.hint}</span>
                           </button>
                        ))}
                     </div>
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email (Tùy chọn)</label>
                     <div className="relative">
                        <input type="email" value={newPbEmail}
                           onChange={e => { setNewPbEmail(e.target.value); setSuggestField('email'); }}
                           onFocus={() => setSuggestField('email')}
                           onBlur={() => setTimeout(() => setSuggestField(f => (f === 'email' ? null : f)), 150)}
                           className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="example@email.com — gõ để gợi ý hồ sơ" />
                        {isSearchingCust && suggestField === 'email' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">…</span>}
                        {renderCustSuggestions('email')}
                     </div>
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
                  <button onClick={handleAddPreBooking} disabled={isSubmitting || !newPbName || (!newPbPhone && !newPbEmail)} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-black transition-colors text-sm shadow-md shadow-emerald-200">
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
