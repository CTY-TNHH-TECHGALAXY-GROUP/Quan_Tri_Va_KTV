import type {Metadata} from 'next';
import './globals.css'; // Global styles
import { AuthProvider } from '@/lib/auth-context';
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Oria Spa Management',
  description: 'Hệ thống quản lý Oria Spa chuyên nghiệp',
  icons: {
    icon: '/icon.png',
    shortcut: '/favicon.ico',
    apple: '/apple-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Oria Spa',
  },
};

export const viewport = {
  themeColor: '#D4AF37',
  width: 'device-width',
  initialScale: 1,
};

import { NotificationProvider } from '@/components/NotificationProvider';
import { ToastProvider } from '@/components/ui/Toast';

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning className="font-sans antialiased">
        <AuthProvider>
          <NotificationProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </NotificationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
