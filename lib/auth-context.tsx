'use client';

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { User, Role, ModuleId } from './types';
import { MODULES } from './constants';
import { createClient } from './supabase';
import { authenticateUser } from '@/app/login/actions';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';

interface AuthContextType {
  user: User | null;
  role: Role | null;
  lockedInfo: any;
  /** Lý do lần đăng nhập gần nhất thất bại — để trang login nói đúng chuyện. */
  getLoginError: () => string | null;
  login: (userId: string, password?: string) => Promise<boolean>;
  logout: () => void;
  changePassword: (newPassword: string) => Promise<void>;
  updateProfile: (name: string, avatarUrl: string) => Promise<void>;
  hasPermission: (moduleId: ModuleId) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Bao lâu hỏi lại server một lần xem session còn hiệu lực. */
const SESSION_CHECK_INTERVAL_MS = 60_000;

/** Dọn sạch session ở CẢ HAI kho — sót một chỗ là lần load sau tự khôi phục lại. */
function clearAuthStorage() {
  sessionStorage.removeItem('spa_auth_user');
  sessionStorage.removeItem('spa_auth_role');
  localStorage.removeItem('spa_auth_user');
  localStorage.removeItem('spa_auth_role');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [lockedInfo, setLockedInfo] = useState<any>(null);
  // Dùng ref chứ không dùng state: trang login đọc ngay sau `await login()`,
  // mà state lúc đó chưa kịp về tới closure của hàm xử lý submit.
  const loginErrorRef = useRef<string | null>(null);
  const getLoginError = useCallback(() => loginErrorRef.current, []);
  /** Mốc cấp session hiện tại — mọi đường ép đăng xuất đều so với mốc này. */
  const sessionIssuedAt = user?.sessionIssuedAt;

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
        clearAuthStorage();
      }
    }
  }, []);

  // 🛡️ BẢO MẬT: Lắng nghe Realtime để ép đăng xuất nếu bị Admin vô hiệu hóa hoặc đổi mật khẩu
  useEffect(() => {
    if (!user?.id) return;

    const supabase = createClient();
    let isLoggedOut = false;
    
    // 1. Giám sát trạng thái hoạt động (bảng Staff)
    const staffSub = supabase
      .channel(`public:Staff:id=eq.${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'Staff', filter: `id=eq.${user.id}` },
        (payload) => {
          if (payload.new.status === 'ĐÃ NGHỈ' && !isLoggedOut) {
            console.warn('⚠️ Tài khoản bị vô hiệu hóa bởi Admin. Đang ép đăng xuất...');
            isLoggedOut = true;
            // Dọn dẹp storage ngay lập tức để tránh reload loop
            clearAuthStorage();
            window.location.href = '/login?error=account_locked';
          }
          // Admin vừa đổi cờ tính năng của đúng người này -> ra ngay, không
          // phải đợi tới lượt hỏi định kỳ.
          const issuedAt = sessionIssuedAt;
          if (issuedAt && payload.new.session_epoch && !isLoggedOut) {
            const epochMs = Date.parse(String(payload.new.session_epoch));
            if (!Number.isNaN(epochMs) && epochMs > Date.parse(issuedAt)) {
              isLoggedOut = true;
              clearAuthStorage();
              window.location.href = '/login?error=config_changed';
              return;
            }
          }
          if (payload.new.status === 'KHÓA_TÀI_KHOẢN') {
            // Sẽ handle bằng cách trigger reload hoặc context state, hiện tại chỉ trigger event
            window.dispatchEvent(new CustomEvent('account_locked', { detail: { isLocked: true } }));
          } else if (payload.old.status === 'KHÓA_TÀI_KHOẢN' && payload.new.status !== 'KHÓA_TÀI_KHOẢN') {
            window.dispatchEvent(new CustomEvent('account_locked', { detail: { isLocked: false } }));
          }
        }
      )
      .subscribe();

    // 2. Giám sát thay đổi mật khẩu (bảng Users)
    const usersSub = supabase
      .channel(`public:Users:id=eq.${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'Users', filter: `id=eq.${user.id}` },
        (payload) => {
          if (payload.new.password && payload.new.password !== user.password && !isLoggedOut) {
            console.warn('⚠️ Mật khẩu đã bị thay đổi ở nơi khác. Đang ép đăng xuất...');
            isLoggedOut = true;
            clearAuthStorage();
            window.location.href = '/login';
          }
        }
      )
      .subscribe();

    // 3. Mốc theo LOẠI KTV / TOÀN HỆ THỐNG (admin đổi công tắc chung)
    const configSub = supabase
      .channel('public:SystemConfigs:auth_session_epoch')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'SystemConfigs', filter: 'key=eq.auth_session_epoch' },
        (payload: any) => {
          const issuedAt = sessionIssuedAt;
          if (!issuedAt || isLoggedOut) return;

          let epochs = payload.new?.value;
          if (typeof epochs === 'string') {
            try { epochs = JSON.parse(epochs); } catch { return; }
          }
          if (!epochs) return;

          const issuedMs = Date.parse(issuedAt);
          const mine = [epochs['ALL'], epochs[user.work_type || 'TYPE_A']];
          const hit = mine.some(at => at && Date.parse(String(at)) > issuedMs);
          if (hit) {
            isLoggedOut = true;
            clearAuthStorage();
            window.location.href = '/login?error=config_changed';
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(staffSub);
      supabase.removeChannel(usersSub);
      supabase.removeChannel(configSub);
    };
  }, [user?.id, user?.password, user?.work_type, sessionIssuedAt]);

  // 🔄 Cấu hình đổi → ép đăng nhập lại.
  //
  // Máy nào không bao giờ đăng xuất (app chạy nền cả tuần) vẫn giữ role và cờ
  // tính năng cũ trong storage, nên admin tắt tính năng xong họ vẫn thấy menu
  // cũ. Hỏi server định kỳ + mỗi lần quay lại tab để bắt được thay đổi.
  useEffect(() => {
    if (!user?.id) return;
    // Session cũ cấp trước khi có tính năng này thì không có mốc — bỏ qua,
    // không đá họ ra oan lúc vừa deploy.
    if (!sessionIssuedAt) return;
    const issuedAt = sessionIssuedAt;

    let stopped = false;

    const check = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      try {
        const res = await fetch(API.AUTH.SESSION_CHECK(user.id, issuedAt), { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (json?.mustLogout && !stopped) {
          stopped = true;
          console.warn('⚠️ Cấu hình tài khoản đã thay đổi. Đang ép đăng nhập lại...');
          clearAuthStorage();
          window.location.href = '/login?error=config_changed';
        }
      } catch {
        // Mất mạng thì thôi, lần sau hỏi lại — không tự ý đá người dùng ra.
      }
    };

    check();
    const timer = setInterval(check, SESSION_CHECK_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [user?.id, sessionIssuedAt]);

  // 🔑 JWT hết hạn (API trả 401) → dọn session và ép đăng nhập lại.
  // Không có bước này thì user đã login trên UI nhưng mọi API đều 401, màn hình trắng im lặng.
  useEffect(() => {
    const handleSessionExpired = () => {
      clearAuthStorage();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?error=session_expired';
      }
    };

    window.addEventListener('session_expired', handleSessionExpired);
    return () => window.removeEventListener('session_expired', handleSessionExpired);
  }, []);

  const login = async (userId: string, password?: string) => {
    try {
      // Use the Server Action to query public."Users" table
      const response = await authenticateUser(userId, password);

      // Bị khoá thì báo đúng lý do, đừng để trang login đổ tại sai mật khẩu.
      loginErrorRef.current = (
        !response.success && (response as any).error === 'ACCOUNT_LOCKED'
          ? ((response as any).message || 'Tài khoản của bạn đang bị khoá kỷ luật.')
          : null
      );

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
          code: dbUser.code,
          password: dbUser.password,
          name: dbUser.fullName || dbUser.username,
          roleId: roleId,
          avatarUrl: dbUser.staffAvatarUrl || fallbackAvatar,
          featureFlags: dbUser.featureFlags || {},
          work_type: dbUser.work_type,
          // Mốc cấp session. Admin đổi cấu hình sau mốc này thì session hết
          // hiệu lực -> ép đăng nhập lại để nhận cờ/quyền mới.
          sessionIssuedAt: new Date().toISOString()
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
            permissions = ['dashboard', 'dispatch_board', 'order_management', 'customer_management', 'ktv_hub', 'room_management', 'leave_management', 'turn_tracking', 'service_handbook', 'staff_notifications', 'settings', 'ktv_office_scoring', 'ktv_office_hours'];
          } else if (roleId === 'ktv') {
            permissions = ['ktv_dashboard', 'ktv_attendance', 'ktv_schedule', 'ktv_performance', 'ktv_history', 'ktv_hours_ranking', 'service_handbook', 'settings'];
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
              await apiClient.post<any>(API.KTV.PUSH_UNSUB, { staffId: user.id, endpoint: sub.endpoint }).catch(e => console.warn('Unsubscribe API network error:', e));
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error during push unsubscribe:', e);
    }

    setUser(null);
    setRole(null);
    clearAuthStorage();
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
    
    // Auto-grant quyền mới cho admin, dev, và lễ tân (tránh lỗi cache session cũ)
    if (moduleId === 'ktv_office_scoring' || moduleId === 'ktv_office_hours') {
      if (role.id === 'admin' || role.id === 'dev' || role.id === 'reception') return true;
    }

    // Bảng xếp hạng giờ chỉ có nghĩa với KTV Loại D — sổ giờ chỉ ghi cho nhóm này,
    // nhóm khác chia tua theo SỐ TUA nên mở ra sẽ toàn 0h. Quyết theo work_type ở
    // đây để KTV Loại D thấy ngay, admin không phải vào Phân quyền cấp lại từng vai trò.
    if (moduleId === 'ktv_hours_ranking') {
      return user?.work_type === 'TYPE_D';
    }

    // HIỂN THỊ "BÀN GIAO CÔNG VIỆC" NẾU ĐƯỢC BẬT TRONG TÍNH NĂNG NHÂN VIÊN
    if (moduleId === 'employee_tasks') {
      if (role.id === 'admin' || role.id === 'dev') return true;
      return user?.featureFlags?.enable_employee_tasks === true;
    }
    return role.permissions.includes(moduleId);
  }, [role, user?.featureFlags]);

  return (
    <AuthContext.Provider value={{ user, role, lockedInfo, getLoginError, login, logout, changePassword, updateProfile, hasPermission }}>
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
