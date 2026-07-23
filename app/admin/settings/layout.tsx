'use client';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, Bell, Zap, Database, Users } from 'lucide-react';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const tabs = [
        { name: 'Quản Lý Tính Năng', href: '/admin/settings/features', icon: <Zap size={18} /> },
        { name: 'Cài Đặt Thông Báo', href: '/admin/settings/notifications', icon: <Bell size={18} /> },
        { name: 'Cấu Hình Tài Chính', href: '/admin/settings/system', icon: <Settings size={18} /> },
        { name: 'Cấu Hình Nâng Cao', href: '/admin/settings/advanced', icon: <Database size={18} /> }
    ];

    return (
        <AppLayout title="Cài Đặt Hệ Thống">
            <div className="max-w-5xl mx-auto p-4 md:p-6">
                {/* Master Tabs */}
                <div className="flex gap-2 p-1.5 bg-gray-100/80 backdrop-blur rounded-2xl w-fit mb-6 overflow-x-auto max-w-full">
                    {tabs.map(tab => {
                        const isActive = pathname.startsWith(tab.href);
                        return (
                            <Link 
                                key={tab.href} 
                                href={tab.href} 
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${
                                    isActive 
                                        ? 'bg-white text-indigo-600 shadow-sm' 
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'
                                }`}
                            >
                                {tab.icon}
                                {tab.name}
                            </Link>
                        );
                    })}
                </div>
                {/* Page Content */}
                <div className="w-full">
                    {children}
                </div>
            </div>
        </AppLayout>
    );
}
