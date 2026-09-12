'use client';

import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, ArrowDown } from 'lucide-react';
import { usePullToRefresh } from './PullToRefresh.logic';

interface PullToRefreshProps {
  /** Hàm callback được gọi khi vuốt đủ sâu và giữ đủ thời gian */
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  /** Tắt tính năng vuốt (ví dụ khi đang ở trang khác không cần refresh) */
  isDisabled?: boolean;
}

const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children, isDisabled }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const {
    pullY,
    isRefreshing,
    isHolding,
    isSuccess,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    DRAG_THRESHOLD,
    HOLD_DURATION
  } = usePullToRefresh({ onRefresh, isDisabled });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchMove = (e: TouchEvent) => {
      if (pullY > 0 && window.scrollY <= 0) {
        // Ngăn chặn cuộn mặc định của trình duyệt nếu đang vuốt xuống
        if (e.cancelable) {
          e.preventDefault();
        }
      }
      handleTouchMove(e);
    };

    // passive: false là bắt buộc để có thể dùng e.preventDefault() trong onTouchMove
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, pullY]);

  // Trạng thái hiển thị thông báo
  let message = 'Vuốt xuống để tải lại';
  let Icon = <ArrowDown className="w-5 h-5 text-gray-400" />;
  
  if (isSuccess) {
    message = 'Đã làm mới';
    Icon = <CheckCircle2 className="w-5 h-5 text-green-500" />;
  } else if (isRefreshing) {
    message = 'Đang tải lại...';
    Icon = <Loader2 className="w-5 h-5 text-spa-primary animate-spin" />;
  } else if (isHolding) {
    message = 'Giữ để tải lại...';
    Icon = <ArrowDown className="w-5 h-5 text-spa-primary" />;
  }

  // Tính toán tiến trình vòng xoay theo độ dài vuốt (từ 0 -> 1)
  const progress = Math.min(pullY / DRAG_THRESHOLD, 1);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[50vh] overflow-hidden touch-pan-y">
      {/* Indicator nổi ở phía trên */}
      <motion.div
        className="absolute top-0 left-0 right-0 flex justify-center z-50 pointer-events-none"
        animate={{
          y: isRefreshing || isSuccess ? 30 : pullY > 0 ? pullY - 30 : -50,
          opacity: isRefreshing || isSuccess || pullY > 20 ? 1 : 0
        }}
        transition={{
          type: isRefreshing || isSuccess || pullY === 0 ? 'spring' : 'tween',
          stiffness: 300,
          damping: 20,
          duration: pullY > 0 && !isRefreshing && !isSuccess ? 0 : 0.3
        }}
      >
        <div className="bg-white/80 backdrop-blur-md shadow-sm border border-gray-100 rounded-full px-4 py-2 flex items-center gap-2">
          {isHolding && !isRefreshing && !isSuccess ? (
            <div className="relative w-5 h-5 flex items-center justify-center">
               <motion.div 
                 className="absolute inset-0 rounded-full border-2 border-spa-primary/30 border-t-spa-primary"
                 animate={{ rotate: 360 }}
                 transition={{ duration: HOLD_DURATION / 1000, ease: "linear" }}
               />
               <ArrowDown className="w-3 h-3 text-spa-primary" />
            </div>
          ) : (
            <motion.div
              style={{
                rotate: isHolding || isRefreshing || isSuccess ? 0 : progress * 180
              }}
            >
              {Icon}
            </motion.div>
          )}
          <span className="text-sm font-medium text-gray-600">{message}</span>
        </div>
      </motion.div>

      {/* Main Content trượt xuống theo độ vuốt */}
      <motion.div
        animate={{ y: isRefreshing || isSuccess ? 60 : pullY }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30,
          duration: pullY > 0 && !isRefreshing && !isSuccess ? 0 : 0.3
        }}
        className="w-full h-full"
      >
        {children}
      </motion.div>
    </div>
  );
};

export default PullToRefresh;
