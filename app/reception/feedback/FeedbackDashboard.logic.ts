import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getDispatchData } from '../dispatch/actions';

export type FeedbackKtvInfo = {
    itemId: string;
    ktvId: string;
    ktvName: string;
    serviceNames: string[];
    rating?: number;
    timeEnd?: string;
};

export type ChildBookingForFeedback = {
    id: string;
    billCode: string;
    status: string;
    customerName: string;
    customerLang: string;
    ktvList: FeedbackKtvInfo[];
    isGuestFlow?: boolean;
    parentBookingId?: string;
};

export type ParentBookingGroup = {
    parentBookingId: string;
    billCode: string;
    customerName: string;
    childBookings: ChildBookingForFeedback[];
};

export function useFeedbackDashboard(selectedDate: string) {
    const [groups, setGroups] = useState<ParentBookingGroup[]>([]);
    const [loading, setLoading] = useState(true);

    async function fetchData(triggerSource?: string) {
        if (triggerSource) {
            console.log(`🔄 [FeedbackDashboard] Đang tải lại dữ liệu (Trigger: ${triggerSource})...`);
        }
        setLoading(true);
        try {
            // Thêm Date.now() để bypass triệt để cache của Next.js fetch
            const res = await getDispatchData(selectedDate, Date.now());
            if (!res.success || !res.data) {
                setLoading(false);
                return;
            }

            const { staffs: sData, turns: tData, bookings: bData } = res.data;
            const staffs = sData as any[] || [];
            const turns = tData as any[] || [];
            const bookings = bData as any[] || [];

            // Lọc ra các đơn gốc (Parent) và Đơn con (Child)
            const parentMap = new Map<string, ParentBookingGroup>();

            // Lặp qua tất cả booking để lấy đơn cha
            bookings.forEach(b => {
                if (b.status === 'CANCELLED') return;
                
                // Nếu là đơn cha (status = SPLIT) hoặc đơn độc lập nhưng có thể có feedback
                const parentId = b.parent_booking_id || b.id;
                
                if (!parentMap.has(parentId)) {
                    // Nếu chưa có trong map, thử tìm xem có bản ghi cha thực sự trong mảng không
                    const realParent = bookings.find(x => x.id === parentId);
                    
                    let displayBillCode = realParent?.billCode || b.billCode || 'N/A';
                    let displayCustomerName = realParent?.customerName || b.customerName || 'Khách vãng lai';

                    // Nếu không có realParent (vì đơn cha có status = SPLIT bị query bỏ qua)
                    // và đây là một đơn con (old split flow), thì cắt bỏ đuôi để hiển thị đúng thông tin của đơn cha.
                    if (!realParent && b.parent_booking_id) {
                        // Cắt đuôi dạng "-A", "-B" hoặc ".A"
                        displayBillCode = displayBillCode.replace(/[-.][A-Z0-9]$/, '');
                        // Cắt chữ " - Khách A", " - Khách B"
                        displayCustomerName = displayCustomerName.replace(/\s*-\s*Khách\s+[A-Z0-9]+$/i, '');
                    }

                    parentMap.set(parentId, {
                        parentBookingId: parentId,
                        billCode: displayBillCode,
                        customerName: displayCustomerName,
                        bookingDate: b.bookingDate, // Added for UI formatting
                        childBookings: []
                    });
                }

                // Nếu có BookingGuests (Flow mới)
                const guestListForFeedback = b.guests || b.BookingGuests || [];
                if (guestListForFeedback.length > 0) {
                    const group = parentMap.get(parentId)!;
                    
                    guestListForFeedback.forEach((guest: any, guestIndex: number) => {
                        const ktvList: FeedbackKtvInfo[] = [];
                        const items = (b.BookingItems || []).filter((i: any) => i.guest_id === guest.id);
                        
                        items.forEach((item: any) => {
                            let techCodes = item.technicianCodes || [];
                            if (typeof techCodes === 'string') techCodes = [techCodes];
                            
                            if (techCodes.length > 0) {
                                techCodes.forEach((code: string) => {
                                    let rating: number | undefined = undefined;
                                    // Đọc rating từ Guest trước
                                    if (guest.ktv_ratings && typeof guest.ktv_ratings === 'object') {
                                        const key = Object.keys(guest.ktv_ratings).find(k => k.toLowerCase() === code.toLowerCase());
                                        if (key) rating = Number((guest.ktv_ratings as any)[key]) || undefined;
                                    }
                                    // Fallback xuống Item (nếu đang chuyển đổi)
                                    if (rating === undefined && item.ktvRatings && typeof item.ktvRatings === 'object') {
                                        const key = Object.keys(item.ktvRatings).find(k => k.toLowerCase() === code.toLowerCase());
                                        if (key) rating = Number((item.ktvRatings as any)[key]) || undefined;
                                    }
                                    
                                    const staffInfo = staffs.find(s => s.id === code);
                                    const existingKtv = ktvList.find(k => k.ktvId === code);
                                    const svcName = item.serviceName || item.service_name || 'Dịch vụ';
                                    
                                    if (!existingKtv) {
                                        ktvList.push({
                                            itemId: guest.id, // TRUYỀN GUEST_ID VÀO itemId
                                            ktvId: code,
                                            ktvName: staffInfo?.full_name || code,
                                            serviceNames: [svcName],
                                            rating,
                                            timeEnd: item.timeEnd
                                        });
                                    } else {
                                        if (!existingKtv.serviceNames.includes(svcName)) {
                                            existingKtv.serviceNames.push(svcName);
                                        }
                                        if (item.timeEnd && (!existingKtv.timeEnd || new Date(item.timeEnd) > new Date(existingKtv.timeEnd))) {
                                            existingKtv.timeEnd = item.timeEnd;
                                        }
                                    }
                                });
                            } else {
                                // Fallback to TurnQueue
                                const assignedTurns = turns.filter(t => t.current_order_id === b.id && t.booking_item_id?.includes(item.id));
                                assignedTurns.forEach(t => {
                                    const staffInfo = staffs.find(s => s.id === t.employee_id);
                                    const existingKtv = ktvList.find(k => k.ktvId === t.employee_id);
                                    const svcName = item.serviceName || item.service_name || 'Dịch vụ';
                                    if (!existingKtv) {
                                        ktvList.push({
                                            itemId: guest.id,
                                            ktvId: t.employee_id,
                                            ktvName: staffInfo?.full_name || t.employee_id,
                                            serviceNames: [svcName],
                                            timeEnd: item.timeEnd
                                        });
                                    } else {
                                        if (!existingKtv.serviceNames.includes(svcName)) {
                                            existingKtv.serviceNames.push(svcName);
                                        }
                                        if (item.timeEnd && (!existingKtv.timeEnd || new Date(item.timeEnd) > new Date(existingKtv.timeEnd))) {
                                            existingKtv.timeEnd = item.timeEnd;
                                        }
                                    }
                                });
                            }
                        });
                        
                        let derivedStatus = guest.status || b.status;
                        if (items.length > 0) {
                            const allDone = items.every((i: any) => ['DONE', 'FEEDBACK', 'COMPLETED', 'CLEANING'].includes(i.status));
                            const anyStarted = items.some((i: any) => ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING', 'COMPLETED'].includes(i.status));
                            if (allDone) {
                                derivedStatus = 'FEEDBACK';
                            } else if (anyStarted) {
                                derivedStatus = 'IN_PROGRESS';
                            } else {
                                derivedStatus = 'PREPARING';
                            }
                        }
                        
                        // Tự động gán Khách A, Khách B nếu bị trống
                        const autoGuestName = `Khách ${String.fromCharCode(65 + guestIndex)}`;
                        const finalCustomerName = guest.guest_label || guest.customer_name || autoGuestName;

                        group.childBookings.push({
                            id: guest.id,
                            billCode: b.billCode || 'N/A',
                            status: derivedStatus,
                            customerName: finalCustomerName,
                            customerLang: b.customerLang || 'VN',
                            ktvList,
                            isGuestFlow: true,
                            parentBookingId: b.id
                        });
                    });
                } 
                // Nếu là đơn con (hoặc đơn thường không bị split - Flow Cũ)
                else if (b.status !== 'SPLIT') {
                    const group = parentMap.get(parentId)!;
                    
                    const ktvList: FeedbackKtvInfo[] = [];
                    const items = b.BookingItems || [];
                    
                    items.forEach((item: any) => {
                        // Tìm KTV từ technicianCodes hoặc TurnQueue
                        let techCodes = item.technicianCodes || [];
                        if (typeof techCodes === 'string') techCodes = [techCodes];
                        
                        if (techCodes.length > 0) {
                            techCodes.forEach((code: string) => {
                                let rating: number | undefined = undefined;
                                if (item.ktvRatings && typeof item.ktvRatings === 'object') {
                                    const key = Object.keys(item.ktvRatings).find(k => k.toLowerCase() === code.toLowerCase());
                                    if (key) {
                                        rating = Number((item.ktvRatings as any)[key]) || undefined;
                                    }
                                }

                                const staffInfo = staffs.find(s => s.id === code);
                                ktvList.push({
                                    itemId: item.id,
                                    ktvId: code,
                                    ktvName: staffInfo?.full_name || code,
                                    serviceNames: [item.serviceName || item.service_name || 'Dịch vụ'],
                                    rating,
                                    timeEnd: item.timeEnd
                                });
                            });
                        } else {
                            // Cố tìm trong TurnQueue
                            const assignedTurns = turns.filter(t => t.current_order_id === b.id && t.booking_item_id?.includes(item.id));
                            assignedTurns.forEach(t => {
                                const staffInfo = staffs.find(s => s.id === t.employee_id);
                                ktvList.push({
                                    itemId: item.id,
                                    ktvId: t.employee_id,
                                    ktvName: staffInfo?.full_name || t.employee_id,
                                    serviceNames: [item.serviceName || item.service_name || 'Dịch vụ'],
                                    timeEnd: item.timeEnd
                                });
                            });
                        }
                    });

                    let derivedStatus = b.status;
                    if (items.length > 0) {
                        const allDone = items.every((i: any) => ['DONE', 'FEEDBACK', 'COMPLETED', 'CLEANING'].includes(i.status));
                        const anyStarted = items.some((i: any) => ['IN_PROGRESS', 'DONE', 'FEEDBACK', 'CLEANING', 'COMPLETED'].includes(i.status));
                        if (allDone) {
                            derivedStatus = 'FEEDBACK';
                        } else if (anyStarted) {
                            derivedStatus = 'IN_PROGRESS';
                        } else {
                            derivedStatus = 'PREPARING';
                        }
                    }

                    const childIndex = group.childBookings.length;
                    
                    let finalCustomerName = b.customerName || `Khách ${String.fromCharCode(65 + childIndex)}`;
                    // Nếu là old split flow, customerName thường dính tiền tố của Group, ví dụ "SEAH C L - Khách B"
                    // Mình sẽ lọc bớt tiền tố đi cho sạch sẽ, chỉ giữ lại "Khách B"
                    if (finalCustomerName.includes(' - Khách')) {
                        const match = finalCustomerName.match(/Khách\s+[A-Z0-9]+/i);
                        if (match) {
                            finalCustomerName = match[0];
                        }
                    }

                    group.childBookings.push({
                        id: b.id, // Fallback dùng Booking ID
                        billCode: b.billCode || 'N/A',
                        status: derivedStatus,
                        customerName: finalCustomerName,
                        customerLang: b.customerLang || 'VN',
                        ktvList,
                        isGuestFlow: false,
                        parentBookingId: b.id
                    });
                }
            });

            setGroups(Array.from(parentMap.values()));

        } catch (e) {
            console.error("Error fetching feedback data", e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchData();

        const channel = supabase
            .channel('feedback_board_realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'Bookings' }, (payload) => {
                console.log('⚡ [Realtime] Bookings update detected:', payload);
                fetchData('Bookings Update');
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'BookingItems' }, (payload) => {
                console.log('⚡ [Realtime] BookingItems update detected:', payload);
                fetchData('BookingItems Update');
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'BookingGuests' }, () => {
                fetchData('BookingGuests Update');
            })
            .subscribe((status) => {
                console.log(`📡 [FeedbackDashboard] Realtime Channel Status:`, status);
            });

        return () => { supabase.removeChannel(channel); };
    }, [selectedDate]);

    return { groups, loading, fetchData };
}
