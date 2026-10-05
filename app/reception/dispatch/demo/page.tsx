'use client';

import React, { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { 
  Users, Bell, Calendar as CalendarIcon, Plus, ChevronDown, 
  LayoutList, Columns3, Star, BedDouble, Globe, CalendarClock,
  Smartphone, Tablet, Monitor, CheckCircle2, Info, ArrowRight,
  ShieldCheck, Check, History, Clock, X, Search, ArrowRightCircle,
  PenLine, Phone, Mail, Stethoscope, Crown, Layers, Scissors, ShieldAlert, UserPlus, UserCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Dữ liệu mẫu kiểm thử cho Lịch sử thay đổi đơn (DispatchEditHistory Demo)
const mockHistoryEntries = [
  {
    serviceId: 'svc-01',
    serviceName: 'Massage Body Trị Liệu 90p',
    revision: 1,
    at: '2026-10-05T08:30:00+07:00',
    actor: { id: 'LETAN-01', name: 'Quầy Lễ Tân (Trần Mai)' },
    action: 'DRAFT',
    changes: [
      { field: 'startTime', before: null, after: '08:45' },
      { field: 'duration', before: null, after: 60 },
      { field: 'ktvId', before: null, after: 'T012 - Thu Thảo', employeeId: 'T012' }
    ]
  },
  {
    serviceId: 'svc-01',
    serviceName: 'Massage Body Trị Liệu 90p',
    revision: 2,
    at: '2026-10-05T09:00:00+07:00',
    actor: { id: 'LETAN-01', name: 'Quầy Lễ Tân (Trần Mai)' },
    action: 'ENABLE_SEQUENTIAL',
    changes: [
      { field: 'sequenceSlot', before: 'Đơn song song', after: 'Lượt A + B nối tiếp' }
    ]
  },
  {
    serviceId: 'svc-01',
    serviceName: 'Massage Body Trị Liệu 90p',
    revision: 3,
    at: '2026-10-05T09:20:00+07:00',
    actor: { id: 'LETAN-01', name: 'Quầy Lễ Tân (Trần Mai)' },
    action: 'ASSIGN_B',
    changes: [
      { field: 'ktvId', before: 'Chưa chọn', after: 'T025 - Hoàng Nam', employeeId: 'T025' },
      { field: 'startTime', before: '08:45', after: '09:45', employeeId: 'T025' },
      { field: 'duration', before: null, after: 30, employeeId: 'T025' },
      { field: 'serviceNameForKtv', before: 'Mặc định gói', after: 'Gội Đầu Dưỡng Sinh Nối Tiếp', employeeId: 'T025' }
    ]
  },
  {
    serviceId: 'svc-01',
    serviceName: 'Massage Body Trị Liệu 90p',
    revision: 4,
    at: '2026-10-05T09:50:00+07:00',
    actor: { id: 'ADMIN-01', name: 'Quản Lý (Nguyễn An)' },
    action: 'EDIT_ACTUAL_TIME',
    changes: [
      { field: 'actualStartTime', before: '08:45', after: '08:52', employeeId: 'T012' },
      { field: 'actualEndTime', before: '09:45', after: '09:52', employeeId: 'T012' }
    ]
  }
];

const fieldLabels: Record<string, string> = {
  startTime: 'Giờ bắt đầu', endTime: 'Giờ kết thúc', duration: 'Số phút',
  plannedStartAt: 'Bắt đầu dự kiến', plannedEndAt: 'Kết thúc dự kiến', actualStartTime: 'Bắt đầu thực tế',
  actualEndTime: 'Kết thúc thực tế', serviceNameForKtv: 'Tên DV riêng', displayName: 'Tên DV chung',
  ktvId: 'Nhân viên', sequenceSlot: 'Lượt nối tiếp', voided: 'Hủy lượt'
};

const actionLabels: Record<string, string> = {
  DRAFT: 'Lưu nháp', DISPATCH: 'Điều phối', ASSIGN_B: 'Gán KTV làm tiếp',
  EDIT_ACTUAL_TIME: 'Sửa giờ thực tế', ENABLE_SEQUENTIAL: 'Thêm làm tiếp',
  FINISH_AFTER_A: 'Hoàn thành lượt đầu', UPDATE: 'Cập nhật'
};

const actionBadgeStyles: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  DISPATCH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ASSIGN_B: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  EDIT_ACTUAL_TIME: 'bg-amber-50 text-amber-700 border-amber-200',
  ENABLE_SEQUENTIAL: 'bg-blue-50 text-blue-700 border-blue-200',
  FINISH_AFTER_A: 'bg-teal-50 text-teal-700 border-teal-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
};

const formatValue = (val: unknown) => {
  if (val === null || val === undefined || val === '') return 'Trống';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val) && Number.isFinite(Date.parse(val)))
    return new Date(val).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return String(val);
};

