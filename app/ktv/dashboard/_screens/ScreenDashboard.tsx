'use client';

import Link from 'next/link';
import React, { useState, Suspense } from 'react';
import { API } from '@/lib/api-endpoints';
import { roomLabel } from '@/lib/room-label';
import { ActionGridButton, ChecklistItem, RatingCard, CollapsibleRequirements } from '../_shared/components';
import { AlertCircle, AlertTriangle, BellRing, Check, CheckCircle, CheckCircle2, ClipboardCheck, ClipboardList, Clock, Coffee, Gift, Link as LinkIcon, MessageSquare, Play, QrCode, ScrollText, ShieldAlert, Sparkles, Target, Wallet, X } from 'lucide-react';
import { ProcedureModal, RoomIssueModal, RejectOrderModal, TurnQueueTypeDModal, OfficeScoreModal } from '../_components/modals';
import { ScreenTimer, WorkingTimeline } from './ScreenTimer';
import { THEME, ANIMATION, DEFAULT_BOOKING_URL, formatMultiServiceNames, WebBookingQR, ServiceTypeLabel } from '../_shared/ui';
import { apiClient } from '@/lib/apiClient';
import { notificationKind, NOTIFICATION_TITLE, type NotificationKind } from '@/lib/notification-kind';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { fmtHours } from '@/lib/hours-format';

/**
 * Giao diện một dòng trong danh sách chuông, theo NHÓM thông báo.
 *
 * ⚠️ Trước đây chỗ này chỉ biết REWARD và DISCIPLINE, mọi loại còn lại đổ vào một
 * bong bóng chat xanh — tin KHOÁ TÀI KHOẢN hay TRỪ ĐIỂM Office trông hệt một lời
 * nhắn bình thường. Nay dùng chung bảng phân loại với toast (lib/notification-kind.ts).
 */
const BELL_STYLE: Record<NotificationKind, { bg: string; icon: React.ReactNode }> = {
    complaint: { bg: 'bg-rose-100 text-rose-600', icon: <ShieldAlert size={14} /> },
    lock: { bg: 'bg-rose-100 text-rose-600', icon: <ShieldAlert size={14} /> },
    penalty: { bg: 'bg-amber-100 text-amber-600', icon: <AlertTriangle size={14} /> },
    reward: { bg: 'bg-emerald-100 text-emerald-600', icon: <Gift size={14} /> },
    success: { bg: 'bg-emerald-100 text-emerald-600', icon: <CheckCircle size={14} /> },
    order: { bg: 'bg-amber-100 text-amber-600', icon: <BellRing size={14} /> },
    checkin: { bg: 'bg-blue-100 text-blue-600', icon: <CheckCircle size={14} /> },
    shift: { bg: 'bg-indigo-100 text-indigo-600', icon: <Clock size={14} /> },
    leave: { bg: 'bg-violet-100 text-violet-600', icon: <Coffee size={14} /> },
    wallet: { bg: 'bg-teal-100 text-teal-600', icon: <Wallet size={14} /> },
    reception: { bg: 'bg-emerald-100 text-emerald-600', icon: <CheckCircle size={14} /> },
    info: { bg: 'bg-slate-100 text-slate-500', icon: <MessageSquare size={14} /> },
};

