import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { StaffData, TurnQueueData } from './TurnQueueBoard.types';

export const useTurnQueueBoard = (staffs: StaffData[]) => {
    // Luôn sử dụng múi giờ Việt Nam (UTC+7) làm mặc định
    const getVietnamDateString = () => {
        const d = new Date();
        const vnTime = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        return vnTime.getFullYear() + '-' + 
               String(vnTime.getMonth() + 1).padStart(2, '0') + '-' + 
               String(vnTime.getDate()).padStart(2, '0');
    };
    
    const [selectedDate, setSelectedDate] = useState<string>(getVietnamDateString());
    const [turns, setTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
    const [externalTurns, setExternalTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);
    const [allExternalStaffs, setAllExternalStaffs] = useState<StaffData[]>([]);
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
                const internal = merged.filter((t: TurnQueueData) => !t.employee_id.startsWith('EXT') && !t.employee_id.startsWith('C_'));
                // Include ALL external turns (even 'off') so we can map them back, or just use externalTurns for active
                const external = merged.filter((t: TurnQueueData) => (t.employee_id.startsWith('EXT') || t.employee_id.startsWith('C_')));
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
            .select('id, employee_id, date, check_in_order, queue_position, status, turns_completed, manual_adjustment, current_order_id, estimated_end_time')
            .eq('date', today)
            .order('turns_completed', { ascending: true })
            .order('check_in_order', { ascending: true });

        if (data) {
            const merged = data.map((t: TurnQueueData) => ({
                ...t,
                staff: staffs.find(s => s.id === t.employee_id)
            }));
                // 🔥 Tách KTV nội bộ và KTV ngoài
                const internal = merged.filter((t: TurnQueueData) => !t.employee_id.startsWith('EXT') && !t.employee_id.startsWith('C_'));
                const external = merged.filter((t: TurnQueueData) => (t.employee_id.startsWith('EXT') || t.employee_id.startsWith('C_')));
                setTurns(internal);
                setExternalTurns(external);
        }
    }, [selectedDate, staffs]);

    useEffect(() => {
        if (staffs.length > 0) {
            setAllExternalStaffs(staffs.filter(s => s.id.startsWith('EXT') || s.id.startsWith('C_')));
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

    const toggleExternalStaff = async (staffId: string, currentTurn?: TurnQueueData) => {
        try {
            if (!currentTurn) {
                // Toggles ON (Insert new TurnQueue record for today)
                const maxOrderRes = await supabase.from('TurnQueue').select('check_in_order').eq('date', selectedDate).order('check_in_order', { ascending: false }).limit(1);
                let nextOrder = 1;
                if (maxOrderRes.data && maxOrderRes.data.length > 0) {
                    nextOrder = maxOrderRes.data[0].check_in_order + 1;
                }
                const { error } = await supabase.from('TurnQueue').insert({
                    employee_id: staffId,
                    date: selectedDate,
                    check_in_order: nextOrder,
                    queue_position: nextOrder,
                    status: 'waiting',
                    turns_completed: 0
                });
                if (error) throw error;
            } else {
                // Toggle between 'off' and 'waiting' (no constraints as requested)
                const newStatus = currentTurn.status === 'off' ? 'waiting' : 'off';
                const { error } = await supabase.from('TurnQueue').update({ status: newStatus }).eq('id', currentTurn.id);
                if (error) throw error;
            }
        } catch (err) {
            console.error('Toggle external staff error:', err);
            alert('Lỗi khi cập nhật trạng thái KTV Ngoài!');
        }
    };

    const deleteExternalStaff = async (staffId: string) => {
        if (!confirm(`Bạn có chắc muốn xóa KTV ${staffId} khỏi danh sách?`)) return;
        try {
            // Xóa khỏi TurnQueue hôm nay
            await supabase.from('TurnQueue').delete().eq('employee_id', staffId).eq('date', selectedDate);
            // Xóa khỏi Staff
            const { error } = await supabase.from('Staff').delete().eq('id', staffId);
            if (error) {
                // Nếu có liên kết khóa ngoại (BookingItems), chuyển sang ẩn
                console.warn('Lỗi khóa ngoại, chuyển sang ẩn nhân viên', error);
                await supabase.from('Staff').update({ status: 'NGHỈ VIỆC' }).eq('id', staffId);
            }
            setAllExternalStaffs(prev => prev.filter(s => s.id !== staffId));
            setExternalTurns(prev => prev.filter(t => t.employee_id !== staffId));
        } catch (err) {
            console.error('Delete external staff error:', err);
            alert('Lỗi khi xóa nhân viên!');
        }
    };

    const sortedTurns = localOrder;
    const readyCount = turns.filter(t => t.status === 'waiting' && !suddenOffs.has(t.employee_id)).length;
    const workingCount = turns.filter(t => t.status === 'working' && !suddenOffs.has(t.employee_id)).length;
    const offCount = turns.filter(t => t.status === 'off' || suddenOffs.has(t.employee_id)).length;
    const activeCount = turns.length - offCount;

    // Sort KTV ngoài: KTV được bật (không phải off) lên đầu
    const sortedExternalStaffs = [...allExternalStaffs].sort((a, b) => {
        const turnA = externalTurns.find(t => t.employee_id === a.id);
        const turnB = externalTurns.find(t => t.employee_id === b.id);
        const isOffA = !turnA || turnA.status === 'off';
        const isOffB = !turnB || turnB.status === 'off';
        if (isOffA && !isOffB) return 1;
        if (!isOffA && isOffB) return -1;
        return 0;
    });
    const [waterRefillerId, setWaterRefillerId] = useState<string | null>(null);

    useEffect(() => {
        const fetchWaterRefiller = async () => {
            const { data } = await supabase.from('SystemConfigs').select('value').eq('key', 'daily_water_refiller').single();
            if (data?.value) {
                setWaterRefillerId(data.value);
            }
        };
        fetchWaterRefiller();

        const channel = supabase.channel('system_configs_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'SystemConfigs', filter: "key=eq.daily_water_refiller" }, (payload) => {
                const newRecord = payload.new as { key: string; value: string | null };
                if (newRecord && newRecord.key === 'daily_water_refiller') {
                    setWaterRefillerId(newRecord.value);
                }
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const assignWaterRefiller = async (ktvId: string | null) => {
        try {
            const res = await fetch('/api/system/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'daily_water_refiller', value: ktvId })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to update system config');
        } catch (err) {
            console.error('Lỗi khi gán người châm nước:', err);
            alert('Có lỗi xảy ra khi gán người châm nước!');
        }
    };

    const updateKtvStatus = async (employeeId: string, status: string, estimated_end_time?: string) => {
        try {
            const updatePayload: any = { status };
            if (status === 'working' && estimated_end_time) {
                updatePayload.estimated_end_time = estimated_end_time;
            } else if (status !== 'working') {
                updatePayload.estimated_end_time = null;
            }
            const { error } = await supabase.from('TurnQueue').update(updatePayload).eq('employee_id', employeeId).eq('date', selectedDate);
            if (error) throw error;
        } catch (err) {
            console.error('Lỗi cập nhật trạng thái:', err);
            alert('Có lỗi xảy ra khi đổi trạng thái KTV!');
        }
    };

    const updateManualAdjustment = async (employeeId: string, delta: number, currentManualAdj: number = 0) => {
        try {
            const newManualAdj = currentManualAdj + delta;
            
            const { error } = await supabase
                .from('TurnQueue')
                .update({ manual_adjustment: newManualAdj })
                .eq('employee_id', employeeId)
                .eq('date', selectedDate);
                
            if (error) throw error;
            
            // Re-fetch after adjusting so syncTurnsForDate runs and updates turns_completed
            fetchTurns();
        } catch (err) {
            console.error('Lỗi cập nhật số tua:', err);
            alert('Có lỗi xảy ra khi điều chỉnh số tua!');
        }
    };

    const updateTurnsCompleted = async (employeeId: string, newTurns: number) => {
        try {
            const { error } = await supabase
                .from('TurnQueue')
                .update({ turns_completed: newTurns })
                .eq('employee_id', employeeId)
                .eq('date', selectedDate);
                
            if (error) throw error;
            fetchTurns();
        } catch (err) {
            console.error('Lỗi cập nhật số tua trực tiếp:', err);
            alert('Có lỗi xảy ra khi điều chỉnh số tua!');
        }
    };

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
        externalTurns,
        allExternalStaffs: sortedExternalStaffs,
        toggleExternalStaff,
        deleteExternalStaff,
        waterRefillerId,
        assignWaterRefiller,
        updateKtvStatus,
        updateManualAdjustment,
        updateTurnsCompleted
    };
};
