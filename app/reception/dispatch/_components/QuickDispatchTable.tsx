'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Printer, X, ChevronDown, ChevronUp, Plus, Clock, AlertCircle, CheckCircle2, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ReminderData, ServiceBlock, StaffData, TurnQueueData, WorkSegment } from '../types';

// 🛠 UI CONFIGURATION
const TAG_COLORS = ['bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700'];

interface Room { id: string; name: string; type: string; default_reminders?: string[]; }
interface Bed { id: string; roomId: string; }

interface ServiceGroup {
  serviceName: string;
  items: ServiceBlock[];
  displayName: string;
  selectedKtvIds: string[];
  selectedRoomIds: string[];
  ktvStartTimes: string[];
  ktvEndTimes: string[];
  ktvNotes: string[];
  note: string;
  duration: number;
}

interface QuickDispatchTableProps {
  services: ServiceBlock[];
  orderId: string;
  rooms: Room[];
  beds: Bed[];
  availableTurns: (TurnQueueData & { staff?: StaffData })[];
  busyBedIds: string[];
  onUpdateServices: (updatedServices: ServiceBlock[]) => void;
  onPrintGroup: (group: ServiceGroup) => void;
  customerReqs?: { genderReq?: string; strength?: string; focus?: string; avoid?: string; customerNote?: string; };
  reminders?: ReminderData[];
  billCode?: string;
  customerName?: string;
  isVipSource?: boolean;
  onDispatchGroup?: (group: ServiceGroup, specificSvcId?: string) => void;
  onTriggerMergePrompt?: (sourceSvcId: string, targetSvcId: string, ktvId: string, onConfirm: () => void, onCancel: () => void) => void;
}

const SERVICE_TO_SKILL: Record<string, string> = {
  'Gội đầu': 'shampoo', 'Massage Thái': 'thaiBody', 'Massage Dầu': 'oilBody',
  'Đá Nóng': 'hotStoneBody', 'Massage Body': 'thaiBody', 'Foot Dầu': 'foot',
  'Ráy Combo': 'earCombo', 'Ráy Chuyên': 'earChuyen', 'Chăm sóc da': 'facial',
  'Tinh dầu': 'oilBody', 'Chăm sóc': 'thaiBody', 'Massage Chân': 'foot', 'Foot': 'foot',
};

