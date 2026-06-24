'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { MODULES } from '@/lib/constants';
import { ModuleId } from '@/lib/types';
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  PieChart,
  Banknote,
  Wallet,
  Globe,
  MenuSquare,
  ShieldAlert,
  UserCheck,
  UserRound,
  Sparkles,
  Settings,
  X,
  Camera,
  CalendarOff,
  CalendarDays,
  TrendingUp,
  History,
  ListOrdered,
  BookOpen,
  ClipboardCheck,
  Home,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Bell,
  Tablet,
  LogOut,
  DoorOpen,
  MessageSquare,
  ToggleLeft,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const ICONS: Record<string, React.ReactNode> = {
  dashboard: <Home size={20} />,
  dispatch_board: <LayoutDashboard size={20} />,
  order_management: <KanbanSquare size={20} />,
  customer_management: <Users size={20} />,
  revenue_reports: <PieChart size={20} />,
  payroll_commissions: <Banknote size={20} />,
  cashbook_supplies: <Wallet size={20} />,
  finance_management: <Banknote size={20} />,
  web_booking: <Globe size={20} />,
  service_menu: <MenuSquare size={20} />,
  customer_reminders: <MessageSquare size={20} />,
  role_management: <ShieldAlert size={20} />,
  employee_management: <UserRound size={20} />,
  ktv_dashboard: <UserCheck size={20} />,
  ktv_attendance: <Camera size={20} />,
  ktv_schedule: <CalendarDays size={20} />,
  ktv_performance: <TrendingUp size={20} />,
  ktv_history: <History size={20} />,
  turn_tracking: <ListOrdered size={20} />,
  ktv_hub: <UserCheck size={20} />,
  ktv_wallet: <Wallet size={20} />,
  leave_management: <CalendarOff size={20} />,
  service_handbook: <BookOpen size={20} />,
  ai_features: <Sparkles size={20} />,
  device_management: <Tablet size={20} />,
  room_management: <DoorOpen size={20} />,
  staff_notifications: <Bell size={20} />,
  staff_features: <Settings size={20} />,
  notification_settings: <Settings size={20} />,
  support_dashboard: <LayoutDashboard size={20} />,
  support_tasks_admin: <ClipboardCheck size={20} />,
  settings: <Settings size={20} />,
};

const PATHS: Record<string, string> = {
  dashboard: '/',
  dispatch_board: '/reception/dispatch',
  order_management: '/reception/orders',
  customer_management: '/reception/crm',
  revenue_reports: '/finance/revenue',
  payroll_commissions: '/finance/payroll',
  cashbook_supplies: '/finance/cashbook',
  finance_management: '/finance/ktv',
  web_booking: '/reception/web-booking',
  service_menu: '/admin/service-menu',
  customer_reminders: '/admin/customer-reminders',
  role_management: '/admin/roles',
  employee_management: '/admin/employees',
  ktv_dashboard: '/ktv/dashboard',
  ktv_attendance: '/ktv/attendance',
  ktv_schedule: '/ktv/schedule',
  ktv_performance: '/ktv/performance',
  ktv_history: '/ktv/history',
  turn_tracking: '/reception/turns',
  ktv_hub: '/reception/ktv-hub',
  ktv_wallet: '/ktv/wallet',
  leave_management: '/reception/leave-management',
  service_handbook: '/services/handbook',
  ai_features: '/admin/ai',
  device_management: '/admin/devices',
  room_management: '/reception/rooms',
  staff_notifications: '/admin/notifications',
  staff_features: '/admin/settings/features',
  notification_settings: '/admin/settings/notifications',
  support_dashboard: '/support/dashboard',
  support_tasks_admin: '/admin/support-tasks',
  settings: '/settings',
};

