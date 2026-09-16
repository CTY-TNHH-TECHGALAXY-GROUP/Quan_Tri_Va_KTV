'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { MODULES } from '@/lib/constants';
import { ModuleId } from '@/lib/types';
import { ShieldAlert, Check, Plus, Save, User, Key, Lock, Unlock, ShieldCheck, X } from 'lucide-react';
import * as Checkbox from '@radix-ui/react-checkbox';
import * as Tabs from '@radix-ui/react-tabs';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'motion/react';
import { useRoleManagement } from './Roles.logic';
import { t } from './Roles.i18n';

export default function RoleManagementPage() {
    const {
        roles,
        users,
        isLoadingUsers,
        isSaving,
        activeTab,
        mounted,
        canAccessPage,
        isAdminUnlocked,
        showPasswordModal,
        passwordInput,
        passwordError,
        isVerifying,
        setActiveTab,
        setPasswordInput,
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
    } = useRoleManagement();

    if (!mounted) return null;

    if (!canAccessPage) {
        return (
            <AppLayout title="Phân Quyền">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">{t.noAccess}</h2>
                    <p className="text-gray-500 mt-2">{t.noAccessDetail}</p>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout title="Phân Quyền">
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <p className="text-sm text-gray-500">{t.pageSubtitle}</p>
                    </div>
                </div>

                <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <Tabs.List className="flex border-b border-gray-200">
                        <Tabs.Trigger
                            value="roles"
                            className={`px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'roles' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {t.tabRoles}
                            {activeTab === 'roles' && (
                                <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
                            )}
                        </Tabs.Trigger>
                        <Tabs.Trigger
                            value="accounts"
                            className={`px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'accounts' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {t.tabAccounts}
                            {activeTab === 'accounts' && (
                                <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
                            )}
                        </Tabs.Trigger>
                    </Tabs.List>

                    <Tabs.Content value="roles" className="space-y-6 outline-none">
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={handleAddRole}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm transition-colors"
                            >
                                <Plus size={16} />
                                {t.addRole}
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm transition-colors disabled:opacity-70"
                            >
                                <Save size={16} />
                                {isSaving ? t.saving : t.saveChanges}
                            </button>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col max-w-full">
                            <div className="overflow-x-auto w-full flex-1">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr>
                                            <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 min-w-[200px] sticky left-0 z-10 shadow-[1px_0_0_0_#e5e7eb]">
                                                {t.moduleColumn}
                                            </th>
                                            {roles.map(role => (
                                                <th key={role.id} className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-center min-w-[140px]">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span>{role.name}</span>
                                                        {role.id === 'admin' && (
                                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                                isAdminUnlocked 
                                                                    ? 'bg-green-100 text-green-700' 
                                                                    : 'bg-amber-100 text-amber-700'
                                                            }`}>
                                                                {isAdminUnlocked ? <><Unlock size={10} /> Đã mở khoá</> : <><Lock size={10} /> Đang khoá</>}
                                                            </span>
                                                        )}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {MODULES.map(module => (
                                            <tr key={module.id} className="hover:bg-gray-50/50 transition-colors">
                                                <td className="p-4 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#e5e7eb]">
                                                    <div className="font-medium text-gray-900">{module.name}</div>
                                                    <div className="text-xs text-gray-500 mt-0.5">{module.group}</div>
                                                </td>
                                                {roles.map(role => {
                                                    const isChecked = role.permissions.includes(module.id as ModuleId);
                                                    const isAdmin = role.id === 'admin';
                                                    const isLocked = isAdmin && !isAdminUnlocked;
                                                    return (
                                                        <td key={`${role.id}-${module.id}`} className="p-4 text-center">
                                                            <Checkbox.Root
                                                                checked={isChecked}
                                                                onCheckedChange={() => togglePermission(role.id, module.id as ModuleId)}
                                                                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${isChecked
                                                                    ? isLocked ? 'bg-indigo-300 text-white cursor-pointer' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                                                    : isLocked ? 'bg-gray-100 border border-gray-300 cursor-pointer' : 'bg-gray-100 border border-gray-300 hover:border-indigo-400'
                                                                }`}
                                                            >
                                                                <Checkbox.Indicator>
                                                                    <Check size={16} strokeWidth={3} />
                                                                </Checkbox.Indicator>
                                                            </Checkbox.Root>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </Tabs.Content>

                    <Tabs.Content value="accounts" className="space-y-6 outline-none">
                        <div className="space-y-4">
                            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                                <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                                    <User size={18} className="text-indigo-600" />
                                    <h3 className="font-bold text-gray-900">{t.accountListTitle}</h3>
                                </div>
                                <div className="divide-y divide-gray-100">
                                    {isLoadingUsers ? (
                                        <div className="p-8 text-center text-gray-500">{t.loadingAccounts}</div>
                                    ) : users.length === 0 ? (
                                        <div className="p-8 text-center text-gray-500">{t.emptyAccounts}</div>
                                    ) : users.map(u => (
                                        <div key={u.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                                                    {(u.fullName || u.username || '?').charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-gray-900">{u.fullName || u.username}</div>
                                                    <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                                                        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">{u.role}</span>
                                                        <span>ID: {u.username}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 text-right">
                                                <div className="text-sm font-mono text-gray-600 mr-2 px-2 py-1 bg-gray-50 rounded border border-gray-200">
                                                    {u.password || '***'}
                                                </div>
                                                <button onClick={() => handleOpenUserPermissions(u)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title={t.changePermission}>
                                                    <Key size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </Tabs.Content>
                </Tabs.Root>
            </div>

            {/* Password Modal */}
            <AnimatePresence>
                {showPasswordModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                        onClick={cancelPasswordModal}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            onClick={e => e.stopPropagation()}
                            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5"
                        >
                            <div className="text-center">
                                <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <ShieldCheck size={28} className="text-amber-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900">Xác thực quyền Admin</h3>
                                <p className="text-sm text-gray-500 mt-1">Nhập mật khẩu hệ thống để mở khoá chỉnh sửa quyền Admin</p>
                            </div>

                            <div>
                                <input
                                    type="password"
                                    value={passwordInput}
                                    onChange={e => setPasswordInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && confirmAdminUnlock()}
                                    placeholder="Nhập mật khẩu hệ thống..."
                                    autoFocus
                                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all"
                                />
                                {passwordError && (
                                    <p className="text-sm text-red-600 font-medium mt-2 flex items-center gap-1">
                                        <ShieldAlert size={14} /> {passwordError}
                                    </p>
                                )}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={cancelPasswordModal}
                                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                                >
                                    Huỷ
                                </button>
                                <button
                                    onClick={confirmAdminUnlock}
                                    disabled={isVerifying}
                                    className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                                >
                                    {isVerifying ? (
                                        <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                    ) : (
                                        <><Unlock size={16} /> Mở khoá</>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Individual User Permissions Modal */}
            <Dialog.Root open={isUserModalOpen} onOpenChange={handleCloseUserPermissions}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] animate-in fade-in duration-200" />
                    <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl z-[110] flex flex-col animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="flex items-center justify-between p-6 border-b border-gray-100">
                            <div>
                                <Dialog.Title className="text-xl font-bold text-gray-900">
                                    Phân quyền chi tiết: {selectedUser?.fullName || selectedUser?.username}
                                </Dialog.Title>
                                <Dialog.Description className="text-sm text-gray-500 mt-1">
                                    Tuỳ chỉnh quyền truy cập riêng rẽ, không phụ thuộc vào nhóm vai trò.
                                </Dialog.Description>
                            </div>
                            <button onClick={handleCloseUserPermissions} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 flex-1 overflow-y-auto bg-gray-50/50">
                            {/* Templates Bar */}
                            <div className="mb-6 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Chọn nhanh từ mẫu</div>
                                <div className="flex flex-wrap gap-2">
                                    <button onClick={() => handleApplyTemplate('ktv')} className="px-3 py-1.5 text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors">
                                        Mẫu Kỹ Thuật Viên
                                    </button>
                                    <button onClick={() => handleApplyTemplate('reception')} className="px-3 py-1.5 text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
                                        Mẫu Lễ Tân
                                    </button>
                                    <button onClick={() => handleApplyTemplate('admin')} className="px-3 py-1.5 text-sm font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors">
                                        Mẫu Admin
                                    </button>
                                    <div className="w-px h-8 bg-gray-200 mx-2" />
                                    <button onClick={() => handleApplyTemplate('clear')} className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                                        Bỏ chọn tất cả
                                    </button>
                                </div>
                            </div>

                            {/* Modules Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {MODULES.map(module => {
                                    const isChecked = currentUserPermissions.includes(module.id as ModuleId);
                                    return (
                                        <div 
                                            key={module.id} 
                                            onClick={() => handleToggleUserPermission(module.id as ModuleId)}
                                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3 ${
                                                isChecked 
                                                    ? 'bg-indigo-50 border-indigo-500 shadow-sm' 
                                                    : 'bg-white border-gray-200 hover:border-indigo-300'
                                            }`}
                                        >
                                            <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center transition-colors flex-shrink-0 ${
                                                isChecked ? 'bg-indigo-600 text-white' : 'border-2 border-gray-300'
                                            }`}>
                                                {isChecked && <Check size={14} strokeWidth={3} />}
                                            </div>
                                            <div>
                                                <div className={`font-bold ${isChecked ? 'text-indigo-900' : 'text-gray-700'}`}>
                                                    {module.name}
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1">{module.group}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-6 border-t border-gray-100 bg-white flex justify-end gap-3 rounded-b-2xl">
                            <button onClick={handleCloseUserPermissions} className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors">
                                Huỷ
                            </button>
                            <button 
                                onClick={handleSaveUserPermissions} 
                                disabled={isSavingUser}
                                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-70 flex items-center gap-2 shadow-sm"
                            >
                                {isSavingUser ? (
                                    <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                ) : (
                                    <><Save size={18} /> Lưu thay đổi</>
                                )}
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

        </AppLayout>
    );
}