const calcEndTime = (start: string, duration: number): string => {
  if (!start || !duration) return '';
  const [h, m] = start.split(':').map(Number);
  const d = new Date(); d.setHours(h, m + duration, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Format "15:19:00" → "15:19"
const fmtTime = (t?: string | null) => t ? t.replace(/^(\d{1,2}:\d{2})(:\d{2})?$/, '$1') : '--:--';

const getCurrentTime = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
};

const genId = () => Math.random().toString(36).substring(2, 9);

export const QuickDispatchTable = ({
  services, orderId, rooms, beds, availableTurns, busyBedIds, isVipSource = false,
  onUpdateServices, onPrintGroup, customerReqs, reminders = [], onDispatchGroup, onTriggerMergePrompt
}: QuickDispatchTableProps) => {

  const isVipOrder = useMemo(() => {
    return services.some(s => s.serviceId && (s.serviceId.toUpperCase().startsWith('NHP') || s.serviceId.toUpperCase().startsWith('VIP_')));
  }, [services]);

  const isInitializedRef = useRef(false);
  // Fingerprint to detect services changes (e.g. after switching from detail mode)
  const servicesFingerprintRef = useRef('');

  // Group services by serviceName + duration
  const initialGroups = useMemo(() => {
    const map = new Map<string, ServiceBlock[]>();
    services.filter(s => !s.mergedIntoId).forEach(svc => {
      // Utilities (like Phòng Riêng) are still grouped but have isUtility flag
      const isUtil = !!(svc as any).isUtility;
      const key = `${svc.serviceName}_${svc.duration}${isUtil ? '_utility' : ''}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(svc);
    });
    return map;
  }, [services]);

  // State per group (includes per-KTV times, rooms, durations)
  type GroupState = {
    displayName: string;
    selectedKtvIds: string[]; selectedRoomIds: string[];
    ktvStartTimes: string[]; ktvEndTimes: string[];
    ktvDurations: number[]; ktvNotes: string[]; ktvBedIds: string[];
    note: string; duration: number;
    isUtility?: boolean;
  };
  const [groupStates, setGroupStates] = useState<Map<string, GroupState>>(new Map());

  // Build fingerprint from current services data
  const buildFingerprint = (svcs: ServiceBlock[]) =>
    svcs.map(s => `${s.id}|${s.mergedIntoId || ''}|${s.staffList?.map(st => `${st.ktvId}:${st.segments?.[0]?.roomId || ''}:${st.segments?.[0]?.startTime || ''}:${st.segments?.[0]?.duration || ''}`).join(',')}`).join(';');

  // Initialize / re-initialize group states when services change
  useEffect(() => {
    const fp = buildFingerprint(services);
    if (fp === servicesFingerprintRef.current) return;
    servicesFingerprintRef.current = fp;

    const defaultTime = getCurrentTime();
    const newStates = new Map<string, GroupState>();
    initialGroups.forEach((items, groupKey) => {
      const duration = items[0]?.duration || 0;
      // Collect all KTVs across all items (including multi-staff per item)
      const ktvIds: string[] = [];
      const roomIds: string[] = [];
      const startTimes: string[] = [];
      const endTimes: string[] = [];
      const ktvDurationsList: number[] = [];
      const ktvNotesList: string[] = [];
      const bedIdsList: string[] = [];
      items.forEach(item => {
        if (item.staffList.length > 0) {
          item.staffList.forEach(staff => {
            if (staff.ktvId) {
              ktvIds.push(staff.ktvId);
              roomIds.push(staff.segments?.[0]?.roomId || '');
              startTimes.push(staff.segments?.[0]?.startTime || defaultTime);
              endTimes.push(staff.segments?.[0]?.endTime || calcEndTime(staff.segments?.[0]?.startTime || defaultTime, duration));
              ktvDurationsList.push(staff.segments?.[0]?.duration || duration);
              ktvNotesList.push(staff.noteForKtv || '');
              bedIdsList.push(staff.segments?.[0]?.bedId || '');
            }
          });
        }
      });
      if (ktvIds.length === 0) {
        startTimes.push(defaultTime);
        endTimes.push(calcEndTime(defaultTime, duration));
      }
      newStates.set(groupKey, {
        displayName: items[0]?.options?.displayName || '',
        selectedKtvIds: ktvIds,
        selectedRoomIds: roomIds,
        ktvStartTimes: startTimes,
        ktvEndTimes: endTimes,
        ktvDurations: ktvDurationsList.length > 0 ? ktvDurationsList : [duration],
        ktvNotes: ktvNotesList,
        ktvBedIds: bedIdsList,
        note: items[0]?.staffList?.[0]?.noteForKtv || '',
        duration,
        isUtility: !!(items[0] as any).isUtility,
      });
    });
    if (newStates.size > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGroupStates(newStates);
    }
  }, [initialGroups, services]);

  // All selected KTV IDs across all groups
  const allSelectedKtvIds = useMemo(() => {
    const ids: string[] = [];
    groupStates.forEach(g => ids.push(...g.selectedKtvIds));
    return ids;
  }, [groupStates]);

  // Auto-assign first available bed in a room (avoiding duplicates)
  const getAvailableBedInRoom = (roomId: string, excludeBedIds: string[]): string | null => {
    const allExcluded = [...busyBedIds, ...excludeBedIds];
    const roomBeds = beds.filter(b => b.roomId === roomId);
    for (const bed of roomBeds) {
      if (!allExcluded.includes(bed.id)) return bed.id;
    }
    return null;
  };

  // Sync group states back to parent services
  const syncToServices = (nextStates: Map<string, GroupState>) => {
    const updatedServices = [...services];
    const globalUsedBedIds: string[] = [];

    nextStates.forEach((state, groupKey) => {
      const items = initialGroups.get(groupKey);
      if (!items) return;
      const ktvCount = state.selectedKtvIds.length;
      const itemCount = items.length;

      if (ktvCount <= itemCount) {
        // Normal: 1 KTV per service item
        items.forEach((item, idx) => {
          const svcIdx = updatedServices.findIndex(s => s.id === item.id);
          if (svcIdx === -1) return;
          const ktvId = state.selectedKtvIds[idx] || '';
          const ktvTurn = availableTurns.find(t => t.employee_id === ktvId);
          const ktvName = ktvTurn?.staff?.full_name || ktvId;
          const roomId = state.selectedRoomIds?.[idx] || null;
          let bedId: string | null = null;
          if (roomId) { bedId = getAvailableBedInRoom(roomId, globalUsedBedIds); if (bedId) globalUsedBedIds.push(bedId); }
          const st = state.ktvStartTimes?.[idx] || getCurrentTime();
          const ktvDur = state.ktvDurations?.[idx] || item.duration;
          const segment: WorkSegment = {
            id: updatedServices[svcIdx].staffList?.[0]?.segments?.[0]?.id || `seg-${genId()}`,
            roomId, bedId, startTime: st, duration: ktvDur,
            endTime: state.ktvEndTimes?.[idx] || calcEndTime(st, ktvDur),
          };
          updatedServices[svcIdx] = {
            ...updatedServices[svcIdx],
            staffList: [{ id: updatedServices[svcIdx].staffList?.[0]?.id || `st-${item.id}-${ktvId}`, ktvId, ktvName, segments: [segment], noteForKtv: state.ktvNotes?.[idx] || state.note || '' }],
            options: { ...updatedServices[svcIdx].options, displayName: state.displayName || undefined },
          };
        });
      } else {
        // Multi-KTV per service: distribute KTVs across items, extras go as additional staffList entries
        items.forEach((item, itemIdx) => {
          const svcIdx = updatedServices.findIndex(s => s.id === item.id);
          if (svcIdx === -1) return;
          // Find which KTVs belong to this item
          const staffEntries: { ktvId: string; ktvName: string; roomId: string | null; bedId: string | null; startTime: string; endTime: string; duration: number; }[] = [];
          // Each item gets at least 1 KTV, extras distributed round-robin
          for (let ki = 0; ki < ktvCount; ki++) {
            if (ki % itemCount !== itemIdx) continue;
            const ktvId = state.selectedKtvIds[ki] || '';
            const ktvTurn = availableTurns.find(t => t.employee_id === ktvId);
            const ktvName = ktvTurn?.staff?.full_name || ktvId;
            const roomId = state.selectedRoomIds?.[ki] || null;
            let bedId: string | null = null;
            if (roomId) { bedId = getAvailableBedInRoom(roomId, globalUsedBedIds); if (bedId) globalUsedBedIds.push(bedId); }
            const st = state.ktvStartTimes?.[ki] || getCurrentTime();
            const kd = state.ktvDurations?.[ki] || item.duration;
            staffEntries.push({ ktvId, ktvName, roomId, bedId, startTime: st, endTime: state.ktvEndTimes?.[ki] || calcEndTime(st, kd), duration: kd });
          }
          updatedServices[svcIdx] = {
            ...updatedServices[svcIdx],
            staffList: staffEntries.map((e, si) => ({
              id: updatedServices[svcIdx].staffList?.[si]?.id || `st-${item.id}-${e.ktvId}`,
              ktvId: e.ktvId, ktvName: e.ktvName,
              segments: [{ id: updatedServices[svcIdx].staffList?.[si]?.segments?.[0]?.id || `seg-${genId()}`, roomId: e.roomId, bedId: e.bedId, startTime: e.startTime, duration: e.duration, endTime: e.endTime }],
              noteForKtv: state.ktvNotes?.[state.selectedKtvIds.indexOf(e.ktvId)] || state.note || '',
            })),
            options: { ...updatedServices[svcIdx].options, displayName: state.displayName || undefined },
          };
        });
      }
    });
    onUpdateServices(updatedServices);
  };

  // Track user-driven changes for deferred sync
  const pendingSyncRef = useRef(false);

  const updateGroup = (groupKey: string, patch: Partial<GroupState>) => {
    setGroupStates(prev => {
      const next = new Map(prev);
      const current = next.get(groupKey);
      if (!current) return prev;
      const updated = { ...current, ...patch };
      next.set(groupKey, updated);
      return next;
    });
    pendingSyncRef.current = true;
  };

  // Deferred sync â€” runs AFTER groupStates has settled (avoids setState-during-render)
  useEffect(() => {
    if (!pendingSyncRef.current) return;
    pendingSyncRef.current = false;
    // Update fingerprint to match what we're about to push to parent
    servicesFingerprintRef.current = '___pending___';
    syncToServices(groupStates);
  }, [groupStates]);

  const getLatestEndTime = (ktvId: string) => {
    let latestEndTime = '';
    groupStates.forEach(gState => {
      gState.selectedKtvIds.forEach((id, idx) => {
        if (id === ktvId) {
          const eT = (gState.ktvEndTimes || [])[idx];
          if (eT && eT > latestEndTime) latestEndTime = eT;
        }
      });
    });
    return latestEndTime;
  };

  return (
    <div className="space-y-5">
      {/* Customer Requirements Banner */}
      {customerReqs && (((!isVipOrder && !isVipSource && customerReqs.genderReq)) || customerReqs.strength || customerReqs.focus || customerReqs.avoid || customerReqs.customerNote) && (
        <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-3 space-y-2">
          <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">⚠️ Yêu Cầu Từ Khách</p>
          <div className="flex flex-wrap gap-1.5">
            {!isVipOrder && !isVipSource && customerReqs.genderReq && (
              <span className="px-2.5 py-1 rounded-xl text-[10px] font-black bg-purple-50 text-purple-700 border border-purple-100">🧑 {customerReqs.genderReq}</span>
            )}
            {customerReqs.strength && (
              <span className="px-2.5 py-1 rounded-xl text-[10px] font-black bg-orange-50 text-orange-700 border border-orange-100">💪 {customerReqs.strength}</span>
            )}
            {customerReqs.focus && (
              <span className="px-2.5 py-1 rounded-xl text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100">🎯 {customerReqs.focus}</span>
            )}
            {customerReqs.avoid && (
              <span className="px-2.5 py-1 rounded-xl text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-100">🚫 {customerReqs.avoid}</span>
            )}
          </div>
          {customerReqs.customerNote && (
            <p className="text-xs text-amber-800 bg-white/60 p-2 rounded-xl font-bold italic border border-amber-100">&quot;{customerReqs.customerNote}&quot;</p>
          )}
        </div>
      )}

      {/* Service Groups */}
      {Array.from(initialGroups.entries()).map(([groupKey, items]) => {
        const state = groupStates.get(groupKey);
        if (!state) return null;
        const count = items.length;
        const duration = items[0]?.duration || 0;
        const displayServiceName = items[0]?.serviceName || groupKey.split('_')[0];

        // Find matching skill for this service
        const targetSkill = Object.keys(SERVICE_TO_SKILL).find(k => displayServiceName.toLowerCase().includes(k.toLowerCase()))
          ? SERVICE_TO_SKILL[Object.keys(SERVICE_TO_SKILL).find(k => displayServiceName.toLowerCase().includes(k.toLowerCase()))!]
          : null;

        return (
          <ServiceGroupCard
            key={groupKey}
            serviceName={displayServiceName}
            serviceDescription={items[0]?.serviceDescription || ''}
            count={count}
            duration={duration}
            state={state}
            targetSkill={targetSkill}
            availableTurns={availableTurns}
            allSelectedKtvIds={allSelectedKtvIds}
            rooms={rooms}
            beds={beds}
            busyBedIds={busyBedIds}
            onUpdate={(patch) => updateGroup(groupKey, patch)}
            onPrint={() => onPrintGroup({ serviceName: displayServiceName, items, ...state })}
            onDispatch={(ktvIdx?: number) => {
              if (!onDispatchGroup) return;
              let specificSvcId: string | undefined = undefined;
              if (ktvIdx !== undefined && items.length > 0) {
                  specificSvcId = items[ktvIdx % items.length].id;
              }
              onDispatchGroup({ serviceName: displayServiceName, items, ...state }, specificSvcId);
            }}
            customerReqs={customerReqs}
            reminders={reminders}
            getLatestEndTime={getLatestEndTime}
            isVipOrder={isVipOrder}
            allServices={services}
            groupItems={items}
            onTriggerMergePrompt={onTriggerMergePrompt}
          />
        );
      })}
    </div>
  );
};


// --- Service Group Card ---

interface ServiceGroupCardProps {
  serviceName: string;
  serviceDescription?: string;
  count: number;
  duration: number;
  state: { displayName: string; selectedKtvIds: string[]; selectedRoomIds?: string[]; ktvStartTimes?: string[]; ktvEndTimes?: string[]; ktvDurations?: number[]; ktvNotes?: string[]; ktvBedIds?: string[]; note: string; duration: number; isUtility?: boolean; };
  targetSkill: string | null;
  availableTurns: (TurnQueueData & { staff?: StaffData })[];
  allSelectedKtvIds: string[];
  rooms: Room[];
  beds: Bed[];
  busyBedIds: string[];
  onUpdate: (patch: Record<string, unknown>) => void;
  onPrint: () => void;
  onDispatch?: (ktvIdx?: number) => void;
  customerReqs?: { genderReq?: string; strength?: string; focus?: string; avoid?: string; customerNote?: string; };
  reminders?: { id: string; content: string }[];
  getLatestEndTime: (ktvId: string) => string;
  isVipOrder?: boolean;
  allServices: ServiceBlock[];
  groupItems: ServiceBlock[];
  onTriggerMergePrompt?: (sourceSvcId: string, targetSvcId: string, ktvId: string, onConfirm: () => void, onCancel: () => void) => void;
}

const MAX_KTV_PER_GROUP = 10;

const ServiceGroupCard = ({
  serviceName, serviceDescription, count, duration, state, targetSkill,
  availableTurns, allSelectedKtvIds, rooms, beds, busyBedIds, onUpdate, onPrint, onDispatch, customerReqs, reminders = [], getLatestEndTime, isVipOrder = false,
  allServices, groupItems, onTriggerMergePrompt
}: ServiceGroupCardProps) => {
  const [isKtvDropdownOpen, setIsKtvDropdownOpen] = useState(false);
  const [ktvSearch, setKtvSearch] = useState('');
  const [showTicketForIdx, setShowTicketForIdx] = useState<number | null>(null);
  const [openDurationIdx, setOpenDurationIdx] = useState<number | null>(null);
  const [showRemindersIdx, setShowRemindersIdx] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const reminderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) { setIsKtvDropdownOpen(false); setKtvSearch(''); }
      if (reminderRef.current && !reminderRef.current.contains(e.target as Node)) { setShowRemindersIdx(null); }
    };
    if (isKtvDropdownOpen || showRemindersIdx !== null) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isKtvDropdownOpen, showRemindersIdx]);

  const removeKtv = (ktvId: string) => {
    const idx = state.selectedKtvIds.indexOf(ktvId);
    const newRoomIds = [...(state.selectedRoomIds || [])];
    const newStarts = [...(state.ktvStartTimes || [])];
    const newEnds = [...(state.ktvEndTimes || [])];
    const newDurs = [...(state.ktvDurations || [])];
    const newNotes = [...(state.ktvNotes || [])];
    const newBeds = [...(state.ktvBedIds || [])];
    if (idx >= 0) { newRoomIds.splice(idx, 1); newStarts.splice(idx, 1); newEnds.splice(idx, 1); newDurs.splice(idx, 1); newNotes.splice(idx, 1); newBeds.splice(idx, 1); }
    onUpdate({ selectedKtvIds: state.selectedKtvIds.filter(id => id !== ktvId), selectedRoomIds: newRoomIds, ktvStartTimes: newStarts, ktvEndTimes: newEnds, ktvDurations: newDurs, ktvNotes: newNotes, ktvBedIds: newBeds });
  };

  const moveKtv = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= state.selectedKtvIds.length) return;
    const swap = <T,>(arr: T[] | undefined): T[] => {
      if (!arr) return [];
      const copy = [...arr];
      [copy[fromIdx], copy[toIdx]] = [copy[toIdx], copy[fromIdx]];
      return copy;
    };
    onUpdate({
      selectedKtvIds: swap(state.selectedKtvIds),
      selectedRoomIds: swap(state.selectedRoomIds),
      ktvStartTimes: swap(state.ktvStartTimes),
      ktvEndTimes: swap(state.ktvEndTimes),
      ktvDurations: swap(state.ktvDurations as number[]),
      ktvNotes: swap(state.ktvNotes),
      ktvBedIds: swap(state.ktvBedIds),
    });
  };

  const addKtv = (ktvId: string) => {
    if (state.selectedKtvIds.length >= MAX_KTV_PER_GROUP) return;

    const proceedAdd = () => {
      // Tính thời gian kết thúc trễ nhất của KTV này ở các dịch vụ khác trong cùng đơn
      const latestEndTime = getLatestEndTime(ktvId);

      const defaultStart = latestEndTime || (state.ktvStartTimes || [])[0] || getCurrentTime();
      const defaultEnd = calcEndTime(defaultStart, duration);
      
      onUpdate({ selectedKtvIds: [...state.selectedKtvIds, ktvId], ktvStartTimes: [...(state.ktvStartTimes || []), defaultStart], ktvEndTimes: [...(state.ktvEndTimes || []), defaultEnd], ktvDurations: [...(state.ktvDurations || []), duration], ktvNotes: [...(state.ktvNotes || []), ''], ktvBedIds: [...(state.ktvBedIds || []), ''] });
      setKtvSearch('');
    };

    const conflictSvc = allServices.find(s => 
      !groupItems.some(i => i.id === s.id) && 
      !s.mergedIntoId && 
      s.staffList.some(r => r.ktvId === ktvId)
    );

    if (conflictSvc && onTriggerMergePrompt && groupItems.length > 0) {
       onTriggerMergePrompt(
          conflictSvc.id,
          groupItems[0].id,
          ktvId,
          () => {
             // onConfirm
             setKtvSearch('');
          },
          () => {
             // onCancel
             proceedAdd();
          }
       );
       return;
    }

    proceedAdd();
  };

  const updateRoomForIdx = (idx: number, roomId: string) => {
    const nextRoomIds = [...(state.selectedRoomIds || [])];
    while (nextRoomIds.length <= idx) nextRoomIds.push('');
    nextRoomIds[idx] = roomId;

    const nextBedIds = [...(state.ktvBedIds || [])];
    while (nextBedIds.length <= idx) nextBedIds.push('');

    const nextNotes = [...(state.ktvNotes || [])];
    while (nextNotes.length <= idx) nextNotes.push('');

    if (roomId) {
      const usedBeds = nextBedIds.filter((_, i) => i !== idx).filter(Boolean);
      const roomBeds = beds.filter(b => b.roomId === roomId);
      const allExcluded = [...busyBedIds, ...usedBeds];
      const freeBed = roomBeds.find(b => !allExcluded.includes(b.id));
      nextBedIds[idx] = freeBed?.id || '';

      // 🧠 AUTO-REMINDERS
      const roomData = (rooms as any[]).find(r => r.id === roomId);
      if (roomData && roomData.default_reminders && Array.isArray(roomData.default_reminders)) {
        const defaultReminders = reminders
          .filter(rm => roomData.default_reminders.includes(rm.id))
          .map(rm => rm.content);
        
        if (defaultReminders.length > 0) {
          const currentNote = nextNotes[idx] || '';
          const reminderStr = defaultReminders.join(' - ');
          if (!currentNote.includes(reminderStr)) {
            nextNotes[idx] = currentNote ? `${currentNote} - ${reminderStr}` : reminderStr;
          }
        }
      }
    } else {
      nextBedIds[idx] = '';
    }

    onUpdate({ 
      selectedRoomIds: nextRoomIds, 
      ktvBedIds: nextBedIds, 
      ktvNotes: nextNotes 
    });
  };

  const updateNoteForIdx = (idx: number, note: string) => {
    const arr = [...(state.ktvNotes || [])]; while (arr.length <= idx) arr.push(''); arr[idx] = note; onUpdate({ ktvNotes: arr });
  };

  // Duration presets — không giới hạn theo duration dịch vụ, cho phép chọn linh hoạt
  const DURATION_PRESETS = [30, 45, 60, 70, 90, 120, 180, 200, 240, 300];

  const isSequentialMode = state.selectedKtvIds.length > count;

  const updateDurationForIdx = (idx: number, newDur: number) => {
    const durations = [...(state.ktvDurations || state.selectedKtvIds.map(() => duration))];
    const starts = [...(state.ktvStartTimes || [])];
    const ends = [...(state.ktvEndTimes || [])];
    while (durations.length <= idx) durations.push(duration);
    while (starts.length <= idx) starts.push(getCurrentTime());
    while (ends.length <= idx) ends.push('');

    durations[idx] = newDur;
    ends[idx] = calcEndTime(starts[idx], newDur);

    // Chain subsequent KTVs: each starts where previous ends (giữ nguyên duration riêng)
    for (let i = idx + 1; i < state.selectedKtvIds.length; i++) {
      while (durations.length <= i) durations.push(duration);
      while (starts.length <= i) starts.push('');
      while (ends.length <= i) ends.push('');
      starts[i] = ends[i - 1];
      ends[i] = calcEndTime(starts[i], durations[i]);
    }
    onUpdate({ ktvDurations: durations, ktvStartTimes: starts, ktvEndTimes: ends });
  };

  const updateTimeForIdx = (idx: number, field: 'start' | 'end', value: string) => {
    if (field === 'start') {
      const s = [...(state.ktvStartTimes || [])]; const e = [...(state.ktvEndTimes || [])];
      const d = [...(state.ktvDurations || state.selectedKtvIds.map(() => duration))];
      while (s.length <= idx) s.push(getCurrentTime()); while (e.length <= idx) e.push('');
      while (d.length <= idx) d.push(duration);
      s[idx] = value; e[idx] = calcEndTime(value, d[idx]);
      // Chain next KTVs
      for (let i = idx + 1; i < state.selectedKtvIds.length; i++) {
        while (s.length <= i) s.push(''); while (e.length <= i) e.push('');
        while (d.length <= i) d.push(duration);
        s[i] = e[i - 1];
        e[i] = calcEndTime(s[i], d[i]);
      }
      onUpdate({ ktvStartTimes: s, ktvEndTimes: e, ktvDurations: d });
    } else {
      const e = [...(state.ktvEndTimes || [])]; while (e.length <= idx) e.push(''); e[idx] = value; onUpdate({ ktvEndTimes: e });
    }
  };

  const filteredTurns = useMemo(() => {
    const filtered = availableTurns.filter(t => t.status !== 'off').filter(t => !state.selectedKtvIds.includes(t.employee_id)).filter(t => {
      if (!ktvSearch) return true; const term = ktvSearch.toLowerCase();
      return t.employee_id.toLowerCase().includes(term) || (t.staff?.full_name || '').toLowerCase().includes(term);
    });

    return filtered.sort((a, b) => {
        if (a.turns_completed !== b.turns_completed) return (a.turns_completed || 0) - (b.turns_completed || 0);
        return (a.check_in_order || 0) - (b.check_in_order || 0);
    });
  }, [availableTurns, state.selectedKtvIds, ktvSearch]);

  const dateFormatted = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const getBadgeBg = (i: number) => ['bg-indigo-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500'][i % 5];

  return (<>
    <div className="border border-gray-100 rounded-3xl overflow-visible bg-white shadow-sm hover:shadow-md transition-all">
      <div className="bg-gray-50/80 px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2 rounded-t-3xl">
        <div className="flex items-center gap-2">
          {state.isUtility && <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-lg border border-amber-200">[Tiện ích]</span>}
          <h3 className={`font-black text-sm ${state.isUtility ? 'text-amber-700 italic' : 'text-gray-900'}`}>{serviceName}</h3>
          <span className="bg-indigo-600 text-white text-[10px] font-black px-2.5 py-1 rounded-xl">x{count}</span>
          {(!state.isUtility) && <span className="text-xs text-gray-400 font-bold">{duration}p</span>}
          {state.selectedKtvIds.length > count && <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-lg border border-amber-200">+{state.selectedKtvIds.length - count} nối tiếp</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-bold shrink-0">Tên in phiếu:</span>
          <input type="text" value={state.displayName} onChange={e => onUpdate({ displayName: e.target.value })} placeholder={serviceName}
            className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold w-40 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none bg-white" />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!state.isUtility && (
        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Nhân viên ({state.selectedKtvIds.length})</label>
          <div className="relative" ref={dropdownRef}>
            <div className="min-h-[44px] w-full px-3 py-2 border-2 border-gray-100 rounded-2xl bg-gray-50/30 flex flex-wrap gap-1.5 items-center cursor-text" onClick={() => setIsKtvDropdownOpen(true)}>
              {state.selectedKtvIds.map((ktvId, idx) => { const t = availableTurns.find(t => t.employee_id === ktvId); const n = ktvId; return (
                <span key={`${ktvId}-${idx}`} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-black ${TAG_COLORS[idx % TAG_COLORS.length]} border`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{n}
                  <button onClick={(e) => { e.stopPropagation(); removeKtv(ktvId); }} className="ml-0.5 hover:opacity-60"><X size={12} /></button>
                </span>); })}
              <input type="text" value={ktvSearch} onChange={e => { setKtvSearch(e.target.value); if (!isKtvDropdownOpen) setIsKtvDropdownOpen(true); }} onFocus={() => setIsKtvDropdownOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' && ktvSearch.trim()) { e.preventDefault(); const term = ktvSearch.toLowerCase().trim(); const m = availableTurns.find(t => t.employee_id.toLowerCase() === term || t.staff?.full_name?.toLowerCase() === term); if (m) addKtv(m.employee_id); else addKtv(ktvSearch.trim()); setKtvSearch(''); } }}
                placeholder={state.selectedKtvIds.length === 0 ? '+ Chọn KTV...' : '+ Thêm...'} className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-xs font-bold placeholder:text-gray-400" />
            </div>
            {isKtvDropdownOpen && (
              <div className="absolute z-50 w-full mt-1 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 overflow-hidden">
                <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
                  {filteredTurns.map(turn => { const hasSkill = targetSkill ? turn.staff?.skills?.[targetSkill] === true : true; const isUsed = allSelectedKtvIds.includes(turn.employee_id) && !state.selectedKtvIds.includes(turn.employee_id); return (
                    <div key={turn.employee_id} onClick={() => { addKtv(turn.employee_id); }}
                      className={`px-3 py-2 rounded-xl text-sm font-bold cursor-pointer transition-all flex items-center justify-between hover:bg-indigo-50 active:scale-[0.98] ${!hasSkill ? 'text-gray-400' : 'text-gray-700'}`}>
                      <div className="flex items-center gap-2"><span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded-md font-black text-slate-500">#{turn.check_in_order}</span><span>{turn.employee_id}</span></div>
                      <span className={`text-[10px] font-semibold ${isUsed ? 'text-indigo-500' : turn.status === 'working' ? 'text-amber-500' : turn.status === 'assigned' ? 'text-indigo-500' : 'text-emerald-500'}`}>{isUsed ? '🔄 Đã gán ở DV khác' : turn.status === 'working' ? `⌛ Đến ${fmtTime(turn.estimated_end_time)}` : turn.status === 'assigned' ? `🔒 Đã xếp lịch${turn.estimated_end_time ? ` • Rảnh ${fmtTime(turn.estimated_end_time)}` : ''}` : '✅ Sẵn sàng'}</span>
                    </div>); })}
                  {ktvSearch.trim() && !availableTurns.some(t => t.employee_id.toLowerCase() === ktvSearch.trim().toLowerCase() || t.staff?.full_name?.toLowerCase() === ktvSearch.trim().toLowerCase()) && (
                    <div onClick={() => { addKtv(ktvSearch.trim()); setKtvSearch(''); }} className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 cursor-pointer hover:bg-emerald-50 text-emerald-700 active:scale-[0.98] border border-dashed border-emerald-200 mt-2">
                      <Plus size={16} className="text-emerald-500" /><span>Nhập tên ngoài: <strong className="text-emerald-800">{ktvSearch.trim()}</strong></span>
                    </div>)}
                  {filteredTurns.length === 0 && !ktvSearch.trim() && <p className="text-center text-xs text-gray-400 py-4 font-bold">Không tìm thấy KTV phù hợp</p>}
                </div>
              </div>)}
          </div>
        </div>
        )}

        {state.selectedKtvIds.length > 0 && (
          <div className="space-y-2">
            <div className="space-y-2">
              {state.selectedKtvIds.map((ktvId, idx) => {
                const t = availableTurns.find(t => t.employee_id === ktvId);
                const name = ktvId;
                const selRoom = (state.selectedRoomIds || [])[idx] || '';
                const selBed = (state.ktvBedIds || [])[idx] || '';
                const startT = (state.ktvStartTimes || [])[idx] || '';
                const endT = (state.ktvEndTimes || [])[idx] || '';
                const ktvDur = (state.ktvDurations || [])[idx] || duration;
                const ktvNote = (state.ktvNotes || [])[idx] || '';
                const roomBedsList = selRoom ? beds.filter(b => b.roomId === selRoom) : [];
                return (
                <div key={`${ktvId}-${idx}`} className="bg-gray-50/50 rounded-xl px-3 py-2.5 border border-gray-100 space-y-1.5">
                  {/* Row 1: Name | Room | Bed | Duration | Time | Print */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-white shrink-0 ${getBadgeBg(idx)}`}>{idx + 1}</span>
                    {state.selectedKtvIds.length >= 2 && (
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => moveKtv(idx, idx - 1)} disabled={idx === 0} className={`p-0.5 rounded leading-none ${idx === 0 ? 'text-gray-200' : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 active:scale-90'} transition-all`}><ChevronUp size={16} strokeWidth={2.5} /></button>
                        <button onClick={() => moveKtv(idx, idx + 1)} disabled={idx === state.selectedKtvIds.length - 1} className={`p-0.5 rounded leading-none ${idx === state.selectedKtvIds.length - 1 ? 'text-gray-200' : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 active:scale-90'} transition-all`}><ChevronDown size={16} strokeWidth={2.5} /></button>
                      </div>
                    )}
                    <span className="text-xs font-bold text-gray-700 truncate max-w-[100px]">{name}</span>
                    <select value={selRoom} onChange={e => updateRoomForIdx(idx, e.target.value)} className="w-[70px] px-1.5 py-1 border border-gray-200 rounded-lg text-[11px] font-bold bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none">
                      <option value="">P.</option>
                      {rooms.map(r => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
                    </select>
                    {selRoom && (<span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100 shrink-0">{selBed ? `G.${roomBedsList.findIndex(b => b.id === selBed) + 1}` : String.fromCharCode(8212)}</span>)}
                    <div className="relative">
                        <input
                            type="number"
                            min={0.1} max={300} step={0.1}
                            value={ktvDur || ''}
                            onChange={e => updateDurationForIdx(idx, e.target.value ? Number(e.target.value) : 0)}
                            onFocus={() => setOpenDurationIdx(idx)}
                            className="w-[75px] px-2 py-1.5 border-2 border-amber-100 rounded-xl text-[11px] font-black text-center text-amber-700 bg-amber-50 focus:border-amber-400 outline-none transition-all pr-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            placeholder="Phút"
                        />
                        <button 
                            type="button"
                            onClick={() => setOpenDurationIdx(openDurationIdx === idx ? null : idx)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-amber-500 hover:text-amber-700 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${openDurationIdx === idx ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                        <AnimatePresence>
                            {openDurationIdx === idx && (
                                <motion.div 
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 5 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute z-[100] w-[80px] mt-1 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden left-0"
                                >
                                    <div className="max-h-40 overflow-y-auto p-1 space-y-0.5 custom-scrollbar">
                                        {DURATION_PRESETS.map(min => (
                                            <div
                                                key={min}
                                                onClick={() => {
                                                    updateDurationForIdx(idx, min);
                                                    setOpenDurationIdx(null);
                                                }}
                                                className={`px-3 py-2 text-center text-[11px] font-black rounded-lg cursor-pointer transition-colors ${
                                                    ktvDur === min 
                                                    ? 'bg-amber-100 text-amber-800' 
                                                    : 'hover:bg-amber-50 text-amber-700'
                                                }`}
                                            >
                                                {min}
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <div className="flex items-center gap-1">
                      <input type="time" value={startT} onChange={e => updateTimeForIdx(idx, 'start', e.target.value)} className="px-1.5 py-1 border border-indigo-200 rounded-lg text-[11px] font-black text-indigo-700 bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none w-[82px]" />
                      <span className="text-indigo-300 text-[10px]">&rarr;</span>
                      <span className="px-1.5 py-1 border border-indigo-200 rounded-lg text-[11px] font-black text-indigo-700 bg-indigo-50/50 w-[60px] text-center">{endT || '--:--'}</span>
                    </div>
                    <button onClick={() => setShowTicketForIdx(idx)} className="p-2.5 bg-indigo-50 text-indigo-500 hover:bg-indigo-100 border border-indigo-100 rounded-xl transition-all active:scale-90 shrink-0" title="In phiếu"><Printer size={15} strokeWidth={2.5} /></button>
                  </div>
                  {/* Row 2: Per-KTV Note | Reminder Button | Dispatch button */}
                  <div className="flex items-center gap-2 ml-6">
                    <div className="flex-1 relative">
                        <input type="text" value={ktvNote} onChange={e => updateNoteForIdx(idx, e.target.value)} placeholder="Ghi chú riêng..." className="w-full px-2.5 py-1.5 border border-gray-100 rounded-xl text-[11px] font-medium focus:ring-2 focus:ring-indigo-500/10 outline-none bg-white placeholder:text-gray-300 pr-8" />
                        {ktvNote && (
                            <button onClick={() => updateNoteForIdx(idx, '')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-gray-500"><X size={12} /></button>
                        )}
                    </div>
                    
                    <div className="relative" ref={idx === showRemindersIdx ? reminderRef : null}>
                        <button 
                            onClick={() => setShowRemindersIdx(showRemindersIdx === idx ? null : idx)}
                            className={`p-1.5 rounded-lg border transition-all active:scale-95 flex items-center gap-1
                                ${showRemindersIdx === idx ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-gray-100 text-gray-400 hover:border-indigo-200 hover:text-indigo-600'}
                            `}
                            title="Chọn nhắc nhở nhanh"
                        >
                            <AlertCircle size={14} />
                            <span className="text-[9px] font-black uppercase hidden sm:inline">Nhắc</span>
                        </button>

                        <AnimatePresence>
                            {showRemindersIdx === idx && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                    className="absolute bottom-full right-0 mb-2 w-60 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-[100]"
                                >
                                    <div className="p-3 border-b border-gray-50 bg-indigo-50/50 flex justify-between items-center">
                                        <span className="text-[9px] font-black text-indigo-900 uppercase tracking-widest">Chọn nhắc nhở</span>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto p-1.5 grid grid-cols-1 gap-0.5 no-scrollbar">
                                        {reminders.map((rm) => {
                                            const isSelected = ktvNote?.includes(rm.content);
                                            return (
                                                <button
                                                    key={rm.id}
                                                    onClick={() => {
                                                        const currentNote = ktvNote || '';
                                                        if (isSelected) {
                                                            const parts = currentNote.split(' - ').filter(p => p !== rm.content);
                                                            updateNoteForIdx(idx, parts.join(' - '));
                                                        } else {
                                                            const newNote = currentNote ? `${currentNote} - ${rm.content}` : rm.content;
                                                            updateNoteForIdx(idx, newNote);
                                                        }
                                                    }}
                                                    className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-between
                                                        ${isSelected ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-indigo-50 text-gray-700 hover:text-indigo-700'}
                                                    `}
                                                >
                                                    <span className="flex-1 truncate pr-2">{rm.content}</span>
                                                    {isSelected && <CheckCircle2 size={12} strokeWidth={3} />}
                                                </button>
                                            );
                                        })}
                                        {reminders.length === 0 && (
                                            <div className="py-4 text-center text-gray-400 text-[9px] font-bold uppercase italic">Chưa có nhắc nhở</div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {onDispatch && (
                        <button 
                            onClick={() => onDispatch(idx)} 
                            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black rounded-xl transition-all active:scale-95 shadow-sm shadow-indigo-200 uppercase tracking-wider flex items-center gap-1.5 ml-auto shrink-0"
                        >
                            <Send size={12} strokeWidth={3} /> ĐIỀU PHỐI LẺ
                        </button>
                    )}
                  </div>
                </div>
              ); })}
            </div>
          </div>
        )}
      </div>
    </div>

    <AnimatePresence>
    {showTicketForIdx !== null && (() => {
      const idx = showTicketForIdx; const ktvId = state.selectedKtvIds[idx] || ''; const rId = (state.selectedRoomIds || [])[idx] || '';
      const rName = rooms.find(r => r.id === rId)?.name || rId || '---'; const tName = state.displayName || serviceName;
      const sT = (state.ktvStartTimes || [])[idx] || '--:--'; const eT = (state.ktvEndTimes || [])[idx] || '--:--';
      const ticketDur = (state.ktvDurations || [])[idx] || duration;
      const ticketNote = (state.ktvNotes || [])[idx] || '';
      return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={() => setShowTicketForIdx(null)}>
          <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-[400px] max-h-[90vh] overflow-y-auto"
          >
            {/* Close button */}
            <button onClick={() => setShowTicketForIdx(null)} className="absolute top-4 right-4 z-10 p-2 bg-white/80 hover:bg-white rounded-full shadow-lg border border-gray-200 transition-all active:scale-90">
                <X size={18} className="text-gray-500" />
            </button>
            
            {/* Ticket Header */}
            <div className="bg-slate-900 text-white px-6 py-5 flex justify-between items-center rounded-t-3xl">
              <div className="text-4xl font-black italic tracking-tight">{ktvId}</div>
              <div className="text-right">
                  <div className="text-[11px] font-bold tracking-wider opacity-70">Phiếu Tua KTV</div>
                  <div className="text-base font-black mt-0.5">{dateFormatted}</div>
              </div>
            </div>
            
            {/* Ticket Content */}
            <div className="px-5 py-5 space-y-4">
              {/* Service Name */}
              <div>

                  <div className="text-2xl font-black text-red-600 uppercase leading-tight">
                      {tName} ({ticketDur}&apos;)
                  </div>
                  {serviceDescription && tName === serviceName && (
                      <p className="mt-1.5 text-sm font-bold text-gray-600 leading-relaxed">
                          {serviceDescription}
                      </p>
                  )}
              </div>

              {/* Segments (Always 1 for Quick Dispatch) */}
              <div className="space-y-3">
                  {/* Time */}
                  <div className="border-[2.5px] border-dashed border-amber-400 rounded-2xl px-4 py-4 text-center">
                      <p className="text-[10px] font-black text-amber-800 uppercase tracking-[3px] mb-2">Thời gian thực hiện</p>
                      <p className="text-[32px] font-black text-red-600 leading-none tracking-tight">
                          {sT} <span className="text-red-400">→</span> {eT}
                      </p>
                  </div>
                  {/* Room */}
                  <div className="bg-slate-100 rounded-xl px-4 py-3 border-l-4 border-slate-500">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Phòng</p>
                      <p className="text-xl font-black text-red-600 mt-0.5">{rName}</p>
                  </div>
              </div>

              {/* Customer Requirements */}
              {customerReqs && (((!isVipOrder && customerReqs.genderReq)) || customerReqs.strength || customerReqs.focus || customerReqs.avoid || customerReqs.customerNote) && (
                <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 space-y-3 shadow-inner">
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-2">
                      <AlertCircle size={14} className="text-amber-500" /> Yêu Cầu Khách Hàng
                  </p>
                  <div className="flex flex-wrap gap-2">

                    {/* Giới tính KTV: Không cần in ra phiếu cho KTV */}
                    {customerReqs.strength && (
                        <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-orange-50 text-orange-700 border-orange-100 shadow-sm">
                            💪 Lực: {customerReqs.strength}
                        </span>
                    )}
                    {customerReqs.focus && (() => {
                        const FULL_BODY_THRESHOLD = 8;
                        const areas = customerReqs.focus.split(',').map(s => s.trim()).filter(Boolean);
                        const displayText = areas.length >= FULL_BODY_THRESHOLD ? 'Full Body' : customerReqs.focus;
                        return (
                            <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm">
                                🎯 Tập trung: {displayText}
                            </span>
                        );
                    })()}
                    {customerReqs.avoid && (
                        <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-rose-50 text-rose-700 border-rose-100 shadow-sm">
                            🚫 Tránh: {customerReqs.avoid}
                        </span>
                    )}
                  </div>
                  {customerReqs.customerNote && (
                      <div className="bg-white/60 px-3 py-2.5 rounded-xl border border-amber-200/50">
                          <p className="text-xs font-bold text-amber-900 italic flex items-start gap-2">
                              <span className="text-amber-400 mt-0.5">📌</span> {customerReqs.customerNote}
                          </p>
                      </div>
                  )}
                </div>
              )}
              
              {/* Admin Note */}
              {ticketNote && (
                <div className="bg-green-50/50 border border-green-200 rounded-2xl p-4 space-y-3 shadow-inner">
                  <p className="text-[10px] font-black text-green-700 uppercase tracking-widest flex items-center gap-2">
                      📝 Admin Dặn Dò
                  </p>
                  <div className="bg-white/60 px-3 py-2.5 rounded-xl border border-green-200/50">
                      <p className="text-xs font-bold text-green-900 flex items-start gap-2 uppercase">
                          <span className="text-green-500 mt-0.5">💬</span> &quot;{ticketNote}&quot;
                      </p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="text-center py-4 border-t border-gray-200 mt-2">
                <p className="text-xs text-gray-400 font-semibold italic">Hệ thống Spa Ngân Hà</p>
            </div>
          </motion.div>
        </div>
      );
    })()}
    </AnimatePresence>
    </>);
};
