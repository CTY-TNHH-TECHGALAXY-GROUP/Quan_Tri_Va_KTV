import { isUtilityService } from '@/lib/booking.logic';
import { PendingOrder, ServiceBlock, GuestBlock } from '../types';

export const formatToHourMinute = (isoString: string | null | undefined): string => {
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

export const getDynamicEndTime = (startStr?: string | null, durationMins: number = 60) => {
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

export interface SubOrder {
    id: string; // guest_id or bookingId_fallback
    bookingId: string;
    originalOrder: PendingOrder;
    services: ServiceBlock[];
    dispatchStatus: string;
    guest: GuestBlock | null;
    ktvSignature: string; // Kept for backward compatibility
    ktvIds: string[]; // Explicit array of KTV IDs for this suborder
    calculatedStart: string; // The dynamically calculated start time
    rating?: number | null;
    subSuffix?: string | null;
}

export function buildOrderTimeline(orders: PendingOrder[]): SubOrder[] {
    const result: SubOrder[] = [];
    
    // Track globally used suffixes per parent booking to avoid conflicts when splitting
    const usedSuffixesByParent = new Map<string, Set<string>>();
    orders.forEach(o => {
        const pId = o.parentBookingId || o.id;
        if (!usedSuffixesByParent.has(pId)) usedSuffixesByParent.set(pId, new Set());
        const set = usedSuffixesByParent.get(pId)!;
        if (o.guests) {
            o.guests.forEach(g => {
                if (g.guestLabel) set.add(g.guestLabel.toUpperCase());
            });
        }
        // Also extract from billCode (e.g. DK4F-B means B is used)
        if (o.billCode) {
            const match = o.billCode.match(/-([A-Z])$/i);
            if (match) { set.add(match[1].toUpperCase()); o.subSuffix = match[1].toUpperCase(); }
        }
    });

    orders.forEach(order => {
        const dynamicStartTimes = new Map<string, string>();
        const allStaffs: Array<{ st: any, svcId: string, svcDuration: number, svcTimeStart: string, origStart: string }> = [];
        
        order.services.forEach(svc => {
            const name = svc.serviceName?.toLowerCase() || '';
            const isPrivateRoom = isUtilityService(svc);
            if (isPrivateRoom) return;
            
            const opts = typeof (svc as any).options === 'string' ? JSON.parse((svc as any).options) : ((svc as any).options || {});
            if (opts.mergedIntoId) return;
            
            if (!svc.staffList) return;
            
            svc.staffList.forEach(st => {
                const seg = st.segments?.[0];
                const origStart = seg?.startTime || '';
                allStaffs.push({
                    st,
                    svcId: svc.id,
                    svcDuration: Number(svc.duration) || 60,
                    svcTimeStart: svc.timeStart || '',
                    origStart
                });
            });
        });

        allStaffs.sort((a, b) => a.origStart.localeCompare(b.origStart));

        let currentMaxEndStr = '';
        let lastGroupStartTime = '';
        let lastGroupCalculatedStart = '';

        allStaffs.forEach((item, idx) => {
            const { st, svcId, svcDuration, svcTimeStart, origStart } = item;
            const seg = st.segments?.[0];
            
            let calculatedStart = origStart || svcTimeStart || '';

            if (idx > 0) {
                if (origStart === lastGroupStartTime) {
                    calculatedStart = lastGroupCalculatedStart;
                } else if (currentMaxEndStr) {
                    calculatedStart = currentMaxEndStr > origStart ? currentMaxEndStr : origStart;
                }
            }

            dynamicStartTimes.set(`${svcId}_${st.ktvId}`, calculatedStart);

            const runtimeAnchor = seg?.actualStartTime || calculatedStart;
            const duration = Number(seg?.duration) || svcDuration;
            const ktvEnd = seg?.actualEndTime || getDynamicEndTime(runtimeAnchor, duration);

            if (origStart !== lastGroupStartTime) {
                currentMaxEndStr = ktvEnd;
            } else {
                if (ktvEnd > currentMaxEndStr) currentMaxEndStr = ktvEnd;
            }

            lastGroupStartTime = origStart;
            lastGroupCalculatedStart = calculatedStart;
        });

        const resultForOrder: SubOrder[] = [];
        
        const guestGroups = new Map<string, { guest: GuestBlock | null; services: ServiceBlock[] }>();
        const noGuestServices: ServiceBlock[] = [];

        if (order.guests && order.guests.length > 0) {
            order.guests.forEach(g => {
                guestGroups.set(g.id, { guest: g, services: [] });
            });
        } else {
            guestGroups.set('default', { guest: null, services: [] });
        }

        order.services.forEach(svc => {
            const name = svc.serviceName?.toLowerCase() || '';
            const isPrivateRoom = isUtilityService(svc);
            if (isPrivateRoom) return; 

            const opts = typeof (svc as any).options === 'string' ? JSON.parse((svc as any).options) : ((svc as any).options || {});
            if (opts.mergedIntoId) return;

            if (svc.staffList) {
                svc.staffList = svc.staffList.map(st => {
                    const origStart = st.segments?.[0]?.startTime || svc.timeStart || 'unknown';
                    const calculatedStart = dynamicStartTimes.get(`${svc.id}_${st.ktvId}`) || origStart;
                    return { ...st, _calculatedStartTime: calculatedStart };
                });
            }

            let targetGroup = guestGroups.get(svc.guestId || svc.customerGroupId || '');
            
            // 🔧 Tách các dịch vụ chưa có KTV và đang ở trạng thái pending thành các SubOrder riêng biệt
            // Điều này giúp Lễ Tân dễ dàng thấy và điều phối từng dịch vụ một trong cột "Chờ xếp ca"
            const hasKtv = svc.staffList && svc.staffList.length > 0;
            const isWaiting = svc.status === 'NEW' || svc.status === 'WAITING' || !svc.status;
            
            // 🔥 SỬA LỖI: Chỉ tách riêng nếu dịch vụ CHƯA CÓ GUEST ID (đơn cũ/walk-in không chia khách).
            // Nếu đã thuộc về một Khách cụ thể (vd Khách A, Khách B), thì PHẢI gộp chung vào Khách đó
            // để không bị "ẩn" khỏi UI khi ấn Thêm Dịch Vụ từ trong modal của khách đó.
            if (!hasKtv && isWaiting && !svc.guestId && !svc.customerGroupId) {
                const uniqueGroupId = `split-${svc.id}`;
                guestGroups.set(uniqueGroupId, { guest: targetGroup?.guest || null, services: [] });
                targetGroup = guestGroups.get(uniqueGroupId);
            } else if (!targetGroup) {
                // Nếu dịch vụ CÓ customerGroupId hoặc guestId rõ ràng nhưng không nằm trong order.guests
                // (ví dụ: khi user bấm "Tách Khách"), ta tạo một group mới để tách nó thành SubOrder riêng biệt.
                if (svc.guestId || svc.customerGroupId) {
                    const newGroupId = svc.guestId || svc.customerGroupId || `split-${svc.id}`;
                    guestGroups.set(newGroupId, { guest: null, services: [] });
                    targetGroup = guestGroups.get(newGroupId);
                } else {
                    // Nếu không có cả customerGroupId và guestId, gom chung vào group mặc định đầu tiên
                    const firstGroupId = Array.from(guestGroups.keys())[0];
                    if (firstGroupId) {
                        targetGroup = guestGroups.get(firstGroupId);
                    }
                }
            }

            if (targetGroup) {
                targetGroup.services.push(svc);
            } else {
                noGuestServices.push(svc);
            }
        });

        order.services.forEach(svc => {
            const name = svc.serviceName?.toLowerCase() || '';
            const isPrivateRoom = isUtilityService(svc);
            if (isPrivateRoom) return; 

            const opts = typeof (svc as any).options === 'string' ? JSON.parse((svc as any).options) : ((svc as any).options || {});
            if (opts.mergedIntoId) {
                let foundParent = false;
                for (let group of guestGroups.values()) {
                    if (group.services.some(s => s.id === opts.mergedIntoId)) {
                        group.services.push(svc);
                        foundParent = true;
                        break; // Stop searching once found
                    }
                }
                if (!foundParent) {
                    noGuestServices.push(svc);
                }
            }
        });

        const pId = order.parentBookingId || order.id;
        const globalUsedSet = usedSuffixesByParent.get(pId)!;
        const localUsedSet = new Set<string>();
        
        let groupIndex = 0;
        let hasUsedOrderSubSuffix = false;

        guestGroups.forEach((group, guestId) => {
            if (group.services.length === 0 && order.dispatchStatus !== 'pending') return;
            
            let calculatedSuffix = group.guest?.guestLabel || '';
            
            // Allocate the original booking's suffix to the first group that needs it
            if (!calculatedSuffix && !hasUsedOrderSubSuffix && order.subSuffix) {
                calculatedSuffix = order.subSuffix;
                hasUsedOrderSubSuffix = true;
            }

            // If we have a suffix but it's ALREADY USED LOCALLY (conflict within this order), we must clear it and invent a new one.
            if (calculatedSuffix && localUsedSet.has(calculatedSuffix.toUpperCase())) {
                calculatedSuffix = '';
            }

            // If we don't have a suffix, invent a new one using the GLOBAL and LOCAL sets
            if (!calculatedSuffix) {
                for (let i = 0; i < 26; i++) {
                    const char = String.fromCharCode(65 + i);
                    if (!globalUsedSet.has(char) && !localUsedSet.has(char)) {
                        calculatedSuffix = char;
                        break;
                    }
                }
                if (!calculatedSuffix) calculatedSuffix = `G${groupIndex}`; // fallback
            }
            
            localUsedSet.add(calculatedSuffix.toUpperCase());
            globalUsedSet.add(calculatedSuffix.toUpperCase());

            let isAllCompleted = true;
            let isAnyStarted = false;
            let isAllFeedback = true;
            const subKtvIds = new Set<string>();
            let calculatedStart = '';

            
            // [Antigravity] SPLIT SERVICES BY CALCULATED START TIME FOR SEQUENTIAL (NỐI TIẾP)
            const splitGroupServices: ServiceBlock[] = [];
            group.services.forEach(svc => {
                if (svc.staffList && svc.staffList.length > 1) {
                    const staffByTime = new Map<string, any[]>();
                    svc.staffList.forEach(st => {
                        const t = st._calculatedStartTime || 'unknown';
                        if (!staffByTime.has(t)) staffByTime.set(t, []);
                        staffByTime.get(t)!.push(st);
                    });
                    
                    // Chỉ xem là ca nối tiếp nếu thực sự có nhiều KTV (có ktvId) với giờ bắt đầu khác nhau
                    const validKtvTimes = Array.from(staffByTime.entries()).filter(([time, staffs]) => staffs.some(st => st.ktvId));
                    if (validKtvTimes.length > 1) {
                        // Split into multiple virtual service blocks
                        const sortedTimes = Array.from(staffByTime.keys()).sort();
                        const firstValidTime = sortedTimes.find(time => staffByTime.get(time)!.some(st => st.ktvId)) || sortedTimes[0];
                        sortedTimes.forEach(time => {
                            const staffs = staffByTime.get(time)!;
                            const isFirst = time === firstValidTime;
                            splitGroupServices.push({ 
                                ...svc, 
                                staffList: staffs, 
                                _splitTime: time,
                                _isSequentialFollowUp: !isFirst
                            });
                        });
                    } else {
                        splitGroupServices.push(svc);
                    }
                } else {
                    splitGroupServices.push(svc);
                }
            });

            splitGroupServices.forEach(svc => {
                if (svc.staffList && svc.staffList.length > 0) {
                    svc.staffList.forEach((st: any) => {
                        subKtvIds.add(st.ktvId);
                        if (!st.segments || st.segments.length === 0) {
                            isAllCompleted = false;
                            isAllFeedback = false;
                        }
                        st.segments?.forEach((seg: any) => {
                            if (seg.actualStartTime) isAnyStarted = true;
                            if (!seg.actualEndTime) isAllCompleted = false;
                            if (!seg.feedbackTime) isAllFeedback = false;
                        });
                        
                        if (!calculatedStart && st._calculatedStartTime) {
                            calculatedStart = st._calculatedStartTime;
                        } else if (st._calculatedStartTime && st._calculatedStartTime < calculatedStart) {
                            calculatedStart = st._calculatedStartTime;
                        }
                    });
                } else {
                    isAllCompleted = false;
                    isAllFeedback = false;
                }
            });

            const updatedServicesTemp = splitGroupServices.map(svc => {
                let dStatus = svc.status || 'NEW';
                const opts = typeof (svc as any).options === 'string' ? JSON.parse((svc as any).options) : ((svc as any).options || {});
                
                if (opts.mergedIntoId) {
                    return { ...svc, status: dStatus, _isChild: true, _parentId: opts.mergedIntoId, _splitTime: (svc as any)._splitTime };
                }

                if (dStatus !== 'CANCELLED' && dStatus !== 'DONE' && dStatus !== 'PAUSED') {
                    let svcAllComp = true, svcAnyStart = false, svcAllFb = true;
                    if (!svc.staffList || svc.staffList.length === 0) {
                        svcAllComp = false; svcAllFb = false;
                    } else {
                        svc.staffList.forEach((st:any) => {
                            if (!st.segments || st.segments.length === 0) { svcAllComp = false; svcAllFb = false; }
                            st.segments?.forEach((seg:any) => {
                                if (seg.actualStartTime) svcAnyStart = true;
                                if (!seg.actualEndTime) svcAllComp = false;
                                if (!seg.feedbackTime) svcAllFb = false;
                            });
                        });
                    }
                    if (svcAllFb && svcAllComp) dStatus = 'FEEDBACK';
                    else if (svcAllComp) dStatus = 'CLEANING';
                    else if (svcAnyStart) dStatus = 'IN_PROGRESS';
                    else dStatus = 'PREPARING';
                }
                return { ...svc, status: dStatus, _isChild: false, _splitTime: (svc as any)._splitTime };
            });

            const updatedServices = updatedServicesTemp.map(svc => {
                if (svc._isChild && (svc as any)._parentId) {
                    const parent = updatedServicesTemp.find(p => p.id === (svc as any)._parentId);
                    if (parent && parent.status) {
                        return { ...svc, status: parent.status };
                    }
                }
                return svc;
            });
// Helper function to map individual service status to a Kanban Phase
            const getServicePhase = (st: string) => {
                if (['IN_PROGRESS', 'PAUSED'].includes(st)) return 'IN_PROGRESS';
                if (['CLEANING', 'COMPLETED'].includes(st)) return 'CLEANING';
                if (['FEEDBACK', 'DONE', 'CANCELLED'].includes(st)) return 'FEEDBACK';
                return 'PREPARING';
            };

            
            const servicesByPhase = new Map<string, ServiceBlock[]>();
            
            updatedServices.forEach(svc => {
                let phase = getServicePhase(svc.status || 'NEW');
                
                // Keep child services grouped with their parent's phase
                if (svc._isChild && (svc as any)._parentId) {
                    const parent = updatedServices.find(p => p.id === (svc as any)._parentId);
                    if (parent) {
                        phase = getServicePhase(parent.status || 'NEW');
                    }
                }

                // If subOrder is completely pending (no KTV assigned to anything)
                if (subKtvIds.size === 0 || order.dispatchStatus === 'pending') {
                    phase = 'pending';
                }

                // [Antigravity] To guarantee separated Kanban cards for "Nối tiếp" even if they share the same phase,
                // we group by phase AND _splitTime.
                let groupingKey = phase;
                if ((svc as any)._splitTime) {
                    groupingKey = `${phase}#${(svc as any)._splitTime}`;
                }

                if (!servicesByPhase.has(groupingKey)) servicesByPhase.set(groupingKey, []);
                servicesByPhase.get(groupingKey)!.push(svc);
            });
// Nếu tất cả các services cuối cùng đều thuộc FEEDBACK/DONE, chúng sẽ tự động gom vào 1 phase 'FEEDBACK'.
            // Nếu có cái CLEANING, có cái IN_PROGRESS, chúng sẽ chia thành 2 phase (2 thẻ trên Kanban).

            servicesByPhase.forEach((phaseServices, groupingKey) => {
                const phase = groupingKey.split('#')[0]; // Extract actual phase
                let phaseDispatchStatus = phase;
                if (phaseDispatchStatus === 'pending') phaseDispatchStatus = order.dispatchStatus === 'pending' ? 'pending' : 'PREPARING';

                const phaseSubKtvIds = new Set<string>();
                let phaseCalculatedStart = '';

                phaseServices.forEach(svc => {
                    if (svc.staffList) {
                        svc.staffList.forEach((st: any) => {
                            phaseSubKtvIds.add(st.ktvId);
                            if (!phaseCalculatedStart && st._calculatedStartTime) {
                                phaseCalculatedStart = st._calculatedStartTime;
                            } else if (st._calculatedStartTime && st._calculatedStartTime < phaseCalculatedStart) {
                                phaseCalculatedStart = st._calculatedStartTime;
                            }
                        });
                    }
                });

                let subOrderRating: number | null = null;
                let maxRating: number | null = null;
                phaseServices.forEach(svc => {
                    const subKtvIdsArray = Array.from(phaseSubKtvIds);
                    if (subKtvIdsArray.length > 0) {
                        subKtvIdsArray.forEach(ktvId => {
                            let r = 0;
                            const ktvRatings = (svc as any).ktvRatings || {};
                            const key = Object.keys(ktvRatings).find(k => k.toLowerCase() === ktvId.toLowerCase());
                            if (key) r = Number(ktvRatings[key]) || 0;
                            if (r === 0) r = Number((svc as any).itemRating) || 0;
                            if (r > 0 && (maxRating === null || r > maxRating)) maxRating = r;
                        });
                    } else {
                        const r = Number((svc as any).itemRating) || 0;
                        if (r > 0 && (maxRating === null || r > maxRating)) maxRating = r;
                    }
                });
                subOrderRating = maxRating;

                if (!phaseCalculatedStart) phaseCalculatedStart = order.timeBooking || order.time || '';

                // Create a unique ID for this SubOrder split by Phase, so they render as distinct cards
                // Also factor in _splitTime to ensure uniqueness
                const splitIdSuffix = servicesByPhase.size > 1 ? `_${groupingKey}` : '';
                const baseId = guestId !== 'default' ? `${order.id}_${guestId}` : `${order.id}_guest${groupIndex}`;

                resultForOrder.push({
                    id: `${baseId}${splitIdSuffix}`,
                    bookingId: order.id,
                    originalOrder: order,
                    services: phaseServices,
                    dispatchStatus: phaseDispatchStatus,
                    guest: group.guest,
                    ktvSignature: guestId, // Legacy
                    ktvIds: Array.from(phaseSubKtvIds),
                    calculatedStart: phaseCalculatedStart,
                    rating: subOrderRating,
                    subSuffix: calculatedSuffix
                });
            });
            groupIndex++;
        });

        const privateRooms = order.services.filter(svc => {
            const name = svc.serviceName?.toLowerCase() || '';
            return isUtilityService(svc);
        });
        
        if (privateRooms.length > 0) {
            const utilityServices = privateRooms.map(pr => ({ ...pr, isUtility: true }));
            if (resultForOrder.length > 0) {
                let targetBlock = resultForOrder.find(ro => ro.services.some(s => !(s as any)._isSequentialFollowUp));
                if (!targetBlock) targetBlock = resultForOrder[0];
                targetBlock.services.push(...utilityServices as ServiceBlock[]);
            } else {
                const statuses = utilityServices.map(s => s.status || 'NEW');
                let dStatus = 'PREPARING';
                if (statuses.includes('IN_PROGRESS') || statuses.includes('PAUSED')) dStatus = 'IN_PROGRESS';
                else if (statuses.includes('CLEANING')) dStatus = 'CLEANING';
                else if (statuses.includes('FEEDBACK')) dStatus = 'FEEDBACK';
                else if (statuses.includes('DONE') || statuses.includes('CANCELLED')) dStatus = 'DONE';
                else if (statuses.includes('PREPARING')) dStatus = 'PREPARING';

                let utilityRating: number | null = null;
                utilityServices.forEach(svc => {
                    const r = Number((svc as any).itemRating) || 0;
                    if (r > 0 && (utilityRating === null || r > utilityRating)) utilityRating = r;
                });
                if (utilityRating === null) {
                    const hasDetailedRating = order.services.some((svc: any) => 
                        svc.itemRating != null || (svc.ktvRatings && Object.keys(svc.ktvRatings).length > 0)
                    );
                    if (!hasDetailedRating) utilityRating = order.rating ?? null;
                }

                resultForOrder.push({
                    id: `${order.id}_utility`,
                    bookingId: order.id,
                    originalOrder: order,
                    services: utilityServices as ServiceBlock[],
                    dispatchStatus: dStatus as any,
                    guest: null,
                    ktvSignature: 'utility',
                    ktvIds: [],
                    calculatedStart: order.timeBooking || order.time || '',
                    rating: utilityRating
                });
            }
        }

        result.push(...resultForOrder);
    });

    return result;
}
