'use client';

// 🔧 UI CONFIGURATION
const DEFAULT_DURATION = 60; // Phút mặc định cho mỗi KTV

import React, { useState, useRef, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import {
  ShieldAlert, Clock, CheckCircle2, Bell, BellOff,
  Plus, Calendar as CalendarIcon, Send, Phone,
  ChevronDown, ChevronLeft, Package, Volume2, VolumeX, Trash2, X, Sparkles, QrCode, LayoutList, Columns3, Save, Zap, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { DispatchServiceBlock } from './_components/DispatchServiceBlock';
import { KanbanBoard } from './_components/KanbanBoard';
import { QuickDispatchTable } from './_components/QuickDispatchTable';
import { getDispatchData, processDispatch, cancelBooking, updateBookingStatus, createQuickBooking, addAddonServices } from './actions';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { AddOrderModal } from './_components/AddOrderModal';
import { useNotifications } from '@/components/NotificationProvider';

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

const calcEndTime = (start: string, duration: number): string => {
  if (!start || duration == null) return '';
  const [h, m] = start.split(':').map(Number);
  const end = new Date();
  end.setHours(h, m + Math.floor(duration), Math.floor((duration % 1) * 60), 0);
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
};

const genId = () => Math.random().toString(36).slice(2, 8);

// QUICK_SERVICES_LIST removed — now using allServices from Supabase

export default function DispatchBoardPage() {
  const { hasPermission } = useAuth();
  const [mounted, setMounted] = React.useState(false);
  const [staffs, setStaffs] = useState<StaffData[]>([]);
  const [turns, setTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
  const [loading, setLoading] = useState(true);

  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedSubOrderId, setSelectedSubOrderId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const vnTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    if (vnTime.getUTCHours() < 6) {
        vnTime.setUTCDate(vnTime.getUTCDate() - 1);
    }
    return vnTime.toISOString().split('T')[0];
  });
  const [allServices, setAllServices] = useState<any[]>([]);
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const { notifications, soundEnabled, setSoundEnabled, unlockAudio, playSound } = useNotifications();
  const [leftPanelTab, setLeftPanelTab] = useState<DispatchStatus>('pending');
  const [activeMode, setActiveMode] = useState<'DISPATCH' | 'MONITOR'>('DISPATCH');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAddSvcModal, setShowAddSvcModal] = useState(false);
  const [editingSvc, setEditingSvc] = useState<{ orderId: string, svcId: string, oldSvcName: string } | null>(null);
  const [showDispatchConfirmModal, setShowDispatchConfirmModal] = useState(false);
  const [svcSearchQuery, setSvcSearchQuery] = useState('');
  const [rooms, setRooms] = useState<any[]>([]);
  const [beds, setBeds] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [roomTransitionTime, setRoomTransitionTime] = useState(5);
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

  const { user } = useAuth();
  const lastSoundTimeRef = useRef<number>(0);
  const push = usePushNotifications(user?.id);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, orderId: string } | null>(null);
  const [qrModal, setQrModal] = useState<{ orderId: string; billCode: string; accessToken?: string | null; customerLang?: string } | null>(null);
  const [expandedSvcIds, setExpandedSvcIds] = useState<string[]>([]);
  const [dispatchMode, setDispatchMode] = useState<'quick' | 'detail'>('quick');
  // 🔧 QR CONFIGURATION
  const JOURNEY_BASE_URL = 'https://nganha.vercel.app';
  const QR_SIZE = 250;

  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // 🛡️ Ref to track if admin is actively editing dispatch form
  const selectedOrderIdRef = useRef(selectedOrderId);
  const needsRefreshRef = useRef(false);
  useEffect(() => {
    const wasEditing = !!selectedOrderIdRef.current;
    selectedOrderIdRef.current = selectedOrderId;
    // 🔄 Auto-refresh when admin closes the editing form and there are pending updates
    if (wasEditing && !selectedOrderId && needsRefreshRef.current) {
      needsRefreshRef.current = false;
      console.log('🔄 [Dispatch] Form closed — syncing pending realtime updates');
      fetchData();
    }
  }, [selectedOrderId]);

  // 📡 Realtime Subscriptions
  useEffect(() => {
    setMounted(true);
    fetchData();

    const channel = supabase
      .channel('dispatch_board_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'Bookings' }, (payload) => {
        const newBooking = payload.new;
        if (!['STANDARD_WALK_IN', 'VIP_WALK_IN', 'STANDARD_MENU', 'VIP_MENU'].includes(newBooking?.source)) return;
        
        console.log("🔔 [Dispatch] New Booking detected!", newBooking.id);
        
        // NotificationProvider will handle the sound via StaffNotifications trigger
        // Always refetch on INSERT to get related BookingItems & mapping
        fetchData();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'Bookings' }, (payload: any) => {
        console.log("🔄 [Dispatch] Booking updated:", payload.new.id, payload.new.status);
        
        // 🚀 STATE PATCHING: Update status locally before refetching
        setOrders(prev => prev.map(o => {
          if (o.id === payload.new.id) {
             const newStatus = payload.new.status;
             const isOpenStatus = ['NEW', 'WAITING', 'READY', 'PREPARING'].includes(newStatus);
             // Chỉ fallback về pending cho đơn chưa thực sự bước vào flow phục vụ.
             const mappedStatus = !o.hasAssignedKtv && isOpenStatus
                ? 'pending'
                : (isOpenStatus ? 'PREPARING' : (newStatus === 'CANCELLED' ? 'DONE' : newStatus));
             return { ...o, rawStatus: newStatus, dispatchStatus: mappedStatus };
          }
          return o;
        }));

        // 🛡️ Skip full refetch if admin is editing — status already patched above
        if (selectedOrderIdRef.current) {
          needsRefreshRef.current = true;
          console.log('🛡️ [Dispatch] Status patched locally — deferring full fetchData until form closes');
          return;
        }
        fetchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'TurnQueue' }, (payload: any) => {
        console.log("🔄 [Dispatch] TurnQueue change:", payload.eventType);
        
        // 🚀 STATE PATCHING: Update turns list locally
        if (payload.eventType === 'UPDATE') {
          setTurns(prev => prev.map(t => t.employee_id === payload.new.employee_id ? { ...t, ...payload.new } : t));
        } else if (payload.eventType === 'DELETE') {
          setTurns(prev => prev.filter(t => t.id !== payload.old.id));
        } else {
          // INSERT: full sync — defer if editing
          if (selectedOrderIdRef.current) {
            needsRefreshRef.current = true;
          } else {
            fetchData();
          }
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'StaffNotifications' }, (payload) => {
        console.log("📡 [Dispatch] New StaffNotification", payload.new.type);
        if (selectedOrderIdRef.current) {
          needsRefreshRef.current = true;
          return;
        }
        fetchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'BookingItems' }, (payload) => {
        const newItem = payload.new as any;
        console.log("🔄 [Dispatch] BookingItem changed:", newItem?.id, newItem?.status);
        // 🚀 Granular patch: Always update service status in local state (even when editing)
        if (newItem?.bookingId && newItem?.status) {
          setOrders(prev => prev.map(o => {
            if (o.id === newItem.bookingId) {
              const updatedServices = o.services.map((svc: any) =>
                svc.id === newItem.id ? { ...svc, status: newItem.status } : svc
              );
              return { ...o, services: updatedServices };
            }
            return o;
          }));
        }
        if (selectedOrderIdRef.current) {
          needsRefreshRef.current = true;
          return;
        }
        fetchData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedDate]); // REMOVED soundEnabled from deps

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

  async function fetchData() {
    setLoading(true);
    console.log("📡 [Dispatch] Fetching data for date:", selectedDate);
    try {
      const res = await getDispatchData(selectedDate);
      console.log("🔍 [Dispatch] getDispatchData response:", {
        success: res.success,
        bookingsCount: res.data?.bookings?.length,
        firstBooking: res.data?.bookings?.[0]?.billCode,
        firstItem: res.data?.bookings?.[0]?.BookingItems?.[0]
      });
      
      if (!res.success || !res.data) {
        console.error("❌ [Dispatch] Server Action error:", JSON.stringify(res, null, 2));
        setLoading(false);
        return;
      }

      const { staffs: sData, turns: tData, bookings: bData } = res.data;

      // 1. Set Staffs
      if (sData) {
        setStaffs(sData as unknown as StaffData[]);
      }

      // 2. Set Turns
      if (tData && sData) {
        const merged = (tData as TurnQueueData[]).map((t: TurnQueueData) => ({
          ...t,
          staff: (sData as unknown as StaffData[]).find(s => s.id === t.employee_id)
        }));
        setTurns(merged);
      }

      // 3. Set Rooms & Beds & Reminders
      const rData = res.data.rooms || [];
      const bdData = res.data.beds || [];
      const rmData = res.data.reminders || [];
      setRooms(rData);
      setBeds(bdData);
      setReminders(rmData);
      if (res.data.allServices) setAllServices(res.data.allServices);
      if (res.data.roomTransitionTime !== undefined) setRoomTransitionTime(res.data.roomTransitionTime);
      console.log(`✅ [Dispatch] Loaded ${rData.length} rooms, ${bdData.length} beds, ${rmData.length} reminders. Transition: ${res.data.roomTransitionTime}m`);

        // 4. Set Bookings
      if (bData) {
        const mappedOrders: PendingOrder[] = (bData as any[]).filter(b => b.status !== 'CANCELLED').map(b => {
          // Tìm tất cả KTV đang được gán cho đơn này trong TurnQueue
          const assignedTurns = tData?.filter((t: any) => t.current_order_id === b.id) || [];
          const hasAssignedKtv = assignedTurns.length > 0;

          let dStatus: DispatchStatus = 'pending';
          if (b.status === 'PREPARING') dStatus = 'PREPARING';
          else if (b.status === 'IN_PROGRESS') dStatus = 'IN_PROGRESS';
          else if (b.status === 'CLEANING') dStatus = 'CLEANING';
          else if (b.status === 'FEEDBACK') dStatus = 'FEEDBACK';
          else if (b.status === 'DONE' || b.status === 'CANCELLED') dStatus = 'DONE';
          else if (hasAssignedKtv) dStatus = 'PREPARING'; // Fallback for transition state
          
            const calculatedRating = b.rating || (b.BookingItems || []).find((i: any) => i.itemRating != null)?.itemRating || null;
            
            return {
              id: b.id,
              billCode: b.billCode || 'N/A',
              customerName: b.customerName || 'Khách vãng lai',
              customerLang: b.customerLang || 'vi',
              phone: b.customerPhone || '',
              time: b.timeBooking || (b.createdAt ? new Date(b.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'),
              dispatchStatus: dStatus,
              createdAt: b.createdAt || new Date().toISOString(),
              updatedAt: b.updatedAt,
              totalAmount: b.totalAmount || 0,
              paymentMethod: b.paymentMethod || 'Chưa rõ',
              rawStatus: b.status,
              hasAssignedKtv,
              accessToken: b.accessToken || null,
              rating: calculatedRating,
              feedbackNote: b.feedbackNote || null,
            timeStart: b.timeStart || null,
            customerLang: b.customerLang,
            rawNotes: b.notes,
            services: (b.BookingItems || []).map((bi: any) => {
              const itemTurns = assignedTurns.filter((t: any) => {
                  if (!t.booking_item_id) return false;
                  if (typeof t.booking_item_id === 'string') return t.booking_item_id.includes(bi.id);
                  return t.booking_item_id === bi.id;
              });
              const finalItemTurns = (itemTurns.length === 0 && (b.BookingItems || []).length === 1) ? assignedTurns : itemTurns;

              let parsedSegments: any[] = [];
              try {
                  parsedSegments = typeof bi.segments === 'string' ? JSON.parse(bi.segments) : (Array.isArray(bi.segments) ? bi.segments : []);
              } catch(e) { parsedSegments = []; }

              const parsedOptions = typeof bi.options === 'string' ? JSON.parse(bi.options) : (bi.options || {});

              let parsedNotes: any = null;
              let finalAdminNote = '';
              if (b.notes) {
                  if (typeof b.notes === 'string' && b.notes.trim().startsWith('{')) {
                      try { parsedNotes = JSON.parse(b.notes); } catch(e) {}
                  } else if (typeof b.notes === 'object') {
                      parsedNotes = b.notes;
                  } else {
                      finalAdminNote = String(b.notes);
                  }
                  
                  if (parsedNotes) {
                      if (parsedNotes.type === 'VIP_APPOINTMENT') {
                          finalAdminNote = `Gói VIP (${parsedNotes.duration} phút).`;
                          if (parsedNotes.timeSlot) finalAdminNote += ` Giờ hẹn: ${parsedNotes.timeSlot}.`;
                          if (parsedNotes.confidence !== 'CONFIRMED') finalAdminNote += ` (Cần xác nhận).`;
                          if (parsedNotes.warnings && parsedNotes.warnings.length > 0) {
                              finalAdminNote += `\n⚠️ Cảnh báo: ${parsedNotes.warnings.join(', ')}`;
                          }
                      } else {
                          finalAdminNote = typeof b.notes === 'string' ? b.notes : JSON.stringify(b.notes);
                      }
                  }
              }

              const forcedStartTime = parsedOptions?.timeSlot || parsedNotes?.timeSlot;

              const techCodes: string[] = Array.isArray(bi.technicianCodes) ? bi.technicianCodes : (bi.technicianCodes ? [bi.technicianCodes] : []);
              let staffList: any[] = [];

              if (techCodes.length > 0) {
                  staffList = techCodes.map((tCode: string) => {
                      const staff = (sData as unknown as StaffData[])?.find((s: any) => s.id === tCode);
                      const turn = finalItemTurns.find((t: any) => t.employee_id === tCode);
                      
                      let segments: WorkSegment[] = parsedSegments.filter((s: any) => s.ktvId === tCode);
                      
                      if (segments.length === 0) {
                          const st = formatTime(turn?.start_time) || forcedStartTime || b.timeBooking || getCurrentTime();
                          // Chia đều duration cho từng KTV khi có nhiều KTV cùng 1 dịch vụ
                          const totalDur = parsedOptions?.vipDuration || bi.duration || 0;
                          const dur = techCodes.length > 1 ? Math.ceil(totalDur / techCodes.length) : totalDur;
                          segments = [{
                              id: `seg-${genId()}`,
                              roomId: turn?.room_id || bi.roomName || b.roomName,
                              bedId: turn?.bed_id || bi.bedId || b.bedId,
                              startTime: st,
                              duration: dur,
                              endTime: formatTime(turn?.estimated_end_time) || calcEndTime(st, dur)
                          }];
                      }

                      return {
                        id: `st-${bi.id}-${tCode}`,
                        ktvId: tCode,
                        ktvName: staff?.full_name || tCode,
                        segments: segments,
                        noteForKtv: bi.options?.notesForKtvs?.[tCode] || bi.options?.noteForKtv || ''
                      };
                  });
              } else if (finalItemTurns.length > 0) {
                  staffList = finalItemTurns.map((t: any) => {
                      const staff = (sData as unknown as StaffData[])?.find((s: any) => s.id === t.employee_id);
                      let segments: WorkSegment[] = parsedSegments.filter((s: any) => s.ktvId === t.employee_id);
                      
                      if (segments.length === 0) {
                          const st = formatTime(t.start_time) || forcedStartTime || b.timeBooking || getCurrentTime();
                          const dur = parsedOptions?.vipDuration || bi.duration || 0;
                          segments = [{
                              id: `seg-${genId()}`,
                              roomId: t.room_id || bi.roomName || b.roomName,
                              bedId: t.bed_id || bi.bedId || b.bedId,
                              startTime: st,
                              duration: dur,
                              endTime: formatTime(t.estimated_end_time) || calcEndTime(st, dur)
                          }];
                      }

                      return {
                        id: `st-${bi.id}-${t.employee_id}`,
                        ktvId: t.employee_id,
                        ktvName: staff?.full_name || 'KTV',
                        segments: segments,
                        noteForKtv: bi.options?.notesForKtvs?.[t.employee_id] || bi.options?.noteForKtv || ''
                      };
                  });
              } else {
                  // Chưa có KTV gán — ưu tiên dùng segments từ DB (VD: từ splitBookingItem)
                  const dbSeg = parsedSegments.length > 0 ? parsedSegments[0] : null;
                  const fallbackStart = dbSeg?.startTime || forcedStartTime || getCurrentTime();
                  const fallbackDur = dbSeg?.duration || parsedOptions?.vipDuration || Number(bi.duration) || 0;
                  staffList = [{
                      id: `st-${bi.id}`,
                      ktvId: '',
                      ktvName: '',
                      segments: [{
                          id: dbSeg?.id || `seg-${genId()}`,
                          roomId: dbSeg?.roomId || null,
                          bedId: dbSeg?.bedId || null,
                          startTime: fallbackStart,
                          duration: fallbackDur,
                          endTime: dbSeg?.endTime || calcEndTime(fallbackStart, fallbackDur)
                      }],
                      noteForKtv: ''
                  }];
              }



              return {
                id: bi.id,
                serviceId: bi.serviceId,
                serviceName: bi.serviceName || bi.service_name || 'Dịch vụ',
                serviceDescription: bi.serviceDescription || bi.service_description || '',
                duration: parsedOptions?.vipDuration || Number(bi.duration) || 0,
                selectedRoomId: bi.roomName || b.roomName || null,
                bedId: bi.bedId || b.bedId || null,
                staffList: staffList,
                adminNote: finalAdminNote,
                genderReq: parsedOptions?.therapist || 'Ngẫu nhiên',
                strength: parsedOptions?.strength || '',
                focus: Array.isArray(parsedOptions?.focus) ? parsedOptions.focus.join(', ') : (parsedOptions?.focus || b.focusAreaNote || ''),
                avoid: Array.isArray(parsedOptions?.avoid) ? parsedOptions.avoid.join(', ') : (parsedOptions?.avoid || ''),
                customerNote: [
                  parsedOptions?.note,
                  Array.isArray(parsedOptions?.tags) && parsedOptions.tags.length > 0 ? `Yêu cầu đặc biệt: ${parsedOptions.tags.join(', ')}` : '',
                  b.focusAreaNote
                ].filter(Boolean).join(' | '),
                price: Number(bi.price) || 0,
                quantity: Number(bi.quantity) || 1,
                options: parsedOptions,
                status: bi.status || 'NEW',
                timeStart: bi.timeStart || null,
                timeEnd: bi.timeEnd || null
              };
            })
          };
        });

        setOrders(mappedOrders);
        console.log(`✅ [Dispatch] Fetched ${mappedOrders.length} bookings successfully:`, mappedOrders);
      }

    
    } catch (e) {
      console.error("❌ [Dispatch] Unexpected error in fetchData:", e);
    } finally {
      setLoading(false);
    }
  };

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

  const recalculateAllTimes = (order: PendingOrder, roomTransitionTime: number): PendingOrder => {
    const cloned = JSON.parse(JSON.stringify(order)) as PendingOrder;
    let ktvEndTimes: Record<string, { time: string, roomId: string }> = {};
    
    cloned.services.forEach(svc => {
      svc.staffList.forEach(r => {
        if (!r.ktvId || r.segments.length === 0) return;
        
        if (ktvEndTimes[r.ktvId]) {
          const last = ktvEndTimes[r.ktvId];
          const firstSeg = r.segments[0];
          const isSameRoom = last.roomId === firstSeg.roomId;
          const gap = 0; // Manager approved dropping room transition time between services
          
          const start = calcEndTime(last.time, gap);
          firstSeg.startTime = start;
          firstSeg.endTime = calcEndTime(start, firstSeg.duration);
          
          for(let i = 1; i < r.segments.length; i++) {
             const p = r.segments[i-1];
             const c = r.segments[i];
             const g = 0; // Manager approved dropping room transition time between segments
             c.startTime = calcEndTime(p.endTime, g);
             c.endTime = calcEndTime(c.startTime, c.duration);
          }
        }
        
        const lastSeg = r.segments[r.segments.length - 1];
        if (lastSeg && lastSeg.endTime) {
          ktvEndTimes[r.ktvId] = { time: lastSeg.endTime, roomId: lastSeg.roomId || '' };
        }
      });
    });
    
    return cloned;
  };

  const updateStaffRow = (orderId: string, svcId: string, rowId: string, patch: Partial<StaffAssignment>) => {
    updateOrder(orderId, o => {
      let updatedOrder = {
        ...o,
        services: o.services.map(s => s.id === svcId
          ? { ...s, staffList: s.staffList.map(r => r.id === rowId ? { ...r, ...patch } : r) }
          : s
        ),
      };

      // Tự động nối giờ nếu KTV được chọn và đã có phục vụ chặng trước đó
      if (patch.ktvId) {
        updatedOrder = recalculateAllTimes(updatedOrder, roomTransitionTime);
      }

      return updatedOrder;
    });
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
              if (parsed.type === 'VIP_APPOINTMENT') {
                  finalNotesToSave = clonedOrder.rawNotes; // Preserve VIP JSON
              } else {
                  parsed.receptionNote = primaryService?.adminNote;
                  finalNotesToSave = JSON.stringify(parsed);
              }
          } catch {
              finalNotesToSave = primaryService?.adminNote || '';
          }
      }

      const { saveDraftDispatch } = await import('./actions');
      const res = await saveDraftDispatch(clonedOrder.id, {
        technicianCode: combinedTechCodes,
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
  const handleDispatch = async (skipValidation: boolean = false, specificSvcId?: string, overrideOrderId?: string) => {
    const orderToDispatch = overrideOrderId ? orders.find(o => o.id === overrideOrderId) : selectedOrder;
    if (!orderToDispatch) return;
    if (!skipValidation) {
      // ⚠️ Khi dispatch lẻ (specificSvcId), chỉ validate DV đang dispatch, không check toàn bộ đơn
      const orderToValidate = specificSvcId 
        ? { ...orderToDispatch, services: orderToDispatch.services.filter(s => s.id === specificSvcId) }
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

      const targetServices = specificSvcId 
        ? clonedOrder.services.filter(s => s.id === specificSvcId) 
        : clonedOrder.services;

      for (const svc of targetServices) {
        for (const row of svc.staffList) {
          if (!row.ktvId) continue;
          
          const ktvId = row.ktvId;
          techCodesSet.add(ktvId); 

          const currentTurn = turns.find(t => t.employee_id === ktvId);
          if (!currentTurn) continue;

          let turnsCompleted = currentTurn.turns_completed;
          let queuePos = currentTurn.queue_position;

          if (currentTurn.current_order_id !== clonedOrder.id) {
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
      if (specificSvcId) {
        const otherServices = clonedOrder.services.filter(s => s.id !== specificSvcId);
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
              if (parsed.type === 'VIP_APPOINTMENT') {
                  finalNotesToSave = clonedOrder.rawNotes; // Preserve VIP JSON
              } else {
                  parsed.receptionNote = primaryService?.adminNote;
                  finalNotesToSave = JSON.stringify(parsed);
              }
          } catch {
              finalNotesToSave = primaryService?.adminNote || '';
          }
      }

      const isPartial = !!specificSvcId;
      // ⚠️ Khi dispatch: KHÔNG gửi status để tránh lỗi backward transition nếu đang IN_PROGRESS/CLEANING
      // Chỉ gửi PREPARING nếu trạng thái thực sự là NEW, pending, hoặc WAITING (chưa điều phối)
      const isPending = !clonedOrder.rawStatus || ['NEW', 'pending', 'WAITING'].includes(clonedOrder.rawStatus);
      const bookingStatus = isPartial ? null : (isPending ? 'PREPARING' : clonedOrder.rawStatus);
      
      const res = await processDispatch(clonedOrder.id, {
        status: bookingStatus as any,
        technicianCode: isPartial ? undefined : combinedTechCodes,
        bedId: isPartial ? undefined : (primarySeg?.bedId || null),
        roomName: isPartial ? undefined : (primarySeg?.roomId || null),
        staffAssignments: mergedAssignments,
        date: selectedDate,
        notes: isPartial ? undefined : finalNotesToSave,
        itemUpdates: itemUpdates
      });

      if (res.success) {
        if (!specificSvcId || targetServices.length === clonedOrder.services.length) {
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
                        if (s.id !== specificSvcId) return s;
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

  async function handleUpdateStatus(orderId: string, newStatus: string, itemIds?: string[], skipConfirm?: boolean, targetKtvIds?: string[]) {
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
                <span className="hidden lg:inline">Bảng Điều Phối Trung Tâm</span>
                <div className="hidden sm:flex items-center gap-1 ml-4 bg-gray-100/80 p-1 rounded-xl shadow-inner border border-gray-200">
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
                </div>
              </h1>
              
              {/* Mobile Mode Switcher */}
              <div className="flex sm:hidden items-center gap-1 bg-gray-100/80 p-1 rounded-xl shadow-inner border border-gray-200 w-full mb-1">
                <button
                  onClick={() => setActiveMode('DISPATCH')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    activeMode === 'DISPATCH'
                      ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <LayoutList size={14} /> Điều Phối
                </button>
                <button
                  onClick={() => setActiveMode('MONITOR')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    activeMode === 'MONITOR'
                      ? 'bg-white text-indigo-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Columns3 size={14} /> Giám Sát Đơn
                </button>
              </div>

              <p className="text-[10px] lg:text-xs text-gray-500 mt-1 font-medium hidden sm:block">{activeMode === 'DISPATCH' ? 'Điều phối KTV & Phòng chuyên nghiệp' : 'Theo dõi tiến trình phục vụ đơn hàng'}</p>
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
                      <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg tracking-wider">
                        #{order.billCode} {subOrder.services.length < order.services.length && '(Tách)'}
                      </span>
                      <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1.5"><Clock size={12} className="text-gray-300" /> {getEstimatedEndTime(order, subOrder.services) || order.time}</span>
                    </div>
                    <div className="flex justify-between items-baseline gap-2">
                      <p className="font-black text-gray-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight truncate">{order.customerName}</p>
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
                    <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                    <h2 className="font-black text-gray-900 text-base truncate">Đơn {selectedSubOrder.originalOrder.billCode} — {selectedSubOrder.originalOrder.customerName}</h2>
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
                    onUpdateServices={(updatedServices) => {
                      updateOrder(selectedSubOrder.bookingId, o => {
                          const mergedServices = o.services.map(origSvc => {
                              const found = updatedServices.find(u => u.id === origSvc.id);
                              return found ? found : origSvc;
                          });
                          return { ...o, services: mergedServices };
                      });
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
                    values={selectedSubOrder.services}
                    onReorder={(newServices) => {
                      const recalculated = recalculateAllTimes({ ...selectedSubOrder.originalOrder, services: newServices }, roomTransitionTime);
                      updateOrder(selectedSubOrder.bookingId, o => {
                          const nonSubOrderServices = o.services.filter(s => !newServices.some(ns => ns.id === s.id));
                          return { ...o, services: [...nonSubOrderServices, ...recalculated.services.filter(s => newServices.some(ns => ns.id === s.id))] };
                      });
                    }}
                    className="space-y-6"
                  >
                    {selectedSubOrder.services.map((svc, idx) => {
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
                            svc={svc}
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
                            onDispatchSvc={(oId, svcId) => handleDispatch(false, svcId)}
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
                  <button
                    onClick={() => setShowDispatchConfirmModal(true)}
                    disabled={!isDispatchReady(selectedSubOrder.originalOrder)}
                    className={`flex-[2] py-5 rounded-3xl font-black text-sm lg:text-base tracking-widest uppercase transition-all flex items-center justify-center gap-3 shadow-2xl ${isDispatchReady(selectedSubOrder.originalOrder)
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 active:scale-95'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                      }`}
                  >
                    <Send size={20} strokeWidth={3} /> XÁC NHẬN ĐIỀU PHỐI
                  </button>
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
          ) : (
            <KanbanBoard 
              orders={orders} 
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
            />
          )}

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
                  <button
                    onClick={() => handleUpdateStatus(contextMenu.orderId, 'CLEANING')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-purple-600 hover:bg-purple-50 rounded-xl transition-colors font-black text-xs uppercase tracking-wider border-b border-gray-50 mb-1 text-left"
                  >
                    <CheckCircle2 size={18} className="shrink-0" />
                    Hết giờ → Bắt đầu dọn phòng
                  </button>
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

      <AddOrderModal
        isOpen={showAddOrderModal}
        onClose={() => setShowAddOrderModal(false)}
        services={allServices}
        onConfirm={handleCreateQuickBooking}
        selectedDate={selectedDate}
      />

      {/* Split Service Modal */}
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
    </AppLayout>
  );
}
