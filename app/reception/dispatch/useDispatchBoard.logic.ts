import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { parseDbDate } from '@/lib/utils';
import { getDispatchData } from './actions';
import { StaffData, TurnQueueData, PendingOrder, DispatchStatus, WorkSegment } from './types';

// Helpers copied from page.tsx for internal hook usage
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

export function useDispatchBoard(selectedDate: string, selectedOrderId: string | null) {
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [staffs, setStaffs] = useState<StaffData[]>([]);
    const [turns, setTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
    const [rooms, setRooms] = useState<any[]>([]);
    const [beds, setBeds] = useState<any[]>([]);
    const [reminders, setReminders] = useState<any[]>([]);
    const [allServices, setAllServices] = useState<any[]>([]);
    const [roomTransitionTime, setRoomTransitionTime] = useState(5);
    const [loading, setLoading] = useState(true);

    const selectedOrderIdRef = useRef(selectedOrderId);
    const needsRefreshRef = useRef(false);

    useEffect(() => {
        const wasEditing = !!selectedOrderIdRef.current;
        selectedOrderIdRef.current = selectedOrderId;
        if (wasEditing && !selectedOrderId && needsRefreshRef.current) {
            needsRefreshRef.current = false;
            console.log('🔄 [Dispatch] Form closed — syncing pending realtime updates');
            fetchData();
        }
    }, [selectedOrderId]);

    async function fetchData() {
        setLoading(true);
        console.log("📡 [Dispatch] Fetching data for date:", selectedDate);
        try {
            const res = await getDispatchData(selectedDate);
            if (!res.success || !res.data) {
                console.error("❌ [Dispatch] Server Action error:", JSON.stringify(res, null, 2));
                setLoading(false);
                return;
            }

            const { staffs: sData, turns: tData, bookings: bData } = res.data;

            if (sData) setStaffs(sData as unknown as StaffData[]);

            if (tData && sData) {
                const merged = (tData as TurnQueueData[]).map((t: TurnQueueData) => ({
                    ...t,
                    staff: (sData as unknown as StaffData[]).find(s => s.id === t.employee_id)
                }));
                setTurns(merged);
            }

            const rData = res.data.rooms || [];
            const bdData = res.data.beds || [];
            const rmData = res.data.reminders || [];
            setRooms(rData);
            setBeds(bdData);
            setReminders(rmData);
            if (res.data.allServices) setAllServices(res.data.allServices);
            if (res.data.roomTransitionTime !== undefined) setRoomTransitionTime(res.data.roomTransitionTime);
            
            if (bData) {
                const mappedOrders: PendingOrder[] = (bData as any[]).filter(b => b.status !== 'CANCELLED').map(b => {
                    const assignedTurns = tData?.filter((t: any) => t.current_order_id === b.id) || [];
                    const hasAssignedKtv = assignedTurns.length > 0;

                    let dStatus: DispatchStatus = 'pending';
                    if (b.status === 'PREPARING') dStatus = 'PREPARING';
                    else if (b.status === 'IN_PROGRESS') dStatus = 'IN_PROGRESS';
                    else if (b.status === 'CLEANING') dStatus = 'CLEANING';
                    else if (b.status === 'FEEDBACK') dStatus = 'FEEDBACK';
                    else if (b.status === 'DONE' || b.status === 'CANCELLED') dStatus = 'DONE';
                    else if (hasAssignedKtv) dStatus = 'PREPARING';

                    const calculatedRating = b.rating || (b.BookingItems || []).find((i: any) => i.itemRating != null)?.itemRating || null;

                    return {
                        id: b.id,
                        billCode: b.billCode || 'N/A',
                        customerName: b.customerName || 'Khách vãng lai',
                        customerId: b.customerId || null,
                        customerLang: b.customerLang || 'vi',
                        phone: b.customerPhone || '',
                        email: b.customerEmail || '',
                        time: b.timeBooking || (b.createdAt ? parseDbDate(b.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'),
                        dispatchStatus: dStatus,
                        createdAt: b.createdAt || new Date().toISOString(),
                        updatedAt: b.updatedAt,
                        totalAmount: b.totalAmount || 0,
                        paymentMethod: b.paymentMethod || 'Chưa rõ',
                        hasVat: b.hasVat,
                        rawStatus: b.status,
                        hasAssignedKtv,
                        accessToken: b.accessToken || null,
                        rating: calculatedRating,
                        feedbackNote: b.feedbackNote || null,
                        vipWarnings: b.notes && typeof b.notes === 'string' && b.notes.trim().startsWith('{') ? (() => { try { const p = JSON.parse(b.notes); return p.type === 'VIP_APPOINTMENT' ? p.warnings : []; } catch { return []; } })() : [],
                        vipConfidence: b.notes && typeof b.notes === 'string' && b.notes.trim().startsWith('{') ? (() => { try { const p = JSON.parse(b.notes); return p.type === 'VIP_APPOINTMENT' ? p.confidence : undefined; } catch { return undefined; } })() : undefined,
                        timeStart: b.timeStart || null,
                        rawNotes: b.notes,
                        isWebBooking: b.source === 'WEB_BOOKING' || (b.notes && typeof b.notes === 'string' && b.notes.trim().startsWith('{') ? (() => { try { const p = JSON.parse(b.notes); return p.type === 'WEB_ADVANCE_BOOKING'; } catch { return false; } })() : false),
                        timeBooking: b.timeBooking,
                        isReturning: b.isReturning,
                        visitCount: b.visitCount,
                        guestCount: b.guestCount,
                        nationality: b.nationality,
                        customerGender: b.customerGender || 'male',
                        services: (b.BookingItems || []).map((bi: any) => {
                            const itemTurns = assignedTurns.filter((t: any) => {
                                if (!t.booking_item_id) return false;
                                if (typeof t.booking_item_id === 'string') return t.booking_item_id.includes(bi.id);
                                return t.booking_item_id === bi.id;
                            });
                            const finalItemTurns = (itemTurns.length === 0 && (b.BookingItems || []).length === 1) ? assignedTurns : itemTurns;

                            let parsedSegments: any[] = [];
                            try { parsedSegments = typeof bi.segments === 'string' ? JSON.parse(bi.segments) : (Array.isArray(bi.segments) ? bi.segments : []); } catch (e) { parsedSegments = []; }

                            const parsedOptions = typeof bi.options === 'string' ? JSON.parse(bi.options) : (bi.options || {});

                            let parsedNotes: any = null;
                            let finalAdminNote = '';
                            let extractedCustomerNote = '';
                            if (b.notes) {
                                if (typeof b.notes === 'string' && b.notes.trim().startsWith('{')) {
                                    try { parsedNotes = JSON.parse(b.notes); } catch (e) { }
                                } else if (typeof b.notes === 'object') {
                                    parsedNotes = b.notes;
                                } else {
                                    finalAdminNote = String(b.notes);
                                    extractedCustomerNote = String(b.notes);
                                }

                                if (parsedNotes) {
                                    if (parsedNotes.type === 'VIP_APPOINTMENT' || parsedNotes.type === 'WEB_ADVANCE_BOOKING') {
                                        finalAdminNote = parsedNotes.receptionNote || '';
                                        extractedCustomerNote = parsedNotes.customerNote || parsedNotes.note || '';
                                    } else {
                                        finalAdminNote = typeof b.notes === 'string' ? b.notes : JSON.stringify(b.notes);
                                        extractedCustomerNote = parsedNotes.customerNote || parsedNotes.note || '';
                                    }
                                }
                            }

                            const forcedStartTime = parsedOptions?.timeSlot || parsedNotes?.timeSlot;
                            const techCodes: string[] = Array.isArray(bi.technicianCodes) ? bi.technicianCodes : (bi.technicianCodes ? [bi.technicianCodes] : []);
                            let staffList: any[] = [];

                            if (techCodes.length > 0) {
                                const validTechCodes: string[] = [];
                                const invalidTechNames: string[] = [];
                                techCodes.forEach(tCode => {
                                    const staff = (sData as unknown as StaffData[])?.find((s: any) => s.id === tCode);
                                    if (staff) {
                                        validTechCodes.push(tCode);
                                    } else {
                                        invalidTechNames.push(tCode);
                                    }
                                });

                                if (invalidTechNames.length > 0) {
                                    const reqNote = `[Khách yêu cầu KTV: ${invalidTechNames.join(', ')}]`;
                                    extractedCustomerNote = extractedCustomerNote ? `${reqNote} | ${extractedCustomerNote}` : reqNote;
                                }

                                if (validTechCodes.length > 0) {
                                    staffList = validTechCodes.map((tCode: string) => {
                                        const staff = (sData as unknown as StaffData[])?.find((s: any) => s.id === tCode);
                                        const turn = finalItemTurns.find((t: any) => t.employee_id === tCode);
                                        let segments: WorkSegment[] = parsedSegments.filter((s: any) => s.ktvId === tCode);

                                        if (segments.length === 0) {
                                            const st = formatTime(turn?.start_time) || forcedStartTime || b.timeBooking || getCurrentTime();
                                            const totalDur = parsedOptions?.vipDuration || bi.duration || 0;
                                            const dur = validTechCodes.length > 1 ? Math.ceil(totalDur / validTechCodes.length) : totalDur;
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
                                            ktvName: parsedOptions?.external_technician_name?.[tCode] || staff?.full_name || tCode,
                                            segments: segments,
                                            noteForKtv: bi.options?.notesForKtvs?.[tCode] || bi.options?.noteForKtv || ''
                                        };
                                    });
                                }
                            }
                            
                            if (staffList.length === 0 && finalItemTurns.length > 0) {
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
                                        ktvName: parsedOptions?.external_technician_name?.[t.employee_id] || staff?.full_name || 'KTV',
                                        segments: segments,
                                        noteForKtv: bi.options?.notesForKtvs?.[t.employee_id] || bi.options?.noteForKtv || ''
                                    };
                                });
                            } else if (staffList.length === 0) {
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
                                    extractedCustomerNote,
                                    parsedOptions?.note || parsedOptions?.customerNotes,
                                    Array.isArray(parsedOptions?.tags) && parsedOptions.tags.length > 0 ? `Yêu cầu đặc biệt: ${parsedOptions.tags.join(', ')}` : '',
                                    b.focusAreaNote
                                ].filter(Boolean).join(' | '),
                                price: Number(bi.price) || 0,
                                quantity: Number(bi.quantity) || 1,
                                options: parsedOptions,
                                status: bi.status || 'NEW',
                                timeStart: bi.timeStart || null,
                                timeEnd: bi.timeEnd || null,
                                itemRating: bi.itemRating || null,
                                ktvRatings: bi.ktvRatings || {}
                            };
                        })
                    };
                });
                
                // 🔥 Xây dựng ktvDisplayNames và patch staffs/turns
                const ktvDisplayNames: Record<string, string> = {};
                mappedOrders.forEach(order => {
                    order.services.forEach(svc => {
                        svc.staffList?.forEach(st => {
                            if (st.ktvId?.startsWith('EXT') && st.ktvName && st.ktvName !== st.ktvId) {
                                ktvDisplayNames[st.ktvId] = st.ktvName;
                            }
                        });
                    });
                });

                if (sData) {
                    const patchedStaffs = [...(sData as unknown as StaffData[])];
                    Object.entries(ktvDisplayNames).forEach(([id, name]) => {
                        const existing = patchedStaffs.find(s => s.id === id);
                        if (existing) {
                            existing.full_name = name;
                        } else {
                            patchedStaffs.push({ id, full_name: name } as any);
                        }
                    });
                    setStaffs(patchedStaffs);
                    
                    if (tData) {
                        const merged = (tData as TurnQueueData[]).map((t: TurnQueueData) => ({
                            ...t,
                            staff: patchedStaffs.find(s => s.id === t.employee_id)
                        }));
                        setTurns(merged);
                    }
                }
                
                setOrders(mappedOrders);
            }
        } catch (e) {
            console.error("❌ [Dispatch] Unexpected error in fetchData:", e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchData();

        let fetchTimeout: NodeJS.Timeout;
        const debouncedFetchData = () => {
            clearTimeout(fetchTimeout);
            fetchTimeout = setTimeout(() => {
                fetchData();
            }, 1000);
        };

        const channel = supabase
            .channel('dispatch_board_realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'Bookings' }, (payload) => {
                const newBooking = payload.new;
                if (!['STANDARD_WALK_IN', 'VIP_WALK_IN', 'STANDARD_MENU', 'VIP_MENU', 'MIXED_WALK_IN'].includes(newBooking?.source)) return;
                debouncedFetchData();
            })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'Bookings' }, (payload: any) => {
                setOrders(prev => prev.map(o => {
                    if (o.id === payload.new.id) {
                        const newStatus = payload.new.status;
                        const isOpenStatus = ['NEW', 'WAITING', 'READY', 'PREPARING'].includes(newStatus);
                        const mappedStatus = !o.hasAssignedKtv && isOpenStatus
                            ? 'pending'
                            : (isOpenStatus ? 'PREPARING' : (newStatus === 'CANCELLED' ? 'DONE' : newStatus));
                        return { ...o, rawStatus: newStatus, dispatchStatus: mappedStatus };
                    }
                    return o;
                }));

                if (selectedOrderIdRef.current) {
                    needsRefreshRef.current = true;
                    return;
                }
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'TurnQueue' }, (payload: any) => {
                if (payload.eventType === 'UPDATE') {
                    setTurns(prev => prev.map(t => t.employee_id === payload.new.employee_id ? { ...t, ...payload.new } : t));
                } else if (payload.eventType === 'DELETE') {
                    setTurns(prev => prev.filter(t => t.id !== payload.old.id));
                } else {
                    if (selectedOrderIdRef.current) {
                        needsRefreshRef.current = true;
                    } else {
                        debouncedFetchData();
                    }
                }
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'StaffNotifications' }, (payload) => {
                if (selectedOrderIdRef.current) {
                    needsRefreshRef.current = true;
                    return;
                }
                debouncedFetchData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'BookingItems' }, (payload) => {
                const newItem = payload.new as any;
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

                if (payload.eventType !== 'UPDATE') {
                    debouncedFetchData();
                } else {
                    setOrders(prev => {
                        const order = prev.find(o => o.id === newItem.bookingId);
                        const svc = order?.services.find((s: any) => s.id === newItem.id);
                        if (newItem.status === 'IN_PROGRESS' && svc?.status !== 'IN_PROGRESS') {
                            debouncedFetchData();
                        }
                        return prev;
                    });
                }
            })
            .on('broadcast', { event: 'KTV_STARTED' }, (payload: any) => {
                const { bookingId, ktvId, startTime } = payload.payload;
                setOrders(prev => prev.map(o => {
                    if (o.id === bookingId) {
                        const updatedServices = o.services.map((svc: any) => ({
                            ...svc,
                            status: 'IN_PROGRESS',
                            staffList: svc.staffList.map((staff: any) => {
                                if (staff.ktvId === ktvId) {
                                    return {
                                        ...staff,
                                        segments: staff.segments.map((seg: any, idx: number) => {
                                            if (idx === 0 || !seg.actualStartTime) {
                                                return { ...seg, actualStartTime: startTime };
                                            }
                                            return seg;
                                        })
                                    };
                                }
                                return staff;
                            })
                        }));
                        return { ...o, dispatchStatus: 'IN_PROGRESS', rawStatus: 'IN_PROGRESS', services: updatedServices };
                    }
                    return o;
                }));
            })
            .on('broadcast', { event: 'KTV_FINISHED' }, (payload: any) => {
                const { bookingId, ktvId, finishTime } = payload.payload;
                setOrders(prev => prev.map(o => {
                    if (o.id === bookingId) {
                        const updatedServices = o.services.map((svc: any) => ({
                            ...svc,
                            staffList: svc.staffList.map((staff: any) => {
                                if (staff.ktvId === ktvId) {
                                    return {
                                        ...staff,
                                        segments: staff.segments.map((seg: any, idx: number, arr: any[]) => {
                                            if (idx === arr.length - 1 || !seg.actualEndTime) {
                                                return { ...seg, actualEndTime: finishTime };
                                            }
                                            return seg;
                                        })
                                    };
                                }
                                return staff;
                            })
                        }));
                        return { ...o, services: updatedServices };
                    }
                    return o;
                }));
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [selectedDate]);

    return {
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
    };
}
