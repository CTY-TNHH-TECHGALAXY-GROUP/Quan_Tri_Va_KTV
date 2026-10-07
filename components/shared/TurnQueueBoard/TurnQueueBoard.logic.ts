import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { StaffData, TurnQueueData } from './TurnQueueBoard.types';
import { STAFF_STATUS } from '@/lib/constants/staffStatus';
import { saveTurnQueueEdits } from './actions';
import { isPlaceholderStaffId, isTypeCWorkType } from '@/lib/constants/staff.constants';

export const useTurnQueueBoard = (staffs: StaffData[], draftCacheKey?: string) => {
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
    const savingRef = useRef(false);
    const manualPendingRef = useRef(new Set<string>());
    const [manualPendingIds, setManualPendingIds] = useState<Set<string>>(new Set());
    const [saveMessage, setSaveMessage] = useState('');
    type OrderEdit = { id: string; expectedOrder: number; expectedPosition: number; order: number };
    const editsRef = useRef<Record<string, OrderEdit>>({});
    const dateRef = useRef(selectedDate);
    dateRef.current = selectedDate;
    const cacheKey = draftCacheKey ? `turn-queue-draft:${draftCacheKey}:${selectedDate}` : null;
    const persistEdits = useCallback(() => {
        if (!cacheKey) return;
        try {
            if (Object.keys(editsRef.current).length) sessionStorage.setItem(cacheKey, JSON.stringify(editsRef.current));
            else sessionStorage.removeItem(cacheKey);
        } catch { /* A full/disabled browser cache must not prevent editing. */ }
    }, [cacheKey]);
    useEffect(() => {
        let cached: Record<string, OrderEdit> = {};
        try { cached = cacheKey ? JSON.parse(sessionStorage.getItem(cacheKey) || '{}') : {}; } catch { /* Ignore invalid cache. */ }
        editsRef.current = cached && typeof cached === 'object' && !Array.isArray(cached) ? cached : {};
        hasChangesRef.current = Object.keys(editsRef.current).length > 0;
        setHasChanges(hasChangesRef.current);
        setLocalOrder([]);
        setTurns([]);
        setExternalTurns([]);
        setSaveMessage('');
    }, [cacheKey, selectedDate]);
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (!hasChangesRef.current && !savingRef.current && !manualPendingRef.current.size) return;
            event.preventDefault(); event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);

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

    // ✅ UNIFIED DATA PATH: Fetch qua API (trigger sync + correct sorting for all types)
    const fetchTurns = useCallback(async () => {
        setLoading(true);
        try {
            // `includeTypeC=1`: mặc định API loại C khỏi "Tất cả" → bảng Cộng tác viên chưa
            // từng nhận được dòng tua của C (trạng thái, số tua, tag điểm danh). Tách C ở dưới.
            const res = await fetch(`/api/turns?date=${selectedDate}&includeTypeC=1`);
            const json = await res.json();
            if (dateRef.current !== selectedDate) return;
            if (json.success && json.data) {
                const merged = json.data.map((t: TurnQueueData) => ({
                    ...t,
                    staff: staffs.find(s => s.id === t.employee_id)
                }));
                // Tách bằng work_type. Mã placeholder cũ (EXT_/C_, đã ĐÃ NGHỈ) bỏ hẳn —
                // syncTurnsForDate vẫn dựng lại TurnQueue cho chúng từ TurnLedger ngày cũ.
                const internal = merged.filter((t: TurnQueueData) => !isTypeCWorkType(t.work_type));
                const external = merged.filter((t: TurnQueueData) => isTypeCWorkType(t.work_type) && !isPlaceholderStaffId(t.employee_id));
                setTurns(internal);
                setExternalTurns(external);
            }
        } catch (err) {
            console.error('Fetch turns error:', err);
        }
        setLoading(false);
    }, [selectedDate, staffs]);

    useEffect(() => {
        if (staffs.length > 0) {
            // Chỉ cộng tác viên có tài khoản thật, đang làm. Từ dispatch, `staffs` còn
            // lẫn 138 mã nhập tay cũ (ĐÃ NGHỈ) — không được lòi ra đây.
            setAllExternalStaffs(staffs.filter(s =>
                isTypeCWorkType(s.work_type) && s.status === STAFF_STATUS.WORKING && !isPlaceholderStaffId(s.id)
            ));
            fetchTurns();
            fetchExtras();
        }
    }, [staffs, selectedDate, fetchTurns, fetchExtras, cacheKey]);

    // 🔄 REALTIME: Lắng nghe các bảng quan trọng liên quan đến điều phối
    // ✅ Bước 4: Gộp 2 đường dữ liệu — TẤT CẢ đều gọi fetchTurns() (qua API)
    useEffect(() => {
        if (staffs.length === 0) return;

        const channel = supabase.channel('turn-realtime-sync')
            // Bảng BookingItems: Gán KTV, đổi KTV, thêm dịch vụ add-on
            .on('postgres_changes', { event: '*', schema: 'public', table: 'BookingItems' }, () => {
                console.log('🔄 [Realtime] BookingItems changed → syncing turns...');
                fetchTurns();
            })
            // Bảng Bookings: Cập nhật trạng thái đơn (DONE, CANCELLED, NEW...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'Bookings' }, () => {
                console.log('🔄 [Realtime] Bookings changed → syncing turns...');
                fetchTurns();
            })
            // Bảng TurnQueue: Thay đổi tua trực tiếp (swap vị trí, reset, tan ca...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'TurnQueue' }, () => {
                console.log('🔄 [Realtime] TurnQueue changed → refreshing...');
                fetchTurns();
            })
            // Bảng DailyAttendance: Điểm danh, đổi trạng thái (on_duty, off_duty, absent...)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'DailyAttendance' }, () => {
                console.log('🔄 [Realtime] DailyAttendance changed → syncing turns...');
                fetchTurns();
            })
            // Bảng KTVAttendance: KTV bấm điểm danh / tan ca trên app
            .on('postgres_changes', { event: '*', schema: 'public', table: 'KTVAttendance' }, () => {
                console.log('🔄 [Realtime] KTVAttendance changed → syncing turns...');
                fetchTurns();
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
    }, [staffs, selectedDate, fetchTurns, fetchExtras]);

    // Sắp xếp: off cuối → giữ nguyên thứ tự API (API đã sort đúng cho mỗi loại)
    const buildSorted = useCallback((source: (TurnQueueData & { staff?: StaffData })[]) => {
        return [...source].sort((a, b) => {
            const isAOff = a.status === 'off' || suddenOffs.has(a.employee_id);
            const isBOff = b.status === 'off' || suddenOffs.has(b.employee_id);
            if (isAOff && !isBOff) return 1;
            if (!isAOff && isBOff) return -1;
            // Giữ nguyên thứ tự API cho non-off KTVs
            // API đã sort: A/B → turns_completed ASC, D → net_hours DESC
            return 0;
        });
    }, [suddenOffs]);

    // Operational status always refreshes; only the edited ordering overlays server data.
    useEffect(() => {
        setLocalOrder(buildSorted(turns).map(turn => ({ ...turn,
            check_in_order: editsRef.current[turn.id || '']?.order ?? turn.check_in_order })));
    }, [turns, buildSorted, hasChanges]);

    const applyOrder = async (action: 'ORDER' | 'RESET', payload: OrderEdit[]) => {
        if (savingRef.current || !payload.length) return;
        savingRef.current = true;
        setIsSavingOrder(true);
        setSaveMessage('');
        try {
            const result = await saveTurnQueueEdits(selectedDate, action, payload);
            if (!result.success) throw new Error(result.error);
            editsRef.current = {};
            hasChangesRef.current = false;
            persistEdits();
            setHasChanges(false);
            setSaveMessage(action === 'ORDER' ? 'Đã lưu thứ tự.' : 'Đã đặt lại theo chấm công.');
            await fetchTurns();
        } catch (error: any) {
            setSaveMessage(error.message || 'Không lưu được. Bản nháp vẫn được giữ.');
        } finally {
            savingRef.current = false;
            setIsSavingOrder(false);
        }
    };
    const saveOrder = () => applyOrder('ORDER', Object.values(editsRef.current));

    const cancelOrder = useCallback(() => {
        if (savingRef.current) return;
        editsRef.current = {};
        persistEdits();
        setLocalOrder(buildSorted(turns));
        setHasChanges(false);
        hasChangesRef.current = false;
        setEditingKtvId(null);
        setSaveMessage('');
    }, [persistEdits, buildSorted, turns]);

    const handleOrderChange = (ktvId: string, newOrder: number) => {
        if (savingRef.current) return;
        if (!Number.isInteger(newOrder) || newOrder < 1 || newOrder > 100000) {
            setSaveMessage('Thứ tự phải là số nguyên từ 1 đến 100000.'); return;
        }
        const next = localOrder.map(t => ({ ...t }));
        const target = next.find(t => t.employee_id === ktvId);
        if (!target) return;
        const oldOrder = target.check_in_order;
        const conflict = next.find(t => t.check_in_order === newOrder && t.employee_id !== ktvId);
        if (conflict) conflict.check_in_order = oldOrder;
        target.check_in_order = newOrder;
        for (const row of next) {
            if (!row.id) continue;
            const original = editsRef.current[row.id] || {
                id: row.id, expectedOrder: turns.find(t => t.id === row.id)?.check_in_order ?? row.check_in_order,
                expectedPosition: turns.find(t => t.id === row.id)?.queue_position ?? row.queue_position,
                order: row.check_in_order
            };
            if (row.check_in_order === original.expectedOrder) delete editsRef.current[row.id];
            else editsRef.current[row.id] = { ...original, order: row.check_in_order };
        }
        hasChangesRef.current = Object.keys(editsRef.current).length > 0;
        persistEdits();
        setLocalOrder(next);
        setHasChanges(hasChangesRef.current);
        setSaveMessage('');
        setEditingKtvId(null);
    };

    const resetTurns = () => applyOrder('RESET', [...turns].sort((a,b) => a.check_in_order-b.check_in_order).map((turn,i) => ({
        id: turn.id!, expectedOrder: turn.check_in_order, expectedPosition: turn.queue_position, order: i+1
    })));

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

    // Nút "Xóa KTV ngoài" (DELETE Staff / ép ĐÃ NGHỈ) đã bỏ 12/09/2026: loại C giờ
    // là tài khoản thật, cho nghỉ việc phải qua Admin → Nhân viên như mọi loại khác.

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

    const updateManualAdjustment = async (employeeId: string, delta: number, _currentManualAdj: number = 0) => {
        if (manualPendingRef.current.has(employeeId)) return;
        manualPendingRef.current.add(employeeId);
        setManualPendingIds(new Set(manualPendingRef.current));
        setSaveMessage('');
        try {
            const result = await saveTurnQueueEdits(selectedDate, 'DELTA', { employeeId, delta });
            if (!result.success) throw new Error(result.error);
            await fetchTurns();
            setSaveMessage('Đã cập nhật số tua.');
        } catch (error: any) {
            setSaveMessage(error.message || 'Không cập nhật được số tua.');
        } finally {
            manualPendingRef.current.delete(employeeId);
            setManualPendingIds(new Set(manualPendingRef.current));
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
        manualPendingIds,
        saveMessage,
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
        waterRefillerId,
        assignWaterRefiller,
        updateKtvStatus,
        updateManualAdjustment,
        updateTurnsCompleted
    };
};
