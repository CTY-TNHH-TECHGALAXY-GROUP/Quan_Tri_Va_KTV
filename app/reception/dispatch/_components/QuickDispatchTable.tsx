'use client';
import { isUtilityService } from '@/lib/booking.logic';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Printer, X, ChevronDown, ChevronUp, Plus, Clock, AlertCircle, CheckCircle2, Send, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ReminderData, ServiceBlock, StaffData, TurnQueueData, WorkSegment } from '../types';
import { formatBodyAreas, normalizeStrength } from '@/lib/booking.logic';

// 🛠 UI CONFIGURATION
const TAG_COLORS = ['bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700'];

const FOURHAND_SERVICES = ['NHS0034', 'NHS0035', 'NHS0036', 'NHS0037', 'NHS0038', 'NHS0039'];
const SUB_SUFFIXES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

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
  ktvServiceNames?: string[];
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
  // customerReqs removed (passed down directly to groups instead)
  reminders?: ReminderData[];
  billCode?: string;
  customerName?: string;
  isVipSource?: boolean;
  onDispatchGroup?: (group: ServiceGroup, specificSvcId?: string) => void;
  onTriggerMergePrompt?: (sourceSvcId: string, targetSvcId: string, ktvId: string, onConfirm: () => void, onCancel: () => void) => void;
  onRemoveSvc?: (orderId: string, svcId: string) => void;
  subOrderCodeProp?: string;
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
  onUpdateServices, onPrintGroup, reminders = [], onDispatchGroup, onTriggerMergePrompt, onRemoveSvc, billCode, subOrderCodeProp
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
      const isUtil = isUtilityService(svc);
      
      // Calculate display name and duration by including any merged services
      const mergedSvcs = services.filter(s => svc.mergedServiceIds?.includes(s.id));
      const combinedDuration = (isUtilityService(svc) ? 0 : svc.duration) + mergedSvcs.reduce((acc, curr) => acc + ((isUtilityService(curr)) ? 0 : curr.duration), 0);
      const combinedName = [`${svc.serviceName} (${svc.duration}p)`, ...mergedSvcs.map(s => (isUtilityService(s)) ? s.serviceName : `${s.serviceName} (${s.duration}p)`)].join(' + ');

      const validForKtvReqs = [svc, ...mergedSvcs].filter(s => {
          const isRoom = String(s.serviceName || '').toLowerCase().includes('phòng riêng') && !String(s.serviceName || '').includes('+');
          const isUtil = isUtilityService(s);
          return !isRoom && !isUtil;
      });

      // Hack to inject combined data for UI rendering without altering the real object
      const combinedNote = Array.from(new Set([svc.customerNote, ...mergedSvcs.map(s => s.customerNote)].filter(Boolean))).join(' | ');
      const combinedGender = Array.from(new Set(validForKtvReqs.map(s => s.genderReq).filter(Boolean))).join(' | ');
      const combinedStrength = Array.from(new Set(validForKtvReqs.map(s => s.strength).filter(Boolean))).join(' | ');
      const combinedFocus = Array.from(new Set(validForKtvReqs.map(s => s.focus).filter(Boolean))).join(' | ');
      const combinedAvoid = Array.from(new Set(validForKtvReqs.map(s => s.avoid).filter(Boolean))).join(' | ');

      const svcForUI = {
         ...svc,
         customerNote: combinedNote || '',
         genderReq: combinedGender || '',
         strength: combinedStrength || '',
         focus: combinedFocus || '',
         avoid: combinedAvoid || '',
         options: {
            ...svc.options,
            _generatedDisplayName: combinedName,
         },
         duration: combinedDuration
      };

      const isFourhand = FOURHAND_SERVICES.includes(svc.serviceId || '');
      const key = isFourhand 
         ? `${svcForUI.options?._generatedDisplayName || svcForUI.options?.displayName || svcForUI.serviceName}_${svcForUI.duration}${isUtil ? '_utility' : ''}`
         : svc.id;

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(svcForUI);
    });
    return map;
  }, [services]);

  // State per group (includes per-KTV times, rooms, durations)
  type GroupState = {
    displayName: string;
    selectedKtvIds: string[]; selectedRoomIds: string[];
    ktvStartTimes: string[]; ktvEndTimes: string[];
    ktvDurations: number[]; ktvNotes: string[];
    ktvServiceNames?: string[];
    ktvBedIds: string[];
    ktvDisplayNames?: Record<string, string>; // Map ktvId -> display name (for external KTVs and name resolution)
    note: string; duration: number;
    isUtility?: boolean;
    isMergedGroup?: boolean;
    workMode?: 'parallel' | 'sequential';
  };
  const [groupStates, setGroupStates] = useState<Map<string, GroupState>>(new Map());
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>([]);

  const handleMergeServices = () => {
    if (selectedGroupKeys.length < 2) return;
    const selectedItems = Array.from(initialGroups.entries())
                               .filter(([k]) => selectedGroupKeys.includes(k))
                               .flatMap(([k, items]) => items);
    
    if (selectedItems.length < 2) return;
    
    const parent = selectedItems[0];
    const children = selectedItems.slice(1);
    
    const updatedServices = services.map(svc => {
        if (svc.id === parent.id) {
            return {
                ...svc,
                mergedServiceIds: [...(svc.mergedServiceIds || []), ...children.map(c => c.id)]
            };
        }
        if (children.some(c => c.id === svc.id)) {
            return {
                ...svc,
                mergedIntoId: parent.id
            };
        }
        return svc;
    });
    
    onUpdateServices(updatedServices);
    onUpdateServices(updatedServices);
    setSelectedGroupKeys([]);
  };

  const handleGroupServices = () => {
    if (selectedGroupKeys.length < 2) return;
    const selectedItems = Array.from(initialGroups.entries())
                               .filter(([k]) => selectedGroupKeys.includes(k))
                               .flatMap(([k, items]) => items);
    
    if (selectedItems.length < 2) return;

    // Use the id of the first selected item as the customerGroupId
    const newGroupId = selectedItems[0].id;
    
    const updatedServices = services.map(svc => {
        if (selectedItems.some(item => item.id === svc.id)) {
            return { ...svc, customerGroupId: newGroupId };
        }
        return svc;
    });

    // 🛡️ CHẶN: Kiểm tra sau khi gộp, có nhóm khách nào chỉ còn toàn tiện ích không
    const postGroupGroups = new Map<string, typeof updatedServices>();
    updatedServices.filter(s => !s.mergedIntoId).forEach(svc => {
      const grpId = svc.customerGroupId || svc.id;
      if (!postGroupGroups.has(grpId)) postGroupGroups.set(grpId, []);
      postGroupGroups.get(grpId)!.push(svc);
    });
    if (postGroupGroups.size > 1) {
      const utilityOnlyNames: string[] = [];
      postGroupGroups.forEach((svcs) => {
        const hasMainService = svcs.some(s => !isUtilityService(s));
        if (!hasMainService) {
          utilityOnlyNames.push(svcs.map(s => s.serviceName || 'Tiện ích').join(', '));
        }
      });
      if (utilityOnlyNames.length > 0) {
        const ok = confirm(
          `⚠️ Sau khi gộp, có khách chỉ còn dịch vụ tiện ích:\n\n` +
          utilityOnlyNames.map(n => `• ${n}`).join('\n') +
          `\n\nDịch vụ tiện ích (Phòng riêng...) không thể đứng một mình. Vui lòng gộp thêm vào khách có dịch vụ chính.\n\nBấm OK để vẫn gộp (tự chịu trách nhiệm), hoặc Hủy để quay lại.`
        );
        if (!ok) return;
      }
    }

    onUpdateServices(updatedServices);
    setSelectedGroupKeys([]);
  };

  const handleSplitServices = () => {
    if (selectedGroupKeys.length === 0) return;
    const selectedItems = Array.from(initialGroups.entries())
                               .filter(([k]) => selectedGroupKeys.includes(k))
                               .flatMap(([k, items]) => items);
                               
    if (selectedItems.length === 0) return;
    
    let updatedServices = [...services];
    
    selectedItems.forEach(parent => {
        const childrenIds = parent.mergedServiceIds || [];
        updatedServices = updatedServices.map(svc => {
            // Tách chính nó thành 1 khách độc lập
            if (svc.id === parent.id) {
                return { ...svc, mergedServiceIds: [], mergedIntoId: undefined, customerGroupId: svc.id, options: { ...svc.options, displayName: undefined } };
            }
            // Các dịch vụ con cũng bị văng ra thành khách độc lập
            if (childrenIds.includes(svc.id)) {
                return { ...svc, mergedIntoId: undefined, customerGroupId: svc.id, options: { ...svc.options, displayName: undefined } };
            }
            // Các dịch vụ cùng chung group (nhưng khác KTV) cũng bị văng ra thành khách độc lập nếu có trùng group
            if (parent.customerGroupId && (svc.customerGroupId === parent.customerGroupId || svc.customerGroupId === parent.id)) {
                return { ...svc, customerGroupId: svc.id };
            }
            // Nếu parent đang là con của svc này, gỡ parent ra khỏi svc cha
            if (parent.mergedIntoId === svc.id) {
                return { ...svc, mergedServiceIds: (svc.mergedServiceIds || []).filter(id => id !== parent.id) };
            }
            return svc;
        });
    });

    // 🛡️ CHẶN: Kiểm tra sau khi tách, có nhóm khách nào chỉ còn toàn tiện ích không
    const postSplitGroups = new Map<string, typeof updatedServices>();
    updatedServices.filter(s => !s.mergedIntoId).forEach(svc => {
      const grpId = svc.customerGroupId || svc.id;
      if (!postSplitGroups.has(grpId)) postSplitGroups.set(grpId, []);
      postSplitGroups.get(grpId)!.push(svc);
    });
    if (postSplitGroups.size > 1) {
      const utilityOnlyNames: string[] = [];
      postSplitGroups.forEach((svcs) => {
        const hasMainService = svcs.some(s => !isUtilityService(s));
        if (!hasMainService) {
          utilityOnlyNames.push(svcs.map(s => s.serviceName || 'Tiện ích').join(', '));
        }
      });
      if (utilityOnlyNames.length > 0) {
        const ok = confirm(
          `⚠️ Sau khi tách, có khách chỉ còn dịch vụ tiện ích:\n\n` +
          utilityOnlyNames.map(n => `• ${n}`).join('\n') +
          `\n\nDịch vụ tiện ích (Phòng riêng...) không thể đứng một mình. Vui lòng gộp vào khách có dịch vụ chính.\n\nBấm OK để vẫn tách (tự chịu trách nhiệm), hoặc Hủy để quay lại.`
        );
        if (!ok) return;
      }
    }
    
    onUpdateServices(updatedServices);
    setSelectedGroupKeys([]);
  };

  const handleUnmergeSingle = (groupId: string) => {
    const groupItems = initialGroups.get(groupId) || [];
    if (groupItems.length === 0) return;
    const parent = groupItems[0];
    const childrenIds = parent.mergedServiceIds || [];
    if (childrenIds.length === 0) return;

    const updatedServices = services.map(svc => {
        if (svc.id === parent.id) {
            return { ...svc, mergedServiceIds: [], customerGroupId: undefined };
        }
        if (childrenIds.includes(svc.id)) {
            return { ...svc, mergedIntoId: undefined, customerGroupId: undefined };
        }
        if (svc.customerGroupId === parent.customerGroupId || svc.customerGroupId === parent.id) {
            return { ...svc, customerGroupId: undefined };
        }
        return svc;
    });
    onUpdateServices(updatedServices);
    setSelectedGroupKeys(prev => prev.filter(k => k !== groupId));
  };

  const handleUnmergeCustomerGroup = (cId: string) => {
      const updatedServices = services.map(svc => {
          if (svc.customerGroupId === cId) {
              return { ...svc, customerGroupId: undefined };
          }
          return svc;
      });
      onUpdateServices(updatedServices);
  };

  // Build fingerprint from current services data
  const buildFingerprint = (svcs: ServiceBlock[]) =>
    svcs.map(s => `${s.id}|${s.mergedIntoId || ''}|${s.mergedServiceIds?.join(',') || ''}|${s.staffList?.map(st => `${st.ktvId}:${st.segments?.[0]?.roomId || ''}:${st.segments?.[0]?.startTime || ''}:${st.segments?.[0]?.duration || ''}`).join(',')}`).join(';');

  // Initialize / re-initialize group states when services change
  useEffect(() => {
    const fp = buildFingerprint(services);
    if (fp === servicesFingerprintRef.current) return;
    servicesFingerprintRef.current = fp;

    const defaultTime = getCurrentTime();
    setGroupStates((prevStates) => {
      const newStates = new Map<string, GroupState>();
      initialGroups.forEach((items, groupKey) => {
        const duration = items[0]?.duration || 0;
        const isMergedGroup = !!(items[0]?.mergedServiceIds?.length);
        
        // Collect all KTVs across all items (including multi-staff per item)
        const ktvIds: string[] = [];
        const roomIds: string[] = [];
        const startTimes: string[] = [];
        const endTimes: string[] = [];
        const ktvDurationsList: number[] = [];
        const ktvNotesList: string[] = [];
        const ktvServiceNamesList: string[] = [];
        const bedIdsList: string[] = [];
        const ktvDisplayNames: Record<string, string> = {};
        items.forEach(item => {
          if (item.staffList.length > 0) {
            item.staffList.forEach(staff => {
              if (staff.ktvId) {
                ktvIds.push(staff.ktvId);
                if (staff.ktvName && staff.ktvName !== staff.ktvId) {
                  ktvDisplayNames[staff.ktvId] = staff.ktvName;
                }
                roomIds.push(staff.segments?.[0]?.roomId || '');
                startTimes.push(staff.segments?.[0]?.startTime || defaultTime);
                
                let totalStaffDur = (staff.segments?.[0]?.duration !== undefined && staff.segments?.[0]?.duration !== null) ? staff.segments[0].duration : duration;
                let finalEndTime = staff.segments?.[0]?.endTime;
                
                // Parent segment duration already contains the TOTAL merged duration
                // Do NOT add child durations here — it would double-count
                if (!finalEndTime) {
                   finalEndTime = calcEndTime(staff.segments?.[0]?.startTime || defaultTime, totalStaffDur);
                }
                
                endTimes.push(finalEndTime);
                ktvDurationsList.push(totalStaffDur);
                ktvNotesList.push(staff.noteForKtv || '');
                ktvServiceNamesList.push(staff.serviceNameForKtv || '');
                bedIdsList.push(staff.segments?.[0]?.bedId || '');
              }
            });
          }
        });

        console.log('--- [BƯỚC 0 VÒNG 3] Thu thập KTV ---');
        console.log('groupKey:', groupKey);
        console.log('items (detailed):', JSON.stringify(items.map(i => ({ 
            id: i.id, 
            staffCount: i.staffList?.length, 
            ktvs: i.staffList?.map(s => s.ktvId) 
        })), null, 2));
        console.log('ktvIds thu duoc:', ktvIds);

        if (ktvIds.length === 0) {
          startTimes.push(defaultTime);
          endTimes.push(calcEndTime(defaultTime, duration));
        }
          let initialWorkMode: 'parallel' | 'sequential' = 'parallel';
          const prevMode = prevStates.get(groupKey)?.workMode;
          if (prevMode) {
              initialWorkMode = prevMode;
          } else if (ktvIds.length > 1 && startTimes.length > 1) {
              const allSame = startTimes.every(st => st === startTimes[0]);
              if (!allSame) initialWorkMode = 'sequential';
          }

          newStates.set(groupKey, {
            displayName: items[0]?.options?.displayName || items[0]?.options?._generatedDisplayName || items[0]?.serviceName || '',
            selectedKtvIds: ktvIds,
            selectedRoomIds: roomIds,
            ktvStartTimes: startTimes,
            ktvEndTimes: endTimes,
            ktvDurations: ktvDurationsList.length > 0 ? ktvDurationsList : [duration],
            ktvNotes: ktvNotesList,
            ktvServiceNames: ktvServiceNamesList,
            ktvBedIds: bedIdsList,
            ktvDisplayNames: Object.keys(ktvDisplayNames).length > 0 ? ktvDisplayNames : undefined,
            note: items[0]?.staffList?.[0]?.noteForKtv || '',
            duration,
            isUtility: isUtilityService(items[0]),
            isMergedGroup,
            workMode: initialWorkMode
          });
      });
      return newStates.size > 0 ? newStates : prevStates;
    });
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

      console.log('--- [BƯỚC 0 CHẨN ĐOÁN] syncToServices ---');
      console.log('groupKey:', groupKey);
      console.log('ktvCount:', ktvCount, '| itemCount:', itemCount);
      console.log('isMergedGroup:', state.isMergedGroup);
      console.log('Vào nhánh if?:', ktvCount <= itemCount && !state.isMergedGroup);

      if (ktvCount <= itemCount && !state.isMergedGroup) {
        // Normal: 1 KTV per service item
        items.forEach((item, idx) => {
          const svcIdx = updatedServices.findIndex(s => s.id === item.id);
          if (svcIdx === -1) return;
          const ktvId = state.selectedKtvIds[idx] || '';
          const ktvTurn = availableTurns.find(t => t.employee_id === ktvId);
          const ktvName = state.ktvDisplayNames?.[ktvId] || ktvTurn?.staff?.full_name || ktvId;
          const roomId = state.selectedRoomIds?.[idx] || null;
          let bedId: string | null = state.ktvBedIds?.[idx] || null;
          if (roomId && !bedId) { bedId = getAvailableBedInRoom(roomId, globalUsedBedIds); if (bedId) globalUsedBedIds.push(bedId); }
          else if (bedId) { globalUsedBedIds.push(bedId); }
          const st = state.ktvStartTimes?.[idx] || getCurrentTime();
          
          const originalDur = (updatedServices[svcIdx].staffList?.[0]?.segments?.[0]?.duration !== undefined && updatedServices[svcIdx].staffList?.[0]?.segments?.[0]?.duration !== null) ? updatedServices[svcIdx].staffList[0].segments[0].duration : updatedServices[svcIdx].duration;
          
          // For merged services, ktvDurations[0] already contains the TOTAL merged duration from the UI
          let ktvDur = originalDur;
          if (state.isMergedGroup) {
              if (ktvCount === 1) {
                  ktvDur = idx === 0 ? ((state.ktvDurations?.[0] !== undefined && state.ktvDurations?.[0] !== null) ? state.ktvDurations[0] : originalDur) : 0;
              } else {
                  ktvDur = (state.ktvDurations?.[idx] !== undefined && state.ktvDurations?.[idx] !== null) ? state.ktvDurations[idx] : originalDur;
              }
          } else {
              ktvDur = (state.ktvDurations?.[idx] !== undefined && state.ktvDurations?.[idx] !== null) ? state.ktvDurations[idx] : originalDur;
          }
          
          const segment: WorkSegment = {
            id: updatedServices[svcIdx].staffList?.[0]?.segments?.[0]?.id || `seg-${genId()}`,
            roomId, bedId, startTime: st, duration: ktvDur,
            endTime: state.ktvEndTimes?.[idx] || calcEndTime(st, ktvDur),
          };
          updatedServices[svcIdx] = {
            ...updatedServices[svcIdx],
            staffList: [{ id: updatedServices[svcIdx].staffList?.[0]?.id || `st-${item.id}-${ktvId}`, ktvId, ktvName, segments: [segment], noteForKtv: state.ktvNotes?.[idx] || '', serviceNameForKtv: state.ktvServiceNames?.[idx] || '' }],
            options: { ...updatedServices[svcIdx].options, displayName: state.displayName ? state.displayName : updatedServices[svcIdx].options?.displayName },
          };
        });
      } else {
        // Multi-KTV per service: distribute KTVs across items, extras go as additional staffList entries
        items.forEach((item, itemIdx) => {
          const svcIdx = updatedServices.findIndex(s => s.id === item.id);
          if (svcIdx === -1) return;
          // Find which KTVs belong to this item
          const staffEntries: { ktvId: string; ktvName: string; roomId: string | null; bedId: string | null; startTime: string; endTime: string; duration: number; }[] = [];
          
          const baseIdxToBedId = new Map<number, string>();
          
          // Each item gets KTVs. If merged, all KTVs go to all items. Otherwise, distribute round-robin.
          for (let ki = 0; ki < ktvCount; ki++) {
            if (!state.isMergedGroup && ki % itemCount !== itemIdx) continue;
            
            const ktvId = state.selectedKtvIds[ki] || '';
            const ktvTurn = availableTurns.find(t => t.employee_id === ktvId);
            const ktvName = state.ktvDisplayNames?.[ktvId] || ktvTurn?.staff?.full_name || ktvId;
            const roomId = state.selectedRoomIds?.[ki] || null;
            let bedId: string | null = state.ktvBedIds?.[ki] || null;
            
            const baseIdx = ki % (itemCount || 1);
            
            if (roomId && !bedId) { 
                if (baseIdxToBedId.has(baseIdx)) {
                    bedId = baseIdxToBedId.get(baseIdx)!;
                } else {
                    bedId = getAvailableBedInRoom(roomId, globalUsedBedIds); 
                    if (bedId) {
                        globalUsedBedIds.push(bedId); 
                        baseIdxToBedId.set(baseIdx, bedId);
                    }
                }
            }
            else if (bedId) { 
                if (!globalUsedBedIds.includes(bedId)) {
                    globalUsedBedIds.push(bedId); 
                }
                if (!baseIdxToBedId.has(baseIdx)) {
                    baseIdxToBedId.set(baseIdx, bedId);
                }
            }
            const st = state.ktvStartTimes?.[ki] || getCurrentTime();
            const originalDur = (updatedServices[svcIdx].staffList?.[ki]?.segments?.[0]?.duration !== undefined && updatedServices[svcIdx].staffList?.[ki]?.segments?.[0]?.duration !== null) ? updatedServices[svcIdx].staffList[ki].segments[0].duration : updatedServices[svcIdx].duration;
            
            // For merged services, ktvDurations[0] already contains the TOTAL merged duration from the UI
            let kd = originalDur;
            if (state.isMergedGroup) {
                kd = itemIdx === 0 ? ((state.ktvDurations?.[ki] !== undefined && state.ktvDurations?.[ki] !== null) ? state.ktvDurations[ki] : originalDur) : 0;
            } else {
                kd = (state.ktvDurations?.[ki] !== undefined && state.ktvDurations?.[ki] !== null) ? state.ktvDurations[ki] : originalDur;
            }
            
            const finalEndTime = state.ktvEndTimes?.[ki] || calcEndTime(st, kd);
            
            staffEntries.push({ ktvId, ktvName, roomId, bedId, startTime: st, endTime: finalEndTime, duration: kd });
          }
          updatedServices[svcIdx] = {
            ...updatedServices[svcIdx],
            staffList: staffEntries.map((e, si) => ({
              id: updatedServices[svcIdx].staffList?.[si]?.id || `st-${item.id}-${e.ktvId}`,
              ktvId: e.ktvId, ktvName: e.ktvName,
              segments: [{ id: updatedServices[svcIdx].staffList?.[si]?.segments?.[0]?.id || `seg-${genId()}`, roomId: e.roomId, bedId: e.bedId, startTime: e.startTime, duration: e.duration, endTime: e.endTime }],
              noteForKtv: (state.ktvNotes && state.ktvNotes[state.selectedKtvIds.indexOf(e.ktvId)] !== undefined) ? state.ktvNotes[state.selectedKtvIds.indexOf(e.ktvId)] : '',
              serviceNameForKtv: state.ktvServiceNames?.[state.selectedKtvIds.indexOf(e.ktvId)] || '',
            })),
            options: { ...updatedServices[svcIdx].options, displayName: state.displayName ? state.displayName : updatedServices[svcIdx].options?.displayName },
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

  const isAllSelected = selectedGroupKeys.length > 0 && selectedGroupKeys.length === initialGroups.size;
  const toggleSelectAll = () => {
      if (isAllSelected) setSelectedGroupKeys([]);
      else setSelectedGroupKeys(Array.from(initialGroups.keys()));
  };
  const parentPrefix = billCode ? billCode.split('-')[0] : 'XXX';
  // Assign subSuffix based on customerGroupId (or groupKey if no customerGroupId)
  const persistentSuffixesRef = useRef(new Map<string, string>());

  const groupKeyToSuffix = useMemo(() => {
     const map = new Map<string, string>();
     let maxIdx = -1;
     
     persistentSuffixesRef.current.forEach(suffix => {
         const idx = SUB_SUFFIXES.indexOf(suffix);
         if (idx > maxIdx) maxIdx = idx;
     });
     
     let currentIdx = maxIdx + 1;

     Array.from(initialGroups.entries()).forEach(([groupKey, items]) => {
         const customerGroupId = items[0]?.customerGroupId;
         if (customerGroupId) {
             if (!persistentSuffixesRef.current.has(customerGroupId)) {
                 persistentSuffixesRef.current.set(customerGroupId, SUB_SUFFIXES[currentIdx] || String(currentIdx + 1));
                 currentIdx++;
             }
             map.set(groupKey, persistentSuffixesRef.current.get(customerGroupId)!);
         } else {
             if (!persistentSuffixesRef.current.has(groupKey)) {
                 persistentSuffixesRef.current.set(groupKey, SUB_SUFFIXES[currentIdx] || String(currentIdx + 1));
                 currentIdx++;
             }
             map.set(groupKey, persistentSuffixesRef.current.get(groupKey)!);
         }
     });
     return map;
  }, [initialGroups]);

  // Color mapping for subSuffixes to visually group them
  const SUFFIX_COLORS: Record<string, string> = {
      'A': 'border-indigo-400 bg-indigo-50',
      'B': 'border-emerald-400 bg-emerald-50',
      'C': 'border-amber-400 bg-amber-50',
      'D': 'border-rose-400 bg-rose-50',
      'E': 'border-cyan-400 bg-cyan-50',
      'F': 'border-purple-400 bg-purple-50',
  };

  return (
    <div className="space-y-5">
      {/* 🚀 TOOLBAR SUB-BOOKING */}
      <div className="sticky top-0 z-20 px-6 py-4 bg-white/80 backdrop-blur-md border border-slate-200/80 rounded-3xl flex flex-wrap gap-2.5 items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
              <input type="checkbox" id="selectAllCheckbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-5 h-5 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
              <label htmlFor="selectAllCheckbox" className="text-xs font-black text-slate-700 uppercase tracking-wider cursor-pointer mt-0.5">
                  ĐÃ CHỌN ({selectedGroupKeys.length}/{initialGroups.size})
              </label>
          </div>
          
          <div className="flex items-center gap-2">
              <button onClick={handleMergeServices} disabled={selectedGroupKeys.length < 2} className="flex items-center gap-1.5 bg-white border-2 border-indigo-200 text-indigo-700 px-3.5 py-2 rounded-xl text-xs font-black hover:bg-indigo-50 hover:border-indigo-300 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:pointer-events-none" title="Gộp 2 hoặc nhiều dịch vụ thành 1 đơn con chung, DÙNG CHUNG KTV">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path></svg>
                  GỘP CHUNG KTV
              </button>

              <button onClick={handleGroupServices} disabled={selectedGroupKeys.length < 2} className="flex items-center gap-1.5 bg-white border-2 border-emerald-200 text-emerald-700 px-3.5 py-2 rounded-xl text-xs font-black hover:bg-emerald-50 hover:border-emerald-300 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:pointer-events-none" title="Gộp dịch vụ vào chung 1 Đơn Con (1 người khách) nhưng KHÁC KTV">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                  GỘP ĐƠN KHÁC KTV
              </button>

              <button onClick={handleSplitServices} disabled={selectedGroupKeys.length < 1} className="flex items-center gap-1.5 bg-white border-2 border-amber-200 text-amber-800 px-3.5 py-2 rounded-xl text-xs font-black hover:bg-amber-50 hover:border-amber-300 transition-all shadow-sm active:scale-95 disabled:opacity-40 disabled:pointer-events-none" title="Xé lẻ các dịch vụ đã gộp thành từng khách riêng biệt">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>
                  ✂ TÁCH KHÁCH (HỦY GỘP)
              </button>
          </div>
      </div>

      {/* Service Groups */}
      {(() => {
          const groupsArray = Array.from(initialGroups.entries());
          const displayBlocks: { key: string, items: Array<[string, any]> }[] = [];
          
          let currentGroupId: string | null = null;
          let currentBlock: { key: string, items: Array<[string, any]> } | null = null;
          
          groupsArray.forEach(([groupKey, items]) => {
              const cId = items[0]?.customerGroupId;
              if (cId) {
                  if (cId === currentGroupId) {
                      currentBlock!.items.push([groupKey, items]);
                  } else {
                      currentGroupId = cId;
                      currentBlock = { key: cId, items: [[groupKey, items]] };
                      displayBlocks.push(currentBlock);
                  }
              } else {
                  currentGroupId = null;
                  displayBlocks.push({ key: groupKey, items: [[groupKey, items]] });
              }
          });

          return displayBlocks.map((block, bIdx) => {
              const firstGroupKey = block.items[0][0];
              const firstState = groupStates.get(firstGroupKey);
              if (!firstState) return null;
              
              const isSelected = block.items.some(([gk]) => selectedGroupKeys.includes(gk));
              const calculatedSuffix = groupKeyToSuffix.get(firstGroupKey) || SUB_SUFFIXES[bIdx] || String(bIdx + 1);
              const subSuffix = subOrderCodeProp || calculatedSuffix;
              const subOrderCode = `${parentPrefix}-${subSuffix}`;
              const borderColorClass = subOrderCodeProp ? 'border-slate-200' : (SUFFIX_COLORS[subSuffix] || 'border-slate-200');
              
              const isMultiItemBlock = block.items.length > 1;
              const totalMergedCount = block.items.reduce((sum, [gk, items]) => sum + items.length + (items[0]?.mergedServiceIds?.length || 0), 0);
              const hasMergedItems = block.items.some(([gk]) => groupStates.get(gk)?.isMergedGroup);

              const wrapperClass = isMultiItemBlock 
                  ? `border-2 overflow-visible bg-white shadow-sm hover:shadow-md transition-all rounded-3xl flex flex-col ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-md scale-[1.01] z-10 relative' : borderColorClass}`
                  : "flex flex-col";

              return (
                <div key={`${block.key}-${bIdx}`} className={wrapperClass}>
                  {isMultiItemBlock && (
                     <div className={`px-4 py-3 border-b flex flex-col gap-2 rounded-t-3xl ${isSelected ? 'bg-indigo-50/50 border-indigo-100' : 'bg-gray-50/80 border-gray-100'}`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                   <input type="checkbox" checked={isSelected} onChange={() => {
                                       const keys = block.items.map(([gk]) => gk);
                                       if (isSelected) {
                                           setSelectedGroupKeys(prev => prev.filter(k => !keys.includes(k)));
                                       } else {
                                           setSelectedGroupKeys(prev => [...prev, ...keys.filter(k => !prev.includes(k))]);
                                       }
                                   }} className="w-5 h-5 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                                <div className="flex items-center gap-1.5 flex-wrap">
                                   <span className="bg-indigo-600 text-white text-[11px] font-black px-2.5 py-0.5 rounded-lg shadow-sm flex items-center gap-1">
                                       📦 Đơn Con: {subOrderCode}
                                   </span>
                                   {billCode && (
                                     <>
                                       <span className="text-xs text-slate-400 font-bold">•</span>
                                       <span className="text-xs text-slate-500 font-bold">Mã chính: <span className="text-slate-800 font-black">{billCode.split('-')[0]}</span></span>
                                     </>
                                   )}
                                   
                                   {isMultiItemBlock && (
                                      <>
                                          <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-black px-2 py-0.5 rounded-md ml-1 shadow-sm flex items-center gap-1">
                                              🔗 GỘP KHÁC KTV ({block.items.reduce((sum, [gk, items]) => sum + items.length, 0)} DỊCH VỤ)
                                          </span>
                                          <button onClick={() => {
                                              const cId = block.items[0][1][0]?.customerGroupId;
                                              if (cId) handleUnmergeCustomerGroup(cId);
                                          }} className="text-[11px] font-bold text-rose-600 hover:text-rose-800 underline ml-2">
                                              Hủy nhóm
                                          </button>
                                      </>
                                   )}
                                </div>
                            </div>
                        </div>
                     </div>
                  )}

                  {block.items.map(([groupKey, items], idx) => {
                      const state = groupStates.get(groupKey);
                      if (!state) return null;
                      
                      const isFirstInGroup = idx === 0;
                      const isLastInGroup = idx === block.items.length - 1;
                      const firstSvc = items[0];
                      let singleCustomName = null;
                      if (!state.isUtility && state.selectedKtvIds?.length === 1) {
                          const singleKtvId = state.selectedKtvIds[0];
                          singleCustomName = firstSvc?.options?.serviceNamesForKtvs?.[singleKtvId] || firstSvc?.staffList?.find((st: any) => st.ktvId === singleKtvId)?.serviceNameForKtv;
                      }
                      const displayServiceName = singleCustomName || state.displayName || firstSvc?.options?._generatedDisplayName || firstSvc?.options?.displayName || firstSvc?.serviceName || groupKey.split('_')[0];
                      
                      const count = items.length;
                      const duration = items[0]?.duration || 0;
                      
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
                          customerReqs={items[0] ? {
                            genderReq: items[0].genderReq,
                            strength: items[0].strength,
                            focus: items[0].focus,
                            avoid: items[0].avoid,
                            customerNote: items[0].customerNote,
                          } : undefined}
                          reminders={reminders}
                          getLatestEndTime={getLatestEndTime}
                          isVipOrder={isVipOrder}
                          allServices={services}
                          groupItems={items}
                          onTriggerMergePrompt={onTriggerMergePrompt}
                          onUpdateServices={onUpdateServices}
                          onRemoveSvc={onRemoveSvc}
                          orderId={orderId}
                          subOrderCode={subOrderCode}
                          isSelected={isSelected}
                          borderColorClass={borderColorClass}
                          onToggleSelect={() => setSelectedGroupKeys(prev => prev.includes(groupKey) ? prev.filter(k => k !== groupKey) : [...prev, groupKey])}
                          onUnmerge={() => handleUnmergeSingle(groupKey)}
                          billCode={billCode}
                          isFirstInGroup={isFirstInGroup}
                          isLastInGroup={isLastInGroup}
                          isChildOfBlock={isMultiItemBlock}
                        />
                      );
                  })}
                </div>
              );
          });
      })()}
    </div>
  );
};


// --- Service Group Card ---

interface ServiceGroupCardProps {
  serviceName: string;
  serviceDescription?: string;
  count: number;
  duration: number;
  state: { 
    displayName: string; 
    selectedKtvIds: string[]; 
    selectedRoomIds?: string[]; 
    ktvStartTimes?: string[]; 
    ktvEndTimes?: string[]; 
    ktvDurations?: number[];  
    ktvNotes: string[];
    ktvServiceNames?: string[];
    ktvBedIds: string[]; 
    ktvDisplayNames?: Record<string, string>; 
    note: string; 
    duration: number; 
    isUtility?: boolean; 
    isMergedGroup?: boolean; 
    workMode?: 'parallel' | 'sequential'; 
  };
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
  onUpdateServices?: (services: ServiceBlock[]) => void;
  onRemoveSvc?: (orderId: string, svcId: string) => void;
  orderId?: string | null;
  subOrderCode?: string;
  borderColorClass?: string;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onUnmerge?: () => void;
  billCode?: string;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  isChildOfBlock?: boolean;
}

const MAX_KTV_PER_GROUP = 10;

const ServiceGroupCard = ({
  serviceName, serviceDescription, count, duration, state, targetSkill,
  availableTurns, allSelectedKtvIds, rooms, beds, busyBedIds, onUpdate, onPrint, onDispatch, customerReqs, reminders = [], getLatestEndTime, isVipOrder = false,
  allServices, groupItems, onTriggerMergePrompt, onUpdateServices, onRemoveSvc,
  orderId,
  subOrderCode,
  borderColorClass,
  isSelected = false,
  onToggleSelect, onUnmerge, billCode,
  isFirstInGroup = true,
  isLastInGroup = true,
  isChildOfBlock = false
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

    let newStarts = swap(state.ktvStartTimes);
    let newEnds = swap(state.ktvEndTimes);
    const newDurations = swap(state.ktvDurations as number[]);

    if (state.workMode === 'sequential') {
        newStarts = [...(state.ktvStartTimes || [])];
        newEnds = [...(state.ktvEndTimes || [])];
        let currentStart = newStarts[0] || getCurrentTime();
        for (let i = 0; i < state.selectedKtvIds.length; i++) {
            newStarts[i] = currentStart;
            newEnds[i] = calcEndTime(currentStart, newDurations[i] || duration);
            currentStart = newEnds[i];
        }
    }

    onUpdate({
      selectedKtvIds: swap(state.selectedKtvIds),
      selectedRoomIds: swap(state.selectedRoomIds),
      ktvStartTimes: newStarts,
      ktvEndTimes: newEnds,
      ktvDurations: newDurations,
      ktvNotes: swap(state.ktvNotes),
      ktvBedIds: swap(state.ktvBedIds),
    });
  };

  const addKtv = (ktvId: string) => {
    if (state.selectedKtvIds.length >= MAX_KTV_PER_GROUP) return;

    const proceedAdd = () => {
      // Tính thời gian kết thúc trễ nhất của KTV này ở các dịch vụ khác trong cùng đơn
      const latestEndTime = getLatestEndTime(ktvId);

      const isFourhand = groupItems && groupItems.length > 0 && FOURHAND_SERVICES.includes(groupItems[0].serviceId || '');

      let defaultStart = latestEndTime || (state.ktvStartTimes || [])[0] || getCurrentTime();
      let defaultDur = duration;

      if (state.workMode === 'sequential' && state.selectedKtvIds.length > 0) {
          const lastIdx = state.selectedKtvIds.length - 1;
          defaultStart = state.ktvEndTimes?.[lastIdx] || defaultStart;
      } else if (state.workMode === 'parallel' && state.selectedKtvIds.length > 0) {
          defaultStart = (state.ktvStartTimes || [])[0] || defaultStart;
      }

      const defaultEnd = calcEndTime(defaultStart, defaultDur);
      const baseIdx = state.selectedKtvIds.length % (count || 1);
      const defaultRoom = (state.selectedRoomIds || [])[baseIdx] || (state.selectedRoomIds || [])[0] || '';
      const defaultBed = (state.ktvBedIds || [])[baseIdx] || '';

      onUpdate({ 
        selectedKtvIds: [...state.selectedKtvIds, ktvId], 
        ktvStartTimes: [...(state.ktvStartTimes || []), defaultStart], 
        ktvEndTimes: [...(state.ktvEndTimes || []), defaultEnd], 
        ktvDurations: [...(state.ktvDurations || []), defaultDur], 
        ktvNotes: [...(state.ktvNotes || []), ''], 
        ktvBedIds: [...(state.ktvBedIds || []), defaultBed],
        selectedRoomIds: [...(state.selectedRoomIds || []), defaultRoom]
      });
      setKtvSearch('');
    };

    /*
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
             setKtvSearch('');
          },
          () => {
             proceedAdd();
          }
       );
       return;
    }
    */

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
      const baseIdx = idx % (count || 1);
      // Find a free bed. We only exclude beds used by OTHER base indices
      const usedBedsByOthers = nextBedIds.filter((bId, i) => bId && (i % (count || 1) !== baseIdx));
      const roomBeds = beds.filter(b => b.roomId === roomId);
      const allExcluded = [...busyBedIds, ...usedBedsByOthers];
      const freeBed = roomBeds.find(b => !allExcluded.includes(b.id));
      const chosenBed = freeBed?.id || '';

      // Update room and bed for all KTVs sharing this baseIdx
      for (let i = baseIdx; i < Math.max(state.selectedKtvIds.length, idx + 1); i += (count || 1)) {
          while (nextRoomIds.length <= i) nextRoomIds.push('');
          while (nextBedIds.length <= i) nextBedIds.push('');
          while (nextNotes.length <= i) nextNotes.push('');
          
          nextRoomIds[i] = roomId;
          nextBedIds[i] = chosenBed;
          
          // 🧠 AUTO-REMINDERS
          const roomData = (rooms as any[]).find(r => r.id === roomId);
          if (roomData && roomData.default_reminders && Array.isArray(roomData.default_reminders)) {
            const defaultReminders = reminders
              .filter(rm => roomData.default_reminders.includes(rm.id))
              .map(rm => rm.content);
            
            if (defaultReminders.length > 0) {
              const currentNote = nextNotes[i] || '';
              const reminderStr = defaultReminders.join(' - ');
              if (!currentNote.includes(reminderStr)) {
                nextNotes[i] = currentNote ? `${currentNote} - ${reminderStr}` : reminderStr;
              }
            }
          }
      }
    } else {
      const baseIdx = idx % (count || 1);
      for (let i = baseIdx; i < Math.max(state.selectedKtvIds.length, idx + 1); i += (count || 1)) {
          while (nextRoomIds.length <= i) nextRoomIds.push('');
          while (nextBedIds.length <= i) nextBedIds.push('');
          nextRoomIds[i] = '';
          nextBedIds[i] = '';
      }
    }

    onUpdate({ 
      selectedRoomIds: nextRoomIds, 
      ktvBedIds: nextBedIds, 
      ktvNotes: nextNotes 
    });
  };

  const updateBedForIdx = (idx: number, bedId: string) => {
    const nextBedIds = [...(state.ktvBedIds || [])];
    const baseIdx = idx % (count || 1);
    
    for (let i = baseIdx; i < Math.max(state.selectedKtvIds.length, idx + 1); i += (count || 1)) {
        while (nextBedIds.length <= i) nextBedIds.push('');
        nextBedIds[i] = bedId;
    }

    onUpdate({ ktvBedIds: nextBedIds });
  };

  const updateNoteForIdx = (idx: number, note: string) => {
    const arr = [...(state.ktvNotes || [])]; while (arr.length <= idx) arr.push(''); arr[idx] = note; onUpdate({ ktvNotes: arr });
  };

  const updateServiceNameForIdx = (idx: number, name: string) => {
    const arr = [...(state.ktvServiceNames || [])]; while (arr.length <= idx) arr.push(''); arr[idx] = name; onUpdate({ ktvServiceNames: arr });
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

    // Update subsequent KTVs based on workMode
    for (let i = idx + 1; i < state.selectedKtvIds.length; i++) {
      while (durations.length <= i) durations.push(duration);
      while (starts.length <= i) starts.push('');
      while (ends.length <= i) ends.push('');
      
      if (state.workMode === 'sequential') {
          starts[i] = ends[i - 1];
      } else {
          starts[i] = starts[0];
      }
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
      
      // Update next KTVs based on workMode
      for (let i = idx + 1; i < state.selectedKtvIds.length; i++) {
        while (s.length <= i) s.push(''); while (e.length <= i) e.push('');
        while (d.length <= i) d.push(duration);
        if (state.workMode === 'sequential') {
            s[i] = e[i - 1];
        } else {
            s[i] = s[0];
        }
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
        const isAExt = a.employee_id.startsWith('EXT') || a.employee_id.startsWith('C_');
        const isBExt = b.employee_id.startsWith('EXT') || b.employee_id.startsWith('C_');
        if (isAExt && !isBExt) return 1;
        if (!isAExt && isBExt) return -1;
        
        if (a.turns_completed !== b.turns_completed) return (a.turns_completed || 0) - (b.turns_completed || 0);
        return (a.check_in_order || 0) - (b.check_in_order || 0);
    });
  }, [availableTurns, state.selectedKtvIds, ktvSearch]);

  const dateFormatted = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const getBadgeBg = (i: number) => ['bg-indigo-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500'][i % 5];
  
  const totalMergedCount = count + (groupItems[0]?.mergedServiceIds?.length || 0);
  
  const roundedClass = isFirstInGroup && isLastInGroup ? 'rounded-3xl' 
                     : isFirstInGroup ? 'rounded-t-3xl rounded-b-none border-b-0 pb-2' 
                     : isLastInGroup ? 'rounded-b-3xl rounded-t-none border-t-0 pt-2' 
                     : 'rounded-none border-b-0 border-t-0 py-2';
                     
  const headerRoundedClass = isFirstInGroup ? 'rounded-t-3xl' : 'rounded-none';
  const showHeader = !isChildOfBlock && isFirstInGroup;

  const hasGenderConflict = customerReqs?.genderReq?.toLowerCase().includes('nam') && customerReqs?.genderReq?.toLowerCase().includes('nữ');

  const wrapperClass = isChildOfBlock
    ? `overflow-visible transition-all ${state.isMergedGroup ? 'bg-purple-50/30' : 'bg-white'} ${!isLastInGroup ? 'border-b border-gray-100' : ''}`
    : `border-2 overflow-visible bg-white shadow-sm hover:shadow-md transition-all ${roundedClass} ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-200 shadow-md scale-[1.01] z-10 relative' : hasGenderConflict ? 'border-rose-400 ring-4 ring-rose-50/60 bg-rose-50/10' : state.isMergedGroup ? 'border-purple-300 ring-4 ring-purple-50/60 bg-purple-50/10 animate-merge' : (borderColorClass || 'border-gray-100')}`;

  return (<>
    <div className={wrapperClass}>
      {showHeader && (
        <div className={`px-4 py-3 border-b flex flex-col gap-2 ${headerRoundedClass} ${isSelected ? 'bg-indigo-50/50 border-indigo-100' : state.isMergedGroup ? 'bg-purple-50/50 border-purple-100' : 'bg-gray-50/80 border-gray-100'}`}>
        {/* Header Dòng 1: Mã Đơn + Checkbox */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                {onToggleSelect && (
                   <input type="checkbox" checked={isSelected} onChange={onToggleSelect} className="w-5 h-5 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                   {subOrderCode && (
                     <span className="bg-indigo-600 text-white text-[11px] font-black px-2.5 py-0.5 rounded-lg shadow-sm flex items-center gap-1">
                         📦 Đơn Con: {subOrderCode}
                     </span>
                   )}
                   {billCode && (
                     <>
                       <span className="text-xs text-slate-400 font-bold">•</span>
                       <span className="text-xs text-slate-500 font-bold">Mã chính: <span className="text-slate-800 font-black">{billCode}</span></span>
                     </>
                   )}
                   
                </div>
            </div>
            
            {onRemoveSvc && groupItems.length === 1 && orderId && (
              <button onClick={() => onRemoveSvc(orderId, groupItems[0].id)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors border border-rose-100 bg-white" title="Xóa dịch vụ">
                  <Trash2 size={14} />
              </button>
            )}
        </div>
      </div>
      )}
      
      {/* Container nội dung */}
      <div className={`${!showHeader ? 'pt-4' : 'pt-2'} pb-8 px-4`}>
        {/* Dòng 2: Tên Dịch vụ & Thời gian */}
        <div className="flex items-start justify-between flex-wrap gap-2 pl-2">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 w-full">
              {!showHeader && onToggleSelect && (
                 <input type="checkbox" checked={isSelected} onChange={onToggleSelect} className="w-5 h-5 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0" />
              )}
              {state.isUtility && <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-lg border border-amber-200 shrink-0">[Tiện ích]</span>}
              <input 
                type="text" 
                value={state.displayName} 
                onChange={e => onUpdate({ displayName: e.target.value })} 
                placeholder={serviceName}
                className={`font-black text-base bg-transparent border-b border-dashed hover:border-indigo-300 focus:border-indigo-500 outline-none w-full truncate ${state.isUtility ? 'text-amber-700 italic border-amber-300/50' : 'text-gray-900 border-gray-300/50'}`} 
              />
              {(!state.isUtility) && (
                 <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-1 rounded-xl text-xs font-black shrink-0">
                   {state.duration || duration}p
                 </span>
              )}
              {state.selectedKtvIds.length > count && <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-lg border border-amber-200 shrink-0">+{state.selectedKtvIds.length - count} nối tiếp</span>}
            </div>
            {state.isMergedGroup && groupItems.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <span className="bg-purple-100 text-purple-800 border border-purple-200 text-[10px] font-black px-2 py-0.5 rounded-md">
                        🔗 GỘP CHUNG KTV ({totalMergedCount} DỊCH VỤ)
                    </span>
                    {onUnmerge && (
                        <button onClick={onUnmerge} className="text-[11px] font-bold text-rose-600 hover:text-rose-800 underline">
                            Hủy gộp
                        </button>
                    )}
                    {groupItems[0]?.options?._generatedDisplayName && (
                        <span className="text-[11.5px] text-indigo-600 font-semibold truncate flex-1">
                            Gồm: {groupItems[0].options._generatedDisplayName}
                        </span>
                    )}
                </div>
            )}
            
            {/* KHỐI HIỂN THỊ YÊU CẦU & GHI CHÚ KHÁCH HÀNG */}
            {(customerReqs?.customerNote || customerReqs?.genderReq || customerReqs?.strength || customerReqs?.focus || customerReqs?.avoid) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {hasGenderConflict && (
                        <span className="bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 rounded flex items-center gap-1 text-[10px] font-black shrink-0" title="Yêu cầu giới tính KTV mâu thuẫn giữa các dịch vụ gộp!">
                            <AlertCircle size={10} /> Xung đột yêu cầu KTV
                        </span>
                    )}
                    
                    {customerReqs?.genderReq && !hasGenderConflict && (
                        <span className="bg-pink-50 text-pink-700 border border-pink-100 px-2 py-0.5 rounded text-[10px] font-black shrink-0">
                            👤 {customerReqs.genderReq}
                        </span>
                    )}
                    {customerReqs?.strength && (
                        <span className="bg-orange-50 text-orange-700 border border-orange-100 px-2 py-0.5 rounded text-[10px] font-bold shrink-0">
                            💪 Lực: {normalizeStrength(customerReqs.strength)}
                        </span>
                    )}
                    {(customerReqs?.focus || customerReqs?.avoid) && (
                        <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded text-[10px] font-bold shrink-0 truncate max-w-[150px]">
                            🎯 {customerReqs.focus ? formatBodyAreas(customerReqs.focus) : ''} {customerReqs.avoid ? `(Tránh ${formatBodyAreas(customerReqs.avoid)})` : ''}
                        </span>
                    )}
                    {customerReqs?.customerNote && (
                        <div className="group relative shrink-0">
                            <span className="bg-yellow-100 text-yellow-800 border border-yellow-200 px-2 py-0.5 rounded flex items-center gap-1 text-[10px] font-black cursor-help">
                                📝 {customerReqs.customerNote.split('|').length} Ghi chú
                            </span>
                            <div className="absolute hidden group-hover:block z-50 left-0 top-full mt-1 bg-gray-900 text-white text-xs rounded shadow-lg p-2 min-w-[200px] whitespace-pre-wrap">
                                {customerReqs.customerNote.split('|').map((note, nIdx) => (
                                    <div key={nIdx} className="mb-1 last:mb-0 text-yellow-300">
                                        • {note.trim()}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
          </div>
        </div>
        </div>
        
        <div className="space-y-4 mt-4 pl-2">
        {!state.isUtility && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
             <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                 Nhân viên ({state.selectedKtvIds.length}{count > 1 ? `/${count}` : ''})
             </label>
             {state.selectedKtvIds.length > 1 && (
                 <select 
                     className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-indigo-100 transition-colors"
                     value={state.workMode || 'parallel'}
                     onChange={(e) => {
                         const mode = e.target.value as 'parallel' | 'sequential';
                         const numKtvs = state.selectedKtvIds.length;
                         
                         const newDurs: number[] = [];
                         const newStarts: string[] = [];
                         const newEnds: string[] = [];
                         
                         let currentStart = (state.ktvStartTimes || [])[0] || getCurrentTime();
                         
                         for (let i = 0; i < numKtvs; i++) {
                             const partDur = mode === 'sequential' ? Math.round(duration / numKtvs) : duration;
                             newDurs.push(partDur);
                             newStarts.push(currentStart);
                             const eT = calcEndTime(currentStart, partDur);
                             newEnds.push(eT);
                             if (mode === 'sequential') {
                                 currentStart = eT; // next KTV starts when this one ends
                             }
                         }
                         
                         onUpdate({ workMode: mode, ktvDurations: newDurs, ktvStartTimes: newStarts, ktvEndTimes: newEnds });
                     }}
                 >
                     <option value="parallel">Song song (Cùng làm)</option>
                     <option value="sequential">Nối tiếp (Xoay tua)</option>
                 </select>
             )}
          </div>
          <div className="relative mb-2" ref={dropdownRef}>
            <div className="min-h-[56px] w-full px-3 py-2 border-2 border-indigo-100 rounded-2xl bg-indigo-50/20 flex flex-wrap gap-2 items-center cursor-text transition-colors hover:border-indigo-300 hover:bg-indigo-50/50" onClick={() => setIsKtvDropdownOpen(true)}>
              {state.selectedKtvIds.map((ktvId, idx) => { const t = availableTurns.find(t => t.employee_id === ktvId); const isExternal = ktvId.startsWith('EXT') || ktvId.startsWith('C_') || !t; const n = isExternal ? (state.ktvDisplayNames?.[ktvId] || ktvId) : ktvId; return (
                <span key={`${ktvId}-${idx}`} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black ${TAG_COLORS[idx % TAG_COLORS.length]} border shadow-sm`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{n}
                  {state.workMode === 'sequential' && <span className="ml-1 text-[9px] uppercase tracking-widest opacity-80 border-l pl-1 border-current">Ca {idx + 1}</span>}
                  <button onClick={(e) => { e.stopPropagation(); removeKtv(ktvId); }} className="ml-1 hover:opacity-60 bg-black/10 p-0.5 rounded-md"><X size={12} /></button>
                </span>); })}
              <input type="text" value={ktvSearch} onChange={e => { setKtvSearch(e.target.value); if (!isKtvDropdownOpen) setIsKtvDropdownOpen(true); }} onFocus={() => setIsKtvDropdownOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' && ktvSearch.trim()) { e.preventDefault(); const term = ktvSearch.toLowerCase().trim(); const m = availableTurns.find(t => t.employee_id.toLowerCase() === term || t.staff?.full_name?.toLowerCase() === term); if (m) addKtv(m.employee_id); else addKtv(ktvSearch.trim()); setKtvSearch(''); } }}
                placeholder={(() => {
                    const isFourhand = groupItems && groupItems.length > 0 && FOURHAND_SERVICES.includes(groupItems[0].serviceId || '');
                    if (isFourhand && state.selectedKtvIds.length < 2) return `⚠️ Dịch vụ 4 tay: Chọn KTV ${state.selectedKtvIds.length + 1}...`;
                    return state.selectedKtvIds.length === 0 ? '+ Chọn KTV...' : '+ Thêm (Ghép sô/Nối tiếp)...';
                })()} 
                className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm font-bold placeholder:text-gray-400 placeholder:italic py-1" />
            </div>
            {isKtvDropdownOpen && (
              <div className="absolute z-50 w-full mt-1 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 overflow-hidden">
                <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
                  {filteredTurns.map(turn => { const hasSkill = targetSkill ? turn.staff?.skills?.[targetSkill] === true : true; const isUsed = allSelectedKtvIds.includes(turn.employee_id) && !state.selectedKtvIds.includes(turn.employee_id); const isTypeAOrB = turn.staff?.work_type === 'TYPE_A' || turn.staff?.work_type === 'TYPE_B'; const displayName = isTypeAOrB ? turn.employee_id : (turn.staff?.full_name || turn.employee_id); return (
                    <div key={turn.employee_id} onClick={() => { addKtv(turn.employee_id); }}
                      className={`px-3 py-2 rounded-xl text-sm font-bold cursor-pointer transition-all flex items-center justify-between hover:bg-indigo-50 active:scale-[0.98] ${!hasSkill ? 'text-gray-400' : 'text-gray-700'}`}>
                      <div className="flex items-center gap-2"><span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded-md font-black text-slate-500">#{turn.check_in_order}</span><span>{displayName}</span>{turn.staff?.work_type && turn.staff.work_type !== 'TYPE_A' && <span className={`px-1 py-0.5 text-[8px] font-black rounded border leading-none ${turn.staff.work_type === 'TYPE_B' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>{turn.staff.work_type === 'TYPE_B' ? 'B' : 'C'}</span>}</div>
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
                const isExternal = ktvId.startsWith('EXT') || ktvId.startsWith('C_') || !t;
                const name = isExternal ? (state.ktvDisplayNames?.[ktvId] || ktvId) : ktvId;
                const selRoom = (state.selectedRoomIds || [])[idx] || '';
                const selBed = (state.ktvBedIds || [])[idx] || '';
                const startT = (state.ktvStartTimes || [])[idx] || '';
                const endT = (state.ktvEndTimes || [])[idx] || '';
                const ktvDur = (state.ktvDurations || [])[idx] || duration;
                const ktvNote = (state.ktvNotes || [])[idx] || '';
                const roomBedsList = selRoom ? beds.filter(b => b.roomId === selRoom) : [];
                return (
                <div key={`${ktvId}-${idx}`} 
                  draggable={true}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', idx.toString()); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => {
                    const src = parseInt(e.dataTransfer.getData('text/plain'));
                    if (!isNaN(src) && src !== idx) moveKtv(src, idx);
                  }}
                  className="bg-gray-50/50 rounded-xl px-3 py-2.5 border border-gray-100 space-y-1.5 cursor-grab active:cursor-grabbing hover:border-indigo-200 transition-colors">
                  {/* Row 1: Name | Room | Bed | Duration | Time | Print */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black text-white shrink-0 ${getBadgeBg(idx)}`}>{idx + 1}</span>
                    <span className="text-xs font-bold text-gray-700 truncate max-w-[100px]">{name}</span>
                    {idx < (count || 1) ? (
                        <>
                            <select value={selRoom} onChange={e => updateRoomForIdx(idx, e.target.value)} className="w-[70px] px-1.5 py-1 border border-gray-200 rounded-lg text-[11px] font-bold bg-white focus:ring-2 focus:ring-indigo-500/20 outline-none">
                              <option value="">P.</option>
                              {rooms.filter((r: any) => !r.name?.toLowerCase().includes('vệ sinh') && !r.name?.toLowerCase().includes('tắm')).map((r: any) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
                            </select>
                            {selRoom && (rooms as any[]).find(r => r.id === selRoom)?.has_guests && (
                              <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100 shrink-0" title="Phòng đang có khách (Chưa bàn giao xong)">⚠️ Khách</span>
                            )}
                            {selRoom && !((rooms as any[]).find(r => r.id === selRoom)?.has_guests) && (
                              <select 
                                value={selBed} 
                                onChange={e => updateBedForIdx(idx, e.target.value)} 
                                className="w-[55px] px-1 py-1 border border-emerald-200 text-emerald-700 bg-emerald-50 rounded-lg text-[10px] font-bold focus:ring-2 focus:ring-emerald-500/20 outline-none"
                              >
                                <option value="">G.</option>
                                {roomBedsList.map((b, bIdx) => (
                                  <option key={b.id} value={b.id}>G.{bIdx + 1}</option>
                                ))}
                              </select>
                            )}
                        </>
                    ) : (
                        <div className="flex items-center gap-1 shrink-0 max-w-[120px]">
                            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-lg border border-gray-200 truncate" title={`Cùng phòng/giường với KTV trên (KTV ${idx % (count || 1) + 1})`}>
                                {selRoom ? (rooms.find(r => r.id === selRoom)?.name || selRoom) : 'Chưa xếp'}
                                {selBed ? ` - G.${beds.filter(b => b.roomId === selRoom).findIndex(b => b.id === selBed) + 1}` : ''}
                            </span>
                        </div>
                    )}
                    <div className="relative">
                        <input
                            type="number"
                            min={0.1} max={300} step={0.1}
                            value={ktvDur || ''}
                            onChange={e => updateDurationForIdx(idx, e.target.value ? Number(e.target.value) : 0)}
                            onFocus={() => setOpenDurationIdx(idx)}
                            className={`w-[75px] px-2 py-1.5 border-2 rounded-xl text-[11px] font-black text-center outline-none transition-all pr-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none border-amber-100 text-amber-700 bg-amber-50 focus:border-amber-400`}
                            placeholder="Phút"
                        />
                        <button 
                            type="button"
                            onClick={() => setOpenDurationIdx(openDurationIdx === idx ? null : idx)}
                            className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 transition-colors text-amber-500 hover:text-amber-700`}
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
                    {(state.isMergedGroup || groupItems?.some((item: any) => item._splitTime !== undefined) || state.selectedKtvIds.length > 1) && (
                        <div className="flex-1 relative">
                            <input type="text" value={state.ktvServiceNames?.[idx] || ''} onChange={e => updateServiceNameForIdx(idx, e.target.value)} placeholder={groupItems?.[0]?.serviceName || "Tên DV..."} className="w-full px-2.5 py-1.5 border border-indigo-100 rounded-xl text-[11px] font-bold text-indigo-700 focus:ring-2 focus:ring-indigo-500/10 outline-none bg-indigo-50/30 placeholder:text-indigo-300 pr-8" />
                            {state.ktvServiceNames?.[idx] && (
                                <button onClick={() => updateServiceNameForIdx(idx, '')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-indigo-300 hover:text-indigo-500"><X size={12} /></button>
                            )}
                        </div>
                    )}
                    <div className="flex-[2] relative">
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
      const rName = rooms.find(r => r.id === rId)?.name || rId || '---'; const tName = state.ktvServiceNames?.[idx] ? state.ktvServiceNames[idx] : (state.displayName || serviceName);
      const sT = (state.ktvStartTimes || [])[idx] || '--:--'; const eT = (state.ktvEndTimes || [])[idx] || '--:--';
      const ticketDur = (state.ktvDurations || [])[idx] || duration;
      const ticketNote = (state.ktvNotes || [])[idx] || '';
      const ktvTurn = availableTurns.find(t => t.employee_id === ktvId);
      const ktvNameDisplay = ktvTurn?.staff?.full_name || ktvId;
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
              <div className="text-4xl font-black italic tracking-tight">{ktvNameDisplay}</div>
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
                            💪 Lực: {normalizeStrength(customerReqs.strength)}
                        </span>
                    )}
                    {customerReqs.focus && (
                        <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm">
                            🎯 Tập trung: {formatBodyAreas(customerReqs.focus)}
                        </span>
                    )}
                    {customerReqs.avoid && (
                        <span className="px-3 py-1.5 rounded-xl text-[10px] font-black border bg-rose-50 text-rose-700 border-rose-100 shadow-sm">
                            🚫 Tránh: {formatBodyAreas(customerReqs.avoid)}
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
