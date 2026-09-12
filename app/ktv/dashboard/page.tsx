'use client';

import { compressImageWithWatermark } from '@/lib/camera.logic';
import React, { useState, Suspense } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  BellRing, Play, CheckCircle2, ChevronRight, HelpCircle, Phone, 
  MapPin, Clock, X, MessageSquare, AlertCircle, FileText, Gift,
  CheckSquare, Check, XCircle, AlertTriangle, CheckCircle, ShieldAlert, Dumbbell, Target, QrCode, ScanLine, Search, Trash2, Camera, LogOut, FileImage, UploadCloud, FileDown,
  Info, LogIn, ChevronLeft, CalendarClock, History, Calendar, Heart, Shield, Star, Crown, Lock, ChevronDown, CheckIcon, MapPinIcon, LayoutDashboard, CalendarCheck, FileOutput, ShieldCheck,
  Zap, MessageCircle, XOctagon, Hand, ThumbsUp, Map as MapIcon, Navigation2, RefreshCw, Smartphone, MonitorPlay, Wifi, Coffee, Sparkles, Plus, Wallet, FilePlus, ExternalLink, Link as LinkIcon, HandHeart, CheckCheck, HandMetal, Smile, Image as ImageIcon,
  ClipboardList, BookOpen, PlusSquare, PauseCircle, MicOff, Users, Loader2, ChevronUp, Ban
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useKTVDashboard } from './KTVDashboard.logic';
import { ROOM_ISSUE_OPTIONS } from './KTVDashboard.logic';
import { useNotifications } from '@/components/NotificationProvider';
import { supabase } from '@/lib/supabase';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { formatBodyAreas, normalizeStrength } from '@/lib/booking.logic';

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
    
    const groups = new globalThis.Map<string, Set<string>>();
    
    segments.forEach(seg => {
        const roomName = seg.roomId || '';
        const serviceName = seg._serviceName || 'Dịch vụ';
        
        if (!groups.has(roomName)) {
            groups.set(roomName, new Set());
        }
        groups.get(roomName)!.add(serviceName.toUpperCase());
    });
    
    const parts: string[] = [];
    groups.forEach((serviceSet: Set<string>, roomName: string) => {
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

// ─── ServiceTypeLabel Component ─────────────────────────────────────────────
const ServiceTypeLabel = ({ serviceId }: { serviceId?: string }) => {
  if (!serviceId) return null;
  const prefix = String(serviceId).substring(0, 3).toUpperCase();
  if (prefix === 'NHP') return <span className="text-[10px] font-black text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-lg whitespace-nowrap shadow-sm uppercase tracking-widest">VIP</span>;
  if (prefix === 'NHT') return <span className="text-[10px] font-black text-blue-700 bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-lg whitespace-nowrap shadow-sm uppercase tracking-widest">ĐIỀU TRỊ</span>;
  if (prefix === 'NHS') return <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-lg whitespace-nowrap shadow-sm uppercase tracking-widest">MENU THƯỜNG</span>;
  return null;
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
        isVip={assignedItem?.serviceId && (String(assignedItem.serviceId).toUpperCase().startsWith('NHP') || String(assignedItem.serviceId).toUpperCase().startsWith('VIP_'))}
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

function WorkingTimeline({ segments, activeIndex, actualStartTime, shouldMerge, totalAssignedMins }: { segments: any[], activeIndex?: number, actualStartTime?: string | null, shouldMerge?: boolean, totalAssignedMins?: number }) {
  if (!segments || segments.length === 0) return null;

  let displaySegments = segments;
  if (shouldMerge && segments.length > 0) {
    const totalDuration = totalAssignedMins || segments.reduce((sum, seg) => sum + (Number(seg.duration) || 0), 0);
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
              key={`${seg.id}-${idx}`} 
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

function ScreenDashboard({ logic }: { logic: any }) {
  const [showNoti, setShowNoti] = React.useState(false);
  logic.showNoti = showNoti;
  logic.setShowNoti = setShowNoti;

  const { booking, checklist, isChecklistComplete, handleConfirmSetup, setShowProcedure, activeSegmentIndex, prepProcedure, toggleChecklist, checkAllChecklist, setShowRoomIssueModal, walletBalance, canViewWallet, walletTimeline, onCallState, handleToggleOnCall, handleArriveAtVenue, kpiData } = logic;
  const [bookingUrl, setBookingUrl] = React.useState(DEFAULT_BOOKING_URL);
  const [showOnCallPopup, setShowOnCallPopup] = React.useState(false);
  const [tempMins, setTempMins] = React.useState(onCallState?.travel_time_mins || 30);
  const [expectedStart, setExpectedStart] = React.useState('');
  const [expectedEnd, setExpectedEnd] = React.useState('');
  const [isFirstInQueue, setIsFirstInQueue] = React.useState(false);
  const [showRejectModal, setShowRejectModal] = React.useState(false);
  const [showQRModal, setShowQRModal] = React.useState(false);
  const [showWallet, setShowWallet] = React.useState(false);

  const handleRejectOrder = async (reason: string) => {
    if (!logic.booking?.nextBookingId) return;
    try {
      logic.setIsLoading(true);
      const res = await apiClient.post<any>('/api/ktv/discipline/reject-order', {
        staffId: logic.ktvId,
        bookingItemId: logic.booking.nextBookingId,
        reason
      });
      if (res.success) {
        if (res.isExempted) {
          alert('✅ Bạn đã được miễn phạt do làm việc liên tục đạt ngưỡng. Lễ tân đã nhận được báo cáo.');
        } else {
          alert(`⚠️ Bạn đã bị trừ ${res.penaltyPoints} điểm chuyên cần. Lễ tân đã nhận được báo cáo.`);
        }
        setShowRejectModal(false);
        // Refresh dashboard data
        logic.forceRefresh();
      } else {
        alert('Lỗi: ' + res.error);
      }
    } catch (e: any) {
      alert('Lỗi kết nối: ' + e.message);
    } finally {
      logic.setIsLoading(false);
    }
  };

  React.useEffect(() => {
    if (onCallState) setTempMins(onCallState.travel_time_mins);
  }, [onCallState]);

  React.useEffect(() => {
    const isIdle = (!booking || !booking.id);
    if (!isIdle || !logic.ktvId) return;

    const checkQueue = async () => {
      try {
        const date = new Date().toISOString().split('T')[0];
        const res = await apiClient.get<any>(`/api/turns?date=${date}`);
        const configRes = await supabase.from('SystemConfigs').select('value').eq('key', 'daily_water_refiller').maybeSingle();
        if (res.success && res.data) {
          const sorted = [...res.data].sort((a: any, b: any) => {
            if (a.turns_completed !== b.turns_completed) return a.turns_completed - b.turns_completed;
            return (a.check_in_order || 999) - (b.check_in_order || 999);
          });
          const firstWaiting = sorted.find((t: any) => t.status === 'waiting');
          
          let waterId = firstWaiting?.employee_id;
          if (configRes.data?.value && configRes.data.value.date === date && configRes.data.value.employeeId) {
             waterId = configRes.data.value.employeeId;
          }
          setIsFirstInQueue(waterId === logic.ktvId);
        }
      } catch (e) {}
    };
    
    checkQueue();
    const interval = setInterval(checkQueue, 15000);
    return () => clearInterval(interval);
  }, [booking, logic.ktvId]);

  React.useEffect(() => {
    apiClient.get<any>(API.SYSTEM.CONFIG)
      .then(json => {
        if (json.data?.web_booking_url) {
          setBookingUrl(json.data.web_booking_url);
        }
      })
      .catch(() => { /* use fallback */ });
  }, []);

  // Lấy tất cả dịch vụ mà KTV này được gán (hỗ trợ multi-item)
  const allItemIds: string[] = booking?.assignedItemIds?.length > 0
    ? booking.assignedItemIds
    : (booking?.assignedItemId ? [booking.assignedItemId] : []);
  const allItemsRaw = allItemIds.length > 0
    ? booking?.BookingItems?.filter((i: any) => allItemIds.includes(i.id)) || []
    : [booking?.BookingItems?.[0]].filter(Boolean);
  // 🔥 Filter out merged child items — chỉ giữ item cha (hoặc item bình thường)
  const hasMergedChildren = allItemsRaw.some((i: any) => i.options?.mergedIntoId);
  const allItems = hasMergedChildren
    ? allItemsRaw.filter((i: any) => !i.options?.mergedIntoId)
    : allItemsRaw;
  const item = allItems[0] || {};
  
  // Tên: lấy danh sách tên từ TẤT CẢ các item (kể cả item con đã gộp) để UI biết có bao nhiêu dịch vụ
  const allServiceNames = allItemsRaw.map((i: any) => i.service_name).filter(Boolean);
  // Tổng thời gian: dùng allItemsRaw (bao gồm cả child) để tính tổng duration chính xác
  const allKtvSegments = allItemsRaw.flatMap((i: any) => {
    let segs = [];
    if (typeof i?.segments === 'string') {
        try { segs = JSON.parse(i.segments); } catch (e) { segs = []; }
    } else if (Array.isArray(i?.segments)) {
        segs = i.segments;
    }
    return segs.filter((s: any) => s.ktvId?.toLowerCase() === logic.ktvId?.toLowerCase()).map((s: any) => {
        let customName = undefined;
        try {
            const opts = typeof i.options === 'string' ? JSON.parse(i.options) : (i.options || {});
            // KtvId from segment or logic.ktvId
            customName = opts?.serviceNamesForKtvs?.[s.ktvId || logic.ktvId];
        } catch(e) {}
        return { ...s, _itemId: i.id, _serviceName: customName || i.service_name };
    });
  }).sort((a: any, b: any) => {
      const timeA = a.startTime || '23:59';
      const timeB = b.startTime || '23:59';
      return timeA.localeCompare(timeB);
  });
  const totalAssignedMins = allKtvSegments.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
  // Khi đã gộp, chỉ dùng segments từ item cha cho UI (1 dòng timeline duy nhất)
  const ktvSegments = hasMergedChildren
    ? allKtvSegments.filter((s: any) => allItems.some((i: any) => i.id === s._itemId))
    : allKtvSegments;
  
  const uniqueItemIds = new Set(ktvSegments.map((s: any) => s._itemId));
  const uniqueRoomIds = new Set(ktvSegments.map((s: any) => s.roomId || 'unknown'));
  const hasFinishedSegment = ktvSegments.some((s: any) => s.actualEndTime);
  const allFinished = ktvSegments.length > 0 && ktvSegments.every((s: any) => s.actualEndTime);
  const isFinishedMerge = allFinished && ktvSegments[0].actualEndTime === ktvSegments[ktvSegments.length - 1].actualEndTime;
  const shouldMerge = hasMergedChildren || (ktvSegments.length > 1 && uniqueItemIds.size === ktvSegments.length && uniqueRoomIds.size === 1 && !hasFinishedSegment);
  
  // Xác định vị trí chặng hiện tại
  const currentSeg = ktvSegments.length > 0 ? ktvSegments[activeSegmentIndex || 0] : null;

  // Lấy danh sách đồng đội cùng làm CÙNG 1 DỊCH VỤ (chỉ từ item được gán cho KTV này)
  const assignedItem = booking?.assignedItemId
    ? booking.BookingItems?.find((bi: any) => bi.id === booking.assignedItemId)
    : null;
  const coWorkers = (assignedItem?.technicianCodes || []).filter((code: string) => code !== logic.ktvId);

  return (
    <div className="p-3 md:p-5 lg:p-6 space-y-4 lg:space-y-6 relative min-h-[90vh] pb-24 md:max-w-5xl md:mx-auto">
      {/* ─── HEADER ─── */}
        <div className="flex items-center justify-between bg-white/50 backdrop-blur-xl p-4 rounded-3xl border border-slate-100 shadow-sm mb-2 relative z-30">
          <div className="flex items-center gap-3">
             <div className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-2xl flex items-center justify-center shadow-inner border border-white">
                <span className="text-xl">🧑‍⚕️</span>
             </div>
             <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Xin chào,</p>
                <h1 className="text-lg font-black text-slate-800 leading-none">
                  {logic.ktvId || 'Kỹ thuật viên'}
                </h1>
             </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Wallet Icon */}
            {canViewWallet && (
               <Link href="/ktv/wallet" className="relative w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100 active:scale-95 transition-transform">
                  <Wallet size={18} className="text-emerald-600" />
               </Link>
            )}
            
            {/* Notification Bell */}
            <div className="relative">
              <button 
                onClick={() => logic.setShowNoti(!logic.showNoti)}
                className="relative w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100 active:scale-95 transition-transform"
              >
                 <BellRing size={18} className="text-slate-600" />
                 {logic.unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1 shadow-sm animate-pulse">
                      {logic.unreadCount > 9 ? '9+' : logic.unreadCount}
                    </span>
                 )}
              </button>
              
              {/* Notification Dropdown Panel */}
              <AnimatePresence>
                {logic.showNoti && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute top-12 right-0 w-[85vw] sm:w-80 max-w-sm max-h-96 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col z-50"
                  >
                    <div className="p-3 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
                      <h3 className="font-bold text-sm text-slate-700">Thông báo</h3>
                      <div className="flex items-center gap-2">
                        {logic.unreadCount > 0 && (
                          <button 
                            onClick={() => logic.markNotificationAsRead()}
                            className="text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1 bg-emerald-50 rounded-lg transition-colors"
                          >
                            Đánh dấu tất cả đã đọc
                          </button>
                        )}
                        <button onClick={() => logic.setShowNoti(false)} className="text-slate-400 hover:text-slate-600 p-1">
                           <X size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1 p-2 space-y-1">
                      {(!logic.notifications || logic.notifications.length === 0) ? (
                        <div className="text-center py-6 text-slate-400 text-xs">Chưa có thông báo nào</div>
                      ) : (
                        logic.notifications.map((n: any) => (
                           <div key={n.id} className={`relative p-3 rounded-xl border ${n.isRead ? 'bg-white border-transparent' : 'bg-indigo-50/50 border-indigo-100'} flex gap-3 group`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${n.type === 'REWARD' ? 'bg-amber-100 text-amber-600' : n.type === 'DISCIPLINE' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                 {n.type === 'REWARD' ? <Gift size={14} /> : n.type === 'DISCIPLINE' ? <ShieldAlert size={14} /> : <MessageSquare size={14} />}
                              </div>
                              <div className="flex-1 pr-6">
                                 <h4 className={`text-xs font-bold ${n.isRead ? 'text-slate-700' : 'text-indigo-900'}`}>{n.title}</h4>
                                 <p className="text-[11px] text-slate-500 mt-0.5">{n.message}</p>
                              </div>
                              {!n.isRead && (
                                <button
                                  onClick={() => logic.markNotificationAsRead(n.id)}
                                  className="absolute top-3 right-3 p-1 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors"
                                  title="Đánh dấu đã đọc"
                                >
                                  <CheckCircle2 size={16} />
                                </button>
                              )}
                           </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      
      {(!booking || !booking.id) ? (
        <div className="space-y-4">
          
          {/* ─── HERO SECTION (ALERTS) ─── */}
          
          {/* 1. Có Đơn Mới (Highest Priority) */}
          {logic.booking?.nextBookingId ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="p-6 rounded-[32px] bg-gradient-to-br from-emerald-500 to-teal-600 shadow-xl shadow-emerald-200/50 relative overflow-hidden"
            >
              <div className="absolute -top-12 -right-12 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
              <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-start gap-4 text-white">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center shrink-0 border border-white/30">
                    <Sparkles size={24} className="animate-pulse" />
                  </div>
                  <div>
                    <p className="font-black text-lg uppercase tracking-tight mb-1">Đơn mới đã sẵn sàng!</p>
                    <p className="text-sm font-medium text-emerald-50">
                      {logic.booking.nextServiceName || 'Dịch vụ'}{logic.booking.nextStartTime ? ` • ${logic.booking.nextStartTime}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => logic.goToDashboard(logic.booking.nextBookingId)}
                  className="w-full py-4 bg-white text-emerald-700 font-black rounded-2xl text-sm uppercase tracking-widest shadow-lg shadow-emerald-900/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <Play size={16} fill="currentColor" />
                  NHẬN ĐƠN NGAY
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  className="text-xs font-bold text-emerald-100 hover:text-white underline text-center opacity-80"
                >
                  Tôi muốn từ chối tua này
                </button>
              </div>
            </motion.div>
          ) : (
            /* 2. Trạng Thái Rảnh (Idle) */
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="p-8 rounded-[32px] bg-white border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[180px]"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-slate-50/50 to-transparent"></div>
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 relative z-10">
                 <Coffee size={28} className="text-slate-400" />
              </div>
              <h3 className="text-lg font-bold text-slate-700 mb-2 relative z-10">Đang chờ điều phối...</h3>
              <p className="text-xs text-slate-400 font-medium relative z-10">
                Hãy thư giãn, hệ thống sẽ báo ngay khi có khách.
              </p>
            </motion.div>
          )}

          {/* Cảnh Báo Tua Đầu & Nợ Bàn Giao */}
          {isFirstInQueue && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-red-50 p-4 rounded-3xl border border-red-100 flex items-center gap-3">
              <AlertTriangle size={20} className="text-red-500 animate-pulse shrink-0" />
              <div>
                <h3 className="font-bold text-xs text-red-700 uppercase tracking-widest">Tua Đầu - Chú ý</h3>
                <p className="text-[10px] text-red-600/80 font-medium">Bạn đang đứng tua đầu! Hãy kiểm tra châm nước phòng.</p>
              </div>
            </motion.div>
          )}

          {logic.pendingHandovers?.length > 0 && (
            <div className="bg-amber-50 p-4 rounded-3xl border border-amber-100">
              <div className="flex items-center justify-between mb-2">
                 <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-amber-600" />
                    <h3 className="font-bold text-xs text-amber-900 uppercase tracking-widest">Nợ bàn giao ({logic.pendingHandovers.length})</h3>
                 </div>
              </div>
              <div className="space-y-2">
                {logic.pendingHandovers.map((item: any) => (
                  <div key={item.id} onClick={() => logic.handleSelectDebt(item.bookingId)} className="bg-white p-2.5 rounded-2xl flex items-center justify-between border border-amber-100 cursor-pointer hover:bg-amber-100/50">
                    <span className="text-xs font-bold text-slate-700">#{item.guest_index ? `${(item.Bookings?.billCode || '').split('-')[0]}-${String.fromCharCode(64 + item.guest_index)}` : ((item.Bookings?.billCode || '---').split('-')[0])} <span className="text-[10px] text-slate-400 font-normal ml-1">P.{item.roomId}</span></span>
                    <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-2 py-1 rounded-lg">Chưa nộp</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── BENTO GRID ─── */}
          <div className="flex flex-col gap-4">

             {/* ─── GRID 2x2: Điểm, Sức Bền, Chỉ Tiêu, Mã QR ─── */}
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* 1. Điểm chuyên cần */}
                {logic.disciplineStatus && (
                   <div className={`p-4 rounded-[32px] border ${logic.disciplineStatus.totalPoints <= logic.disciplineStatus.demotionThreshold + 5 ? 'bg-red-50 border-red-100' : 'bg-white border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]'} flex flex-col items-center justify-center relative`}>
                      <h3 className="font-bold text-[10px] uppercase tracking-widest mb-3 flex items-center gap-1.5 text-slate-500">
                         <ShieldAlert size={14} /> Điểm số
                      </h3>
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center border-4 ${logic.disciplineStatus.totalPoints <= logic.disciplineStatus.demotionThreshold + 5 ? 'border-red-500 text-red-600 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse' : 'border-indigo-500 text-indigo-700'}`}>
                         <span className="font-black text-xl">{logic.disciplineStatus.totalPoints}</span>
                      </div>
                   </div>
                )}

                {/* 2. Sức bền (Hình tròn) */}
                {logic.disciplineStatus && (
                   <div className="bg-white p-4 rounded-[32px] border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center justify-center relative">
                      <h3 className="font-bold text-[10px] uppercase tracking-widest mb-3 flex items-center gap-1.5 text-slate-500">
                         <Dumbbell size={14} /> Sức bền
                      </h3>
                      <div className="w-16 h-16 rounded-full flex items-center justify-center border-4 border-amber-500 text-amber-600 shadow-[0_0_15px_rgba(245,158,11,0.1)] relative">
                         <span className="font-black text-sm">{Math.floor(logic.disciplineStatus.continuousWorkMins / 60)}h{logic.disciplineStatus.continuousWorkMins % 60}m</span>
                         <span className="text-[10px] absolute -bottom-2 bg-white font-bold px-1 rounded-sm text-slate-400 border border-slate-100">/ {logic.disciplineStatus.exemptHours}h</span>
                      </div>
                   </div>
                )}

                {/* 3. Chỉ tiêu tháng (Hình tròn cam) */}
                {kpiData && kpiData.targetHours > 0 && (
                   <div className="bg-white p-4 rounded-[32px] border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center justify-center relative">
                      <h3 className="font-bold text-[10px] uppercase tracking-widest mb-3 flex items-center gap-1.5 text-slate-500">
                         <Target size={14} /> Chỉ tiêu
                      </h3>
                      <div className="w-16 h-16 rounded-full flex items-center justify-center border-4 border-orange-500 text-orange-600 shadow-[0_0_15px_rgba(249,115,22,0.1)] relative">
                         <span className="font-black text-xl">{kpiData.totalHours}</span>
                         <span className="text-[10px] absolute -bottom-2 bg-white font-bold px-1 rounded-sm text-slate-400 border border-slate-100">/ {kpiData.targetHours}h</span>
                      </div>
                   </div>
                )}

                {/* 4. Nút mở Mã QR */}
                <button onClick={() => setShowQRModal(true)} className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-[32px] shadow-lg text-white flex flex-col items-center justify-center relative active:scale-95 transition-transform">
                   <h3 className="font-bold text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1.5 text-indigo-100">
                      Mã QR Khách
                   </h3>
                   <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/30">
                      <QrCode size={32} />
                   </div>
                </button>
             </div>
          </div>
          


          {/* QR Modal (Backdrop Blur) */}
          <AnimatePresence>
             {showQRModal && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
                  onClick={() => setShowQRModal(false)}
                >
                   <motion.div
                     initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                     className="bg-white rounded-[40px] p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center"
                     onClick={e => e.stopPropagation()}
                   >
                      <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-6">
                         <QrCode size={32} />
                      </div>
                      <h2 className="text-xl font-black text-slate-800 mb-2">Quét để đặt lịch</h2>
                      <p className="text-sm font-medium text-slate-500 mb-8">Đưa khách hàng quét mã này để truy cập Menu và Đặt lịch hẹn.</p>
                      
                      <div className="p-4 bg-white rounded-3xl shadow-[0_0_40px_rgba(0,0,0,0.08)] border border-slate-100 mb-8">
                         <WebBookingQR url={bookingUrl} />
                      </div>

                      <button
                        onClick={() => setShowQRModal(false)}
                        className="w-full py-4 bg-slate-100 text-slate-700 font-bold rounded-2xl active:scale-95 transition-transform"
                      >
                         Đóng
                      </button>
                   </motion.div>
                </motion.div>
             )}
          </AnimatePresence>

        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Booking Card - ONLY SHOW ASSIGNED ITEM */}
          <div className={`${THEME.bgCard} ${THEME.border} ${THEME.radius} overflow-hidden border shadow-sm p-6 pb-0`}>
              <div className="mb-4">
                   <div className="flex flex-col">
                      <h3 className="font-black text-3xl text-emerald-700 leading-tight tracking-tight flex items-center gap-2 flex-wrap">
                        {item.guest_label && (
                           <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-xl text-lg flex items-center gap-1 shrink-0 border border-emerald-200">
                             👨 {item.guest_label}
                           </span>
                        )}
                        <span>{allServiceNames.length > 1 ? formatMultiServiceNames(ktvSegments) : item.service_name}</span>
                      </h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-sm font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{totalAssignedMins || item.duration} phút</span>
                        {allServiceNames.length > 1 && <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-lg">{allServiceNames.length} DV</span>}
                        <ServiceTypeLabel serviceId={item.serviceId} />
                        <span className="text-base font-black text-slate-800 truncate block mt-0.5 flex-1 min-w-[120px]">
                          {item.guest_index ? `[Khách ${String.fromCharCode(64 + item.guest_index)}] ` : ''}{item.guest_customer_name || booking.customerName || booking.customerEmail || 'Khách vãng lai'}
                        </span>
                        <span className="text-sm font-black text-slate-800 shrink-0">#{item.guest_index ? `${(booking.billCode || '').split('-')[0]}-${String.fromCharCode(64 + item.guest_index)}` : (booking.billCode || '').split('-')[0]}</span>
                      </div>
                      {coWorkers.length > 0 && (
                        <p className="mt-2 text-[10px] font-bold text-indigo-500 uppercase tracking-tighter">Cùng làm với {coWorkers.join(', ')}</p>
                      )}
                   </div>
              </div>

              <div className="flex justify-between items-end mb-6 flex-wrap gap-2">
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
                  className="text-emerald-600 text-xs font-bold flex items-center gap-1 underline mb-2 shrink-0"
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
                    totalAssignedMins={totalAssignedMins}
                  />
                </div>
              )}

              {/* Special Requirements (Same as Timer Screen) */}
              <CollapsibleRequirements booking={booking} />
          </div>

          {/* Setup Checklist */}
          <div>
            <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
              <h3 className={`font-bold ${THEME.textBase} flex items-center gap-2 uppercase text-[11px] tracking-widest min-w-[120px]`}>
                <CheckCircle size={18} className={THEME.gold} />
                Quy trình chuẩn bị
              </h3>
              <button 
                 onClick={checkAllChecklist}
                 className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg active:scale-95 transition-all uppercase tracking-widest border border-emerald-100 shadow-sm shrink-0 whitespace-nowrap"
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

      {/* Reject Order Modal */}
      <RejectOrderModal 
        isOpen={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        onSubmit={handleRejectOrder}
        disciplineStatus={logic.disciplineStatus}
        isExempted={logic.disciplineStatus ? logic.disciplineStatus.continuousWorkMins >= logic.disciplineStatus.exemptHours * 60 : false}
      />
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
    isPaused,
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
      apiClient.get<any>(API.KTV.SETTINGS)
          .then(json => {
              if (json.data?.min_photo_brightness !== undefined) {
                  setMinBrightness(Number(json.data.min_photo_brightness));
              }
          })
          .catch(() => { /* use fallback */ });
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
          const watermarkText = `Room ${booking?.assignedRoomId || booking?.roomName || ''}`;
          const compressed = await compressImageWithWatermark(file, {
              minBrightness,
              watermarkText
          });
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
  const allTimerItemsRaw = allTimerItemIds.length > 0
    ? booking?.BookingItems?.filter((i: any) => allTimerItemIds.includes(i.id)) || []
    : [booking?.BookingItems?.[0]].filter(Boolean);
  // 🔥 Filter out merged child items
  const hasTimerMergedChildren = allTimerItemsRaw.some((i: any) => i.options?.mergedIntoId);
  const allTimerItems = hasTimerMergedChildren
    ? allTimerItemsRaw.filter((i: any) => !i.options?.mergedIntoId)
    : allTimerItemsRaw;
  const item = allTimerItems[0] || {};
  // Tên: lấy danh sách tên từ TẤT CẢ các item (kể cả item con đã gộp) để UI Timer biết có bao nhiêu dịch vụ
  const allTimerServiceNames = allTimerItemsRaw.map((i: any) => i.service_name).filter(Boolean);
  
  // Segments: dùng allTimerItemsRaw để tính tổng duration chính xác
  const allTimerKtvSegments = allTimerItemsRaw.flatMap((i: any) => {
    let segs = [];
    if (typeof i?.segments === 'string') {
        try { segs = JSON.parse(i.segments); } catch (e) { segs = []; }
    } else if (Array.isArray(i?.segments)) {
        segs = i.segments;
    }
    return segs
      .filter((s: any) => s.ktvId?.toLowerCase() === logic.ktvId?.toLowerCase())
      .map((s: any) => {
        let customName = undefined;
        try {
            const opts = typeof i.options === 'string' ? JSON.parse(i.options) : (i.options || {});
            customName = opts?.serviceNamesForKtvs?.[s.ktvId || logic.ktvId];
        } catch(e) {}
        return { ...s, _itemId: i.id, _serviceName: customName || i.service_name };
      });
  }).sort((a: any, b: any) => {
      const timeA = a.startTime || '23:59';
      const timeB = b.startTime || '23:59';
      return timeA.localeCompare(timeB);
  });
  // Khi đã gộp, chỉ dùng segments từ item cha cho UI
  const ktvSegments = hasTimerMergedChildren
    ? allTimerKtvSegments.filter((s: any) => allTimerItems.some((i: any) => i.id === s._itemId))
    : allTimerKtvSegments;
  
  const uniqueItemIds = new Set(ktvSegments.map((s: any) => s._itemId));
  const uniqueRoomIds = new Set(ktvSegments.map((s: any) => s.roomId || 'unknown'));
  const hasFinishedSegment = ktvSegments.some((s: any) => s.actualEndTime);
  const allFinished = ktvSegments.length > 0 && ktvSegments.every((s: any) => s.actualEndTime);
  const isFinishedMerge = allFinished && ktvSegments[0].actualEndTime === ktvSegments[ktvSegments.length - 1].actualEndTime;
  const shouldMerge = hasTimerMergedChildren || (ktvSegments.length > 1 && uniqueItemIds.size === ktvSegments.length && uniqueRoomIds.size === 1 && !hasFinishedSegment);

  const totalAssignedMins = allTimerKtvSegments.reduce((sum: number, seg: any) => sum + (Number(seg.duration) || 0), 0);
  const currentSeg = ktvSegments.length > 0 ? ktvSegments[activeSegmentIndex || 0] : null;
  const nextSeg = ktvSegments.length > (activeSegmentIndex + 1) && !shouldMerge ? ktvSegments[activeSegmentIndex + 1] : null;

  // 🕒 CHỈ HIỂN THỊ THỜI GIAN CỦA CHẶNG HIỆN TẠI (trừ phi được gộp)
  const displayDuration = shouldMerge ? totalAssignedMins : (currentSeg ? (Number(currentSeg.duration) || 60) : ((item.duration != null && item.duration !== '' ? Number(item.duration) : 60)));

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
    <div className="p-4 md:p-8 h-full flex flex-col pt-8 md:pt-12 md:max-w-4xl md:mx-auto w-full">
      {/* Header Info */}
      <div className="flex justify-between items-start mb-6 px-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-black text-emerald-700 leading-tight tracking-tight flex items-center gap-2 flex-wrap">
            {item.guest_label && (
               <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-xl text-lg flex items-center gap-1 shrink-0 border border-emerald-200">
                 👨 {item.guest_label}
               </span>
            )}
            <span>{allTimerServiceNames.length > 1 ? formatMultiServiceNames(ktvSegments) : item.service_name}</span>
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
            <ServiceTypeLabel serviceId={item.serviceId} />
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

      {/* Rejected Handover Alert */}
      {item?.handover_status === 'REJECTED' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="mx-2 mb-6 p-4 rounded-3xl bg-rose-50 border border-rose-200 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-2 text-rose-700">
            <AlertTriangle size={18} />
            <h3 className="font-bold text-sm uppercase tracking-widest">Lễ tân yêu cầu dọn lại</h3>
          </div>
          {item?.handover_comment && (
            <p className="text-sm font-medium text-rose-800 bg-white p-3 rounded-2xl mb-3 border border-rose-100 shadow-sm">
              "{item.handover_comment}"
            </p>
          )}
          {item?.handover_reject_images && Array.isArray(item.handover_reject_images) && item.handover_reject_images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.handover_reject_images.map((url: string, idx: number) => (
                <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden border border-rose-200 bg-white shadow-sm flex-shrink-0 cursor-pointer" onClick={() => window.open(url, '_blank')}>
                  <img src={url} alt={`Reject ${idx + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Main Timer Display */}
      <div className="flex flex-col items-center justify-center pb-8">
        <div className="relative w-64 h-64 flex items-center justify-center">
          {/* Subtle Background Ring (always there) */}
          <div className="absolute inset-0 rounded-full border-[12px] border-slate-50 opacity-50"></div>
          
          <svg className="absolute inset-0 w-full h-full transform -rotate-90 drop-shadow-sm">
            <circle
              cx="128" cy="128" r="115" stroke="currentColor" strokeWidth="12" fill="transparent"
              className={`${isPaused ? 'text-amber-500' : isPrepping ? 'text-blue-400' : 'text-emerald-500'} transition-all duration-1000 ease-linear shadow-inner`}
              strokeDasharray={2 * Math.PI * 115}
              strokeDashoffset={2 * Math.PI * 115 * (1 - progress / 100)}
              strokeLinecap="round"
            />
          </svg>
          
          <div className="text-center z-10">
            <div className={`text-6xl font-black ${isPaused ? 'text-amber-500' : isPrepping ? 'text-blue-600' : 'text-slate-800'} tracking-tighter tabular-nums`}>
              {formatTime(currentSecs)}
            </div>
            <div className={`mt-3 px-4 py-1.5 rounded-full border font-black text-[10px] tracking-widest uppercase flex items-center justify-center gap-1.5
              ${isPaused ? 'bg-amber-50 text-amber-600 border-amber-200' : isPrepping ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
              {isPrepping && !isPaused && <Clock size={12} className="animate-pulse" />}
              {isPaused ? <><AlertCircle size={12} /> ĐANG TẠM DỪNG</> : isPrepping ? 'THỜI GIAN CHUẨN BỊ' : (isTimerRunning ? 'ĐANG THỰC HIỆN' : 'ĐỢI BẮT ĐẦU')}
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
            totalAssignedMins={totalAssignedMins}
          />
        </div>
      )}



      {/* Primary Action Button */}
      <div className="px-6 mb-10">
        {(!isTimerRunning && !isPaused) || isPrepping ? (
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
                <label className="relative flex-[2] h-16 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-black text-xs shadow-xl shadow-emerald-200/50 rounded-[32px] flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-45 disabled:active:scale-100">
                  <Camera size={18} />
                  {logic.canStart ? 'CHỤP ẢNH ĐỂ BẮT ĐẦU' : 'CHƯA ĐẾN GIỜ'}
                  <input type="file" accept="image/*" capture="environment" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={handleFileUpload} disabled={logic.isLoading || !logic.canStart} />
                </label>
                <label className="relative flex-[0.8] h-16 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-[32px] flex flex-col items-center justify-center cursor-pointer transition-all active:scale-[0.98] disabled:opacity-40">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Tải ảnh</span>
                  <input type="file" accept="image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={handleFileUpload} disabled={logic.isLoading || !logic.canStart} />
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

      {/* 2x2 Action Grid + Emergency Wide - ONLY SHOW WHEN RUNNING OR PAUSED */}
      {(isTimerRunning || isPaused) && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="flex flex-col gap-3 mb-12"
        >
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <ActionGridButton 
                  onClick={handleEarlyExit} 
                  icon={<LogOut size={20} />} 
                  label="KHÁCH VỀ SỚM" 
                  color="text-rose-600 border-rose-50" 
                />
                <ActionGridButton 
                  onClick={() => handleInteraction('WATER')} 
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
                  onClick={() => handleInteraction('SUPPORT')} 
                  icon={<HelpCircle size={20} />} 
                  label="HỖ TRỢ" 
                  color="text-blue-600 border-blue-50" 
                />
                {isPaused ? (
                    <ActionGridButton 
                      onClick={() => {}} 
                      icon={<Lock size={20} />} 
                      label="CHỜ QUẦY MỞ" 
                      color="text-slate-400 border-slate-100 bg-slate-50 opacity-70" 
                    />
                ) : (
                    <ActionGridButton 
                      onClick={logic.handlePause} 
                      icon={<PauseCircle size={20} />} 
                      label="TẠM DỪNG" 
                      color="text-amber-600 border-amber-50" 
                    />
                )}
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
  const { handoverPhotosBase64, setHandoverPhotosBase64, isHandoverComplete, handleFinishHandover, booking, minBrightness = 40 } = logic;
  const { dynamicChecklist = [], isFetchingChecklist, handleSkipHandover, isSkippingHandover } = logic;
  
  // V5: Use dynamic checklist from API, fallback to old checklist from booking
  let checklist: string[] = dynamicChecklist.length > 0
    ? dynamicChecklist.map((c: any) => c.label)
    : (booking?.handoverChecklist || []);

  // Nếu cả 2 đều rỗng (chưa cài đặt), fallback về 1 mục chung để giữ giao diện lưới
  if (checklist.length === 0) {
      checklist = ['Ảnh tổng quan phòng'];
  }

  // V5: Show skip button only if there's a next order
  const hasNextOrder = !!booking?.nextBookingId;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, itemKey?: string) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      logic.setIsLoading?.(true);
      
      const newPhotos: string[] = [];
      const watermarkText = `Room ${booking?.assignedRoomId || booking?.roomName || ''} - Handover`;

      for (const file of files) {
          try {
              const compressed = await compressImageWithWatermark(file, { minBrightness: 0, watermarkText });
              newPhotos.push(compressed);
          } catch (err: any) {
              if (err?.message === 'TOO_DARK') {
                  alert(`⚠️ Ảnh quá tối! Vui lòng chụp lại ở nơi đủ ánh sáng.`);
              } else {
                  const base64 = await new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onload = (ev) => resolve(ev.target?.result as string);
                      reader.readAsDataURL(file);
                  });
                  if (base64) newPhotos.push(base64);
              }
          }
      }
      
      if (newPhotos.length > 0) {
          setHandoverPhotosBase64((prev: Record<string, string>) => {
              const updated = { ...prev };
              let timestamp = Date.now();
              newPhotos.forEach((photo) => {
                  updated[timestamp.toString()] = photo;
                  timestamp++;
              });
              return updated;
          });
      }
      logic.setIsLoading?.(false);
      if (e.target) e.target.value = '';
  };

  return (
    <div className="p-6 md:p-10 pt-12 md:pt-16 space-y-8 md:max-w-2xl md:mx-auto w-full">
      <div className="text-center space-y-2">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Sparkles className="text-blue-600" size={40} />
        </div>
        <h2 className="text-2xl font-black text-slate-800">Bàn giao phòng</h2>
        <p className="text-slate-500 font-medium">Chụp ảnh từng mục bàn giao theo danh sách.</p>
      </div>

      <div className="space-y-4">
          <div className="space-y-3">
             <div className="flex items-center justify-between px-1">
                 <span className="text-sm font-bold text-slate-700">Yêu cầu bàn giao</span>
                 <span className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                     {isFetchingChecklist ? <Loader2 size={12} className="animate-spin inline-block" /> : `${Object.keys(handoverPhotosBase64).length}/${checklist.length}`}
                 </span>
             </div>
             
             {/* Danh sách yêu cầu */}
             <div className="bg-slate-50 p-4 rounded-2xl border-2 border-slate-100">
                 {isFetchingChecklist ? (
                     <div className="space-y-2 animate-pulse">
                         <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                         <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                     </div>
                 ) : (
                     <ul className="space-y-2">
                         {checklist.map((item, idx) => (
                             <li key={idx} className="flex flex-col gap-0.5">
                                 <div className="flex items-start gap-2">
                                     <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                                     <span className="text-xs font-semibold text-slate-700">{item}</span>
                                 </div>
                                 {dynamicChecklist[idx]?.source && (
                                     <span className="text-[10px] text-slate-400 ml-3.5">
                                         Từ {dynamicChecklist[idx]?.source === 'room' ? 'Phòng' : 'Dịch vụ'}
                                     </span>
                                 )}
                             </li>
                         ))}
                     </ul>
                 )}
             </div>

             {/* Khu vực Upload */}
             <div className="pt-2">
                 <label className="w-full flex items-center justify-center gap-2 py-4 bg-blue-50 text-blue-600 border-2 border-dashed border-blue-200 rounded-2xl cursor-pointer active:scale-95 transition-all hover:bg-blue-100/50">
                     <Camera size={20} />
                     <span className="font-bold text-sm">Chụp / Tải ảnh lên</span>
                     <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFileUpload(e)} disabled={logic.isLoading} />
                 </label>
             </div>

             {/* Grid Ảnh Đã Up */}
             {Object.keys(handoverPhotosBase64).length > 0 && (
                 <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-4">
                     {Object.entries(handoverPhotosBase64).map(([key, photo]) => (
                         <div key={key} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm group">
                             <img src={photo as string} className="absolute inset-0 w-full h-full object-cover" alt="Uploaded" />
                             <button 
                                 onClick={() => {
                                     const newPhotos = { ...handoverPhotosBase64 };
                                     delete newPhotos[key];
                                     setHandoverPhotosBase64(newPhotos);
                                 }}
                                 className="absolute top-1 right-1 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-rose-500 transition-colors"
                             >
                                 <X size={14} />
                             </button>
                         </div>
                     ))}
                 </div>
             )}
          </div>
      </div>

      {/* Room Issue Report Button */}
      <button
        onClick={() => logic.setShowRoomIssueModal(true)}
        className="w-full py-3 rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/50 text-rose-600 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-rose-100/50"
      >
        <AlertTriangle size={16} />
        Báo sự cố phòng
      </button>

      {/* Nút tích hợp V5: Xử lý dựa trên hasNextOrder và isHandoverComplete */}
      <button
        disabled={logic.isLoading || isSkippingHandover}
        onClick={() => {
            if (!isHandoverComplete) {
                if (hasNextOrder) {
                    // Nếu có đơn mới và chưa chụp ảnh -> Cho nợ ảnh và qua đơn luôn
                    handleSkipHandover();
                } else {
                    // Nếu không có đơn mới mà chưa chụp ảnh -> Hỏi cảnh báo phạt
                    if (!window.confirm("Bạn chưa chụp đủ ảnh bàn giao, nếu bỏ qua sẽ bị phạt. Nếu bạn đã bàn giao có thể bỏ qua.")) {
                        return;
                    }
                    handleFinishHandover();
                }
            } else {
                handleFinishHandover();
            }
        }}
        className={`w-full py-5 rounded-[24px] font-black text-sm uppercase tracking-widest shadow-xl transition-all
        ${isHandoverComplete 
            ? 'bg-blue-600 text-white shadow-blue-200' 
            : (hasNextOrder ? 'bg-amber-500 text-white shadow-amber-200' : 'bg-rose-500 text-white shadow-rose-200')}`}
      >
        {logic.isLoading || isSkippingHandover 
          ? 'Đang xử lý...' 
          : (isHandoverComplete 
              ? (hasNextOrder ? 'Xong & Nhận đơn mới' : 'Xong & Sẵn sàng đón khách') 
              : (hasNextOrder ? '⏭ Bỏ qua — Nhận đơn mới' : 'Bỏ qua')
            )
        }
      </button>

    </div>
  );
}



function ScreenReward({ logic }: { logic: any }) {
  const { commission, goToDashboard, booking, ktvId } = logic;
  const [rating, setRating] = React.useState(5);
  const [note, setNote] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSubmitted, setIsSubmitted] = React.useState(false);
  const [images, setImages] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setUploading(true);
    try {
      const file = e.target.files[0];
      const ext = file.name.split('.').pop();
      const fileName = `ktv_review_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
      const { data, error } = await supabase.storage.from('task-photos').upload(fileName, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('task-photos').getPublicUrl(fileName);
      if (urlData?.publicUrl) {
        setImages(prev => [...prev, urlData.publicUrl]);
      }
    } catch (err) {
      console.error('Lỗi tải ảnh:', err);
      alert('Tải ảnh thất bại!');
    } finally {
      setUploading(false);
    }
  };

  const submitReview = async () => {
    if (!booking?.id || !ktvId) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/ktv/review-reception', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          techCode: ktvId,
          rating,
          note,
          images
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsSubmitted(true);
      } else {
        alert(data.error || 'Có lỗi xảy ra');
      }
    } catch (err) {
      alert('Không thể gửi đánh giá');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-full flex flex-col items-center justify-start text-center space-y-4 md:space-y-6 pt-10 md:pt-16 pb-20 overflow-y-auto md:max-w-2xl md:mx-auto w-full">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1, rotate: [0, 10, -10, 0] }}
        className="w-20 h-20 bg-amber-100 rounded-[28px] flex items-center justify-center shadow-xl shadow-amber-100 shrink-0 mt-6"
      >
        <Gift className="text-amber-600" size={40} />
      </motion.div>

      <div className="space-y-1">
        <h2 className="text-lg font-black text-slate-800 tracking-tight">Chúc mừng!</h2>
        <p className="text-xs text-slate-500 font-bold px-4">Bạn vừa nhận được tiền tua phục vụ</p>
      </div>

      <div className="bg-white border-2 border-amber-100 rounded-[24px] p-4 w-full shadow-lg max-w-[280px]">
        <span className="text-[9px] font-black text-amber-600 uppercase tracking-[0.2em] block mb-1">Tua bạn nhận được</span>
        <div className="text-3xl font-black text-slate-800 tabular-nums">+{commission.toLocaleString('vi-VN')}đ</div>
      </div>

      {/* --- FORM ĐÁNH GIÁ QUẦY --- */}
      <div className="w-full max-w-[280px] bg-slate-50 border border-slate-100 p-4 rounded-3xl mt-4">
        {!isSubmitted ? (
          <>
            <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest mb-3">Đánh giá Quầy Lễ Tân</h3>
            
            {/* Rating Stars */}
            <div className="flex justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} onClick={() => setRating(star)} className="focus:outline-none transition-transform active:scale-90">
                  <Star size={24} className={star <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
                </button>
              ))}
            </div>

            {/* Note */}
            <textarea
              placeholder="Nhập nhận xét của bạn về sự hỗ trợ của Quầy (Tuỳ chọn)..."
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full h-20 px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300 mb-3 bg-white resize-none"
            />

            {/* Images */}
            <div className="flex gap-2 overflow-x-auto mb-3">
              {images.map((img, idx) => (
                <img key={idx} src={img} alt="review" className="w-12 h-12 rounded-lg object-cover border border-slate-200" />
              ))}
              {images.length < 3 && (
                <label className="w-12 h-12 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors shrink-0">
                  {uploading ? <Loader2 size={16} className="animate-spin text-slate-400" /> : <Camera size={16} className="text-slate-400" />}
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleUploadImage} disabled={uploading} />
                </label>
              )}
            </div>

            <button
              onClick={submitReview}
              disabled={isSubmitting}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest shadow-md active:scale-95 transition-all flex justify-center items-center gap-2"
            >
              {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} GỬI ĐÁNH GIÁ
            </button>
          </>
        ) : (
          <div className="py-4 flex flex-col items-center">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-2">
              <CheckCircle2 size={24} className="text-emerald-600" />
            </div>
            <p className="text-xs font-bold text-slate-700">Cảm ơn bạn đã đánh giá!</p>
          </div>
        )}
      </div>
      {/* ------------------------- */}

      <button
        onClick={() => goToDashboard(booking?.nextBookingId)}
        className={`w-full max-w-[280px] py-4 rounded-[20px] font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 mt-4
          ${booking?.nextBookingId 
            ? 'bg-amber-600 text-white shadow-amber-200' 
            : 'bg-slate-900 text-white'}`}
      >
        {booking?.nextBookingId ? (
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
                      <Dumbbell size={16} /> Lực: {normalizeStrength(item.strength)}
                    </div>
                  )}
                  {item.focus && (
                    <div className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-[13px] font-black border border-emerald-100 flex items-center gap-2">
                      <Target size={16} /> Tập trung: {formatBodyAreas(item.focus)}
                    </div>
                  )}
                  {item.avoid && (
                    <div className="px-4 py-2 bg-rose-50 text-rose-700 rounded-xl text-[13px] font-black border border-rose-100 flex items-center gap-2">
                      <Ban size={16} /> Tránh: {formatBodyAreas(item.avoid)}
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

function ProcedureModal({ isOpen, onClose, procedure, serviceName, isVip }: { isOpen: boolean, onClose: () => void, procedure: any, serviceName: string, isVip?: boolean }) {
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
             {isVip ? (
                 <div className="space-y-4">
                     <div className="flex gap-4">
                        <span className="text-emerald-500 font-black">01.</span>
                        <p>Làm theo: {serviceName}</p>
                     </div>
                 </div>
             ) : procedure ? (
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

function RejectOrderModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isExempted, 
  disciplineStatus 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onSubmit: (reason: string) => void, 
  isExempted: boolean,
  disciplineStatus: any
}) {
  const [reason, setReason] = React.useState('');
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full sm:max-w-md max-h-[90vh] rounded-t-[32px] sm:rounded-[32px] shadow-2xl overflow-hidden flex flex-col"
      >
        <div className={`${isExempted ? 'bg-emerald-600' : 'bg-rose-600'} p-6 text-white flex items-center justify-between`}>
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
              <Ban size={20} />
              Từ Chối Nhận Đơn
            </h3>
          </div>
          <button onClick={onClose} className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isExempted ? (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl text-emerald-800 text-sm font-bold flex gap-3 items-start">
               <ShieldAlert size={20} className="shrink-0 text-emerald-600 mt-0.5" />
               <p>
                 ✅ Bạn đã làm việc liên tục {Math.floor((disciplineStatus?.continuousWorkMins || 0) / 60)}h {(disciplineStatus?.continuousWorkMins || 0) % 60}m (đạt ngưỡng miễn phạt). <br/>
                 Bạn có thể từ chối đơn này để nghỉ ngơi mà <b>KHÔNG bị trừ điểm.</b>
               </p>
            </div>
          ) : (
            <div className="bg-rose-50 border border-rose-200 p-4 rounded-2xl text-rose-800 text-sm font-bold flex gap-3 items-start">
               <ShieldAlert size={20} className="shrink-0 text-rose-600 mt-0.5" />
               <p>
                 ⚠️ Từ chối nhận đơn sẽ bị <b>trừ 10 điểm chuyên cần</b>.<br/> 
                 Việc này sẽ ảnh hưởng trực tiếp đến thi đua và cấp bậc KTV của bạn!
               </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lý do từ chối (bắt buộc)</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Sức khoẻ không đảm bảo, kẹt xe..."
              className="w-full p-4 rounded-2xl border-2 border-slate-100 focus:border-indigo-300 focus:ring-0 outline-none text-sm font-bold text-slate-700 resize-none h-24 placeholder:text-slate-300"
            />
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 space-y-2">
          <button
            onClick={() => {
               if (!reason.trim()) return alert("Vui lòng nhập lý do từ chối!");
               onSubmit(reason);
            }}
            className={`w-full py-4 ${isExempted ? 'bg-emerald-600 shadow-emerald-200' : 'bg-rose-600 shadow-rose-200'} text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2`}
          >
            Xác nhận từ chối đơn
          </button>
          <button
            onClick={onClose}
            className="w-full py-3 text-slate-400 font-bold text-xs uppercase tracking-widest"
          >
            Huỷ, tôi sẽ nhận đơn
          </button>
        </div>
      </motion.div>
    </div>
  );
}

