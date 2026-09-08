'use client';
import { isUtilityService } from '@/lib/booking.logic';
import { parseDbDate } from "@/lib/utils";

// 🔧 UI CONFIGURATION
const DEFAULT_DURATION = 60; // Phút mặc định cho mỗi KTV

import React, { useState, useRef, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ConfirmActionModal } from './_components/ConfirmActionModal';
import { PhotoViewerModal } from './_components/PhotoViewerModal';
import { QrJourneyModal } from './_components/QrJourneyModal';
import { StartServiceModal } from './_components/StartServiceModal';
import { InvoiceLanguageModal } from './_components/InvoiceLanguageModal';
import { AddServiceModal } from './_components/AddServiceModal';
import { DispatchConfirmModal } from './_components/DispatchConfirmModal';
import { SplitDurationModal } from './_components/SplitDurationModal';
import { OrderContextMenu } from './_components/OrderContextMenu';
import { getDisplayCustomerName } from './dispatch-display';
import { formatToHourMinute } from './dispatch-time.logic';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import {
  ShieldAlert, Clock, CheckCircle2, Bell, BellOff,
  Plus, Calendar as CalendarIcon, Send, Phone, Globe,
  ChevronDown, ChevronLeft, Package, Volume2, VolumeX, Trash2, X, Sparkles, QrCode, LayoutList, Columns3, Save, Zap, AlertTriangle, Info,
  Users, BedDouble, CalendarClock, ClipboardList, BookOpen, PlusSquare, PauseCircle, MicOff, Loader2, ChevronUp, Ban, Crown, Stethoscope, RotateCcw, Star, PenLine
} from 'lucide-react';
import { TurnQueueBoard } from '@/components/shared/TurnQueueBoard/TurnQueueBoard';
import { DispatchOnlineKtvTable } from './_components/DispatchOnlineKtvTable';
import { RoomBoard } from '@/components/shared/RoomBoard';
import { ScheduleBoard } from '@/components/shared/ScheduleBoard';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { supabase } from '@/lib/supabase';

import { KanbanBoard } from './_components/KanbanBoard';
import { TimeEditorModal } from './_components/TimeEditorModal';
import { QuickDispatchTable } from './_components/QuickDispatchTable';
import { getDispatchData, processDispatch, cancelBooking, updateBookingStatus, createQuickBooking, addAddonServices, updateBookingMeta } from './actions';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { AddOrderModal } from './_components/AddOrderModal';
import { ReviewHandoverModal } from './_components/ReviewHandoverModal';
import PauseSwapKtvModal from './_components/PauseSwapKtvModal';
import CancelItemModal from './_components/CancelItemModal';
import { workedMsOf } from '@/lib/segment-time';
import { useDispatchBoard } from './useDispatchBoard.logic';
import { MergePromptModal } from '@/app/reception/dispatch/_components/MergePromptModal';
import { useNotifications } from '@/components/NotificationProvider';
import { CustomerDetailModal } from '../crm/_components/CustomerDetailModal';
import { Customer } from '@/lib/types';
import { SplitPreviewModal } from './_components/SplitPreviewModal';
import { WebBookingBoard } from '../web-booking/WebBookingBoard';
// ─── TYPES ────────────────────────────────────────────────────────────────────
import { 
  StaffAssignment, 
  WorkSegment,
  ServiceBlock, 
  DispatchStatus, 
  PendingOrder, 
  StaffData, 
  TurnQueueData, 
  StaffNotification 
} from './types';

import { SubOrder, buildOrderTimeline } from './_components/dispatch-timeline';
import { calcEndTime, recalculateAllTimes } from './dispatch-time.logic';
import { KtvCommentModal } from './_components/KtvCommentModal';















// ─── MOCK DATA ────────────────────────────────────────────────────────────────

// MOCK DATA REMOVED - Using real data from Supabase

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const getCurrentTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatCompactPrice = (n: number) => {
    if (n >= 1000000) {
        const tr = Math.floor(n / 1000000);
        const k = Math.floor((n % 1000000) / 1000);
        if (k > 0) {
            return `${tr}tr${String(k).padStart(3, '0')}`;
        }
        return `${tr}tr`;
    } else if (n >= 1000) {
        return `${Math.floor(n / 1000)}k`;
    }
    return `${n}đ`;
};

const getDynamicEndTime = (startStr?: string | null, durationMins: number = 60) => {
    if (!startStr) return '--:--';
    const formatted = formatToHourMinute(startStr);
    if (formatted === '--:--') return '--:--';
    
    let [h, m] = formatted.split(':').map(Number);
    m += durationMins;
    h += Math.floor(m / 60);
    m = m % 60;
    h = h % 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const formatTime = (timeStr: string | null | undefined) => {
  if (!timeStr) return null;
  // If it's HH:mm:ss, take HH:mm
  if (timeStr.includes(':')) {
    const parts = timeStr.split(':');
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  }
  return timeStr;
};



const genId = () => Math.random().toString(36).slice(2, 8);

// QUICK_SERVICES_LIST removed — now using allServices from Supabase


export default function DispatchBoardPage() {
    
    // 🔧 THÊM HÀM SAFE PARSE JSON ĐỂ TRÁNH CRASH TRÌNH DUYỆT
    const safeParseOptions = (options: any) => {
        if (!options) return {};
        if (typeof options === 'object') return options;
        if (typeof options === 'string') {
            if (!options.trim()) return {};
            try {
                return JSON.parse(options);
            } catch (e) {
                console.error('Failed to parse options string:', options);
                return {};
            }
        }
        return {};
    };
  const { hasPermission } = useAuth();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedSubOrderId, setSelectedSubOrderId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const vnTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    if (vnTime.getUTCHours() < 6) {
        vnTime.setUTCDate(vnTime.getUTCDate() - 1);
    }
    return vnTime.toISOString().split('T')[0];
  });

  const {
    orders, setOrders,
    staffs, setStaffs,
    turns, setTurns,
    rooms, setRooms,
    beds, setBeds,
    reminders, setReminders,
    allServices, setAllServices,
    roomTransitionTime, setRoomTransitionTime,
    loading, setLoading,
    fetchData,
    now,
  } = useDispatchBoard(selectedDate, selectedOrderId);

  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const [reviewModalService, setReviewModalService] = useState<ServiceBlock | null>(null);
  const { notifications, soundEnabled, setSoundEnabled, unlockAudio, playSound } = useNotifications();

  // ─── Guest Arrival Lock ───
  const [guestArrivalLock, setGuestArrivalLock] = useState<{ active: boolean; lockedBy: string; lockedAt: string; message: string; enabled: boolean }>({ active: false, lockedBy: '', lockedAt: '', message: '', enabled: true });

  const fetchGuestArrivalLock = async () => {
    try {
        const res = await apiClient.get<any>('/api/reception/guest-arrival');
        const isEnabled = res.enabled !== false;
        if (res.success && res.active && res.data) {
            setGuestArrivalLock({
                active: true,
                lockedBy: res.data.created_by_name,
                lockedAt: res.data.created_at,
                message: res.data.note || '',
                enabled: isEnabled
            });
        } else {
            setGuestArrivalLock({ active: false, lockedBy: '', lockedAt: '', message: '', enabled: isEnabled });
        }
    } catch(err) {}
  };

  // Auto-OFF đã được chuyển về xử lý ở server (API /cron/guest-arrival-sweep và GET /api/reception/guest-arrival)
  // Xóa effect tắt khóa ở client để tránh lỗi khóa bị treo vĩnh viễn (B1, B3)

  useEffect(() => {
    fetchGuestArrivalLock();
    const lockChannel = supabase
        .channel('dispatch_guest_arrival_events')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'GuestArrivalEvents',
        }, () => {
            fetchGuestArrivalLock();
        })
        .subscribe();
    return () => { supabase.removeChannel(lockChannel); };
  }, []);

  const toggleGuestArrivalLock = async () => {
    try {
        if (guestArrivalLock.active) {
            const hasPending = orders.some(o => o.dispatchStatus === 'pending');
            if (hasPending) {
                if (!window.confirm('Vẫn còn đơn chưa điều phối (Khách đang đợi). Bạn có chắc chắn muốn tắt Báo Khách?')) return;
            }
            await apiClient.delete<any>('/api/reception/guest-arrival');
        } else {
            if (!window.confirm('Khóa nút "Tan ca" của tất cả KTV (TYPE_D)?\nHãy bật khi khách đang xếp hàng nhưng KTV chưa kịp vào ca.')) return;
            await apiClient.post<any>('/api/reception/guest-arrival', { note: 'Bật thủ công từ Dispatch Board' });
        }
        await fetchGuestArrivalLock();
    } catch(err) {
        alert('Có lỗi xảy ra khi cập nhật khóa.');
    }
  };
  const [leftPanelTab, setLeftPanelTab] = useState<DispatchStatus>('pending');
  const [activeMode, setActiveMode] = useState<'DISPATCH' | 'MONITOR' | 'TURN_QUEUE' | 'ROOMS' | 'SCHEDULE' | 'WEB_BOOKING'>('DISPATCH');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAddSvcModal, setShowAddSvcModal] = useState(false);
  const [selectedGuestForAddon, setSelectedGuestForAddon] = useState<string>('');
  const [commentModalData, setCommentModalData] = useState<{subOrder: SubOrder, order: any} | null>(null);
  const [editingSvc, setEditingSvc] = useState<{ orderId: string, svcId: string, oldSvcName: string } | null>(null);
  const [showDispatchConfirmModal, setShowDispatchConfirmModal] = useState(false);
  const [editingGuestInfo, setEditingGuestInfo] = useState<{ nationality: string, guestCount: number, customerGender: string, paymentMethod: string } | null>(null);
  const [showCustomerInfo, setShowCustomerInfo] = useState(false);
  const [fullCustomerData, setFullCustomerData] = useState<Customer | null>(null);
  const [isFetchingCustomer, setIsFetchingCustomer] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, message: '', onConfirm: () => {} });

  const [webBookingCount, setWebBookingCount] = useState(0);

  useEffect(() => {
    if (!mounted) return;
    const fetchWebBookingCount = async () => {
        try {
            const { count, error } = await supabase
                .from('Bookings')
                .select('*', { count: 'exact', head: true })
                .neq('status', 'CANCELLED')
                .in('source', ['WEB_BOOKING', 'HOME_BOOKING', 'VIP_BOOKING', 'STANDARD_BOOKING', 'MIXED_BOOKING', 'STANDARD_MENU', 'VIP_MENU', 'MIXED_MENU'])
                .eq('status', 'NEW');

            if (count !== null && !error) {
                setWebBookingCount(count);
            }
        } catch (err) {
            console.error('Fetch web booking count error:', err);
        }
    };
    
    fetchWebBookingCount();
    
    const channel = supabase.channel('web_booking_badge')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'Bookings' }, () => {
            fetchWebBookingCount();
        })
        .subscribe();
        
    return () => {
        supabase.removeChannel(channel);
    };
  }, [mounted, selectedDate]);

  const [startServiceModal, setStartServiceModal] = useState<{
    isOpen: boolean;
    orderId: string;
    itemIds?: string[];
    targetKtvIds?: string[];
    plannedStartTime: string | null;
    onConfirm?: (time: string) => void;
  }>({ isOpen: false, orderId: '', itemIds: undefined, targetKtvIds: undefined, plannedStartTime: null });


  useEffect(() => {
    setEditingGuestInfo(null);
  }, [selectedSubOrderId]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<any>(null);

  // 🔧 NEW: Split Service State
  const [splitConfig, setSplitConfig] = useState<{
    orderId: string;
    svcId: string;
    duration: number;
    ktv1Dur: number;
    ktv2Dur: number;
    name1?: string;
    name2?: string;
    defaultName?: string;
    isSaving: boolean;
  } | null>(null);

  const [splitPreviewState, setSplitPreviewState] = useState<{
    isOpen: boolean;
    intent: 'DRAFT' | 'DISPATCH';
    splitPlan: { suffix: string, itemIds: string[] }[];
    order: PendingOrder;
    dispatchArgs?: { skipValidation?: boolean, specificSvcIds?: string[], overrideOrderId?: string };
  } | null>(null);

  const [mergePromptConfig, setMergePromptConfig] = useState<{
    orderId: string;
    sourceSvcId: string;
    targetSvcId: string;
    rowId: string;
    ktvId: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  } | null>(null);

  const { user } = useAuth();
  const lastSoundTimeRef = useRef<number>(0);
  const push = usePushNotifications(user?.id);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, orderId: string, itemId?: string, guestId?: string } | null>(null);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [pauseModalOrder, setPauseModalOrder] = useState<PendingOrder | null>(null);
  const [pauseModalSubOrder, setPauseModalSubOrder] = useState<any>(null);
  const [pauseModalLockAction, setPauseModalLockAction] = useState<'SWAP' | undefined>(undefined);
  const [cancelItemModal, setCancelItemModal] = useState<{ orderId: string; itemIds: string[]; wholeBooking?: boolean; ktvLabel?: string; customerName?: string; workedMinutes: number | null; canhBao?: string | null } | null>(null);
  const [qrModal, setQrModal] = useState<{ orderId: string; billCode: string; accessToken?: string | null; customerLang?: string, guestId?: string } | null>(null);
  const [invoiceLangModal, setInvoiceLangModal] = useState<{ invoiceId: string } | null>(null);
  const [expandedSvcIds, setExpandedSvcIds] = useState<string[]>([]);
  const [dispatchMode, setDispatchMode] = useState<'quick' | 'detail'>('quick');
  const [selectedPhoto, setSelectedPhoto] = useState<{ url?: string; urls?: string[]; ktvId: string; time: string | null; type?: 'START' | 'HANDOVER' } | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [timeEditorModal, setTimeEditorModal] = useState<{ isOpen: boolean, orderId: string, itemId: string } | null>(null);
  // 🔧 QR CONFIGURATION

  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const getEstimatedEndTime = (order: PendingOrder, servicesToCheck: ServiceBlock[] = order.services) => {
    let maxTime = 0;

    if (!servicesToCheck || servicesToCheck.length === 0) return null;

    const parseHHMM = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        const d = new Date();
        d.setHours(h, m, 0, 0);

        if (d.getTime() < Date.now() - 12 * 60 * 60 * 1000) {
             d.setDate(d.getDate() + 1);
        } else if (d.getTime() > Date.now() + 12 * 60 * 60 * 1000) {
             d.setDate(d.getDate() - 1);
        }
        
        return d;
    };

    for (const svc of servicesToCheck) {
        let hasValidSegmentTime = false;
        if (svc.staffList) {
            for (const staff of svc.staffList) {
                if (!staff.segments) continue;
                for (const seg of staff.segments) {
                    const start = seg.actualStartTime || svc.timeStart || seg.startTime;
                    const duration = (seg.duration !== undefined && seg.duration !== null) ? Number(seg.duration) : (Number(svc.duration) || 60);
                    const finalEnd = seg.actualEndTime ? seg.actualEndTime : (seg.actualStartTime || svc.timeStart ? getDynamicEndTime(start, duration) : (svc.timeEnd || seg.endTime));
                    
                    if (finalEnd && finalEnd !== '--:--') {
                        const formattedEnd = formatToHourMinute(finalEnd);
                        if (formattedEnd !== '--:--') {
                            const d = parseHHMM(formattedEnd);
                            if (d.getTime() > maxTime) maxTime = d.getTime();
                            hasValidSegmentTime = true;
                        }
                    }
                }
            }
        }
        
        if (!hasValidSegmentTime && svc.timeEnd) {
            let tEnd = svc.timeEnd;
            if (!tEnd.endsWith('Z') && !tEnd.includes('+')) {
                tEnd = tEnd.replace(' ', 'T') + 'Z';
            }
            const d = new Date(tEnd);
            if (!isNaN(d.getTime())) {
                if (d.getTime() > maxTime) maxTime = d.getTime();
            }
        }
    }

    if (maxTime > 0) {
        const mDate = new Date(maxTime);
        return `${String(mDate.getHours()).padStart(2, '0')}:${String(mDate.getMinutes()).padStart(2, '0')}`;
    }

    if (order.timeEnd && servicesToCheck === order.services) {
        return formatToHourMinute(order.timeEnd);
    }

    return order.time; 
  };

  const subOrders = React.useMemo(() => {
    return buildOrderTimeline(orders);
  }, [orders]);

  // 🔄 AUTO-FINISH WORKER: Đã được chuyển về xử lý ở cấp độ KanbanBoard (sub-order level)
  // để đảm bảo tính đồng nhất và tránh xung đột trạng thái.

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleCloseContext = () => setContextMenu(null);
    if (dropdownOpen) document.addEventListener('mousedown', handleClickOutside);
    if (contextMenu) document.addEventListener('mousedown', handleCloseContext);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('mousedown', handleCloseContext);
    };
  }, [dropdownOpen, contextMenu]);

  if (!mounted) return null;

