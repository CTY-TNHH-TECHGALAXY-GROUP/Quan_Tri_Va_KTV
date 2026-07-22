import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { useNotifications } from '@/components/NotificationProvider';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

export const useSupportDashboard = () => {
    const { user } = useAuth();
    const [roomsToClean, setRoomsToClean] = useState<any[]>([]);
    const [myTasks, setMyTasks] = useState<any[]>([]);
    const [loadingRooms, setLoadingRooms] = useState(true);
    const [loadingTasks, setLoadingTasks] = useState(true);
    
    const fetchRoomsToClean = async () => {
        setLoadingRooms(true);
        try {
            const { data, error } = await supabase
                .from('Bookings')
                .select('id, billCode, roomName, timeEnd, status')
                .eq('status', 'CLEANING');
            if (error) throw error;
            setRoomsToClean(data || []);
        } catch (error: any) {
            console.error('Error fetching rooms to clean:', error);
            alert('Lỗi khi lấy danh sách phòng dọn');
        } finally {
            setLoadingRooms(false);
        }
    };

    const fetchMyTasks = async () => {
        if (!user) return;
        setLoadingTasks(true);
        try {
            const result = await apiClient.get<any>(`${API.SUPPORT.TASKS}?assignee_id=${user.id}&status=PENDING`);
            setMyTasks(result.data || []);
        } catch (error: any) {
            console.error('Error fetching tasks:', error.message || error);
            alert('Lỗi khi lấy danh sách công việc');
        } finally {
            setLoadingTasks(false);
        }
    };

    const markRoomDone = async (bookingId: string, photoUrl: string) => {
        try {
            // In a real scenario we might save photoUrl to Booking or a new table
            const { error } = await supabase
                .from('Bookings')
                .update({ status: 'DONE' })
                .eq('id', bookingId);
            if (error) throw error;
            alert('Bàn giao phòng thành công');
            fetchRoomsToClean();
            return { success: true };
        } catch (error: any) {
            console.error('Error marking room done:', error);
            alert('Lỗi khi hoàn tất phòng');
            return { success: false, error: error.message };
        }
    };

    const markTaskDone = async (taskId: string, photoUrl: string) => {
        try {
            await apiClient.patch<any>(API.SUPPORT.TASKS, { id: taskId, status: 'DONE', photo_url: photoUrl });
            alert('Đã hoàn tất công việc');
            fetchMyTasks();
            return { success: true };
        } catch (error: any) {
            console.error('Error marking task done:', error.message || error);
            alert('Lỗi khi hoàn tất công việc');
            return { success: false, error: error.message };
        }
    };

    useEffect(() => {
        fetchRoomsToClean();
        fetchMyTasks();
        
        // Setup subscriptions for realtime updates
        const subBookings = supabase
            .channel('public:Bookings')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'Bookings' }, () => {
                fetchRoomsToClean();
            })
            .subscribe();

        const subTasks = supabase
            .channel('public:SupportTasks')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'SupportTasks' }, () => {
                fetchMyTasks();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(subBookings);
            supabase.removeChannel(subTasks);
        };
    }, [user]);

    return {
        roomsToClean,
        myTasks,
        loadingRooms,
        loadingTasks,
        markRoomDone,
        markTaskDone,
        refreshRooms: fetchRoomsToClean,
        refreshTasks: fetchMyTasks
    };
};
