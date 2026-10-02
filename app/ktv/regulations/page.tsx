'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import type { WorkType } from '@/lib/types/staff.types';

// 🔧 UI CONFIGURATION
const HEADER_HEIGHT = '56px';

// Map work_type to corresponding static HTML file in /public/regulations/
const REGULATION_FILES: Record<string, string> = {
  TYPE_D: '/regulations/type-d.html',
  // TYPE_A: '/regulations/type-a.html',
  // TYPE_B: '/regulations/type-b.html',
  // TYPE_C: '/regulations/type-c.html',
};

const KTVRegulationsPage = () => {
  const router = useRouter();
  const { user } = useAuth();
  const [workType, setWorkType] = useState<WorkType | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch KTV work_type from Staff table
  useEffect(() => {
    const fetchWorkType = async () => {
      const ktvId = (user?.code || user?.id || '').toUpperCase();
      if (!ktvId) {
        setIsLoading(false);
        return;
      }

      try {
        const { data } = await supabase
          .from('Staff')
          .select('work_type')
          .eq('id', ktvId)
          .single();

        if (data?.work_type) {
          setWorkType(data.work_type as WorkType);
        }
      } catch (err) {
        console.error('Failed to fetch work_type:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkType();
  }, [user]);

  const regulationUrl = workType ? REGULATION_FILES[workType] : null;

  return (
    <div className="min-h-screen bg-[#15211b] flex flex-col">
      {/* Header */}
      <header
        className="flex items-center gap-3 px-4 bg-[#1c2c24] border-b border-[#3a4a3f] flex-shrink-0"
        style={{ height: HEADER_HEIGHT }}
      >
        <button
          onClick={() => router.back()}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 text-[#efe7d3] active:scale-95 transition-transform"
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-[#efe7d3] font-semibold text-base tracking-wide">
          Quy chế Oria
        </h1>
      </header>

      {/* Content */}
      <div className="flex-1 relative">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={32} className="animate-spin text-[#4b6650]" />
          </div>
        ) : regulationUrl ? (
          <iframe
            src={regulationUrl}
            className="w-full border-none"
            style={{ height: `calc(100vh - ${HEADER_HEIGHT})` }}
            title="Quy chế Oria"
          />
        ) : (
          /* Placeholder for types without regulation HTML */
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <div className="w-20 h-20 rounded-full bg-[#4b6650]/20 flex items-center justify-center mb-6">
              <span className="text-4xl">📋</span>
            </div>
            <h2 className="text-[#efe7d3] font-semibold text-lg mb-2">
              Đang cập nhật
            </h2>
            <p className="text-[#5c6b57] text-sm leading-relaxed max-w-xs">
              Quy chế cho chế độ làm việc của bạn đang được cập nhật. Vui lòng quay lại sau.
            </p>
            <button
              onClick={() => router.back()}
              className="mt-8 px-6 py-3 rounded-2xl bg-[#4b6650] text-[#efe7d3] font-medium text-sm active:scale-95 transition-transform"
            >
              ← Quay về Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KTVRegulationsPage;
