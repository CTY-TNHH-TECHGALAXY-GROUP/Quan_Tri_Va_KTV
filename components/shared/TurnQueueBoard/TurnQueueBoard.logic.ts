import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { StaffData, TurnQueueData } from './TurnQueueBoard.types';

export const useTurnQueueBoard = (staffs: StaffData[]) => {
    // Luôn sử dụng múi giờ Việt Nam (UTC+7) làm mặc định
    const getVietnamDateString = () => {
        const d = new Date();
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        const vnTime = new Date(utc + (3600000 * 7));
        return vnTime.toISOString().split('T')[0];
    };
    
    const [selectedDate, setSelectedDate] = useState<string>(getVietnamDateString());
    const [turns, setTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
    const [externalTurns, setExternalTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
    const [shifts, setShifts] = useState<Record<string, { type: string, end: string | null }>>({});
    const [suddenOffs, setSuddenOffs] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);

    // 🔧 LOCAL REORDER STATE
    const [localOrder, setLocalOrder] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
    const [hasChanges, setHasChanges] = useState(false);
    const [isSavingOrder, setIsSavingOrder] = useState(false);
    const [editingKtvId, setEditingKtvId] = useState<string | null>(null);
    const hasChangesRef = useRef(false);

    const fetchExtras = useCallback(async () => {
        const today = selectedDate;
        const [shiftRes, leaveRes] = await Promise.all([
            supabase.from('KTVShifts').select('employeeId, shiftType, estimatedEndTime').eq('status', 'ACTIVE'),
            supabase.from('KTVLeaveRequests').select('employeeId').eq('date', today).eq('is_sudden_off', true)
        ]);
        if (shiftRes.data) {
            const shiftMap: Record<string, { type: string, end: string | null }> = {};
            shiftRes.data.forEach((s: any) => shiftMap[s.employeeId] = { type: s.shiftType, end: s.estimatedEndTime });
            setShifts(shiftMap);
        }
        if (leaveRes.data) {
            setSuddenOffs(new Set(leaveRes.data.map((l: any) => l.employeeId || l.employee_id)));
        }
    }, [selectedDate]);

    // Fetch qua API (trigger sync logic đếm tua chính xác)
    const fetchTurns = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/turns?date=${selectedDate}`);
            const json = await res.json();
            if (json.success && json.data) {
                const merged = json.data.map((t: TurnQueueData) => ({
                    ...t,
                    staff: staffs.find(s => s.id === t.employee_id)
                }));
                // 🔥 Tách KTV nội bộ và KTV ngoài
                const internal = merged.filter((t: TurnQueueData) => !t.employee_id.startsWith('EXT'));
                const external = merged.filter((t: TurnQueueData) => t.employee_id.startsWith('EXT') && !(t.status === 'waiting' && t.turns_completed > 0));
                setTurns(internal);
                setExternalTurns(external);
            }
        } catch (err) {
            console.error('Fetch turns error:', err);
        }
        setLoading(false);
    }, [selectedDate, staffs]);

    // Fetch trực tiếp từ DB (dùng khi TurnQueue thay đổi, không cần re-sync)
    const fetchTurnsFromDB = useCallback(async () => {
        const today = selectedDate;
        const { data } = await supabase
            .from('TurnQueue')
            // 🔧 EGRESS FIX: Select only needed columns
            .select('id, employee_id, date, check_in_order, queue_position, status, turns_completed, current_order_id, estimated_end_time')
            .eq('date', today)
            .order('turns_completed', { ascending: true })
            .order('check_in_order', { ascending: true });

        if (data) {
            const merged = data.map((t: TurnQueueData) => ({
                ...t,
                staff: staffs.find(s => s.id === t.employee_id)
            }));
            // 🔥 Tách KTV nội bộ và KTV ngoài
            const internal = merged.filter((t: TurnQueueData) => !t.employee_id.startsWith('EXT'));
            const external = merged.filter((t: TurnQueueData) => t.employee_id.startsWith('EXT') && !(t.status === 'waiting' && t.turns_completed > 0));
            setTurns(internal);
            setExternalTurns(external);
        }
    }, [selectedDate, staffs]);

    useEffect(() => {
        if (staffs.length > 0) {
            fetchTurns();
            fetchExtras();
        }
    }, [staffs, selectedDate, fetchTurns, fetchExtras]);

    // 🔄 REALTIME: Lắng nghe 3 bảng quan trọng liên quan đến điều phối
    useEffect(() => {
        if (staffs.length === 0) return;

        const channel = supabase.channel('turn-realtime-sync')
            // Bảng BookingItems: Gán KTV, đổi KTV, thêm dịch vụ add-on
            .on('postgres_changes', { event: '*', schema: 'public', table: 'BookingItems' }, () => {
                console.log('🔄 [Realtime] BookingItems changed → syncing turns...');
                if (!hasChangesRef.current) fetchTurns();
            })
            // Bảng Bookings: Cập nhật trạng thái đơn (DONE, CANCELLED, NEW...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'Bookings' }, () => {
                console.log('🔄 [Realtime] Bookings changed → syncing turns...');
                if (!hasChangesRef.current) fetchTurns();
            })
            // Bảng TurnQueue: Thay đổi tua trực tiếp (swap vị trí, reset, tan ca...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'TurnQueue' }, () => {
                console.log('🔄 [Realtime] TurnQueue changed → refreshing...');
                if (!hasChangesRef.current) fetchTurnsFromDB();
            })
            // Bảng DailyAttendance: Điểm danh, đổi trạng thái (on_duty, off_duty, absent...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'DailyAttendance' }, () => {
                console.log('🔄 [Realtime] DailyAttendance changed → syncing turns...');
                if (!hasChangesRef.current) fetchTurnsFromDB();
            })
            // Bảng KTVAttendance: KTV bấm điểm danh / tan ca trên app
            .on('postgres_changes', { event: '*', schema: 'public', table: 'KTVAttendance' }, () => {
                console.log('🔄 [Realtime] KTVAttendance changed → syncing turns...');
                if (!hasChangesRef.current) fetchTurnsFromDB();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'KTVLeaveRequests' }, () => {
                fetchExtras();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'KTVShifts' }, () => {
                fetchExtras();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [staffs, selectedDate, fetchTurns, fetchTurnsFromDB, fetchExtras]);

    // Sắp xếp gốc: off cuối → theo tua → theo queue_position
    const buildSorted = useCallback((source: (TurnQueueData & { staff?: StaffData })[]) => {
        return [...source].sort((a, b) => {
            const isAOff = a.status === 'off' || suddenOffs.has(a.employee_id);
            const isBOff = b.status === 'off' || suddenOffs.has(b.employee_id);
            if (isAOff && !isBOff) return 1;
            if (!isAOff && isBOff) return -1;
            if (a.turns_completed !== b.turns_completed) return a.turns_completed - b.turns_completed;
            return a.check_in_order - b.check_in_order;
        });
    }, [suddenOffs]);

    // Sync localOrder khi turns thay đổi VÀ không có thay đổi chưa lưu
    useEffect(() => {
        if (!hasChanges) {
            setLocalOrder(buildSorted(turns));
        }
    }, [turns, buildSorted, hasChanges]);

    // ─── BATCH SAVE: Ghi check_in_order + queue_position vào DB ───
    const saveOrder = async () => {
        setIsSavingOrder(true);
        try {
            const updates = localOrder.map((turn) => {
                return supabase.from('TurnQueue')
                    .update({ check_in_order: turn.check_in_order, queue_position: turn.check_in_order })
                    .eq('id', turn.id!);
            });
            await Promise.all(updates);
            setHasChanges(false);
            hasChangesRef.current = false;
            fetchTurns();
        } catch (err) {
            console.error('Save order error:', err);
            alert('❌ Lỗi khi lưu thứ tự!');
        }
        setIsSavingOrder(false);
    };

    // ─── CANCEL: Huỷ thay đổi ───
    const cancelOrder = () => {
        setLocalOrder(buildSorted(turns));
        setHasChanges(false);
        hasChangesRef.current = false;
        setEditingKtvId(null);
    };

    // ─── INLINE EDIT: Thay đổi check_in_order trực tiếp ───
    const handleOrderChange = (ktvId: string, newOrder: number) => {
        if (isNaN(newOrder) || newOrder < 1) return;
        const next = localOrder.map(t => ({ ...t }));
        const target = next.find(t => t.employee_id === ktvId);
        if (!target) return;
        const oldOrder = target.check_in_order;
        // Nếu trùng → swap: KTV cũ nhận số cũ của target
        const conflict = next.find(t => t.check_in_order === newOrder && t.employee_id !== ktvId);
        if (conflict) {
            conflict.check_in_order = oldOrder;
        }
        target.check_in_order = newOrder;
        setLocalOrder(next);
        setHasChanges(true);
        hasChangesRef.current = true;
        setEditingKtvId(null);
    };

    const resetTurns = async () => {
        const next = [...turns].sort((a, b) => a.check_in_order - b.check_in_order);
        const updates = next.map((turn, i) => {
            const pos = i + 1;
            return supabase.from('TurnQueue')
                .update({ queue_position: pos })
                .eq('id', turn.id!);
        });
        await Promise.all(updates);
        setHasChanges(false);
        hasChangesRef.current = false;
        fetchTurns();
    };

    const sortedTurns = localOrder;
    const readyCount = turns.filter(t => t.status === 'waiting' && !suddenOffs.has(t.employee_id)).length;
    const workingCount = turns.filter(t => t.status === 'working' && !suddenOffs.has(t.employee_id)).length;
    const offCount = turns.filter(t => t.status === 'off' || suddenOffs.has(t.employee_id)).length;
    const activeCount = turns.length - offCount;

    return {
        selectedDate,
        setSelectedDate,
        turns,
        shifts,
        suddenOffs,
        loading,
        hasChanges,
        isSavingOrder,
        editingKtvId,
        setEditingKtvId,
        saveOrder,
        cancelOrder,
        handleOrderChange,
        resetTurns,
        sortedTurns,
        readyCount,
        workingCount,
        activeCount,
        externalTurns
    };
};
