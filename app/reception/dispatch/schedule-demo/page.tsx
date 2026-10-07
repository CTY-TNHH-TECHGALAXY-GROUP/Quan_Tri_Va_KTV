'use client';

import React, { useState, useMemo } from 'react';
import { 
  CalendarClock, User, Tag, Clock, ChevronRight, X, AlertCircle, Info, 
  Phone, Calendar as CalendarIcon, UserCheck, Crown, Plus, ExternalLink, 
  Users, Smartphone, Tablet, Monitor, CheckCircle2, Sparkles, SlidersHorizontal,
  ChevronLeft, LayoutGrid, ListOrdered
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// DỮ LIỆU MOCK PHỤC VỤ DEMO TRỰC QUAN
const MOCK_STAFFS = [
  { id: 'T001', name: 'T001 - Hương Ly' },
  { id: 'T002', name: 'T002 - Mai Linh' },
  { id: 'T003', name: 'T003 - Thuỳ Dương' },
  { id: 'T004', name: 'T004 - Kim Oanh' },
  { id: 'T005', name: 'T005 - Hải Yến' },
];

const MOCK_ORDERS = [
  {
    id: 'ord-101',
    customerName: 'Chị Lan Phương',
    customerPhone: '0903123456',
    serviceName: 'Combo Gội Đầu & Chăm Sóc Da 90p',
    technicianId: 'T001',
    technicianName: 'T001 - Hương Ly',
    startTime: '09:00',
    endTime: '10:30',
    duration: 90,
    status: 'IN_PROGRESS',
    source: 'VIP_BOOKING',
    date: '2026-10-07',
  },
  {
    id: 'ord-102',
    customerName: 'Anh Minh Quân',
    customerPhone: '0918889999',
    serviceName: 'Massage Body Trị Liệu Cổ Vai Gáy 60p',
    technicianId: 'T002',
    technicianName: 'T002 - Mai Linh',
    startTime: '10:00',
    endTime: '11:00',
    duration: 60,
    status: 'CONFIRMED',
    source: 'DIRECT',
    date: '2026-10-07',
  },
  {
    id: 'ord-103',
    customerName: 'Jessica Miller',
    customerPhone: '0934567890',
    serviceName: 'Aromatherapy Relaxation 75p',
    technicianId: 'T003',
    technicianName: 'T003 - Thuỳ Dương',
    startTime: '11:30',
    endTime: '12:45',
    duration: 75,
    status: 'NEW',
    source: 'WEB_BOOKING',
    date: '2026-10-07',
  },
  {
    id: 'ord-104',
    customerName: 'Chị Ngọc Hà',
    customerPhone: '0987654321',
    serviceName: 'Trị Liệu Chuông Xoay Himalaya 90p',
    technicianId: 'T004',
    technicianName: 'T004 - Kim Oanh',
    startTime: '13:00',
    endTime: '14:30',
    duration: 90,
    status: 'CONFIRMED',
    source: 'VIP_BOOKING',
    date: '2026-10-07',
  },
];

const MOCK_PRE_BOOKINGS = [
  {
    id: 'pb-01',
    customer_name: 'Bà Đặng Bích Thuỷ',
    customer_phone: '0908112233',
    customer_email: 'bichthuy@gmail.com',
    guest_count: 2,
    booking_date: '2026-10-07',
    booking_time: '14:30',
    notes: 'Yêu cầu 2 giường cạnh nhau, thích tinh dầu sả chanh',
    menu_type: 'vip',
    isOldCustomer: true,
  },
  {
    id: 'pb-02',
    customer_name: 'Mr. David Wilson',
    customer_phone: '0912345678',
    customer_email: 'david.wilson@sg.com',
    guest_count: 1,
    booking_date: '2026-10-07',
    booking_time: '15:30',
    notes: 'Lần đầu đến, nói tiếng Anh',
    menu_type: 'standard',
    isOldCustomer: false,
  },
  {
    id: 'pb-03',
    customer_name: 'Chị Thu Hà (KOL)',
    customer_phone: '0977889900',
    customer_email: 'thuha.beauty@gmail.com',
    guest_count: 3,
    booking_date: '2026-10-07',
    booking_time: '17:00',
    notes: 'Cần phòng riêng yên tĩnh, check-in chụp hình',
    menu_type: 'standard',
    isOldCustomer: true,
  },
  {
    id: 'pb-04',
    customer_name: 'Anh Trần Tuấn Kiệt',
    customer_phone: '0933221100',
    customer_email: '',
    guest_count: 1,
    booking_date: '2026-10-07',
    booking_time: '18:30',
    notes: 'Đặt lịch qua Zalo',
    menu_type: 'standard',
    isOldCustomer: false,
  },
];

const TIME_START = 8;
const TIME_END = 23;
const ROW_HEIGHT = 80;
const MINUTE_HEIGHT = ROW_HEIGHT / 60;

export default function ScheduleResponsiveDemoPage() {
  // Device Preview State: 'MOBILE' (375px), 'MOBILE_LARGE' (414px), 'TABLET' (768px), 'DESKTOP' (1200px), 'FULL'
  const [deviceMode, setDeviceMode] = useState<'MOBILE' | 'MOBILE_LARGE' | 'TABLET' | 'DESKTOP' | 'FULL'>('MOBILE');

  // Interactive Responsive Component States
  const [activeMobileTab, setActiveMobileTab] = useState<'TIMELINE' | 'PREBOOKINGS'>('TIMELINE');
  const [viewDate, setViewDate] = useState('2026-10-07');
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [selectedPreBooking, setSelectedPreBooking] = useState<any | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form states for Add PreBooking modal
  const [newPbName, setNewPbName] = useState('');
  const [newPbPhone, setNewPbPhone] = useState('');
  const [newPbGuests, setNewPbGuests] = useState(1);
  const [newPbTime, setNewPbTime] = useState('14:00');
  const [newPbNotes, setNewPbNotes] = useState('');

  // Đọc query parameters để hỗ trợ chụp ảnh tự động và kiểm thử trực tiếp qua link
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const d = params.get('device');
      if (d && ['MOBILE', 'MOBILE_LARGE', 'TABLET', 'DESKTOP', 'FULL'].includes(d)) {
        setDeviceMode(d as any);
      }
      const tab = params.get('tab');
      if (tab && ['TIMELINE', 'PREBOOKINGS'].includes(tab)) {
        setActiveMobileTab(tab as any);
      }
      const modal = params.get('modal');
      if (modal === 'add') {
        setIsAddModalOpen(true);
      } else if (modal === 'order') {
        setSelectedOrder(MOCK_ORDERS[0]);
      }
    }
  }, []);

  const [isRealMobile, setIsRealMobile] = useState(false);
  React.useEffect(() => {
    const check = () => setIsRealMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const isMobile = deviceMode === 'FULL' ? isRealMobile : (deviceMode === 'MOBILE' || deviceMode === 'MOBILE_LARGE');

  const hours = useMemo(() => {
    return Array.from({ length: TIME_END - TIME_START + 1 }, (_, i) => TIME_START + i);
  }, []);

  const weekDays = useMemo(() => {
    const d = new Date(`${viewDate}T00:00:00`);
    const dow = (d.getDay() + 6) % 7; // T2 = 0
    d.setDate(d.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(d); x.setDate(d.getDate() + i);
      return x.toISOString().split('T')[0];
    });
  }, [viewDate]);

  const columns = useMemo(() => {
    if (viewMode === 'week') {
      const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
      return weekDays.map((dt, idx) => ({
        id: dt,
        name: `${dayNames[idx]} (${dt.split('-')[2]}/${dt.split('-')[1]})`,
        isDay: true,
      }));
    }
    return [
      { id: 'unassigned', name: 'Chưa gán KTV', isSpecial: true },
      ...MOCK_STAFFS.map(s => ({ id: s.id, name: s.name, isSpecial: false })),
    ];
  }, [viewMode, weekDays]);

  // Dimensions based on simulator mode
  const getDeviceWidth = () => {
    switch (deviceMode) {
      case 'MOBILE': return '375px';
      case 'MOBILE_LARGE': return '414px';
      case 'TABLET': return '768px';
      case 'DESKTOP': return '1200px';
      case 'FULL': return '100%';
    }
  };

  const parseTimeToMinutes = (t: string) => {
    if (!t) return 0;
    const [hh, mm] = t.split(':').map(Number);
    return (hh - TIME_START) * 60 + mm;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* 🚀 TOP SIMULATOR CONTROLS BAR */}
      <header className="bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 shrink-0 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-indigo-500 to-emerald-400 text-white shadow-lg shadow-indigo-500/20">
              <Sparkles size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-white text-base tracking-tight">DEMO: Responsive Mobile Lịch Trực Quan</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Live Preview
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Mô phỏng trải nghiệm trên các kích thước màn hình điện thoại & máy tính bảng
              </p>
            </div>
          </div>

          {/* DEVICE PICKER BUTTONS */}
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-2xl p-1 gap-1">
            <button
              onClick={() => setDeviceMode('MOBILE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                deviceMode === 'MOBILE'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Smartphone size={14} /> Mobile (375px)
            </button>
            <button
              onClick={() => setDeviceMode('MOBILE_LARGE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                deviceMode === 'MOBILE_LARGE'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Smartphone size={14} /> Mobile Lớn (414px)
            </button>
            <button
              onClick={() => setDeviceMode('TABLET')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                deviceMode === 'TABLET'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Tablet size={14} /> Tablet (768px)
            </button>
            <button
              onClick={() => setDeviceMode('DESKTOP')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                deviceMode === 'DESKTOP'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Monitor size={14} /> Desktop (1200px)
            </button>
            <button
              onClick={() => setDeviceMode('FULL')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                deviceMode === 'FULL'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Toàn Màn Hình
            </button>
          </div>
        </div>
      </header>

      {/* HIGHLIGHTED BANNER: CẢI TIẾN TRỌNG TÂM */}
      <div className="bg-slate-950/60 border-b border-slate-800/80 px-4 py-2.5 text-xs text-slate-300">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-bold text-white">Điểm cải tiến trên Mobile:</span>
            <span>1. Thẻ Tab chuyển nhanh <b>Lưới Giờ ⏱</b> và <b>Khách Hẹn 📋 ({MOCK_PRE_BOOKINGS.length})</b></span>
            <span className="text-slate-500">|</span>
            <span>2. Nút nhanh <b>Hẹn</b> ngay trên thanh tiêu đề</span>
            <span className="text-slate-500">|</span>
            <span>3. Form Thêm Khách Hẹn cuộn mượt không bị che nút Lưu</span>
            <span className="text-slate-500">|</span>
            <span>4. Giữ nguyên 100% bố cục Desktop</span>
          </div>
          <div className="text-[11px] text-amber-400 font-medium">
            💡 Bấm thử các nút Tab, Thêm Hẹn, xem Thẻ trên điện thoại mô phỏng bên dưới
          </div>
        </div>
      </div>

      {/* 📱 SIMULATOR VIEWPORT WRAPPER */}
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950">
        <div 
          className="transition-all duration-300 bg-white text-gray-900 shadow-2xl rounded-3xl overflow-hidden border border-slate-700/60 flex flex-col relative"
          style={{
            width: getDeviceWidth(),
            height: deviceMode === 'FULL' ? 'calc(100vh - 140px)' : '780px',
            maxHeight: 'calc(100vh - 130px)',
          }}
        >
          {/* ========================================================= */}
          {/* 🌟 START: SCHEDULE BOARD RESPONSIVE COMPONENT 🌟           */}
          {/* ========================================================= */}
          <div className={`w-full h-full flex ${isMobile ? 'flex-col' : 'flex-row'} bg-gray-50 overflow-hidden relative`}>
            
            {/* CỘT CHÍNH: LƯỚI GIỜ (TIMELINE) HOẶC TAB MOBILE */}
            <div className={`flex-1 flex flex-col bg-white overflow-hidden relative z-10 border-r border-gray-200 ${
              isMobile && activeMobileTab === 'PREBOOKINGS' ? 'hidden' : 'flex'
            }`}>
              
              {/* HEADER TỔNG RESPONSIVE */}
              <div className="px-3 sm:px-5 py-3 border-b border-gray-200 bg-gray-50 flex flex-col gap-2 shrink-0">
                {/* DÒNG 1: TIÊU ĐỀ + CHỌN NGÀY + NÚT THÊM HẸN NHANH */}
                <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={22} strokeWidth={2.5} className="text-indigo-600 shrink-0" />
                    <div>
                      <h2 className="text-base sm:text-xl font-black text-gray-900 tracking-tight leading-none">
                        Lịch Trực Quan
                      </h2>
                      <p className="hidden sm:block text-[11px] font-bold text-gray-500 mt-0.5">
                        Khung giờ & phân bổ kỹ thuật viên
                      </p>
                    </div>
                  </div>

                  {/* NÚT THÊM HẸN NHANH TRÊN MOBILE */}
                  <div className="flex items-center gap-1.5">
                    {isMobile && (
                      <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-sm shadow-emerald-200 transition-colors"
                      >
                        <Plus size={14} strokeWidth={3} />
                        <span>Hẹn</span>
                      </button>
                    )}

                    {/* Chú thích màu sắc (Desktop) */}
                    {!isMobile && (
                      <div className="flex items-center gap-3 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-sm text-xs font-bold text-gray-600">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 border border-emerald-500"></span>
                          <span>Khách hẹn</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 border border-red-600"></span>
                          <span>Khách VIP</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-500"></span>
                          <span>Web mới</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-blue-400 border border-blue-500"></span>
                          <span>Khách đã xác nhận</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* DÒNG 2: THANH ĐIỀU HƯỚNG NGÀY & NÚT NGÀY/TUẦN */}
                <div className="flex items-center justify-between gap-2">
                  {/* Bộ chọn Ngày (‹ Hôm nay ›) */}
                  <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-1 py-1 shadow-sm">
                    <button 
                      onClick={() => {
                        const d = new Date(viewDate);
                        d.setDate(d.getDate() - 1);
                        setViewDate(d.toISOString().split('T')[0]);
                      }} 
                      className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center font-black text-gray-600 text-sm"
                    >
                      ‹
                    </button>
                    <label className="relative px-2 h-7 rounded-lg text-xs font-black text-gray-800 hover:bg-gray-100 flex items-center justify-center cursor-pointer">
                      {viewDate === '2026-10-07' ? 'Hôm nay' : viewDate}
                      <input 
                        type="date" 
                        value={viewDate} 
                        onChange={e => e.target.value && setViewDate(e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer" 
                      />
                    </label>
                    <button 
                      onClick={() => {
                        const d = new Date(viewDate);
                        d.setDate(d.getDate() + 1);
                        setViewDate(d.toISOString().split('T')[0]);
                      }} 
                      className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center font-black text-gray-600 text-sm"
                    >
                      ›
                    </button>
                    {viewDate !== '2026-10-07' && (
                      <button 
                        onClick={() => setViewDate('2026-10-07')} 
                        className="px-1.5 h-7 rounded-lg text-[10px] font-bold text-indigo-600 hover:bg-indigo-50"
                      >
                        Hôm nay
                      </button>
                    )}
                  </div>

                  {/* Chế độ Ngày / Tuần */}
                  <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
                    <button 
                      onClick={() => setViewMode('day')}
                      className={`px-2.5 h-7 rounded-lg text-xs font-black transition-colors ${
                        viewMode === 'day' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      Ngày
                    </button>
                    <button 
                      onClick={() => setViewMode('week')}
                      className={`px-2.5 h-7 rounded-lg text-xs font-black transition-colors ${
                        viewMode === 'week' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      Tuần
                    </button>
                  </div>
                </div>

                {/* 🏷️ CHÚ THÍCH MÀU SẮC TRÊN MOBILE */}
                {isMobile && (
                  <div className="flex items-center justify-between gap-1 bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 shadow-sm text-[10px] font-bold text-gray-600 overflow-x-auto no-scrollbar">
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 border border-emerald-500"></span>
                      <span>Khách hẹn</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-red-500 border border-red-600"></span>
                      <span>Khách VIP</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-amber-400 border border-amber-500"></span>
                      <span>Web mới</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-blue-400 border border-blue-500"></span>
                      <span>Khách đã xác nhận</span>
                    </div>
                  </div>
                )}

                {/* 📱 TAB SWITCHER RIÊNG CHO MOBILE */}
                {isMobile && (
                  <div className="flex items-center bg-gray-200/80 p-1 rounded-2xl gap-1 mt-1">
                    <button
                      onClick={() => setActiveMobileTab('TIMELINE')}
                      className={`flex-1 py-1.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                        activeMobileTab === 'TIMELINE'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <Clock size={14} />
                      <span>Lưới Giờ</span>
                    </button>
                    <button
                      onClick={() => setActiveMobileTab('PREBOOKINGS')}
                      className={`flex-1 py-1.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                        activeMobileTab === 'PREBOOKINGS'
                          ? 'bg-white text-emerald-700 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <CalendarClock size={14} />
                      <span>Khách Hẹn</span>
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                        {MOCK_PRE_BOOKINGS.length}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* LƯỚI LỊCH (TIMELINE GRID) */}
              <div className="flex-1 flex overflow-hidden">
                {/* Trục Thời gian (Cố định bên trái) - Thu gọn 52px trên mobile */}
                <div className={`${isMobile ? 'w-[52px]' : 'w-[70px]'} shrink-0 border-r border-gray-200 bg-white flex flex-col z-20 shadow-[2px_0_10px_rgba(0,0,0,0.02)]`}>
                  <div className="h-12 border-b border-gray-200 bg-gray-50 shrink-0 flex items-center justify-center text-[10px] font-black text-gray-400 uppercase tracking-wider">
                    Giờ
                  </div>
                  <div className="flex-1 overflow-y-hidden relative" style={{ height: hours.length * ROW_HEIGHT }}>
                    {hours.map(h => (
                      <div 
                        key={h} 
                        className="absolute w-full flex justify-center text-[11px] sm:text-xs font-black text-gray-400 bg-white" 
                        style={{ top: (h - TIME_START) * ROW_HEIGHT, height: ROW_HEIGHT, borderBottom: '1px solid #f3f4f6' }}
                      >
                        <span className="mt-1">{String(h).padStart(2, '0')}:00</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Khu vực Cột KTV & Đơn Hàng (Cuộn ngang và dọc) */}
                <div className="flex-1 overflow-auto bg-slate-50/50 relative custom-scrollbar">
                  {/* Header Cột (KTV hoặc Ngày trong tuần) */}
                  <div className="flex sticky top-0 z-30 bg-gray-50 border-b border-gray-200 w-max min-w-full shadow-sm">
                    {columns.map(col => (
                      <div 
                        key={col.id}
                        className={`${isMobile ? 'w-[160px]' : 'w-[220px]'} h-12 shrink-0 flex items-center justify-center border-r border-gray-200 p-2 ${
                          (col as any).isSpecial ? 'bg-amber-50 text-amber-900 border-b-2 border-b-amber-400' : 'text-gray-700'
                        }`}
                      >
                        <span className="text-xs sm:text-sm font-black truncate">{col.name}</span>
                      </div>
                    ))}
                  </div>

                  {/* Thân lưới giờ */}
                  <div className="relative w-max min-w-full" style={{ height: hours.length * ROW_HEIGHT }}>
                    {/* Các đường lưới ngang */}
                    <div className="absolute inset-0 pointer-events-none flex flex-col">
                      {hours.map(h => (
                        <div key={h} className="w-full border-b border-gray-200/60" style={{ height: ROW_HEIGHT }}></div>
                      ))}
                    </div>

                    {/* Các cột dọc chứa đơn hàng */}
                    <div className="absolute inset-0 flex">
                      {columns.map(col => {
                        const colOrders = MOCK_ORDERS.filter(o => o.technicianId === col.id);
                        return (
                          <div key={col.id} className={`${isMobile ? 'w-[160px]' : 'w-[220px]'} shrink-0 border-r border-gray-200/50 relative h-full`}>
                            {colOrders.map(order => {
                              const top = parseTimeToMinutes(order.startTime) * MINUTE_HEIGHT;
                              const height = Math.max(order.duration * MINUTE_HEIGHT, 48);

                              return (
                                <div
                                  key={order.id}
                                  onClick={() => setSelectedOrder(order)}
                                  className={`absolute left-1 right-1 rounded-xl p-2 cursor-pointer shadow-sm border transition-all hover:scale-[1.01] hover:shadow-md overflow-hidden ${
                                    order.source === 'VIP_BOOKING'
                                      ? 'bg-red-500 text-white border-red-600'
                                      : order.source === 'WEB_BOOKING'
                                      ? 'bg-amber-500 text-white border-amber-600'
                                      : 'bg-indigo-600 text-white border-indigo-700'
                                  }`}
                                  style={{ top, height }}
                                >
                                  <div className="flex items-center justify-between text-[10px] font-bold opacity-90 mb-0.5">
                                    <span>{order.startTime} - {order.endTime}</span>
                                    {order.source === 'VIP_BOOKING' && <Crown size={12} className="text-amber-200" />}
                                  </div>
                                  <div className="font-black text-xs leading-tight truncate">
                                    {order.customerName}
                                  </div>
                                  <div className="text-[10px] font-medium opacity-85 truncate mt-0.5">
                                    {order.serviceName}
                                  </div>
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
            </div>

            {/* SIDEBAR: DANH SÁCH KHÁCH HẸN (PRE-BOOKINGS) */}
            <div className={`${isMobile ? 'w-full flex-1' : 'w-[340px]'} shrink-0 bg-white flex flex-col relative z-20 overflow-hidden ${
              isMobile && activeMobileTab === 'TIMELINE' ? 'hidden' : 'flex'
            }`}>
              
              {/* HEADER SIDEBAR */}
              <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <CalendarClock size={20} className="text-emerald-600" />
                  <div>
                    <h3 className="font-black text-gray-800 text-base sm:text-lg leading-tight">
                      Khách Hẹn Trước
                    </h3>
                    <p className="text-[11px] font-bold text-gray-500">
                      Hôm nay · 07/10
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full text-xs">
                    {MOCK_PRE_BOOKINGS.length} khách
                  </div>
                  {/* Nút quay lại lưới giờ trên mobile */}
                  {isMobile && (
                    <button
                      onClick={() => setActiveMobileTab('TIMELINE')}
                      className="p-1.5 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 text-xs font-bold flex items-center gap-1"
                    >
                      <Clock size={14} /> Lưới giờ
                    </button>
                  )}
                </div>
              </div>

              {/* DANH SÁCH THẺ KHÁCH HẸN */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-slate-50/50">
                {MOCK_PRE_BOOKINGS.map(pb => (
                  <div 
                    key={pb.id}
                    onClick={() => setSelectedPreBooking(pb)}
                    className="bg-white p-3 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer group hover:border-emerald-300"
                  >
                    <div className="flex justify-between items-start mb-1.5">
                      <div className="font-black text-gray-800 text-sm sm:text-base flex flex-col gap-0.5">
                        <span>{pb.customer_name}</span>
                        <div className="flex gap-1 flex-wrap">
                          {pb.isOldCustomer && (
                            <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase tracking-wider font-bold">
                              <UserCheck size={10} /> Khách cũ
                            </span>
                          )}
                          {pb.menu_type === 'vip' && (
                            <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase tracking-wider font-bold">
                              <Crown size={10} /> VIP
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
                        {pb.booking_time}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 text-xs text-gray-600 font-medium">
                      <div className="flex items-center gap-1.5">
                        <Phone size={13} className="text-gray-400" /> {pb.customer_phone}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Users size={13} className="text-gray-400" /> {pb.guest_count} khách
                      </div>
                      {pb.notes && (
                        <div className="flex items-center gap-1.5 text-gray-500 line-clamp-1">
                          <Info size={13} className="text-gray-400 shrink-0" /> {pb.notes}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600">
                        <ChevronRight size={12} /> Bấm xem chi tiết
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert(`Mở đơn cho khách: ${pb.customer_name}`);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black transition-colors"
                      >
                        <ExternalLink size={12} /> Mở đơn
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* NÚT THÊM KHÁCH HẸN Ở CUỐI SIDEBAR */}
              <div className="p-3 sm:p-4 border-t border-gray-200 bg-white shrink-0">
                <button 
                  onClick={() => setIsAddModalOpen(true)}
                  className="w-full py-2.5 sm:py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-colors shadow-sm shadow-emerald-200"
                >
                  <Plus size={16} strokeWidth={3} /> Thêm khách hẹn mới
                </button>
              </div>
            </div>

            {/* ========================================================= */}
            {/* 📋 MODAL THÊM KHÁCH HẸN: TỐI ƯU RESPONSIVE MOBILE         */}
            {/* ========================================================= */}
            <AnimatePresence>
              {isAddModalOpen && (
                <div 
                  className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" 
                  onClick={() => setIsAddModalOpen(false)}
                >
                  <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 40 }}
                    onClick={e => e.stopPropagation()}
                    className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-gray-100 w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
                  >
                    {/* HEADER MODAL */}
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/80 shrink-0">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                          <CalendarClock size={20} />
                        </div>
                        <div>
                          <h3 className="font-black text-gray-900 text-base sm:text-lg leading-tight">
                            Thêm Khách Hẹn Trước
                          </h3>
                          <p className="text-[11px] font-bold text-gray-500">
                            Đặt chỗ qua điện thoại hoặc fanpage
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setIsAddModalOpen(false)} 
                        className="p-1.5 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {/* BODY MODAL: CUỘN MƯỢT TRÊN MÀN HÌNH NHỎ */}
                    <div className="p-4 space-y-3.5 overflow-y-auto flex-1 custom-scrollbar text-gray-800">
                      <div>
                        <label className="block text-xs font-black text-gray-700 mb-1">Tên khách hàng *</label>
                        <input
                          type="text"
                          placeholder="Ví dụ: Chị Lan, Anh Tuấn..."
                          value={newPbName}
                          onChange={e => setNewPbName(e.target.value)}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">Số điện thoại *</label>
                          <input
                            type="tel"
                            placeholder="0901234567"
                            value={newPbPhone}
                            onChange={e => setNewPbPhone(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">Số lượng khách</label>
                          <input
                            type="number"
                            min="1"
                            value={newPbGuests}
                            onChange={e => setNewPbGuests(Number(e.target.value))}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">Giờ hẹn</label>
                          <input
                            type="time"
                            value={newPbTime}
                            onChange={e => setNewPbTime(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-black text-gray-700 mb-1">Loại Menu</label>
                          <select className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            <option value="standard">Tiêu chuẩn</option>
                            <option value="vip">Phòng VIP</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-gray-700 mb-1">Ghi chú đặc biệt</label>
                        <textarea
                          rows={2}
                          placeholder="Yêu cầu KTV, dị ứng tinh dầu, phòng yên tĩnh..."
                          value={newPbNotes}
                          onChange={e => setNewPbNotes(e.target.value)}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    {/* FOOTER MODAL: DÍNH DƯỚI ĐÁY KHÔNG BỊ TRÔI KHỎI MÀN HÌNH */}
                    <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2 shrink-0">
                      <button
                        onClick={() => setIsAddModalOpen(false)}
                        className="px-4 py-2 rounded-xl text-xs font-black text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        HỦY BỎ
                      </button>
                      <button
                        onClick={() => {
                          alert('Đã lưu lịch hẹn thành công (Mô phỏng)!');
                          setIsAddModalOpen(false);
                        }}
                        className="px-5 py-2.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-200 transition-colors"
                      >
                        LƯU LỊCH HẸN
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* ========================================================= */}
            {/* 🔍 MODAL CHI TIẾT ĐƠN HÀNG                                 */}
            {/* ========================================================= */}
            <AnimatePresence>
              {selectedOrder && (
                <div 
                  className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" 
                  onClick={() => setSelectedOrder(null)}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={e => e.stopPropagation()}
                    className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-sm w-full overflow-hidden text-gray-800"
                  >
                    <div className={`p-4 text-white ${
                      selectedOrder.source === 'VIP_BOOKING' ? 'bg-red-600' : 'bg-indigo-600'
                    }`}>
                      <div className="flex justify-between items-start mb-1">
                        <h3 className="text-lg font-black">{selectedOrder.customerName}</h3>
                        <button onClick={() => setSelectedOrder(null)} className="p-1 hover:bg-white/20 rounded-full transition-colors text-white">
                          <X size={18} />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-bold opacity-90">
                        <Phone size={13} /> {selectedOrder.customerPhone}
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Dịch vụ</div>
                        <div className="text-gray-900 font-bold text-sm">{selectedOrder.serviceName}</div>
                        <div className="mt-1 text-indigo-600 font-black flex items-center gap-1 text-xs">
                          <Clock size={13} /> {selectedOrder.startTime} - {selectedOrder.endTime} ({selectedOrder.duration} phút)
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-0.5">Kỹ thuật viên</div>
                        <div className="text-gray-900 font-bold text-sm flex items-center gap-1.5">
                          <User size={14} className="text-gray-400" /> {selectedOrder.technicianName}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

          </div>
          {/* ========================================================= */}
          {/* 🌟 END: SCHEDULE BOARD RESPONSIVE COMPONENT 🌟             */}
          {/* ========================================================= */}

        </div>
      </div>
    </div>
  );
}
