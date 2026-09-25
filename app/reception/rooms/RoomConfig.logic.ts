import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

// 🔧 MASTER PROCEDURE STEPS (Admin picks from these)
export const MASTER_PREP_STEPS = [
    'Vệ sinh máy lạnh & quạt',
    'Chuẩn bị tinh dầu & dụng cụ',
    'Setup giường (Khăn, gối)',
    'Chuẩn bị khăn nóng',
    'Kiểm tra vệ sinh phòng',
    'Bật đèn & chỉnh ánh sáng',
    'Mở nhạc thư giãn',
    'Kiểm tra nước nóng',
    'Chuẩn bị áo choàng khách',
    'Xịt tinh dầu khuếch tán',
];

export const MASTER_HANDOVER_STEPS = [
    'Tổng quan phòng',
    'Giường & Khăn setup',
    'Bồn rửa & Dụng cụ',
    'Máy lạnh & Tinh dầu',
    'Sàn nhà & Thùng rác'
];

export interface RoomData {
    id: string;
    name: string;
    capacity: number;
    type: string;
    prep_procedure: string[] | null;
    clean_procedure: string[] | null;
    handover_checklist: string[] | null;
    allowed_services: string[] | null;
    default_reminders: string[] | null;
}

export interface ServiceData {
    id: string;
    code: string;
    nameVN: string;
    nameEN: string;
    category: string;
    duration: number;
}

export interface ReminderData {
    id: string;
    content: string;
    is_active: boolean;
    order_index: number;
}

