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
    
    orders.forEach(order => {
        const dynamicStartTimes = new Map<string, string>();
        const allStaffs: Array<{ st: any, svcId: string, svcDuration: number, svcTimeStart: string, origStart: string }> = [];
        
        order.services.forEach(svc => {
            const name = svc.serviceName?.toLowerCase() || '';
            const isPrivateRoom = (svc as any).is_utility === true || svc.serviceId === 'NHS0900' || (name.includes('phòng riêng') && !name.includes('+')) || (name.includes('phong rieng') && !name.includes('+'));
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
            const isPrivateRoom = (svc as any).is_utility === true || svc.serviceId === 'NHS0900' || (name.includes('phòng riêng') && !name.includes('+')) || (name.includes('phong rieng') && !name.includes('+'));
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

            let targetGroup = guestGroups.get(svc.guestId || '');
            if (!targetGroup) {
                const firstGroupId = Array.from(guestGroups.keys())[0];
                if (firstGroupId) {
                    targetGroup = guestGroups.get(firstGroupId);
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
            const isPrivateRoom = (svc as any).is_utility === true || svc.serviceId === 'NHS0900' || (name.includes('phòng riêng') && !name.includes('+')) || (name.includes('phong rieng') && !name.includes('+'));
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

        let groupIndex = 0;

        guestGroups.forEach((group, guestId) => {
            if (group.services.length === 0 && order.dispatchStatus !== 'pending') return;

            let isAllCompleted = true;
            let isAnyStarted = false;
            let isAllFeedback = true;
            const subKtvIds = new Set<string>();
            let calculatedStart = '';

            group.services.forEach(svc => {
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

            const updatedServices = group.services.map(svc => {
                let dStatus = svc.status || 'NEW';
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
                return { ...svc, status: dStatus };
            });

            const statuses = updatedServices.map(s => s.status || 'NEW');
            let dispatchStatus = 'PREPARING';
            if (statuses.includes('IN_PROGRESS') || statuses.includes('PAUSED')) dispatchStatus = 'IN_PROGRESS';
            else if (statuses.includes('PREPARING')) dispatchStatus = 'PREPARING';
            else if (statuses.includes('CLEANING')) dispatchStatus = 'CLEANING';
            else if (statuses.includes('FEEDBACK')) dispatchStatus = 'FEEDBACK';
            else if (statuses.includes('DONE')) dispatchStatus = 'DONE';
            else dispatchStatus = 'pending';

            if (subKtvIds.size === 0) {
                dispatchStatus = 'pending';
            }
            if (order.dispatchStatus === 'pending') {
                dispatchStatus = 'pending';
            }

            let subOrderRating: number | null = null;
            let maxRating: number | null = null;
            updatedServices.forEach(svc => {
                const subKtvIdsArray = Array.from(subKtvIds);
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

            if (subOrderRating === null) {
                const hasDetailedRating = order.services.some((svc: any) => 
                    svc.itemRating != null || 
                    (svc.ktvRatings && Object.keys(svc.ktvRatings).length > 0)
                );
                if (!hasDetailedRating) subOrderRating = order.rating ?? null;
            }

            if (!calculatedStart) calculatedStart = order.timeStart || order.time || '';

            resultForOrder.push({
                id: guestId !== 'default' ? guestId : `${order.id}_guest${groupIndex}`,
                bookingId: order.id,
                originalOrder: order,
                services: updatedServices,
                dispatchStatus,
                guest: group.guest,
                ktvSignature: guestId, // Legacy
                ktvIds: Array.from(subKtvIds),
                calculatedStart,
                rating: subOrderRating,
                subSuffix: group.guest?.guestLabel || String.fromCharCode(65 + groupIndex)
            });
            groupIndex++;
        });

        const privateRooms = order.services.filter(svc => {
            const name = svc.serviceName?.toLowerCase() || '';
            return (svc as any).is_utility === true || svc.serviceId === 'NHS0900' || (name.includes('phòng riêng') && !name.includes('+')) || (name.includes('phong rieng') && !name.includes('+'));
        });
        
        if (privateRooms.length > 0) {
            const utilityServices = privateRooms.map(pr => ({ ...pr, isUtility: true }));
            if (resultForOrder.length > 0) {
                resultForOrder[0].services.push(...utilityServices as ServiceBlock[]);
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
                    calculatedStart: order.timeStart || '',
                    rating: utilityRating
                });
            }
        }

        result.push(...resultForOrder);
    });

    return result;
}
