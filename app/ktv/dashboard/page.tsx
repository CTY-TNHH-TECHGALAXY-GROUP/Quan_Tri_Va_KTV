'use client';

import React, { useState, Suspense } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Clock, ShieldAlert, Calendar, AlertTriangle,
  CheckCircle, CheckCircle2, Play, StopCircle, Lock, Camera,
  Smile, Frown, Meh, Star, Gift, ArrowRight, X,
  ClipboardList, Coffee, LogOut, Sparkles, User, Users,
  PlusSquare, HelpCircle, Zap, Target, Ban, AlertCircle,
  Dumbbell, Quote, BookOpen, BellRing, QrCode,
  ChevronDown, ChevronUp, Heart, MicOff, Banknote, TrendingDown, TrendingUp, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useKTVDashboard } from './KTVDashboard.logic';
import { ROOM_ISSUE_OPTIONS } from './KTVDashboard.logic';
import { useNotifications } from '@/components/NotificationProvider';

// 🔧 UI CONFIGURATION
const THEME = {
  primary: 'bg-emerald-600',
  primaryHover: 'hover:bg-emerald-700',
  primaryMuted: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  gold: 'text-[#D4AF37]',
  goldBg: 'bg-gradient-to-r from-[#D4AF37] to-[#F3E5AB]',
  goldBorder: 'border-[#D4AF37]/30',
  bgCard: 'bg-white',
  bgBase: 'bg-[#FDFBF7]',
  radius: 'rounded-[32px]',
  border: 'border-slate-100',
  textBase: 'text-slate-800',
  textMuted: 'text-slate-400'
};

const ANIMATION = {
  duration: 0.4,
  initial: { opacity: 0, scale: 0.98, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 1.02, y: -10 }
};

// Fallback URL for QR
const DEFAULT_BOOKING_URL = 'https://nganha.vercel.app/';

// Helper format multi-service names
const formatMultiServiceNames = (segments: any[]) => {
    if (!segments || segments.length === 0) return '';
    if (segments.length === 1) return segments[0]?._serviceName || 'Dịch vụ';
    
    const groups = new Map<string, Set<string>>();
    
    segments.forEach(seg => {
        const roomName = seg.roomId || '';
        const serviceName = seg._serviceName || 'Dịch vụ';
        
        if (!groups.has(roomName)) {
            groups.set(roomName, new Set());
        }
        groups.get(roomName)!.add(serviceName.toUpperCase());
    });
    
    const parts: string[] = [];
    groups.forEach((serviceSet, roomName) => {
        const servicesStr = Array.from(serviceSet).join(' - ');
        parts.push(roomName ? `${servicesStr} ${roomName}` : servicesStr);
    });
    
    return parts.join(' + ');
};

// ─── WebBookingQR Component ─────────────────────────────────────────────────
const WebBookingQR = ({ url }: { url: string }) => {
  return (
    <Image
      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`}
      alt="Web Booking QR Code"
      width={160}
      height={160}
      className="rounded-2xl"
      referrerPolicy="no-referrer"
    />
  );
};

// ----------------------------------------------------
// MAIN COMPONENT
// ----------------------------------------------------

function KTVDashboardContent() {
  const searchParams = useSearchParams();
  const action = searchParams.get('action');
  const bookingId = searchParams.get('bookingId');
  const { setKtvScreen } = useNotifications();

  const logic = useKTVDashboard({ 
    initialAction: action, 
    targetBookingId: bookingId,
    testTechCode: searchParams.get('techCode')
  });

  const { 
    user, 
    booking, 
    isLoading, 
    screen,
    bonusMessage, 
    setBonusMessage, 
    showProcedure, 
    setShowProcedure,
    handleInteraction,
    handleEarlyExit
  } = logic;

  // 📡 Đồng bộ screen cho NotificationProvider để khóa bấm thông báo khi đang dọn phòng
  React.useEffect(() => {
    setKtvScreen(screen);
  }, [screen, setKtvScreen]);

  // Lấy tất cả dịch vụ mà KTV này được gán (hỗ trợ multi-item)
  const assignedItemIds: string[] = booking?.assignedItemIds?.length > 0
    ? booking.assignedItemIds
    : (booking?.assignedItemId ? [booking.assignedItemId] : []);
  const assignedItems = assignedItemIds.length > 0
    ? booking?.BookingItems?.filter((i: any) => assignedItemIds.includes(i.id)) || []
    : [booking?.BookingItems?.[0]].filter(Boolean);
  const assignedItem = assignedItems[0] || {};

  if (isLoading && !booking && screen === 'DASHBOARD') {
    return (
      <div className={`min-h-[80vh] flex flex-col items-center justify-center ${THEME.bgBase}`}>
        <div className="w-8 h-8 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin"></div>
        <p className="mt-4 text-emerald-700 font-medium">Đang tải dữ liệu ca làm việc...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <ShieldAlert size={48} className="text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
      </div>
    );
  }

  const renderScreen = () => {
    switch (screen) {
      case 'DASHBOARD': return <ScreenDashboard logic={logic} />;
      case 'TIMER': return <ScreenTimer logic={logic} />;
      case 'REVIEW': return <ScreenReview logic={logic} />;
      case 'HANDOVER': return <ScreenHandover logic={logic} />;
      case 'REWARD': return <ScreenReward logic={logic} />;
      default: return <ScreenDashboard logic={logic} />;
    }
  };

  return (
    <>
      {/* Main Content Area */}
      <div className="flex-1">
        {renderScreen()}
      </div>

      {/* Procedure Modal */}
      <ProcedureModal
        isOpen={showProcedure}
        onClose={() => setShowProcedure(false)}
        procedure={assignedItem?.service_description}
        serviceName={assignedItem?.service_name}
      />

      {/* Room Issue Report Modal */}
      <RoomIssueModal
        isOpen={logic.showRoomIssueModal}
        onClose={() => logic.setShowRoomIssueModal(false)}
        onSubmit={logic.handleReportRoomIssue}
        roomId={booking?.assignedRoomId || booking?.roomName || ''}
      />
    </>
  );
}

export default function KTVDashboardPage() {
  return (
    <AppLayout title="KTV Dashboard">
      <Suspense fallback={
        <div className={`min-h-[80vh] flex flex-col items-center justify-center bg-[#FDFBF7]`}>
          <div className="w-8 h-8 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin"></div>
          <p className="mt-4 text-emerald-700 font-medium">Đang chuẩn bị dữ liệu...</p>
        </div>
      }>
        <KTVDashboardContent />
      </Suspense>
    </AppLayout>
  );
}

// ─── WORKING TIMELINE ────────────────────────────────────────────────────────

