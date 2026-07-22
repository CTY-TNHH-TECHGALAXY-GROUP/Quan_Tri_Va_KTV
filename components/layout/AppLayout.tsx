'use client';

import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { AIAssistant } from '@/components/AIAssistant';
import { useNotifications } from '@/components/NotificationProvider';
import PullToRefresh from '@/components/PullToRefresh/PullToRefresh';

interface AppLayoutProps {
  children: React.ReactNode;
  hideAI?: boolean;
  title?: string;
  disablePullToRefresh?: boolean;
}

export function AppLayout({ children, hideAI = false, title = 'Ngân Hà Spa', disablePullToRefresh = false }: AppLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Mobile sidebar state
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true); // Desktop sidebar state
  const [mounted, setMounted] = useState(false);
  const { user } = useAuth();
  const { unlockAudio } = useNotifications();

  const router = useRouter();

  React.useEffect(() => {
    setMounted(true);
  }, []);

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

  const handleGlobalRefresh = async () => {
    window.location.reload();
    await new Promise(resolve => setTimeout(resolve, 1000));
  };

  const MainContent = (
    <div className="pt-2 px-4 pb-4 lg:p-8 min-h-screen">
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
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <span className="sr-only">Mở Menu</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <div id="mobile-page-title" className="font-black text-sm uppercase tracking-widest text-slate-800 truncate">
            {title}
          </div>
        </div>

        {disablePullToRefresh ? (
          MainContent
        ) : (
          <PullToRefresh onRefresh={handleGlobalRefresh}>
            {MainContent}
          </PullToRefresh>
        )}
      </main>
      {!hideAI && <AIAssistant />}
    </div>
  );
}