// 🔧 UI CONFIGURATION
const GROUP_ORDER = ['Vận Hành', 'Tài Chính & Kế Toán', 'Thiết Lập Nội Dung', 'Kỹ Thuật Viên', 'Hậu Cần', 'Hệ Thống'];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function Sidebar({ isOpen, onClose, isExpanded = true, onToggleExpand }: SidebarProps) {
  const { hasPermission, user, role, logout } = useAuth();
  const pathname = usePathname();
  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({});

  // Group modules by their group property
  const groupedModules = React.useMemo(() => {
    return MODULES
      .filter(m => m.id !== 'settings' && hasPermission(m.id as any))
      .reduce((acc, module) => {
        let groupName = module.group;
        
        // Đổi tên nhóm Kỹ Thuật Viên thành Hậu Cần nếu là nhân viên Hậu Cần
        if (role?.id === 'support' && groupName === 'Kỹ Thuật Viên') {
            groupName = 'Hậu Cần';
        }

        if (!acc[groupName]) {
          acc[groupName] = [];
        }
        acc[groupName].push(module);
        return acc;
      }, {} as Record<string, typeof MODULES>);
  }, [hasPermission, role?.id]);

  // Auto-expand groups that contain the active link
  React.useEffect(() => {
    const newExpanded: Record<string, boolean> = {};
    Object.entries(groupedModules).forEach(([groupName, modules]) => {
      const hasActiveLink = modules.some(m => {
        const path = PATHS[m.id];
        return pathname === path || pathname.startsWith(path + '/');
      });
      if (hasActiveLink) {
        newExpanded[groupName] = true;
      }
    });
    setExpandedGroups(prev => ({ ...prev, ...newExpanded }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  const renderLink = (module: typeof MODULES[0], showLabel: boolean) => {
    const path = PATHS[module.id];
    const isActive = pathname === path || pathname.startsWith(path + '/');
    return (
      <Link
        key={module.id}
        href={path}
        onClick={() => { if (window.innerWidth < 1024) onClose(); }}
        title={!showLabel ? module.name : undefined}
        className={`flex items-center ${showLabel ? 'gap-3 px-3' : 'justify-center px-0'} py-2 rounded-xl transition-all duration-200 ${isActive
          ? 'bg-indigo-50 text-indigo-700 font-medium shadow-sm border border-indigo-100/50'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        <span className={isActive ? 'text-indigo-600' : 'text-gray-400'}>
          {ICONS[module.id]}
        </span>
        {showLabel && <span className="text-sm truncate">{module.name}</span>}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar Content */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-white border-r border-gray-200 shadow-xl lg:shadow-none lg:translate-x-0 lg:sticky lg:top-0 flex flex-col h-screen transition-all duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} ${isExpanded ? 'w-64' : 'w-20'}`}
      >
        {/* Header: User Info */}
        <div className={`border-b border-gray-100 h-[69px] flex items-center ${isExpanded ? 'px-4 gap-3' : 'justify-center'}`}>
          {isExpanded ? (
            <>
              <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm shrink-0">
                {user?.name?.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-gray-900 truncate">{user?.name}</p>
                <p className="text-[10px] text-gray-500 font-medium truncate">{role?.name}</p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={logout} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Đăng xuất">
                  <LogOut size={16} />
                </button>
                <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg lg:hidden">
                  <X size={16} />
                </button>
                {onToggleExpand && (
                  <button onClick={onToggleExpand} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg hidden lg:flex" title="Thu gọn">
                    <ChevronLeft size={16} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm cursor-pointer" title={user?.name}>
                {user?.name?.charAt(0)}
              </div>
              {onToggleExpand && (
                <button onClick={onToggleExpand} className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg hidden lg:flex" title="Mở rộng">
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className={`py-4 space-y-1 flex-1 overflow-y-auto w-full overflow-x-hidden ${isExpanded ? 'px-3' : 'px-3'}`}>
          {isExpanded ? (
            // Expanded: Grouped dropdown navigation
            GROUP_ORDER.filter(g => groupedModules[g]?.length > 0).map(groupName => {
              const modules = groupedModules[groupName];
              const isGroupExpanded = expandedGroups[groupName];
              const hasActiveInGroup = modules.some(m => {
                const path = PATHS[m.id];
                return pathname === path || pathname.startsWith(path + '/');
              });

              return (
                <div key={groupName} className="mb-0.5">
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(groupName)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                      hasActiveInGroup ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <span>{groupName}</span>
                    <ChevronDown
                      size={14}
                      className={`transition-transform duration-200 ${isGroupExpanded ? 'rotate-0' : '-rotate-90'}`}
                    />
                  </button>

                  {/* Group Items with animation */}
                  <AnimatePresence initial={false}>
                    {isGroupExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-0.5 mt-0.5 ml-1">
                          {modules.map(module => renderLink(module, true))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          ) : (
            // Collapsed: Icons only (flat)
            MODULES.filter(m => m.id !== 'settings' && hasPermission(m.id as any)).map(module =>
              renderLink(module, false)
            )
          )}
        </div>

      {/* Bottom Section for Settings */}
      <div className="mt-auto border-t border-gray-100 bg-white z-10 w-full pl-0 pb-6 flex flex-col">
        {/* Version & Reload Button */}
        <div className={`px-4 pt-4 pb-2 w-full flex flex-col ${isExpanded ? 'items-start' : 'items-center'} gap-2`}>
          <button
              onClick={() => {
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(registrations) {
                    for(let registration of registrations) {
                      registration.unregister();
                    }
                    window.location.reload();
                  });
                } else {
                  window.location.reload();
                }
              }}
              title={!isExpanded ? "Tải lại App" : undefined}
              className={`flex items-center justify-center gap-2 py-2 rounded-xl transition-all duration-200 text-xs font-bold text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 border border-gray-200 hover:border-indigo-200 w-full bg-gray-50 active:scale-95`}
          >
            <RefreshCw size={16} className="shrink-0" />
            {isExpanded && <span>Làm mới Ứng dụng</span>}
          </button>
          
          {isExpanded && (
              <div className="text-[10px] text-gray-400 font-medium w-full text-center mt-1">
                  Phiên bản: 1.0.2
              </div>
          )}
        </div>

        {hasPermission('settings') && (
          <div className={`p-4 pt-2 pb-0 w-full ${!isExpanded && 'px-3'}`}>
            <Link
              href={PATHS.settings}
              onClick={() => {
                if (window.innerWidth < 1024) onClose();
              }}
              title={!isExpanded ? "Cài đặt" : undefined}
              className={`flex items-center ${isExpanded ? 'gap-3 px-3' : 'justify-center px-0'} py-2.5 rounded-xl transition-all duration-200 ${pathname === PATHS.settings
                ? 'bg-indigo-50 text-indigo-700 font-medium shadow-sm border border-indigo-100/50'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className={pathname === PATHS.settings ? 'text-indigo-600' : 'text-gray-400'}>
                {ICONS.settings}
              </span>
              {isExpanded && <span className="text-sm font-medium">Cài đặt</span>}
            </Link>
          </div>
        )}
      </div>
    </aside>
  </>
  );
}
