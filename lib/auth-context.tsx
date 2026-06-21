'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User, Role, ModuleId } from './types';
import { MODULES } from './constants';
import { createClient } from './supabase';
import { authenticateUser } from '@/app/login/actions';

interface AuthContextType {
  user: User | null;
  role: Role | null;
  login: (userId: string, password?: string) => Promise<boolean>;
  logout: () => void;
  changePassword: (newPassword: string) => Promise<void>;
  updateProfile: (name: string, avatarUrl: string) => Promise<void>;
  hasPermission: (moduleId: ModuleId) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    // 🔄 Restore session: sessionStorage (per-tab, ưu tiên) → localStorage (backup khi app bị kill)
    // sessionStorage giữ session riêng cho mỗi tab → không bị ghi đè khi mở 2 tab (admin + KTV)
    const tabUser = sessionStorage.getItem('spa_auth_user');
    const tabRole = sessionStorage.getItem('spa_auth_role');
    const savedUser = tabUser || localStorage.getItem('spa_auth_user');
    const savedRole = tabRole || localStorage.getItem('spa_auth_role');

    if (savedUser && savedRole) {
      try {
        const parsedUser = JSON.parse(savedUser);
        const parsedRole = JSON.parse(savedRole);
        setUser(parsedUser);
        setRole(parsedRole);
        // Sync vào sessionStorage nếu chưa có (trường hợp restore từ localStorage)
        if (!tabUser) sessionStorage.setItem('spa_auth_user', savedUser);
        if (!tabRole) sessionStorage.setItem('spa_auth_role', savedRole);
      } catch (e) {
        console.error('Failed to parse saved auth session', e);
        sessionStorage.removeItem('spa_auth_user');
        sessionStorage.removeItem('spa_auth_role');
        localStorage.removeItem('spa_auth_user');
        localStorage.removeItem('spa_auth_role');
      }
    }
  }, []);

  const login = async (userId: string, password?: string) => {
    try {
      // Use the Server Action to query public."Users" table
      const response = await authenticateUser(userId, password);

      if (response.success && response.user) {
        const dbUser = response.user;

        // Map database Role ENUM to local Role ID
        let roleId = 'ktv';
        const rawRole = dbUser.role?.toUpperCase();
        
        if (rawRole === 'ADMIN') roleId = 'admin';
        else if (rawRole === 'DEV') roleId = 'dev';
        else if (rawRole === 'MANAGER') roleId = 'branch_manager';
        else if (rawRole === 'RECEPTIONIST' || rawRole === 'LEAD_RECEPTIONIST') roleId = 'reception';
        else if (rawRole === 'TECHNICIAN' || rawRole === 'KTV') roleId = 'ktv';
        else if (rawRole === 'SUPPORT') roleId = 'support';

        const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(dbUser.fullName || dbUser.username)}`;
        const finalUser = {
          id: dbUser.id,
          password: dbUser.password,
          name: dbUser.fullName || dbUser.username,
          roleId: roleId,
          avatarUrl: dbUser.staffAvatarUrl || fallbackAvatar
        };

        setUser(finalUser);

        // Set role permissions (use DB permissions if available)
        let permissions: ModuleId[] = (dbUser.permissions && Array.isArray(dbUser.permissions)) ? dbUser.permissions : [];
        
        // 🔄 Auto-migrate renamed permissions (backwards compatibility)
        const PERMISSION_RENAMES: Record<string, ModuleId> = {
          'ktv_leave': 'ktv_schedule',
        };
        permissions = permissions.map(p => PERMISSION_RENAMES[p] || p) as ModuleId[];

        // If no permissions in DB, use smart defaults based on roleId
        if (permissions.length === 0) {
          if (roleId === 'admin' || roleId === 'dev') {
            permissions = MODULES.map(m => m.id);
          } else if (roleId === 'reception') {
            permissions = ['dashboard', 'dispatch_board', 'order_management', 'customer_management', 'ktv_hub', 'room_management', 'leave_management', 'turn_tracking', 'service_handbook', 'staff_notifications', 'settings'];
          } else if (roleId === 'ktv') {
            permissions = ['ktv_dashboard', 'ktv_attendance', 'ktv_schedule', 'ktv_performance', 'ktv_history', 'service_handbook', 'settings'];
          }
        }

        const finalRole = {
          id: roleId,
          name: dbUser.role,
          permissions
        };

        setRole(finalRole);

        // 💾 Save to sessionStorage (per-tab, isolated) + localStorage (backup khi app bị kill)
        sessionStorage.setItem('spa_auth_user', JSON.stringify(finalUser));
        sessionStorage.setItem('spa_auth_role', JSON.stringify(finalRole));
        localStorage.setItem('spa_auth_user', JSON.stringify(finalUser));
        localStorage.setItem('spa_auth_role', JSON.stringify(finalRole));

        return true;
      }
      return false;
    } catch (err) {
      console.error('Login error:', err);
      return false;
    }
  };

  const logout = async () => {
    // 🧹 DỌN DẸP: Xóa Push Subscription khi đăng xuất để cắt đứt thiết bị khỏi tài khoản cũ
    try {
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.pushManager) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            // Hủy đăng ký từ phía trình duyệt
            await sub.unsubscribe();
            // Gửi API để xóa khỏi Database
            if (user?.id) {
              await fetch('/api/ktv/push-unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staffId: user.id, endpoint: sub.endpoint })
              }).catch(e => console.warn('Unsubscribe API network error:', e));
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error during push unsubscribe:', e);
    }

    setUser(null);
    setRole(null);
    sessionStorage.removeItem('spa_auth_user');
    sessionStorage.removeItem('spa_auth_role');
    localStorage.removeItem('spa_auth_user');
    localStorage.removeItem('spa_auth_role');
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (e) { }
  };

  const changePassword = async (newPassword: string) => {
    if (user) {
      const { updatePasswordInDB } = await import('@/app/login/actions');
      const res = await updatePasswordInDB(user.id, newPassword);
      if (res.success) {
        setUser({ ...user, password: newPassword });
      }
    }
  };

  const updateProfile = async (name: string, avatarUrl: string) => {
    if (user) {
      const { updateProfileInDB } = await import('@/app/login/actions');
      const res = await updateProfileInDB(user.id, name, avatarUrl);
      if (res.success) {
        setUser({ ...user, name, avatarUrl });
      }
    }
  };

  const hasPermission = useCallback((moduleId: ModuleId) => {
    if (!role) return false;
    return role.permissions.includes(moduleId);
  }, [role]);

  return (
    <AuthContext.Provider value={{ user, role, login, logout, changePassword, updateProfile, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
