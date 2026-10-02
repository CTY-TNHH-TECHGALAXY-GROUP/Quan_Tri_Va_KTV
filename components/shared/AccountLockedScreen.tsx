'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { useAuth } from '@/lib/auth-context';

export function AccountLockedScreen({ lockInfo }: { lockInfo: any }) {
  const { logout } = useAuth();
  
  if (!lockInfo) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full px-6 py-8 text-center"
      >
        <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Tài khoản bị khóa</h2>
        <p className="text-gray-500 mb-8">Tài khoản của bạn đã bị khóa kỷ luật.</p>
        
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 mb-8 text-left space-y-4 shadow-sm">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Lý do khóa</div>
            <div className="text-sm font-medium text-gray-800">{lockInfo.reason}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Thời gian khóa</div>
            <div className="text-sm font-medium text-gray-800">
              {lockInfo.lockedAt ? format(new Date(lockInfo.lockedAt), 'dd/MM/yyyy HH:mm') : 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Liên hệ mở khóa</div>
            <div className="text-sm font-medium text-gray-800">{lockInfo.adminContact}</div>
          </div>
        </div>

        <button 
          onClick={logout}
          className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-3.5 rounded-xl transition-colors"
        >
          Đăng xuất
        </button>
      </motion.div>
    </div>
  );
}