export const useRoomConfig = () => {
    const [rooms, setRooms] = useState<RoomData[]>([]);
    const [services, setServices] = useState<ServiceData[]>([]);
    const [reminders, setReminders] = useState<ReminderData[]>([]);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'services' | 'prep' | 'handover' | 'reminders'>('services');

    const selectedRoom = rooms.find(r => r.id === selectedRoomId) || null;

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await apiClient.get<any>(API.ROOMS);
            setRooms(data.data?.rooms || []);
            setServices(data.data?.services || []);
            setReminders(data.data?.reminders || []);
            // Auto-select first room
            if (!selectedRoomId && (data.data?.rooms?.length || 0) > 0) {
                setSelectedRoomId(data.data.rooms[0].id);
            }
        } catch (err: any) {
            console.error('Error fetching rooms:', err.message || err);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRoomId]);

    useEffect(() => {
        fetchData();
    }, []);

    const updateRoom = async (roomId: string, updates: Partial<Pick<RoomData, 'prep_procedure' | 'clean_procedure' | 'handover_checklist' | 'allowed_services' | 'default_reminders'>>) => {
        setIsSaving(true);
        try {
            await apiClient.patch<any>(API.ROOMS, { roomId, ...updates });
            // Update local state
            setRooms(prev => prev.map(r => r.id === roomId ? { ...r, ...updates } : r));
            return true;
        } catch (err: any) {
            console.error('Error updating room:', err.message || err);
            alert('Lỗi lưu/kết nối!');
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    // Toggle a service for the selected room
    const toggleService = async (serviceId: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.allowed_services || [];
        const updated = current.includes(serviceId)
            ? current.filter(id => id !== serviceId)
            : [...current, serviceId];
        await updateRoom(selectedRoom.id, { allowed_services: updated });
    };

    // Toggle a reminder for the selected room
    const toggleReminder = async (reminderId: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.default_reminders || [];
        const updated = current.includes(reminderId)
            ? current.filter(id => id !== reminderId)
            : [...current, reminderId];
        await updateRoom(selectedRoom.id, { default_reminders: updated });
    };

    // Toggle a prep step for the selected room
    const togglePrepStep = async (step: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.prep_procedure || [];
        const updated = current.includes(step)
            ? current.filter(s => s !== step)
            : [...current, step];
        await updateRoom(selectedRoom.id, { prep_procedure: updated });
    };

    // Toggle a handover step for the selected room
    const toggleHandoverStep = async (step: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.handover_checklist || [];
        const updated = current.includes(step)
            ? current.filter(s => s !== step)
            : [...current, step];
        await updateRoom(selectedRoom.id, { handover_checklist: updated });
    };

    // Select/Deselect all
    const selectAllPrepSteps = async () => {
        if (!selectedRoom) return;
        await updateRoom(selectedRoom.id, { prep_procedure: [...MASTER_PREP_STEPS] });
    };

    const selectAllHandoverSteps = async () => {
        if (!selectedRoom) return;
        await updateRoom(selectedRoom.id, { handover_checklist: [...MASTER_HANDOVER_STEPS] });
    };

    const clearAllPrepSteps = async () => {
        if (!selectedRoom) return;
        await updateRoom(selectedRoom.id, { prep_procedure: [] });
    };

    const clearAllHandoverSteps = async () => {
        if (!selectedRoom) return;
        await updateRoom(selectedRoom.id, { handover_checklist: [] });
    };

    // Toggle entire category of services (add all / remove all)
    const toggleCategoryServices = async (serviceIds: string[], action: 'add' | 'remove') => {
        if (!selectedRoom) return;
        const current = selectedRoom.allowed_services || [];
        let updated: string[];
        if (action === 'add') {
            const toAdd = serviceIds.filter(id => !current.includes(id));
            updated = [...current, ...toAdd];
        } else {
            updated = current.filter(id => !serviceIds.includes(id));
        }
        await updateRoom(selectedRoom.id, { allowed_services: updated });
    };

    // Add custom step to a procedure
    const addCustomPrepStep = async (step: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.prep_procedure || [];
        await updateRoom(selectedRoom.id, { prep_procedure: [...current, step] });
    };

    const addCustomHandoverStep = async (step: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.handover_checklist || [];
        await updateRoom(selectedRoom.id, { handover_checklist: [...current, step] });
    };

    // Remove a step from a procedure (works for both master & custom steps)
    const removeCustomPrepStep = async (step: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.prep_procedure || [];
        await updateRoom(selectedRoom.id, { prep_procedure: current.filter(s => s !== step) });
    };

    const removeCustomHandoverStep = async (step: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.handover_checklist || [];
        await updateRoom(selectedRoom.id, { handover_checklist: current.filter(s => s !== step) });
    };

    // Edit (rename) a step in a procedure
    const editPrepStep = async (oldStep: string, newStep: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.prep_procedure || [];
        await updateRoom(selectedRoom.id, { prep_procedure: current.map(s => s === oldStep ? newStep : s) });
    };

    const editHandoverStep = async (oldStep: string, newStep: string) => {
        if (!selectedRoom) return;
        const current = selectedRoom.handover_checklist || [];
        await updateRoom(selectedRoom.id, { handover_checklist: current.map(s => s === oldStep ? newStep : s) });
    };

    const reorderPrepStep = async (stepIndex: number, direction: 'up' | 'down') => {
        if (!selectedRoom) return;
        const current = [...(selectedRoom.prep_procedure || [])];
        if (direction === 'up' && stepIndex > 0) {
            [current[stepIndex - 1], current[stepIndex]] = [current[stepIndex], current[stepIndex - 1]];
        } else if (direction === 'down' && stepIndex < current.length - 1) {
            [current[stepIndex], current[stepIndex + 1]] = [current[stepIndex + 1], current[stepIndex]];
        } else return;
        await updateRoom(selectedRoom.id, { prep_procedure: current });
    };

    const reorderHandoverStep = async (stepIndex: number, direction: 'up' | 'down') => {
        if (!selectedRoom) return;
        const current = [...(selectedRoom.handover_checklist || [])];
        if (direction === 'up' && stepIndex > 0) {
            [current[stepIndex - 1], current[stepIndex]] = [current[stepIndex], current[stepIndex - 1]];
        } else if (direction === 'down' && stepIndex < current.length - 1) {
            [current[stepIndex], current[stepIndex + 1]] = [current[stepIndex + 1], current[stepIndex]];
        } else return;
        await updateRoom(selectedRoom.id, { handover_checklist: current });
    };

    // Group services by category
    const servicesByCategory = services.reduce((acc, svc) => {
        let cats: string[] = [];
        if (Array.isArray(svc.category)) {
            cats = svc.category;
        } else if (typeof svc.category === 'string') {
            try { cats = JSON.parse(svc.category); } 
            catch(e) { cats = svc.category ? [svc.category] : ['Khác']; }
        } else {
            cats = ['Khác'];
        }
        
        if (cats.length === 0) cats = ['Khác'];

        cats.forEach(cat => {
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(svc);
        });
        return acc;
    }, {} as Record<string, ServiceData[]>);

    return {
        rooms,
        services,
        reminders,
        servicesByCategory,
        selectedRoom,
        selectedRoomId,
        setSelectedRoomId,
        isLoading,
        isSaving,
        activeTab,
        setActiveTab,
        toggleService,
        toggleReminder,
        toggleCategoryServices,
        togglePrepStep,
        toggleHandoverStep,
        selectAllPrepSteps,
        selectAllHandoverSteps,
        clearAllPrepSteps,
        clearAllHandoverSteps,
        addCustomPrepStep,
        addCustomHandoverStep,
        removeCustomPrepStep,
        removeCustomHandoverStep,
        editPrepStep,
        editHandoverStep,
        reorderPrepStep,
        reorderHandoverStep,
    };
};
