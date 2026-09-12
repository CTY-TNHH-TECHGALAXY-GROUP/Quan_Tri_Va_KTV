import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

export type MilestonesMap = Record<string, number>;

export const useMilestonesEditorLogic = () => {
    const [milestonesA, setMilestonesA] = useState<MilestonesMap>({});
    const [milestonesB, setMilestonesB] = useState<MilestonesMap>({});
    const [milestonesC, setMilestonesC] = useState<MilestonesMap>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        setIsLoading(true);
        try {
            const data = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            if (data.data) {
                // Parse from JSON string or object depending on how it's stored
                let ma = data.data.ktv_commission_milestones_TYPE_A || data.data.ktv_commission_milestones || {};
                let mb = data.data.ktv_commission_milestones_TYPE_B || data.data.ktv_commission_milestones_type_b || {};
                let mc = data.data.ktv_commission_milestones_TYPE_C || {};
                
                if (typeof ma === 'string') {
                    try { ma = JSON.parse(ma); } catch { ma = {}; }
                }
                if (typeof mb === 'string') {
                    try { mb = JSON.parse(mb); } catch { mb = {}; }
                }
                if (typeof mc === 'string') {
                    try { mc = JSON.parse(mc); } catch { mc = {}; }
                }

                setMilestonesA(ma);
                setMilestonesB(mb);
                setMilestonesC(mc);
            }
        } catch (error) {
            console.error('Lỗi tải cấu hình:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setSaveStatus('idle');
        try {
            const payload = {
                ktv_commission_milestones_TYPE_A: milestonesA,
                ktv_commission_milestones_TYPE_B: milestonesB,
                ktv_commission_milestones_TYPE_C: milestonesC,
                // Giữ lại key cũ cho backward compat
                ktv_commission_milestones: milestonesA,
                ktv_commission_milestones_type_b: milestonesB
            };

            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, payload);
            if (result.success) {
                setSaveStatus('success');
                setTimeout(() => setSaveStatus('idle'), 3000);
            } else {
                setSaveStatus('error');
            }
        } catch (error) {
            console.error('Lỗi lưu cấu hình milestones:', error);
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    const updateMilestone = (type: 'A' | 'B' | 'C', oldMinutes: string, newMinutes: string, newValue: number) => {
        const setter = type === 'A' ? setMilestonesA : type === 'B' ? setMilestonesB : setMilestonesC;
        setter(prev => {
            const next = { ...prev };
            if (oldMinutes !== newMinutes) {
                delete next[oldMinutes];
            }
            next[newMinutes] = newValue;
            return next;
        });
    };

    const deleteMilestone = (type: 'A' | 'B' | 'C', minutes: string) => {
        const setter = type === 'A' ? setMilestonesA : type === 'B' ? setMilestonesB : setMilestonesC;
        setter(prev => {
            const next = { ...prev };
            delete next[minutes];
            return next;
        });
    };

    const addMilestone = (type: 'A' | 'B' | 'C') => {
        const setter = type === 'A' ? setMilestonesA : type === 'B' ? setMilestonesB : setMilestonesC;
        setter(prev => {
            return { ...prev, '': 0 }; // Add a blank entry
        });
    };

    return {
        milestonesA,
        milestonesB,
        milestonesC,
        isLoading,
        isSaving,
        saveStatus,
        handleSave,
        updateMilestone,
        deleteMilestone,
        addMilestone
    };
};