export default function ReceptionDispatchDemoPage() {
  // Top-level Mode: 'HEADER_MODES' | 'HISTORY_AND_SEQUENTIAL' | 'CUSTOMER_AND_TOOLBAR'
  const [activeDemoTab, setActiveDemoTab] = useState<'CUSTOMER_AND_TOOLBAR' | 'HISTORY_AND_SEQUENTIAL' | 'HEADER_MODES'>('CUSTOMER_AND_TOOLBAR');

  // Option selection cho Header: 'PA1' (2 tầng responsive) vs 'PA2' (Header Bar cố định trên cùng)
  const [option, setOption] = useState<'PA1' | 'PA2'>('PA2');

  // Device simulation: 'FULL' | 'MOBILE' (375px) | 'TABLET' (768px) | 'DESKTOP' (1200px)
  const [deviceMode, setDeviceMode] = useState<'FULL' | 'MOBILE' | 'TABLET' | 'DESKTOP'>('MOBILE');

  // Interactive UI states cho Header Demo
  const [hasGuestLock, setHasGuestLock] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedDate, setSelectedDate] = useState('2026-10-05');

  // Interactive states cho Customer Info & 3 Nút Gộp Mobile
  const [selectedDemoGroupKeys, setSelectedDemoGroupKeys] = useState<string[]>(['svc-1', 'svc-2']);
  const [isEditingDemoGuest, setIsEditingDemoGuest] = useState(false);
  const [demoGuestGender, setDemoGuestGender] = useState('male');
  const [demoGuestNationality, setDemoGuestNationality] = useState('Việt Nam');
  const [demoGuestCount, setDemoGuestCount] = useState(2);
  const [demoActionFeedback, setDemoActionFeedback] = useState<string | null>(null);

  // Interactive states cho Khung Nối Tiếp Động (Sequential Slot Demo)
  const [selectedSlotMode, setSelectedSlotMode] = useState<'SLOT_B' | 'SLOT_C' | 'SLOT_NUMERIC'>('SLOT_B');
  const [ktvSearchText, setKtvSearchText] = useState('');
  const [pickedKtv, setPickedKtv] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Tính toán dynamic nhãn lượt (Không cố định chữ 'B')
  const dynamicSlotConfig = {
    SLOT_B: {
      slotLabel: 'B',
      slotTitle: 'Thêm nhân viên B',
      prevKtv: 'T012 - Thu Thảo (Lượt A)',
      prevEndTime: '09:45',
      remainingMin: 30,
      roomInfo: 'VIP 01 · Giường G.1',
      badgeColor: 'bg-purple-600 text-white',
      borderAccent: 'border-purple-300 bg-purple-50/30'
    },
    SLOT_C: {
      slotLabel: 'C',
      slotTitle: 'Thêm nhân viên C',
      prevKtv: 'T025 - Hoàng Nam (Lượt B)',
      prevEndTime: '10:15',
      remainingMin: 20,
      roomInfo: 'VIP 01 · Giường G.1',
      badgeColor: 'bg-indigo-600 text-white',
      borderAccent: 'border-indigo-300 bg-indigo-50/30'
    },
    SLOT_NUMERIC: {
      slotLabel: '2',
      slotTitle: 'Thêm nhân viên 2',
      prevKtv: 'T012 - Thu Thảo (Lượt 1)',
      prevEndTime: '10:00',
      remainingMin: 45,
      roomInfo: 'Phòng Trệt · Giường G.2',
      badgeColor: 'bg-emerald-600 text-white',
      borderAccent: 'border-emerald-300 bg-emerald-50/30'
    }
  }[selectedSlotMode];

  const toggleGuestArrivalLock = () => setHasGuestLock(prev => !prev);

  // Render Guest Lock Button
  const renderGuestLockButton = (isCompact = false) => (
    <button
      onClick={toggleGuestArrivalLock}
      aria-label="Báo Khách"
      className={`relative h-10 sm:h-11 px-3 sm:px-3.5 rounded-xl sm:rounded-2xl transition-all shadow-sm border flex items-center gap-1.5 sm:gap-2 font-black text-xs cursor-pointer shrink-0 active:scale-95 ${
        hasGuestLock
          ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600 shadow-md shadow-amber-500/30 animate-pulse'
          : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
      }`}
      title={hasGuestLock ? 'Đang báo có khách. Bấm để tắt.' : 'Bấm để báo có khách mới vào quầy'}
    >
      <Users size={16} className="shrink-0" />
      <span className="whitespace-nowrap">
        {hasGuestLock ? (isCompact ? 'Đang Khách' : 'Đang Có Khách') : 'Có Khách'}
      </span>
      {hasGuestLock && (
        <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
      )}
    </button>
  );

  // Render Sound/Bell Button
  const renderSoundButton = () => (
    <button
      onClick={() => setSoundEnabled(prev => !prev)}
      className={`w-10 sm:w-11 h-10 sm:h-11 rounded-full transition-all shadow-sm border flex items-center justify-center shrink-0 active:scale-95 ${
        soundEnabled
          ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100'
          : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100'
      }`}
      title={soundEnabled ? 'Chuông đang bật' : 'Chuông đang tắt'}
    >
      <Bell size={18} className={soundEnabled ? 'text-emerald-600' : 'text-slate-400'} />
    </button>
  );

  return (
    <AppLayout title="Điều Phối (Demo Lịch Sử & Nối Tiếp Động)">
      <div className="space-y-6 pb-16">
        
        {/* TOP CONTROL PANEL */}
        <div className="bg-white rounded-3xl border border-indigo-100 shadow-sm p-4 sm:p-6 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-black uppercase tracking-wider mb-1.5">
                <LayoutList size={13} /> Sân Khảo Sát Demo Thực Tế
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                Demo UI Lịch Sử Sửa Đơn & Khung Nối Tiếp Động [ Lượt X ]
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                Xem thử giao diện và hành vi trước khi xác nhận cập nhật file ổn định.
              </p>
            </div>

            {/* DEMO TABS SWITCHER */}
            <div className="flex flex-wrap items-center gap-2 bg-slate-100 p-1.5 rounded-2xl self-start lg:self-center">
              <button
                onClick={() => setActiveDemoTab('CUSTOMER_AND_TOOLBAR')}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 ${
                  activeDemoTab === 'CUSTOMER_AND_TOOLBAR'
                    ? 'bg-white text-indigo-700 shadow-md shadow-indigo-100 border border-indigo-100'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Layers size={16} />
                Thông Tin Khách & 3 Nút Gộp Mobile
              </button>
              <button
                onClick={() => setActiveDemoTab('HISTORY_AND_SEQUENTIAL')}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 ${
                  activeDemoTab === 'HISTORY_AND_SEQUENTIAL'
                    ? 'bg-white text-indigo-700 shadow-md shadow-indigo-100 border border-indigo-100'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <History size={16} />
                Lịch Sử & Nối Tiếp Động
              </button>
              <button
                onClick={() => setActiveDemoTab('HEADER_MODES')}
                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 ${
                  activeDemoTab === 'HEADER_MODES'
                    ? 'bg-white text-indigo-700 shadow-md shadow-indigo-100 border border-indigo-100'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Users size={16} />
                Header Báo Khách (PA1 / PA2)
              </button>
            </div>
          </div>

          {/* VIEWPORT CONTROLS */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-bold text-gray-500 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <span>Mô phỏng kích thước:</span>
            </span>
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setDeviceMode('MOBILE')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 border transition-all ${
                  deviceMode === 'MOBILE'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Smartphone size={14} /> Điện thoại (390px)
              </button>
              <button
                onClick={() => setDeviceMode('TABLET')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 border transition-all ${
                  deviceMode === 'TABLET'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Tablet size={14} /> Tablet iPad (768px)
              </button>
              <button
                onClick={() => setDeviceMode('DESKTOP')}
                className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 border transition-all ${
                  deviceMode === 'DESKTOP'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Monitor size={14} /> Desktop (1200px)
              </button>
              <button
                onClick={() => setDeviceMode('FULL')}
                className={`px-3 py-1.5 rounded-xl font-bold border transition-all ${
                  deviceMode === 'FULL'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                Toàn màn hình
              </button>
            </div>
          </div>
        </div>

        {/* SIMULATED DEVICE FRAME */}
        <div className="flex justify-center transition-all duration-300">
          <div
            className={`w-full transition-all duration-300 bg-white border-2 border-slate-300/80 rounded-3xl shadow-2xl overflow-hidden ${
              deviceMode === 'MOBILE'
                ? 'max-w-[400px]'
                : deviceMode === 'TABLET'
                ? 'max-w-[768px]'
                : deviceMode === 'DESKTOP'
                ? 'max-w-[1200px]'
                : 'max-w-full'
            }`}
          >
            {/* STATUS BAR MÔ PHỎNG */}
            <div className="bg-slate-900 text-slate-300 px-4 py-2 text-[11px] font-mono flex items-center justify-between border-b border-slate-800">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Màn hình: {deviceMode === 'MOBILE' ? 'iPhone / Mobile 390px' : deviceMode === 'TABLET' ? 'iPad 768px' : deviceMode === 'DESKTOP' ? 'Desktop 1200px' : 'Trình duyệt gốc'}
              </span>
              <span className="text-amber-400 font-bold">
                {activeDemoTab === 'CUSTOMER_AND_TOOLBAR'
                  ? 'DEMO THÔNG TIN KHÁCH & 3 NÚT GỘP'
                  : activeDemoTab === 'HISTORY_AND_SEQUENTIAL'
                  ? 'DEMO LỊCH SỬ & NỐI TIẾP ĐỘNG'
                  : 'DEMO BÁO KHÁCH'}
              </span>
            </div>

            {/* CONTAINER NỘI DUNG */}
            <div className="p-3 sm:p-5 bg-slate-50 min-h-[550px] space-y-6">

              {/* ===================== TAB 0: CUSTOMER INFO & MERGE TOOLBAR (MOBILE OPTIMIZED) ===================== */}
              {activeDemoTab === 'CUSTOMER_AND_TOOLBAR' && (
                <div className="space-y-6">
                  
                  {/* PHẦN 1: CARD THÔNG TIN KHÁCH HÀNG */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <Users size={14} className="text-indigo-600" />
                        1. Card Thông Tin Khách Hàng (Đã Bỏ Hardcode, Tối Ưu Mobile)
                      </span>
                      <button
                        onClick={() => setIsEditingDemoGuest(!isEditingDemoGuest)}
                        className="px-2.5 py-1 rounded-xl text-xs font-bold border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 transition-colors flex items-center gap-1 shadow-xs"
                      >
                        <PenLine size={13} />
                        {isEditingDemoGuest ? 'Thoát Chế Độ Sửa' : 'Bật Thử Chế Độ Sửa'}
                      </button>
                    </div>

                    {/* KHỐI CARD THÔNG TIN KHÁCH THỰC TẾ */}
                    <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm p-3.5 sm:p-5 space-y-3">
                      
                      {/* DÒNG 1: MÃ ĐƠN, TÊN KHÁCH & HUY HIỆU DỊCH VỤ / NGUỒN ĐƠN */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse shrink-0" />
                          <h2 className="font-black text-slate-900 text-sm sm:text-base flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <span>Đơn 1004</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-indigo-950">Chị Nguyễn Mai Phương</span>
                          </h2>

                          {/* BADGES VIP & ĐIỀU TRỊ */}
                          <div className="flex items-center gap-1">
                            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-gradient-to-b from-[#ffe866] to-[#ffc800] text-[#6b3e00] border border-[#e6b400] shadow-xs flex items-center gap-1 text-[10px] font-black" title="Menu VIP">
                              <Crown size={11} className="fill-[#6b3e00]/20" />
                              <span className="hidden sm:inline">VIP</span>
                            </span>
                            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 border border-blue-200 shadow-xs flex items-center gap-1 text-[10px] font-black" title="Menu Điều Trị">
                              <Stethoscope size={11} />
                              <span className="hidden sm:inline">Điều Trị</span>
                            </span>
                          </div>
                        </div>

                        {/* CỤM TRẠNG THÁI & NGUỒN ĐƠN (BOOKING / WALK IN) */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wide">
                            Đang điều phối
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wide">
                            BOOKING 14:30
                          </span>
                        </div>
                      </div>

                      {/* DÒNG 2: THÔNG TIN LIÊN HỆ (GỌN GÀNG, KHÔNG DÍNH DÒNG BẰNG GẠCH NỐI THÔ) */}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100/80 border border-slate-200 text-slate-700 font-mono text-[11px] font-bold">
                          <Phone size={12} className="text-indigo-600" />
                          0908 123 456
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100/80 border border-slate-200 text-slate-700 text-[11px]">
                          <Mail size={12} className="text-indigo-600" />
                          maiphuong@techgalaxy.vn
                        </span>
                      </div>

                      {/* DÒNG 3: TOÀN BỘ THÔNG TIN KHÁCH (GIỚI TÍNH + QUỐC TỊCH + SỐ LƯỢNG KHÁCH + NÚT SỬA & HỒ SƠ CÙNG 1 HÀNG) */}
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        
                        {isEditingDemoGuest ? (
                          /* GIAO DIỆN CHỈNH SỬA: RESPONSIVE KHÔNG HARDCODE WIDTH */
                          <div className="flex flex-wrap items-center gap-2 w-full">
                            <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1.5">Phái</span>
                              <select
                                value={demoGuestGender}
                                onChange={(e) => setDemoGuestGender(e.target.value)}
                                className="bg-white px-2 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                              >
                                <option value="female">Nữ</option>
                                <option value="male">Nam</option>
                              </select>
                            </div>

                            <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider pl-1.5">Quốc tịch</span>
                              <select
                                value={demoGuestNationality}
                                onChange={(e) => setDemoGuestNationality(e.target.value)}
                                className="bg-white px-2 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 max-w-[130px]"
                              >
                                <option value="Việt Nam">Việt Nam</option>
                                <option value="Hàn Quốc">Hàn Quốc</option>
                                <option value="Nhật Bản">Nhật Bản</option>
                                <option value="Trung Quốc">Trung Quốc</option>
                                <option value="Đài Loan">Đài Loan</option>
                                <option value="Anh/Úc/Mỹ">Anh/Úc/Mỹ</option>
                                <option value="Khác">Khác</option>
                              </select>
                            </div>

                            <div className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-black text-indigo-700 select-none">
                              {demoGuestCount} KHÁCH
                            </div>

                            <button
                              type="button"
                              onClick={() => setIsEditingDemoGuest(false)}
                              className="p-1.5 px-2.5 hover:bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-300 transition-colors flex items-center gap-1 text-xs font-bold shadow-xs ml-auto"
                              title="Hoàn tất chỉnh sửa"
                            >
                              <Check size={14} />
                              <span>Xong</span>
                            </button>
                          </div>
                        ) : (
                          /* GIAO DIỆN XEM: TẤT CẢ VỪA VẶN 1 HÀNG DUY NHẤT TRÊN MOBILE, KHÔNG RỚT ICON LẺ */
                          <div className="flex items-center justify-between gap-2 w-full">
                            {/* CỤM BADGES THÔNG TIN KHÁCH (GỌN GÀNG, KHÔNG DÀI DÒNG) */}
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700">
                                {demoGuestGender === 'male' ? 'Nam' : 'Nữ'}
                              </span>

                              <span className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700">
                                {demoGuestNationality}
                              </span>

                              <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-black text-indigo-700">
                                {demoGuestCount} KHÁCH
                              </span>
                            </div>

                            {/* CỤM NÚT HÀNH ĐỘNG GỘP CHUNG 1 KHỐI: SỬA + HỒ SƠ KHÁCH */}
                            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50/80 p-0.5 shrink-0 shadow-2xs">
                              <button
                                onClick={() => setIsEditingDemoGuest(true)}
                                className="px-2 py-1 rounded-lg hover:bg-white text-slate-600 hover:text-indigo-600 transition-all flex items-center gap-1 text-xs font-bold"
                                title="Chỉnh sửa giới tính, quốc tịch"
                              >
                                <PenLine size={13} className="text-indigo-600" />
                                <span className="hidden sm:inline">Sửa</span>
                              </button>
                              <div className="w-px h-3.5 bg-slate-200" />
                              <button
                                onClick={() => alert('Mở popup xem hồ sơ khách hàng đầy đủ!')}
                                className="px-2 py-1 rounded-lg hover:bg-white text-slate-600 hover:text-indigo-600 transition-all flex items-center gap-1 text-xs font-bold"
                                title="Xem hồ sơ chi tiết khách hàng"
                              >
                                <Info size={13} className="text-indigo-600" />
                                <span className="hidden sm:inline">Hồ sơ</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>

                  {/* PHẦN 2: THANH CÔNG CỤ 3 NÚT GỘP (RESPONSIVE SUB-BOOKING TOOLBAR) */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <Layers size={14} className="text-indigo-600" />
                        2. Thanh Công Cụ 3 Nút Gộp (Tối Ưu Touch Mobile & Bố Cục 3 Cột)
                      </span>
                    </div>

                    {/* KHUNG THÔNG BÁO TƯƠNG TÁC THỬ NGHIỆM */}
                    {demoActionFeedback && (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-bold text-emerald-800 flex items-center justify-between animate-fadeIn">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={16} className="text-emerald-600" />
                          <span>{demoActionFeedback}</span>
                        </div>
                        <button
                          onClick={() => setDemoActionFeedback(null)}
                          className="text-emerald-600 hover:text-emerald-800"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}

                    {/* TOOLBAR RESPONSIVE THỰC TẾ */}
                    <div className="sticky top-0 z-20 px-3 sm:px-6 py-2.5 sm:py-3.5 bg-white/90 backdrop-blur-md border border-slate-200/90 rounded-2xl sm:rounded-3xl flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between shadow-sm">
                      
                      {/* VÙNG CHỌN TẤT CẢ & SỐ LƯỢNG ĐÃ CHỌN */}
                      <div className="flex items-center justify-between sm:justify-start gap-2">
                        <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                          <input
                            type="checkbox"
                            checked={selectedDemoGroupKeys.length === 3}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDemoGroupKeys(['svc-1', 'svc-2', 'svc-3']);
                              } else {
                                setSelectedDemoGroupKeys([]);
                              }
                            }}
                            className="w-4 h-4 sm:w-5 sm:h-5 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                            ĐÃ CHỌN ({selectedDemoGroupKeys.length}/3)
                          </span>
                        </label>

                        {/* Mobile quick helper */}
                        <span className="text-[10px] text-slate-400 font-bold sm:hidden">
                          {selectedDemoGroupKeys.length >= 2 ? 'Có thể gộp đơn' : 'Chọn >= 2 để gộp'}
                        </span>
                      </div>

                      {/* CỤM 3 NÚT HÀNH ĐỘNG GỘP/TÁCH: GRID 3 CỘT TRÊN MOBILE, HÀNG NGANG TRÊN DESKTOP */}
                      <div className="grid grid-cols-3 gap-1.5 sm:flex sm:items-center sm:gap-2">
                        
                        {/* NÚT 1: GỘP CHUNG KTV */}
                        <button
                          onClick={() => setDemoActionFeedback(`Đã bấm: GỘP CHUNG KTV cho ${selectedDemoGroupKeys.length} dịch vụ`)}
                          disabled={selectedDemoGroupKeys.length < 2}
                          className="flex items-center justify-center gap-1 sm:gap-1.5 bg-white border-2 border-indigo-200 text-indigo-700 px-2 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-black hover:bg-indigo-50 hover:border-indigo-300 transition-all shadow-xs active:scale-95 disabled:opacity-40 disabled:pointer-events-none min-h-[40px] text-center"
                          title="Gộp 2 hoặc nhiều dịch vụ thành 1 đơn con chung, DÙNG CHUNG KTV"
                        >
                          <Layers size={14} className="shrink-0 text-indigo-600" />
                          <span className="sm:hidden">Chung KTV</span>
                          <span className="hidden sm:inline">GỘP CHUNG KTV</span>
                        </button>

                        {/* NÚT 2: GỘP ĐƠN KHÁC KTV */}
                        <button
                          onClick={() => setDemoActionFeedback(`Đã bấm: GỘP ĐƠN KHÁC KTV cho ${selectedDemoGroupKeys.length} dịch vụ`)}
                          disabled={selectedDemoGroupKeys.length < 2}
                          className="flex items-center justify-center gap-1 sm:gap-1.5 bg-white border-2 border-emerald-200 text-emerald-700 px-2 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-black hover:bg-emerald-50 hover:border-emerald-300 transition-all shadow-xs active:scale-95 disabled:opacity-40 disabled:pointer-events-none min-h-[40px] text-center"
                          title="Gộp dịch vụ vào chung 1 Đơn Con (1 người khách) nhưng KHÁC KTV"
                        >
                          <Users size={14} className="shrink-0 text-emerald-600" />
                          <span className="sm:hidden">Khác KTV</span>
                          <span className="hidden sm:inline">GỘP ĐƠN KHÁC KTV</span>
                        </button>

                        {/* NÚT 3: TÁCH KHÁCH (HỦY GỘP) */}
                        <button
                          onClick={() => setDemoActionFeedback(`Đã bấm: TÁCH KHÁCH (HỦY GỘP) cho ${selectedDemoGroupKeys.length} dịch vụ`)}
                          disabled={selectedDemoGroupKeys.length < 1}
                          className="flex items-center justify-center gap-1 sm:gap-1.5 bg-white border-2 border-amber-200 text-amber-800 px-2 sm:px-3.5 py-2 rounded-xl text-[11px] sm:text-xs font-black hover:bg-amber-50 hover:border-amber-300 transition-all shadow-xs active:scale-95 disabled:opacity-40 disabled:pointer-events-none min-h-[40px] text-center"
                          title="Xé lẻ các dịch vụ đã gộp thành từng khách riêng biệt"
                        >
                          <Scissors size={14} className="shrink-0 text-amber-700" />
                          <span className="sm:hidden">Tách khách</span>
                          <span className="hidden sm:inline">TÁCH KHÁCH</span>
                        </button>

                      </div>

                    </div>

                    {/* DANH SÁCH DỊCH VỤ MÔ PHỎNG ĐỂ USER CHỌN THỬ */}
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-bold text-slate-500 uppercase px-1">
                        Tick chọn các dịch vụ dưới đây để thử kích hoạt 3 nút:
                      </div>

                      {[
                        { id: 'svc-1', name: 'Body Trị Liệu Cổ Vai Gáy (60p)', price: '450.000đ', ktv: 'KTV012 · Thúy Vy' },
                        { id: 'svc-2', name: 'Gội Đầu Dưỡng Sinh Thảo Dược (45p)', price: '250.000đ', ktv: 'KTV008 · Bảo Ngọc' },
                        { id: 'svc-3', name: 'Massage Chân Bấm Huyệt (45p)', price: '300.000đ', ktv: 'Chưa chỉ định KTV' },
                      ].map((item) => {
                        const isSelected = selectedDemoGroupKeys.includes(item.id);
                        return (
                          <div
                            key={item.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedDemoGroupKeys(selectedDemoGroupKeys.filter(k => k !== item.id));
                              } else {
                                setSelectedDemoGroupKeys([...selectedDemoGroupKeys, item.id]);
                              }
                            }}
                            className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                              isSelected
                                ? 'bg-indigo-50/70 border-indigo-300 shadow-xs'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}} // Đã xử lý ở thẻ cha
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                              <div className="min-w-0">
                                <div className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                                  {item.name}
                                </div>
                                <div className="text-[11px] text-slate-500 flex items-center gap-2">
                                  <span>{item.ktv}</span>
                                  <span>·</span>
                                  <span className="font-semibold text-indigo-600">{item.price}</span>
                                </div>
                              </div>
                            </div>

                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {isSelected ? 'Đang chọn' : 'Chưa chọn'}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                  </div>

                </div>
              )}

              {/* ===================== TAB 1: HISTORY & SEQUENTIAL DEMO ===================== */}
              {activeDemoTab === 'HISTORY_AND_SEQUENTIAL' && (
                <div className="space-y-6">

                  {/* KHỐI 1: DEMO LỊCH SỬ THAY ĐỔI ĐƠN */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <History size={14} className="text-indigo-600" />
                        1. Khung Lịch Sử Sửa Đơn (DispatchEditHistory)
                      </span>
                      <span className="text-[11px] font-bold text-slate-400">Click để đóng / mở</span>
                    </div>

                    {/* COMPONENT ACCORDION LỊCH SỬ THAY ĐỔI */}
                    <details open className="group rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 text-sm shadow-sm transition-all">
                      <summary className="flex cursor-pointer items-center justify-between font-bold text-slate-800 list-none select-none">
                        <div className="flex items-center gap-2">
                          <span className="text-xs sm:text-sm">Lịch sử sửa giờ / tên dịch vụ</span>
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-black text-indigo-700 border border-indigo-100">
                            {mockHistoryEntries.length}
                          </span>
                        </div>
                        <span className="text-slate-400 transition-transform duration-200 group-open:rotate-180 text-xs">
                          ▼
                        </span>
                      </summary>

                      <ol className="mt-3.5 space-y-2.5">
                        {mockHistoryEntries.map((entry, index) => {
                          const hasServiceNameChange = entry.changes.some(c => c.field === 'serviceNameForKtv' || c.field === 'displayName');
                          return (
                            <li 
                              key={index} 
                              className="rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 sm:p-3 space-y-2 hover:border-slate-200 transition-colors"
                            >
                              {/* Dòng Tiêu đề của Phiên sửa: Chỉ hiện tên DV khi CÓ THAY ĐỔI TÊN DV */}
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-black text-slate-700">
                                    Bản {entry.revision}
                                  </span>
                                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${actionBadgeStyles[entry.action] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                                    {actionLabels[entry.action] || entry.action}
                                  </span>
                                </div>
                                {hasServiceNameChange && (
                                  <span className="font-bold text-indigo-900 text-xs bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                                    Đổi tên: {entry.serviceName}
                                  </span>
                                )}
                              </div>

                              {/* Dòng Meta: Thời gian & Người sửa (Gọn gàng, không icon rườm rà) */}
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                <span>{new Date(entry.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
                                <span>·</span>
                                <span className="font-medium text-slate-700">{entry.actor?.name || entry.actor?.id}</span>
                              </div>

                              {/* Danh sách các trường đã sửa (Diff Trước ➔ Sau) */}
                              <ul className="mt-1 space-y-1.5">
                                {entry.changes.map((change, i) => (
                                  <li 
                                    key={i} 
                                    className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200/60 bg-white px-2.5 py-1.5 text-xs shadow-xs"
                                  >
                                    {(change as any).employeeId && (
                                      <strong className="text-slate-800 shrink-0 font-bold">
                                        {(change as any).employeeId} · 
                                      </strong>
                                    )}
                                    <span className="font-semibold text-slate-600 shrink-0">
                                      {fieldLabels[change.field] || change.field}:
                                    </span>
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 line-through shrink-0">
                                      {formatValue(change.before)}
                                    </span>
                                    <span className="text-slate-400 font-bold shrink-0">→</span>
                                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700 border border-indigo-100 shrink-0">
                                      {formatValue(change.after)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  </div>

                  {/* KHỐI 2: DEMO CARD THÊM NHÂN VIÊN LÀM TIẾP (BỎ HOÀN TOÀN CHỮ A, B, C) */}
                  <div className="space-y-3 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                        <Clock size={14} className="text-indigo-600" />
                        2. Card Thêm Nhân Viên Làm Tiếp (Tinh Gọn)
                      </span>
                    </div>

                    {/* CARD THÊM NHÂN VIÊN THỰC TẾ */}
                    <div className="rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/40 p-3.5 sm:p-4 space-y-3 transition-all">
                      
                      {/* HEADER CỦA CARD: THÊM NHÂN VIÊN & NÚT HỦY */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shadow-sm bg-indigo-600 text-white">
                            +
                          </span>
                          <span className="text-xs sm:text-sm font-black text-slate-800">
                            Thêm nhân viên làm tiếp
                          </span>
                        </div>

                        {/* NÚT HỦY LƯỢT NỐI TIẾP RÕ RÀNG */}
                        <button
                          type="button"
                          onClick={() => alert('Đã bấm hủy thêm nhân viên làm tiếp')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors active:scale-95"
                          title="Hủy thêm nhân viên này"
                        >
                          <X size={14} />
                          <span>Hủy</span>
                        </button>
                      </div>

                      {/* HƯỚNG DẪN GIỜ BẮT ĐẦU DỰ KIẾN & THÔNG TIN KẾ THỪA */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div className="bg-white/90 rounded-xl p-2.5 border border-indigo-100 shadow-2xs space-y-1">
                          <div className="flex items-center gap-1.5 text-indigo-800 font-bold">
                            <Clock size={14} className="text-indigo-600 shrink-0" />
                            <span>Bắt đầu dự kiến: <strong>09:45</strong></span>
                          </div>
                          <p className="text-[11px] text-slate-500 pl-5">
                            Sau khi nhân viên trước kết thúc · Còn <strong>30 phút</strong>.
                          </p>
                        </div>

                        <div className="bg-white/90 rounded-xl p-2.5 border border-indigo-100 shadow-2xs space-y-1">
                          <div className="flex items-center gap-1.5 text-slate-700 font-bold">
                            <span className="text-xs">📍</span>
                            <span>Kế thừa: <strong>VIP 01 · Giường G.1</strong></span>
                          </div>
                          <p className="text-[11px] text-slate-500 pl-5">
                            Cùng phòng & giường với nhân viên trước.
                          </p>
                        </div>
                      </div>

                      {/* Ô CHỌN KTV TƯƠNG TÁC (KtvPickerCombo Full Width trên Mobile) */}
                      <div className="relative">
                        <div 
                          onClick={() => setIsPickerOpen(prev => !prev)}
                          className={`w-full min-h-[42px] px-3 py-2 border rounded-xl bg-white flex items-center justify-between cursor-pointer transition-all shadow-xs ${
                            isPickerOpen ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-indigo-200 hover:border-indigo-300'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Search size={15} className="text-gray-400 shrink-0" />
                            {pickedKtv ? (
                              <span className="text-xs sm:text-sm font-black text-indigo-700 truncate">
                                {pickedKtv}
                              </span>
                            ) : (
                              <span className="text-xs sm:text-sm text-gray-400 italic truncate">
                                + Chọn nhân viên hoặc gõ tên KTV ngoài...
                              </span>
                            )}
                          </div>
                          <ChevronDown size={16} className={`text-gray-400 transition-transform ${isPickerOpen ? 'rotate-180' : ''}`} />
                        </div>

                        {/* MÔ PHỎNG DROPDOWN TÌM KTV CHỐNG TRÀN */}
                        {isPickerOpen && (
                          <div className="absolute z-50 mt-1 w-full max-w-[calc(100vw-2rem)] left-0 bg-white rounded-2xl border border-gray-100 shadow-2xl p-1.5 space-y-1">
                            <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-400">
                              Nhân Viên Rảnh Phù Hợp:
                            </div>
                            {[
                              { id: 'T021', name: 'Nguyễn Văn Nam', type: 'Ca chính', time: 'Rảnh', order: 1 },
                              { id: 'T027', name: 'Đặng Thị Lan', type: 'Tăng cường', time: 'Rảnh', order: 2 },
                              { id: 'T033', name: 'Trần Văn Bình', type: 'Theo giờ', time: 'Tan 22:00', order: 3 },
                            ].map(ktv => (
                              <div
                                key={ktv.id}
                                onClick={() => {
                                  setPickedKtv(`${ktv.id} - ${ktv.name}`);
                                  setIsPickerOpen(false);
                                }}
                                className="flex items-center justify-between p-2 rounded-xl hover:bg-indigo-50 cursor-pointer text-xs font-bold text-gray-700 transition-all"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-black text-slate-500">#{ktv.order}</span>
                                  <span>{ktv.id} - {ktv.name}</span>
                                  <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600">{ktv.type}</span>
                                </div>
                                <span className="text-[10px] text-emerald-600 font-semibold">{ktv.time}</span>
                              </div>
                            ))}
                            <div 
                              onClick={() => {
                                setPickedKtv(`KTV Ngoài: Chị Thuý (Tự do)`);
                                setIsPickerOpen(false);
                              }}
                              className="p-2 rounded-xl hover:bg-emerald-50 cursor-pointer text-xs font-bold text-emerald-700 flex items-center gap-2 border-t border-gray-100 mt-1"
                            >
                              <span>➕</span>
                              <span>Thêm KTV ngoài không tài khoản: <strong>Chị Thuý</strong></span>
                            </div>
                          </div>
                        )}
                      </div>

                      {pickedKtv && (
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xs text-emerald-700 font-bold flex items-center gap-1">
                            <CheckCircle2 size={14} />
                            Đã chọn: <strong>{pickedKtv}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => setPickedKtv(null)}
                            className="text-xs text-slate-400 hover:text-slate-600 underline"
                          >
                            Đổi KTV khác
                          </button>
                        </div>
                      )}

                    </div>
                  </div>

                </div>
              )}

              {/* ===================== TAB 2: HEADER MODES DEMO (PA1 / PA2) ===================== */}
              {activeDemoTab === 'HEADER_MODES' && (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm space-y-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center justify-between">
                      <span>Header Báo Khách & Tabs Điều Phối:</span>
                      <span className="text-gray-400">{option}</span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
                      {renderGuestLockButton(false)}
                      {renderSoundButton()}
                      <div className="text-xs font-bold text-slate-600">
                        {new Date(selectedDate).toLocaleDateString('vi-VN')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* BẢNG GIẢI THÍCH CHI TIẾT CÁC CẢI TIẾN */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-3xl border border-slate-200 bg-white shadow-sm space-y-2">
            <div className="flex items-center gap-2 text-indigo-700 font-black text-sm">
              <Layers size={18} />
              <span>Thông Tin Khách & 3 Nút Gộp</span>
            </div>
            <ul className="text-xs space-y-2 text-slate-600">
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Bỏ hardcode chiều rộng:</strong> Xóa bỏ hoàn toàn `w-20`, `w-32` và vạch chia cứng; form chỉnh sửa co giãn mượt trên mọi cỡ màn hình.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Pill badge gọn gàng:</strong> Số điện thoại, email, giới tính, quốc tịch tách thành từng chip riêng, không dính dòng bằng gạch nối thô `— ....`.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>3 nút gộp grid 3 cột mobile:</strong> Chiều cao tối thiểu 40px, nhãn ngắn gọn ("Chung KTV", "Khác KTV", "Tách khách"), icon Lucide chuẩn mực.</span>
              </li>
            </ul>
          </div>

          <div className="p-5 rounded-3xl border border-slate-200 bg-white shadow-sm space-y-2">
            <div className="flex items-center gap-2 text-indigo-700 font-black text-sm">
              <History size={18} />
              <span>Cải Tiến Lịch Sử Thay Đổi Đơn</span>
            </div>
            <ul className="text-xs space-y-2 text-slate-600">
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Accordion chuẩn touch:</strong> Đóng/mở êm ái với icon Chevron xoay, huy hiệu đếm số bản sửa rõ nét.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Badge phân loại hành động:</strong> Lưu nháp (Xám), Thêm nối tiếp (Indigo), Gán thợ B (Tím), Sửa giờ thực tế (Hổ phách).</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Thẻ Diff trực quan:</strong> Giá trị cũ (gạch ngang) ➔ Giá trị mới (nổi bật), không còn rớt dòng thô ráp.</span>
              </li>
            </ul>
          </div>

          <div className="p-5 rounded-3xl border border-slate-200 bg-white shadow-sm space-y-2">
            <div className="flex items-center gap-2 text-indigo-700 font-black text-sm">
              <Clock size={18} />
              <span>Cải Tiến Card Nối Tiếp Động [ Lượt X ]</span>
            </div>
            <ul className="text-xs space-y-2 text-slate-600">
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Nhãn động không cố định "B":</strong> Tự động tính toán theo số lượng KTV và loại đơn (Lượt B, Lượt C, hoặc Lượt 2, Lượt 3).</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Khung hướng dẫn giờ bắt đầu:</strong> Hiển thị rõ mốc giờ dự kiến sau khi KTV trước hoàn thành và thời lượng còn lại.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Dropdown an toàn chống tràn mép:</strong> Tối ưu toàn bộ chiều ngang cho mobile, hỗ trợ chọn KTV ngoài không tài khoản.</span>
              </li>
            </ul>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
