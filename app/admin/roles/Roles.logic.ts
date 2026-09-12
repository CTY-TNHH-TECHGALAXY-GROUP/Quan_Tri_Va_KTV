'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Role, ModuleId } from '@/lib/types';
import { getAllUsers, verifyAdminPassword, saveRolePermissions, getRolePermissions, updateUserPermissions } from './actions';

// --- MOCK DATA ---
const MOCK_ROLES: Role[] = [
    {
        id: 'admin',
        name: 'Admin Tối Cao',
        permissions: [
            'dashboard', 'dispatch_board', 'order_management', 'customer_management',
            'revenue_reports', 'payroll_commissions', 'cashbook_supplies', 'finance_management', 'web_booking',
            'service_menu', 'role_management', 'employee_management', 'ktv_hub',
            'ktv_dashboard', 'ktv_wallet', 'ktv_attendance', 'ktv_schedule', 'ktv_performance',
            'ktv_history', 'turn_tracking', 'service_handbook', 'ai_features', 'settings',
        ],
    },
    {
        id: 'reception',
        name: 'Lễ Tân',
        permissions: ['dashboard', 'dispatch_board', 'order_management', 'customer_management', 'finance_management', 'ktv_hub', 'turn_tracking', 'service_handbook', 'settings'],
    },
    {
        id: 'ktv',
        name: 'Kỹ Thuật Viên',
        permissions: ['ktv_dashboard', 'ktv_wallet', 'ktv_attendance', 'ktv_schedule', 'ktv_performance', 'ktv_history', 'service_handbook', 'settings'],
    },
    {
        id: 'support',
        name: 'Hậu Cần / Support',
        permissions: ['ktv_attendance', 'settings'],
    },
];

/**
 * Custom hook for Role Management page logic.
 */
