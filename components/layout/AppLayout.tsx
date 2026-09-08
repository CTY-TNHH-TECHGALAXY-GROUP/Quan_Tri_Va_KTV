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
  const { user, lockedInfo: contextLockedInfo } = useAuth();
  const { unlockAudio, ktvScreen } = useNotifications();
  // 🔒 KTV đang trong một đơn (làm → đánh giá → bàn giao) → không cho mở menu 3 gạch.
  const isServingLocked = isServingLockedScreen(ktvScreen);

  const router = useRouter();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Nếu menu đang mở sẵn mà đơn vừa bắt đầu chạy → đóng lại luôn.
  React.useEffect(() => {
    if (isServingLocked) setIsSidebarOpen(false);
  }, [isServingLocked]);

  React.useEffect(() => {
    if (contextLockedInfo) {
      setLockInfo(contextLockedInfo);
    }
  }, [contextLockedInfo]);

  React.useEffect(() => {
    const handleAccountLocked = async (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.isLocked && user?.id) {
        // Fetch lock info from status route
        try {
          const res = await fetch(`/api/ktv/attendance/status?employeeId=${user.id}`);
          if (res.ok) {
            const data = await res.json();
            if (data.lockInfo) {
              setLockInfo(data.lockInfo);
            } else {
              setLockInfo({ reason: 'Tài khoản bị khóa kỷ luật', lockedAt: new Date().toISOString(), adminContact: 'Quản lý' });
            }
          }
        } catch (error) {
          console.error('Failed to fetch lock info:', error);
          setLockInfo({ reason: 'Tài khoản bị khóa kỷ luật', lockedAt: new Date().toISOString(), adminContact: 'Quản lý' });
        }
      } else {
        setLockInfo(null);
      }
    };

    window.addEventListener('account_locked', handleAccountLocked);
    return () => window.removeEventListener('account_locked', handleAccountLocked);
  }, [user?.id]);

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