function WorkingTimeline({ segments, activeIndex, actualStartTime, shouldMerge }: { segments: any[], activeIndex?: number, actualStartTime?: string | null, shouldMerge?: boolean }) {
  if (!segments || segments.length === 0) return null;

  let displaySegments = segments;
  if (shouldMerge && segments.length > 0) {
    const totalDuration = segments.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0);
    displaySegments = [{
      ...segments[0],
      id: 'merged-' + segments[0].id,
      duration: totalDuration
    }];
  }

  // Helper để tính giờ tịnh tiến
  const getShiftedTime = (offsetMins: number) => {
    if (!actualStartTime) return null;
    let tStart = actualStartTime;
    // Xử lý chuỗi HH:mm hoặc HH:mm:ss
    if (typeof tStart === 'string' && /^\d{1,2}:\d{2}/.test(tStart)) {
        const [h, m] = tStart.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m + offsetMins, 0, 0);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    if (typeof tStart === 'string' && !tStart.includes('Z') && !tStart.includes('+')) {
        tStart = tStart.replace(' ', 'T') + 'Z';
    }
    const date = new Date(new Date(tStart).getTime() + (offsetMins * 60 * 1000));
    if (isNaN(date.getTime())) return actualStartTime; // Fallback
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  let cumulativeMins = 0;

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 flex justify-between">
        <span>Lộ trình thực hiện</span>
        {activeIndex !== undefined && <span className="text-emerald-600">Chặng {activeIndex + 1}</span>}
      </h3>
      <div className="space-y-2">
        {displaySegments.map((seg, idx) => {
          const isActive = shouldMerge ? activeIndex !== undefined : idx === activeIndex;
          const isPast = shouldMerge ? false : (activeIndex !== undefined && idx < activeIndex);
          
          const displayStartTime = actualStartTime ? getShiftedTime(cumulativeMins) : seg.startTime;
          cumulativeMins += seg.duration;
          const displayEndTime = actualStartTime ? getShiftedTime(cumulativeMins) : seg.endTime;

          return (
            <motion.div 
              key={seg.id} 
              animate={{ 
                scale: isActive ? 1.02 : 1,
                opacity: isPast ? 0.6 : 1
              }}
              className={`relative flex items-center gap-4 p-3 rounded-2xl border transition-all ${
                isActive 
                  ? 'bg-emerald-50 border-emerald-200 shadow-md shadow-emerald-100/50' 
                  : 'bg-slate-50/50 border-slate-100/50'
              }`}
            >
              <div className="flex flex-col items-center w-10">
                <span className={`text-[10px] font-black ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>{displayStartTime}</span>
                <div className={`w-0.5 h-4 my-0.5 ${isActive ? 'bg-emerald-200' : 'bg-slate-200'}`} />
                <span className={`text-[10px] font-black ${isActive ? 'text-emerald-700' : 'text-slate-400'}`}>{displayEndTime}</span>
              </div>
              <div className="flex-1">
                <p className={`text-xs font-black ${isActive ? 'text-emerald-900' : 'text-slate-800'}`}>
                  Phòng {seg.roomId}
                  {isActive && <span className="ml-2 text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-md animate-pulse">ĐANG LÀM</span>}
                </p>
                <p className={`text-[10px] font-bold uppercase tracking-tighter ${isActive ? 'text-emerald-600/70' : 'text-slate-400'}`}>
                  Giường {seg.bedId?.split('-').pop()} • {seg.duration} phút {shouldMerge && '(Gộp)'}
                </p>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs transition-colors ${
                isActive 
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' 
                  : isPast ? 'bg-slate-200 text-slate-400' : 'bg-white text-slate-300 border border-slate-100'
              }`}>
                {isPast ? <CheckCircle size={14} /> : idx + 1}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// SCREENS
// ----------------------------------------------------

function ScreenDashboard({ logic }: { logic: any }) {
  const { booking, checklist, isChecklistComplete, handleConfirmSetup, setShowProcedure, activeSegmentIndex, prepProcedure, toggleChecklist, checkAllChecklist, setShowRoomIssueModal, walletBalance, canViewWallet, walletTimeline, onCallState, handleToggleOnCall } = logic;
  const [bookingUrl, setBookingUrl] = React.useState(DEFAULT_BOOKING_URL);
  const [showOnCallPopup, setShowOnCallPopup] = React.useState(false);
  const [tempMins, setTempMins] = React.useState(onCallState?.travel_time_mins || 30);

  React.useEffect(() => {
    if (onCallState) setTempMins(onCallState.travel_time_mins);
  }, [onCallState]);

  React.useEffect(() => {
    fetch('/api/system/config')
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.web_booking_url) {
          setBookingUrl(json.data.web_booking_url);
        }
      })
      .catch(() => { /* use fallback */ });
  }, []);

  // Lấy tất cả dịch vụ mà KTV này được gán (hỗ trợ multi-item)
  const allItemIds: string[] = booking?.assignedItemIds?.length > 0
    ? booking.assignedItemIds
    : (booking?.assignedItemId ? [booking.assignedItemId] : []);
  const allItems = allItemIds.length > 0
    ? booking?.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
    : [booking?.BookingItems?.[0]].filter(Boolean);
  const item = allItems[0] || {};
  
  // Tên tất cả DV
  const allServiceNames = allItems.map((i: any) => i.service_name).filter(Boolean);
  // Tổng thời gian các segments admin gán cho KTV
  const allKtvSegments = allItems.flatMap((i: any) => {
    let segs = [];
    if (typeof i?.segments === 'string') {
        try { segs = JSON.parse(i.segments); } catch (e) { segs = []; }
    } else if (Array.isArray(i?.segments)) {
        segs = i.segments;
    }
    return segs.filter((s: any) => s.ktvId?.toLowerCase() === logic.ktvId?.toLowerCase()).map((s: any) => ({ ...s, _itemId: i.id, _serviceName: i.service_name }));
  }).sort((a: any, b: any) => {
      const timeA = a.startTime || '23:59';
      const timeB = b.startTime || '23:59';
      return timeA.localeCompare(timeB);
  });
  const totalAssignedMins = allKtvSegments.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
  const ktvSegments = allKtvSegments;
  
  const uniqueItemIds = new Set(ktvSegments.map((s: any) => s._itemId));
  const shouldMerge = ktvSegments.length > 1 && uniqueItemIds.size === ktvSegments.length;
  
  // Xác định vị trí chặng hiện tại
  const currentSeg = ktvSegments.length > 0 ? ktvSegments[activeSegmentIndex || 0] : null;

  // Lấy danh sách đồng đội cùng làm CÙNG 1 DỊCH VỤ (chỉ từ item được gán cho KTV này)
  const assignedItem = booking?.assignedItemId
    ? booking.BookingItems?.find((bi: any) => bi.id === booking.assignedItemId)
    : null;
  const coWorkers = (assignedItem?.technicianCodes || []).filter((code: string) => code !== logic.ktvId);

  return (
    <div className="p-2 lg:p-4 space-y-4 lg:space-y-6">
      {/* Header - Only show when NO active booking - Hidden on Mobile */}
      {(!booking || !booking.id) && (
        <div className="hidden lg:flex items-center justify-between">
          <div>
            <h1 className={`text-xl font-bold ${THEME.textBase}`}>
              Xin chào, <span className="text-emerald-600 ml-1">{logic.ktvId || 'Kỹ thuật viên'}</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
             {onCallState?.allow_on_call && (
               <button
                 onClick={() => {
                   if (onCallState.is_on_call) {
                     handleToggleOnCall(false, onCallState.travel_time_mins);
                   } else {
                     setShowOnCallPopup(true);
                   }
                 }}
                 className={`flex items-center gap-2 px-4 py-2 rounded-2xl font-bold text-sm transition-all border shadow-sm ${
                   onCallState.is_on_call
                     ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                     : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                 }`}
               >
                 <div className={`w-2.5 h-2.5 rounded-full ${onCallState.is_on_call ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                 {onCallState.is_on_call ? 'Đang Sẵn Sàng (Ngoài giờ)' : 'Bật Nhận Đơn Ngoài Giờ'}
               </button>
             )}
            <div className={`w-10 h-10 ${THEME.primaryMuted} rounded-full flex items-center justify-center font-bold`}>
               <User size={20} />
            </div>
          </div>
        </div>
      )}

      {showOnCallPopup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[32px] w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="p-6">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-4">
                <Target size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">Xác nhận sẵn sàng</h3>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                Khi có khách đặt lịch, bạn cần bao nhiêu phút để di chuyển từ nhà đến Spa?
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                    Thời gian di chuyển (Phút)
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setTempMins(Math.max(15, tempMins - 15))}
                      className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold active:scale-95"
                    >
                      -15
                    </button>
                    <div className="flex-1 h-12 rounded-2xl border-2 border-emerald-100 flex items-center justify-center text-xl font-black text-emerald-700">
                      {tempMins}
                    </div>
                    <button
                      onClick={() => setTempMins(Math.min(120, tempMins + 15))}
                      className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold active:scale-95"
                    >
                      +15
                    </button>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowOnCallPopup(false)}
                    className="flex-1 py-3.5 rounded-2xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-transform"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={() => {
                      handleToggleOnCall(true, tempMins);
                      setShowOnCallPopup(false);
                    }}
                    className="flex-1 py-3.5 rounded-2xl bg-emerald-600 text-white font-bold active:scale-95 transition-transform shadow-lg shadow-emerald-200"
                  >
                    Bật Nhận Đơn
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {(!booking || !booking.id) ? (
        <div className="space-y-6">
          {canViewWallet && (
            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 rounded-[32px] shadow-lg text-white flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-emerald-100 flex items-center gap-2 uppercase tracking-widest text-xs mb-1">
                  <Zap size={16} className="text-amber-300 fill-amber-300" />
                  Ví Thu Nhập KTV
                </h3>
                <p className="text-xs text-emerald-100/80">Xem số dư, lịch sử giao dịch và rút tiền</p>
              </div>
              <Link href="/ktv/wallet" className="bg-white text-emerald-700 font-bold px-4 py-2.5 rounded-xl text-xs uppercase tracking-widest active:scale-95 transition-transform shadow-md flex items-center gap-2">
                Mở Ví <ArrowRight size={16} />
              </Link>
            </div>
          )}

          {/* Mobile On-Call Toggle */}
          {onCallState?.allow_on_call && (
            <div className="lg:hidden bg-white p-5 rounded-[32px] shadow-sm border border-emerald-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${onCallState.is_on_call ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                  <div className={`w-3.5 h-3.5 rounded-full ${onCallState.is_on_call ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-800 uppercase tracking-widest mb-1">Ngoài giờ</h3>
                  <p className="text-xs font-medium text-slate-500">{onCallState.is_on_call ? `Sẵn sàng (${onCallState.travel_time_mins}p)` : 'Đang tắt'}</p>
                </div>
              </div>
              <button
                onClick={() => {
                   if (onCallState.is_on_call) {
                     handleToggleOnCall(false, onCallState.travel_time_mins);
                   } else {
                     setShowOnCallPopup(true);
                   }
                }}
                className={`px-5 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all ${
                  onCallState.is_on_call 
                    ? 'bg-slate-100 text-slate-600 active:scale-95' 
                    : 'bg-emerald-600 text-white active:scale-95 shadow-md shadow-emerald-600/20'
                }`}
              >
                {onCallState.is_on_call ? 'Tắt' : 'Bật'}
              </button>
            </div>
          )}

          <div className={`${THEME.bgCard} ${THEME.border} ${THEME.radius} p-8 text-center border shadow-sm`}>
            {/* QR Code Section - Web Booking for Customers */}
            <div className="flex flex-col items-center mb-8">
               <div className="relative group mb-4">
                  <div className="absolute -inset-2 bg-emerald-50 rounded-[2rem] blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="relative p-3 bg-white rounded-[2rem] shadow-xl border border-emerald-100/50 transition-transform active:scale-95 duration-300">
                     <WebBookingQR url={bookingUrl} />
                  </div>
               </div>
               <div className="space-y-1 text-center flex flex-col items-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center justify-center gap-2">
                    <QrCode size={12} className="text-emerald-500" />
                    QR MENU KHÁCH HÀNG
                  </p>
                  <p className="text-[9px] text-slate-300 font-medium">Khách quét để xem menu & đặt lịch</p>
                  <a
                    href={bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:scale-95 rounded-xl text-xs font-black transition-all border border-emerald-100 shadow-sm"
                  >
                    Mở liên kết
                    <ArrowRight size={12} />
                  </a>
               </div>
            </div>

            <div className={`w-12 h-12 ${THEME.primaryMuted} rounded-full flex items-center justify-center mx-auto mb-4 opacity-50`}>
              <Clock size={20} className="text-emerald-600" />
            </div>
            <h3 className={`text-lg font-bold ${THEME.textBase} mb-2`}>
              {logic.booking?.nextBookingId ? 'Có đơn hàng chờ xác nhận' : 'Chưa có đơn hàng'}
            </h3>
            <p className={`text-sm ${THEME.textMuted}`}>
              {logic.booking?.nextBookingId 
                ? 'Vui lòng nhấn nút bên dưới để nhận đơn và xem thông tin chi tiết.'
                : 'Hệ thống sẽ thông báo ngay khi có khách hàng được xếp phòng.'}
            </p>
          </div>

          {/* Next Order Notification when Dashboard is empty */}
          {logic.booking?.nextBookingId && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="p-5 rounded-[28px] bg-emerald-50 border-2 border-emerald-200 shadow-xl shadow-emerald-100/50"
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 text-emerald-700">
                  <div className="w-10 h-10 bg-emerald-200 rounded-full flex items-center justify-center">
                    <BellRing size={20} className="animate-bounce" />
                  </div>
                  <div>
                    <p className="font-black text-sm uppercase tracking-tight">Đơn mới đã sẵn sàng!</p>
                    <p className="text-[11px] font-bold opacity-80">{logic.booking.nextServiceName || 'Dịch vụ'}{logic.booking.nextStartTime ? ` • ${logic.booking.nextStartTime}` : ''}</p>
                  </div>
                </div>
                <button
                  onClick={() => logic.goToDashboard(logic.booking.nextBookingId)}
                  className="w-full py-4 bg-emerald-600 text-white font-black rounded-2xl text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Play size={14} fill="white" />
                  Nhận ngay đơn tiếp theo
                </button>
              </div>
            </motion.div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Booking Card - ONLY SHOW ASSIGNED ITEM */}
          <div className={`${THEME.bgCard} ${THEME.border} ${THEME.radius} overflow-hidden border shadow-sm p-6 pb-0`}>
              <div className="mb-4">
                   <div className="flex flex-col">
                      <h3 className="font-black text-3xl text-emerald-700 leading-tight tracking-tight">
                        {allServiceNames.length > 1 ? formatMultiServiceNames(ktvSegments) : item.service_name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{totalAssignedMins || item.duration} phút</span>
                        {allServiceNames.length > 1 && <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-lg">{allServiceNames.length} DV</span>}
                        <span className="text-sm font-black text-slate-800">#{booking.billCode}</span>
                      </div>
                      {coWorkers.length > 0 && (
                        <p className="mt-2 text-[10px] font-bold text-indigo-500 uppercase tracking-tighter">Cùng làm với {coWorkers.join(', ')}</p>
                      )}
                   </div>
              </div>

              <div className="flex justify-between items-end mb-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 px-1">
                    {ktvSegments.length > 1 ? `Vị trí chặng ${activeSegmentIndex + 1}` : 'Vị trí'}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="bg-emerald-600 text-white px-4 py-2 rounded-2xl font-black text-lg shadow-lg shadow-emerald-100">
                      Phòng {currentSeg?.roomId || booking.assignedRoomId || booking.roomName}
                    </div>
                    {(currentSeg?.bedId || booking.assignedBedId || booking.bedId) && (
                      <div className="bg-white border-2 border-emerald-100 text-emerald-700 px-4 py-2 rounded-2xl font-black text-lg">
                        Giường {(currentSeg?.bedId || booking.assignedBedId || booking.bedId).split('-').pop()}
                      </div>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => setShowProcedure(true)}
                  className="text-emerald-600 text-xs font-bold flex items-center gap-1 underline mb-2"
                >
                   <ClipboardList size={14} /> Quy trình
                </button>
              </div>

              {/* Timeline Section */}
              {ktvSegments.length > 0 && (
                <div className="mb-6">
                  <WorkingTimeline 
                    segments={ktvSegments} 
                    activeIndex={booking.status === 'IN_PROGRESS' ? activeSegmentIndex : undefined}
                    actualStartTime={ktvSegments[0]?.actualStartTime || booking?.dispatchStartTime || booking?.timeStart || null}
                    shouldMerge={shouldMerge}
                  />
                </div>
              )}

              {/* Special Requirements (Same as Timer Screen) */}
              <CollapsibleRequirements booking={booking} />
          </div>

          {/* Setup Checklist */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className={`font-bold ${THEME.textBase} flex items-center gap-2 uppercase text-[11px] tracking-widest`}>
                <CheckCircle size={18} className={THEME.gold} />
                Quy trình chuẩn bị
              </h3>
              <button 
                 onClick={checkAllChecklist}
                 className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg active:scale-95 transition-all uppercase tracking-widest border border-emerald-100 shadow-sm"
              >
                 Chọn tất cả
              </button>
            </div>

            <div className="space-y-2">
              {prepProcedure.map((label: string, idx: number) => (
                <ChecklistItem key={idx} label={label} checked={checklist[idx] || false} onChange={() => toggleChecklist(idx)} />
              ))}
            </div>
          </div>

          {/* Room Issue Report Button */}
          <button
            onClick={() => setShowRoomIssueModal(true)}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/50 text-rose-600 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-rose-100/50"
          >
            <AlertTriangle size={16} />
            Báo sự cố phòng
          </button>

          <button
            disabled={!isChecklistComplete || logic.isLoading}
            onClick={handleConfirmSetup}
            className={`w-full py-4 ${THEME.radius} font-bold text-white transition-all 
              ${isChecklistComplete ? THEME.primary + ' shadow-lg shadow-emerald-200' : 'bg-slate-300'}`}
          >
            {logic.isLoading ? 'Đang xử lý...' : 'Xác nhận chuẩn bị xong'}
          </button>

          {/* Next Order Notification when prepping current one */}
          {logic.booking?.nextBookingId && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="p-5 rounded-[28px] bg-amber-50 border-2 border-amber-200 shadow-xl shadow-amber-100/50"
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 text-amber-700">
                  <div className="w-10 h-10 bg-amber-200 rounded-full flex items-center justify-center">
                    <BellRing size={20} className="animate-bounce" />
                  </div>
                  <div>
                    <p className="font-black text-sm uppercase tracking-tight">Đơn tiếp theo đã có!</p>
                    <p className="text-[11px] font-bold opacity-80">{logic.booking.nextServiceName || 'Dịch vụ'}{logic.booking.nextStartTime ? ` • ${logic.booking.nextStartTime}` : ''}</p>
                  </div>
                </div>
                <p className="text-[11px] text-amber-800/80 font-bold leading-relaxed">
                  Vui lòng hoàn thành đơn hiện tại để nhận khách tiếp theo. Hệ thống đã giữ suất cho bạn.
                </p>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}

function ScreenTimer({ logic }: { logic: any }) {
  const { 
    booking, 
    timeRemaining, 
    prepTimeRemaining, 
    isPrepping, 
    isTimerRunning, 
    handleStartTimer, 
    handleFinishTimer, 
    handleEarlyExit,
    handleInteraction,
    activeSegmentIndex
  } = logic;

  // 📸 CAMERA WEBRTC STATE & LOGIC FOR START TIMER
  const MIN_BRIGHTNESS_FALLBACK = 40;
  const [minBrightness, setMinBrightness] = React.useState(MIN_BRIGHTNESS_FALLBACK);

  React.useEffect(() => {
      fetch('/api/ktv/settings')
          .then(r => r.json())
          .then(json => {
              if (json.success && json.data?.min_photo_brightness !== undefined) {
                  setMinBrightness(Number(json.data.min_photo_brightness));
              }
          })
          .catch(() => { /* use fallback */ });
  }, []);

  const getAverageBrightness = (canvas: HTMLCanvasElement): number => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return 255;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let total = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 40) {
          total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          count++;
      }
      return count > 0 ? total / count : 255;
  };


  const compressImage = (file: File, maxWidth = 600, quality = 0.5): Promise<string> => {
      return new Promise((resolve, reject) => {
          const img = new window.Image();
          const url = URL.createObjectURL(file);
          img.onload = () => {
              URL.revokeObjectURL(url);
              const canvas = document.createElement('canvas');
              let { width, height } = img;
              if (width > maxWidth) {
                  height = Math.round((height * maxWidth) / width);
                  width = maxWidth;
              }
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) { reject(new Error('Canvas not supported')); return; }
              ctx.drawImage(img, 0, 0, width, height);

              // 🔆 Kiểm tra độ sáng
              const brightness = getAverageBrightness(canvas);
              if (brightness < minBrightness) {
                  reject(new Error('TOO_DARK'));
                  return;
              }

              const now = new Date();
              const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
              const pad = (n: number) => String(n).padStart(2, '0');
              const timeStr = `${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())}`;
              const dateStr = `${pad(vnTime.getDate())}/${pad(vnTime.getMonth() + 1)}/${vnTime.getFullYear()}`;
              const watermarkText = `${timeStr}  ${dateStr}  Room ${booking?.assignedRoomId || booking?.roomName || ''}`;

              const fontSize = 14;
              ctx.font = `bold ${fontSize}px Arial`;
              ctx.textBaseline = 'top';
              const textWidth = ctx.measureText(watermarkText).width;
              
              ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
              ctx.fillRect(8, 8, textWidth + 16, fontSize + 12);
              ctx.fillStyle = '#FFFFFF';
              ctx.fillText(watermarkText, 16, 14);

              resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = url;
      });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
          const compressed = await compressImage(file);
          logic.setStartPhotoBase64(compressed);
      } catch (err: any) {
          if (err?.message === 'TOO_DARK') {
              alert('⚠️ Ảnh quá tối! Vui lòng chụp lại ở nơi có đủ ánh sáng.');
          } else {
              const reader = new FileReader();
              reader.onload = (ev) => {
                  const result = ev.target?.result as string;
                  if (result) logic.setStartPhotoBase64(result);
              };
              reader.readAsDataURL(file);
          }
      }
      if (e.target) e.target.value = '';
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const currentSecs = isPrepping ? prepTimeRemaining : timeRemaining;
  
  // Lấy tất cả DV mà KTV này được gán (hỗ trợ multi-item)
  const allTimerItemIds: string[] = booking?.assignedItemIds?.length > 0
    ? booking.assignedItemIds
    : (booking?.assignedItemId ? [booking.assignedItemId] : []);
  const allTimerItems = allTimerItemIds.length > 0
    ? booking?.BookingItems?.filter((i: any) => allTimerItemIds.includes(i.id)) || []
    : [booking?.BookingItems?.[0]].filter(Boolean);
  const item = allTimerItems[0] || {};
  const allTimerServiceNames = allTimerItems.map((i: any) => i.service_name).filter(Boolean);
  
  // Gộp tất cả segments của KTV này
  const ktvSegments = allTimerItems.flatMap((i: any) => {
    let segs = [];
    if (typeof i?.segments === 'string') {
        try { segs = JSON.parse(i.segments); } catch (e) { segs = []; }
    } else if (Array.isArray(i?.segments)) {
        segs = i.segments;
    }
    return segs
      .filter((s: any) => s.ktvId?.toLowerCase() === logic.ktvId?.toLowerCase())
      .map((s: any) => ({ ...s, _itemId: i.id, _serviceName: i.service_name }));
  }).sort((a: any, b: any) => {
      const timeA = a.startTime || '23:59';
      const timeB = b.startTime || '23:59';
      return timeA.localeCompare(timeB);
  });
  
  const uniqueItemIds = new Set(ktvSegments.map((s: any) => s._itemId));
  const shouldMerge = ktvSegments.length > 1 && uniqueItemIds.size === ktvSegments.length;

  const totalAssignedMins = ktvSegments.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
  const currentSeg = ktvSegments.length > 0 ? ktvSegments[activeSegmentIndex || 0] : null;
  const nextSeg = ktvSegments.length > (activeSegmentIndex + 1) && !shouldMerge ? ktvSegments[activeSegmentIndex + 1] : null;

  // 🕒 CHỈ HIỂN THỊ THỜI GIAN CỦA CHẶNG HIỆN TẠI (trừ phi được gộp)
  const displayDuration = shouldMerge ? totalAssignedMins : (currentSeg ? (Number(currentSeg.duration) || 60) : (item.duration || 60));

  const parsedSetup = Number(logic.settings?.ktv_setup_duration_minutes);
  const setupMins = !isNaN(parsedSetup) ? parsedSetup : 0;
  
  const totalDuration = isPrepping 
    ? setupMins * 60 
    : displayDuration * 60;
  
  // 🔄 Reverse progress: Start full (100) and move to 0 as time runs out
  const progress = totalDuration > 0 ? (currentSecs / totalDuration) * 100 : 0;

  // Xử lý hiển thị giờ bắt đầu / kết thúc
  const startTimeRaw = currentSeg?.actualStartTime || booking?.dispatchStartTime || booking?.timeStart || null;
  const getFormattedTime = (dateString: string | null) => {
    if (!dateString) return '--:--';
    if (typeof dateString === 'string' && /^\d{1,2}:\d{2}/.test(dateString)) return dateString.substring(0, 5);
    const d = new Date(dateString.includes('Z') || dateString.includes('+') ? dateString : dateString.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };
  const getEndTime = (dateString: string | null, durationMins: number) => {
    if (!dateString) return '--:--';
    let d = new Date(dateString.includes('Z') || dateString.includes('+') ? dateString : dateString.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) {
      if (typeof dateString === 'string' && /^\d{1,2}:\d{2}/.test(dateString)) {
        const [h, m] = dateString.split(':').map(Number);
        d = new Date();
        d.setHours(h, m + durationMins, 0, 0);
        return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      }
      return '--:--';
    }
    d.setMinutes(d.getMinutes() + durationMins);
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  const displayStartTime = getFormattedTime(startTimeRaw);
  const displayEndTime = getEndTime(startTimeRaw, displayDuration);


  return (
    <div className="p-4 h-full flex flex-col pt-8">
      {/* Header Info */}
      <div className="flex justify-between items-start mb-6 px-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-black text-emerald-700 leading-tight tracking-tight">
            {allTimerServiceNames.length > 1 ? formatMultiServiceNames(ktvSegments) : item.service_name}
          </h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-800 font-black">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest">
                {ktvSegments.length > 1 && !shouldMerge ? `Chặng ${activeSegmentIndex + 1}` : 'Phòng'}
              </span>
              <span className="text-lg">
                {currentSeg?.roomId || booking?.assignedRoomId || item.roomName || booking?.roomName}
                {(currentSeg?.bedId || booking?.assignedBedId) && ` (G: ${(currentSeg?.bedId || booking.assignedBedId).split('-').pop()})`}
              </span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-1.5 text-slate-400 font-bold text-xs">
              <Clock size={14} />
              <span>{displayDuration} phút</span>
            </div>
          </div>
          {/* CoWorkers display in Timer - chỉ khi cùng 1 dịch vụ */}
          {(() => {
            const timerAssignedItem = booking?.assignedItemId
              ? booking.BookingItems?.find((bi: any) => bi.id === booking.assignedItemId)
              : null;
            const timerCoWorkers = (timerAssignedItem?.technicianCodes || []).filter((code: string) => code !== logic.ktvId);
            return timerCoWorkers.length > 0 ? (
              <p className="mt-1 text-[10px] font-bold text-indigo-500 uppercase tracking-tighter">Cùng làm với {timerCoWorkers.join(', ')}</p>
            ) : null;
          })()}
        </div>
        <div className="flex gap-2">
          {isTimerRunning && (
            <button 
              onClick={() => logic.forceRefresh?.()}
              className="flex flex-col items-center gap-1 text-slate-400 active:scale-90 transition-all shrink-0"
            >
              <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center border border-slate-200 shadow-sm">
                <RefreshCw size={22} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-tighter">Tải lại</span>
            </button>
          )}
          <button 
            onClick={() => logic.setShowProcedure(true)}
            className="flex flex-col items-center gap-1 text-emerald-600 active:scale-90 transition-all shrink-0"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100 shadow-sm">
              <BookOpen size={22} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-tighter">Quy trình</span>
          </button>
        </div>
      </div>

      {/* Main Timer Display */}
      <div className="flex flex-col items-center justify-center pb-8">
        <div className="relative w-64 h-64 flex items-center justify-center">
          {/* Subtle Background Ring (always there) */}
          <div className="absolute inset-0 rounded-full border-[12px] border-slate-50 opacity-50"></div>
          
          <svg className="absolute inset-0 w-full h-full transform -rotate-90 drop-shadow-sm">
            <circle
              cx="128" cy="128" r="115" stroke="currentColor" strokeWidth="12" fill="transparent"
              className={`${isPrepping ? 'text-blue-400' : 'text-emerald-500'} transition-all duration-1000 ease-linear shadow-inner`}
              strokeDasharray={2 * Math.PI * 115}
              strokeDashoffset={2 * Math.PI * 115 * (1 - progress / 100)}
              strokeLinecap="round"
            />
          </svg>
          
          <div className="text-center z-10">
            <div className={`text-6xl font-black ${isPrepping ? 'text-blue-600' : 'text-slate-800'} tracking-tighter tabular-nums`}>
              {formatTime(currentSecs)}
            </div>
            <div className={`mt-3 px-4 py-1.5 rounded-full border font-black text-[10px] tracking-widest uppercase flex items-center justify-center gap-1.5
              ${isPrepping ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
              {isPrepping && <Clock size={12} className="animate-pulse" />}
              {isPrepping ? 'THỜI GIAN CHUẨN BỊ' : (isTimerRunning ? 'ĐANG THỰC HIỆN' : 'ĐỢI BẮT ĐẦU')}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline for multi-stage */}
      {ktvSegments.length > 0 && (
        <div className="px-2 mb-8">
          <WorkingTimeline 
            segments={ktvSegments} 
            activeIndex={activeSegmentIndex} 
            actualStartTime={ktvSegments[0]?.actualStartTime || booking?.dispatchStartTime || booking?.timeStart || null}
            shouldMerge={shouldMerge}
          />
        </div>
      )}



      {/* Primary Action Button */}
      <div className="px-6 mb-10">
        {!isTimerRunning || isPrepping ? (
          <div className="space-y-4">
            {/* Selfie Photo Preview (Sequential Flow) */}
            {logic.startPhotoBase64 && (
              <div className="bg-slate-50 border border-slate-100 rounded-3xl p-4 flex items-center justify-between gap-4 animate-in zoom-in-95 duration-200">
                <div className="flex items-center gap-3">
                  <div className="relative w-16 h-16 rounded-2xl overflow-hidden border-2 border-emerald-500 shadow-md">
                    <img src={logic.startPhotoBase64} className="w-full h-full object-cover" alt="Selfie preview" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-800">Đã lưu ảnh chụp!</p>
                    <p className="text-[10px] text-slate-400 font-bold">Bấm Bắt đầu để kích hoạt ca</p>
                  </div>
                </div>
                <button 
                  onClick={() => logic.setStartPhotoBase64(null)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 active:scale-95 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-slate-200"
                >
                  Chụp lại 🔄
                </button>
              </div>
            )}

            {/* Action buttons based on photo status */}
            {logic.startPhotoBase64 ? (
              <button
                onClick={handleStartTimer}
                disabled={logic.isLoading}
                className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-black text-lg shadow-xl shadow-emerald-200/50 rounded-[32px] flex items-center justify-center gap-3 transition-all disabled:opacity-40"
              >
                <Play fill="white" size={24} />
                {logic.isLoading ? 'ĐANG BẮT ĐẦU...' : 'BẮT ĐẦU PHỤC VỤ'}
              </button>
            ) : (
              <div className="flex gap-3">
                <label className="flex-[2] h-16 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-black text-xs shadow-xl shadow-emerald-200/50 rounded-[32px] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-45 disabled:active:scale-100">
                  <Camera size={18} />
                  {logic.canStart ? 'CHỤP ẢNH ĐỂ BẮT ĐẦU' : 'CHƯA ĐẾN GIỜ'}
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileUpload} disabled={logic.isLoading || !logic.canStart} />
                </label>
                <label className="flex-[0.8] h-16 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-[32px] flex flex-col items-center justify-center cursor-pointer transition-all active:scale-[0.98] disabled:opacity-40">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Tải ảnh</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} disabled={logic.isLoading || !logic.canStart} />
                </label>
              </div>
            )}

            {!logic.canStart && logic.allowedStartTime && (
              <motion.p 
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center text-rose-600 font-black text-[11px] bg-rose-50 py-2 rounded-xl border border-rose-100 flex items-center justify-center gap-1.5"
              >
                <Clock size={12} strokeWidth={3} />
                Bạn có thể bắt đầu lúc {logic.allowedStartTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </motion.p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="flex items-center justify-center gap-2 py-4 bg-emerald-50 border border-emerald-200 rounded-2xl w-full">
              <Clock size={16} className="text-emerald-600 animate-pulse" />
              <span className="text-sm font-bold text-emerald-700">Hệ thống tự động hoàn tất khi hết giờ</span>
            </div>
            
            {logic.booking?.nextBookingId && (
              <div className="flex items-center justify-center gap-2 py-2 w-full mt-2 bg-amber-50 rounded-xl border border-amber-200 shadow-sm">
                <BellRing size={14} className="text-amber-600 animate-bounce" />
                <span className="text-[11px] font-bold text-amber-700">
                  Tiếp: {logic.booking.nextServiceName || 'Đơn mới'}{logic.booking.nextStartTime ? ` • ${logic.booking.nextStartTime}` : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Special Requirements Section */}
      <CollapsibleRequirements booking={booking} />

      {/* 2x2 Action Grid + Emergency Wide - ONLY SHOW WHEN RUNNING */}
      {isTimerRunning && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="flex flex-col gap-3 mb-12"
        >
            <div className="grid grid-cols-2 gap-3">
                <ActionGridButton 
                  onClick={handleEarlyExit} 
                  icon={<LogOut size={20} />} 
                  label="KHÁCH VỀ SỚM" 
                  color="text-rose-600 border-rose-50" 
                />
                <ActionGridButton 
                  onClick={() => handleInteraction('ORDER_DRINK')} 
                  icon={<Coffee size={20} />} 
                  label="GỌI NƯỚC" 
                  color="text-amber-600 border-amber-50" 
                />
                <ActionGridButton 
                  onClick={() => handleInteraction('BUY_MORE')} 
                  icon={<PlusSquare size={20} />} 
                  label="MUA THÊM DV" 
                  color="text-emerald-600 border-emerald-50" 
                />
                <ActionGridButton 
                  onClick={() => handleInteraction('ASK_SUPPORT')} 
                  icon={<HelpCircle size={20} />} 
                  label="HỖ TRỢ" 
                  color="text-blue-600 border-blue-50" 
                />
            </div>
            
            <button
              onClick={() => handleInteraction('EMERGENCY')}
              className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-rose-200 active:scale-95 transition-all"
            >
              <ShieldAlert size={18} />
              BÁO ĐỘNG KHẨN CẤP
            </button>
        </motion.div>
      )}

      {/* WebRTC Camera Overlay */}

    </div>
  );
}

function ActionGridButton({ onClick, icon, label, color }: { onClick: () => void, icon: React.ReactNode, label: string, color: string }) {
  return (
    <button
      onClick={onClick}
      className={`bg-white border border-slate-100 p-4 rounded-3xl flex flex-col items-center justify-center gap-2 shadow-sm active:scale-95 transition-all ${color}`}
    >
      <div className="opacity-80">{icon}</div>
      <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
    </button>
  );
}

function ChecklistItem({ label, checked, onChange }: { label: string, checked: boolean, onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-full flex items-center justify-between p-4 ${THEME.radius} border-2 transition-all
      ${checked ? 'border-emerald-500 bg-emerald-50' : 'border-slate-50 bg-slate-50/50 hover:border-emerald-200'}`}
    >
      <span className={`text-sm font-bold ${checked ? 'text-emerald-700' : 'text-slate-600'}`}>{label}</span>
      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
        ${checked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 bg-white'}`}>
        {checked && <CheckCircle size={14} />}
      </div>
    </button>
  );
}

function ScreenReview({ logic }: { logic: any }) {
  const { booking, handleSubmitReview } = logic;
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);

  // 🔧 UI CONFIGURATION — Personality categories matching mockup
  const PERSONALITY_CATEGORIES = [
    {
      id: 'de_xom',
      label: 'Khách Dê Xồm',
      subtitle: 'Thiếu tôn trọng KTV',
      icon: <AlertTriangle size={20} />,
      selectedStyle: 'bg-rose-50 border-rose-400 text-rose-700',
      iconBg: 'bg-rose-100 text-rose-600',
    },
    {
      id: 'ky_tinh',
      label: 'Khách Kỹ Tính + Khó Chịu',
      subtitle: 'Yêu cầu sự tinh tế',
      icon: <AlertCircle size={20} />,
      selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
      iconBg: 'bg-slate-100 text-slate-500',
    },
    {
      id: 'de_thuong',
      label: 'Khách Dễ Thương',
      subtitle: 'Thân thiện, cởi mở',
      icon: <Heart size={20} />,
      selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
      iconBg: 'bg-slate-100 text-slate-500',
    },
    {
      id: 'huong_noi',
      label: 'Khách Hướng Nội',
      subtitle: 'Thích yên tĩnh, ít nói',
      icon: <MicOff size={20} />,
      selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
      iconBg: 'bg-slate-100 text-slate-500',
    },
    {
      id: 'huong_ngoai',
      label: 'Khách Hướng Ngoại',
      subtitle: 'Thích giao lưu, kết nối',
      icon: <Users size={20} />,
      selectedStyle: 'bg-emerald-50 border-emerald-400 text-emerald-700',
      iconBg: 'bg-slate-100 text-slate-500',
    },
  ];

  const toggleTrait = (label: string) => {
    setSelectedTraits(prev =>
      prev.includes(label) ? prev.filter(t => t !== label) : [...prev, label]
    );
  };

  return (
    <div className="p-5 pt-10 space-y-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="text-emerald-500" size={36} />
        </div>
        <h2 className="text-2xl font-black text-slate-800">Dịch vụ hoàn tất!</h2>
        <p className="text-sm text-slate-400 font-medium">Đánh giá hồ sơ khách hàng</p>
      </div>

      {/* Warning Banner */}
      <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl flex items-start gap-3 shadow-sm">
        <div className="w-8 h-8 bg-rose-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
          <AlertTriangle className="text-rose-500" size={16} />
        </div>
        <p className="text-xs font-black text-rose-700 leading-relaxed uppercase tracking-tight">
          Nhắc khách kiểm tra lại điện thoại, ví tiền và nữ trang trước khi rời phòng
        </p>
      </div>

      {logic.booking?.nextBookingId && (
        <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-2xl flex items-center gap-3 shadow-md shadow-amber-100/50">
          <div className="w-10 h-10 bg-amber-200 rounded-full flex items-center justify-center shrink-0">
            <BellRing className="text-amber-700 animate-bounce" size={20} />
          </div>
          <div className="flex-1">
             <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Sắp tới</p>
             <p className="text-xs font-bold text-amber-800">{logic.booking.nextServiceName || 'Đơn mới'}{logic.booking.nextStartTime ? <span className="ml-1 text-amber-600">• {logic.booking.nextStartTime}</span> : ''}</p>
          </div>
        </div>
      )}

      {/* Personality Categories */}
      <div className="space-y-3">
        {PERSONALITY_CATEGORIES.map((cat) => {
          const isSelected = selectedTraits.includes(cat.label);
          return (
            <button
              key={cat.id}
              onClick={() => toggleTrait(cat.label)}
              className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all active:scale-[0.98] ${
                isSelected
                  ? cat.selectedStyle
                  : 'bg-white border-slate-100 text-slate-700 hover:border-slate-200'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                isSelected
                  ? (cat.id === 'de_xom' ? 'bg-rose-200 text-rose-600' : 'bg-emerald-200 text-emerald-600')
                  : cat.iconBg
              }`}>
                {cat.icon}
              </div>
              <div className="text-left flex-1">
                <p className="font-black text-sm">{cat.label}</p>
                <p className={`text-xs font-medium mt-0.5 ${isSelected ? 'opacity-80' : 'text-slate-400'}`}>
                  {cat.subtitle}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Submit Button */}
      <div className="pb-10 pt-2">
        <button
          onClick={() => handleSubmitReview({ personality: selectedTraits })}
          disabled={logic.isLoading}
          className="w-full py-4 rounded-2xl font-black text-base shadow-lg transition-all active:scale-[0.97] bg-emerald-600 text-white shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50"
        >
          {logic.isLoading ? 'Đang lưu...' : `Lưu hồ sơ${selectedTraits.length > 0 ? ` (${selectedTraits.length})` : ''}`}
        </button>
      </div>
    </div>
  );
}

function ScreenHandover({ logic }: { logic: any }) {
  const { handoverChecklist, toggleHandoverChecklist, isHandoverComplete, handleFinishHandover, cleanProcedure, checkAllHandoverChecklist } = logic;

  return (
    <div className="p-6 pt-12 space-y-8">
      <div className="text-center space-y-2">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Sparkles className="text-blue-600" size={40} />
        </div>
        <h2 className="text-2xl font-black text-slate-800">Dọn dẹp phòng</h2>
        <p className="text-slate-500 font-medium">Hoàn tất các bước vệ sinh để sẵn sàng đón khách tiếp theo.</p>
      </div>

      <div className="space-y-3">
        <div className="flex justify-end mb-1">
           <button 
              onClick={checkAllHandoverChecklist}
              className="text-[10px] font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg active:scale-95 transition-all uppercase tracking-widest border border-blue-100 shadow-sm"
           >
              Chọn tất cả
           </button>
        </div>
        {cleanProcedure.map((label: string, idx: number) => (
          <ChecklistItem key={idx} label={label} checked={handoverChecklist[idx] || false} onChange={() => toggleHandoverChecklist(idx)} />
        ))}
      </div>

      {/* Room Issue Report Button */}
      <button
        onClick={() => logic.setShowRoomIssueModal(true)}
        className="w-full py-3 rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/50 text-rose-600 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-rose-100/50"
      >
        <AlertTriangle size={16} />
        Báo sự cố phòng
      </button>

      <button
        disabled={!isHandoverComplete || logic.isLoading}
        onClick={handleFinishHandover}
        className={`w-full py-5 rounded-[24px] font-black text-sm uppercase tracking-widest shadow-xl transition-all
        ${isHandoverComplete ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-slate-200 text-slate-400'}`}
      >
        {logic.isLoading ? 'Đang xử lý...' : 'Xong & Sẵn sàng đón khách'}
      </button>

    </div>
  );
}

function ScreenReward({ logic }: { logic: any }) {
  const { commission, goToDashboard } = logic;

  return (
    <div className="p-6 h-full flex flex-col items-center justify-center text-center space-y-6 pt-10">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1, rotate: [0, 10, -10, 0] }}
        className="w-24 h-24 bg-amber-100 rounded-[32px] flex items-center justify-center shadow-xl shadow-amber-100"
      >
        <Gift className="text-amber-600" size={48} />
      </motion.div>

      <div className="space-y-1.5">
        <h2 className="text-xl font-black text-slate-800 tracking-tight">Chúc mừng!</h2>
        <p className="text-sm text-slate-500 font-bold px-4">Bạn vừa nhận được tiền tua phục vụ</p>
      </div>

      <div className="bg-white border-2 border-amber-100 rounded-[32px] p-6 w-full shadow-lg max-w-[280px]">
        <span className="text-[9px] font-black text-amber-600 uppercase tracking-[0.2em] block mb-1">Tua bạn nhận được</span>
        <div className="text-4xl font-black text-slate-800 tabular-nums">+{commission.toLocaleString('vi-VN')}đ</div>
      </div>

      <button
        onClick={() => goToDashboard(logic.booking?.nextBookingId)}
        className={`w-full max-w-[280px] py-4 rounded-[20px] font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2
          ${logic.booking?.nextBookingId 
            ? 'bg-amber-600 text-white shadow-amber-200' 
            : 'bg-slate-900 text-white'}`}
      >
        {logic.booking?.nextBookingId ? (
          <>
            <BellRing size={16} className="animate-bounce" />
            Nhận đơn tiếp theo
          </>
        ) : (
          'Tiếp tục làm việc'
        )}
      </button>
    </div>
  );
}

function CollapsibleRequirements({ booking }: { booking: any }) {
  const [isOpen, setIsOpen] = useState(true);
  
  // Lấy đúng item được gán
  const item = booking?.assignedItemId 
    ? booking.BookingItems?.find((i: any) => i.id === booking.assignedItemId)
    : (booking?.BookingItems?.[0] || {});

  if (!booking) return null;

  // Parse dispatcher note to avoid showing raw JSON from AI
  let displayDispatcherNote = booking?.dispatcherNote;
  if (displayDispatcherNote && typeof displayDispatcherNote === 'string') {
    let currentStr = displayDispatcherNote.trim();
    while (currentStr.startsWith('{')) {
      try {
        const parsed = JSON.parse(currentStr);
        if (parsed.receptionNote || parsed.note) {
          currentStr = parsed.receptionNote || parsed.note;
        } else if (parsed.type === 'VIP_APPOINTMENT' || parsed.selectedSkills) {
          currentStr = ''; // Hide raw AI metadata
          break;
        } else if (parsed.type === 'WEB_ADVANCE_BOOKING') {
          currentStr = 'Khách đặt trước qua Web/App Nội Bộ.';
          break;
        } else {
          currentStr = ''; // Hide other raw JSON objects
          break;
        }
      } catch (e) {
        break; // Not a valid JSON string, leave as is
      }
    }
    displayDispatcherNote = currentStr || null;
  }

  return (
    <div className="border-t border-slate-50 mt-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-4 group"
      >
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-emerald-600 transition-colors">
          Yêu cầu chi tiết
        </span>
        <div className="text-slate-300">
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pb-6 space-y-5">
              {/* 1. Yêu cầu của khách */}
              <div className="flex flex-col gap-3">
                <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest px-1">Từ phía khách hàng</span>
                <div className="flex flex-wrap gap-2">
                  {/* Giới tính KTV: ẩn vì KTV không cần xem thông tin này */}
                  {item.strength && (
                    <div className="px-4 py-2 bg-orange-50 text-orange-700 rounded-xl text-[13px] font-black border border-orange-100 flex items-center gap-2">
                      <Dumbbell size={16} /> Lực: {item.strength}
                    </div>
                  )}
                  {item.focus && (() => {
                    const parts = item.focus.split(',').map((p: string) => p.trim());
                    const isFull = item.focus === 'full_body' || parts.length >= 8;
                    return (
                      <div className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-[13px] font-black border border-emerald-100 flex items-center gap-2">
                        <Target size={16} /> Tập trung: {isFull ? 'Toàn thân' : item.focus}
                      </div>
                    );
                  })()}
                  {item.avoid && (
                    <div className="px-4 py-2 bg-rose-50 text-rose-700 rounded-xl text-[13px] font-black border border-rose-100 flex items-center gap-2">
                      <Ban size={16} /> Tránh: {item.avoid}
                    </div>
                  )}
                </div>
                {item.customerNote && (
                  <div className="bg-slate-50 p-3.5 rounded-2xl text-xs text-slate-600 font-bold italic border border-slate-100 shadow-sm">
                    &quot;{item.customerNote}&quot;
                  </div>
                )}
              </div>

              {/* 2. Ghi chú của quầy */}
              {displayDispatcherNote && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Ghi chú của quầy</span>
                  <div className="bg-slate-50 p-3.5 rounded-2xl text-xs text-slate-600 font-medium whitespace-pre-wrap border border-slate-100 shadow-sm leading-relaxed break-words overflow-hidden">
                    {displayDispatcherNote}
                  </div>
                </div>
              )}

              {/* 3. Ghi chú cho KTV */}
              {item.noteForKtv && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest px-1">Ghi chú cho kỹ thuật viên</span>
                  <div className="bg-rose-50/50 p-3.5 rounded-2xl text-xs text-rose-700 font-bold border border-rose-100 whitespace-pre-wrap shadow-sm leading-relaxed">
                    {item.noteForKtv}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RatingCard({ icon, title, desc, isSelected, onClick }: { icon: React.ReactNode, title: string, desc: string, isSelected: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 ${THEME.radius} border-2 transition-all flex items-start gap-4
      ${isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-100 bg-white hover:border-emerald-200'}`}
    >
      <div className={`mt-1 ${isSelected ? 'text-emerald-600' : 'text-slate-400'}`}>
        {icon}
      </div>
      <div>
        <h4 className={`font-bold ${isSelected ? 'text-emerald-800' : 'text-slate-800'}`}>{title}</h4>
        <p className={`text-sm ${isSelected ? 'text-emerald-600/80' : 'text-slate-500'}`}>{desc}</p>
      </div>
    </button>
  );
}

function ProcedureModal({ isOpen, onClose, procedure, serviceName }: { isOpen: boolean, onClose: () => void, procedure: any, serviceName: string }) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
       <motion.div 
         initial={{ opacity: 0, scale: 0.9, y: 30 }}
         animate={{ opacity: 1, scale: 1, y: 0 }}
         className="bg-white w-full max-w-lg max-h-[80vh] rounded-[40px] shadow-2xl overflow-hidden flex flex-col"
       >
          <div className="bg-emerald-600 p-8 text-white flex items-center justify-between">
             <div>
                <h3 className="text-xl font-black uppercase tracking-tight">{serviceName}</h3>
                <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-widest mt-1">Quy trình thực hiện chuẩn</p>
             </div>
             <button onClick={onClose} className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition-colors">
                <X size={24} />
             </button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-bold text-slate-600 leading-relaxed text-sm">
             {procedure ? (
                <div className="space-y-4">
                   {Array.isArray(procedure) ? (
                      procedure.map((step: string, idx: number) => (
                         <div key={idx} className="flex gap-4">
                            <span className="text-emerald-500 font-black">{(idx + 1).toString().padStart(2, '0')}.</span>
                            <p>{step}</p>
                         </div>
                      ))
                   ) : (
                      <p className="whitespace-pre-line">{procedure}</p>
                   )}
                </div>
             ) : (
                <p className="italic text-slate-400 text-center py-10">Quy trình đang được cập nhật...</p>
             )}
          </div>
          <div className="p-8 border-t border-slate-100">
             <button onClick={onClose} className="w-full bg-slate-900 text-white py-5 rounded-[24px] font-black text-xs uppercase tracking-widest">Đã hiểu quy trình</button>
          </div>
       </motion.div>
    </div>
  );
}

function RoomIssueModal({ isOpen, onClose, onSubmit, roomId }: { isOpen: boolean, onClose: () => void, onSubmit: (issues: string[], note: string) => void, roomId: string }) {
  const [selectedIssues, setSelectedIssues] = React.useState<string[]>([]);
  const [note, setNote] = React.useState('');

  if (!isOpen) return null;

  const toggleIssue = (issue: string) => {
    setSelectedIssues(prev => prev.includes(issue) ? prev.filter(i => i !== issue) : [...prev, issue]);
  };

  const handleSubmit = () => {
    if (selectedIssues.length === 0 && !note.trim()) {
      alert('Vui lòng chọn hoặc nhập mô tả sự cố!');
      return;
    }
    onSubmit(selectedIssues, note.trim());
    setSelectedIssues([]);
    setNote('');
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full sm:max-w-md max-h-[90vh] rounded-t-[32px] sm:rounded-[32px] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="bg-rose-600 p-6 text-white flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
              <AlertTriangle size={20} />
              Báo Sự Cố Phòng
            </h3>
            {roomId && <p className="text-[10px] font-bold text-rose-100 uppercase tracking-widest mt-1">Phòng {roomId}</p>}
          </div>
          <button onClick={onClose} className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Quick Options */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Chọn loại sự cố</p>
          <div className="grid grid-cols-2 gap-2">
            {ROOM_ISSUE_OPTIONS.map((issue) => (
              <button
                key={issue}
                onClick={() => toggleIssue(issue)}
                className={`p-3 rounded-2xl border-2 text-xs font-black text-left transition-all active:scale-95 ${
                  selectedIssues.includes(issue)
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-slate-100 bg-white text-slate-600 hover:border-rose-200'
                }`}
              >
                {issue}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ghi chú thêm</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Mô tả chi tiết sự cố..."
              className="w-full p-4 rounded-2xl border-2 border-slate-100 focus:border-rose-300 focus:ring-0 outline-none text-sm font-bold text-slate-700 resize-none h-24 placeholder:text-slate-300"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="p-5 border-t border-slate-100 space-y-2">
          <button
            onClick={handleSubmit}
            className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-rose-200 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <ShieldAlert size={16} />
            Gửi báo cáo về Lễ tân
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 text-slate-400 font-bold text-xs uppercase tracking-widest"
          >
            Huỷ
          </button>
        </div>
      </motion.div>
    </div>
  );
}