export function ScreenDashboard({ logic }: { logic: any }) {
  const { addToast } = useToast();
  const [showNoti, setShowNoti] = React.useState(false);
  logic.showNoti = showNoti;
  logic.setShowNoti = setShowNoti;

  const { booking, checklist, isChecklistComplete, handleConfirmSetup, setShowProcedure, activeSegmentIndex, prepProcedure, toggleChecklist, checkAllChecklist, setShowRoomIssueModal, walletBalance, canViewWallet, walletTimeline, onCallState, handleToggleOnCall, handleArriveAtVenue, kpiData } = logic;
  const [bookingUrl, setBookingUrl] = React.useState(DEFAULT_BOOKING_URL);
  const [showOnCallPopup, setShowOnCallPopup] = React.useState(false);
  const [tempMins, setTempMins] = React.useState(onCallState?.travel_time_mins || 30);
  const [expectedStart, setExpectedStart] = React.useState('');
  const [expectedEnd, setExpectedEnd] = React.useState('');
  /** Quầy chỉ định người trực nước hôm nay (nếu có) — ghi trong SystemConfigs. */
  const [waterRefillerId, setWaterRefillerId] = React.useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = React.useState(false);
  // Cảnh báo "không đủ giờ, từ chối là bị khoá" — do API trả về, không tự đoán.
  const [lockWarning, setLockWarning] = React.useState<any>(null);
  const [showQRModal, setShowQRModal] = React.useState(false);
  const [showWallet, setShowWallet] = React.useState(false);
  const [showTurnQueueModal, setShowTurnQueueModal] = React.useState(false);
  const [showOfficeScoreModal, setShowOfficeScoreModal] = React.useState(false);

  const [isAccepting, setIsAccepting] = React.useState(false);

  // Báo quầy biết KTV đã nhận đơn. KHÔNG đổi trạng thái đơn, không bắt đầu
  // tính giờ — chỉ là tín hiệu cho lễ tân. Bấm xong vẫn đi tiếp như cũ.
  const handleAcceptOrder = async () => {
    // Đơn kế tiếp (sau khi xong tua) hoặc chính đơn vừa được điều phối.
    const isNext = !!logic.booking?.nextBookingId;
    const id = isNext
      ? (logic.booking?.nextBookingItemId || logic.booking?.nextBookingId)
      : (logic.booking?.assignedItemId || logic.booking?.id);
    if (!id) return;
    try {
      setIsAccepting(true);
      const res = await apiClient.post<any>('/api/ktv/accept-order', {
        staffId: logic.ktvId,
        bookingItemId: id,
      });
      if (res.success) {
        addToast('✅ Đã báo quầy. Bạn tới phòng nhé!', 'success');
        if (isNext) logic.goToDashboard(logic.booking.nextBookingId);
        else await logic.forceRefresh?.();   // nạp lại để lấy acceptedAt, mở màn chi tiết
      } else {
        addToast('Lỗi: ' + res.error, 'error');
      }
    } catch (e: any) {
      addToast('Lỗi kết nối: ' + e.message, 'error');
    } finally {
      setIsAccepting(false);
    }
  };

  /**
   * Các dịch vụ của CHÍNH KTV này trong đơn đang xem.
   *
   * Một đơn có thể gồm nhiều dịch vụ cùng gán cho một người (gội + massage +
   * lấy ráy tai). Từ chối là hành vi có chế tài, mức phạt bằng 3 lần thời lượng
   * của đúng gói bị từ chối — nên phải để KTV chỉ đích danh, không được để hệ
   * thống bốc đại một cái.
   */
  const myServices = React.useMemo(() => {
    const ids: string[] = logic.booking?.assignedItemIds || [];
    const items: any[] = logic.booking?.BookingItems || [];
    return items
      .filter(i => ids.includes(i.id))
      .map(i => ({
        id: i.id,
        name: i.service_name || 'Dịch vụ',
        minutes: Number(i.duration) || 60,
      }));
  }, [logic.booking?.assignedItemIds, logic.booking?.BookingItems]);

  const handleRejectOrder = async (reason: string, itemIdOrLock?: string | boolean, confirmLockArg = false) => {
    // Modal gọi (reason, itemId); nhánh xác nhận khoá gọi (reason, undefined, true).
    const pickedItemId = typeof itemIdOrLock === 'string' ? itemIdOrLock : undefined;
    const confirmLock = typeof itemIdOrLock === 'boolean' ? itemIdOrLock : confirmLockArg;

    // Ưu tiên đúng dịch vụ KTV đã chọn; sau đó là đơn kế tiếp, cuối cùng mới
    // tới đơn đang chờ xác nhận.
    const rejectId = pickedItemId
      || logic.booking?.nextBookingItemId
      || logic.booking?.nextBookingId
      || logic.booking?.assignedItemId
      || logic.booking?.id;
    if (!rejectId) return;
    try {
      logic.setIsLoading(true);
      const res = await apiClient.post<any>('/api/ktv/discipline/reject-order', {
        staffId: logic.ktvId,
        // Ưu tiên id ĐƠN CON. Trước đây luôn gửi booking id nên API tra
        // BookingItems không ra, KTV không bị gỡ khỏi đơn và mức phạt sai.
        bookingItemId: rejectId,
        reason,
        confirmLock
      });

      // Ví giờ không đủ để chịu mức phạt: API dừng lại và trả về con số cụ thể.
      // Hỏi lại cho chắc rồi mới gọi tiếp — từ chối lúc này là mất tài khoản,
      // không thể để mất vì một cú chạm nhầm.
      if (!res.success && res.needsLockConfirm) {
        // Giữ lại ĐÚNG dịch vụ vừa chọn: bấm xác nhận ở bước sau mà rơi về dịch
        // vụ khác thì KTV mất tài khoản vì một gói họ không hề định từ chối.
        setLockWarning({ reason, itemId: rejectId, ...res });
        return;
      }

      if (res.success) {
        if (res.isExempted) {
          addToast('✅ Bạn đã được miễn phạt do làm việc liên tục đạt ngưỡng. Lễ tân đã nhận được báo cáo.', 'success');
        } else if (res.hoursDeducted > 0) {
          // Loại D trừ GIỜ tích lũy, không phải điểm chuyên cần.
          addToast(`⚠️ Bạn đã bị trừ ${res.hoursDeducted} giờ tích lũy. Lễ tân đã nhận được báo cáo.`, 'warning');
        } else {
          addToast(`⚠️ Bạn đã bị trừ ${res.penaltyPoints} điểm chuyên cần. Lễ tân đã nhận được báo cáo.`, 'warning');
        }
        setShowRejectModal(false);
        setLockWarning(null);
        if (res.accountLocked) {
          addToast('⛔ Tài khoản của bạn đã bị khoá do từ chối tua khi không đủ giờ tích lũy.', 'error');
        }
        // Refresh dashboard data
        logic.forceRefresh();
      } else {
        addToast('Lỗi: ' + res.error, 'error');
      }
    } catch (e: any) {
      // apiClient NÉM LỖI với mọi mã khác 2xx, nên nhánh `!res.success` ở trên
      // gần như không chạy — lời nhắn thật của server tới đây. Gắn "Lỗi kết nối"
      // vào là nói sai: 400 "hãy chọn đúng dịch vụ" không phải lỗi mạng.
      if (e?.data?.needsLockConfirm) {
        setLockWarning({ reason, itemId: rejectId, ...e.data });
        return;
      }
      addToast(e?.data?.error || e?.message || 'Không gửi được yêu cầu từ chối.', 'error');
    } finally {
      logic.setIsLoading(false);
    }
  };

  React.useEffect(() => {
    if (onCallState) setTempMins(onCallState.travel_time_mins);
  }, [onCallState]);

  React.useEffect(() => {
    if (!logic.ktvId) return;

    const docChiDinh = async () => {
      try {
        const date = new Date().toISOString().split('T')[0];
        const { data } = await supabase.from('SystemConfigs').select('value').eq('key', 'daily_water_refiller').maybeSingle();
        const v: any = data?.value;
        setWaterRefillerId(v && v.date === date && v.employeeId ? String(v.employeeId) : null);
      } catch (e) { /* không có chỉ định thì rơi về người đứng tua đầu */ }
    };

    docChiDinh();
    const interval = setInterval(docChiDinh, 60000);
    return () => clearInterval(interval);
  }, [logic.ktvId]);

  /**
   * Nhắc châm nước chỉ dành cho người ĐỨNG TUA ĐẦU.
   *
   * ⚠️ Trước đây chỗ này tự sắp xếp lại một lần nữa: lấy TOÀN BỘ nhân sự trong
   * `/api/turns`, xếp theo (turns_completed, check_in_order), rồi lấy người
   * `waiting` đầu tiên. Trong khi ô "Thứ tự tua" ngay bên cạnh lại xếp riêng KTV
   * Loại D theo GIỜ TÍCH LUỸ. Hai thước đo khác nhau trên cùng một ô — nên màn
   * hình hiện "Thứ tự tua 2" mà vẫn nhắc "Bạn đang đứng tua đầu".
   *
   * Nay dùng đúng con số KTV đang nhìn thấy. Quầy chỉ định tay thì lời chỉ định
   * đó vẫn thắng.
   */
  const isFirstInQueue = waterRefillerId
    ? waterRefillerId === logic.ktvId
    : logic.turnData?.myRank === 1;

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

  /**
   * Đơn vừa được điều phối nhưng KTV chưa bấm xác nhận → chặn lại, hỏi nhận hay từ chối.
   *
   * Chỉ chặn khi tua CHƯA chạy. KHÔNG dùng `dispatchStartTime` để nhận biết — đó là giờ
   * DỰ KIẾN đặt sẵn lúc điều phối, có ngay từ đầu nên sẽ chặn nhầm mọi đơn.
   * Căn cứ đúng là segment đã có actualStartTime, hoặc item đã rời trạng thái chờ.
   */
  const STARTED_STATUSES = ['IN_PROGRESS', 'PAUSED', 'CLEANING', 'COMPLETED', 'FEEDBACK', 'DONE'];
  const alreadyStarted =
    ktvSegments.some((s: any) => s.actualStartTime) ||
    STARTED_STATUSES.includes(String(item?.status || '').toUpperCase());
  const needsAcceptance = !!booking?.id && !booking?.acceptedAt && !alreadyStarted;

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
                    /* Điện thoại: panel cố định, lề đều 2 bên — trước đây neo phải chuông
                       kèm w-[85vw] nên tràn khỏi mép trái. Từ sm trở lên mới thả xuống
                       kiểu dropdown neo vào chuông như cũ. */
                    className="fixed left-4 right-4 top-20 z-[60] sm:absolute sm:inset-auto sm:top-12 sm:right-0 sm:w-80 sm:max-w-sm max-h-96 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col"
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
                        logic.notifications.map((n: any) => {
                          const kind = notificationKind(n.type);
                          const st = BELL_STYLE[kind];
                          return (
                           <div key={n.id} className={`relative p-3 rounded-xl border ${n.isRead ? 'bg-white border-transparent' : 'bg-indigo-50/50 border-indigo-100'} flex gap-3 group`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${st.bg}`}>
                                 {st.icon}
                              </div>
                              <div className="flex-1 pr-6">
                                 {/* Tiêu đề lấy từ NHÓM. Trước đây đọc `n.title` — cột đó không tồn tại
                                     trong StaffNotifications và API cũng không trả, nên mọi dòng đều có
                                     một dòng đậm TRỐNG phía trên nội dung. */}
                                 <h4 className={`text-xs font-bold ${n.isRead ? 'text-slate-700' : 'text-indigo-900'}`}>{NOTIFICATION_TITLE[kind]}</h4>
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
                          );
                        })
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      
      {(!booking || !booking.id || needsAcceptance) ? (
        <div className="space-y-4">
          
          {/* ─── HERO SECTION (ALERTS) ─── */}
          
          {/* 1. Đơn vừa điều phối — phải xác nhận trước khi xem chi tiết.
              Trước đây khối này thay TRỌN màn hình, nuốt mất Thứ tự tua, Điểm
              hôm nay, Quy chế, Mã QR — KTV đang xem dở thì bị cắt ngang, muốn
              coi lại điểm phải xử lý xong đơn. Nay nó nằm đúng ô "Đang chờ điều
              phối", phần còn lại của trang giữ nguyên. */}
          {needsAcceptance ? (
            /* ─── CHẶN: đơn vừa điều phối, phải xác nhận nhận hay từ chối đã ─── */
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="p-6 rounded-[32px] bg-white border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.06)]"
            >
              <div className="flex flex-col gap-4">
                {/* Tên dịch vụ + thời lượng là thứ KTV cần đọc trước tiên để biết
                    mình sắp làm gì và trong bao lâu. Mã đơn chỉ để đối chiếu với quầy. */}
                <div className="min-w-0">
                  <p className="font-black text-2xl leading-tight tracking-tight text-slate-800 break-words">
                    {item?.service_name || 'Dịch vụ'}
                  </p>
                  {item?.duration && (
                    <p className="mt-2 inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-lg px-2.5 py-1 text-sm font-black">
                      <Clock size={14} strokeWidth={3} /> {item.duration} phút
                    </p>
                  )}
                  {booking.billCode && (
                    <p className="text-[11px] font-bold text-slate-400 mt-1.5">Đơn {booking.billCode}</p>
                  )}
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Phòng</p>
                    <p className="font-black text-slate-800">{roomLabel(currentSeg?.roomId || booking.assignedRoomId || booking.roomName) || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Giường</p>
                    <p className="font-black text-slate-800">
                      {(currentSeg?.bedId || booking.assignedBedId || booking.bedId)
                        ? String(currentSeg?.bedId || booking.assignedBedId || booking.bedId).split('-').pop()
                        : '—'}
                    </p>
                  </div>
                </div>

                {/* Nhận là hành động chính nên nằm bên phải, chiếm 2 phần. */}
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setShowRejectModal(true)}
                    disabled={isAccepting}
                    className="py-4 bg-rose-50 border border-rose-100 text-rose-600 font-black rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-all disabled:opacity-60"
                  >
                    TỪ CHỐI
                  </button>
                  <button
                    onClick={handleAcceptOrder}
                    disabled={isAccepting}
                    className="col-span-2 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl text-xs uppercase tracking-widest shadow-md shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <Check size={16} strokeWidth={3} />
                    {isAccepting ? 'ĐANG BÁO…' : 'NHẬN ĐƠN'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 text-center font-medium">
                  Xác nhận xong mới xem được chi tiết đơn và bắt đầu tua.
                </p>
              </div>
            </motion.div>
          ) : logic.booking?.nextBookingId ? (
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
                  <div className="min-w-0">
                    <p className="font-black text-lg uppercase tracking-tight mb-1">Đơn mới đã sẵn sàng!</p>
                    {logic.booking.nextBillCode && (
                      <p className="text-base font-black text-white tracking-tight">
                        Đơn {logic.booking.nextBillCode}
                      </p>
                    )}
                    <p className="text-sm font-medium text-emerald-50 truncate">
                      {logic.booking.nextServiceName || 'Dịch vụ'}{logic.booking.nextStartTime ? ` • ${logic.booking.nextStartTime}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleAcceptOrder}
                  disabled={isAccepting}
                  className="w-full py-4 bg-white text-emerald-700 font-black rounded-2xl text-sm uppercase tracking-widest shadow-lg shadow-emerald-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <Play size={16} fill="currentColor" />
                  {isAccepting ? 'ĐANG BÁO QUẦY…' : 'BÁO QUẦY NHẬN ĐƠN'}
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  className="w-full py-3 bg-white/15 border border-white/30 text-white font-bold rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-all"
                >
                  TỪ CHỐI
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

          {/* Nhắc trực nước đã gộp vào ô "Thứ tự tua" bên dưới, không còn banner riêng. */}

          {/* ⚠️ ĐANG CHỜ XÁC NHẬN ĐƠN thì giấu hết phần dưới.
              Lúc đó KTV chỉ có đúng một việc: nhận hay từ chối. Bày thêm Nợ bàn
              giao, Thứ tự tua, Điểm, Quy chế, Mã QR chỉ tổ rối và dễ bấm nhầm
              sang chỗ khác — bấm vào ô nợ là rời luôn khỏi đơn đang chờ.
              Xác nhận xong thì mọi thứ hiện lại như cũ. */}
          {!needsAcceptance && (
          <>
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
                  // Tên PHÒNG là thứ KTV cần trước tiên — đi dọn thì phải biết dọn
                  // phòng nào. Mã đơn chỉ để đối chiếu với quầy nên xuống dòng dưới,
                  // và để NGUYÊN mã đầy đủ: trước đây cắt bằng split('-')[0] nên
                  // "TEST-260908-JJ0A" chỉ còn "TEST", hai đơn khác nhau nhìn y hệt.
                  <div key={item.id} onClick={() => logic.handleSelectDebt(item.bookingId)} className="bg-white p-3 rounded-2xl flex items-center justify-between gap-3 border border-amber-100 cursor-pointer hover:bg-amber-100/50">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-800 leading-tight">
                        Phòng {roomLabel(item.roomName) || '—'}
                      </p>
                      <p className="text-[10px] font-medium text-slate-400 leading-tight mt-0.5 break-all">
                        {item.Bookings?.billCode || 'Không rõ mã đơn'}
                      </p>
                    </div>
                    <span className="shrink-0 text-[9px] font-black bg-amber-100 text-amber-700 px-2 py-1 rounded-lg">Chưa nộp</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── BENTO GRID ─── */}
          <div className="flex flex-col gap-4">

             {/* THỨ TỰ TUA */}
             {logic.turnData && (
               <button
                 onClick={() => setShowTurnQueueModal(true)}
                 className="w-full bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-[32px] shadow-lg text-white flex flex-col gap-3 relative active:scale-95 transition-transform"
               >
                 <div className="w-full flex items-center justify-between">
                   <div className="flex items-center gap-3">
                     <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/30">
                       <Clock size={24} />
                     </div>
                     <div className="text-left">
                       <h3 className="font-bold text-[10px] uppercase tracking-widest text-blue-100">Thứ tự tua</h3>
                       <p className="font-black text-xl leading-none mt-1">{logic.turnData.myRank > 0 ? logic.turnData.myRank : '-'}</p>
                     </div>
                   </div>
                   <div className="text-right">
                     <h3 className="font-bold text-[10px] uppercase tracking-widest text-blue-100">Thời gian</h3>
                     {/* Dùng fmtHours dùng chung, KHÔNG tự tính tay.
                         Giờ tích lũy CÓ THỂ ÂM (phạt từ chối tua trừ gấp 3 lần thời
                         lượng gói). Cách tính tay cũ `Math.floor(-0.23)` ra -1 rồi
                         phần lẻ thành 0.77 → hiện "-1h 46P" thay vì "−0h 14P".
                         Đỏ khi âm để KTV thấy ngay mình đang thiếu giờ. */}
                     <p className={`font-black text-xl leading-none mt-1 ${logic.turnData.myTime < 0 ? 'text-rose-200' : ''}`}>
                       {logic.turnData.myRank > 0 ? fmtHours(logic.turnData.myTime) : '-'}
                     </p>
                   </div>
                 </div>

                 {/* Đứng tua đầu thì nhắc trực nước ngay trong ô, khỏi banner riêng phía trên. */}
                 {isFirstInQueue && (
                   <div className="w-full flex items-center gap-2">
                     <AlertTriangle size={14} className="shrink-0 animate-pulse text-blue-100" />
                     <p className="text-[11px] font-bold text-left leading-snug text-blue-100">
                       Bạn đang đứng tua đầu — hãy kiểm tra châm nước bình thuỷ các phòng.
                     </p>
                   </div>
                 )}
               </button>
             )}

             {/* ĐIỂM OFFICE HÔM NAY — chỉ KTV Loại D mới có */}
             {logic.officeScore && (() => {
               const os = logic.officeScore;
               // Xanh khi chưa bị trừ gì, hổ phách khi có lỗi trong ngày.
               const tone = os.todayHits.length === 0
                 ? 'from-emerald-500 to-green-600'
                 : 'from-amber-500 to-orange-600';
               return (
                 <button
                   onClick={() => setShowOfficeScoreModal(true)}
                   className={`w-full bg-gradient-to-br ${tone} p-4 rounded-[32px] shadow-lg text-white flex items-center justify-between relative active:scale-95 transition-transform`}
                 >
                   <div className="flex items-center gap-3">
                     <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/30">
                       <ClipboardCheck size={24} />
                     </div>
                     <div className="text-left">
                       <h3 className="font-bold text-[10px] uppercase tracking-widest text-white/80">Điểm hôm nay</h3>
                       <p className="font-black text-xl leading-none mt-1">
                         {os.todayScore}<span className="text-sm font-medium opacity-80 ml-0.5">/100</span>
                       </p>
                       <p className="text-[10px] font-bold text-white/85 mt-1">
                         {os.todayHits.length > 0 ? `${os.todayHits.length} lỗi bị trừ hôm nay` : 'Chưa bị trừ lỗi nào'}
                       </p>
                     </div>
                   </div>
                   <div className="text-right">
                     <h3 className="font-bold text-[10px] uppercase tracking-widest text-white/80">Điểm tháng</h3>
                     {/* Chưa có ngày công thì điểm tháng không có mẫu số — hiện
                         con số ra là nói KTV đạt tuyệt đối và miễn sạch quỹ. */}
                     {os.hasData === false ? (
                       <>
                         <p className="font-black text-base leading-none mt-1">—</p>
                         <p className="text-[10px] font-bold text-white/85 mt-1">Chưa có dữ liệu</p>
                       </>
                     ) : (
                       <>
                         <p className="font-black text-xl leading-none mt-1">{os.monthScore}</p>
                         <p className="text-[10px] font-bold text-white/85 mt-1">Quỹ đóng {os.fundDue.toLocaleString('vi-VN')}đ</p>
                       </>
                     )}
                   </div>
                 </button>
               );
             })()}

             {/* ─── GRID: Quy chế, Mã QR, Chỉ Tiêu ─── */}
             <div className="grid grid-cols-2 gap-4">
                {/* 1. Nút mở Quy chế */}
                <Link href="/ktv/regulations" className="bg-gradient-to-br from-emerald-700 to-teal-800 p-4 rounded-[32px] shadow-lg text-white flex flex-col items-center justify-center relative active:scale-95 transition-transform">
                   <h3 className="font-bold text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1.5 text-emerald-100">
                      Quy chế
                   </h3>
                   <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/30">
                      <ScrollText size={32} />
                   </div>
                </Link>

                {/* 2. Nút mở Mã QR */}
                <button onClick={() => setShowQRModal(true)} className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-[32px] shadow-lg text-white flex flex-col items-center justify-center relative active:scale-95 transition-transform">
                   <h3 className="font-bold text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1.5 text-indigo-100">
                      Mã QR Khách
                   </h3>
                   <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/30">
                      <QrCode size={32} />
                   </div>
                </button>

                {/* 3. Chỉ tiêu tháng (chỉ hiện nếu có KPI) */}
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
             </div>
          </div>
          </>
          )}


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
                        {/* Không hiện tên khách cho KTV — chỉ cần nhãn khách và mã đơn
                            là đủ để đối chiếu với quầy. */}
                        {/* Dùng ternary chứ KHÔNG dùng `&&`: guest_index = 0 sẽ khiến
                            React render ra số 0 thay vì bỏ qua. */}
                        {item.guest_index ? (
                          <span className="text-base font-black text-slate-800 truncate block mt-0.5 flex-1 min-w-[120px]">
                            Khách {String.fromCharCode(64 + item.guest_index)}
                          </span>
                        ) : null}
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
                      Phòng {roomLabel(currentSeg?.roomId || booking.assignedRoomId || booking.roomName)}
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
        isTypeD={logic.workType === 'TYPE_D'}
        services={myServices}
      />

      {/* Cảnh báo thiếu giờ tích lũy — bước cuối trước khi mất tài khoản */}
      {lockWarning && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
          <div className="bg-white w-full sm:max-w-md rounded-t-[32px] sm:rounded-[32px] shadow-2xl overflow-hidden">
            <div className="bg-rose-600 p-6 text-white">
              <h3 className="text-lg font-black uppercase tracking-tight">Quỹ giờ dưới hạn mức</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-2">
                <div className="flex justify-between text-sm font-bold text-rose-900">
                  <span>Hạn mức tối thiểu để được từ chối</span>
                  <span>{lockWarning.minHours} giờ</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-rose-900">
                  <span>Quỹ giờ tích lũy của bạn</span>
                  <span>chỉ còn {lockWarning.availableHours} giờ</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-rose-500 pt-1 border-t border-rose-200">
                  <span>Nếu từ chối, tua {lockWarning.serviceMins} phút bị trừ</span>
                  <span>{lockWarning.penaltyHours} giờ</span>
                </div>
              </div>
              <p className="text-sm font-bold text-slate-700 leading-relaxed">
                Quỹ giờ của bạn đã dưới hạn mức. Nếu bạn <b>vẫn từ chối</b>, tài khoản sẽ bị
                <b className="text-rose-600"> KHOÁ</b> và phải nhờ quản lý mở lại.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setLockWarning(null)}
                  className="py-3.5 rounded-2xl font-black text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors uppercase text-sm"
                >
                  Quay lại nhận đơn
                </button>
                <button
                  onClick={() => { const r = lockWarning.reason; const it = lockWarning.itemId; setLockWarning(null); handleRejectOrder(r, it, true); }}
                  className="py-3.5 rounded-2xl font-black text-white bg-rose-600 hover:bg-rose-700 transition-colors uppercase text-sm"
                >
                  Vẫn từ chối
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Turn Queue Modal */}
      {logic.turnData && (
        <TurnQueueTypeDModal
          isOpen={showTurnQueueModal}
          onClose={() => setShowTurnQueueModal(false)}
          turnData={logic.turnData}
          ktvId={logic.ktvId}
        />
      )}

      {/* Office Score Modal */}
      {logic.officeScore && showOfficeScoreModal && (
        <OfficeScoreModal data={logic.officeScore} onClose={() => setShowOfficeScoreModal(false)} />
      )}
    </div>
  );
}
