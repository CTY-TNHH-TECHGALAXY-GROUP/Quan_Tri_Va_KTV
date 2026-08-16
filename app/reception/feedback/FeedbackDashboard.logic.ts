import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getDispatchData } from '../dispatch/actions';

export type FeedbackKtvInfo = {
    ktvId: string;
    ktvName: string;
    serviceName: string;
    itemId: string;
};

export type ChildBookingForFeedback = {
    id: string;
    billCode: string;
    status: string;
    customerName: string;
    customerLang: string;
    ktvList: FeedbackKtvInfo[];
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

    async function fetchData() {
        setLoading(true);
        try {
            const res = await getDispatchData(selectedDate);
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
                    parentMap.set(parentId, {
                        parentBookingId: parentId,
                        billCode: realParent?.billCode || b.billCode || 'N/A',
                        customerName: realParent?.customerName || b.customerName || 'Khách vãng lai',
                        childBookings: []
                    });
                }

                // Nếu là đơn con (hoặc đơn thường không bị split)
                if (b.status !== 'SPLIT') {
                    const group = parentMap.get(parentId)!;
                    
                    const ktvList: FeedbackKtvInfo[] = [];
                    const items = b.BookingItems || [];
                    
                    items.forEach((item: any) => {
                        // Tìm KTV từ technicianCodes hoặc TurnQueue
                        let techCodes = item.technicianCodes || [];
                        if (typeof techCodes === 'string') techCodes = [techCodes];
                        
                        if (techCodes.length > 0) {
                            techCodes.forEach((code: string) => {
                                const staffInfo = staffs.find(s => s.id === code);
                                ktvList.push({
                                    ktvId: code,
                                    ktvName: staffInfo?.full_name || code,
                                    serviceName: item.serviceName || item.service_name || 'Dịch vụ',
                                    itemId: item.id
                                });
                            });
                        } else {
                            // Cố tìm trong TurnQueue
                            const assignedTurns = turns.filter(t => t.current_order_id === b.id && t.booking_item_id?.includes(item.id));
                            assignedTurns.forEach(t => {
                                const staffInfo = staffs.find(s => s.id === t.employee_id);
                                ktvList.push({
                                    ktvId: t.employee_id,
                                    ktvName: staffInfo?.full_name || t.employee_id,
                                    serviceName: item.serviceName || item.service_name || 'Dịch vụ',
                                    itemId: item.id
                                });
                            });
                        }
                    });

                    group.childBookings.push({
                        id: b.id,
                        billCode: b.billCode || 'N/A',
                        status: b.status,
                        customerName: b.customerName || 'Khách',
                        customerLang: b.customerLang || 'VN',
                        ktvList
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
            .on('postgres_changes', { event: '*', schema: 'public', table: 'Bookings' }, () => {
                fetchData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'BookingItems' }, () => {
                fetchData();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [selectedDate]);

    return { groups, loading, fetchData };
}
