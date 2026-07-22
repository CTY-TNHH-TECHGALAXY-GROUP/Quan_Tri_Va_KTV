'use client';
import { parseDbDate } from "@/lib/utils";

// 🔧 UI CONFIGURATION
const DEFAULT_DURATION = 60; // Phút mặc định cho mỗi KTV

import React, { useState, useRef, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import {
  ShieldAlert, Clock, CheckCircle2, Bell, BellOff,
  Plus, Calendar as CalendarIcon, Send, Phone,
  ChevronDown, ChevronLeft, Package, Volume2, VolumeX, Trash2, X, Sparkles, QrCode, LayoutList, Columns3, Save, Zap, AlertTriangle, Info,
  Users, BedDouble, CalendarClock
} from 'lucide-react';
import { TurnQueueBoard } from '@/components/shared/TurnQueueBoard/TurnQueueBoard';
import { RoomBoard } from '@/components/shared/RoomBoard';
import { ScheduleBoard } from '@/components/shared/ScheduleBoard';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { DispatchServiceBlock } from './_components/DispatchServiceBlock';
import { KanbanBoard } from './_components/KanbanBoard';
import { QuickDispatchTable } from './_components/QuickDispatchTable';
import { getDispatchData, processDispatch, cancelBooking, updateBookingStatus, createQuickBooking, addAddonServices, updateBookingMeta } from './actions';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { AddOrderModal } from './_components/AddOrderModal';
import PauseSwapKtvModal from './_components/PauseSwapKtvModal';
import { useDispatchBoard } from './useDispatchBoard.logic';
import { MergePromptModal } from '@/app/reception/dispatch/_components/MergePromptModal';
import { useNotifications } from '@/components/NotificationProvider';
import { CustomerDetailModal } from '../crm/_components/CustomerDetailModal';
import { Customer } from '@/lib/types';
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















// ─── MOCK DATA ────────────────────────────────────────────────────────────────

// MOCK DATA REMOVED - Using real data from Supabase

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const getCurrentTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatToHourMinute = (isoString?: string | null) => {
    if (!isoString) return '--:--';
    if (/^\d{1,2}:\d{2}$/.test(isoString)) return isoString;
    let parseString = isoString;
    if (!isoString.endsWith('Z') && !isoString.includes('+')) {
        parseString = isoString.replace(' ', 'T') + 'Z';
    }
    const d = new Date(parseString);
    if (isNaN(d.getTime())) return isoString;
    const dVn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return `${String(dVn.getUTCHours()).padStart(2, '0')}:${String(dVn.getUTCMinutes()).padStart(2, '0')}`;
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
    fetchData
  } = useDispatchBoard(selectedDate, selectedOrderId);

  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const { notifications, soundEnabled, setSoundEnabled, unlockAudio, playSound } = useNotifications();
  const [leftPanelTab, setLeftPanelTab] = useState<DispatchStatus>('pending');
  const [activeMode, setActiveMode] = useState<'DISPATCH' | 'MONITOR' | 'TURN_QUEUE' | 'ROOMS' | 'SCHEDULE'>('DISPATCH');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAddSvcModal, setShowAddSvcModal] = useState(false);
  const [editingSvc, setEditingSvc] = useState<{ orderId: string, svcId: string, oldSvcName: string } | null>(null);
  const [showDispatchConfirmModal, setShowDispatchConfirmModal] = useState(false);
  const [svcSearchQuery, setSvcSearchQuery] = useState('');
  const [editingGuestInfo, setEditingGuestInfo] = useState<{ nationality: string, guestCount: number, customerGender: string } | null>(null);
  const [showCustomerInfo, setShowCustomerInfo] = useState(false);
  const [fullCustomerData, setFullCustomerData] = useState<Customer | null>(null);
  const [isFetchingCustomer, setIsFetchingCustomer] = useState(false);

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
    isSaving: boolean;
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
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, orderId: string } | null>(null);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [pauseModalOrder, setPauseModalOrder] = useState<PendingOrder | null>(null);
  const [pauseModalSubOrder, setPauseModalSubOrder] = useState<any>(null);
  const [qrModal, setQrModal] = useState<{ orderId: string; billCode: string; accessToken?: string | null; customerLang?: string } | null>(null);
  const [expandedSvcIds, setExpandedSvcIds] = useState<string[]>([]);
  const [dispatchMode, setDispatchMode] = useState<'quick' | 'detail'>('quick');
  const [selectedPhoto, setSelectedPhoto] = useState<{ url?: string; urls?: string[]; ktvId: string; time: string | null; type?: 'START' | 'HANDOVER' } | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  // 🔧 QR CONFIGURATION
  const JOURNEY_BASE_URL = 'https://nganha.vercel.app';
  const QR_SIZE = 250;

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
                    const duration = Number(seg.duration) || Number(svc.duration) || 60;
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
  const selectedSubOrder = subOrders.find(so => so.id === selectedSubOrderId) 
      || (selectedOrder ? { id: selectedOrder.id, bookingId: selectedOrder.id, originalOrder: selectedOrder, services: selectedOrder.services, dispatchStatus: selectedOrder.dispatchStatus, ktvSignature: '', ktvIds: [], calculatedStart: '' } : null);

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
           const otherService = order.services.find(s => 
               s.id !== svcId && 
               !s.mergedIntoId &&
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
                ktvId,
                segments: r.segments.map((cSeg, cIdx) => {
                  const pSeg = sourceSegments?.[cIdx] || sourceSegments?.[0];
                  return { ...cSeg, roomId: pSeg?.roomId || null, bedId: pSeg?.bedId || null };
                })
              } : r)
            };
          }
          return s;
        }),
      };
      
      updatedOrder = {
        ...updatedOrder,
        services: updatedOrder.services.map(s => s.id === sourceSvcId
          ? { ...s, mergedServiceIds: [...(s.mergedServiceIds || []), targetSvcId] }
          : s
        )
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
      const { orderId, svcId, duration, ktv1Dur, ktv2Dur } = splitConfig;
      
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
              const res = await splitBookingItem(orderId, realSvcId, ktv1Dur, ktv2Dur, selectedDate);
              if (!res.success) throw new Error(res.error);
              
              await fetchData();
          }
      } catch (err: any) {
          alert('Lỗi: ' + err.message);
      } finally {
          setSplitConfig(null);
      }
  };

  const addStaffRow = (orderId: string, svcId: string) => {
    const svc = orders.find(o => o.id === orderId)?.services.find(s => s.id === svcId);
    const dur = svc?.duration ?? DEFAULT_DURATION;
    
    if (svc && svc.staffList.length >= 1) {
       setSplitConfig({
           orderId,
           svcId,
           duration: dur,
           ktv1Dur: dur,
           ktv2Dur: dur,
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
      return s.staffList.length > 0 &&
      s.staffList.every(r => 
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
        const { addAddonServices } = await import('./actions');
        // Thêm dịch vụ vào DB ngay lập tức để lấy ID chuẩn, nhưng KHÔNG fetchData để tránh mất dữ liệu đang sửa dở
        const res = await addAddonServices(selectedOrderId, [{ serviceId: svcId, qty: 1 }], 'ADMIN');
        
        if (res.success && res.newItems && res.newItems.length > 0) {
            const newItem = res.newItems[0];
            const realId = newItem.id;
            
            const now = new Date();
            const startTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const newBlock: ServiceBlock = {
              id: realId, // Dùng ID thật từ DB
              serviceId: svcId,
              serviceName: svcName,
              duration,
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
              genderReq: '',
              strength: '',
              focus: '',
              avoid: '',
              customerNote: '',
              options: { isAddon: true, isPaid: false }
            };
            
            setOrders(prev => prev.map(o =>
              o.id === selectedOrderId 
                  ? { ...o, services: [...o.services, newBlock], totalAmount: res.newTotalAmount } 
                  : o
            ));
            setShowAddSvcModal(false);
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
            setSvcSearchQuery('');
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
          const res = await addAddonServices(selectedOrderId, [{ serviceId: svcDef.id, qty: 1 }], 'ADMIN');
          if (res.success) {
              alert(`✅ Thêm "${svcName}" thành công! Tổng tiền mới: ${(res.newTotalAmount || 0).toLocaleString()}đ`);
              setShowAddSvcModal(false);
              setSvcSearchQuery('');
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

  const handleSaveDraft = async () => {
    if (!selectedOrder) return;
    
    try {
      const clonedOrder = JSON.parse(JSON.stringify(selectedOrder)) as PendingOrder;
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
          const allSegments = svc.staffList.flatMap(r => 
            r.segments.map(seg => ({ ...seg, ktvId: r.ktvId }))
          );

          return {
              id: svc.id,
              roomName: allSegments[0]?.roomId || primarySeg?.roomId, 
              bedId: allSegments[0]?.bedId || primarySeg?.bedId,
              technicianCodes: svc.staffList.map(r => r.ktvId).filter(Boolean),
              segments: allSegments,
              options: {
                  ...(svc.options || {}),
                  displayName: svc.options?.displayName || svc.serviceName,
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
        alert('✅ Đã lưu tạm thông tin thành công!');
        fetchData();
      } else {
        alert('Lỗi khi lưu tạm: ' + res.error);
      }
    } catch (err) {
      alert('Đã có lỗi bất ngờ xảy ra khi lưu tạm.');
      console.error(err);
    }
  };
  const handleDispatch = async (skipValidation: boolean = false, specificSvcIds?: string[], overrideOrderId?: string) => {
    const orderToDispatch = overrideOrderId ? orders.find(o => o.id === overrideOrderId) : selectedOrder;
    if (!orderToDispatch) return;
    if (!skipValidation) {
      // ⚠️ Khi dispatch lẻ (specificSvcIds), chỉ validate các DV đang dispatch, không check toàn bộ đơn
      const orderToValidate = specificSvcIds && specificSvcIds.length > 0 
        ? { ...orderToDispatch, services: orderToDispatch.services.filter(s => specificSvcIds.includes(s.id)) }
        : orderToDispatch;
      const missing = getMissingInfo(orderToValidate);
      if (missing.length > 0) {
        alert(`⚠️ Vui lòng điền đầy đủ thông tin:\n\n${missing.map(m => `• ${m}`).join('\n')}`);
        return;
      }
    }

    try {
      const clonedOrder = JSON.parse(JSON.stringify(orderToDispatch)) as PendingOrder;

      const allStaffAssignments: Array<{ ktvId: string; bookingItemId: string; roomId: string | null; bedId: string | null; turnsCompleted: number; queuePos: number; startTime: string; endTime: string }> = [];
      const techCodesSet = new Set<string>();

      const targetServices = specificSvcIds && specificSvcIds.length > 0 
        ? clonedOrder.services.filter(s => specificSvcIds.includes(s.id)) 
        : clonedOrder.services;

      for (const svc of targetServices) {
        for (const row of svc.staffList) {
          if (!row.ktvId) continue;
          
          const ktvId = row.ktvId;
          techCodesSet.add(ktvId); 

          const currentTurn = turns.find(t => t.employee_id === ktvId);
          
          // 🔥 FIX: KTV ngoài (tên nhập tự do) không có trong TurnQueue
          // Thay vì skip, tạo assignment với default values để server xử lý mapping EXT
          let turnsCompleted = currentTurn?.turns_completed || 0;
          let queuePos = currentTurn?.queue_position || 0;

          if (!currentTurn || currentTurn.current_order_id !== clonedOrder.id) {
            const currentMax = Math.max(...turns.map(t => t.queue_position), 0);
            
            // Fix: Check if this KTV is already added in a previous service of the same order
            const existingAssignment = allStaffAssignments.find(a => a.ktvId === ktvId);
            if (existingAssignment) {
              queuePos = existingAssignment.queuePos;
            } else {
              const uniqueAddedKtvs = new Set(allStaffAssignments.map(a => a.ktvId));
              const addedCount = uniqueAddedKtvs.size; 
              queuePos = currentMax + addedCount + 1;
            }
          }
          
          // Với đa chặng, TurnQueue theo chặng đầu tiên
          const firstSeg = row.segments[0];
          const lastSeg = row.segments[row.segments.length - 1];

          allStaffAssignments.push({
            ktvId,
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

      // ⚠️ DO NOT REMOVE — Fix 16/05/2026: Dispatch lẻ bảo vệ KTV đang làm
      // Khi dispatch lẻ DV3, RPC cleanup step 0.5 sẽ XÓA KTV1/KTV2 đang ACTIVE cho DV1/DV2
      // vì họ không nằm trong p_staff_assignments. Fix: thêm "keepalive" entries cho KTV các DV khác.
      if (specificSvcIds && specificSvcIds.length > 0) {
        const otherServices = clonedOrder.services.filter(s => !specificSvcIds.includes(s.id));
        for (const svc of otherServices) {
          for (const row of svc.staffList) {
            if (!row.ktvId) continue;
            // Chỉ thêm nếu KTV này chưa có trong danh sách (tránh trùng)
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
      }

      // ✅ KHÔNG GỘP assignments cùng KTV nữa. Giữ nguyên 1 item = 1 row để tuân thủ kiến trúc chuẩn!
      const mergedAssignments = allStaffAssignments;


      const combinedTechCodes = Array.from(techCodesSet).join(', ');
      
      const primaryService = clonedOrder.services[0];
      const primaryStaff = primaryService?.staffList[0];
      const primarySeg = primaryStaff?.segments[0];
      
      const itemUpdates = targetServices.map(svc => {
          const originalIndex = clonedOrder.services.findIndex(s => s.id === svc.id);
          // Lưu toàn bộ lộ trình của tất cả KTV trong dịch vụ này
          const allSegments = svc.staffList.flatMap(r => 
            r.segments.map(seg => ({ ...seg, ktvId: r.ktvId }))
          );

          return {
              id: svc.id,
              // Lấy room/bed riêng cho service này từ segment đầu tiên của nó
              roomName: allSegments[0]?.roomId || primarySeg?.roomId, 
              bedId: allSegments[0]?.bedId || primarySeg?.bedId,
              technicianCodes: svc.staffList.map(r => r.ktvId).filter(Boolean),
              status: (svc.status && !['NEW', 'WAITING'].includes(svc.status)) ? svc.status : 'PREPARING', 
              segments: allSegments,
              options: {
                  ...(svc.options || {}),
                  displayName: svc.options?.displayName || svc.serviceName,
                  order: originalIndex !== -1 ? originalIndex : 999,
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

      const isPartial = !!(specificSvcIds && specificSvcIds.length > 0);
      // ⚠️ Khi dispatch: KHÔNG gửi status để tránh lỗi backward transition nếu đang IN_PROGRESS/CLEANING
      // Chỉ gửi PREPARING nếu trạng thái thực sự là NEW, pending, hoặc WAITING (chưa điều phối)
      const isPending = !clonedOrder.rawStatus || ['NEW', 'pending', 'WAITING'].includes(clonedOrder.rawStatus);
      const bookingStatus = isPartial ? null : (isPending ? 'PREPARING' : clonedOrder.rawStatus);
      
      const res = await processDispatch(clonedOrder.id, {
        status: bookingStatus as any,
        bedId: isPartial ? undefined : (primarySeg?.bedId || null),
        roomName: isPartial ? undefined : (primarySeg?.roomId || null),
        staffAssignments: mergedAssignments,
        date: selectedDate,
        notes: isPartial ? undefined : finalNotesToSave,
        itemUpdates: itemUpdates
      });

      if (res.success) {
        if (!isPartial || targetServices.length === clonedOrder.services.length) {
            setOrders(prev => prev.map(o =>
            o.id === clonedOrder.id ? { ...o, dispatchStatus: 'dispatched' } : o
            ));
            setSelectedOrderId(null);
            setLeftPanelTab('dispatched');
        } else {
            // Update local state for just the specific service
            setOrders(prev => prev.map(o => {
                if (o.id !== clonedOrder.id) return o;
                return {
                    ...o,
                    services: o.services.map(s => {
                        if (!specificSvcIds?.includes(s.id)) return s;
                        return { ...s, options: { ...s.options }, status: (s.status && !['NEW', 'WAITING'].includes(s.status)) ? s.status : 'PREPARING' }; 
                    })
                };
            }));
            alert(`✅ Đã điều phối riêng dịch vụ thành công!`);
        }
        fetchData();
      } else {
        alert('Lỗi khi điều phối: ' + res.error);
      }
    } catch (err) {
      alert('Đã có lỗi bất ngờ xảy ra.');
      console.error(err);
    }
  };


  const handleCancelBooking = async (orderId: string) => {
    if (!confirm('Bạn có chắc chắn muốn HỦY đơn hàng này không?')) return;
    try {
      const res = await cancelBooking(orderId, selectedDate);
      if (res.success) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
        if (selectedOrderId === orderId) setSelectedOrderId(null);
        setContextMenu(null);
      } else {
        alert('Lỗi khi hủy đơn: ' + res.error);
      }
    } catch (err) {
      alert('Lỗi hệ thống khi hủy đơn.');
    }
  };

  async function handleConfirmPauseSwap(bookingItemId: string, action: 'PAUSE' | 'RESUME' | 'SWAP', oldKtvId?: string, newKtvId?: string, extraTimeMins?: number, keepTurnForOldKtv?: boolean) {
    try {
      const data = await apiClient.post<any>(API.KTV.PAUSE_SWAP, {
          action,
          bookingItemId,
          oldKtvId,
          newKtvId,
          extraTimeMins,
          keepTurnForOldKtv,
          businessDate: selectedDate
      });
      if (!data.success) throw new Error(data.error || 'Có lỗi xảy ra');
      
      // Thành công => Cập nhật lại UI
      await fetchData(); // Tải lại toàn bộ dữ liệu Board
    } catch (err: any) {
      throw err;
    }
  }

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
        confirmMsg = `Xác nhận BẮT ĐẦU LÀM thay cho KTV? Hệ thống sẽ bắt đầu tính giờ làm dịch vụ ngay lập tức.`;
      }
      
      if (!confirm(confirmMsg)) return;
    }

    try {
      let res;
      if (isPartial) {
          const { updateBookingItemStatus } = await import('./actions');
          res = await updateBookingItemStatus(itemIds, newStatus, selectedDate, orderId, targetKtvIds);
      } else {
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
                        return { ...s, status: newStatus };
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
  };

  const handleCreateQuickBooking = async (data: { customerName: string; customerPhone: string; customerEmail: string; serviceIds: string[]; customerLang: string }) => {
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
                    <Columns3 size={14} /> Giám Sát Đơn
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
                    <BedDouble size={14} /> Sổ Phòng
                  </button>
                  <button
                    onClick={() => setActiveMode('SCHEDULE')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      activeMode === 'SCHEDULE'
                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <CalendarClock size={14} /> Lịch Biểu Diễn
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

        <div className="flex-1 flex flex-col lg:flex-row gap-5 overflow-hidden pb-4 sm:pb-0">
          {activeMode === 'DISPATCH' ? (
            <>
          {/* LEFT: Order Panel */}
          <div className={`${selectedOrderId ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 flex-1 lg:flex-none shrink-0 flex-col border border-gray-200 bg-white rounded-3xl shadow-sm transition-all min-h-0 overflow-hidden`}>
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
                        setSelectedOrderId(order.id);
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
                    className={`bg-white p-5 rounded-3xl border-2 cursor-pointer transition-all active:scale-[0.98] relative ${selectedSubOrderId === subOrder.id ? 'border-indigo-600 shadow-2xl shadow-indigo-100 ring-4 ring-indigo-50/50' : 'border-transparent shadow-sm hover:border-indigo-100 hover:shadow-lg'}`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg tracking-wider">
                          #{order.billCode} {subOrder.services.length < order.services.length && '(Tách)'}
                        </span>
                        {order.hasVat && <span className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100" title="Khách yêu cầu xuất hoá đơn VAT">VAT</span>}
                        {(() => {
                          const isVipMenu = subOrder.services.some((svc: any) => 
                            (svc.serviceId && (String(svc.serviceId).toUpperCase().startsWith('NHP') || String(svc.serviceId).toUpperCase().startsWith('VIP_'))) ||
                            (svc.serviceName && String(svc.serviceName).toUpperCase().includes('VIP'))
                          );
                          return isVipMenu ? (
                            <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-black bg-gradient-to-b from-[#ffe866] to-[#ffc800] text-[#6b3e00] border border-[#e6b400] shadow-sm uppercase tracking-wide" title="Menu VIP">
                              VIP
                            </span>
                          ) : (
                            <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-50 text-slate-500 border border-slate-200 uppercase" title="Menu Thường">
                              THƯỜNG
                            </span>
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
                        <p className="font-black text-gray-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight truncate">{order.customerName}</p>
                      </div>
                        <div className="shrink-0 text-[11px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-xl flex items-center gap-1 border border-emerald-100/50">
                          <span>{(subOrder.services.reduce((acc, svc) => acc + ((svc.price || 0) * (svc.quantity || 1)), 0)).toLocaleString('vi-VN')}đ</span>
                          <span className="opacity-30">·</span>
                          <span>{order.paymentMethod === 'Cash' || order.paymentMethod === 'cash_vnd' ? 'cash' : (order.paymentMethod === 'Transfer' ? 'ck' : order.paymentMethod)}</span>
                        </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between gap-4">
                      <p className="text-[10px] text-gray-500 font-medium truncate flex-1 leading-tight">
                        {subOrder.services.length > 0 
                          ? `${subOrder.services.map(s => s.serviceName || 'Dịch vụ').join(', ')} · ${subOrder.services.reduce((acc, s) => acc + (s.duration || 0), 0)}p`
                          : 'Chưa có dịch vụ'
                        }
                      </p>
                      {selectedSubOrderId === subOrder.id && <span className="shrink-0 text-[10px] font-black text-indigo-600 uppercase tracking-tighter">Đang chọn →</span>}
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
          <div className={`${selectedOrderId ? 'flex' : 'hidden lg:flex'} flex-1 flex flex-col border border-gray-200 bg-white rounded-3xl overflow-hidden shadow-sm min-w-0 min-h-0 transition-all`}>
            <div className="p-4 lg:p-5 border-b border-gray-100 bg-white shrink-0 flex items-center gap-3">
              {selectedOrderId && (
                <button 
                  onClick={() => { setSelectedOrderId(null); setSelectedSubOrderId(null); }}
                  className="lg:hidden p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-400"
                >
                  <ChevronLeft size={24} />
                </button>
              )}
              {selectedSubOrder ? (
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse shrink-0" />
                    <h2 className="font-black text-gray-900 text-base truncate flex-1">
                      Đơn {selectedSubOrder.originalOrder.billCode} — {selectedSubOrder.originalOrder.customerName} — {
                        [selectedSubOrder.originalOrder.phone, selectedSubOrder.originalOrder.email].filter(Boolean).join(' — ') || '....'
                      }
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
                  <div className="flex items-center gap-2 mt-1 ml-4">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Đang điều phối</p>
                    {/* Toggle Quick/Detail */}
                    {(() => {
                      return (
                        <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
                          <button
                            onClick={() => setDispatchMode('quick')}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1 ${dispatchMode === 'quick' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                          >
                            <Zap size={10} /> Nhanh
                          </button>
                          <button
                            onClick={() => setDispatchMode('detail')}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-1 ${dispatchMode === 'detail' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                          >
                                                        <LayoutList size={10} /> Chi tiết
                          </button>
                        </div>
                      );
                    })()}

                    {/* NEW INPUTS ON THE SAME ROW */}
                    {(() => {
                        const currentNationality = editingGuestInfo ? editingGuestInfo.nationality : (selectedSubOrder.originalOrder.nationality || '');
                        const currentGuestCount = editingGuestInfo ? editingGuestInfo.guestCount : (selectedSubOrder.originalOrder.guestCount || 1);
                        const currentGender = editingGuestInfo ? editingGuestInfo.customerGender : (selectedSubOrder.originalOrder.customerGender || 'male');
                        const isDirty = editingGuestInfo !== null && (currentNationality !== (selectedSubOrder.originalOrder.nationality || '') || currentGuestCount !== (selectedSubOrder.originalOrder.guestCount || 1) || currentGender !== (selectedSubOrder.originalOrder.customerGender || 'male'));
                        
                        return (
                            <div className="flex items-center gap-2 ml-4 border-l border-gray-200 pl-4">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Giới tính</span>
                                <select
                                  value={currentGender}
                                  onChange={(e) => setEditingGuestInfo({ nationality: currentNationality, guestCount: currentGuestCount, customerGender: e.target.value })}
                                  className="w-20 bg-white px-2 py-1 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                >
                                  <option value="male">Nam</option>
                                  <option value="female">Nữ</option>
                                </select>
                                <div className="w-px h-4 bg-gray-200 mx-2" />
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Quốc tịch</span>
                                <select
                                  value={currentNationality}
                                  onChange={(e) => setEditingGuestInfo({ nationality: e.target.value, guestCount: currentGuestCount, customerGender: currentGender })}
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
                                <input
                                  type="number"
                                  min={1}
                                  value={currentGuestCount}
                                  onChange={(e) => setEditingGuestInfo({ nationality: currentNationality, guestCount: parseInt(e.target.value || '1', 10), customerGender: currentGender })}
                                  className="w-16 bg-white px-2 py-1 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-center"
                                />
                                <button
                                  onClick={async () => {
                                    setIsFetchingCustomer(true);
                                    try {
                                      const data = await apiClient.get<any>(API.CUSTOMERS);
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
                                  className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors disabled:opacity-50"
                                  title="Xem thông tin khách hàng"
                                >
                                  {isFetchingCustomer ? (
                                    <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <Info size={16} />
                                  )}
                                </button>
                                {isDirty && (
                                    <button
                                      onClick={async () => {
                                          try {
                                              const res = await updateBookingMeta(selectedSubOrder.bookingId, {
                                                  nationality: currentNationality,
                                                  guestCount: currentGuestCount,
                                                  customerGender: currentGender
                                              });
                                              if (!res.success) throw new Error(res.error || 'Lỗi không xác định');
                                              
                                              // Cập nhật lại UI local state
                                              updateOrder(selectedSubOrder.bookingId, o => ({ ...o, nationality: currentNationality, guestCount: currentGuestCount, customerGender: currentGender }));
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
                                )}
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
              <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 bg-slate-50/30">
                {/* Quick Dispatch Mode */}
                {dispatchMode === 'quick' ? (
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
                              return found ? found : origSvc;
                          });
                          
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
                      const svcIds = specificSvcId ? [specificSvcId] : group.items.map(i => i.id);
                      handleDispatch(false, svcIds);
                    }}
                    onPrintGroup={(group) => {
                      // TODO: QuickPrintTicket integration
                      alert(`🖨️ In phiếu: ${group.displayName || group.serviceName} x${group.items.length}\nKTV: ${group.selectedKtvIds.join(', ')}\n${(group.ktvStartTimes || [])[0] || '--:--'} → ${(group.ktvEndTimes || [])[0] || '--:--'}`);
                    }}
                    customerReqs={selectedSubOrder.services[0] ? {
                      genderReq: selectedSubOrder.services[0].genderReq,
                      strength: selectedSubOrder.services[0].strength,
                      focus: selectedSubOrder.services[0].focus,
                      avoid: selectedSubOrder.services[0].avoid,
                      customerNote: selectedSubOrder.services[0].customerNote,
                    } : undefined}
                    reminders={reminders}
                    billCode={selectedSubOrder.originalOrder.billCode}
                    customerName={selectedSubOrder.originalOrder.customerName}
                  />
                ) : (
                  /* Detail Dispatch Mode */
                  <Reorder.Group
                    axis="y"
                    values={selectedSubOrder.services.filter(svc => !svc.mergedIntoId)}
                    onReorder={(newServices) => {
                      const recalculated = recalculateAllTimes({ ...selectedSubOrder.originalOrder, services: newServices }, roomTransitionTime);
                      updateOrder(selectedSubOrder.bookingId, o => {
                          const nonSubOrderServices = o.services.filter(s => !newServices.some(ns => ns.id === s.id));
                          return { ...o, services: [...nonSubOrderServices, ...recalculated.services.filter(s => newServices.some(ns => ns.id === s.id))] };
                      });
                    }}
                    className="space-y-6"
                  >
                    {selectedSubOrder.services.filter(svc => !svc.mergedIntoId).map((svc, idx) => {
                      let displaySvc = { ...svc };
                      if (svc.mergedServiceIds && svc.mergedServiceIds.length > 0) {
                          const mergedSvcs = selectedSubOrder.originalOrder.services.filter(s => svc.mergedServiceIds?.includes(s.id));
                          if (mergedSvcs.length > 0) {
                              displaySvc.serviceName = `${svc.serviceName} + ${mergedSvcs.map(s => s.serviceName).join(' + ')}`;
                              displaySvc.duration = svc.duration + mergedSvcs.reduce((acc, s) => acc + (s.duration || 0), 0);
                          }
                      }
                      const busyInOtherOrders = orders
                        .filter(o => o.id !== selectedSubOrder.bookingId && (o.dispatchStatus === 'IN_PROGRESS' || o.dispatchStatus === 'PREPARING'))
                        .flatMap(o => o.services.flatMap(s => s.staffList.flatMap(r => r.segments.map(seg => seg.bedId))))
                        .filter(Boolean) as string[];
                      const currentSvcKtvIds = svc.staffList.map(r => r.ktvId).filter(Boolean);
                      const busyInCurrentOrder = selectedSubOrder.originalOrder.services.filter(s => s.id !== svc.id)
                        .flatMap(s => s.staffList
                          .filter(r => !currentSvcKtvIds.includes(r.ktvId))
                          .flatMap(r => r.segments.map(seg => seg.bedId)))
                        .filter(Boolean) as string[];
                      const allBusyBedIds = [...new Set([...busyInOtherOrders, ...busyInCurrentOrder])];

                      return (
                        <Reorder.Item key={svc.id} value={svc} dragListener={!expandedSvcIds.includes(svc.id)}>
                          <DispatchServiceBlock
                            svc={displaySvc}
                            svcIndex={idx}
                            orderId={selectedSubOrder.bookingId}
                            rooms={rooms}
                            beds={beds}
                            busyBedIds={allBusyBedIds}
                            usedKtvIds={[]}
                            availableTurns={turns}
                            reminders={reminders}
                            onUpdateSvc={updateSvcField}
                            onUpdateStaff={updateStaffRow}
                            onAddStaff={addStaffRow}
                            onRemoveStaff={removeStaffRow}
                            onRemoveSvc={removeServiceBlock}
                            onEditSvc={(orderId, svcId) => setEditingSvc({ orderId, svcId, oldSvcName: svc.serviceName })}
                            selectedDate={selectedDate}
                            isExpanded={expandedSvcIds.includes(svc.id)}
                            onViewPhoto={setSelectedPhoto}
                            onToggleExpand={() => {
                              const isOpening = !expandedSvcIds.includes(svc.id);
                              setExpandedSvcIds(prev => 
                                  isOpening ? [...prev, svc.id] : prev.filter(id => id !== svc.id)
                              );
                              if (isOpening && selectedSubOrder?.dispatchStatus === 'pending') {
                                const now = new Date();
                                const nowStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                                setOrders(prev => prev.map(o => 
                                  o.id === selectedOrderId ? {
                                    ...o,
                                    services: o.services.map(s => s.id === svc.id ? {
                                      ...s,
                                      staffList: s.staffList.map(r => ({
                                        ...r,
                                        segments: r.segments.map((seg, segIdx) => {
                                          if (segIdx === 0) {
                                            return { ...seg, startTime: nowStr, endTime: calcEndTime(nowStr, seg.duration) };
                                          }
                                          const prevEnd = r.segments[segIdx - 1] 
                                            ? calcEndTime(segIdx === 1 ? nowStr : r.segments[segIdx - 1].startTime, r.segments[segIdx - 1].duration)
                                            : nowStr;
                                          return { ...seg, startTime: prevEnd, endTime: calcEndTime(prevEnd, seg.duration) };
                                        })
                                      }))
                                    } : s)
                                  } : o
                                ));
                              }
                            }}
                            onDispatchSvc={(oId, svcId) => handleDispatch(false, [svcId, ...(displaySvc.mergedServiceIds || [])])}
                          />
                        </Reorder.Item>
                      );
                    })}
                  </Reorder.Group>
                )}

                <button
                  onClick={() => setShowAddSvcModal(true)}
                  className="w-full py-4 border-2 border-dashed border-gray-200 rounded-3xl text-sm font-black text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-white transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
                >
                  <Plus size={18} strokeWidth={3} /> THÊM DỊCH VỤ KHÁC
                </button>

                <div className="pt-4 sticky bottom-0 bg-gradient-to-t from-white via-white/90 to-transparent pb-2 mt-auto flex gap-3">
                  <button
                    onClick={handleSaveDraft}
                    className="flex-1 py-5 rounded-3xl font-black text-sm tracking-widest uppercase transition-all flex items-center justify-center gap-2 shadow-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 border-2 border-emerald-200 active:scale-95"
                  >
                    <Save size={20} strokeWidth={3} /> LƯU
                  </button>
                  {(() => {
                    const hasStartedService = selectedSubOrder.originalOrder.services.some(
                      (s: any) => s.status && ['IN_PROGRESS', 'CLEANING', 'FEEDBACK', 'DONE', 'COMPLETED'].includes(s.status)
                    );
                    const ready = isDispatchReady(selectedSubOrder.originalOrder) && !hasStartedService;
                    
                    return (
                      <button
                        onClick={() => setShowDispatchConfirmModal(true)}
                        disabled={!ready}
                        title={hasStartedService ? "Đã có dịch vụ bắt đầu, vui lòng điều phối lẻ từng dịch vụ!" : ""}
                        className={`flex-[2] flex-col py-3 rounded-3xl font-black text-sm lg:text-base tracking-widest uppercase transition-all flex items-center justify-center gap-1 shadow-2xl ${ready
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 active:scale-95'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                          }`}
                      >
                        <div className="flex items-center gap-3">
                           <Send size={20} strokeWidth={3} /> XÁC NHẬN ĐIỀU PHỐI
                        </div>
                        {hasStartedService && (
                          <span className="text-[10px] text-rose-500 font-bold normal-case tracking-normal">(Vui lòng điều phối lẻ vì đã có DV chạy)</span>
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
                setSelectedSubOrderId(subOrderId || null);
                setActiveMode('DISPATCH');
              }}
              onConfirmAddonPayment={handleConfirmAddonPayment}
              selectedOrderId={selectedOrderId}
              onContextMenu={(e: any, orderId: string) => {
                let x = 0, y = 0;
                if (e.type && e.type.startsWith('touch')) {
                  const touch = e.touches[0];
                  x = touch.clientX;
                  y = touch.clientY;
                } else {
                  x = e.clientX;
                  y = e.clientY;
                }
                setContextMenu({ x, y, orderId });
              }}
              onPauseClick={(orderId, subOrder) => {
                const o = orders.find(x => x.id === orderId);
                if (o) {
                  setPauseModalOrder(o);
                  if (subOrder) setPauseModalSubOrder(subOrder);
                  setPauseModalOpen(true);
                  setContextMenu(null);
                }
              }}
            />
          ) : activeMode === 'TURN_QUEUE' ? (
            <div className="flex-1 overflow-auto bg-white rounded-3xl border border-gray-200 shadow-sm p-4 w-full h-full">
              {(() => {
                return <TurnQueueBoard staffs={staffs} />;
              })()}
            </div>
          ) : activeMode === 'ROOMS' ? (
            <div className="flex-1 overflow-hidden bg-white rounded-3xl border border-gray-200 shadow-sm w-full h-full">
              <RoomBoard 
                rooms={rooms}
                beds={beds}
                occupancies={orders.flatMap(order => 
                  order.services
                    .filter(svc => svc.bedId && svc.status !== 'COMPLETED' && svc.status !== 'CANCELLED')
                    .map(svc => ({
                      bedId: svc.bedId as string,
                      roomId: svc.selectedRoomId as string,
                      ktvName: svc.staffList?.[0]?.ktvName || 'Chưa phân công',
                      endTime: svc.timeEnd ? svc.timeEnd.substring(0, 5) : undefined,
                      status: svc.status || 'NEW',
                      serviceName: svc.serviceName
                    }))
                )}
              />
            </div>
          ) : activeMode === 'SCHEDULE' ? (
            <div className="flex-1 overflow-hidden bg-white rounded-3xl border border-gray-200 shadow-sm w-full h-full">
              <ScheduleBoard orders={orders} />
            </div>
          ) : null}

        </div>
      </div>

      {/* Add Svc Modal */}
      <AnimatePresence>
        {(showAddSvcModal || editingSvc) && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md" 
              onClick={() => { setShowAddSvcModal(false); setEditingSvc(null); }} 
            />
            <motion.div 
              initial={{ y: '100%', opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative bg-white rounded-t-[2.5rem] sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h3 className="font-black text-gray-900 text-lg uppercase tracking-tight">{editingSvc ? 'Đổi Dịch Vụ' : 'Thêm Dịch Vụ'}</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">{editingSvc ? `Đang đổi cho: ${editingSvc.oldSvcName}` : 'Chọn từ danh mục phổ biến'}</p>
                </div>
                <button 
                  onClick={() => { setShowAddSvcModal(false); setEditingSvc(null); }}
                  className="p-3 hover:bg-gray-100 rounded-2xl text-gray-400 transition-colors"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>
              {/* Search bar */}
              <div className="px-6 pt-4 pb-2">
                <input
                  type="text"
                  placeholder="Tìm dịch vụ..."
                  value={svcSearchQuery}
                  onChange={(e) => setSvcSearchQuery(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-100 rounded-2xl text-sm font-medium focus:outline-none focus:border-indigo-400 transition-colors placeholder:text-gray-300"
                />
              </div>
              <div className="p-6 pt-2 grid grid-cols-1 gap-3 max-h-[60vh] overflow-y-auto no-scrollbar pb-10 sm:pb-6">
                {allServices
                  .filter((svc: any) => {
                    if (!svcSearchQuery.trim()) return true;
                    const name = (typeof svc.nameVN === 'object' && svc.nameVN !== null) ? (svc.nameVN.vn || svc.nameVN.en || '') : (svc.nameVN || svc.nameEN || '');
                    return name.toLowerCase().includes(svcSearchQuery.toLowerCase());
                  })
                  .map((svc: any) => {
                    const name = (typeof svc.nameVN === 'object' && svc.nameVN !== null) ? (svc.nameVN.vn || svc.nameVN.en || svc.nameVN) : (svc.nameVN || svc.nameEN || `Dịch vụ ${svc.code || svc.id}`);
                    const dur = svc.duration ?? 60;
                    const price = svc.priceVND || 0;
                    const isUtilitySvc = svc.is_utility === true || svc.id === 'NHS0900' || String(name).toLowerCase().includes('phòng riêng') || String(name).toLowerCase().includes('phong rieng'); // Legacy fallback
                    return (
                      <button 
                        key={svc.id} 
                        onClick={() => editingSvc ? handleEditService(svc.id, name, dur) : addServiceBlock(svc.id, name, dur)} 
                        className={`group p-5 text-left border-2 rounded-2xl transition-all flex items-center justify-between active:scale-[0.98] ${isUtilitySvc ? 'border-amber-200 hover:border-amber-400 hover:bg-amber-50/30' : 'border-gray-100 hover:border-indigo-500 hover:bg-indigo-50/30'}`}
                      >
                        <div>
                          <p className={`font-black transition-colors ${isUtilitySvc ? 'text-amber-700 group-hover:text-amber-800' : 'text-gray-900 group-hover:text-indigo-600'}`}>{name}</p>
                          <div className="flex items-center gap-3 mt-1">
                            {isUtilitySvc 
                              ? <span className="text-[10px] text-amber-600 font-black bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200 uppercase tracking-wider">Tiện ích</span>
                              : <span className="text-xs text-gray-400 font-bold uppercase tracking-widest">{dur} PHÚT</span>
                            }
                            {price > 0 && <span className="text-xs text-emerald-600 font-black">{price.toLocaleString()}đ</span>}
                          </div>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                          <Plus size={20} strokeWidth={3} />
                        </div>
                      </button>
                    );
                  })}
                {allServices.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-8 font-medium">Đang tải danh sách dịch vụ...</p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Dispatch Confirmation Modal */}
      <AnimatePresence>
        {showDispatchConfirmModal && selectedOrder && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md" 
              onClick={() => setShowDispatchConfirmModal(false)} 
            />
            <motion.div 
              initial={{ y: '100%', opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative bg-white rounded-t-[2.5rem] sm:rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
                <div>
                  <h3 className="font-black text-indigo-900 text-lg uppercase tracking-tight">Xác nhận thông tin</h3>
                  <p className="text-sm text-indigo-600 font-bold mt-1">Đơn {selectedOrder.billCode} - {selectedOrder.customerName}</p>
                </div>
                <button 
                  onClick={() => setShowDispatchConfirmModal(false)}
                  className="p-3 bg-white hover:bg-gray-100 rounded-2xl text-gray-400 transition-colors shadow-sm"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto no-scrollbar flex-1 space-y-4">
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 flex justify-between items-center">
                  <span className="text-gray-500 font-bold">Tổng tiền thu:</span>
                  <span className="text-xl font-black text-emerald-600">{(selectedOrder.totalAmount || 0).toLocaleString()}đ</span>
                </div>

                <div className="space-y-3">
                  <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">Chi tiết dịch vụ ({selectedOrder.services.length})</h4>
                  {selectedOrder.services.map((svc, sIdx) => (
                    <div key={svc.id || sIdx} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                      <p className="font-bold text-gray-900 text-sm mb-3 pb-2 border-b border-gray-100">{sIdx + 1}. {svc.serviceName}</p>
                      <div className="space-y-3">
                        {svc.staffList.map((st, stIdx) => (
                          <div key={st.ktvId ? `${svc.id}-${st.ktvId}` : `${svc.id}-st-${stIdx}`} className="pl-2 border-l-2 border-indigo-200 flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md font-bold">KTV</span>
                              <span className="text-sm font-black text-gray-800">{st.ktvName || 'Chưa gán'} {st.ktvId ? `[${st.ktvId}]` : ''}</span>
                            </div>
                            <div className="text-xs text-gray-600 flex flex-col gap-1">
                              {st.segments.map((seg, segIdx) => {
                                const roomName = rooms.find(r => r.id === seg.roomId)?.name || seg.roomId || 'Chưa xếp phòng';
                                const bedName = beds.find(b => b.id === seg.bedId)?.name || seg.bedId || 'Chưa xếp giường';
                                return (
                                  <div key={`${svc.id}-${stIdx}-seg-${segIdx}`} className="flex items-center gap-2 bg-gray-50 rounded-lg p-1.5">
                                    <span className="font-semibold text-gray-500">{seg.startTime} - {seg.endTime}</span>
                                    <span className="text-gray-300">|</span>
                                    <span className="font-semibold text-indigo-600">{roomName}</span>
                                    <span className="text-gray-300">|</span>
                                    <span className="font-semibold text-amber-600">{bedName}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 bg-white grid grid-cols-2 gap-3 shrink-0">
                <button
                  onClick={() => setShowDispatchConfirmModal(false)}
                  className="w-full py-4 rounded-2xl font-black text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors uppercase text-sm"
                >
                  Quay lại sửa
                </button>
                <button
                  onClick={() => {
                    setShowDispatchConfirmModal(false);
                    handleDispatch();
                  }}
                  className="w-full py-4 rounded-2xl font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-colors uppercase text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
                >
                  <Send size={18} strokeWidth={3} /> Gửi & Dọn Phòng
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Context Menu for Cancellation */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className="fixed z-[100] bg-white rounded-2xl shadow-2xl border border-gray-100 p-1.5 min-w-[180px] overflow-hidden"
          >
            {/* Các nút chức năng dựa trên trạng thái */}
            {(() => {
              const order = orders.find(o => o.id === contextMenu.orderId);
              if (!order) return null;

              if (order.dispatchStatus === 'PREPARING') {
                return (
                  <button
                    onClick={() => handleUpdateStatus(contextMenu.orderId, 'IN_PROGRESS')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Bắt đầu làm (Thay KTV)
                  </button>
                );
              }
              if (order.dispatchStatus === 'IN_PROGRESS') {
                return (
                  <>
                  <button
                    onClick={() => handleUpdateStatus(contextMenu.orderId, 'CLEANING')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-purple-600 hover:bg-purple-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Hết giờ ➔ Bắt đầu dọn phòng
                  </button>
                  <button
                    onClick={() => { setPauseModalOrder(order); setPauseModalOpen(true); setContextMenu(null); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-amber-600 hover:bg-amber-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <AlertTriangle size={18} className="shrink-0" />
                    Tạm dừng / Đổi KTV
                  </button>
                  </>
                );
              }
              if (order.dispatchStatus === 'CLEANING') {
                return (
                  <button
                    onClick={() => handleUpdateStatus(contextMenu.orderId, 'FEEDBACK')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Dọn xong → Khách đánh giá
                  </button>
                );
              }
              if (order.dispatchStatus === 'FEEDBACK') {
                return (
                  <button
                    onClick={() => handleUpdateStatus(contextMenu.orderId, 'DONE')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Đã đánh giá → Đóng bill
                  </button>
                );
              }
              return null;
            })()}

            {/* QR Journey button */}
            <button
              onClick={() => {
                const order = orders.find(o => o.id === contextMenu.orderId);
                if (order) {
                  setQrModal({ orderId: order.id, billCode: order.billCode, accessToken: order.accessToken, customerLang: order.customerLang });
                }
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1"
            >
              <QrCode size={18} />
              Hiện QR Journey
            </button>

            {/* Force Dispatch - Skip validation */}
            <button
              onClick={() => {
                if (!confirm('⚡ Xác nhận GỬI ĐƠN ngay? (Bỏ qua kiểm tra thiếu thông tin)')) return;
                handleDispatch(true, undefined, contextMenu.orderId);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1"
            >
              <Send size={18} />
              Gửi đơn ngay (bỏ qua kiểm tra)
            </button>

            <button
              onClick={() => handleCancelBooking(contextMenu.orderId)}
              className="w-full flex items-center gap-3 px-4 py-3 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider"
            >
              <Trash2 size={18} />
              Hủy đơn hàng này
            </button>
            <button
              onClick={() => setContextMenu(null)}
              className="w-full flex items-center gap-3 px-4 py-3 text-gray-400 hover:bg-gray-50 rounded-xl transition-colors font-bold text-xs uppercase tracking-wider"
            >
              Đóng menu
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR Journey Modal */}
      <AnimatePresence>
        {qrModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setQrModal(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white rounded-3xl p-8 shadow-2xl max-w-sm w-full mx-4 text-center"
            >
              <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <QrCode size={28} className="text-indigo-600" />
              </div>
              <h3 className="text-lg font-black text-gray-900 mb-1">QR Journey</h3>
              <p className="text-xs text-gray-500 font-medium mb-6">Đơn #{qrModal.billCode} — Khách quét để xem lộ trình</p>
              
              <div className="bg-gray-50 rounded-2xl p-6 mb-6 inline-block border border-gray-100">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=${QR_SIZE}x${QR_SIZE}&data=${encodeURIComponent(`${JOURNEY_BASE_URL}/${qrModal.customerLang || 'vi'}/journey/${qrModal.accessToken || qrModal.orderId}`)}`}
                  alt="QR Journey"
                  width={QR_SIZE}
                  height={QR_SIZE}
                  className="mx-auto"
                />
              </div>

              <button
                onClick={() => setQrModal(null)}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-black rounded-2xl transition-colors text-sm uppercase tracking-wider"
              >
                Đóng
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

      {/* Split Service Modal */}
      <AnimatePresence>
        {mergePromptConfig && (
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6"
            >
              <div className="flex justify-center mb-4 text-amber-500">
                <AlertTriangle size={48} strokeWidth={1.5} />
              </div>
              <h3 className="text-xl font-black text-gray-900 text-center mb-2">Gộp Dịch Vụ?</h3>
              <p className="text-sm text-gray-500 text-center mb-6">
                Bạn đang gán KTV <span className="font-bold text-gray-900">{mergePromptConfig.ktvId}</span> cho nhiều dịch vụ. Bạn có muốn gộp chúng lại để KTV làm liên tục và chỉ cần chọn Phòng/Giường 1 lần không?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={cancelMergeServices}
                  className="flex-1 py-3 rounded-xl font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Không, tách riêng
                </button>
                <button
                  onClick={confirmMergeServices}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                >
                  Gộp dịch vụ
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {splitConfig && (
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6"
            >
              <h3 className="text-xl font-black text-gray-900 mb-2">Phân bổ thời gian KTV</h3>
              <p className="text-sm text-gray-500 mb-6">
                Thời lượng gốc: <span className="font-bold text-gray-900">{splitConfig.duration} phút</span>
              </p>

              <div className="space-y-4 mb-6">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">
                    KTV Hiện Tại (Phút)
                  </label>
                  <input
                    type="number"
                    value={splitConfig.ktv1Dur}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 0 && val <= splitConfig.duration) {
                        setSplitConfig(prev => prev ? {
                          ...prev,
                          ktv1Dur: val,
                          ktv2Dur: prev.duration - val
                        } : null);
                      }
                    }}
                    className="w-full text-center font-black text-2xl text-indigo-600 bg-white border border-gray-200 rounded-xl py-2 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 outline-none"
                  />
                </div>

                <div className="flex justify-center text-gray-300">
                  <Plus size={24} />
                </div>

                <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-2">
                    KTV Thêm Vào (Phút)
                  </label>
                  <input
                    type="number"
                    value={splitConfig.ktv2Dur}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 0 && val <= splitConfig.duration) {
                        setSplitConfig(prev => prev ? {
                          ...prev,
                          ktv2Dur: val,
                          ktv1Dur: prev.duration - val
                        } : null);
                      }
                    }}
                    className="w-full text-center font-black text-2xl text-indigo-700 bg-white border border-indigo-200 rounded-xl py-2 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 outline-none"
                  />
                </div>
              </div>
              
              {splitConfig.ktv1Dur !== splitConfig.duration && (
                <div className="mb-6 p-3 bg-amber-50 rounded-xl border border-amber-100 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 font-medium">
                    <span className="font-bold block mb-1">Làm Nối Tiếp</span>
                    Hệ thống sẽ <strong className="font-black">tách dịch vụ thành 2 dòng riêng biệt</strong> trên màn hình Lễ tân & KTV để tính giờ độc lập.
                  </p>
                </div>
              )}
              
              {splitConfig.ktv1Dur === splitConfig.duration && splitConfig.ktv2Dur === splitConfig.duration && (
                <div className="mb-6 p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-start gap-2">
                  <Sparkles size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-700 font-medium">
                    <span className="font-bold block mb-1">Làm Chung (Song song)</span>
                    Hai KTV sẽ cùng dùng chung 1 khung giờ. 1 người bấm sẽ cập nhật cho người kia.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setSplitConfig(null)}
                  disabled={splitConfig.isSaving}
                  className="px-4 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={confirmSplitService}
                  disabled={splitConfig.isSaving || (splitConfig.ktv1Dur + splitConfig.ktv2Dur !== splitConfig.duration && splitConfig.ktv1Dur !== splitConfig.duration)}
                  className="px-6 py-3 rounded-xl font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg shadow-indigo-200 disabled:opacity-50"
                >
                  {splitConfig.isSaving ? 'ĐANG LƯU...' : 'LƯU & TIẾP TỤC'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Xem Ảnh Xác Nhận / Ảnh Bàn Giao */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setSelectedPhoto(null); setPhotoIndex(0); }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative bg-white rounded-3xl overflow-hidden max-w-md w-full shadow-2xl border border-gray-100 flex flex-col"
            >
              {/* Header */}
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className={`font-black text-sm ${selectedPhoto.type === 'HANDOVER' ? 'text-emerald-600' : 'text-gray-900'}`}>
                      {selectedPhoto.type === 'HANDOVER' ? 'Ảnh bàn giao phòng' : 'Ảnh xác nhận khách bắt đầu ca'}
                  </h3>
                  <p className="text-xs text-gray-500 font-bold">Kỹ thuật viên: {selectedPhoto.ktvId}</p>
                </div>
                <button
                  onClick={() => { setSelectedPhoto(null); setPhotoIndex(0); }}
                  className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Image Body */}
              <div className="relative aspect-[3/4] bg-gray-50 flex items-center justify-center">
                {selectedPhoto.urls && selectedPhoto.urls.length > 1 ? (
                  <>
                    <img
                      src={selectedPhoto.urls[photoIndex]}
                      alt={`${selectedPhoto.type === 'HANDOVER' ? 'Ảnh bàn giao' : 'Ảnh xác nhận khách'} - ${photoIndex + 1}`}
                      className="w-full h-full object-contain"
                    />
                    
                    {/* Navigation Buttons */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhotoIndex((prev) => (prev > 0 ? prev - 1 : selectedPhoto.urls!.length - 1));
                      }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                    </button>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhotoIndex((prev) => (prev < selectedPhoto.urls!.length - 1 ? prev + 1 : 0));
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                    
                    {/* Pagination Indicators */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 px-3 py-1.5 bg-black/40 rounded-full backdrop-blur-md">
                      {selectedPhoto.urls.map((_, idx) => (
                        <div
                          key={idx}
                          className={`w-2 h-2 rounded-full transition-all ${
                            idx === photoIndex ? 'bg-white scale-110' : 'bg-white/50'
                          }`}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <img
                    src={selectedPhoto.urls ? selectedPhoto.urls[0] : selectedPhoto.url}
                    alt={selectedPhoto.type === 'HANDOVER' ? 'Ảnh bàn giao' : 'Ảnh xác nhận khách'}
                    className="w-full h-full object-contain"
                  />
                )}
              </div>

              {/* Footer */}
              {selectedPhoto.time && (
                <div className="p-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-500 font-bold">
                    {selectedPhoto.type === 'HANDOVER' ? 'Thời gian kết thúc:' : 'Thời gian bắt đầu:'}
                  </span>
                  <span className={`text-xs font-black px-2 py-0.5 rounded-md border ${
                      selectedPhoto.type === 'HANDOVER' 
                      ? 'text-emerald-600 bg-emerald-50 border-emerald-100' 
                      : 'text-indigo-600 bg-indigo-50 border-indigo-100'
                  }`}>
                    {formatToHourMinute(selectedPhoto.time)}
                  </span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Tạm Dừng / Đổi KTV */}
      <PauseSwapKtvModal
        isOpen={pauseModalOpen}
        onClose={() => { setPauseModalOpen(false); setPauseModalOrder(null); setPauseModalSubOrder(null); }}
        order={pauseModalOrder}
        subOrder={pauseModalSubOrder}
        availableKtvs={staffs.filter(s => s.status === 'ready')}
        onConfirm={handleConfirmPauseSwap}
      />

      <MergePromptModal
        config={mergePromptConfig}
        staffs={staffs}
        orders={orders}
        onConfirm={confirmMergeServices}
        onCancel={cancelMergeServices}
      />
    </AppLayout>
  );
}


