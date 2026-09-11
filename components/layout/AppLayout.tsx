'use client';

import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { AIAssistant } from '@/components/AIAssistant';
import { useNotifications } from '@/components/NotificationProvider';
import PullToRefresh from '@/components/PullToRefresh/PullToRefresh';
import { AccountLockedScreen } from '@/components/shared/AccountLockedScreen';
import { FeatureMaintenanceNotice } from '@/components/shared/FeatureMaintenanceNotice';
import { isServingLockedScreen } from '@/lib/ktv-screen';

interface AppLayoutProps {
  children: React.ReactNode;
  hideAI?: boolean;
  title?: string;
  /**
   * Nút riêng của từng trang, đặt bên phải tiêu đề trên thanh header MOBILE.
   * Không truyền thì header giữ nguyên như cũ — mọi trang khác không đổi gì.
   */
  headerRight?: React.ReactNode;
  disablePullToRefresh?: boolean;
}

export function AppLayout({ children, hideAI = false, title = 'Ngân Hà Spa', disablePullToRefresh = false, headerRight }: AppLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Mobile sidebar state
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true); // Desktop sidebar state
  const [mounted, setMounted] = useState(false);
  const [lockInfo, setLockInfo] = useState<any>(null);
  const { user, lockedInfo: contextLockedInfo, logout } = useAuth();
  const { unlockAudio, ktvScreen, ktvOrderLocked } = useNotifications();
  // 🔒 KTV đang trong một đơn (làm → đánh giá → bàn giao) → không cho mở menu 3 gạch.
  const isServingLocked = ktvOrderLocked || isServingLockedScreen(ktvScreen);

  const router = useRouter();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Nếu menu đang mở sẵn mà đơn vừa bắt đầu chạy → đóng lại luôn.
  React.useEffect(() => {
    if (isServingLocked) setIsSidebarOpen(false);
  }, [isServingLocked]);

  /**
   * Load what the lock screen shows. A MANUAL lock (admin switched "Hoạt động"
   * off) needs nothing: it only ever shows the maintenance sentence. A
   * disciplinary lock needs its reason from the status route.
   *
   * `knownKind` comes from the global session-check state; when the status
   * route cannot be reached we fall back to it instead of assuming
   * "discipline" — a manual lock must never be shown as a disciplinary one.
   */
  const userId = user?.id;
  const loadLockInfo = React.useCallback(async (knownKind?: string) => {
    if (knownKind === 'MANUAL') { setLockInfo({ kind: 'MANUAL' }); return; }
    if (!userId) return;
    const disciplineFallback = { kind: 'DISCIPLINE', reason: 'Tài khoản bị khóa kỷ luật', lockedAt: new Date().toISOString(), adminContact: 'Quản lý' };
    try {
      const res = await fetch(`/api/ktv/attendance/status?employeeId=${userId}`);
      if (!res.ok) {
        setLockInfo(knownKind === 'DISCIPLINE' ? disciplineFallback : null);
        return;
      }
      const data = await res.json();
      setLockInfo(data.lockInfo ?? (knownKind === 'DISCIPLINE' ? disciplineFallback : null));
    } catch (error) {
      console.error('Failed to fetch lock info:', error);
      setLockInfo(knownKind === 'DISCIPLINE' ? disciplineFallback : null);
    }
  }, [userId]);

  // Global lock state (session-check poll: every 60s, on focus, on app reopen).
  // It is the source of truth for CLEARING the screen too — the Realtime
  // "unlocked" branch reads payload.old, which needs REPLICA IDENTITY FULL.
  React.useEffect(() => {
    if (contextLockedInfo === undefined) return; // not checked yet
    if (contextLockedInfo === null) { setLockInfo(null); return; }
    loadLockInfo(contextLockedInfo.kind);
  }, [contextLockedInfo, loadLockInfo]);

  // Immediate path: an API answered ACCOUNT_LOCKED / Realtime saw the flip.
  React.useEffect(() => {
    const handleAccountLocked = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.isLocked) {
        loadLockInfo(contextLockedInfo?.kind);
      }
      // "Unlocked" is decided by the session-check state above, not here.
    };

    window.addEventListener('account_locked', handleAccountLocked);
    return () => window.removeEventListener('account_locked', handleAccountLocked);
  }, [loadLockInfo, contextLockedInfo]);

  React.useEffect(() => {
    if (mounted && !user) {
      router.push('/login');
    }
  }, [mounted, user, router]);

  if (!mounted || !user) {
    return (
      <div suppressHydrationWarning className="min-h-screen flex items-center justify-center bg-white">
        <div suppressHydrationWarning className="text-indigo-600 font-medium">Đang tải...</div>
      </div>
    );
  }

  if (lockInfo) {
    // Manual lock → the one shared maintenance notice, above toasts.
    if (lockInfo.kind === 'MANUAL') {
      return <FeatureMaintenanceNotice variant="fullscreen" onLogout={logout} />;
    }
    return <AccountLockedScreen lockInfo={lockInfo} />;
  }

  const handleGlobalRefresh = async () => {
    window.location.reload();
    await new Promise(resolve => setTimeout(resolve, 1000));
  };

  const MainContent = (
    <div className="pt-2 px-4 pb-safe lg:p-8 min-h-screen">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="max-w-7xl mx-auto"
      >
        {children}
      </motion.div>
    </div>
  );

  return (
    <div
      className="min-h-screen bg-gray-50 flex font-sans text-gray-900"
      onClick={unlockAudio}
    >
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isExpanded={isSidebarExpanded}
        onToggleExpand={() => setIsSidebarExpanded(!isSidebarExpanded)}
      />

      <main className="flex-1 flex flex-col">
        {/* Mobile Header: Aligns Hamburger and Page Title */}
        <div className="lg:hidden sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => { if (isServingLocked) return; setIsSidebarOpen(true); }}
            disabled={isServingLocked}
            title={isServingLocked ? 'Đang trong đơn — bàn giao phòng xong mới mở menu được.' : undefined}
            className={`p-2 -ml-2 rounded-xl transition-colors ${
              isServingLocked
                ? 'text-gray-300 cursor-not-allowed'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span className="sr-only">Mở Menu</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <div id="mobile-page-title" className="font-black text-sm uppercase tracking-widest text-slate-800 truncate">
            {title}
          </div>
          {headerRight && (
            <div className="ml-auto flex items-center gap-1.5 shrink-0">{headerRight}</div>
          )}
        </div>

        {/* 🛡️ LUÔN wrap PullToRefresh — chỉ toggle isDisabled.
            Trước đây conditional wrap/unwrap khiến React unmount+remount children
            mỗi khi isServingLocked toggle → vòng lặp vô hạn với screen state của KTV. */}
        <PullToRefresh onRefresh={handleGlobalRefresh} isDisabled={disablePullToRefresh || isServingLocked}>
          {MainContent}
        </PullToRefresh>
      </main>
      {!hideAI && !isServingLocked && <AIAssistant />}
    </div>
  );
}
