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
  ClipboardList, BookOpen, PlusSquare, PauseCircle, MicOff, Users, Loader2, ChevronUp, Ban, ScrollText, ClipboardCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useKTVDashboard } from './KTVDashboard.logic';
import { ROOM_ISSUE_OPTIONS } from './KTVDashboard.logic';
import { useNotifications } from '@/components/NotificationProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { supabase } from '@/lib/supabase';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { formatBodyAreas, normalizeStrength } from '@/lib/booking.logic';
import { THEME, ANIMATION, DEFAULT_BOOKING_URL, formatMultiServiceNames, WebBookingQR, ServiceTypeLabel } from './_shared/ui';
import { ActionGridButton, ChecklistItem, RatingCard, CollapsibleRequirements } from './_shared/components';
import { ProcedureModal, RoomIssueModal, RejectOrderModal, TurnQueueTypeDModal, OfficeScoreModal } from './_components/modals';
import { ScreenTimer, WorkingTimeline } from './_screens/ScreenTimer';
import { ScreenReview } from './_screens/ScreenReview';
import { ScreenHandover } from './_screens/ScreenHandover';
import { ScreenReward } from './_screens/ScreenReward';
import { ScreenDashboard } from './_screens/ScreenDashboard';

// ----------------------------------------------------
// MAIN COMPONENT
// ----------------------------------------------------

function KTVDashboardContent() {
  const searchParams = useSearchParams();
  const action = searchParams.get('action');
  const bookingId = searchParams.get('bookingId');
  const { setKtvScreen, setKtvOrderLocked } = useNotifications();

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

  // 🔒 Khoá menu NGAY khi đơn đã được nhận, đừng đợi màn đồng hồ hiện ra.
  //
  // `acceptedAt` do server đóng dấu lúc bấm "Nhận đơn". Khoá theo màn hình thì
  // hở một nhịp: bấm xong màn hình còn ở Dashboard cho tới khi lượt nạp tiếp
  // theo trả về, đúng lúc đó menu vẫn mở.
  //
  // Mở lại ở REWARD — tới đó phòng đã bàn giao xong.
  const orderLocked = !!booking?.acceptedAt && screen !== 'REWARD';
  React.useEffect(() => {
    setKtvOrderLocked(orderLocked);
  }, [orderLocked, setKtvOrderLocked]);

  // Rời trang thì nhả khoá, không thì kẹt menu ở mọi trang khác.
  React.useEffect(() => () => setKtvOrderLocked(false), [setKtvOrderLocked]);

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





/** Chi tiết điểm Office: lỗi bị trừ hôm nay + tổng kết tháng. */




























