'use client';

import { usePathname } from 'next/navigation';
import { AuthProvider } from '@/lib/auth-context';
import { NotificationProvider } from '@/components/NotificationProvider';
import { ToastProvider } from '@/components/ui/Toast';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (process.env.NODE_ENV === 'development' && pathname === '/reception/dispatch/sequential-demo') {
    return <>{children}</>;
  }
  return <AuthProvider><NotificationProvider><ToastProvider>{children}</ToastProvider></NotificationProvider></AuthProvider>;
}
