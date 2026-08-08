import { PendingOrder, ServiceBlock } from '../types';

export const formatToHourMinute = (isoString: string | null | undefined): string => {
    if (!isoString) return '--:--';
    if (/^\d{1,2}:\d{2}$/.test(isoString)) return isoString;
    
    // Normalize string to ISO if possible
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
    id: string; // bookingId_subId (unique for kanban cards)
    bookingId: string;
    originalOrder: PendingOrder;
    services: ServiceBlock[];
    dispatchStatus: string;
    ktvSignature: string; // Kept for backward compatibility
    ktvIds: string[]; // Explicit array of KTV IDs for this suborder
    calculatedStart: string; // The dynamically calculated start time
    rating?: number | null;
}

export function buildOrderTimeline(orders: PendingOrder[]): SubOrder[] {
    const result: SubOrder[] = [];
    
    orders.forEach(order => {
        // Nếu là order pending chưa phân KTV
        if (order.dispatchStatus === 'pending') {
            // Giữ lại phòng riêng để Lễ tân kiểm tra, đánh dấu isUtility để ẩn KTV picker
            const pendingServices = order.services.map(svc => {
                const isPrivateRoom = (svc as any).is_utility === true || svc.serviceId === 'NHS0900' ||
                    svc.serviceName?.toLowerCase().includes('phòng riêng') ||
                    svc.serviceName?.toLowerCase().includes('phong rieng'); // Legacy fallback
                return isPrivateRoom ? { ...svc, isUtility: true } : svc;
            });
            
            if (pendingServices.length > 0) {
                // Tự suy diễn status của pending order (thường là NEW hoặc PREPARING)
                const statuses = pendingServices.map(s => s.status || 'NEW');
                let dispatchStatus = 'pending';
                if (statuses.includes('NEW')) dispatchStatus = 'pending'; // Để chung cột chờ điều phối
                
                result.push({
                    id: `${order.id}_pending_order`,
                    bookingId: order.id,
                    originalOrder: order,
                    services: pendingServices.map(svc => ({ ...svc, status: svc.status || 'NEW' })),
                    dispatchStatus,
                    ktvSignature: 'pending_order',
                    ktvIds: [],
                    calculatedStart: order.timeStart || order.time || ''
                });
            }
            return;
        }

        // TÍNH TOÁN GIỜ NỐI TIẾP (DYNAMIC TIMELINE) CHO TOÀN BỘ ORDER
        const dynamicStartTimes = new Map<string, string>();
        
        // Quét toàn bộ KTV của tất cả các dịch vụ (bỏ qua phòng riêng)
        // Để liên kết xuyên dịch vụ (cross-service), ta gộp tất cả staffList vào 1 mảng lớn, 
        // nhưng hiện tại logic QuickBooking tạo 2 dòng dịch vụ độc lập có startTime khác nhau.
        // Thay vì gộp, ta tính toán theo từng dịch vụ như cũ, NHƯNG nếu muốn nối tiếp XUYÊN DỊCH VỤ, 
        // ta phải sort tất cả staff theo startTime gốc!

        const allStaffs: Array<{ st: any, svcId: string, svcDuration: number, svcTimeStart: string, origStart: string }> = [];
        
        order.services.forEach(svc => {
            if ((svc as any).is_utility === true || svc.serviceId === 'NHS0900' || svc.serviceName?.toLowerCase().includes('phòng riêng') || svc.serviceName?.toLowerCase().includes('phong rieng')) return; // Legacy fallback
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

        // Sắp xếp toàn bộ KTV theo giờ xuất phát gốc
        allStaffs.sort((a, b) => a.origStart.localeCompare(b.origStart));

        let currentMaxEndStr = '';
        let lastGroupStartTime = '';
        let lastGroupCalculatedStart = '';

        allStaffs.forEach((item, idx) => {
            const { st, svcId, svcDuration, svcTimeStart, origStart } = item;
            const seg = st.segments?.[0];
            
            // Ưu tiên runtime anchor: actualStartTime -> item.timeStart -> segment.startTime
            // Tuy nhiên, thời gian gốc để TÍNH TOÁN mốc nối tiếp nên dựa vào origStart
            let calculatedStart = origStart || svcTimeStart || '';

            if (idx > 0) {
                if (origStart === lastGroupStartTime) {
                    // Fourhand: xài chung giờ nhóm
                    calculatedStart = lastGroupCalculatedStart;
                } else if (currentMaxEndStr) {
                    // Nối tiếp xuyên dịch vụ!
                    // Chỉ đẩy lùi giờ (push forward) nếu dịch vụ trước kết thúc TRỄ hơn giờ dự kiến.
                    // KHÔNG tự động kéo giờ lên sớm (pull backward) nếu dịch vụ trước kết thúc sớm.
                    calculatedStart = currentMaxEndStr > origStart ? currentMaxEndStr : origStart;
                }
            }

            dynamicStartTimes.set(`${svcId}_${st.ktvId}`, calculatedStart);

            // Tính End Time động
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

        // XÂY DỰNG SUB-ORDERS
        const ktvGroups = new Map<string, ServiceBlock[]>();
        const groupKtvIds = new Map<string, string[]>();
        const groupCalculatedStarts = new Map<string, string>();

        order.services.forEach(svc => {
            if ((svc as any).is_utility === true || svc.serviceId === 'NHS0900' || svc.serviceName?.toLowerCase().includes('phòng riêng') || svc.serviceName?.toLowerCase().includes('phong rieng')) return; // Legacy fallback
            
            if (svc.staffList && svc.staffList.length > 0) {
                const timeGroups = new Map<string, { calculatedStart: string, staffs: any[] }>();
                
                svc.staffList.forEach(st => {
                    const origStart = st.segments?.[0]?.startTime || svc.timeStart || 'unknown';
                    const calculatedStart = dynamicStartTimes.get(`${svc.id}_${st.ktvId}`) || origStart;
                    const stClone = { ...st, _calculatedStartTime: calculatedStart };
                    if (!timeGroups.has(origStart)) timeGroups.set(origStart, { calculatedStart, staffs: [] });
                    timeGroups.get(origStart)!.staffs.push(stClone);
                });

                timeGroups.forEach((groupInfo, origStart) => {
                    // Group by the exact set of KTVs so 1 KTV with 3 services becomes 1 Kanban Card
                    const assignedKtvIds = groupInfo.staffs.map((s: any) => s.ktvId).filter(Boolean).sort().join('-');
                    const ktvSignature = assignedKtvIds ? `ktvgrp_${assignedKtvIds}` : `svc_${svc.id}_${origStart.replace(/:/g, '')}`; 
                    
                    if (!ktvGroups.has(ktvSignature)) {
                        ktvGroups.set(ktvSignature, []);
                        groupKtvIds.set(ktvSignature, groupInfo.staffs.map((s: any) => s.ktvId));
                        groupCalculatedStarts.set(ktvSignature, groupInfo.calculatedStart);
                    }
                    
                    let isAllCompleted = true;
                    let isAnyStarted = false;
                    let isAllFeedback = true;
                    
                    groupInfo.staffs.forEach((st: any) => {
                        if (!st.segments || st.segments.length === 0) {
                            isAllCompleted = false;
                            isAllFeedback = false;
                        }
                        st.segments?.forEach((seg: any) => {
                            if (seg.actualStartTime) isAnyStarted = true;
                            if (!seg.actualEndTime) isAllCompleted = false;
                            if (!seg.feedbackTime) isAllFeedback = false;
                        });
                    });
                    
                    let derivedStatus = svc.status || 'NEW';
                    if (derivedStatus !== 'CANCELLED' && derivedStatus !== 'DONE' && derivedStatus !== 'PAUSED') {
                        if (isAllFeedback && isAllCompleted) derivedStatus = 'FEEDBACK';
                        else if (isAllCompleted) derivedStatus = 'CLEANING';
                        else if (isAnyStarted) derivedStatus = 'IN_PROGRESS';
                        else derivedStatus = 'PREPARING';
                    }

                    const svcClone = {
                        ...svc,
                        staffList: groupInfo.staffs,
                        status: derivedStatus
                    };
                    ktvGroups.get(ktvSignature)!.push(svcClone);
                });
            } else {
                const ktvSignature = `${svc.id}_unassigned`;
                if (!ktvGroups.has(ktvSignature)) {
                    ktvGroups.set(ktvSignature, []);
                    groupKtvIds.set(ktvSignature, []);
                    groupCalculatedStarts.set(ktvSignature, svc.timeStart || '');
                }
                ktvGroups.get(ktvSignature)!.push(svc);
            }
        });

        const resultForOrder: SubOrder[] = [];
        ktvGroups.forEach((services, ktvSignature) => {
            const statuses = services.map(s => s.status || 'NEW');
            let dispatchStatus = 'PREPARING';
            if (statuses.includes('IN_PROGRESS') || statuses.includes('PAUSED')) dispatchStatus = 'IN_PROGRESS';
            else if (statuses.includes('PREPARING') || statuses.includes('NEW') || statuses.includes('WAITING')) dispatchStatus = 'PREPARING';
            else if (statuses.includes('CLEANING')) dispatchStatus = 'CLEANING';
            else if (statuses.includes('FEEDBACK')) dispatchStatus = 'FEEDBACK';
            else dispatchStatus = 'DONE';

            const subKtvIds = groupKtvIds.get(ktvSignature) || [];
            let subOrderRating: number | null = null;
            if (subKtvIds.length > 0) {
                let maxRating: number | null = null;
                services.forEach(svc => {
                    subKtvIds.forEach(ktvId => {
                        let r = 0;
                        const ktvRatings = (svc as any).ktvRatings || {};
                        const key = Object.keys(ktvRatings).find(k => k.toLowerCase() === ktvId.toLowerCase());
                        if (key) {
                            r = Number(ktvRatings[key]) || 0;
                        }
                        if (r === 0) {
                            r = Number((svc as any).itemRating) || 0;
                        }
                        if (r > 0) {
                            if (maxRating === null || r > maxRating) maxRating = r;
                        }
                    });
                });
                subOrderRating = maxRating;
            } else {
                let maxRating: number | null = null;
                services.forEach(svc => {
                    const r = Number((svc as any).itemRating) || 0;
                    if (r > 0) {
                        if (maxRating === null || r > maxRating) maxRating = r;
                    }
                });
                subOrderRating = maxRating;
            }

            if (subOrderRating === null) {
                // Kiểm tra xem đơn có bất kỳ đánh giá chi tiết cho dịch vụ/KTV nào không
                const hasDetailedRating = order.services.some((svc: any) => 
                    svc.itemRating != null || 
                    (svc.ktvRatings && Object.keys(svc.ktvRatings).length > 0)
                );
                // Nếu KHÔNG có đánh giá chi tiết nào, ta mới fallback về rating chung của đơn hàng
                if (!hasDetailedRating) {
                    subOrderRating = order.rating ?? null;
                }
            }

            resultForOrder.push({
                id: `${order.id}_${ktvSignature}`,
                bookingId: order.id,
                originalOrder: order,
                services,
                dispatchStatus,
                ktvSignature, // Legacy
                ktvIds: subKtvIds,
                calculatedStart: groupCalculatedStarts.get(ktvSignature) || '',
                rating: subOrderRating
            });
        });

        // 🌟 Inject Utilities (Phòng Riêng) back into UI 🌟
        const privateRooms = order.services.filter(svc => (svc as any).is_utility === true || svc.serviceId === 'NHS0900' || svc.serviceName?.toLowerCase().includes('phòng riêng') || svc.serviceName?.toLowerCase().includes('phong rieng')); // Legacy fallback
        if (privateRooms.length > 0) {
            const utilityServices = privateRooms.map(pr => ({ ...pr, isUtility: true }));
            if (resultForOrder.length > 0) {
                // Đính kèm vào SubOrder đầu tiên để Lễ tân nhìn thấy
                resultForOrder[0].services.push(...utilityServices as ServiceBlock[]);
            } else {
                // Trường hợp hiếm: Đơn hàng chỉ có Phòng Riêng
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
                    if (r > 0) {
                        if (utilityRating === null || r > utilityRating) utilityRating = r;
                    }
                });
                if (utilityRating === null) {
                    const hasDetailedRating = order.services.some((svc: any) => 
                        svc.itemRating != null || 
                        (svc.ktvRatings && Object.keys(svc.ktvRatings).length > 0)
                    );
                    if (!hasDetailedRating) {
                        utilityRating = order.rating ?? null;
                    }
                }

                resultForOrder.push({
                    id: `${order.id}_utility`,
                    bookingId: order.id,
                    originalOrder: order,
                    services: utilityServices as ServiceBlock[],
                    dispatchStatus: dStatus as any,
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