if (!hasPermission('dispatch_board')) {
    return (
      <AppLayout title="Điều Phối">
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <ShieldAlert size={48} className="text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
        </div>
      </AppLayout>
    );
  }

  const pendingOrders = orders.filter(o => o.dispatchStatus === 'pending');
  const selectedOrder = orders.find(o => o.id === selectedOrderId) ?? null;
  let selectedSubOrder: SubOrder | null | undefined = subOrders.find(so => so.id === selectedSubOrderId);
  
  if (!selectedSubOrder && selectedSubOrderId && selectedOrder) {
      // Tìm fallback bằng cách so khớp baseId (bỏ qua suffix phase/thời gian)
      const fallback = subOrders.find(so => 
          selectedSubOrderId.startsWith(so.id + '_') || 
          so.id.startsWith(selectedSubOrderId + '_')
      );
      
      if (fallback) {
          selectedSubOrder = fallback;
          // Tùy chọn: có thể setSelectedSubOrderId(fallback.id) ở useEffect nếu cần, nhưng gán thẳng ở đây cũng đủ để UI không mất thẻ
      } else {
          selectedSubOrder = { id: selectedOrder.id, bookingId: selectedOrder.id, originalOrder: selectedOrder, services: selectedOrder.services, dispatchStatus: selectedOrder.dispatchStatus, ktvSignature: '', ktvIds: [], calculatedStart: '' } as any;
      }
  } else if (!selectedSubOrder && !selectedSubOrderId && selectedOrder) {
      selectedSubOrder = { id: selectedOrder.id, bookingId: selectedOrder.id, originalOrder: selectedOrder, services: selectedOrder.services, dispatchStatus: selectedOrder.dispatchStatus, ktvSignature: '', ktvIds: [], calculatedStart: '' } as any;
  } else if (!selectedSubOrder) {
      selectedSubOrder = null;
  }

  const LEFT_TABS: { id: DispatchStatus; label: string; color: string; activeBg: string; dot: string; badgeBg: string; badgeText: string }[] = [
    { id: 'pending', label: 'Chờ điều phối', color: 'text-rose-600', activeBg: 'bg-rose-500', dot: 'bg-rose-500', badgeBg: 'bg-rose-100', badgeText: 'text-rose-700' },
    { id: 'PREPARING', label: 'Đã điều phối', color: 'text-indigo-600', activeBg: 'bg-indigo-500', dot: 'bg-indigo-500', badgeBg: 'bg-indigo-100', badgeText: 'text-indigo-700' },
    { id: 'IN_PROGRESS', label: 'Đang làm', color: 'text-amber-600', activeBg: 'bg-amber-500', dot: 'bg-amber-500', badgeBg: 'bg-amber-100', badgeText: 'text-amber-700' },
    { id: 'CLEANING', label: 'Đang dọn', color: 'text-purple-600', activeBg: 'bg-purple-500', dot: 'bg-purple-500', badgeBg: 'bg-purple-100', badgeText: 'text-purple-700' },
    { id: 'FEEDBACK', label: 'Chờ đánh giá', color: 'text-blue-600', activeBg: 'bg-blue-500', dot: 'bg-blue-500', badgeBg: 'bg-blue-100', badgeText: 'text-blue-700' },
    { id: 'DONE', label: 'Hoàn tất', color: 'text-emerald-600', activeBg: 'bg-emerald-500', dot: 'bg-emerald-500', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700' },
  ];

  const displayedOrders = subOrders.filter(o => o.dispatchStatus === leftPanelTab);

  const updateOrder = (orderId: string, patchFn: (o: PendingOrder) => PendingOrder) => {
    setOrders(prev => prev.map(o => o.id === orderId ? patchFn(o) : o));
  };

  const updateSvcField = (orderId: string, svcId: string, patch: Partial<ServiceBlock>) => {
    updateOrder(orderId, o => ({
      ...o,
      services: o.services.map(s => s.id === svcId ? { ...s, ...patch } : s),
    }));
  };



  const executeStaffRowUpdate = (orderId: string, svcId: string, rowId: string, patch: Partial<StaffAssignment>) => {
    updateOrder(orderId, o => {
      const targetSvc = o.services.find(s => s.id === svcId);
      const mergedIds = targetSvc?.mergedServiceIds || [];

      let updatedOrder = {
        ...o,
        services: o.services.map(s => {
          if (s.id === svcId) {
            return { ...s, staffList: s.staffList.map(r => r.id === rowId ? { ...r, ...patch } : r) };
          }
          if (mergedIds.includes(s.id)) {
            let childPatch = { ...patch };
            if (patch.segments) {
              childPatch.segments = s.staffList[0].segments.map((cSeg, cIdx) => {
                 const pSeg = patch.segments![cIdx] || patch.segments![0];
                 return { ...cSeg, roomId: pSeg?.roomId || null, bedId: pSeg?.bedId || null };
              });
            }
            return { ...s, staffList: s.staffList.map((r, idx) => idx === 0 ? { ...r, ...childPatch } : r) };
          }
          return s;
        }),
      };

      // Tự động nối giờ nếu KTV được chọn và đã có phục vụ chặng trước đó
      if (patch.ktvId) {
        updatedOrder = recalculateAllTimes(updatedOrder, roomTransitionTime);
      }

      return updatedOrder;
    });
  };

  const updateStaffRow = (orderId: string, svcId: string, rowId: string, patch: Partial<StaffAssignment>) => {
    if (patch.ktvId) {
       const order = orders.find(o => o.id === orderId);
       if (order) {
           const ktvId = patch.ktvId;
           // Check if this ktvId is assigned to another unmerged service in this order
           const targetSvc = order.services.find(s => s.id === svcId);
           const otherService = order.services.find(s => 
               s.id !== svcId && 
               !s.mergedIntoId &&
               s.guestId === targetSvc?.guestId &&
               s.staffList.some(r => r.ktvId === ktvId)
           );
           
           if (otherService) {
               setMergePromptConfig({
                   orderId,
                   sourceSvcId: otherService.id,
                   targetSvcId: svcId,
                   rowId,
                   ktvId
               });
               return; // Pause the update, wait for user confirmation
           }
       }
    }
    
    executeStaffRowUpdate(orderId, svcId, rowId, patch);
  };

  const confirmMergeServices = () => {
    if (!mergePromptConfig) return;
    const { orderId, sourceSvcId, targetSvcId, rowId, ktvId, onConfirm } = mergePromptConfig;
    
    updateOrder(orderId, o => {
      const sourceSvc = o.services.find(s => s.id === sourceSvcId);
      const sourceSegments = sourceSvc?.staffList[0]?.segments;

      let updatedOrder = {
        ...o,
        services: o.services.map(s => {
          if (s.id === targetSvcId) {
            return {
              ...s,
              mergedIntoId: sourceSvcId,
              staffList: s.staffList.map((r, i) => (r.id === rowId || (rowId === '' && i === 0)) ? {
                ...r,
                ktvId: '',
                segments: r.segments.map((cSeg, cIdx) => {
                  const pSeg = sourceSegments?.[cIdx] || sourceSegments?.[0];
                  return { ...cSeg, ktvId: '', roomId: pSeg?.roomId || null, bedId: pSeg?.bedId || null };
                })
              } : r)
            };
          }
          return s;
        }),
      };
      
      // Get child service duration before merging into parent
      const targetSvc = updatedOrder.services.find(s => s.id === targetSvcId);
      const childDuration = targetSvc?.staffList?.[0]?.segments?.[0]?.duration || targetSvc?.duration || 0;

      updatedOrder = {
        ...updatedOrder,
        services: updatedOrder.services.map(s => {
          if (s.id === sourceSvcId) {
            const childName = targetSvc?.serviceName || 'Dịch vụ con';
            const parentName = s.displayName || s.serviceName || 'Dịch vụ gốc';
            
            return {
              ...s,
              displayName: `${parentName} + ${childName}`,
              mergedServiceIds: [...(s.mergedServiceIds || []), targetSvcId],
              // Cộng duration DV con vào segment đầu tiên của DV cha
              staffList: s.staffList.map(r => ({
                ...r,
                segments: r.segments.map((seg, idx) => {
                  if (idx === 0 && childDuration > 0) {
                    const newDur = (seg.duration || s.duration) + childDuration;
                    const [h, m] = (seg.startTime || '08:00').split(':').map(Number);
                    const end = new Date(); end.setHours(h, m + newDur, 0, 0);
                    const newEnd = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
                    return { ...seg, duration: newDur, endTime: newEnd };
                  }
                  return seg;
                })
              }))
            };
          }
          return s;
        })
      };

      updatedOrder = recalculateAllTimes(updatedOrder, roomTransitionTime);
      return updatedOrder;
    });

    if (onConfirm) onConfirm();
    setMergePromptConfig(null);
  };
  
  const cancelMergeServices = () => {
    if (!mergePromptConfig) return;
    const { orderId, targetSvcId, rowId, ktvId, onCancel } = mergePromptConfig;
    if (onCancel) {
      onCancel();
    } else {
      executeStaffRowUpdate(orderId, targetSvcId, rowId, { ktvId });
    }
    setMergePromptConfig(null);
  };

  const confirmSplitService = async () => {
      if (!splitConfig) return;
      const { orderId, svcId, duration, ktv1Dur, ktv2Dur, name1, name2 } = splitConfig;
      
      setSplitConfig(prev => prev ? { ...prev, isSaving: true } : null);
      
      try {
          if (ktv1Dur === duration && ktv2Dur === duration) {
              // 1. LÀM CHUNG (Giữ nguyên mảng)
              const svc = orders.find(o => o.id === orderId)?.services.find(s => s.id === svcId);
              const st = getCurrentTime();
              const newRow: StaffAssignment = {
                  id: genId(),
                  ktvId: '',
                  ktvName: '',
                  segments: [{
                      id: `seg-${genId()}`,
                      roomId: null,
                      bedId: null,
                      startTime: st,
                      duration: ktv2Dur,
                      endTime: calcEndTime(st, ktv2Dur)
                  }],
                  noteForKtv: '',
              };
              updateOrder(orderId, o => ({
                  ...o,
                  services: o.services.map(s => s.id === svcId
                      ? { ...s, staffList: [...s.staffList, newRow] }
                      : s
                  ),
              }));
          } else {
              // 2. LÀM NỐI TIẾP (Tách API)
              const realSvcId = orders.find(o => o.id === orderId)?.services.find(s => s.id === svcId)?.id;
              if (!realSvcId) throw new Error('Không tìm thấy ID dịch vụ');
              
              const { splitBookingItem } = await import('./actions');
              const res = await splitBookingItem(orderId, realSvcId, ktv1Dur, ktv2Dur, selectedDate, name1, name2);
              if (!res.success) throw new Error(res.error);
              
              await fetchData();
          }
      } catch (err: any) {
          alert('Lỗi: ' + err.message);
      } finally {
          setSplitConfig(null);
      }
  };

  const addStaffRow = async (orderId: string, svcId: string) => {
    const svc = orders.find(o => o.id === orderId)?.services.find(s => s.id === svcId);
    const dur = svc?.duration ?? DEFAULT_DURATION;
    
    if (svc && svc.staffList.length >= 1) {
       const isFourhand = ['NHS0034', 'NHS0035', 'NHS0036', 'NHS0037', 'NHS0038', 'NHS0039'].includes(svc.serviceId || '');
       
       if (!isFourhand) {
           // BẮT BUỘC TÁCH LUÔN MÀ KHÔNG CẦN HỎI (Áp dụng cho các DV thường)
           try {
               const { splitBookingItem } = await import('./actions');
               const res = await splitBookingItem(orderId, svcId, dur, dur, selectedDate);
               if (!res.success) throw new Error(res.error);
               await fetchData();
           } catch (err: any) {
               alert('Lỗi khi tự động tách đơn: ' + err.message);
           }
           return;
       }
       
       // NẾU LÀ FOURHAND: Cho phép chọn Nối tiếp hoặc Làm chung (Song song)
       setSplitConfig({
           orderId,
           svcId,
           duration: dur,
           ktv1Dur: dur,
           ktv2Dur: dur,
           defaultName: svc?.serviceName,
           name1: svc?.serviceName,
           name2: svc?.serviceName,
           isSaving: false
       });
       return;
    }

    const st = getCurrentTime();
    const newRow: StaffAssignment = {
      id: genId(),
      ktvId: '',
      ktvName: '',
      segments: [{
        id: `seg-${genId()}`,
        roomId: null,
        bedId: null,
        startTime: st,
        duration: dur,
        endTime: calcEndTime(st, dur)
      }],
      noteForKtv: '',
    };
    updateOrder(orderId, o => ({
      ...o,
      services: o.services.map(s => s.id === svcId
        ? { ...s, staffList: [...s.staffList, newRow] }
        : s
      ),
    }));
  };

  const removeStaffRow = (orderId: string, svcId: string, rowId: string) => {
    updateOrder(orderId, o => ({
      ...o,
      services: o.services.map(s => s.id === svcId
        ? { ...s, staffList: s.staffList.filter(r => r.id !== rowId) }
        : s
      ),
    }));
  };

  const isDispatchReady = (order: PendingOrder): boolean =>
    order.services.every(s => {
      if (s.duration === 0) return true;
      if (isUtilityService(s)) return true;
      // Skip merged children — they're managed by the parent service
      if (s.mergedIntoId || s.options?.mergedIntoId) return true;
      
      // BẢO VỆ: Nếu đơn đã từng dispatch, cho phép submit với staffList rỗng (để gỡ KTV)
      const isAlreadyDispatched = order.dispatchStatus !== 'pending';
      if (s.staffList.length === 0) {
        return isAlreadyDispatched;
      }

      return s.staffList.every(r => 
        r.ktvId !== '' && 
        r.segments.length > 0 &&
        r.segments.every(seg => seg.roomId !== null && seg.bedId !== null && seg.startTime !== '')
      )
    });

  const getMissingInfo = (order: PendingOrder): string[] => {
    const missing: string[] = [];
    order.services.forEach((s, i) => {
      if (s.duration === 0) return;
      s.staffList.forEach((r, j) => {
        const prefix = `Dịch vụ ${i + 1} · KTV ${j + 1}`;
        if (!r.ktvId) missing.push(`${prefix}: Chưa chọn KTV`);
        r.segments.forEach((seg, k) => {
            const segPrefix = `${prefix} · Chặng ${k + 1}`;
            if (!seg.roomId) missing.push(`${segPrefix}: Chưa chọn Phòng`);
            if (!seg.bedId) missing.push(`${segPrefix}: Chưa chọn Giường`);
            if (!seg.startTime) missing.push(`${segPrefix}: Chưa nhập giờ bắt đầu`);
        });
      });
    });
    return missing;
  };

  const addServiceBlock = async (svcId: string, svcName: string, duration: number) => {
    if (!selectedOrderId) return;

    try {
        const svcDef = allServices.find((s: any) => s.id === svcId);
        const { addAddonServices } = await import('./actions');
        // Thêm dịch vụ vào DB ngay lập tức để lấy ID chuẩn, nhưng KHÔNG fetchData để tránh mất dữ liệu đang sửa dở
        const guestIdToUse = selectedGuestForAddon || (selectedSubOrder as any)?.guest?.id || undefined;
        const targetBookingId = selectedSubOrder?.bookingId || selectedOrderId;
        if (!targetBookingId) return;
        const res = await addAddonServices(targetBookingId, [{ serviceId: svcId, qty: 1, guestId: guestIdToUse }], 'ADMIN');
        
        if (res.success && res.newItems && res.newItems.length > 0) {
            const newItem = res.newItems[0];
            const realId = newItem.id;
            
            const now = new Date();
            const startTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            
            const existingSvcForGuest = selectedSubOrder?.services?.find((s: any) => guestIdToUse && (s.guestId === guestIdToUse || s.customerGroupId === guestIdToUse));
            const targetGroupId = existingSvcForGuest ? (existingSvcForGuest.customerGroupId || existingSvcForGuest.id) : (selectedSubOrder?.services?.[0]?.customerGroupId || selectedSubOrder?.services?.[0]?.id);

            const newBlock: ServiceBlock = {
              id: realId, // Dùng ID thật từ DB
              serviceId: svcId,
              serviceName: svcName,
              duration,
              customerGroupId: targetGroupId,
              selectedRoomId: null,
              bedId: null,
              staffList: [{ 
                id: `sr-${genId()}`, 
                ktvId: '', 
                ktvName: '', 
                segments: [{
                    id: `seg-${genId()}`,
                    roomId: null,
                    bedId: null,
                    startTime,
                    duration,
                    endTime: calcEndTime(startTime, duration)
                }],
                noteForKtv: '' 
              }],
              adminNote: '',
              genderReq: 'ANY',
              strength: 'NORMAL',
              focus: '',
              avoid: '',
              customerNote: '',
              timeStart: null,
              timeEnd: null,
              status: 'WAITING',
              is_utility: (svcDef as any)?.is_utility || svcId === 'NHS0900',
              guestId: guestIdToUse,

              options: { isAddon: true, isPaid: false }
            };
            
            setOrders(prev => prev.map(o =>
              o.id === targetBookingId 
                  ? { ...o, services: [...o.services, newBlock], totalAmount: res.newTotalAmount } 
                  : o
            ));
            setShowAddSvcModal(false);
            setTimeout(() => {
                const dispatchContainer = document.getElementById('dispatch-container');
                if (dispatchContainer) {
                    dispatchContainer.scrollTo({ top: dispatchContainer.scrollHeight, behavior: 'smooth' });
                }
            }, 100);
        } else {
            alert('Lỗi thêm dịch vụ: ' + (res.error || 'Unknown error'));
        }
    } catch (err) {
        console.error(err);
        alert('Lỗi hệ thống khi thêm dịch vụ!');
    }
  };

  const handleEditService = async (newServiceId: string, newServiceName: string, newDuration: number) => {
    if (!editingSvc) return;
    const { orderId, svcId, oldSvcName } = editingSvc;

    const isConfirm = confirm(`Xác nhận đổi "${oldSvcName}" thành "${newServiceName}"? Hệ thống sẽ tự tính lại tiền và thời gian kết thúc.`);
    if (!isConfirm) return;

    try {
        const { editBookingService } = await import('./actions');
        // Fetch new service def to be safe
        let svcDef = allServices.find((s: any) => s.id === newServiceId);
        if (!svcDef) {
            alert('Không tìm thấy ID dịch vụ!');
            return;
        }

        const res = await editBookingService(orderId, svcId, newServiceId);
        if (res.success) {
            const priceDiff = res.priceDiff || 0;
            const diffMsg = priceDiff > 0 ? `Cần thu thêm: ${priceDiff.toLocaleString()}đ` 
                          : priceDiff < 0 ? `Cần thối lại: ${Math.abs(priceDiff).toLocaleString()}đ` 
                          : 'Không chênh lệch giá.';
            alert(`✅ Đổi dịch vụ thành công!\nTổng tiền mới: ${(res.newTotalAmount || 0).toLocaleString()}đ\n${diffMsg}`);
            
            // Cập nhật local state
            setOrders(prev => prev.map(o => 
                o.id === orderId ? {
                    ...o,
                    totalAmount: res.newTotalAmount,
                    services: o.services.map(s => s.id === svcId ? {
                        ...s,
                        serviceId: newServiceId,
                        serviceName: res.newServiceName,
                        duration: res.newDuration,
                        options: {
                            ...(s.options || {}),
                            displayName: res.newDisplayName
                        },
                        // Update the end time of segments if we can
                        staffList: s.staffList.map(st => ({
                            ...st,
                            segments: st.segments.map(seg => ({
                                ...seg,
                                duration: res.newDuration,
                                endTime: calcEndTime(seg.startTime, res.newDuration)
                            }))
                        }))
                    } : s)
                } : o
            ));
            
            setEditingSvc(null);
            setShowAddSvcModal(false);
            // fetchData(); // Không bắt buộc vì đã patch state
        } else {
            alert('Lỗi đổi dịch vụ: ' + (res.error || 'Unknown error'));
        }
    } catch (err) {
        console.error(err);
        alert('Lỗi hệ thống khi đổi dịch vụ!');
    }
  };

  const handleDirectAddon = async (svcId: string, svcName: string, duration: number) => {
      if (!selectedOrderId) return;
      // Tìm service bằng cách so id trước (để đảm bảo không bị trùng tên như Gội đầu 30p/45p/60p)
      let svcDef = allServices.find((s: any) => s.id === svcId);
      
      if (!svcDef) {
          svcDef = allServices.find((s: any) => {
              const parsedName = (typeof s.nameVN === 'object' && s.nameVN !== null) 
                ? (s.nameVN.vn || s.nameVN.en || s.nameVN) 
                : (s.nameVN || s.nameEN || '');
              return parsedName === svcName || s.nameEN === svcName || s.id === svcName;
          });
      }

      if (!svcDef) {
          alert('Không tìm thấy ID dịch vụ!');
          return;
      }
      
      const isConfirm = confirm(`Xác nhận thêm dịch vụ "${svcName}" (${(svcDef.priceVND || 0).toLocaleString()}đ) vào đơn hàng đang chạy?`);
      if (!isConfirm) return;

      try {
          const guestIdToUse = (selectedSubOrder as any)?.guest?.id || undefined;
          const targetBookingId = selectedSubOrder?.bookingId || selectedOrderId;
          const res = await addAddonServices(targetBookingId, [{ serviceId: svcDef.id, qty: 1, guestId: guestIdToUse }], 'ADMIN');
          if (res.success) {
              alert(`✅ Thêm "${svcName}" thành công! Tổng tiền mới: ${(res.newTotalAmount || 0).toLocaleString()}đ`);
              setShowAddSvcModal(false);
                fetchData();
          } else {
              alert('Lỗi: ' + res.error);
          }
      } catch (err) {
          console.error(err);
          alert('Lỗi hệ thống!');
      }
  };

  const handleConfirmAddonPayment = async (orderId: string) => {
      if (!confirm('Xác nhận đã thu tiền phát sinh cho đơn hàng này?')) return;
      
      try {
          // Import dynamic to avoid top-level dependency issues if needed, or we can just use an API route
          // But since we use server actions:
          const { confirmAddonPayment } = await import('./actions');
          const res = await confirmAddonPayment(orderId);
          if (res.success) {
              alert('✅ Đã xác nhận thu tiền thành công!');
              fetchData();
          } else {
              alert('Lỗi: ' + res.error);
          }
      } catch (err) {
          console.error(err);
          alert('Lỗi hệ thống!');
      }
  };

  const removeServiceBlock = async (orderId: string, svcId: string) => {
    if (!confirm('Xác nhận xóa dịch vụ này khỏi đơn? Tổng tiền sẽ được tính lại.')) return;
    try {
      const { removeBookingItem } = await import('./actions');
      const res = await removeBookingItem(orderId, svcId);
      if (res.success) {
        setOrders(prev => prev.map(o =>
          o.id === orderId ? { ...o, services: o.services.filter(s => s.id !== svcId), totalAmount: res.newTotalAmount } : o
        ));
      } else {
        alert('Lỗi: ' + res.error);
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi hệ thống khi xóa dịch vụ!');
    }
  };

  const handleUnmergeService = async (orderId: string, svcId: string) => {
    if (!confirm('Xác nhận tách gộp đơn này? Hệ thống sẽ tách các dịch vụ về trạng thái riêng lẻ ban đầu.')) return;
    try {
      // Find the order
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      
      const parentSvc = order.services.find(s => s.id === svcId);
      if (!parentSvc || !parentSvc.mergedServiceIds || parentSvc.mergedServiceIds.length === 0) return;

      const { unmergeServicesAction } = await import('./actions');
      const resetSegments = parentSvc.staffList.flatMap(r => 
          r.segments.map(seg => ({
              ...seg,
              duration: parentSvc.duration
          }))
      );
      
      const res = await unmergeServicesAction(
          parentSvc.id, 
          parentSvc.mergedServiceIds, 
          parentSvc.options, 
          parentSvc.serviceName, 
          resetSegments
      );

      if (!res.success) throw new Error(res.error || 'Unknown error from server');

      alert('✅ Đã tách gộp đơn thành công!');
      fetchData(); // Reload the whole page to get fresh data
    } catch (err) {
      console.error(err);
      alert('Lỗi hệ thống khi tách gộp đơn!');
    }
  };

  const handleSaveDraft = async (skipPreview: any = false, intent: 'DRAFT' | 'DISPATCH' = 'DRAFT', dispatchArgs?: { skipValidation?: boolean, specificSvcIds?: string[], overrideOrderId?: string }) => {
    if (typeof skipPreview !== 'boolean') skipPreview = false;
    
    // When dispatching a specific sub-order, use that order instead of selectedOrder
    const effectiveOrder = dispatchArgs?.overrideOrderId 
        ? orders.find(o => o.id === dispatchArgs.overrideOrderId) 
        : selectedOrder;
    if (!effectiveOrder) return;
    
    try {
      const clonedOrder = JSON.parse(JSON.stringify(effectiveOrder)) as PendingOrder;
      
      let splitPlan: any[] = [];
      if (!clonedOrder.parentBookingId) {
          const groups = new Map<string, string[]>();
          const firstPrimary = clonedOrder.services.find((s: any) => !s.mergedIntoId && !s.options?.mergedIntoId);
          const defaultGroupId = firstPrimary?.customerGroupId || firstPrimary?.id || 'default';

          clonedOrder.services.forEach(svc => {
              if (svc.mergedIntoId || svc.options?.mergedIntoId) return;
              
              // Mọi dịch vụ chưa được lễ tân gán group (kéo thả tay) sẽ được gom chung vào defaultGroup
              // Tránh tình trạng tự động sinh ra Khách B, Khách C (ghost guests) đối với dịch vụ Addon hoặc đa dịch vụ
              const groupId = svc.customerGroupId || svc.id;
              
              if (!groups.has(groupId)) groups.set(groupId, []);
              
              const children = clonedOrder.services.filter(c => c.mergedIntoId === svc.id || c.options?.mergedIntoId === svc.id);
              groups.get(groupId)!.push(svc.id, ...children.map(c => c.id));
          });

          if (groups.size > 1) {
                const usedSuffixes = new Set<string>();
                splitPlan = Array.from(groups.values()).map((itemIds, idx) => {
                    const subOrd = subOrders.find(s => s.originalOrder.id === clonedOrder.id && s.services.some(svc => itemIds.includes(svc.id)));
                    let suffix = subOrd?.subSuffix;
                    if (!suffix || usedSuffixes.has(suffix)) {
                        for (let i = 0; i < 26; i++) {
                            const char = String.fromCharCode(65 + i);
                            if (!usedSuffixes.has(char)) {
                                suffix = char;
                                break;
                            }
                        }
                    }
                    usedSuffixes.add(suffix!);
                    return { suffix: suffix!, itemIds };
                });
            }
      }

      if (splitPlan.length > 1 && !skipPreview) {
          setSplitPreviewState({
              isOpen: true,
              intent,
              splitPlan,
              order: clonedOrder,
              dispatchArgs
          });
          return; // Stop here, modal will continue the flow
      }

      const techCodesSet = new Set<string>();

      for (const svc of clonedOrder.services) {
        for (const row of svc.staffList) {
          if (row.ktvId) techCodesSet.add(row.ktvId);
        }
      }

      const combinedTechCodes = Array.from(techCodesSet).join(', ');
      
      const primaryService = clonedOrder.services[0];
      const primaryStaff = primaryService?.staffList[0];
      const primarySeg = primaryStaff?.segments[0];
      
      const itemUpdates = clonedOrder.services.map((svc, index) => {
          const isChild = !!(svc.mergedIntoId || svc.options?.mergedIntoId);
          const allSegments = svc.staffList.flatMap(r => 
            r.segments.map(seg => ({ ...seg, ktvId: r.ktvId, duration: isChild ? 0 : seg.duration }))
          );

          return {
              id: svc.id,
              roomName: allSegments[0]?.roomId || primarySeg?.roomId, 
              bedId: allSegments[0]?.bedId || primarySeg?.bedId,
              technicianCodes: (svc.mergedIntoId || isUtilityService(svc)) ? [] : svc.staffList.map(r => r.ktvId).filter(Boolean),
              segments: allSegments,
              options: {
                  ...safeParseOptions(svc.options),
                  displayName: svc.displayName || svc.options?.displayName || svc.serviceName,
                  mergedIntoId: svc.mergedIntoId,
                  mergedServiceIds: svc.mergedServiceIds,
                  customerGroupId: svc.customerGroupId || svc.id,
                  order: index,
                  note: svc.customerNote?.split(' | ')[0] || '', 
                  therapist: svc.genderReq,
                  strength: svc.strength,
                  focus: svc.focus.split(',').map(f => f.trim()).filter(Boolean),
                  avoid: svc.avoid.split(',').map(a => a.trim()).filter(Boolean),
                  noteForKtv: svc.staffList?.[0]?.noteForKtv || '',
                  notesForKtvs: Object.fromEntries(
                      svc.staffList
                          .filter(r => r.ktvId && r.noteForKtv)
                          .map(r => [r.ktvId, r.noteForKtv])
                  ),
                  serviceNamesForKtvs: Object.fromEntries(
                      svc.staffList
                          .filter(r => r.ktvId && r.serviceNameForKtv)
                          .map(r => [r.ktvId, r.serviceNameForKtv])
                  )
              }
          };
      });

      let finalNotesToSave = primaryService?.adminNote || '';
      if (clonedOrder.rawNotes && typeof clonedOrder.rawNotes === 'string' && clonedOrder.rawNotes.trim().startsWith('{')) {
          try {
              const parsed = JSON.parse(clonedOrder.rawNotes);
              parsed.receptionNote = primaryService?.adminNote;
              finalNotesToSave = JSON.stringify(parsed);
          } catch {
              finalNotesToSave = primaryService?.adminNote || '';
          }
      }

      const { saveDraftDispatch } = await import('./actions');
      const res = await saveDraftDispatch(clonedOrder.id, {
        bedId: primarySeg?.bedId || null,
        roomName: primarySeg?.roomId || null,
        notes: finalNotesToSave,
        itemUpdates: itemUpdates
      });

      if (res.success) {
        if (splitPlan.length > 1) {
            const { data: splitRes, error: splitErr } = await supabase.rpc('split_booking_into_sub_bookings', {
                p_booking_id: clonedOrder.parentBookingId || clonedOrder.id,
                p_split_plan: splitPlan
            });
            
            if (splitErr || (splitRes && !splitRes.success)) {
                console.error('Lỗi khi tách đơn lúc lưu:', splitErr || splitRes?.error);
                alert('Lưu nháp thành công nhưng có lỗi khi chia đơn: ' + (splitErr?.message || splitRes?.error));
            }
        }

        if (intent === 'DISPATCH') {
            await handleDispatch(true, dispatchArgs?.specificSvcIds, dispatchArgs?.overrideOrderId, true, splitPlan);
        } else {
            alert('✅ Đã lưu thông tin' + (splitPlan.length > 1 ? ' và tách đơn' : '') + ' thành công!');
            fetchData();
        }
      } else {
        alert('Lỗi khi lưu tạm: ' + res.error);
      }
    } catch (err) {
      alert('Đã có lỗi bất ngờ xảy ra khi lưu tạm.');
      console.error(err);
    }
  };

  const handleUndoSplit = async () => {
    const orderForUndo = selectedSubOrder?.originalOrder || selectedOrder;
    const targetBookingId = orderForUndo?.parentBookingId || (orderForUndo?.rawStatus === 'SPLIT' ? orderForUndo.id : null);
    if (!orderForUndo || !targetBookingId) return;

    // KIỂM TRA: Không cho phép Hủy nếu có Đơn Con đã bắt đầu làm
    const siblings = orders.filter((o: any) => o.parentBookingId === targetBookingId);
    const hasStarted = siblings.some((o: any) => o.rawStatus !== 'NEW' && o.rawStatus !== 'CANCELLED');
    if (hasStarted) {
        alert('❌ LỖI: Không thể Hủy Gộp/Tách! Có ít nhất 1 đơn con đã được KTV thực hiện hoặc đã điều phối. Chỉ có thể hủy khi tất cả đơn con đều ở trạng thái Chờ (NEW).');
        return;
    }

    if (!confirm('Bạn có chắc chắn muốn HỦY GỘP/TÁCH và đưa tất cả các dịch vụ về lại đơn gốc ban đầu?')) {
        return;
    }

    try {
        const { data, error } = await supabase.rpc('undo_split_booking', {
            p_booking_id: targetBookingId
        });

        if (error || (data && !data.success)) {
            console.error('Lỗi khi hủy tách đơn:', error, data);
            alert('Lỗi khi hủy tách đơn: ' + JSON.stringify(error || data?.error));
            return;
        }

        alert('✅ Đã gộp đơn thành công!');
        fetchData();
        setSelectedOrderId(null);
        setSelectedSubOrderId(null);
    } catch (err) {
        console.error(err);
        alert('Đã có lỗi bất ngờ xảy ra khi hủy tách đơn.');
    }
  };

  const handleDispatch = async (skipValidation: boolean = false, specificSvcIds?: string[], overrideOrderId?: string, skipSave: boolean = false, precomputedSplitPlan?: any[]) => {
    const orderToDispatch = overrideOrderId ? orders.find(o => o.id === overrideOrderId) : selectedOrder;
    if (!orderToDispatch) return;
    if (!skipValidation) {
      // ⚠️ Khi dispatch lẻ (specificSvcIds), chỉ validate các DV đang dispatch, không check toàn bộ đơn
      const orderToValidate = specificSvcIds && specificSvcIds.length > 0 
        ? { ...orderToDispatch, services: orderToDispatch.services.filter(s => specificSvcIds.includes(s.id)) }
        : orderToDispatch;
        
      // Lọc bỏ các KTV trống để không báo lỗi "Chưa chọn KTV" (cho phép xoá KTV và lưu luôn)
      const cleanOrderToValidate = {
          ...orderToValidate,
          services: orderToValidate.services.map(svc => ({
              ...svc,
              staffList: svc.staffList.filter(r => r.ktvId)
          }))
      };
      
      const missing = getMissingInfo(cleanOrderToValidate);
      if (missing.length > 0) {
        alert(`⚠️ Vui lòng điền đầy đủ thông tin:\n\n${missing.map(m => `• ${m}`).join('\n')}`);
        return;
      }

      // 🛡️ CHẶN: Khách chỉ có dịch vụ tiện ích (Phòng riêng) mà không có dịch vụ chính
      const allSvcs = orderToDispatch.services.filter(s => !s.mergedIntoId && !s.options?.mergedIntoId);
      const guestGroupsForValidation = new Map<string, typeof allSvcs>();
      const firstPrimarySvc = allSvcs.find(s => !isUtilityService(s));
      const defaultGrpId = firstPrimarySvc?.customerGroupId || firstPrimarySvc?.id || 'default';
      allSvcs.forEach(svc => {
        const grpId = svc.customerGroupId || (isUtilityService(svc) ? defaultGrpId : svc.id);
        if (!guestGroupsForValidation.has(grpId)) guestGroupsForValidation.set(grpId, []);
        guestGroupsForValidation.get(grpId)!.push(svc);
      });
      if (guestGroupsForValidation.size > 1) {
        const utilityOnlyGuests: string[] = [];
        let guestIdx = 0;
        guestGroupsForValidation.forEach((svcs) => {
          guestIdx++;
          const hasMainService = svcs.some(s => !isUtilityService(s));
          if (!hasMainService) {
            const utilNames = svcs.map(s => s.serviceName || 'Tiện ích').join(', ');
            utilityOnlyGuests.push(`Khách ${guestIdx} chỉ có tiện ích (${utilNames})`);
          }
        });
        if (utilityOnlyGuests.length > 0) {
          alert(`⚠️ Không thể điều phối!\n\nDịch vụ tiện ích (Phòng riêng...) không thể đứng một mình cho một khách. Vui lòng thêm dịch vụ chính hoặc gộp vào khách khác.\n\n${utilityOnlyGuests.map(m => `• ${m}`).join('\n')}`);
          return;
        }
      }
    }

    if (!skipSave) {
        await handleSaveDraft(false, 'DISPATCH', { skipValidation, specificSvcIds, overrideOrderId });
        return;
    }

    try {
      const clonedOrder = JSON.parse(JSON.stringify(orderToDispatch)) as PendingOrder;
      const isPartial = !!(specificSvcIds && specificSvcIds.length > 0);
      
      let splitPlan = precomputedSplitPlan || [];
      if (!precomputedSplitPlan && !clonedOrder.parentBookingId) {
          const groups = new Map<string, string[]>();
          const firstPrimary = clonedOrder.services.find((s: any) => !s.mergedIntoId && !s.options?.mergedIntoId);
          const defaultGroupId = firstPrimary?.customerGroupId || firstPrimary?.id || 'default';
          clonedOrder.services.forEach(svc => {
              if (svc.mergedIntoId || svc.options?.mergedIntoId) return;
              const groupId = svc.customerGroupId || svc.id;
              if (!groups.has(groupId)) groups.set(groupId, []);
              const children = clonedOrder.services.filter(c => c.mergedIntoId === svc.id || c.options?.mergedIntoId === svc.id);
              groups.get(groupId)!.push(svc.id, ...children.map(c => c.id));
          });
          if (groups.size > 1) {
                const usedSuffixes = new Set<string>();
                splitPlan = Array.from(groups.values()).map((itemIds, idx) => {
                    const subOrd = subOrders.find(s => s.originalOrder.id === clonedOrder.id && s.services.some(svc => itemIds.includes(svc.id)));
                    let suffix = subOrd?.subSuffix;
                    if (!suffix || usedSuffixes.has(suffix)) {
                        for (let i = 0; i < 26; i++) {
                            const char = String.fromCharCode(65 + i);
                            if (!usedSuffixes.has(char)) {
                                suffix = char;
                                break;
                            }
                        }
                    }
                    usedSuffixes.add(suffix!);
                    return { suffix: suffix!, itemIds };
                });
            }
      }

      // 🚀 BƯỚC 2: CHUẨN BỊ PAYLOADS ĐIỀU PHỐI
      // Determine what services we actually want to dispatch
      const targetSvcIds = isPartial ? specificSvcIds! : (selectedSubOrder ? selectedSubOrder.services.map((s: any) => s.id) : clonedOrder.services.map((s:any) => s.id));
      
      const dispatchPayloads: Array<{
          bookingId: string;
          dbBookingId: string;
          itemUpdates: any[];
          mergedAssignments: any[];
          bedId?: string | null;
          roomName?: string | null;
      }> = [];

      let bookingGroups: Array<{ bookingId: string, svcIds: string[] }> = [];
      if (splitPlan.length > 1) {
          bookingGroups = splitPlan.map(plan => ({
              bookingId: `${clonedOrder.parentBookingId || clonedOrder.id}-${plan.suffix}`,
              svcIds: plan.itemIds
          }));
      } else {
          bookingGroups = [{
              bookingId: clonedOrder.id,
              svcIds: clonedOrder.services.map(s => s.id)
          }];
      }

      // ⚠️ Cấu hình chung
      let finalNotesToSave = clonedOrder.services[0]?.adminNote || '';
      if (clonedOrder.rawNotes && typeof clonedOrder.rawNotes === 'string' && clonedOrder.rawNotes.trim().startsWith('{')) {
          try {
              const parsed = JSON.parse(clonedOrder.rawNotes);
              parsed.receptionNote = clonedOrder.services[0]?.adminNote;
              finalNotesToSave = JSON.stringify(parsed);
          } catch {
              finalNotesToSave = clonedOrder.services[0]?.adminNote || '';
          }
      }
      // 'SPLIT' là trạng thái của đơn cha, không bao giờ được gán xuống đơn con
      const isPending = !clonedOrder.rawStatus || ['NEW', 'pending', 'WAITING', 'SPLIT'].includes(clonedOrder.rawStatus);
      const bookingStatus = isPartial ? null : (isPending ? 'PREPARING' : clonedOrder.rawStatus);

      for (const group of bookingGroups) {
          const groupTargetSvcIds = group.svcIds.filter(id => targetSvcIds.includes(id));
          if (groupTargetSvcIds.length === 0) continue; 

          const allStaffAssignments: any[] = [];
          const techCodesSet = new Set<string>();
          const targetServicesInGroup = clonedOrder.services.filter(s => groupTargetSvcIds.includes(s.id));
          
          for (const svc of targetServicesInGroup) {
              if (svc.mergedIntoId) continue;
              for (const row of svc.staffList) {
                  if (!row.ktvId) continue;
                  techCodesSet.add(row.ktvId);
                  
                  const currentTurn = turns.find(t => t.employee_id === row.ktvId);
                  let turnsCompleted = currentTurn?.turns_completed || 0;
                  let queuePos = currentTurn?.queue_position || 0;
                  
                  if (!currentTurn || currentTurn.current_order_id !== group.bookingId) {
                      const currentMax = Math.max(...turns.map(t => t.queue_position), 0);
                      const existingAssignment = allStaffAssignments.find(a => a.ktvId === row.ktvId);
                      if (existingAssignment) {
                          queuePos = existingAssignment.queuePos;
                      } else {
                          const uniqueAddedKtvs = new Set(allStaffAssignments.map(a => a.ktvId));
                          queuePos = currentMax + uniqueAddedKtvs.size + 1;
                      }
                  }
                  
                  const firstSeg = row.segments[0];
                  const lastSeg = row.segments[row.segments.length - 1];
                  allStaffAssignments.push({
                      ktvId: row.ktvId,
                      bookingItemId: svc.id,
                      roomId: firstSeg.roomId,
                      bedId: firstSeg.bedId,
                      turnsCompleted,
                      queuePos,
                      startTime: firstSeg.startTime,
                      endTime: lastSeg.endTime 
                  });
              }
          }

          // ⚠️ "keepalive" entries
          const ktvsBeingDispatched = new Set(allStaffAssignments.map(a => a.ktvId));
          const otherServicesInGroup = clonedOrder.services.filter(s => !groupTargetSvcIds.includes(s.id));
          for (const svc of otherServicesInGroup) {
              for (const row of svc.staffList) {
                  if (!row.ktvId) continue;
                  if (!ktvsBeingDispatched.has(row.ktvId)) continue;
                  if (allStaffAssignments.some(a => a.ktvId === row.ktvId && a.bookingItemId === svc.id)) continue;
                  const firstSeg = row.segments[0];
                  const lastSeg = row.segments[row.segments.length - 1];
                  allStaffAssignments.push({
                      ktvId: row.ktvId,
                      bookingItemId: svc.id,
                      roomId: firstSeg?.roomId || null,
                      bedId: firstSeg?.bedId || null,
                      turnsCompleted: 0,
                      queuePos: 0,
                      startTime: firstSeg?.startTime || '',
                      endTime: lastSeg?.endTime || ''
                  });
              }
          }

          const primaryService = targetServicesInGroup[0];
          const primarySeg = primaryService?.staffList[0]?.segments[0];

          const itemUpdates = targetServicesInGroup.map(svc => {
              const originalIndex = clonedOrder.services.findIndex(s => s.id === svc.id);
              const isChild = !!(svc.mergedIntoId || svc.options?.mergedIntoId);
              
              // Segment duration from updateGroup already contains the correct TOTAL merged duration
              const correctedStaffList = svc.staffList;
              
              const allSegments = correctedStaffList.flatMap(r => r.segments.map(seg => ({ ...seg, ktvId: r.ktvId, duration: isChild ? 0 : seg.duration })));
              return {
                  id: svc.id,
                  roomName: allSegments[0]?.roomId || primarySeg?.roomId, 
                  bedId: allSegments[0]?.bedId || primarySeg?.bedId,
                  technicianCodes: (svc.mergedIntoId || isUtilityService(svc)) ? [] : svc.staffList.map(r => r.ktvId).filter(Boolean),
                  status: svc.mergedIntoId ? 'WAITING' : ((svc.status && !['NEW', 'WAITING'].includes(svc.status)) ? svc.status : 'PREPARING'), 
                  segments: allSegments,
                  options: {
                      ...safeParseOptions(svc.options),
                      displayName: svc.displayName || svc.options?.displayName || svc.serviceName,
                      mergedIntoId: svc.mergedIntoId,
                      mergedServiceIds: svc.mergedServiceIds,
                      customerGroupId: svc.customerGroupId,
                      order: originalIndex !== -1 ? originalIndex : 999,
                      note: svc.customerNote?.split(' | ')[0] || '', 
                      therapist: svc.genderReq,
                      strength: svc.strength,
                      focus: svc.focus.split(',').map(f => f.trim()).filter(Boolean),
                      avoid: svc.avoid.split(',').map(a => a.trim()).filter(Boolean),
                      noteForKtv: svc.staffList?.[0]?.noteForKtv || '',
                      notesForKtvs: Object.fromEntries(
                          svc.staffList.filter(r => r.ktvId && r.noteForKtv).map(r => [r.ktvId, r.noteForKtv])
                      ),
                      serviceNamesForKtvs: Object.fromEntries(
                          svc.staffList.filter(r => r.ktvId && r.serviceNameForKtv).map(r => [r.ktvId, r.serviceNameForKtv])
                      )
                  }
              };
          });

          dispatchPayloads.push({
              bookingId: group.bookingId,
              // ⚠️ Phải bắn vào đúng đơn ĐANG GIỮ dịch vụ. Sau khi tách, BookingItems đã chuyển sang
              // đơn con, còn đơn cha chuyển sang SPLIT và bị RPC dispatch_confirm_booking chặn
              // ("Đơn đã tách thành đơn con. Vui lòng điều phối từng đơn con riêng") -> KTV không nhận được đơn.
              dbBookingId: group.bookingId,
              itemUpdates,
              mergedAssignments: allStaffAssignments,
              bedId: isPartial ? undefined : (primarySeg?.bedId || null),
              roomName: isPartial ? undefined : (primarySeg?.roomId || null),
          });
      }

      // 🚀 BƯỚC 3: GỌI API CHO TỪNG PAYLOAD
      for (const payload of dispatchPayloads) {
          const res = await processDispatch(payload.dbBookingId, {
              status: bookingStatus as any,
              bedId: payload.bedId,
              roomName: payload.roomName,
              staffAssignments: payload.mergedAssignments,
              date: selectedDate,
              notes: isPartial ? undefined : finalNotesToSave,
              itemUpdates: payload.itemUpdates
          });
          if (!res.success) {
              alert(`Lỗi khi điều phối đơn ${payload.bookingId}: ` + res.error);
              return; 
          }
      }

      if (!isPartial || targetSvcIds.length === clonedOrder.services.length) {
          if ((clonedOrder.dispatchStatus as string) === 'pending' || (clonedOrder.dispatchStatus as string) === 'NEW') {
              setOrders(prev => prev.map(o =>
                  o.id === clonedOrder.id ? { ...o, dispatchStatus: 'dispatched' } : o
              ));
              setSelectedOrderId(null);
              setLeftPanelTab('dispatched');
          } else {
              alert(`✅ Cập nhật và điều phối thành công!`);
          }
      } else {
          setOrders(prev => prev.map(o => {
              if (o.id !== clonedOrder.id) return o;
              return {
                  ...o,
                  services: o.services.map(s => {
                      if (!targetSvcIds.includes(s.id)) return s;
                      return { ...s, options: { ...s.options }, status: (s.status && !['NEW', 'WAITING'].includes(s.status)) ? s.status : 'PREPARING' }; 
                  })
              };
          }));
          alert(`✅ Đã điều phối riêng dịch vụ thành công!`);
      }
      fetchData();

    } catch (err) {
      alert('Đã có lỗi bất ngờ xảy ra.');
      console.error(err);
    }
  };



  /**
   * Huỷ TOÀN BỘ đơn. Dùng chung hộp thoại với huỷ đơn con, vì cũng phải hỏi
   * lý do và quyết định có cộng giờ đã làm cho KTV hay không.
   */
  const handleCancelBooking = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);

    let workedMinutes: number | null = null;
    const ktvSet = new Set<string>();
    for (const s of (order?.services || [])) {
      for (const st of ((s as any).staffList || [])) {
        if (st.ktvId) ktvSet.add(st.ktvId);
        for (const seg of (st.segments || [])) {
          const ms = workedMsOf(seg, seg.actualEndTime || Date.now());
          if (ms !== null) workedMinutes = (workedMinutes || 0) + Math.round(ms / 60000);
        }
      }
    }

    import('./actions').then(m => m.kiemTraTruocKhiChot(orderId, 'CANCEL'))
      .then(chk => { if (chk?.canhBao) setCancelItemModal(prev => prev ? { ...prev, canhBao: chk.canhBao } : prev); })
      .catch(() => {});

    setCancelItemModal({
      orderId,
      itemIds: [],            // rỗng = huỷ cả đơn, không phải từng dịch vụ
      wholeBooking: true,
      ktvLabel: Array.from(ktvSet).join(', ') || undefined,
      customerName: order?.customerName,
      workedMinutes,
    });
    setContextMenu(null);
  };
  /** Mở hộp thoại huỷ — thay cho prompt() cũ, vì còn phải hỏi có cộng giờ hay không. */
  const handleCancelBookingItem = (orderId: string, itemId: string, subOrder?: any) => {
    const svcs = subOrder?.services || [];
    const itemIds: string[] = svcs.length > 0 ? svcs.map((s: any) => s.id) : [itemId];

    // Số phút đã làm, để quầy biết đang tước của KTV bao nhiêu.
    let workedMinutes: number | null = null;
    for (const s of svcs) {
      for (const st of (s.staffList || [])) {
        for (const seg of (st.segments || [])) {
          const ms = workedMsOf(seg, seg.actualEndTime || Date.now());
          if (ms !== null) workedMinutes = (workedMinutes || 0) + Math.round(ms / 60000);
        }
      }
    }

    setCancelItemModal({
      orderId,
      itemIds,
      ktvLabel: (subOrder?.ktvIds || []).join(', ') || undefined,
      customerName: orders.find(o => o.id === orderId)?.customerName,
      workedMinutes,
    });
    setContextMenu(null);

    // Hỏi nền: KTV đã bấm báo gì chưa? Nếu rồi thì huỷ là mất trắng oan.
    import('./actions').then(m => m.kiemTraTruocKhiChot(orderId, 'CANCEL'))
      .then(chk => { if (chk?.canhBao) setCancelItemModal(prev => prev ? { ...prev, canhBao: chk.canhBao } : prev); })
      .catch(() => {});
  };

  const submitCancelItems = async (reason: string, cancelCredit: 'NONE' | 'WORKED') => {
    if (!cancelItemModal) return;

    if (cancelItemModal.wholeBooking) {
      const res = await cancelBooking(cancelItemModal.orderId, selectedDate, cancelCredit, reason);
      if (!res.success) throw new Error(res.error || 'Không huỷ được đơn');
      if (selectedOrderId === cancelItemModal.orderId) setSelectedOrderId(null);
      await fetchData();
      return;
    }

    for (const itemId of cancelItemModal.itemIds) {
      const res = await apiClient.post<any>('/api/bookings/cancel-item', {
        bookingId: cancelItemModal.orderId,
        itemId,
        reason,
        cancelCredit,
      });
      if (!res.success) throw new Error(res.error || 'Không huỷ được dịch vụ');
    }
    await fetchData();
  };


  async function handleConfirmPauseSwap(bookingItemId: string, action: 'PAUSE' | 'RESUME' | 'SWAP', oldKtvId?: string, newKtvId?: string, extraTimeMins?: number, keepTurnForOldKtv?: boolean, assignedMins?: number) {
    try {
      const data = await apiClient.post<any>(API.KTV.PAUSE_SWAP, {
          action,
          bookingItemId,
          oldKtvId,
          newKtvId,
          extraTimeMins,
          keepTurnForOldKtv,
          assignedMins,
          businessDate: selectedDate
      });
      if (!data.success) throw new Error(data.error || 'Có lỗi xảy ra');
      
      // Thành công => Cập nhật lại UI
      await fetchData(); // Tải lại toàn bộ dữ liệu Board
    } catch (err: any) {
      throw err;
    }
  }

  const handleApproveHandover = async (itemId: string, comment: string, deductPoints: boolean) => {
        try {
            const res = await fetch('/api/reception/handover/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingItemId: itemId, action: 'APPROVE', deductPoints }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            
            alert('✅ Đã duyệt ảnh bàn giao thành công!');
            fetchData();
        } catch (err: any) {
            console.error(err);
            alert('Lỗi duyệt: ' + err.message);
        }
    };

    const handleRejectHandover = async (itemId: string, rejectOption: string, reason: string, deductPoints: boolean, rejectImages: string[] = []) => {
        try {
            const res = await fetch('/api/reception/handover/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    bookingItemId: itemId, 
                    action: 'REJECT', 
                    rejectOption, 
                    reason,
                    deductPoints,
                    rejectImages
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            
            const messages: Record<string, string> = {
                REDO: '🔄 Đã yêu cầu KTV dọn lại phòng.',
                DEDUCT: '💸 Đã trừ tiền phạt KTV.',
                CONFISCATE: '🚫 Đã tước tiền tua đơn này.',
            };
            alert(messages[rejectOption] || data.message);
            fetchData();
        } catch (err: any) {
            console.error(err);
            alert('Lỗi từ chối: ' + err.message);
        }
    };

  async function handleUpdateStatus(orderId: string, newStatus: string, itemIds?: string[], skipConfirm?: boolean, targetKtvIds?: string[], forceBackward: boolean = false) {
    // Determine context for confirmation
    const isPartial = itemIds && itemIds.length > 0;
    
    if (!skipConfirm) {
      let confirmMsg = `Xác nhận cập nhật trạng thái đơn hàng này?`;
      if (newStatus === 'COMPLETED' || newStatus === 'DONE') {
        confirmMsg = `Xác nhận HẾT GIỜ? Khách sẽ được nhắc nhở đánh giá, và đơn sẽ chuyển sang trạng thái CHỜ ĐÁNH GIÁ.`;
      } else if (newStatus === 'CLEANING' || newStatus === 'FEEDBACK') {
        confirmMsg = `Xác nhận BẮT ĐẦU DỌN PHÒNG? KTV sẽ được giải phóng để nhận khách mới.`;
      } else if (newStatus === 'DONE') {
        confirmMsg = `Xác nhận ĐÃ DỌN XONG PHÒNG VÀ HOÀN TẤT? Giường sẽ được nhả ra để đón khách mới.`;
      } else if (newStatus === 'IN_PROGRESS') {
        const order = orders.find(o => o.id === orderId);
        let plannedTime = order?.timeBooking || null;
        if (isPartial && order && itemIds) {
            const service = order.services.find(s => itemIds.includes(s.id));
            if (service) {
               try {
                   const segs = JSON.parse((service as any).segments || '[]');
                   const targetSeg = segs.find((seg: any) => targetKtvIds?.includes(seg.ktvId));
                   if (targetSeg && targetSeg.startTime) {
                       plannedTime = targetSeg.startTime;
                   }
               } catch(e) {}
            }
        }
        
        let plannedTimeIso = null;
        try {
            if (plannedTime) {
                // Tạo ISO string từ selectedDate và plannedTime (HH:mm)
                const [h, m] = plannedTime.split(':');
                const d = new Date(selectedDate);
                d.setHours(Number(h), Number(m), 0, 0);
                plannedTimeIso = d.toISOString();
            } else if (order?.createdAt) {
                plannedTimeIso = order.createdAt.endsWith('Z') || order.createdAt.includes('+') 
                    ? order.createdAt 
                    : order.createdAt + 'Z';
            }
        } catch(e) {}
        
        setStartServiceModal({
           isOpen: true,
           orderId,
           itemIds,
           targetKtvIds,
           plannedStartTime: plannedTimeIso,
           onConfirm: (time: string) => executeStatusUpdate(time)
        });
        return;
      }
      
      setConfirmModal({
        isOpen: true,
        message: confirmMsg,
        onConfirm: () => {
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          executeStatusUpdate();
        }
      });
      return;
    }

    executeStatusUpdate();

    async function executeStatusUpdate(customStartTime?: string) {
      try {
        let res;
        if (isPartial) {
            const { updateBookingItemStatus } = await import('./actions');
            res = await updateBookingItemStatus(itemIds, newStatus, selectedDate, orderId, targetKtvIds, forceBackward, customStartTime);
        } else {
            // Note: full booking status update currently does not accept customStartTime in our implementation.
            res = await updateBookingStatus(orderId, newStatus, selectedDate);
        }
        
        if (res.success) {
          setOrders(prev => prev.map(o => {
              if (o.id !== orderId) return o;
              if (!isPartial) {
                  // If it's a full update, hide the order if it's completed (if needed) or let fetchData handle it.
                  // We'll just rely on fetchData, no need to hide it if we don't want it to jump weirdly
                  return o;
              }
              // Optimistic update for partial services
              return {
                  ...o,
                  services: o.services.map(s => {
                      if (itemIds.includes(s.id)) {
                          let newSegments = (s as any).segments;
                          try {
                              let segs = typeof (s as any).segments === 'string' ? JSON.parse((s as any).segments) : ((s as any).segments || []);
                              if (newStatus === 'IN_PROGRESS') {
                                  segs = segs.map((seg: any) => {
                                      if (!targetKtvIds || targetKtvIds.length === 0 || targetKtvIds.includes(seg.ktvId)) {
                                          return { ...seg, actualStartTime: customStartTime || new Date().toISOString() };
                                      }
                                      return seg;
                                  });
                              } else if (['PREPARING', 'WAITING', 'NEW'].includes(newStatus) && forceBackward) {
                                  segs = segs.map((seg: any) => {
                                      if (!targetKtvIds || targetKtvIds.length === 0 || targetKtvIds.includes(seg.ktvId)) {
                                          const copy = { ...seg };
                                          delete copy.actualStartTime;
                                          delete copy.actualEndTime;
                                          delete copy.feedbackTime;
                                          delete copy.reviewTime;
                                          return copy;
                                      }
                                      return seg;
                                  });
                              } else if (['DONE', 'CANCELLED', 'CLEANING', 'FEEDBACK', 'COMPLETED'].includes(newStatus)) {
                                  segs = segs.map((seg: any) => {
                                      if (!targetKtvIds || targetKtvIds.length === 0 || targetKtvIds.includes(seg.ktvId)) {
                                          const copy = { ...seg };
                                          copy.actualEndTime = copy.actualEndTime || new Date().toISOString();
                                          if (['FEEDBACK', 'DONE'].includes(newStatus)) {
                                              copy.feedbackTime = copy.feedbackTime || new Date().toISOString();
                                          }
                                          return copy;
                                      }
                                      return seg;
                                  });
                              }
                              newSegments = JSON.stringify(segs);
                          } catch (e) {}
                          return { ...s, status: newStatus, segments: newSegments } as any;
                      }
                      return s;
                  })
              };
          }));
          
          if (!isPartial && selectedOrderId === orderId) {
              setSelectedOrderId(null);
          }
          setContextMenu(null);
          fetchData();
        } else {
          alert('Lỗi cập nhật trạng thái: ' + res.error);
        }
      } catch (err) {
        alert('Lỗi hệ thống khi cập nhật.');
      }
    }
  };

  const handleCreateQuickBooking = async (data: { customerName: string; customerPhone: string; customerEmail: string; serviceIds: string[]; customerLang: string; guestCount?: number; nationality?: string; isTestOrder: boolean; }) => {
    try {
      const res = await createQuickBooking({
        ...data,
        bookingDate: selectedDate
      });
      if (res.success) {
        fetchData();
        setShowAddOrderModal(false);
      } else {
        alert('Lỗi khi tạo đơn: ' + res.error);
      }
    } catch (err) {
      alert('Lỗi hệ thống khi tạo đơn.');
    }
  };

  const renderSoundToggle = () => {
    const hasUnread = notifications.some(n => !n.isRead);

    return (
      <div className="flex items-center gap-2">
        <button
          onClick={toggleGuestArrivalLock}
          disabled={!guestArrivalLock.enabled}
          aria-label="Báo Khách"
          aria-pressed={guestArrivalLock.active}
          className={`relative w-11 h-11 rounded-full transition-all shadow-sm border flex items-center justify-center ${
              !guestArrivalLock.enabled
                  ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                  : guestArrivalLock.active
                      ? 'bg-red-500 text-white border-red-600 hover:bg-red-600 shadow-md shadow-red-500/40'
                      : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100 hover:text-slate-600'
          }`}
          title={!guestArrivalLock.enabled ? 'Tính năng Báo Khách đang bị tắt trong cài đặt hệ thống.' : guestArrivalLock.active ? `Đang báo có khách — khóa bởi ${guestArrivalLock.lockedBy} lúc ${new Date(guestArrivalLock.lockedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}. Bấm để tắt.` : 'Báo có khách đang đợi (khóa Tan Ca của KTV)'}
        >
          <Users size={20} className={guestArrivalLock.active ? 'animate-pulse' : ''} />
        </button>
        <button
          onClick={async () => {
            if (soundEnabled) {
              setSoundEnabled(false);
              return;
            }

            unlockAudio();

            if (push.permission === 'denied') {
              alert('Bạn đã chặn thông báo trên trình duyệt. Hãy bấm vào biểu tượng Ổ khóa trên thanh địa chỉ để "Cho phép" thông báo nhé!');
              return;
            }

            if (push.permission === 'default') {
              const success = await push.subscribe();
              if (success) setSoundEnabled(true);
              return;
            }

            setSoundEnabled(true);
          }}
          disabled={push.isRegistering}
          className={`w-11 h-11 rounded-full transition-all shadow-sm border flex items-center justify-center
            ${soundEnabled
              ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100'
              : (push.permission === 'denied' ? 'bg-rose-50 text-rose-500 border-rose-100' : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100')}`}
          title={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
        >
          <motion.div
            animate={soundEnabled && hasUnread ? {
              rotate: [0, -15, 15, -15, 15, 0],
              transition: { repeat: Infinity, duration: 0.5 }
            } : {}}
          >
            {push.isRegistering ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : soundEnabled ? (
              <div className="relative">
                <Bell size={20} />
                {hasUnread && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 border-2 border-emerald-50 rounded-full" />}
              </div>
            ) : (
              <BellOff size={20} />
            )}
          </motion.div>
        </button>
      </div>
    );
  };
  return (
    <AppLayout title="Điều Phối">
      <div className="h-[calc(100dvh-3.5rem)] lg:h-[calc(100vh-3rem)] flex flex-col overflow-hidden" style={{ overscrollBehaviorY: 'contain' }}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 mb-2 lg:mb-4 px-1 lg:px-0 mt-1 sm:mt-0">
          <div className="flex lg:flex items-center justify-between sm:block w-full sm:w-auto">
            <div className="w-full">
              <h1 className="text-xl lg:text-2xl font-black text-gray-900 tracking-tight hidden sm:flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-1 bg-gray-100/80 p-1 rounded-xl shadow-inner border border-gray-200">
                  <button
                    onClick={() => setActiveMode('DISPATCH')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeMode === 'DISPATCH'
                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <LayoutList size={14} /> Điều Phối
                  </button>
                  <button
                    onClick={() => setActiveMode('MONITOR')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeMode === 'MONITOR'
                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Columns3 size={14} /> Giám Sát
                  </button>
                  <button
                    onClick={() => window.location.href = '/reception/feedback'}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                  >
                    <Star size={14} /> Đánh Giá
                  </button>
                  <button
                    onClick={() => setActiveMode('TURN_QUEUE')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeMode === 'TURN_QUEUE'
                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Users size={14} /> Sổ Tua
                  </button>
                  <button
                    onClick={() => setActiveMode('ROOMS')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeMode === 'ROOMS'
                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <BedDouble size={14} /> Phòng
                  </button>
                  <button
                    onClick={() => setActiveMode('WEB_BOOKING')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all relative ${
                      activeMode === 'WEB_BOOKING'
                        ? 'bg-white text-emerald-600 shadow-sm border border-gray-200/50'
                        : 'text-gray-500 hover:text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    <Globe size={14} /> Lịch Web
                    {webBookingCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-sm">
                        {webBookingCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveMode('SCHEDULE')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeMode === 'SCHEDULE'
                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <CalendarClock size={14} /> Lịch Hẹn
                  </button>
                </div>
              </h1>
              
              {/* Mobile Mode Switcher */}
              <div className="flex sm:hidden items-center gap-1 bg-gray-100/80 p-1 rounded-xl shadow-inner border border-gray-200 w-full mb-1">
                <button
                  onClick={() => setActiveMode('DISPATCH')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${
                    activeMode === 'DISPATCH'
                      ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <LayoutList size={12} /> <span className="hidden xs:inline">Điều Phối</span>
                </button>
                <button
                  onClick={() => setActiveMode('MONITOR')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${
                    activeMode === 'MONITOR'
                      ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Columns3 size={12} /> <span className="hidden xs:inline">Giám Sát</span>
                </button>
                <button
                  onClick={() => setActiveMode('TURN_QUEUE')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${
                    activeMode === 'TURN_QUEUE'
                      ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Users size={12} /> <span className="hidden xs:inline">Sổ Tua</span>
                </button>
                <button
                  onClick={() => setActiveMode('ROOMS')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${
                    activeMode === 'ROOMS'
                      ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <BedDouble size={12} /> <span className="hidden xs:inline">Phòng</span>
                </button>
                <button
                  onClick={() => setActiveMode('WEB_BOOKING')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[10px] font-bold transition-all relative ${
                    activeMode === 'WEB_BOOKING'
                      ? 'bg-white text-emerald-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-emerald-600'
                  }`}
                >
                  <Globe size={12} /> <span className="hidden xs:inline">Web</span>
                  {webBookingCount > 0 && (
                    <span className="absolute top-1 right-2 min-w-[14px] h-[14px] bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center shadow-sm">
                      {webBookingCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveMode('SCHEDULE')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${
                    activeMode === 'SCHEDULE'
                      ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <CalendarClock size={12} /> <span className="hidden xs:inline">Lịch</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar w-full sm:w-auto">
            {renderSoundToggle()}

            <div className="relative flex-shrink-0 group">
              <CalendarIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 z-10" />
              <div className="pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm font-black bg-white shadow-sm flex items-center gap-1 min-w-[90px] group-hover:border-emerald-200 transition-colors">
                <span className="text-slate-800 tracking-tighter">
                  {new Date(selectedDate).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }).replace('/', '-')}
                </span>
                <ChevronDown size={14} className="text-slate-400" />
              </div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-20"
              />
            </div>

            <button 
              onClick={() => setShowAddOrderModal(true)}
              className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 font-black text-sm transition-all shadow-lg shadow-indigo-200 active:scale-95"
            >
              <Plus size={20} strokeWidth={4} /> <span className="hidden sm:inline">Thêm Đơn</span><span className="sm:hidden">Thêm</span>
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row gap-5 overflow-hidden pb-4 sm:pb-0">
          {activeMode === 'DISPATCH' ? (
            <>
          {/* LEFT: Order Panel */}
          <div className={`${selectedOrderId ? 'hidden md:flex' : 'flex'} w-full md:w-80 flex-1 md:flex-none shrink-0 flex-col border border-gray-200 bg-white rounded-3xl shadow-sm transition-all min-h-0 overflow-hidden`}>
            <div className="p-4 border-b border-gray-100 bg-white shrink-0">
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(v => !v)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl transition-all"
                >
                  <span className={`w-3 h-3 rounded-full shrink-0 ${LEFT_TABS.find(t => t.id === leftPanelTab)?.dot}`} />
                  <span className="flex-1 text-left">
                    <span className="block text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">Trạng thái</span>
                    <span className={`text-sm font-black ${LEFT_TABS.find(t => t.id === leftPanelTab)?.color}`}>
                      {LEFT_TABS.find(t => t.id === leftPanelTab)?.label}
                    </span>
                  </span>
                  <span className="text-xs font-black px-2.5 py-1 rounded-full bg-white border border-gray-200 shadow-sm">{displayedOrders.length}</span>
                  <ChevronDown size={18} className={`text-gray-400 transition-transform duration-300 ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {dropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                      className="absolute top-full mt-2 left-0 right-0 z-30 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-y-auto max-h-64"
                    >
                      {LEFT_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => { setLeftPanelTab(tab.id); setDropdownOpen(false); }}
                          className="w-full flex items-center gap-4 px-5 py-4 hover:bg-indigo-50/50 text-left border-b border-gray-50 last:border-0 transition-colors"
                        >
                          <span className={`w-2.5 h-2.5 rounded-full ${tab.dot}`} />
                          <span className={`flex-1 text-sm font-black ${leftPanelTab === tab.id ? tab.color : 'text-gray-700'}`}>
                            {tab.label}
                          </span>
                          {leftPanelTab === tab.id && <CheckCircle2 size={16} className="text-indigo-600" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50">
              {displayedOrders.length > 0 ? (
                displayedOrders.map(subOrder => {
                  const order = subOrder.originalOrder;
                  return (
                  <motion.div
                    layout
                    key={subOrder.id}
                    onClick={() => {
                        const targetId = order.parentBookingId || order.id;
                        setSelectedOrderId(targetId);
                        setSelectedSubOrderId(subOrder.id);
                    }}
                    onContextMenu={(e: React.MouseEvent) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, orderId: order.id });
                    }}
                    onTouchStart={(e) => {
                      const touch = e.touches[0];
                      longPressTimer.current = setTimeout(() => {
                        if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
                            window.navigator.vibrate(50);
                        }
                        setContextMenu({ x: touch.clientX, y: touch.clientY, orderId: order.id });
                      }, 500);
                    }}
                    onTouchMove={() => {
                      if (longPressTimer.current) clearTimeout(longPressTimer.current);
                    }}
                    onTouchEnd={() => {
                      if (longPressTimer.current) clearTimeout(longPressTimer.current);
                    }}
                    style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                    className={`bg-white p-5 rounded-3xl border-2 cursor-pointer transition-all active:scale-[0.98] relative ${(selectedSubOrderId === subOrder.id) ? 'border-indigo-600 shadow-2xl shadow-indigo-100 ring-4 ring-indigo-50/50' : 'border-transparent shadow-sm hover:border-indigo-100 hover:shadow-lg'}`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg tracking-wider">
                          #{subOrder.services.length < order.services.length ? `${(order.billCode || '').split('-')[0]}-${subOrder.subSuffix || 'A'}` : (order.billCode || '').split('-')[0]}
                        </span>
                        {order.hasVat && <span className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100" title="Khách yêu cầu xuất hoá đơn VAT">VAT</span>}
                        {(() => {
                          const isVipMenu = subOrder.services.some((svc: any) => 
                            (svc.serviceId && (String(svc.serviceId).toUpperCase().startsWith('NHP') || String(svc.serviceId).toUpperCase().startsWith('VIP_'))) ||
                            (svc.serviceName && String(svc.serviceName).toUpperCase().includes('VIP'))
                          );
                          const isTreatment = subOrder.services.some((svc: any) => 
                            (svc.serviceId && String(svc.serviceId).toUpperCase().startsWith('NHT')) ||
                            (svc.serviceName && String(svc.serviceName).toUpperCase().includes('ĐIỀU TRỊ'))
                          );
                          return (
                            <>
                              {isVipMenu && (
                                <span className="shrink-0 px-1.5 py-1 rounded-md bg-gradient-to-b from-[#ffe866] to-[#ffc800] text-[#6b3e00] border border-[#e6b400] shadow-sm flex items-center justify-center" title="Menu VIP">
                                  <Crown size={12} className="fill-[#6b3e00]/20" />
                                </span>
                              )}
                              {isTreatment && (
                                <span className="shrink-0 px-1.5 py-1 rounded-md bg-blue-100 text-blue-700 border border-blue-200 shadow-sm flex items-center justify-center" title="Menu Điều Trị">
                                  <Stethoscope size={12} />
                                </span>
                              )}
                              {!isVipMenu && !isTreatment && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-50 text-slate-500 border border-slate-200 uppercase" title="Menu Thường">
                                  THƯỜNG
                                </span>
                              )}
                            </>
                          );
                        })()}
                        {order.isReturning && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-50 text-purple-600 border border-purple-100 uppercase" title={`Đã đến ${order.visitCount} lần`}>
                            Khách cũ
                          </span>
                        )}
                        {!order.isReturning && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase">
                            Khách mới
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1.5"><Clock size={12} className="text-gray-300" /> {getEstimatedEndTime(order, subOrder.services) || order.time}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="font-black text-gray-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight truncate">{getDisplayCustomerName(subOrder)}</p>
                      </div>
                        <div className="shrink-0 text-[11px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-xl flex items-center gap-1 border border-emerald-100/50 relative overflow-hidden group/pay cursor-pointer hover:bg-emerald-100 transition-colors">
                            <select
                                value={order.paymentMethod || 'Unpaid'}
                                onClick={e => e.stopPropagation()}
                                onChange={async (e) => {
                                    if (!selectedSubOrder) return;
                                    const newPm = e.target.value;
                                    updateOrder(selectedSubOrder.bookingId, o => ({ ...o, paymentMethod: newPm }));
                                    await updateBookingMeta(selectedSubOrder.bookingId, { paymentMethod: newPm });
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                            >
                                <option value="Cash">Tiền mặt</option>
                                <option value="Transfer">Chuyển khoản</option>
                                <option value="Card">Quẹt thẻ</option>
                                <option value="Unpaid">Chưa TT</option>
                            </select>
                            {(() => {
                              const isAllSequential = subOrder.services.length > 0 && subOrder.services.every(s => (s as any)._isSequentialFollowUp);
                              if (isAllSequential) {
                                return <span className="text-[10px] text-gray-500 italic">Đã tính trước</span>;
                              }
                              const sum = subOrder.services.reduce((acc, svc) => acc + ((svc.price || 0) * (svc.quantity || 1)), 0);
                              return <span title={sum.toLocaleString('vi-VN') + 'đ'}>{formatCompactPrice(sum)}</span>;
                            })()}
                          <span className="opacity-30">·</span>
                          <span>{order.paymentMethod === 'Cash' || order.paymentMethod === 'cash_vnd' ? 'cash' : (order.paymentMethod === 'Transfer' ? 'ck' : order.paymentMethod)}</span>
                        </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-4">
                      <p className="text-[10px] text-gray-500 font-medium truncate flex-1 leading-tight">
                        {subOrder.services.length > 0 
                          ? (() => {
                              const parentServices = subOrder.services.filter(s => {
                                const opts = typeof s.options === 'string' ? JSON.parse(s.options) : (s.options || {});
                                return !opts.mergedIntoId;
                              });
                              const displayServices = parentServices.length > 0 ? parentServices : subOrder.services;
                              return `${displayServices.map(s => {
                                const opts = typeof s.options === 'string' ? JSON.parse(s.options) : (s.options || {});
                                if (s.staffList && s.staffList.length > 0) {
                                    const customNames = s.staffList.map((st: any) => opts.serviceNamesForKtvs?.[st.ktvId] || st.serviceNameForKtv).filter(Boolean);
                                    if (customNames.length > 0) {
                                        return Array.from(new Set(customNames)).join(' + ');
                                    }
                                }
                                return opts.displayName || s.serviceName || 'Dịch vụ';
                              }).join(', ')} · ${displayServices.reduce((acc, s) => {
                                const opts = typeof s.options === 'string' ? JSON.parse(s.options) : (s.options || {});
                                const childIds: string[] = opts.mergedServiceIds || s.mergedServiceIds || [];
                                const childDur = childIds.reduce((sum: number, cId: string) => {
                                  const child = subOrder.services.find(cs => cs.id === cId);
                                  return sum + (child && !isUtilityService(child) ? (child.duration || 0) : 0);
                                }, 0);
                                return acc + (!isUtilityService(s) ? (s.duration || 0) : 0) + childDur;
                              }, 0)}p`;
                            })()
                          : 'Chưa có dịch vụ'
                        }
                      </p>
                      {(selectedSubOrderId === subOrder.id) && <span className="shrink-0 text-[10px] font-black text-indigo-600 uppercase tracking-tighter">Đang chọn →</span>}
                    </div>
                  </motion.div>
                )})
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60 py-10">
                  <Package className="mb-3 opacity-20" size={40} />
                  <p className="text-xs font-black uppercase tracking-widest italic">Trống</p>
                </div>
              )}
            </div>
          </div>

          {/* CENTER: Assignment Panel */}
          <div className={`${selectedOrderId ? 'flex' : 'hidden md:flex'} flex-1 flex flex-col border border-gray-200 bg-white rounded-3xl overflow-hidden shadow-sm min-w-0 min-h-0 transition-all`}>
            <div className="p-4 lg:p-5 border-b border-gray-100 bg-white shrink-0 flex items-start sm:items-center gap-3">
              {selectedOrderId && (
                <button 
                  onClick={() => { setSelectedOrderId(null); setSelectedSubOrderId(null); }}
                  className="md:hidden p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-400 mt-1 sm:mt-0"
                >
                  <ChevronLeft size={24} />
                </button>
              )}
              {selectedSubOrder ? (
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse shrink-0" />
                      <h2 className="font-black text-gray-900 text-base flex-1 flex flex-wrap items-center gap-2">
                        Đơn {(selectedSubOrder.originalOrder.billCode || '').split('-')[0]} — {getDisplayCustomerName(selectedSubOrder)}
                        <span className="text-gray-400 font-normal text-sm block sm:inline">
                          — {[selectedSubOrder.originalOrder.phone, selectedSubOrder.originalOrder.email].filter(Boolean).join(' — ') || '....'}
                        </span>
                        {(() => {
                          const isVipMenu = selectedSubOrder.services.some((svc: any) => 
                            (svc.serviceId && (String(svc.serviceId).toUpperCase().startsWith('NHP') || String(svc.serviceId).toUpperCase().startsWith('VIP_'))) ||
                            (svc.serviceName && String(svc.serviceName).toUpperCase().includes('VIP'))
                          );
                          const isTreatment = selectedSubOrder.services.some((svc: any) => 
                            (svc.serviceId && String(svc.serviceId).toUpperCase().startsWith('NHT')) ||
                            (svc.serviceName && String(svc.serviceName).toUpperCase().includes('ĐIỀU TRỊ'))
                          );
                          return (
                            <>
                              {isVipMenu && (
                                <span className="shrink-0 px-1.5 py-1 rounded-md bg-gradient-to-b from-[#ffe866] to-[#ffc800] text-[#6b3e00] border border-[#e6b400] shadow-sm flex items-center justify-center" title="Menu VIP">
                                  <Crown size={12} className="fill-[#6b3e00]/20" />
                                </span>
                              )}
                              {isTreatment && (
                                <span className="shrink-0 px-1.5 py-1 rounded-md bg-blue-100 text-blue-700 border border-blue-200 shadow-sm flex items-center justify-center" title="Menu Điều Trị">
                                  <Stethoscope size={12} />
                                </span>
                              )}
                            </>
                          );
                      })()}
                    </h2>
                    {selectedSubOrder.originalOrder.isWebBooking ? (
                      <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-black bg-amber-50 text-amber-600 border border-amber-100 uppercase ml-2" title="Đơn từ Web Booking">
                        BOOKING {selectedSubOrder.originalOrder.timeBooking ? selectedSubOrder.originalOrder.timeBooking : ''}
                      </span>
                    ) : (
                      <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-black bg-slate-50 text-slate-500 border border-slate-200 uppercase ml-2" title="Đơn khách vãng lai">
                        WALK IN {selectedSubOrder.originalOrder.timeBooking ? selectedSubOrder.originalOrder.timeBooking : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2 sm:ml-4">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Đang điều phối</p>


                    {/* NEW INPUTS ON THE SAME ROW */}
                    {(() => {
                        let autoGuestCount = 1;
                        if (selectedSubOrder.originalOrder.parentBookingId) {
                            // SubBookings always represent exactly 1 guest
                            autoGuestCount = 1;
                        } else {
                            let guestCount = 0;
                            const uniqueCustomerGroups = new Set<string>();
                            const uniqueGuestIds = new Set<string>();
                            
                            (selectedSubOrder.originalOrder.services || []).forEach((svc: any) => {
                                 const name = String(svc.serviceName || '').toLowerCase();
                                 const isUtility = isUtilityService(svc);
                                 const isChild = !!(svc.options?.mergedIntoId || svc.mergedIntoId);
                                 
                                 if (!isUtility && !isChild) {
                                     if (svc.guestId) {
                                         uniqueGuestIds.add(svc.guestId);
                                     } else if (svc.customerGroupId) {
                                         uniqueCustomerGroups.add(svc.customerGroupId);
                                     } else {
                                         guestCount++;
                                     }
                                 }
                            });
                            autoGuestCount = Math.max(1, guestCount + uniqueCustomerGroups.size + uniqueGuestIds.size);
                        }

                        const currentNationality = editingGuestInfo ? editingGuestInfo.nationality : (selectedSubOrder.originalOrder.nationality || '');
                        const currentGuestCount = autoGuestCount; // Tự động tính, không cho sửa tay
                        const currentGender = editingGuestInfo ? editingGuestInfo.customerGender : (selectedSubOrder.originalOrder.customerGender || 'male');
                          const currentPaymentMethod = editingGuestInfo ? editingGuestInfo.paymentMethod : (selectedSubOrder.originalOrder.paymentMethod || 'Cash');
                        const isDirty = editingGuestInfo !== null && (currentNationality !== (selectedSubOrder.originalOrder.nationality || '') || currentGender !== (selectedSubOrder.originalOrder.customerGender || 'male') || currentPaymentMethod !== (selectedSubOrder.originalOrder.paymentMethod || 'Cash'));
                        
                        return (
                              <div className="flex flex-wrap items-center gap-2 sm:ml-4 sm:border-l border-gray-200 sm:pl-4 mt-2 sm:mt-0 w-full sm:w-auto">
                                {editingGuestInfo ? (
                                  <>
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Giới tính</span>
                                    <select
                                      value={currentGender}
                                      onChange={(e) => setEditingGuestInfo({ nationality: currentNationality, guestCount: currentGuestCount, customerGender: e.target.value, paymentMethod: currentPaymentMethod })}
                                      className="w-20 bg-white px-2 py-1 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                    >
                                      <option value="male">Nam</option>
                                      <option value="female">Nữ</option>
                                    </select>
                                    <div className="w-px h-4 bg-gray-200 mx-2" />
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Quốc tịch</span>
                                    <select
                                      value={currentNationality}
                                      onChange={(e) => setEditingGuestInfo({ nationality: e.target.value, guestCount: currentGuestCount, customerGender: currentGender, paymentMethod: currentPaymentMethod })}
                                      className="w-32 bg-white px-2 py-1 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                    >
                                      <option value="">Chọn...</option>
                                      <option value="Việt Nam">Việt Nam</option>
                                      <option value="Hàn Quốc">Hàn Quốc</option>
                                      <option value="Nhật Bản">Nhật Bản</option>
                                      <option value="Trung Quốc">Trung Quốc</option>
                                      <option value="Đài Loan">Đài Loan</option>
                                      <option value="Anh/Úc/Mỹ">Anh/Úc/Mỹ</option>
                                      <option value="Khác">Khác</option>
                                    </select>
                                    <div className="w-px h-4 bg-gray-200 mx-2" />
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Số lượng</span>
                                    <div className="px-3 py-1 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-black text-indigo-700 select-none">
                                        {currentGuestCount} KHÁCH
                                    </div>
                                    <button
                                      onClick={async () => {
                                          if (!selectedSubOrder) return;
                                          try {
                                              const res = await updateBookingMeta(selectedSubOrder.bookingId, {
                                                  nationality: currentNationality,
                                                  guestCount: currentGuestCount,
                                                  customerGender: currentGender,
                                                  paymentMethod: currentPaymentMethod
                                              });
                                              if (!res.success) throw new Error(res.error || 'Lỗi không xác định');
                                              
                                              updateOrder(selectedSubOrder.bookingId, o => ({ ...o, nationality: currentNationality, guestCount: currentGuestCount, customerGender: currentGender, paymentMethod: currentPaymentMethod }));
                                              setEditingGuestInfo(null);
                                              
                                              alert('Đã lưu thông tin khách hàng thành công!');
                                          } catch(e) {
                                              alert('Lỗi khi lưu!');
                                              console.error(e);
                                          }
                                      }}
                                      className="ml-2 px-3 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center gap-1"
                                    >
                                      <Save size={12} /> Lưu
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Giới tính:</span>
                                    <span className="text-xs font-bold text-gray-700">{currentGender === 'male' ? 'Nam' : 'Nữ'}</span>
                                    <div className="w-px h-4 bg-gray-200 mx-2" />
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Quốc tịch:</span>
                                    <span className="text-xs font-bold text-gray-700">{currentNationality || 'Chưa chọn'}</span>
                                    <div className="w-px h-4 bg-gray-200 mx-2" />
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Số lượng</span>
                                    <div className="px-3 py-1 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-black text-indigo-700 select-none">
                                        {currentGuestCount} KHÁCH
                                    </div>
                                    <button
                                      onClick={() => setEditingGuestInfo({ nationality: currentNationality, guestCount: currentGuestCount, customerGender: currentGender, paymentMethod: currentPaymentMethod })}
                                      className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-indigo-600 transition-colors ml-2"
                                      title="Chỉnh sửa thông tin chung"
                                    >
                                      <PenLine size={14} />
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={async () => {
                                    setIsFetchingCustomer(true);
                                    try {
                                      const data = (await apiClient.get(API.CUSTOMERS)) as any;
                                      const orderToUse = selectedOrder || selectedSubOrder?.originalOrder;
                                      
                                      let found = null;
                                      if (orderToUse?.customerId) {
                                          found = data.data?.find((c: any) => c.id === orderToUse.customerId);
                                      }
                                      if (!found && orderToUse?.phone) {
                                          found = data.data?.find((c: any) => c.phone === orderToUse.phone);
                                      }
                                      
                                      if (found) {
                                        setFullCustomerData(found);
                                        setShowCustomerInfo(true);
                                      } else {
                                        alert('Khách vãng lai chưa cung cấp thông tin liên lạc thật (SĐT/Email) nên không có hồ sơ chi tiết.');
                                      }
                                    } catch (e) {
                                      console.error('Lỗi tải dữ liệu khách:', e);
                                      alert('Lỗi tải dữ liệu khách hàng');
                                    } finally {
                                      setIsFetchingCustomer(false);
                                    }
                                  }}
                                  disabled={isFetchingCustomer}
                                  className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors disabled:opacity-50 ml-1"
                                  title="Xem thông tin khách hàng"
                                >
                                  {isFetchingCustomer ? (
                                    <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <Info size={14} />
                                  )}
                                </button>
                              </div>
                          );
                      })()}
                  </div>
                  
                  {/* Cảnh báo Phát sinh chưa thu */}
                  {selectedSubOrder.services.some(s => s.options?.isAddon && !s.options?.isPaid) && (
                    <div className="mt-2 ml-4 px-3 py-1.5 bg-rose-50 border border-rose-100 rounded-lg inline-flex items-center gap-2">
                        <ShieldAlert size={14} className="text-rose-500" />
                        <span className="text-rose-600 font-black text-xs uppercase tracking-wider">
                            Phát sinh chưa thu: Có dịch vụ mua thêm
                        </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 text-gray-400">
                  <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center">
                    <Send size={20} className="opacity-50" />
                  </div>
                  <p className="text-sm font-black uppercase tracking-widest italic">Chọn đơn hàng để tiếp tục</p>
                </div>
              )}
            </div>

            {selectedSubOrder ? (
              <div id="dispatch-container" className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 bg-slate-50/30">
                  {selectedSubOrder.originalOrder?.parentBookingId && (
                    <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-indigo-800">Đơn đã được tách</p>
                        <p className="text-[10px] text-indigo-600">Thuộc nhóm gốc: #{selectedSubOrder.originalOrder.billCode?.split('-')[0]}</p>
                      </div>
                      <button onClick={() => setInvoiceLangModal({ invoiceId: selectedSubOrder.originalOrder.parentBookingId as string })} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow hover:bg-indigo-700">Xem Hóa Đơn Nhóm</button>
                    </div>
                  )}
                  <QuickDispatchTable
                    services={selectedSubOrder.services}
                    orderId={selectedSubOrder.bookingId}
                    rooms={rooms}
                    beds={beds}
                    availableTurns={turns}
                    busyBedIds={orders
                      .filter(o => o.id !== selectedSubOrder.bookingId && (o.dispatchStatus === 'IN_PROGRESS' || o.dispatchStatus === 'PREPARING'))
                      .flatMap(o => o.services.flatMap(s => s.staffList.flatMap(r => r.segments.map(seg => seg.bedId))))
                      .filter(Boolean) as string[]
                    }
                    onTriggerMergePrompt={(sourceSvcId, targetSvcId, ktvId, onConfirm, onCancel) => {
                       setMergePromptConfig({
                          orderId: selectedSubOrder.bookingId,
                          sourceSvcId,
                          targetSvcId,
                          rowId: '', // Quick mode doesn't rely on rowId for the merge
                          ktvId,
                          onConfirm,
                          onCancel
                       });
                    }}
                    onUpdateServices={(updatedServices) => {
                      updateOrder(selectedSubOrder.bookingId, o => {
                          let mergedServices = o.services.map(origSvc => {
                              const found = updatedServices.find(u => u.id === origSvc.id);
                              if (found) {
                                  // Bảo tồn các KTV thuộc phạm vi của thẻ khác (không nằm trong thẻ đang edit)
                                  const originalSubset = selectedSubOrder.services.find(sub => sub.id === origSvc.id);
                                  let finalStaffList = found.staffList;
                                  if (originalSubset) {
                                      const managedIds = new Set(originalSubset.staffList.map(st => st.id));
                                      const unmanagedStaffs = origSvc.staffList.filter(st => !managedIds.has(st.id));
                                      finalStaffList = [...unmanagedStaffs, ...found.staffList];
                                  }
                                  return { ...found, staffList: finalStaffList };
                              }
                              return origSvc;
                          });
                          
                          // Thêm các dịch vụ mới (ví dụ khi tách KTV)
                          const newServices = updatedServices.filter(u => !o.services.some(orig => orig.id === u.id));
                          mergedServices = [...mergedServices, ...newServices];
                          
                          // Now, sync any target services to match their source service
                          mergedServices = mergedServices.map(svc => {
                             if (svc.mergedIntoId) {
                                const sourceSvc = mergedServices.find(s => s.id === svc.mergedIntoId);
                                if (sourceSvc) {
                                   return {
                                      ...svc,
                                      staffList: svc.staffList.map((r, i) => {
                                         const sourceRow = sourceSvc.staffList[i] || sourceSvc.staffList[0];
                                         if (!sourceRow) return r;
                                         return {
                                            ...r,
                                            ktvId: sourceRow.ktvId,
                                            ktvName: sourceRow.ktvName,
                                            segments: r.segments.map((cSeg, cIdx) => {
                                               const pSeg = sourceRow.segments[cIdx] || sourceRow.segments[0];
                                               return { ...cSeg, roomId: pSeg?.roomId || null, bedId: pSeg?.bedId || null };
                                            })
                                         };
                                      })
                                   };
                                }
                             }
                             return svc;
                          });

                          return recalculateAllTimes({ ...o, services: mergedServices }, roomTransitionTime);
                      });
                    }}
                    onDispatchGroup={(group, specificSvcId) => {
                      const svcIds = specificSvcId 
                        ? [specificSvcId] 
                        : group.items.flatMap(i => [i.id, ...(i.mergedServiceIds || [])]);
                      handleDispatch(false, svcIds);
                    }}
                    onPrintGroup={(group) => {
                      // TODO: QuickPrintTicket integration
                      alert(`🖨️ In phiếu: ${group.displayName || group.serviceName} x${group.items.length}\nKTV: ${group.selectedKtvIds.join(', ')}\n${(group.ktvStartTimes || [])[0] || '--:--'} → ${(group.ktvEndTimes || [])[0] || '--:--'}`);
                    }}
                    reminders={reminders}
                    billCode={(selectedSubOrder.originalOrder.billCode || '').split('-')[0]}
                    customerName={getDisplayCustomerName(selectedSubOrder)}
                    subOrderCodeProp={(selectedSubOrder as any).subSuffix || undefined}
                    onRemoveSvc={removeServiceBlock}
                  />


                <button
                  onClick={() => setShowAddSvcModal(true)}
                  className="w-full py-4 border-2 border-dashed border-gray-200 rounded-3xl text-sm font-black text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-white transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
                >
                  <Plus size={18} strokeWidth={3} /> THÊM DỊCH VỤ KHÁC
                </button>

                <div className="pt-4 sticky bottom-0 bg-gradient-to-t from-white via-white/90 to-transparent pb-2 mt-auto flex gap-3">
                  {(() => {
                      const targetUndoId = selectedSubOrder?.originalOrder?.parentBookingId || (selectedSubOrder?.originalOrder?.rawStatus === 'SPLIT' ? selectedSubOrder.originalOrder.id : null);
                      if (!targetUndoId) return null;
                      
                      const siblingsUndo = orders.filter((o: any) => o.parentBookingId === targetUndoId);
                      const isUndoDisabled = siblingsUndo.some((o: any) => o.rawStatus !== 'NEW' && o.rawStatus !== 'CANCELLED');
                      
                      return (
                          <button
                            onClick={handleUndoSplit}
                            disabled={isUndoDisabled}
                            title={isUndoDisabled ? 'Không thể hủy vì có đơn con đang thực hiện' : ''}
                            className={`flex-1 py-5 rounded-3xl font-black text-sm tracking-widest uppercase transition-all flex items-center justify-center gap-2 shadow-lg border-2 ${isUndoDisabled ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed opacity-70' : 'bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 border-red-200 active:scale-95'}`}
                          >
                            <RotateCcw size={20} strokeWidth={3} /> HỦY GỘP/TÁCH
                          </button>
                      );
                  })()}
                  <button
                    onClick={() => {
                        const hasKtvAssigned = selectedSubOrder?.services?.some((s: any) => s.staffList?.length > 0);
                        const isDispatched = selectedSubOrder?.dispatchStatus !== 'pending';
                        
                        // Removed native confirm for hasKtvAssigned because SplitPreviewModal will handle it
                        
                        if (isDispatched) {
                            if (window.confirm('LƯU Ý: Nút này sẽ lưu thông tin các thay đổi về Phòng, Ghi chú, và Tách/Gộp dịch vụ.\nNếu bạn vừa THAY ĐỔI KTV, vui lòng bấm nút [CẬP NHẬT KTV & GỬI LẠI] màu xanh đậm bên cạnh để KTV mới nhận được đơn!\n\nBạn có muốn tiếp tục lưu thông tin không?')) {
                                handleSaveDraft();
                            }
                            return;
                        }

                        handleSaveDraft();
                    }}
                    className="flex-1 py-5 rounded-3xl font-black text-sm tracking-widest uppercase transition-all flex items-center justify-center gap-2 shadow-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 border-2 border-emerald-200 active:scale-95"
                  >
                    <Save size={20} strokeWidth={3} /> {selectedSubOrder?.dispatchStatus !== 'pending' ? 'LƯU THÔNG TIN' : 'LƯU NHÁP'}
                  </button>
                  {(() => {
                    const isFeedbackOrDone = ['FEEDBACK', 'DONE', 'CLEANING'].includes(selectedSubOrder.dispatchStatus);
                    
                    if (isFeedbackOrDone) {
                      return (
                        <div className="flex gap-2 w-full col-span-2">
                           <button
                             onClick={() => setCommentModalData({ subOrder: selectedSubOrder as any, order: selectedSubOrder.originalOrder })}
                             className="flex-1 py-3 rounded-2xl font-black text-amber-700 bg-amber-100 border border-amber-300 hover:bg-red-100 hover:text-red-700 hover:border-red-300 transition-all uppercase text-sm flex items-center justify-center gap-2 shadow-sm"
                           >
                              <AlertTriangle size={18} strokeWidth={3} /> Nhận xét KTV
                           </button>
                           {selectedSubOrder.dispatchStatus !== 'DONE' && (
                             <button
                               onClick={async () => {
                                 const itemIds = selectedSubOrder.services.map((s:any) => s.id);
                                 try {
                                   await handleUpdateStatus(selectedSubOrder.originalOrder.id, 'DONE', itemIds, true);
                                 } catch(e) {}
                               }}
                               className="flex-1 py-3 rounded-2xl font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-all uppercase text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
                             >
                                <CheckCircle2 size={18} strokeWidth={3} /> Hoàn tất
                             </button>
                           )}
                        </div>
                      );
                    }

                    const hasStartedService = selectedSubOrder.services.some(
                      (s: any) => s.status && ['IN_PROGRESS', 'CLEANING', 'FEEDBACK', 'DONE', 'COMPLETED'].includes(s.status)
                    );
                    // Đơn đã điều phối vẫn phải đổi/gỡ KTV được: processDispatch đã chặn lùi trạng thái và giữ mốc giờ thực tế
                    const isRedispatch = selectedSubOrder.dispatchStatus !== 'pending';
                    const isBlockedByStartedService = hasStartedService && !isRedispatch;
                    // Check readiness only for the services in the current sub-order, not the entire parent
                    const subOrderAsOrder = { ...selectedSubOrder.originalOrder, services: selectedSubOrder.services };
                    const ready = isDispatchReady(subOrderAsOrder) && !isBlockedByStartedService;
                    
                    return (
                      <button
                        onClick={() => {
                          // TỰ ĐỘNG NỘI SUY SỐ KHÁCH THEO ĐƠN CON
                          const validSubBookings = subOrders.filter(so => so.bookingId === selectedSubOrder.originalOrder.id && so.ktvSignature !== 'utility');
                          const finalGuestCount = Math.max(1, validSubBookings.length);
                          updateOrder(selectedSubOrder.originalOrder.id, (o: any) => ({ ...o, guestCount: finalGuestCount }));
                          
                          if (selectedSubOrder?.dispatchStatus !== 'pending') {
                            handleDispatch(false, selectedSubOrder?.services.map((s:any) => s.id), selectedSubOrder?.originalOrder.id);
                          } else {
                            setShowDispatchConfirmModal(true);
                          }
                        }}
                        disabled={!ready}
                        title={isBlockedByStartedService ? "Đã có dịch vụ bắt đầu, vui lòng tách đơn rồi gửi cho từng khách!" : ""}
                        className={`flex-[2] flex-col py-3 rounded-3xl font-black text-sm lg:text-base tracking-widest uppercase transition-all flex items-center justify-center gap-1 shadow-2xl ${ready
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 active:scale-95'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                          }`}
                      >
                        <div className="flex items-center gap-3">
                           <Send size={20} strokeWidth={3} /> {selectedSubOrder?.dispatchStatus !== 'pending' ? 'CẬP NHẬT KTV & GỬI LẠI' : 'GỬI ĐƠN CHO KTV'}
                        </div>
                        {isBlockedByStartedService && (
                          <span className="text-[10px] text-rose-500 font-bold normal-case tracking-normal">(Đã có DV đang chạy — hãy tách đơn rồi gửi từng khách)</span>
                        )}
                      </button>
                    )
                  })()}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
                <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-6 border border-gray-100 shadow-inner">
                  <Send size={40} className="text-gray-200" />
                </div>
                <h3 className="text-lg font-black text-gray-300 uppercase tracking-[0.2em]">Trình Điều Phối</h3>
                <p className="text-sm text-gray-400 mt-2 font-medium max-w-[200px]">Vui lòng chọn một đơn hàng từ danh sách bên trái để bắt đầu sắp xếp KTV và Phòng</p>
              </div>
            )}
          </div>
            </>
          ) : activeMode === 'MONITOR' ? (
            <KanbanBoard 
              orders={orders} 
              staffs={staffs}
              staffWorkTypeMap={Object.fromEntries(turns.filter(t => t.staff?.work_type).map(t => [t.employee_id, t.staff!.work_type!]))}

              onUpdateCustomerName={async (orderId, itemIds, ktvIds, newName) => {
                try {
                  const { updateSubOrderCustomerName } = await import('./actions');
                  const res = await updateSubOrderCustomerName(itemIds, ktvIds, newName);
                  if (res.success) {
                    alert('Đã cập nhật tên khách hàng hiển thị thành công');
                    fetchData();
                  } else {
                    alert('Lỗi: ' + (res.error || 'Không thể cập nhật tên'));
                  }
                } catch (err: any) {
                  alert('Lỗi: Có lỗi xảy ra');
                }
              }}
              onUpdateStatus={handleUpdateStatus} 
              onOpenDetail={(orderId, subOrderId, status) => {
                setLeftPanelTab((status || 'pending') as DispatchStatus);
                setSelectedOrderId(orderId);
                const firstSubOrder = subOrders.find(so => so.bookingId === orderId);
                setSelectedSubOrderId(firstSubOrder ? firstSubOrder.id : (subOrderId || null));
                setActiveMode('DISPATCH');
              }}
              onConfirmAddonPayment={handleConfirmAddonPayment}
              selectedOrderId={selectedOrderId}
              onSelectOrder={(orderId) => {
                  setSelectedOrderId(orderId);
                  const firstSubOrder = subOrders.find(so => so.bookingId === orderId);
                  if (firstSubOrder) setSelectedSubOrderId(firstSubOrder.id);
              }}
              onContextMenu={(e: any, orderId: string, itemId?: string, guestId?: string) => {
                let x = 0, y = 0;
                if (e.type && e.type.startsWith('touch')) {
                  const touch = e.touches[0];
                  x = touch.clientX;
                  y = touch.clientY;
                } else {
                  x = e.clientX;
                  y = e.clientY;
                }
                setContextMenu({ x, y, orderId, itemId, guestId });
              }}
              onPauseClick={(orderId, subOrder) => {
                const o = orders.find(x => x.id === orderId);
                if (o) {
                  setPauseModalOrder(o);
                  if (subOrder) setPauseModalSubOrder(subOrder);
                  // Đơn đang tạm dừng thì chỉ nút "Đổi" mới mở modal này
                  // (nút "Tiếp" đã chạy thẳng) → vào luôn phần đổi KTV.
                  const paused = (subOrder?.services || []).some((s: any) => s.status === 'PAUSED');
                  setPauseModalLockAction(paused ? 'SWAP' : undefined);
                  setPauseModalOpen(true);
                  setContextMenu(null);
                }
              }}
              onCancelClick={(orderId, subOrder) => handleCancelBookingItem(orderId, subOrder?.services?.[0]?.id, subOrder)}
              onPauseNow={async (orderId, subOrder) => {
                const svc = (subOrder?.services || []).find((s: any) => s.status === 'IN_PROGRESS');
                if (!svc) {
                  alert('Không tìm thấy dịch vụ đang làm để tạm dừng.');
                  return;
                }
                try {
                  // pauseItem tự dừng luôn các dịch vụ gộp chung KTV, chỉ cần 1 item.
                  await handleConfirmPauseSwap(svc.id, 'PAUSE');
                } catch (err: any) {
                  alert('Lỗi tạm dừng: ' + (err?.message || 'Không rõ nguyên nhân'));
                }
              }}
              onResumeClick={async (orderId, subOrder) => {
                const pausedSvc = (subOrder?.services || []).find((s: any) => s.status === 'PAUSED');
                if (!pausedSvc) {
                  alert('Không tìm thấy dịch vụ đang tạm dừng để tiếp tục.');
                  return;
                }
                try {
                  // resumeItem tự xử lý các dịch vụ gộp chung KTV, chỉ cần truyền 1 item.
                  await handleConfirmPauseSwap(pausedSvc.id, 'RESUME');
                } catch (err: any) {
                  alert('Lỗi tiếp tục đơn: ' + (err?.message || 'Không rõ nguyên nhân'));
                }
              }}
              onFinishEarlyPaused={async (orderId, subOrder) => {
                try {
                  // Chốt chặn bấm nhầm: Kết thúc thì KTV CÓ tiền có giờ, mà nếu họ
                  // chưa hề bấm báo thì nhiều khả năng đây là ca bỏ khách → phải Huỷ.
                  const { kiemTraTruocKhiChot } = await import('./actions');
                  const chk = await kiemTraTruocKhiChot(orderId, 'FINISH_EARLY');
                  if (chk.canhBao && !window.confirm(`⚠️ ${chk.canhBao}

Vẫn kết thúc sớm?`)) return;
                  const res = await fetch('/api/ktv/finish-early-paused', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      bookingId: orderId,
                      itemIds: subOrder.services.map((s: any) => s.id)
                    })
                  });
                  if (res.ok) {
                    fetchData();
                  } else {
                    const err = await res.json();
                    alert('Lỗi kết thúc đơn: ' + (err.error || 'Unknown error'));
                  }
                } catch (err: any) {
                  alert('Lỗi kết thúc đơn: ' + err.message);
                }
              }}
              onReviewClick={(service) => setReviewModalService(service)}
            />
          ) : activeMode === 'TURN_QUEUE' ? (
            <div className="flex-1 overflow-auto w-full h-full flex flex-col md:flex-row gap-4">
              <div className="flex-[2] bg-white rounded-3xl border border-gray-200 shadow-sm p-4 min-h-[500px]">
                {(() => {
                  return <TurnQueueBoard staffs={staffs} allowEditTurns={true} />;
                })()}
              </div>
              <div className="flex-[1] bg-white rounded-3xl border border-gray-200 shadow-sm p-4 min-h-[500px]">
                <DispatchOnlineKtvTable staffs={staffs} />
              </div>
            </div>
          ) : activeMode === 'ROOMS' ? (
            <div className="flex-1 overflow-hidden bg-white rounded-3xl border border-gray-200 shadow-sm w-full h-full">
              <RoomBoard 
                rooms={rooms}
                beds={beds}
                occupancies={orders.flatMap(order => 
                  order.services.flatMap(svc => {
                    if (['COMPLETED', 'CANCELLED', 'FEEDBACK', 'DONE'].includes(svc.status || '')) return [];
                    if (['FEEDBACK', 'DONE'].includes(order.dispatchStatus)) return []; // Nếu tổng đơn đã ở FEEDBACK thì bỏ qua luôn

                    const formatEndTime = (t?: string | null) => {
                        if (!t) return undefined;
                        if (t.includes('T')) {
                            try {
                                const d = new Date(t);
                                if (!isNaN(d.getTime())) {
                                    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                                }
                            } catch (e) {}
                            return t.substring(11, 16);
                        }
                        return t.substring(0, 5);
                    };
                    
                    const segmentsWithBed = svc.staffList?.flatMap(staff => 
                      (staff.segments || []).filter(seg => seg.bedId).map(seg => {
                        let computedEndTime = seg.actualEndTime;
                        if (!computedEndTime && seg.actualStartTime && seg.duration) {
                            computedEndTime = getDynamicEndTime(seg.actualStartTime, seg.duration);
                        } else if (!computedEndTime) {
                            computedEndTime = seg.endTime;
                        }

                        return {
                          bedId: seg.bedId as string,
                          roomId: seg.roomId as string,
                          ktvName: staff.ktvName || 'Chưa phân công',
                          endTime: formatEndTime(computedEndTime) || formatEndTime(svc.timeEnd),
                          status: svc.status || 'NEW',
                          serviceName: svc.serviceName
                        };
                      })
                    ) || [];

                    if (segmentsWithBed.length > 0) {
                      return segmentsWithBed;
                    }

                    if (svc.bedId) {
                      return [{
                        bedId: svc.bedId as string,
                        roomId: svc.selectedRoomId as string,
                        ktvName: svc.staffList?.[0]?.ktvName || 'Chưa phân công',
                        endTime: formatEndTime(svc.timeEnd),
                        status: svc.status || 'NEW',
                        serviceName: svc.serviceName
                      }];
                    }

                    return [];
                  })
                )}
              />
            </div>
          ) : activeMode === 'SCHEDULE' ? (
            <div className="flex-1 overflow-hidden bg-white rounded-3xl border border-gray-200 shadow-sm w-full h-full">
              <ScheduleBoard orders={orders} />
            </div>
          ) : activeMode === 'WEB_BOOKING' ? (
            <div className="flex-1 overflow-hidden bg-white rounded-3xl border border-gray-200 shadow-sm w-full h-full relative z-0">
              <WebBookingBoard />
            </div>
          ) : null}

        </div>
      </div>

      {/* Add Svc Modal */}
      <AddServiceModal
        open={showAddSvcModal || !!editingSvc}
        editing={editingSvc}
        services={allServices}
        order={selectedOrder}
        currentGuestId={(selectedSubOrder as any)?.guest?.id}
        selectedGuestId={selectedGuestForAddon}
        onSelectGuest={setSelectedGuestForAddon}
        onPick={(svcId, name, dur) => editingSvc ? handleEditService(svcId, name, dur) : addServiceBlock(svcId, name, dur)}
        onClose={() => { setShowAddSvcModal(false); setEditingSvc(null); setSelectedGuestForAddon(''); }}
      />

      {/* Dispatch Confirmation Modal */}
      <DispatchConfirmModal
        open={showDispatchConfirmModal}
        order={selectedOrder}
        subOrder={selectedSubOrder}
        rooms={rooms}
        beds={beds}
        onConfirm={(svcIds, orderId) => handleDispatch(false, svcIds, orderId)}
        onClose={() => setShowDispatchConfirmModal(false)}
      />
      {/* Context Menu for Cancellation */}
      <OrderContextMenu
        menu={contextMenu}
        orders={orders}
        subOrders={subOrders}
        onClose={() => setContextMenu(null)}
        actions={{
          updateStatus: handleUpdateStatus,
          cancelBooking: handleCancelBooking,
          cancelBookingItem: handleCancelBookingItem,
          dispatch: handleDispatch,
          showInvoice: setInvoiceLangModal,
          showQr: setQrModal,
          openTimeEditor: setTimeEditorModal,
          openPauseSwap: (order) => { setPauseModalOrder(order); setPauseModalOpen(true); },
        }}
      />

      {/* QR Journey Modal */}
      <QrJourneyModal data={qrModal} onClose={() => setQrModal(null)} />

      <AnimatePresence>
        {showCustomerInfo && fullCustomerData && (
          <CustomerDetailModal
            customer={fullCustomerData}
            formatVND={(n = 0) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n)}
            onClose={() => setShowCustomerInfo(false)}
            onUpdate={(updated) => {
              setFullCustomerData(updated);
            }}
          />
        )}
      </AnimatePresence>

      <AddOrderModal
        isOpen={showAddOrderModal}
        onClose={() => setShowAddOrderModal(false)}
        services={allServices}
        onConfirm={handleCreateQuickBooking}
        selectedDate={selectedDate}
      />

      <SplitDurationModal
        config={splitConfig}
        onChange={(patch) => setSplitConfig(prev => prev ? { ...prev, ...patch } : null)}
        onConfirm={confirmSplitService}
        onCancel={() => setSplitConfig(null)}
      />

      {/* Modal Xem Ảnh Xác Nhận / Ảnh Bàn Giao */}
      <PhotoViewerModal
        selectedPhoto={selectedPhoto}
        setSelectedPhoto={setSelectedPhoto}
        photoIndex={photoIndex}
        setPhotoIndex={setPhotoIndex}
      />

      {/* Modal Tạm Dừng / Đổi KTV */}
      <PauseSwapKtvModal
        isOpen={pauseModalOpen}
        onClose={() => { setPauseModalOpen(false); setPauseModalOrder(null); setPauseModalSubOrder(null); setPauseModalLockAction(undefined); }}
        order={pauseModalOrder}
        subOrder={pauseModalSubOrder}
        availableKtvs={staffs.filter(s => s.status === 'ready')}
        onConfirm={handleConfirmPauseSwap}
        lockAction={pauseModalLockAction}
      />

      <CancelItemModal
        isOpen={cancelItemModal !== null}
        onClose={() => setCancelItemModal(null)}
        onConfirm={submitCancelItems}
        ktvLabel={cancelItemModal?.ktvLabel}
        customerName={cancelItemModal?.customerName}
        workedMinutes={cancelItemModal?.workedMinutes ?? null}
        wholeBooking={cancelItemModal?.wholeBooking}
        canhBao={cancelItemModal?.canhBao}
      />

      <MergePromptModal
        config={mergePromptConfig}
        staffs={staffs}
        orders={orders}
        onConfirm={confirmMergeServices}
        onCancel={cancelMergeServices}
      />

      <ReviewHandoverModal
        isOpen={reviewModalService !== null}
        onClose={() => setReviewModalService(null)}
        service={reviewModalService}
        onApprove={handleApproveHandover}
        onReject={handleRejectHandover}
      />

      {/* Custom Confirm Modal (Fix INP Issue) */}
      <ConfirmActionModal
        open={confirmModal.isOpen}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
      {/* Custom Start Service Modal */}
      <StartServiceModal
        open={startServiceModal.isOpen}
        selectedDate={selectedDate}
        onConfirm={startServiceModal.onConfirm}
        onClose={() => setStartServiceModal(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Invoice Language Modal */}
      <InvoiceLanguageModal
        invoiceId={invoiceLangModal?.invoiceId ?? null}
        onClose={() => setInvoiceLangModal(null)}
      />

      {commentModalData && (
        <KtvCommentModal 
          subOrder={commentModalData.subOrder as any}
          order={commentModalData.order}
          onClose={() => setCommentModalData(null)}
          onSuccess={() => {
            setCommentModalData(null);
            fetchData();
          }}
        />
      )}

      {splitPreviewState && (
        <SplitPreviewModal
          isOpen={splitPreviewState.isOpen}
          order={splitPreviewState.order}
          allServices={allServices}
          splitPlan={splitPreviewState.splitPlan}
          onClose={() => setSplitPreviewState(null)}
          onSaveDraftOnly={() => {
            const intent = splitPreviewState.intent;
            const dispatchArgs = splitPreviewState.dispatchArgs;
            setSplitPreviewState(null);
            handleSaveDraft(true, intent, dispatchArgs);
          }}
          onSaveAndDispatch={() => {
            const dispatchArgs = splitPreviewState.dispatchArgs;
            setSplitPreviewState(null);
            handleSaveDraft(true, 'DISPATCH', dispatchArgs);
          }}
        />
      )}

      {timeEditorModal && (
        <TimeEditorModal
          isOpen={timeEditorModal.isOpen}
          orderId={timeEditorModal.orderId}
          itemId={timeEditorModal.itemId}
          onClose={() => setTimeEditorModal(null)}
          onSuccess={() => {
              fetchData();
          }}
        />
      )}
    </AppLayout>
  );
}



