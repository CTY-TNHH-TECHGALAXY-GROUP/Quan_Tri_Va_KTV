'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase';
import { Bell, UserCircle, LogOut, Menu } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Avatar from '@radix-ui/react-avatar';

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, role, login, logout } = useAuth();
  const [staffAvatar, setStaffAvatar] = useState(user?.avatarUrl || '');

  // Fetch latest avatar from Staff table (not cached session)
  useEffect(() => {
    if (!user?.id) return;
    const fetchAvatar = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('Staff')
          .select('avatar_url')
          .eq('id', user.id)
          .maybeSingle();
        if (data?.avatar_url) {
          setStaffAvatar(data.avatar_url);
        }
      } catch (e) { /* keep cached */ }
    };
    fetchAvatar();
  }, [user?.id]);
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-4">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-md"
        >
          <Menu size={20} />
        </button>
        <div className="font-bold text-xl text-indigo-600 tracking-tight">Ngân Hà Spa</div>
      </div>

      <div className="flex items-center gap-4">
        <button className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
          <Bell size={20} />
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-2 hover:bg-gray-50 p-1 pr-3 rounded-full border border-transparent hover:border-gray-200 transition-all">
              <Avatar.Root className="w-8 h-8 rounded-full overflow-hidden bg-gray-200">
                <Avatar.Image src={staffAvatar} alt={user?.name} className="w-full h-full object-cover" />
                <Avatar.Fallback className="flex items-center justify-center w-full h-full text-sm font-medium text-gray-500">
                  {user?.name?.charAt(0)}
                </Avatar.Fallback>
              </Avatar.Root>
              <div className="hidden md:block text-left">
                <div className="text-sm font-medium text-gray-900 leading-none">{user?.name}</div>
                <div className="text-xs text-gray-500 mt-1">{role?.name}</div>
              </div>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content className="min-w-[200px] bg-white rounded-xl shadow-lg border border-gray-100 p-1 z-50 animate-in fade-in zoom-in-95" sideOffset={5} align="end">
              <DropdownMenu.Item 
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-md cursor-pointer outline-none hover:bg-gray-100"
                onClick={() => window.location.href = '/settings'}
              >
                <UserCircle size={16} />
                Thông tin cá nhân
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px bg-gray-100 my-1" />
              <DropdownMenu.Item 
                onClick={logout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 rounded-md cursor-pointer outline-none hover:bg-red-50"
              >
                <LogOut size={16} />
                Đăng xuất
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
