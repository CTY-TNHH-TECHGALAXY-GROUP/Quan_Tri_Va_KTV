import { useState, useRef, useCallback } from 'react';

// 🔧 UI CONFIGURATION
const DRAG_THRESHOLD = 100; // Ngưỡng vuốt (px) để kích hoạt
const HOLD_DURATION = 800;  // Thời gian giữ (ms) sau khi qua ngưỡng
const MAX_DRAG = 150;       // Chiều dài vuốt tối đa (px)

interface UsePullToRefreshProps {
  onRefresh: () => Promise<void>;
  isDisabled?: boolean;
}

export const usePullToRefresh = ({ onRefresh, isDisabled = false }: UsePullToRefreshProps) => {
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent | TouchEvent) => {
    // Không cho vuốt nếu đang bị disable, đang refresh, hoặc nội dung không ở vị trí đầu trang
    if (isDisabled || isRefreshing || window.scrollY > 0) return;
    
    const touch = 'touches' in e ? e.touches[0] : (e as any);
    if (!touch) return;

    startYRef.current = touch.clientY;
    currentYRef.current = touch.clientY;
    isDraggingRef.current = true;
    setIsSuccess(false);
  }, [isDisabled, isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent | TouchEvent) => {
    if (!isDraggingRef.current || isDisabled || isRefreshing) return;

    const touch = 'touches' in e ? e.touches[0] : (e as any);
    if (!touch) return;

    currentYRef.current = touch.clientY;
    const diffY = currentYRef.current - startYRef.current;

    // Chỉ cho phép vuốt xuống
    if (diffY < 0) return;

    // Tạo cảm giác "nặng" (dampen) khi vuốt
    let pullDistance = diffY * 0.5;
    if (pullDistance > MAX_DRAG) {
      pullDistance = MAX_DRAG + (pullDistance - MAX_DRAG) * 0.2;
    }

    setPullY(pullDistance);

    // Nếu đã qua ngưỡng và chưa bắt đầu giữ (timer chưa chạy)
    if (pullDistance >= DRAG_THRESHOLD && !holdTimerRef.current && !isHolding) {
      setIsHolding(true);
      
      // Bắt đầu đếm giờ giữ
      holdTimerRef.current = setTimeout(() => {
        setIsHolding(false);
        setIsRefreshing(true);
        clearHoldTimer();
        
        // Thực thi hành động refresh
        onRefresh().then(() => {
          setIsSuccess(true);
          setTimeout(() => {
            setIsRefreshing(false);
            setPullY(0);
          }, 800); // Hiện thông báo thành công trong 800ms
        }).catch(() => {
          setIsRefreshing(false);
          setPullY(0);
        });
      }, HOLD_DURATION);
    } else if (pullDistance < DRAG_THRESHOLD && isHolding) {
      // Người dùng vuốt ngược lên trước khi timer kết thúc
      setIsHolding(false);
      clearHoldTimer();
    }
  }, [isDisabled, isRefreshing, isHolding, onRefresh, clearHoldTimer]);

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    
    isDraggingRef.current = false;
    clearHoldTimer();
    setIsHolding(false);

    // Nếu không nằm trong trạng thái refresh, thì tự nảy lên vị trí cũ
    if (!isRefreshing) {
      setPullY(0);
    }
  }, [clearHoldTimer, isRefreshing]);

  return {
    pullY,
    isRefreshing,
    isHolding,
    isSuccess,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    DRAG_THRESHOLD,
    HOLD_DURATION
  };
};