export const useRoleManagement = () => {
    const { hasPermission } = useAuth();
    const [roles, setRoles] = useState<Role[]>(MOCK_ROLES);
    const [users, setUsers] = useState<any[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('roles');
    const [mounted, setMounted] = useState(false);

    // Admin unlock state
    const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordInput, setPasswordInput] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    // Store the pending toggle action while waiting for password
    const [pendingModuleId, setPendingModuleId] = useState<ModuleId | null>(null);

    // Individual User Permissions State
    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [currentUserPermissions, setCurrentUserPermissions] = useState<ModuleId[]>([]);
    const [isSavingUser, setIsSavingUser] = useState(false);

    useEffect(() => {
        setMounted(true);
        async function loadData() {
            const [usersRes, permsRes] = await Promise.all([
                getAllUsers(),
                getRolePermissions()
            ]);

            if (usersRes.success && usersRes.data) {
                setUsers(usersRes.data);
            }
            
            if (permsRes.success && permsRes.data) {
                const dbRoleMap = permsRes.data as Record<string, string[]>;
                setRoles(prev => prev.map(role => {
                    if (dbRoleMap[role.id]) {
                        return { ...role, permissions: dbRoleMap[role.id] as ModuleId[] };
                    }
                    return role;
                }));
            }
            
            setIsLoadingUsers(false);
        }
        loadData();
    }, []);

    // --- HANDLERS ---
    const togglePermission = (roleId: string, moduleId: ModuleId) => {
        // If admin role and not unlocked, show password modal
        if (roleId === 'admin' && !isAdminUnlocked) {
            setPendingModuleId(moduleId);
            setShowPasswordModal(true);
            setPasswordInput('');
            setPasswordError('');
            return;
        }

        setRoles(prev => prev.map(role => {
            if (role.id === roleId) {
                const hasPerm = role.permissions.includes(moduleId);
                return {
                    ...role,
                    permissions: hasPerm
                        ? role.permissions.filter(p => p !== moduleId)
                        : [...role.permissions, moduleId]
                };
            }
            return role;
        }));
    };

    const confirmAdminUnlock = async () => {
        if (!passwordInput.trim()) {
            setPasswordError('Vui lòng nhập mật khẩu!');
            return;
        }

        setIsVerifying(true);
        setPasswordError('');

        const res = await verifyAdminPassword(passwordInput.trim());

        if (res.success) {
            setIsAdminUnlocked(true);
            setShowPasswordModal(false);
            setPasswordInput('');

            // Execute the pending toggle
            if (pendingModuleId) {
                setRoles(prev => prev.map(role => {
                    if (role.id === 'admin') {
                        const hasPerm = role.permissions.includes(pendingModuleId!);
                        return {
                            ...role,
                            permissions: hasPerm
                                ? role.permissions.filter(p => p !== pendingModuleId)
                                : [...role.permissions, pendingModuleId!]
                        };
                    }
                    return role;
                }));
                setPendingModuleId(null);
            }
        } else {
            setPasswordError(res.error || 'Mật khẩu không chính xác!');
        }

        setIsVerifying(false);
    };

    const cancelPasswordModal = () => {
        setShowPasswordModal(false);
        setPasswordInput('');
        setPasswordError('');
        setPendingModuleId(null);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await saveRolePermissions(
                roles.map(r => ({ id: r.id, permissions: r.permissions as string[] }))
            );
            if (res.success) {
                alert('Đã lưu phân quyền thành công! Nhân viên cần đăng nhập lại để áp dụng.');
            } else {
                alert('Lỗi khi lưu: ' + (res.error || 'Unknown'));
            }
        } catch (err: any) {
            alert('Lỗi: ' + err.message);
        }
        setIsSaving(false);
    };

    const handleAddRole = () => {
        const roleName = prompt('Nhập tên Role mới:');
        if (!roleName) return;

        const newId = roleName.toLowerCase().replace(/\s+/g, '_');
        if (roles.find(r => r.id === newId)) {
            alert('Role này đã tồn tại!');
            return;
        }

        const newRole: Role = { id: newId, name: roleName, permissions: [] };
        setRoles(prev => [...prev, newRole]);
        alert(`Đã thêm Role "${roleName}" thành công!`);
    };

    // --- USER PERMISSIONS HANDLERS ---
    const handleOpenUserPermissions = (user: any) => {
        setSelectedUser(user);
        setCurrentUserPermissions(user.permissions || []);
        setIsUserModalOpen(true);
    };

    const handleCloseUserPermissions = () => {
        setIsUserModalOpen(false);
        setTimeout(() => {
            setSelectedUser(null);
            setCurrentUserPermissions([]);
        }, 200);
    };

    const handleToggleUserPermission = (moduleId: ModuleId) => {
        setCurrentUserPermissions(prev => {
            if (prev.includes(moduleId)) {
                return prev.filter(id => id !== moduleId);
            }
            return [...prev, moduleId];
        });
    };

    const handleApplyTemplate = (roleId: string | 'clear') => {
        if (roleId === 'clear') {
            setCurrentUserPermissions([]);
            return;
        }
        
        const templateRole = MOCK_ROLES.find(r => r.id === roleId);
        if (templateRole) {
            setCurrentUserPermissions([...templateRole.permissions]);
        }
    };

    const handleSaveUserPermissions = async () => {
        if (!selectedUser) return;
        
        setIsSavingUser(true);
        try {
            const res = await updateUserPermissions(selectedUser.id, currentUserPermissions);
            if (res.success) {
                setUsers(prev => prev.map(u => 
                    u.id === selectedUser.id ? { ...u, permissions: currentUserPermissions } : u
                ));
                alert('Đã cập nhật quyền cho nhân viên thành công!');
                handleCloseUserPermissions();
            } else {
                alert('Lỗi khi cập nhật quyền: ' + (res.error || 'Unknown'));
            }
        } catch (err: any) {
            alert('Lỗi hệ thống: ' + err.message);
        }
        setIsSavingUser(false);
    };

    const canAccessPage = hasPermission('role_management');

    return {
        // State
        roles,
        users,
        isLoadingUsers,
        isSaving,
        activeTab,
        mounted,

        // Admin unlock
        isAdminUnlocked,
        showPasswordModal,
        passwordInput,
        passwordError,
        isVerifying,

        // Computed
        canAccessPage,

        // Setters
        setActiveTab,
        setPasswordInput,

        // Handlers
        togglePermission,
        handleSave,
        handleAddRole,
        confirmAdminUnlock,
        cancelPasswordModal,
        // User permissions
        isUserModalOpen,
        selectedUser,
        currentUserPermissions,
        isSavingUser,
        handleOpenUserPermissions,
        handleCloseUserPermissions,
        handleToggleUserPermission,
        handleApplyTemplate,
        handleSaveUserPermissions,
    };
};
