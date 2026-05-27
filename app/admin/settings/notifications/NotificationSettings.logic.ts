'use client';

import { useState, useEffect, useCallback } from 'react';

// 🔧 UI CONFIGURATION
const ROLE_OPTIONS = [
    { id: 'admin', label: 'Admin' },
    { id: 'reception', label: 'Quầy' },
    { id: 'ktv', label: 'KTV' },
] as const;

interface NotifRule {
    label: string;
    icon: string;
    allowed_roles: string[];
    include_target_employee: boolean;
    require_on_shift: boolean;
    sound: string;
    enabled: boolean;
}

export const useNotificationSettings = () => {
    const [rules, setRules] = useState<Record<string, NotifRule>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    const fetchRules = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/notification-rules');
            const data = await res.json();
            if (data.success) {
                setRules(data.data || {});
            } else {
                setError(data.error || 'Failed to fetch rules');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRules();
    }, [fetchRules]);

    const toggleRole = (type: string, roleId: string) => {
        setRules(prev => {
            const rule = prev[type];
            if (!rule) return prev;
            const roles = rule.allowed_roles || [];
            const newRoles = roles.includes(roleId)
                ? roles.filter(r => r !== roleId)
                : [...roles, roleId];
            return { ...prev, [type]: { ...rule, allowed_roles: newRoles } };
        });
        setHasChanges(true);
    };

    const toggleEnabled = (type: string) => {
        setRules(prev => {
            const rule = prev[type];
            if (!rule) return prev;
            return { ...prev, [type]: { ...rule, enabled: !rule.enabled } };
        });
        setHasChanges(true);
    };

    const toggleOnShift = (type: string) => {
        setRules(prev => {
            const rule = prev[type];
            if (!rule) return prev;
            return { ...prev, [type]: { ...rule, require_on_shift: !rule.require_on_shift } };
        });
        setHasChanges(true);
    };

    const toggleTargetEmployee = (type: string) => {
        setRules(prev => {
            const rule = prev[type];
            if (!rule) return prev;
            return { ...prev, [type]: { ...rule, include_target_employee: !rule.include_target_employee } };
        });
        setHasChanges(true);
    };

    const saveRules = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/notification-rules', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rules }),
            });
            const data = await res.json();
            if (data.success) {
                setHasChanges(false);
            } else {
                setError(data.error || 'Failed to save');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return {
        rules,
        loading,
        saving,
        error,
        hasChanges,
        ROLE_OPTIONS,
        toggleRole,
        toggleEnabled,
        toggleOnShift,
        toggleTargetEmployee,
        saveRules,
        fetchRules,
    };
};
